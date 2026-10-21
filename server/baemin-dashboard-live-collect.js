// 배민 신규 "실시간 운영 현황" UI 수집기
// 구 /v4/management/delivery-status 가 폐기되고 새 /v1/dashboard/* 로 이전됨(2026-10-21).
//
//   A) GET /v1/dashboard/today                      → 일일현황 + 슬롯 목표/완료 + 시간외 합계
//   B) GET /v1/dashboard/today/riders?page&size     → 운행중/종료 + 라이더별 완료/거절/취소 (페이지네이션)
//   C) GET /v1/dashboard/today/riders/{riderId}     → SLA포함/미포함(=시간외) + 슬롯별 + 시간대별 (라이더 1명당 1호출)
//
// B(라이더별 완료/거절/취소)와 C(완료+시간외)는 "같은 시점"이 중요하므로,
// 완료·시간외는 C(라이더 상세) 한 호출에서 함께 읽어 동시성을 보장한다.
//
// 신규 데이터를 "구 delivery-status 아이템" 형태로 합성해 mapItemToCollectRow 로 넘긴다.
// → 대시보드/ERP/기여도 등 하류 로직을 그대로 재사용(스키마 불변).

const { mapItemToCollectRow } = require('./baemin-collect-sources');

const API_ORIGIN = 'https://api-deliverycenter.baemin.com';
const PAGE_ORIGIN = 'https://deliverycenter.baemin.com';

// 재생 금지 헤더(브라우저가 자동 설정하는 것)
const FORBIDDEN_REPLAY_HEADERS = new Set([
  'host', 'content-length', 'connection', 'accept-encoding'
]);

function pickReplayHeaders(reqHeaders = {}) {
  const out = {};
  Object.entries(reqHeaders || {}).forEach(([k, v]) => {
    if (!k || v == null) return;
    const lk = String(k).toLowerCase();
    if (lk.startsWith(':')) return; // HTTP/2 pseudo-headers
    if (FORBIDDEN_REPLAY_HEADERS.has(lk)) return;
    out[k] = String(v);
  });
  return out;
}

// 슬롯(새 UI) → 피크 버킷(구 delivery-status) 매핑
//   MORNING 아침점심피크(09-13) → morning
//   LUNCH   오후논피크(13-17)   → afternoon
//   DINNER  저녁피크(17-20)     → evening
//   NIGHT   심야논피크(20-24)   → midnight
const SLOT_TO_PEAK = { MORNING: 'morning', LUNCH: 'afternoon', DINNER: 'evening', NIGHT: 'midnight' };

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * page.evaluate 안에서 캡처한 인증 헤더로 직접 fetch.
 */
async function pageFetchJson(page, url, headers) {
  return page.evaluate(async ({ url, headers }) => {
    try {
      const res = await fetch(url, { method: 'GET', credentials: 'include', headers });
      let body = null;
      try { body = await res.json(); } catch { body = null; }
      return { status: res.status, body };
    } catch (err) {
      return { status: 0, body: null, error: String(err && err.message || err) };
    }
  }, { url, headers });
}

/**
 * 현재 활성 센터(협력사) 기준으로 A+B+C 수집.
 *
 * 핵심: 구 파이프라인과 동일하게 "네비게이션으로 성공한 요청의 헤더(인증 포함)를 캡처 → 재생".
 *   - /delivery/history 로 이동하면 SPA 가 A, B(page0) 를 정상 호출(200) → 응답·헤더 캡처
 *   - 캡처한 헤더로 B(page1+), C(라이더별) 를 page.evaluate fetch 로 재생
 * credentials:include + 캡처 헤더 = CENTER_SESSION/인증 그대로 적용.
 */
async function fetchDashboardLiveViaPage(page, options = {}) {
  const includeRiderDetail = options.includeRiderDetail !== false;
  const maxRiderDetail = Number(options.maxRiderDetail || 0); // 0 = 전체
  const riderConcurrency = Math.max(1, Number(options.riderConcurrency || 4));
  const navWaitMs = Number(options.navWaitMs || 3500);

  let authHeaders = null;
  const initial = { today: null, ridersByPage: {} };

  const handler = async (response) => {
    try {
      const u = response.url();
      if (!u.includes('api-deliverycenter') || response.status() !== 200) return;
      let path = u;
      let search = '';
      try { const pu = new URL(u); path = pu.pathname; search = pu.search; } catch { /* ignore */ }
      if (!path.startsWith('/v1/dashboard/today')) return;
      if (!authHeaders) {
        try { authHeaders = pickReplayHeaders(response.request().headers()); } catch { /* ignore */ }
      }
      if (path === '/v1/dashboard/today') {
        if (!initial.today) { try { initial.today = await response.json(); } catch { /* ignore */ } }
      } else if (path === '/v1/dashboard/today/riders') {
        try {
          const pageNo = Number(new URLSearchParams(search).get('page') || 0);
          if (initial.ridersByPage[pageNo] == null) initial.ridersByPage[pageNo] = await response.json();
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  };

  page.on('response', handler);
  try {
    await page.goto(`${PAGE_ORIGIN}/delivery/history`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((err) => {
      if (!String(err.message || '').includes('ERR_ABORTED')) throw err;
    });
    await new Promise((r) => setTimeout(r, navWaitMs));
  } finally {
    page.off('response', handler);
  }

  const headers = { Accept: 'application/json, text/plain, */*', ...(authHeaders || {}) };
  const out = {
    today: initial.today,
    todayStatus: initial.today ? 200 : 0,
    riders: [],
    riderOperation: null,
    riderDetails: {},
    errors: [],
    authHeaderKeys: Object.keys(authHeaders || {}),
    navCaptured: { today: Boolean(initial.today), ridersPages: Object.keys(initial.ridersByPage).length }
  };

  // A 보강(캡처 실패 시)
  if (!out.today) {
    const a = await pageFetchJson(page, `${API_ORIGIN}/v1/dashboard/today`, headers);
    out.todayStatus = a.status;
    out.today = a.body || null;
    if (a.status !== 200) out.errors.push(`today=${a.status}`);
  }

  // B — page0 는 캡처 재사용, 이후 페이지는 재생 fetch
  let firstBody = initial.ridersByPage[0];
  if (!firstBody) {
    const b0 = await pageFetchJson(page, `${API_ORIGIN}/v1/dashboard/today/riders?page=0&size=20&sort=name,asc`, headers);
    if (b0.status === 200 && b0.body) firstBody = b0.body;
    else out.errors.push(`riders.p0=${b0.status}`);
  }
  if (firstBody) {
    out.riderOperation = firstBody.riderOperation || null;
    out.riders.push(...(Array.isArray(firstBody.riders) ? firstBody.riders : []));
    let hasNext = Boolean(firstBody.hasNext);
    let pageNo = 1;
    while (hasNext) {
      const b = await pageFetchJson(page, `${API_ORIGIN}/v1/dashboard/today/riders?page=${pageNo}&size=20&sort=name,asc`, headers);
      if (b.status !== 200 || !b.body) { out.errors.push(`riders.p${pageNo}=${b.status}`); break; }
      out.riders.push(...(Array.isArray(b.body.riders) ? b.body.riders : []));
      hasNext = Boolean(b.body.hasNext);
      pageNo += 1;
      if (pageNo > 30) { out.errors.push('riders.pageguard'); break; }
    }
  }

  // C — 라이더 상세(완료+시간외 동시). 한 evaluate 안에서 동시성 fetch.
  if (includeRiderDetail && out.riders.length) {
    let ids = out.riders.map((r) => r && r.riderId).filter(Boolean);
    if (maxRiderDetail > 0) ids = ids.slice(0, maxRiderDetail);
    const detail = await page.evaluate(async ({ ids, headers, API_ORIGIN, conc }) => {
      const res = {};
      const errs = [];
      let cursor = 0;
      const worker = async () => {
        while (cursor < ids.length) {
          const id = ids[cursor++];
          try {
            const r = await fetch(`${API_ORIGIN}/v1/dashboard/today/riders/${id}`, { credentials: 'include', headers });
            if (r.status === 200) res[id] = await r.json();
            else errs.push(`${id}=${r.status}`);
          } catch (e) { errs.push(`${id}=err`); }
        }
      };
      await Promise.all(Array.from({ length: Math.min(conc, ids.length || 1) }, () => worker()));
      return { res, errs };
    }, { ids, headers, API_ORIGIN, conc: riderConcurrency });
    out.riderDetails = detail.res || {};
    (detail.errs || []).forEach((e) => out.errors.push(`rider.${e}`));
  }

  out.serverDatetime = (out.today && out.today.serverDatetime) || null;
  return out;
}

/**
 * 신규 라이브 데이터 → 구 delivery-status 아이템 배열(라이더 1명당 1아이템) 합성.
 */
function buildDeliveryStatusItems(live) {
  const details = live.riderDetails || {};
  return (live.riders || []).map((r) => {
    const d = details[r.riderId] || {};
    const completed = r.completed || {};
    const rejected = r.rejected || {};
    const canceled = r.canceled || {};
    const riderFault = r.riderFault || {};

    // 슬롯별 완료(C) → 피크 버킷
    const peak = { morning: 0, afternoon: 0, evening: 0, midnight: 0 };
    (d.slots || []).forEach((s) => {
      const key = SLOT_TO_PEAK[String(s && s.slot || '').toUpperCase()];
      if (key) peak[key] = num(s.completedCount);
    });

    const slaIncluded = num(d.slaIncludedCount);   // SLA 포함
    const slaExcluded = num(d.slaExcludedCount);   // SLA 미포함 = 시간외(라이더앱 시간외 배달)
    // 총 배달완료: C.completedCount 우선, 없으면 B.completed.total, 없으면 SLA합
    const allDayComplete = num(
      d.completedCount != null ? d.completedCount
        : (completed.total != null ? completed.total : (slaIncluded + slaExcluded))
    );

    // 상세(C) 응답의 riderId = 구 로그인 id(예: bigcloud8200) → ERP riders.baemin_id 매칭 키.
    // 목록(B)의 riderId = 숫자 내부 id(상세 호출용). 매칭/중복키는 로그인 id 우선.
    const loginId = String(d.riderId || '').trim();
    const numericId = String(r.riderId || '').trim();
    const matchUserId = loginId || numericId;

    return {
      name: String(r.name || '').trim(),
      userId: matchUserId,
      riderId: matchUserId,
      phoneNumber: String(d.phoneNumber || '').trim(),
      baeminRiderNo: numericId, // 신규 숫자 riderId 보존(추적용)
      status: {
        code: String(r.status || ''),
        desc: String(r.status || '').toUpperCase() === 'OPERATING' ? '운행중' : '운행종료'
      },
      deliveryAcceptanceCount: {
        allDayComplete,
        totalComplete: slaIncluded,  // 구 코드의 slaComplete 소스
        slaComplete: slaIncluded,
        slaOutComplete: slaExcluded, // 시간외
        foodComplete: num(completed.food),
        bmartComplete: num(completed.bmart),
        storeComplete: num(completed.store),
        foodReject: num(rejected.food),
        bmartReject: num(rejected.bmart),
        storeReject: num(rejected.store),
        totalReject: num(rejected.total),
        foodCancel: num(canceled.food),
        bmartCancel: num(canceled.bmart),
        storeCancel: num(canceled.store),
        totalCancel: num(canceled.total),
        foodRiderFault: num(riderFault.food),
        bmartRiderFault: num(riderFault.bmart),
        storeRiderFault: num(riderFault.store),
        totalRiderFault: num(riderFault.total)
      },
      deliveryPeakTimeCount: peak,
      hourlyCompleted: Array.isArray(d.hourly && d.hourly.data) ? d.hourly.data : [],
      // 참고용(디버깅): 원본 집계
      _slaWindow: d.slaWindow || null,
      _hasDetail: Boolean(details[r.riderId])
    };
  });
}

/**
 * 라이브 데이터 → baemin_biz_collect_items 행(delivery_status) 배열로 변환.
 */
function buildDeliveryStatusRows(live, partnerContext, opts = {}) {
  const collectDate = String(opts.collectDate || '').slice(0, 10);
  const collectedAt = opts.collectedAt || new Date().toISOString();
  const sourceUrl = `${API_ORIGIN}/v1/dashboard/today`;
  const partnerId = String(partnerContext.partnerId || partnerContext.centerId || '').trim().toUpperCase();
  const partnerName = String(partnerContext.partnerName || '').trim();
  const regionName = String(partnerContext.regionName || '').trim();

  const items = buildDeliveryStatusItems(live);
  // delivery_status(오늘자) — extractBusinessDate 가 dateRange 를 참조하므로 당일 범위를 넘긴다.
  const dateRange = { fromDate: collectDate, toDate: collectDate };
  return items.map((item, index) => mapItemToCollectRow(
    'delivery_status',
    item,
    collectDate,
    sourceUrl,
    collectedAt,
    { partnerId, partnerName, regionName, index, dateRange }
  ));
}

/**
 * A 의 슬롯 목표/완료 요약(협력사 단위). 대시보드 "슬롯별 달성률/목표" 용.
 */
function summarizeTodayAggregate(live) {
  const t = live.today || {};
  const perf = t.performance || {};
  const slots = Array.isArray(t.slots) ? t.slots.map((s) => ({
    slot: s.slot,
    goalCount: num(s.goalCount),
    completedCount: num(s.completedCount),
    remainingCount: num(s.remainingCount),
    achievementRate: num(s.achievementRate),
    achievementStatus: s.achievementStatus
  })) : [];
  return {
    serverDatetime: t.serverDatetime || null,
    performance: {
      acceptanceRate: num(perf.acceptanceRate),
      completedCount: num(perf.completedCount),
      inProgressCount: num(perf.inProgressCount),
      rejectedCount: num(perf.rejectedCount),
      canceledCount: num(perf.canceledCount)
    },
    slots,
    offSlot: {
      completedCount: num(t.offSlot && t.offSlot.completedCount),
      riderCount: num(t.offSlot && t.offSlot.riderCount)
    },
    riderOperation: live.riderOperation ? {
      totalCount: num(live.riderOperation.totalCount),
      operatingCount: num(live.riderOperation.operatingCount),
      offlineCount: num(live.riderOperation.offlineCount)
    } : null
  };
}

/**
 * 전 협력사 순회하며 신규 배달현황(A+B+C) 수집·저장.
 *   - 협력사 전환은 selectPartnerCenter(requireSessionChange:false) 사용.
 *     (구 게이트는 폐기된 delivery_status 캡처/CENTER_SESSION 변경에 의존해 오탐 →
 *      UI·/v2/center 가 target 과 일치하면 전환 성공으로 간주하는 기본 경로가 정확.)
 *   - 중단요청(collectProgress.isAbortRequested) 시 현재 협력사 후 정지.
 */
async function collectAllPartnersViaDashboard(page, options = {}) {
  const collectProgress = require('./baemin-collect-progress');
  const centerCtx = require('./baemin-center-context');
  const region = require('./baemin-partner-region');
  const { saveCollectItems } = require('./baemin-collect-pipeline');

  const collectDate = String(options.collectDate || '').slice(0, 10);
  if (!page) {
    return { ok: false, message: 'Playwright 페이지 없음', savedCount: 0, partnerSummaries: [], okCount: 0, partnerTotal: 0 };
  }

  const isValidDp = (id) => /^DP\d{6,}$/.test(String(id || '').trim().toUpperCase());

  let partners = await centerCtx.listPartnerCentersViaPage(page).catch((err) => {
    console.warn('[BREM][배달현황] 협력사 목록 실패:', err.message);
    return [];
  });
  partners = (partners || []).filter((p) => isValidDp(p.partnerId));

  const requested = Array.isArray(options.partnerIds)
    ? options.partnerIds.map((x) => String(x || '').trim().toUpperCase()).filter(isValidDp)
    : [];
  if (requested.length) {
    const want = new Set(requested);
    partners = partners.filter((p) => want.has(String(p.partnerId).trim().toUpperCase()));
  } else {
    const regionMap = await region.readPartnerRegionMap().catch(() => ({}));
    const filtered = region.filterPartnersForCollect(partners, regionMap);
    if (filtered.skipped && filtered.skipped.length) {
      console.log(`[BREM][배달현황] 지역 미등록 ${filtered.skipped.length}곳 생략`);
    }
    partners = filtered.partners;
  }

  if (!partners.length) {
    return { ok: false, message: '수집할 협력사가 없습니다.', savedCount: 0, partnerSummaries: [], okCount: 0, partnerTotal: 0 };
  }

  collectProgress.startCollect({ collectDate, partnerTotal: partners.length, menuLabel: '배달현황(실시간)' });
  collectProgress.updateMenu({ menuId: 'delivery_status', menuLabel: '배달현황' });

  let savedCount = 0;
  const partnerSummaries = [];

  for (let i = 0; i < partners.length; i += 1) {
    if (collectProgress.isAbortRequested()) {
      console.warn(`[BREM][배달현황] 중단 요청 감지 — 정지 (${i}/${partners.length})`);
      break;
    }
    const partner = partners[i];
    const label = `[${i + 1}/${partners.length}] ${partner.partnerName || partner.partnerId}`;
    collectProgress.updatePartner({ index: i + 1, total: partners.length, partnerId: partner.partnerId, partnerName: partner.partnerName });
    try {
      // requireSessionChange:false — UI·/v2/center 가 target 과 일치해야 성공(폐기 API 의존 제거)
      const active = await centerCtx.selectPartnerCenter(page, {
        partnerId: partner.partnerId,
        partnerName: partner.partnerName,
        requireSessionChange: false
      });
      // 전환 교차오염 방지: 활성 협력사가 target 과 다르면 중단
      const activeId = String(active?.partnerId || '').trim().toUpperCase();
      if (activeId && activeId !== String(partner.partnerId).trim().toUpperCase()) {
        throw new Error(`활성 협력사 불일치 (요청 ${partner.partnerId}, 활성 ${activeId})`);
      }

      const liveData = await fetchDashboardLiveViaPage(page, {});
      if (!liveData.riders.length && (liveData.errors || []).length) {
        throw new Error(`수집 실패: ${liveData.errors.slice(0, 3).join(', ')}`);
      }
      const rows = buildDeliveryStatusRows(liveData, partner, { collectDate });
      let saved = 0;
      if (rows.length) {
        const res = await saveCollectItems(rows);
        if (!res.ok) throw new Error(res.message || '저장 실패');
        saved = Number(res.savedCount || 0);
        savedCount += saved;
        collectProgress.addSaved(saved);
      }
      console.log(`[BREM][배달현황] ${label} — 저장 ${saved}건 (라이더 ${liveData.riders.length}, 상세 ${Object.keys(liveData.riderDetails || {}).length})`);
      partnerSummaries.push({ partnerId: partner.partnerId, partnerName: partner.partnerName, ok: true, savedCount: saved });
    } catch (err) {
      console.warn(`[BREM][배달현황] ${label} 실패:`, err.message);
      collectProgress.skipPartner({ index: i + 1, total: partners.length, partnerId: partner.partnerId, partnerName: partner.partnerName, message: `실패: ${err.message}` });
      partnerSummaries.push({ partnerId: partner.partnerId, partnerName: partner.partnerName, ok: false, message: err.message });
    }
  }

  const okCount = partnerSummaries.filter((s) => s.ok).length;
  collectProgress.finishCollect({ ok: okCount > 0, savedTotal: savedCount, message: `배달현황 ${okCount}/${partners.length}곳 · ${savedCount}건` });
  return {
    ok: okCount > 0,
    message: `배달현황 ${okCount}/${partners.length}곳 · ${savedCount}건`,
    savedCount,
    partnerSummaries,
    okCount,
    partnerTotal: partners.length
  };
}

module.exports = {
  API_ORIGIN,
  SLOT_TO_PEAK,
  fetchDashboardLiveViaPage,
  buildDeliveryStatusItems,
  buildDeliveryStatusRows,
  summarizeTodayAggregate,
  collectAllPartnersViaDashboard
};
