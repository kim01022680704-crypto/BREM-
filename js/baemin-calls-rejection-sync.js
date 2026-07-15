/**
 * 배민현황 → 콜수 입력 / 거절율 입력 동기화
 * - 배민ID 매칭
 * - 수동·ERP 거절율 보호
 * - 로그인/스키마 변경 없음 (기존 BremStorage API만 사용)
 */
(function () {
  const PROTECTED_REJECTION_SOURCES = new Set(['manual', 'erp-bulk', 'erp']);
  const SYNC_SOURCE_PAST = 'baemin_biz_sync';
  const SYNC_SOURCE_LIVE = 'baemin_biz_live';

  const state = {
    lastUnmatched: [],
    lastPreview: null,
    lastCoverageRows: [],
    running: false
  };

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString('ko-KR');
  }

  function normalizeBaeminId(value) {
    if (window.BremWeeklySettlement?.normalizeBaeminUserId) {
      return String(BremWeeklySettlement.normalizeBaeminUserId(value) || '').trim();
    }
    const raw = String(value || '').trim();
    if (/^\d+(\.0+)?$/.test(raw)) return String(Math.round(Number(raw)));
    return raw;
  }

  function getDrivers() {
    return window.BremStorage?.drivers?.getAll?.() || [];
  }

  function matchDriverByBaeminId(baeminId) {
    const id = normalizeBaeminId(baeminId);
    if (!id) return null;
    if (window.BremDriverUtils?.matchDriverByBaeminErpId) {
      return BremDriverUtils.matchDriverByBaeminErpId(id, getDrivers()) || null;
    }
    return getDrivers().find(driver => normalizeBaeminId(driver.baeminId) === id) || null;
  }

  function resolveRiderBusinessDate(row = {}) {
    const parts = String(row.dedupe_key || '').split(':');
    const a = String(parts[1] || '').slice(0, 10);
    const b = String(parts[2] || '').slice(0, 10);
    // 하루키(DP:배달일:riderId:rider) — dedupe 배달일 우선 (parsed 오염 방지)
    const isPerDay = parts.length >= 4
      && parts[parts.length - 1] === 'rider'
      && /^\d{4}-\d{2}-\d{2}$/.test(a);
    if (isPerDay) return { date: a, period: false };

    // 기간합산 키(DP:from:to:riderId) — 단일 배달일 없음
    if (/^\d{4}-\d{2}-\d{2}$/.test(a) && /^\d{4}-\d{2}-\d{2}$/.test(b) && a !== b) {
      return { date: '', period: true, periodFrom: a, periodTo: b };
    }

    const parsed = row.parsed_json || {};
    const fromParsed = String(parsed.businessDate || parsed.deliveryDate || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(fromParsed)) {
      return { date: fromParsed, period: false };
    }
    for (const part of parts) {
      const day = String(part || '').slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return { date: day, period: false };
    }
    return { date: '', period: false };
  }

  function extractMetrics(parsed = {}) {
    return {
      complete: Math.max(0, Number(parsed.totalComplete || parsed.completeCount || 0) || 0),
      foodReject: Math.max(0, Number(parsed.foodReject || 0) || 0),
      foodCancel: Math.max(0, Number(parsed.foodCancel || 0) || 0),
      foodRiderFault: Math.max(0, Number(parsed.foodRiderFault || 0) || 0)
    };
  }

  function mergeMetrics(a = {}, b = {}) {
    return {
      complete: Number(a.complete || 0) + Number(b.complete || 0),
      foodReject: Number(a.foodReject || 0) + Number(b.foodReject || 0),
      foodCancel: Number(a.foodCancel || 0) + Number(b.foodCancel || 0),
      foodRiderFault: Number(a.foodRiderFault || 0) + Number(b.foodRiderFault || 0)
    };
  }

  function calcAcceptRate(metrics = {}) {
    const complete = Number(metrics.complete || 0);
    const deny = Number(metrics.foodReject || 0)
      + Number(metrics.foodCancel || 0)
      + Number(metrics.foodRiderFault || 0);
    const denom = complete + deny;
    if (denom <= 0) return null;
    return Math.round((100 - (deny / denom) * 100) * 10) / 10;
  }

  function isProtectedRejectionSource(source) {
    const s = String(source || 'manual').trim().toLowerCase() || 'manual';
    return PROTECTED_REJECTION_SOURCES.has(s);
  }

  function renderResultRows(rows) {
    const tbody = $('baeminStatusSyncRows');
    const summary = $('baeminStatusSyncSummary');
    if (!tbody) return;
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="form-help">결과가 없습니다.</td></tr>';
      return;
    }
    const ok = rows.filter(r => r.status === 'ok').length;
    const fail = rows.filter(r => r.status !== 'ok').length;
    if (summary) {
      summary.textContent = `성공 ${formatNumber(ok)} · 실패/스킵 ${formatNumber(fail)} · 총 ${formatNumber(rows.length)}`;
    }
    tbody.innerHTML = rows.map(row => `<tr>
      <td>${escapeHtml(row.kind || '-')}</td>
      <td>${escapeHtml(row.riderName || '-')}</td>
      <td>${escapeHtml(row.baeminId || '-')}</td>
      <td>${escapeHtml(row.driverLabel || '-')}</td>
      <td>${escapeHtml(row.statusLabel || row.status || '-')}</td>
      <td>${escapeHtml(row.reason || '-')}</td>
      <td>${escapeHtml(row.detail || '-')}</td>
    </tr>`).join('');
  }

  function mergeCoverageMaps(...maps) {
    const out = new Map();
    maps.forEach(map => {
      if (!map) return;
      map.forEach((row, key) => {
        const prev = out.get(key);
        if (!prev) {
          out.set(key, { ...row });
          return;
        }
        prev.rowCount = Number(prev.rowCount || 0) + Number(row.rowCount || 0);
        prev.complete = Number(prev.complete || 0) + Number(row.complete || 0);
        if (row.status === 'ok' || (prev.status !== 'ok' && row.status === 'fail')) {
          prev.status = row.status;
          prev.statusLabel = row.statusLabel;
        }
        if (row.kind && prev.kind && !String(prev.kind).includes(row.kind)) {
          prev.kind = `${prev.kind}+${row.kind}`;
        } else if (row.kind) {
          prev.kind = prev.kind || row.kind;
        }
        if (row.regionLabel) prev.regionLabel = row.regionLabel;
      });
    });
    return out;
  }

  function renderCoverageRows(coverageMap) {
    const el = $('baeminStatusSyncCoverageResult');
    const summary = $('baeminStatusSyncCoverageSummary');
    if (!el) return;

    const rows = [...(coverageMap?.values?.() || coverageMap || [])]
      .filter(Boolean)
      .sort((a, b) => {
        const dateDiff = String(a.date || a.weekStart || '').localeCompare(String(b.date || b.weekStart || ''));
        if (dateDiff) return dateDiff;
        return String(a.regionLabel || a.partnerId || '').localeCompare(String(b.regionLabel || b.partnerId || ''), 'ko');
      });

    state.lastCoverageRows = rows;

    if (!rows.length) {
      el.innerHTML = '<p class="form-help">날짜·지역 반영 대상이 없습니다. 라이더별 배달내역(일별) 수집·저장 후 다시 시도하세요.</p>';
      if (summary) summary.textContent = '반영 결과 없음';
      return;
    }

    const okCount = rows.filter(r => r.status === 'ok').length;
    const failCount = rows.length - okCount;
    if (summary) {
      summary.textContent = `반영완료 ${formatNumber(okCount)} · 미반영/실패 ${formatNumber(failCount)} · 총 ${formatNumber(rows.length)}`;
    }

    el.innerHTML = `
      <div class="baemin-coverage-table-wrap">
        <table class="baemin-coverage-table">
          <thead>
            <tr>
              <th>구분</th>
              <th>날짜</th>
              <th>지역</th>
              <th>결과</th>
              <th>건수</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(row => {
              const dateLabel = row.date || (row.weekStart ? `정산주 ${row.weekStart}` : '-');
              const isOk = row.status === 'ok';
              return `<tr class="${isOk ? 'is-ok' : 'is-missing'}">
                <td>${escapeHtml(row.kind || '-')}</td>
                <td>${escapeHtml(dateLabel)}</td>
                <td>${escapeHtml(row.regionLabel || row.partnerId || '-')}</td>
                <td class="${isOk ? 'status-ok' : 'status-missing'}">${escapeHtml(row.statusLabel || (isOk ? '반영완료' : '미반영'))}</td>
                <td>${row.rowCount > 0 ? formatNumber(row.rowCount) : (row.complete > 0 ? formatNumber(row.complete) : '-')}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <p class="baemin-rider-day-results__meta">
        라이더별 배달내역 기준 · 반영완료 ${formatNumber(okCount)} · 미반영/실패 ${formatNumber(failCount)}
      </p>
    `;
  }

  function setButtonsLoading(loading, label) {
    const ids = [
      'baeminSyncCallsBtn', 'baeminSyncRejectionPastBtn', 'baeminSyncAllBtn', 'baeminSyncRejectionLiveBtn',
      'baeminSyncCallsBtn2', 'baeminSyncRejectionPastBtn2', 'baeminSyncAllBtn2', 'baeminSyncRejectionLiveBtn2',
      'baeminSyncRematchBtn'
    ];
    ids.forEach(id => {
      const btn = $(id);
      if (!btn) return;
      btn.disabled = Boolean(loading);
      if (loading && label && (id.includes('All') || id.includes('Calls') || id.includes('Rejection') || id.includes('Live'))) {
        if (!btn.dataset.defaultLabel) btn.dataset.defaultLabel = btn.textContent;
        btn.textContent = label;
      } else if (!loading && btn.dataset.defaultLabel) {
        btn.textContent = btn.dataset.defaultLabel;
      }
    });
  }

  function showToast(message) {
    if (window.BremBaeminDeliveryStatusAdmin?.showToast) {
      window.BremBaeminDeliveryStatusAdmin.showToast(message);
      return;
    }
    document.dispatchEvent(new CustomEvent('brem-admin-toast', { detail: { message } }));
  }

  async function fetchSyncContext() {
    const host = window.BremBaeminDeliveryStatusAdmin;
    if (!host?.getSyncContext) {
      throw new Error('배민현황 모듈이 준비되지 않았습니다.');
    }
    return host.getSyncContext();
  }

  async function runCallsSync(ctx) {
    const results = [];
    const coverage = new Map(); // `${partnerId}|${date}`
    state._lastCallsCoverage = coverage;

    const touchCoverage = (item, patch = {}) => {
      const partnerId = String(item.partnerId || '').trim().toUpperCase();
      const date = String(item.date || '').slice(0, 10);
      if (!partnerId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
      const key = `${partnerId}|${date}`;
      const prev = coverage.get(key) || {
        kind: '콜수',
        date,
        partnerId,
        regionLabel: item.regionLabel || partnerId,
        rowCount: 0,
        complete: 0,
        matched: 0,
        status: 'missing',
        statusLabel: '미반영'
      };
      if (item.regionLabel) prev.regionLabel = item.regionLabel;
      Object.assign(prev, patch);
      coverage.set(key, prev);
      return prev;
    };

    const items = Array.isArray(ctx.riderItems) ? ctx.riderItems : [];
    if (!items.length) {
      return [{
        kind: '콜수',
        status: 'fail',
        statusLabel: '실패',
        reason: '라이더별 배달내역 없음',
        detail: ctx.riderHint || 'BIZ에서 라이더 수집 후 [배민현황 저장]을 실행하세요.'
      }];
    }

    const dated = items.map(row => {
      const partnerId = String(
        row.parsed_json?.partnerId
        || String(row.dedupe_key || '').split(':')[0]
        || ''
      ).trim().toUpperCase();
      const resolved = resolveRiderBusinessDate(row);
      return {
        row,
        date: resolved.date,
        isPeriod: Boolean(resolved.period),
        periodFrom: resolved.periodFrom || '',
        periodTo: resolved.periodTo || '',
        baeminId: normalizeBaeminId(row.rider_user_id),
        complete: extractMetrics(row.parsed_json).complete,
        riderName: row.rider_name || '',
        partnerId: /^DP\d{6,}$/.test(partnerId) ? partnerId : '',
        regionLabel: row.parsed_json?.displayName || row.parsed_json?.regionName || partnerId || ''
      };
    });

    const periodOnly = dated.filter(item => item.isPeriod && item.complete > 0);
    // 콜수는 날짜별만 — 기간합은 시작일 몰아넣기 금지
    const dailyRows = dated.filter(item => !item.isPeriod && item.date && item.complete > 0);

    if (periodOnly.length) {
      results.push({
        kind: '콜수',
        status: 'fail',
        statusLabel: '경고',
        reason: '기간합 행 제외',
        detail: `${periodOnly.length}건은 일별 키가 아니라 기간합이라 콜수에 넣지 않았습니다. 해당 기간 라이더 일별 재수집 후 [배민현황 저장]하세요.`
      });
    }

    if (!dailyRows.length) {
      return results.concat([{
        kind: '콜수',
        status: 'fail',
        statusLabel: '실패',
        reason: '일별 라이더 내역 없음',
        detail: '날짜별(하루) 키가 없습니다. BIZ 라이더별 배달내역을 일별로 수집·저장한 뒤 다시 시도하세요.'
      }]);
    }

    const byDayDriver = new Map();
    const unmatched = [];
    const riderDayMap = new Map(); // baeminId -> { name, dates:Set, total }
    const datePartnerKeys = new Map(); // date -> Set(coverage keys with matched)

    dailyRows.forEach(item => {
      const covBase = touchCoverage(item);
      if (covBase) {
        covBase.rowCount = Number(covBase.rowCount || 0) + 1;
        covBase.complete = Number(covBase.complete || 0) + item.complete;
      }

      if (item.baeminId) {
        const track = riderDayMap.get(item.baeminId) || {
          riderName: item.riderName,
          dates: new Set(),
          total: 0
        };
        track.dates.add(item.date);
        track.total += item.complete;
        if (item.riderName) track.riderName = item.riderName;
        riderDayMap.set(item.baeminId, track);
      }

      if (!item.baeminId) {
        results.push({
          kind: '콜수',
          riderName: item.riderName,
          baeminId: '',
          status: 'fail',
          statusLabel: '실패',
          reason: '배민ID 없음',
          detail: `${item.regionLabel || '-'} · ${item.date}`
        });
        return;
      }
      const driver = matchDriverByBaeminId(item.baeminId);
      if (!driver?.id) {
        unmatched.push(item);
        results.push({
          kind: '콜수',
          riderName: item.riderName,
          baeminId: item.baeminId,
          status: 'fail',
          statusLabel: '미매칭',
          reason: '기사 배민ID 미등록',
          detail: `${item.regionLabel || '-'} · ${item.date} · 완료 ${item.complete}`
        });
        return;
      }

      const cov = touchCoverage(item);
      if (cov) {
        cov.matched = Number(cov.matched || 0) + 1;
        if (!datePartnerKeys.has(item.date)) datePartnerKeys.set(item.date, new Set());
        datePartnerKeys.get(item.date).add(`${item.partnerId}|${item.date}`);
      }

      // 콜수 입력과 동일: 기사×날짜 1건 (같은 날 중복 지역 행은 합산)
      const key = `${driver.id}|${item.date}`;
      const prev = byDayDriver.get(key) || {
        driverId: driver.id,
        driverName: driver.name || '',
        date: item.date,
        baeminId: item.baeminId,
        riderName: item.riderName,
        regionLabel: item.regionLabel || '',
        count: 0
      };
      prev.count += item.complete;
      if (item.regionLabel) prev.regionLabel = item.regionLabel;
      byDayDriver.set(key, prev);
    });

    // 같은 동기화 데이터에 있는 날짜 중, 특정 라이더만 빠진 날 경고
    // (달력 전체 대비가 아니라, 실제 저장된 일별 키 기준 — 운휴일은 오탐 없음)
    const daysInData = [...new Set(dailyRows.map(item => item.date))].sort();
    if (daysInData.length >= 2) {
      const gapSamples = [];
      riderDayMap.forEach((track, baeminId) => {
        if (track.dates.size >= daysInData.length) return;
        const missing = daysInData.filter(day => !track.dates.has(day));
        if (!missing.length) return;
        gapSamples.push({
          baeminId,
          riderName: track.riderName,
          have: [...track.dates].sort(),
          missing,
          total: track.total
        });
      });
      if (gapSamples.length) {
        const sample = gapSamples
          .slice(0, 5)
          .map(g => `${g.riderName || g.baeminId}: ${g.have.join(',')} (합${g.total}) · 없음 ${g.missing.join(',')}`)
          .join(' / ');
        results.push({
          kind: '콜수',
          status: 'fail',
          statusLabel: '경고',
          reason: `일별 키 누락 ${gapSamples.length}명`,
          detail: `저장된 일별 날짜 ${daysInData.join(',')} 중 일부만 있는 라이더: ${sample}`
            + (gapSamples.length > 5 ? ` 외 ${gapSamples.length - 5}명` : '')
            + ' → 해당일 BIZ 재수집·[배민현황 저장] 후 다시 동기화 (합계가 BIZ보다 적을 수 있음)'
        });
      }
    }

    state.lastUnmatched = unmatched.map(item => ({
      kind: '콜수',
      baeminId: item.baeminId,
      riderName: item.riderName,
      date: item.date,
      complete: item.complete,
      regionLabel: item.regionLabel
    }));

    // 날짜별 배치 저장 (콜수 입력 메뉴와 동일 API)
    const byDate = new Map();
    [...byDayDriver.values()].forEach(entry => {
      if (!byDate.has(entry.date)) byDate.set(entry.date, []);
      byDate.get(entry.date).push(entry);
    });

    for (const [date, records] of byDate.entries()) {
      const keys = datePartnerKeys.get(date) || new Set();
      try {
        await BremStorage.calls.upsertBatchDaily({
          date,
          platform: 'baemin',
          records: records.map(r => ({ driverId: r.driverId, count: r.count }))
        });
        keys.forEach(key => {
          const row = coverage.get(key);
          if (!row) return;
          row.status = 'ok';
          row.statusLabel = '반영완료';
        });
        records.forEach(r => {
          results.push({
            kind: '콜수',
            riderName: r.riderName,
            baeminId: r.baeminId,
            driverLabel: r.driverName || r.driverId,
            status: 'ok',
            statusLabel: '성공',
            reason: '',
            detail: `${r.regionLabel || '전지역'} · ${date} · 완료 ${formatNumber(r.count)}건 → 콜수 입력`
          });
        });
      } catch (error) {
        keys.forEach(key => {
          const row = coverage.get(key);
          if (!row) return;
          row.status = 'fail';
          row.statusLabel = '반영실패';
        });
        records.forEach(r => {
          results.push({
            kind: '콜수',
            riderName: r.riderName,
            baeminId: r.baeminId,
            driverLabel: r.driverName || r.driverId,
            status: 'fail',
            statusLabel: '실패',
            reason: error.message || '콜수 저장 실패',
            detail: `${r.regionLabel || '-'} · ${date}`
          });
        });
      }
    }

    dated.filter(item => !item.isPeriod && !item.date && item.complete > 0).forEach(item => {
      results.push({
        kind: '콜수',
        riderName: item.riderName,
        baeminId: item.baeminId,
        status: 'fail',
        statusLabel: '실패',
        reason: '배달일 없음',
        detail: '일별 키/배달일을 확인할 수 없습니다.'
      });
    });

    return results;
  }

  async function runRejectionSync(ctx, mode) {
    const results = [];
    const coverage = new Map(); // `${partnerId||region}|${weekStart}`
    state._lastRejectionCoverage = coverage;
    const useLive = mode === 'live';
    const kind = useLive ? '거절율(실시간)' : '거절율(주별)';
    const source = useLive ? SYNC_SOURCE_LIVE : SYNC_SOURCE_PAST;
    const rows = Array.isArray(ctx.acceptRows) ? ctx.acceptRows : [];
    const weekStarts = Array.isArray(ctx.weekStarts) && ctx.weekStarts.length
      ? ctx.weekStarts
      : (ctx.weekStart ? [ctx.weekStart] : []);

    const touchCoverage = (row, patch = {}) => {
      const partnerId = String(row.partnerId || '').trim().toUpperCase();
      const weekStart = String(row.weekStart || '').slice(0, 10);
      const regionLabel = row.regionLabel || partnerId || '전지역';
      if (!weekStart) return null;
      const key = `${partnerId || regionLabel}|${weekStart}`;
      const prev = coverage.get(key) || {
        kind,
        weekStart,
        date: '',
        partnerId,
        regionLabel,
        rowCount: 0,
        complete: 0,
        matched: 0,
        status: 'missing',
        statusLabel: '미반영'
      };
      if (regionLabel) prev.regionLabel = regionLabel;
      Object.assign(prev, patch);
      coverage.set(key, prev);
      return { key, row: prev };
    };

    if (!weekStarts.length) {
      return [{
        kind,
        status: 'fail',
        statusLabel: '실패',
        reason: '정산주 없음',
        detail: '선택 기간에서 수요일 주를 찾을 수 없습니다.'
      }];
    }
    if (!rows.length) {
      return [{
        kind,
        status: 'fail',
        statusLabel: '실패',
        reason: '수락율 데이터 없음',
        detail: `${ctx.fromDate || ''} ~ ${ctx.toDate || ''} 라이더 내역을 확인하세요.`
      }];
    }

    // 실시간: 이번주만 / 주별: 선택 기간의 모든 정산주
    const targetWeeks = useLive
      ? (ctx.currentWeekStart && weekStarts.includes(ctx.currentWeekStart)
        ? [ctx.currentWeekStart]
        : [])
      : weekStarts;
    if (useLive && !targetWeeks.length) {
      return [{
        kind,
        status: 'fail',
        statusLabel: '실패',
        reason: '이번주가 선택 기간에 없음',
        detail: '실시간 입력은 종료일에 이번주가 포함되어야 합니다.'
      }];
    }
    const filtered = rows.filter(row => targetWeeks.includes(row.weekStart));

    const entries = [];
    const unmatched = [];
    const successKeys = new Set();

    filtered.forEach(row => {
      const baeminId = normalizeBaeminId(row.riderUserId || row.baeminId);
      const weekStart = row.weekStart || ctx.weekStart;
      const rate = useLive ? row.currentRate : row.pastRate;
      const metrics = useLive ? (row.current || row.past || {}) : (row.past || {});
      const covTouch = touchCoverage({ ...row, weekStart });
      if (covTouch) {
        covTouch.row.rowCount = Number(covTouch.row.rowCount || 0) + 1;
      }
      if (rate == null || !Number.isFinite(Number(rate))) {
        results.push({
          kind,
          riderName: row.riderName,
          baeminId,
          status: 'fail',
          statusLabel: '스킵',
          reason: '수락율 미집계',
          detail: `정산주 ${weekStart}`
        });
        return;
      }
      if (!baeminId) {
        results.push({
          kind,
          riderName: row.riderName,
          baeminId: '',
          status: 'fail',
          statusLabel: '실패',
          reason: '배민ID 없음',
          detail: weekStart
        });
        return;
      }
      const driver = matchDriverByBaeminId(baeminId);
      if (!driver?.id) {
        unmatched.push({ baeminId, riderName: row.riderName, rate, weekStart });
        results.push({
          kind,
          riderName: row.riderName,
          baeminId,
          status: 'fail',
          statusLabel: '미매칭',
          reason: '기사 배민ID 미등록',
          detail: `정산주 ${weekStart} · 수락율 ${rate}%`
        });
        return;
      }

      const existing = BremStorage.rejections.getEntryForWeek?.(driver.id, weekStart, 'baemin');
      if (existing && isProtectedRejectionSource(existing.source)) {
        results.push({
          kind,
          riderName: row.riderName,
          baeminId,
          driverLabel: driver.name || driver.id,
          status: 'fail',
          statusLabel: '보호',
          reason: `기존 ${existing.source} 유지`,
          detail: `정산주 ${weekStart} · 수동/ERP 보호 (${existing.rate}%)`
        });
        return;
      }

      if (covTouch) {
        covTouch.row.matched = Number(covTouch.row.matched || 0) + 1;
        successKeys.add(covTouch.key);
      }

      entries.push({
        driverId: driver.id,
        weekStart,
        platform: 'baemin',
        rate: Number(rate),
        source,
        stats: {
          completeTotal: metrics.complete || 0,
          rejectCount: metrics.foodReject || 0,
          dispatchCancelCount: metrics.foodCancel || 0,
          riderCancelCount: metrics.foodRiderFault || 0,
          rejectByService: { food: metrics.foodReject || 0 },
          dispatchCancelByService: { food: metrics.foodCancel || 0 },
          riderFaultByService: { food: metrics.foodRiderFault || 0 },
          pastAcceptRate: row.pastRate,
          currentAcceptRate: row.currentRate,
          unmeasured: false
        },
        _meta: {
          riderName: row.riderName,
          baeminId,
          driverName: driver.name || driver.id,
          regionLabel: row.regionLabel || '',
          coverageKey: covTouch?.key || ''
        }
      });
    });

    state.lastUnmatched = [
      ...(state.lastUnmatched || []),
      ...unmatched.map(item => ({ kind, ...item }))
    ];

    if (entries.length) {
      try {
        await BremStorage.rejections.upsertWeeklyBatch(entries.map(({ _meta, ...rest }) => rest));
        successKeys.forEach(key => {
          const row = coverage.get(key);
          if (!row) return;
          row.status = 'ok';
          row.statusLabel = '반영완료';
        });
        entries.forEach(entry => {
          results.push({
            kind,
            riderName: entry._meta.riderName,
            baeminId: entry._meta.baeminId,
            driverLabel: entry._meta.driverName,
            status: 'ok',
            statusLabel: '성공',
            reason: '',
            detail: `${entry._meta.regionLabel || '전지역'} · 정산주 ${entry.weekStart} · 수락율 ${entry.rate}% → 거절율 입력`
          });
        });
      } catch (error) {
        successKeys.forEach(key => {
          const row = coverage.get(key);
          if (!row) return;
          row.status = 'fail';
          row.statusLabel = '반영실패';
        });
        entries.forEach(entry => {
          results.push({
            kind,
            riderName: entry._meta.riderName,
            baeminId: entry._meta.baeminId,
            driverLabel: entry._meta.driverName,
            status: 'fail',
            statusLabel: '실패',
            reason: error.message || '거절율 저장 실패',
            detail: entry.weekStart
          });
        });
      }
    }

    return results;
  }

  async function run(mode) {
    if (state.running) {
      showToast('이미 동기화 중입니다.');
      return;
    }
    const host = window.BremBaeminDeliveryStatusAdmin;
    if (!host?.adminApi) {
      showToast('배민현황을 먼저 열어 주세요.');
      return;
    }

    state.running = true;
    state.lastUnmatched = [];
    state._lastCallsCoverage = new Map();
    state._lastRejectionCoverage = new Map();
    const labels = {
      calls: '콜수 입력 중…',
      rejection_past: '거절율 입력 중…',
      rejection_live: '실시간 입력 중…',
      all: '모두 입력 중…'
    };
    setButtonsLoading(true, labels[mode] || '동기화 중…');
    const meta = $('baeminStatusSyncResultMeta');

    try {
      await BremStorage.ensureSectionLoaded?.('calls');
      await BremStorage.ensureSectionLoaded?.('rejections');

      const ctx = await fetchSyncContext();
      if (meta) {
        const weeks = (ctx.weekStarts || []).join(', ') || ctx.weekStart || '-';
        meta.textContent = `전지역 ${ctx.partnerCount || 0}곳 · 기간 ${ctx.fromDate || '-'} ~ ${ctx.toDate || '-'} · 정산주 ${weeks}`;
      }

      let results = [];
      if (mode === 'calls') {
        results = await runCallsSync(ctx);
      } else if (mode === 'rejection_past') {
        results = await runRejectionSync(ctx, 'past');
      } else if (mode === 'rejection_live') {
        results = await runRejectionSync(ctx, 'live');
      } else if (mode === 'all') {
        const callRows = await runCallsSync(ctx);
        const rejPast = await runRejectionSync(ctx, 'past');
        // 현재 정산주(수~화)는 배달현황 기준(live)으로 덮어씀.
        // 수요일엔 과거(수~전일)가 비어 pastRate=null → past는 스킵되고, live가 오늘 배달현황만 반영.
        // 목~화엔 past 반영 후 live(=과거+오늘 배달현황)로 최신값 덮어씀(둘 다 비보호 소스).
        const hasCurrentWeek = Boolean(ctx.currentWeekStart)
          && (Array.isArray(ctx.weekStarts) ? ctx.weekStarts : []).includes(ctx.currentWeekStart);
        const rejLive = hasCurrentWeek ? await runRejectionSync(ctx, 'live') : [];
        results = [...callRows, ...rejPast, ...rejLive];
      }

      renderCoverageRows(mergeCoverageMaps(state._lastCallsCoverage, state._lastRejectionCoverage));
      renderResultRows(results);
      const ok = results.filter(r => r.status === 'ok').length;
      const fail = results.length - ok;
      const coveredOk = (state.lastCoverageRows || []).filter(r => r.status === 'ok').length;
      showToast(
        coveredOk > 0
          ? `동기화 완료 · 날짜·지역 반영완료 ${coveredOk} · 기사 성공 ${ok} · 실패/스킵 ${fail}`
          : `동기화 완료 · 성공 ${ok} · 실패/스킵 ${fail}`
      );

      // 콜수/거절율 화면 갱신 신호
      document.dispatchEvent(new CustomEvent('brem-heavy-data-ready'));
    } catch (error) {
      renderCoverageRows(new Map());
      renderResultRows([{
        kind: '동기화',
        status: 'fail',
        statusLabel: '실패',
        reason: error.message || '동기화 실패',
        detail: ''
      }]);
      showToast(error.message || '동기화에 실패했습니다.');
    } finally {
      state.running = false;
      setButtonsLoading(false);
    }
  }

  async function rematch() {
    if (!state.lastUnmatched?.length) {
      showToast('재시도할 미매칭 항목이 없습니다. 먼저 동기화를 실행하세요.');
      return;
    }
    // 기사 목록 다시 읽고 동일 모드 재실행 유도
    await BremStorage.ensureSectionLoaded?.('calls');
    await BremStorage.ensureSectionLoaded?.('rejections');
    const still = [];
    state.lastUnmatched.forEach(item => {
      if (!matchDriverByBaeminId(item.baeminId)) still.push(item);
    });
    if (still.length === state.lastUnmatched.length) {
      showToast(`여전히 미매칭 ${still.length}건 · 기사관리에서 배민ID를 등록하세요.`);
      renderResultRows(still.map(item => ({
        kind: item.kind || '재시도',
        riderName: item.riderName,
        baeminId: item.baeminId,
        status: 'fail',
        statusLabel: '미매칭',
        reason: '배민ID 미등록',
        detail: '기사 관리에서 baeminId 확인'
      })));
      return;
    }
    showToast(`매칭 가능 ${state.lastUnmatched.length - still.length}건 발견 · 동기화를 다시 실행합니다.`);
    await run('all');
  }

  function bind() {
    const map = [
      ['baeminSyncCallsBtn', 'calls'],
      ['baeminSyncCallsBtn2', 'calls'],
      ['baeminSyncRejectionPastBtn', 'rejection_past'],
      ['baeminSyncRejectionPastBtn2', 'rejection_past'],
      ['baeminSyncRejectionLiveBtn', 'rejection_live'],
      ['baeminSyncRejectionLiveBtn2', 'rejection_live'],
      ['baeminSyncAllBtn', 'all'],
      ['baeminSyncAllBtn2', 'all']
    ];
    map.forEach(([id, mode]) => {
      $(id)?.addEventListener('click', () => { void run(mode); });
    });
    $('baeminSyncRematchBtn')?.addEventListener('click', () => { void rematch(); });

    const syncPair = (fromId, toId, mirrorFrom, mirrorTo) => {
      $(fromId)?.addEventListener('change', event => {
        const value = String(event.target.value || '').slice(0, 10);
        if ($(mirrorFrom)) $(mirrorFrom).value = value;
        window.BremBaeminDeliveryStatusAdmin?.syncSyncDateInputs?.(
          value || $(mirrorFrom)?.value,
          $(toId)?.value || $(mirrorTo)?.value
        );
      });
      $(toId)?.addEventListener('change', event => {
        const value = String(event.target.value || '').slice(0, 10);
        if ($(mirrorTo)) $(mirrorTo).value = value;
        window.BremBaeminDeliveryStatusAdmin?.syncSyncDateInputs?.(
          $(fromId)?.value || $(mirrorFrom)?.value,
          value || $(mirrorTo)?.value
        );
      });
    };
    syncPair('baeminSyncFromDate', 'baeminSyncToDate', 'baeminSyncFromDate2', 'baeminSyncToDate2');
    syncPair('baeminSyncFromDate2', 'baeminSyncToDate2', 'baeminSyncFromDate', 'baeminSyncToDate');

    $('baeminSyncThisWeekBtn')?.addEventListener('click', () => {
      window.BremBaeminDeliveryStatusAdmin?.applySyncThisWeekRange?.();
    });
    $('baeminSyncThisWeekBtn2')?.addEventListener('click', () => {
      window.BremBaeminDeliveryStatusAdmin?.applySyncThisWeekRange?.();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  window.BremBaeminCallsRejectionSync = {
    run,
    rematch,
    normalizeBaeminId,
    matchDriverByBaeminId,
    extractMetrics,
    mergeMetrics,
    calcAcceptRate
  };
})();
