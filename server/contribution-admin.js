/**
 * 관리자 기여도 API
 * 규칙: 할당 0 → 달성(또는 슬롯 종료)까지의 콜수 = 기여도. 달성/종료 시 frozen 고정.
 * - 배민: morning/afternoon/evening/midnight 슬롯별 완료콜
 * - 쿠팡: MORNING/LUNCH/POST_LUNCH/DINNER/POST_DINNER 피크별 (소수콜)
 * 크롤 저장 직후 자동 갱신 → 할당 끝나는 순간 고정.
 */
const { verifyAdminCaller } = require('./admin-users');
const { getServiceClient } = require('./admin-bootstrap');
const coupangPipeline = require('./coupang-collect-pipeline');
const {
  SLOT_KEYS,
  SLOT_LABELS,
  computeSlotTargets,
  currentBaeminSlotKey,
  kstHour
} = require('./baemin-quota');
const { readPartnerSetCountMap } = require('./baemin-partner-set-count');
const { readWeekdayQuotaMatrix } = require('./baemin-weekday-quota');
const { PEAK_ORDER, PEAK_LABELS } = require('./coupang-collect-sources');

/** 쿠팡 피크 시작 시각(KST). 다음 피크 시작 전 = 해당 피크 종료 */
const COUPANG_PEAK_START_HOUR = {
  MORNING: 7,
  LUNCH: 11,
  POST_LUNCH: 14,
  DINNER: 17,
  POST_DINNER: 21
};

function todayKst() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, '').toLowerCase();
}

function normalizePhone(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function baeminIdKey(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function slotEnded(date, slotKey, today, currentSlot) {
  if (date < today) return true;
  if (date > today) return false;
  const order = SLOT_KEYS;
  return order.indexOf(slotKey) < order.indexOf(currentSlot);
}

function partnerFromDedupe(dedupeKey) {
  const key = String(dedupeKey || '');
  const m = key.match(/^(DP\d+)/i);
  return m ? m[1] : '';
}

function slotCountFromParsed(parsed, slotKey) {
  const map = {
    morning: ['morningCount', 'completeMorning'],
    afternoon: ['afternoonCount', 'completeAfternoon'],
    evening: ['eveningCount', 'completeEvening'],
    midnight: ['midnightCount', 'completeMidnight']
  }[slotKey] || ['eveningCount', 'completeEvening'];
  return Math.max(0, Math.round(num(parsed[map[0]] ?? parsed[map[1]])));
}

function mapRider(row) {
  const raw = row.raw_data && typeof row.raw_data === 'object' ? row.raw_data : {};
  return {
    id: String(row.id || ''),
    name: String(row.name || '').trim(),
    phone: String(row.phone || raw.phone || '').trim(),
    baeminId: String(row.baemin_id || raw.baeminId || '').trim(),
    regionBaemin: String(raw.regionBaemin || '').trim(),
    regionCoupang: String(raw.regionCoupang || '').trim(),
    status: String(row.status || '').trim()
  };
}

function buildRiderIndexes(riders) {
  const byBaeminId = new Map();
  const byNamePhone = new Map();
  const byName = new Map();
  riders.forEach(rider => {
    const bid = baeminIdKey(rider.baeminId);
    if (bid) byBaeminId.set(bid, rider);
    const name = normalizeName(rider.name);
    const phone4 = normalizePhone(rider.phone).slice(-4);
    if (name && phone4) byNamePhone.set(`${name}|${phone4}`, rider);
    if (name && !byName.has(name)) byName.set(name, rider);
  });
  return { byBaeminId, byNamePhone, byName };
}

async function loadRiders(supabase) {
  const { data, error } = await supabase
    .from('riders')
    .select('id,name,phone,baemin_id,raw_data,status')
    .limit(20000);
  if (error) throw error;
  return (data || [])
    .map(mapRider)
    .filter(r => r.id && String(r.status || '').toLowerCase() !== 'deleted');
}

async function loadBaeminDeliveryRows(supabase, date) {
  const day = String(date || '').slice(0, 10);
  const pageSize = 1000;
  const items = [];
  let offset = 0;
  while (offset < 50000) {
    const { data, error } = await supabase
      .from('baemin_biz_collect_items')
      .select('collect_date,dedupe_key,rider_user_id,rider_name,parsed_json,match_key')
      .eq('source_menu', 'delivery_status')
      .eq('collect_date', day)
      .range(offset, offset + pageSize - 1);
    if (error) {
      if (String(error.message || '').includes('does not exist')) {
        return { ok: false, tableMissing: true, items: [], error: error.message };
      }
      throw error;
    }
    const chunk = data || [];
    items.push(...chunk);
    if (chunk.length < pageSize) break;
    offset += pageSize;
  }
  return { ok: true, items };
}

async function loadFrozenKeys(supabase, date, platform) {
  let q = supabase
    .from('contribution_daily')
    .select('platform,rider_id,slot_key,frozen,score,raw_json')
    .eq('date', date)
    .eq('frozen', true)
    .limit(10000);
  if (platform === 'baemin' || platform === 'coupang') q = q.eq('platform', platform);
  const { data, error } = await q;
  if (error) return new Map();
  const map = new Map();
  (data || []).forEach(row => {
    map.set(`${row.platform}|${row.rider_id}|${row.slot_key || ''}`, row);
  });
  return map;
}

/** 진행중(미고정) 행 — 쿠팡 피크 델타 baseline 유지용 */
async function loadLiveRows(supabase, date, platform) {
  let q = supabase
    .from('contribution_daily')
    .select('platform,rider_id,slot_key,frozen,score,raw_json')
    .eq('date', date)
    .eq('frozen', false)
    .limit(10000);
  if (platform === 'baemin' || platform === 'coupang') q = q.eq('platform', platform);
  const { data, error } = await q;
  if (error) return new Map();
  const map = new Map();
  (data || []).forEach(row => {
    map.set(`${row.platform}|${row.rider_id}|${row.slot_key || ''}`, row);
  });
  return map;
}

function freezeKey(platform, riderId, slotKey) {
  return `${platform}|${riderId}|${slotKey || ''}`;
}

function currentCoupangPeakKey(now = new Date()) {
  const hour = kstHour(now);
  if (hour >= 7 && hour < 11) return 'MORNING';
  if (hour >= 11 && hour < 14) return 'LUNCH';
  if (hour >= 14 && hour < 17) return 'POST_LUNCH';
  if (hour >= 17 && hour < 21) return 'DINNER';
  if (hour >= 21) return 'POST_DINNER';
  // 0~6시: 전날 심야 취급 → 오늘 피크는 아직 시작 전
  return 'MORNING';
}

function coupangPeakEnded(date, peakKey, today, currentPeak) {
  if (date < today) return true;
  if (date > today) return false;
  const hour = kstHour();
  // 새벽(0~6): 오늘 어떤 피크도 아직 안 끝남(아침 대기)
  if (hour < 7) return false;
  const order = PEAK_ORDER;
  return order.indexOf(peakKey) < order.indexOf(currentPeak);
}

function coupangPeakStarted(date, peakKey, today, currentPeak) {
  if (date < today) return true;
  if (date > today) return false;
  const hour = kstHour();
  if (hour < (COUPANG_PEAK_START_HOUR[peakKey] ?? 99)) return false;
  const order = PEAK_ORDER;
  return order.indexOf(peakKey) <= order.indexOf(currentPeak);
}

function baeminSlotStarted(date, slotKey, today, currentSlot) {
  if (date < today) return true;
  if (date > today) return false;
  const order = SLOT_KEYS;
  return order.indexOf(slotKey) <= order.indexOf(currentSlot);
}

/**
 * 배민: 슬롯(타임)별 기여도.
 * - 지역 할당: 세트수 × 요일 할당표 (morning/afternoon/evening/midnight)
 * - 기사 점수: 배달현황 슬롯별 완료콜
 * - 고정: 지역 할당 달성 또는 슬롯 시간 종료. 크롤 저장 직후 자동 갱신.
 */
async function buildBaeminContributionRows(items, indexes, date) {
  const today = todayKst();
  const currentSlot = currentBaeminSlotKey();
  let setCountMap = {};
  let matrix = null;
  try {
    [setCountMap, matrix] = await Promise.all([
      readPartnerSetCountMap(),
      readWeekdayQuotaMatrix()
    ]);
  } catch (_e) {
    setCountMap = {};
    matrix = null;
  }

  const byPartner = new Map();
  (items || []).forEach(item => {
    const partnerId = partnerFromDedupe(item.dedupe_key)
      || String(item.parsed_json?.partnerId || '').trim().toUpperCase();
    if (!partnerId) return;
    if (!byPartner.has(partnerId)) byPartner.set(partnerId, []);
    byPartner.get(partnerId).push(item);
  });

  const rows = [];
  for (const [partnerId, partnerItems] of byPartner.entries()) {
    const setCount = Math.max(1, Math.round(Number(setCountMap?.[partnerId]?.setCount || 1)));
    const targets = computeSlotTargets(setCount, date, matrix);

    const slotRegionComplete = {};
    SLOT_KEYS.forEach(slot => { slotRegionComplete[slot] = 0; });
    partnerItems.forEach(item => {
      const parsed = item.parsed_json || {};
      SLOT_KEYS.forEach(slot => {
        slotRegionComplete[slot] += slotCountFromParsed(parsed, slot);
      });
    });

    SLOT_KEYS.forEach(slotKey => {
      const started = baeminSlotStarted(date, slotKey, today, currentSlot);
      if (!started && date >= today) return;

      const assigned = Math.max(0, Math.round(Number(targets[slotKey] || 0)));
      const regionComplete = Math.max(0, Math.round(slotRegionComplete[slotKey] || 0));
      const achieved = assigned > 0 && regionComplete >= assigned;
      const ended = slotEnded(date, slotKey, today, currentSlot);
      const frozen = Boolean(achieved || ended);
      if (assigned <= 0 && regionComplete <= 0) return;

      const riderBest = new Map();
      partnerItems.forEach(item => {
        const parsed = item.parsed_json || {};
        const score = slotCountFromParsed(parsed, slotKey);
        if (score <= 0) return;
        const crawlUserId = baeminIdKey(
          item.rider_user_id || parsed.userId || parsed.riderId || parsed.rider_user_id || ''
        );
        const riderName = String(item.rider_name || parsed.riderName || parsed.name || '').trim();
        const matched = (crawlUserId && indexes.byBaeminId.get(crawlUserId))
          || indexes.byName.get(normalizeName(riderName))
          || null;
        const riderId = matched?.id
          || (crawlUserId ? `crawl:baemin:${crawlUserId}` : `crawl:baemin:${normalizeName(riderName) || 'unknown'}`);
        const prev = riderBest.get(riderId);
        if (prev && prev.score >= score) return;
        riderBest.set(riderId, {
          date,
          platform: 'baemin',
          region: matched?.regionBaemin || partnerId,
          rider_id: riderId,
          rider_name: matched?.name || riderName || '-',
          score,
          source: 'delivery_status_slot',
          match_key: String(item.match_key || crawlUserId || ''),
          vendor_or_partner: partnerId,
          slot_key: slotKey,
          frozen,
          assigned_target: assigned,
          region_slot_complete: regionComplete,
          raw_json: {
            slotKey,
            slotLabel: SLOT_LABELS[slotKey] || slotKey,
            slotScore: score,
            assigned,
            regionSlotComplete: regionComplete,
            achieved,
            slotEnded: ended,
            rule: '할당0→달성(또는 슬롯종료) 타임별 콜수 고정',
            matched: Boolean(matched)
          },
          updated_at: new Date().toISOString()
        });
      });
      rows.push(...riderBest.values());
    });
  }
  return rows;
}

/**
 * 쿠팡: 피크(타임)별 기여도.
 * - 지역 할당: peak_realtime goal/remaining (피크별)
 * - 기사 점수: LUNCH=lunchPeak, DINNER=dinnerPeak,
 *   그 외(아침/논피크)=해당 피크 시작 시점 completeCount 대비 증가분(델타)
 * - 고정: 지역 잔여 0(달성) 또는 피크 시간 종료. 이미 frozen이면 덮어쓰지 않음.
 */
async function buildCoupangContributionRows(items, indexes, date, peakItems = [], liveMap = new Map()) {
  const today = todayKst();
  const currentPeak = currentCoupangPeakKey();

  // vendor|peak → { goal, remaining, completed, vendorName }
  const peakByVendor = new Map();
  (peakItems || []).forEach(item => {
    const vid = String(item.vendor_id || '').trim();
    const parsed = item.parsed_json || {};
    const peakType = String(parsed.peakType || '').toUpperCase();
    if (!vid || !PEAK_ORDER.includes(peakType)) return;
    const key = `${vid}|${peakType}`;
    const goal = Math.max(0, num(parsed.goalCount));
    const remaining = Math.max(0, num(parsed.remainingCount));
    const completed = Math.max(0, num(parsed.completedCount ?? (goal - remaining)));
    const prev = peakByVendor.get(key);
    if (!prev) {
      peakByVendor.set(key, {
        goal,
        remaining,
        completed,
        vendorName: String(item.vendor_name || parsed.vendorName || '').trim()
      });
      return;
    }
    prev.goal += goal;
    prev.remaining += remaining;
    prev.completed += completed;
  });

  const rows = [];
  const byRiderPeak = new Map();

  (items || []).forEach(item => {
    const parsed = item.parsed_json || {};
    const completeCount = Math.max(0, num(parsed.completeCount));
    const lunchPeak = Math.max(0, num(parsed.lunchPeak));
    const dinnerPeak = Math.max(0, num(parsed.dinnerPeak));
    const courierId = String(item.courier_id || parsed.courierId || '').trim();
    const riderName = String(item.rider_name || parsed.name || parsed.riderName || '').trim();
    const phone = String(item.phone_number || parsed.phone || parsed.phoneNumber || '').trim();
    const matchKey = String(item.match_key || parsed.matchKey || '').trim()
      || `${normalizeName(riderName)}${normalizePhone(phone).slice(-4)}`;
    const name = normalizeName(riderName);
    const phone4 = normalizePhone(phone).slice(-4);
    const matched = (name && phone4 && indexes.byNamePhone.get(`${name}|${phone4}`))
      || indexes.byName.get(name)
      || null;
    const riderId = matched?.id
      || (courierId ? `crawl:coupang:${courierId}` : `crawl:coupang:${matchKey || 'unknown'}`);
    const vendorId = String(item.vendor_id || parsed.vendorId || '').trim();
    if (!vendorId) return;

    PEAK_ORDER.forEach(peakKey => {
      const started = coupangPeakStarted(date, peakKey, today, currentPeak);
      if (!started && date >= today) return;

      const peakStat = peakByVendor.get(`${vendorId}|${peakKey}`) || {
        goal: 0,
        remaining: 0,
        completed: 0,
        vendorName: String(item.vendor_name || parsed.vendorName || '').trim()
      };
      const assigned = Math.max(0, Math.round(peakStat.goal * 10) / 10);
      const regionComplete = Math.max(0, Math.round(peakStat.completed * 10) / 10);
      const achieved = assigned > 0 && peakStat.remaining <= 0;
      const ended = coupangPeakEnded(date, peakKey, today, currentPeak);
      const frozen = Boolean(achieved || ended);

      const liveKey = freezeKey('coupang', riderId, peakKey);
      const existingLive = liveMap.get(liveKey);
      const prevRaw = existingLive?.raw_json && typeof existingLive.raw_json === 'object'
        ? existingLive.raw_json
        : {};

      let score = 0;
      let baseline = null;
      let scoreMode = '';

      if (peakKey === 'LUNCH') {
        score = lunchPeak;
        scoreMode = 'lunchPeak';
      } else if (peakKey === 'DINNER') {
        score = dinnerPeak;
        scoreMode = 'dinnerPeak';
      } else {
        // 아침/논피크: 피크 시작 시점 completeCount 대비 증가분
        if (prevRaw.baselineComplete != null && Number.isFinite(Number(prevRaw.baselineComplete))) {
          baseline = Number(prevRaw.baselineComplete);
        } else {
          baseline = completeCount;
        }
        score = Math.max(0, Math.round((completeCount - baseline) * 10) / 10);
        scoreMode = 'completeDelta';
      }

      // 할당도 없고 기사 콜도 없으면 스킵 (노이즈 방지)
      if (assigned <= 0 && score <= 0 && !existingLive) return;

      const rowKey = `${riderId}|${peakKey}`;
      const prev = byRiderPeak.get(rowKey);
      if (prev && prev.score >= score && prev.frozen === frozen) return;

      byRiderPeak.set(rowKey, {
        date,
        platform: 'coupang',
        region: matched?.regionCoupang
          || peakStat.vendorName
          || String(item.vendor_name || parsed.vendorName || '').trim()
          || vendorId,
        rider_id: riderId,
        rider_name: matched?.name || riderName || '-',
        score,
        source: 'rider_daily_peak',
        match_key: matchKey,
        vendor_or_partner: vendorId,
        slot_key: peakKey,
        frozen,
        assigned_target: assigned,
        region_slot_complete: regionComplete,
        raw_json: {
          peakKey,
          peakLabel: PEAK_LABELS[peakKey] || peakKey,
          scoreMode,
          score,
          completeCount,
          lunchPeak,
          dinnerPeak,
          baselineComplete: baseline,
          assigned,
          regionSlotComplete: regionComplete,
          remaining: peakStat.remaining,
          achieved,
          peakEnded: ended,
          rule: '할당0→달성(또는 피크종료) 타임별 소수콜 고정',
          matched: Boolean(matched),
          courierId
        },
        updated_at: new Date().toISOString()
      });
    });
  });

  rows.push(...byRiderPeak.values());
  return rows;
}

async function upsertRows(supabase, rows, frozenMap) {
  if (!rows.length) return { saved: 0, skippedFrozen: 0 };
  const writable = [];
  let skippedFrozen = 0;
  rows.forEach(row => {
    const key = freezeKey(row.platform, row.rider_id, row.slot_key);
    const existing = frozenMap.get(key);
    if (existing && existing.frozen) {
      skippedFrozen += 1;
      return;
    }
    writable.push(row);
  });
  if (!writable.length) return { ok: true, saved: 0, skippedFrozen };

  const CHUNK = 200;
  let saved = 0;
  for (let i = 0; i < writable.length; i += CHUNK) {
    const chunk = writable.slice(i, i + CHUNK);
    const { error } = await supabase
      .from('contribution_daily')
      .upsert(chunk, { onConflict: 'date,platform,rider_id,slot_key' });
    if (error) {
      // v1 유니크만 있는 경우 폴백
      if (String(error.message || '').includes('contribution_daily_uniq')
        || String(error.message || '').includes('slot_key')
        || String(error.message || '').includes('frozen')) {
        const legacy = chunk.map(row => {
          const copy = { ...row };
          delete copy.slot_key;
          delete copy.frozen;
          delete copy.assigned_target;
          delete copy.region_slot_complete;
          return copy;
        });
        const retry = await supabase
          .from('contribution_daily')
          .upsert(legacy, { onConflict: 'date,platform,rider_id' });
        if (retry.error) {
          return {
            ok: false,
            saved,
            skippedFrozen,
            error: `${error.message} / legacy: ${retry.error.message}. supabase/contribution_daily_v2_slot_freeze.sql 을 실행하세요.`
          };
        }
        saved += legacy.length;
        continue;
      }
      if (String(error.message || '').includes('does not exist') || error.code === '42P01') {
        return {
          ok: false,
          tableMissing: true,
          saved,
          skippedFrozen,
          error: 'contribution_daily 테이블이 없습니다. migration SQL을 실행하세요.'
        };
      }
      return { ok: false, saved, skippedFrozen, error: error.message || '기여도 저장 실패' };
    }
    saved += chunk.length;
  }
  return { ok: true, saved, skippedFrozen };
}

async function refreshSnapshotCore(options = {}) {
  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const date = String(options.date || todayKst()).slice(0, 10);
  const platform = String(options.platform || 'all').trim().toLowerCase();
  const riders = await loadRiders(supabase);
  const indexes = buildRiderIndexes(riders);
  const [frozenMap, liveMap] = await Promise.all([
    loadFrozenKeys(supabase, date, platform),
    loadLiveRows(supabase, date, platform)
  ]);

  const rows = [];
  const summary = { baemin: 0, coupang: 0, frozen: 0, live: 0, errors: [] };

  if (platform === 'all' || platform === 'baemin') {
    try {
      const bae = await loadBaeminDeliveryRows(supabase, date);
      if (bae.tableMissing) {
        summary.errors.push('배민 수집 테이블 없음');
      } else {
        const built = await buildBaeminContributionRows(bae.items || [], indexes, date);
        rows.push(...built);
        summary.baemin = built.length;
      }
    } catch (error) {
      summary.errors.push(`배민: ${error.message || error}`);
    }
  }

  if (platform === 'all' || platform === 'coupang') {
    try {
      const [riderRes, peakRes] = await Promise.all([
        coupangPipeline.readCollectItems('rider_daily', date, { limit: 30000 }),
        coupangPipeline.readCollectItems('peak_realtime', date, { limit: 10000 })
      ]);
      if (!riderRes.ok) {
        summary.errors.push(riderRes.message || riderRes.error || '쿠팡 라이더 조회 실패');
      } else {
        const built = await buildCoupangContributionRows(
          riderRes.items || [],
          indexes,
          date,
          peakRes.ok ? (peakRes.items || []) : [],
          liveMap
        );
        rows.push(...built);
        summary.coupang = built.length;
      }
    } catch (error) {
      summary.errors.push(`쿠팡: ${error.message || error}`);
    }
  }

  summary.frozen = rows.filter(r => r.frozen).length;
  summary.live = rows.filter(r => !r.frozen).length;

  const saved = await upsertRows(supabase, rows, frozenMap);
  if (saved.ok === false) {
    return {
      ok: false,
      status: saved.tableMissing ? 503 : 500,
      error: saved.error,
      tableMissing: Boolean(saved.tableMissing),
      summary
    };
  }

  return {
    ok: true,
    date,
    saved: saved.saved,
    skippedFrozen: saved.skippedFrozen || 0,
    summary,
    message: `${date} 기여도 저장 ${saved.saved}건 · 고정 ${summary.frozen} · 진행중 ${summary.live}`
      + (saved.skippedFrozen ? ` · 이미고정유지 ${saved.skippedFrozen}` : '')
      + ' (할당0→달성/슬롯종료 고정)'
  };
}

async function refreshSnapshot(accessToken, options = {}) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;
  return refreshSnapshotCore(options);
}

/** 수집 직후 백그라운드 갱신. 같은 날짜·플랫폼은 최소 간격으로 스로틀 */
const lastAutoRefreshAt = new Map();
const AUTO_REFRESH_GAP_MS = 20 * 1000;

function scheduleAutoRefresh(options = {}) {
  const date = String(options.date || todayKst()).slice(0, 10);
  const platform = String(options.platform || 'all').trim().toLowerCase();
  const key = `${date}|${platform}`;
  const now = Date.now();
  const prev = lastAutoRefreshAt.get(key) || 0;
  if (now - prev < AUTO_REFRESH_GAP_MS) return;
  lastAutoRefreshAt.set(key, now);
  setTimeout(() => {
    refreshSnapshotCore({ date, platform }).catch(err => {
      console.warn('[contribution] auto refresh failed:', err?.message || err);
    });
  }, 1500);
}

async function listDaily(accessToken, options = {}) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const date = String(options.date || todayKst()).slice(0, 10);
  const platform = String(options.platform || 'all').trim().toLowerCase();
  const region = String(options.region || '').trim();
  const keyword = String(options.keyword || '').trim().toLowerCase();

  let q = supabase
    .from('contribution_daily')
    .select('date,platform,region,rider_id,rider_name,score,source,match_key,vendor_or_partner,slot_key,frozen,assigned_target,region_slot_complete,raw_json,updated_at')
    .eq('date', date)
    .order('score', { ascending: false })
    .limit(5000);

  if (platform === 'baemin' || platform === 'coupang') {
    q = q.eq('platform', platform);
  }
  if (region) {
    q = q.ilike('region', `%${region}%`);
  }

  const { data, error } = await q;
  if (error) {
    // v1 컬럼만 있는 경우
    if (String(error.message || '').includes('slot_key') || String(error.message || '').includes('frozen')) {
      const fallback = await supabase
        .from('contribution_daily')
        .select('date,platform,region,rider_id,rider_name,score,source,match_key,vendor_or_partner,raw_json,updated_at')
        .eq('date', date)
        .order('score', { ascending: false })
        .limit(5000);
      if (fallback.error) {
        return { ok: false, status: 500, error: fallback.error.message };
      }
      return {
        ok: true,
        date,
        items: fallback.data || [],
        totals: summarize(fallback.data || []),
        needsV2Migration: true,
        message: 'v2 슬롯고정 컬럼이 없습니다. contribution_daily_v2_slot_freeze.sql 을 실행하세요.'
      };
    }
    if (String(error.message || '').includes('does not exist') || error.code === '42P01') {
      return {
        ok: false,
        status: 503,
        tableMissing: true,
        error: 'contribution_daily 테이블이 없습니다. migration SQL을 실행하세요.'
      };
    }
    return { ok: false, status: 500, error: error.message || '기여도 조회 실패' };
  }

  let items = data || [];
  if (keyword) {
    items = items.filter(row => [
      row.rider_name,
      row.region,
      row.match_key,
      row.rider_id,
      row.slot_key
    ].join(' ').toLowerCase().includes(keyword));
  }

  return {
    ok: true,
    date,
    items,
    totals: summarize(items),
    tableReady: true
  };
}

function summarize(items) {
  return (items || []).reduce((acc, row) => {
    acc.count += 1;
    acc.scoreSum += num(row.score);
    if (row.platform === 'baemin') acc.baemin += 1;
    if (row.platform === 'coupang') acc.coupang += 1;
    if (row.frozen) acc.frozen += 1;
    else acc.live += 1;
    return acc;
  }, { count: 0, scoreSum: 0, baemin: 0, coupang: 0, frozen: 0, live: 0 });
}

module.exports = {
  refreshSnapshot,
  refreshSnapshotCore,
  scheduleAutoRefresh,
  listDaily,
  todayKst
};
