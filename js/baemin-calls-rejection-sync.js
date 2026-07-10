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
    const parsed = row.parsed_json || {};
    const fromParsed = String(parsed.businessDate || parsed.deliveryDate || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(fromParsed)) return fromParsed;
    const parts = String(row.dedupe_key || '').split(':');
    for (const part of parts) {
      const day = String(part || '').slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
    }
    return '';
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

    const dated = items.map(row => ({
      row,
      date: resolveRiderBusinessDate(row),
      baeminId: normalizeBaeminId(row.rider_user_id),
      complete: extractMetrics(row.parsed_json).complete,
      riderName: row.rider_name || ''
    }));

    const withDate = dated.filter(item => item.date);
    if (!withDate.length) {
      return [{
        kind: '콜수',
        status: 'fail',
        statusLabel: '실패',
        reason: '일별 라이더 내역 없음',
        detail: '기간합산만 있고 일별(하루) 키가 없습니다. BIZ 라이더 일별 수집·저장 후 다시 시도하세요.'
      }];
    }

    const byDayDriver = new Map();
    const unmatched = [];

    withDate.forEach(item => {
      if (!item.baeminId) {
        results.push({
          kind: '콜수',
          riderName: item.riderName,
          baeminId: '',
          status: 'fail',
          statusLabel: '실패',
          reason: '배민ID 없음',
          detail: item.date
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
          detail: `${item.date} · 완료 ${item.complete}`
        });
        return;
      }
      const key = `${driver.id}|${item.date}`;
      const prev = byDayDriver.get(key) || {
        driverId: driver.id,
        driverName: driver.name || '',
        date: item.date,
        baeminId: item.baeminId,
        riderName: item.riderName,
        count: 0
      };
      prev.count += item.complete;
      byDayDriver.set(key, prev);
    });

    state.lastUnmatched = unmatched.map(item => ({
      kind: '콜수',
      baeminId: item.baeminId,
      riderName: item.riderName,
      date: item.date,
      complete: item.complete
    }));

    // 날짜별 배치 저장 (콜수 입력 메뉴와 동일 API)
    const byDate = new Map();
    [...byDayDriver.values()].forEach(entry => {
      if (!byDate.has(entry.date)) byDate.set(entry.date, []);
      byDate.get(entry.date).push(entry);
    });

    for (const [date, records] of byDate.entries()) {
      try {
        BremStorage.calls.upsertBatchDaily({
          date,
          platform: 'baemin',
          records: records.map(r => ({ driverId: r.driverId, count: r.count }))
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
            detail: `${date} · 완료 ${formatNumber(r.count)}건 → 콜수 입력`
          });
        });
      } catch (error) {
        records.forEach(r => {
          results.push({
            kind: '콜수',
            riderName: r.riderName,
            baeminId: r.baeminId,
            driverLabel: r.driverName || r.driverId,
            status: 'fail',
            statusLabel: '실패',
            reason: error.message || '콜수 저장 실패',
            detail: date
          });
        });
      }
    }

    dated.filter(item => !item.date).forEach(item => {
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
    const useLive = mode === 'live';
    const kind = useLive ? '거절율(실시간)' : '거절율(과거)';
    const source = useLive ? SYNC_SOURCE_LIVE : SYNC_SOURCE_PAST;
    const weekStart = ctx.weekStart;
    const rows = Array.isArray(ctx.acceptRows) ? ctx.acceptRows : [];

    if (!weekStart) {
      return [{
        kind,
        status: 'fail',
        statusLabel: '실패',
        reason: '정산주(수요일) 없음',
        detail: ''
      }];
    }
    if (!rows.length) {
      return [{
        kind,
        status: 'fail',
        statusLabel: '실패',
        reason: '수락율 데이터 없음',
        detail: '실시간 수락율현황 조회와 동일 기간 데이터가 필요합니다.'
      }];
    }

    const entries = [];
    const unmatched = [];

    rows.forEach(row => {
      const baeminId = normalizeBaeminId(row.riderUserId || row.baeminId);
      const rate = useLive ? row.currentRate : row.pastRate;
      const metrics = useLive ? (row.current || {}) : (row.past || {});
      if (rate == null || !Number.isFinite(Number(rate))) {
        results.push({
          kind,
          riderName: row.riderName,
          baeminId,
          status: 'fail',
          statusLabel: '스킵',
          reason: '수락율 미집계',
          detail: useLive ? '현재 분모 0' : '과거 분모 0'
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
          detail: ''
        });
        return;
      }
      const driver = matchDriverByBaeminId(baeminId);
      if (!driver?.id) {
        unmatched.push({ baeminId, riderName: row.riderName, rate });
        results.push({
          kind,
          riderName: row.riderName,
          baeminId,
          status: 'fail',
          statusLabel: '미매칭',
          reason: '기사 배민ID 미등록',
          detail: `수락율 ${rate}%`
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
          detail: `수동/ERP 값은 덮어쓰지 않음 (현재 ${existing.rate}%)`
        });
        return;
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
          driverName: driver.name || driver.id
        }
      });
    });

    state.lastUnmatched = [
      ...(state.lastUnmatched || []),
      ...unmatched.map(item => ({ kind, ...item }))
    ];

    if (entries.length) {
      try {
        BremStorage.rejections.upsertWeeklyBatch(entries.map(({ _meta, ...rest }) => rest));
        entries.forEach(entry => {
          results.push({
            kind,
            riderName: entry._meta.riderName,
            baeminId: entry._meta.baeminId,
            driverLabel: entry._meta.driverName,
            status: 'ok',
            statusLabel: '성공',
            reason: '',
            detail: `${weekStart} · 수락율 ${entry.rate}% → 거절율 입력`
          });
        });
      } catch (error) {
        entries.forEach(entry => {
          results.push({
            kind,
            riderName: entry._meta.riderName,
            baeminId: entry._meta.baeminId,
            driverLabel: entry._meta.driverName,
            status: 'fail',
            statusLabel: '실패',
            reason: error.message || '거절율 저장 실패',
            detail: weekStart
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
        meta.textContent = `기간 ${ctx.pastLabel || '-'} · 현재 ${ctx.currentLabel || '-'} · 정산주 ${ctx.weekStart || '-'}`;
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
        const rejRows = await runRejectionSync(ctx, 'past');
        results = [...callRows, ...rejRows];
      }

      renderResultRows(results);
      const ok = results.filter(r => r.status === 'ok').length;
      const fail = results.length - ok;
      showToast(`동기화 완료 · 성공 ${ok} · 실패/스킵 ${fail}`);

      // 콜수/거절율 화면 갱신 신호
      document.dispatchEvent(new CustomEvent('brem-heavy-data-ready'));
    } catch (error) {
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
