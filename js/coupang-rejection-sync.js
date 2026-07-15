/**
 * 쿠팡이츠 현황 → 거절율 동기화 (라이더앱 반영)
 * - 이번 정산주(수~화) rider_daily 집계 → 쿠팡ID(matchKey)로 ERP 기사 매칭
 * - 거절율 = (거절+취소)/(완료+거절+취소)×100 을 admin_rejection_rates(platform='coupang')에 upsert
 * - 수동/ERP/일괄(bulk) 소스는 보호(덮어쓰지 않음)
 * - 반영 후 라이더 앱 publish
 * 데이터는 BremCoupangRiderStatusAdmin.getWeekContext() 로 받는다.
 */
(function () {
  'use strict';

  const PROTECTED_SOURCES = new Set(['manual', 'erp-bulk', 'erp']);
  const SYNC_SOURCE = 'coupang_crawl_sync';
  const state = { running: false };

  const $ = (id) => document.getElementById(id);

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function fmt(v) {
    return Number(v || 0).toLocaleString('ko-KR');
  }
  function toast(msg) {
    if (window.BremBaeminDeliveryStatusAdmin?.showToast) return window.BremBaeminDeliveryStatusAdmin.showToast(msg);
    console.log('[coupang거절율]', msg);
  }

  function buildErpMap() {
    const map = new Map();
    const drivers = window.BremStorage?.drivers?.getAll?.() || [];
    const utils = window.BremDriverUtils;
    drivers.forEach(d => {
      const id = utils?.getErpCoupangId ? utils.getErpCoupangId(d) : '';
      if (id && !map.has(id)) map.set(id, d);
    });
    return map;
  }

  function renderResults(rows, weekStart) {
    const summaryEl = $('coupangRejectionSyncSummary');
    const resultEl = $('coupangRejectionSyncResult');
    const ok = rows.filter(r => r.status === 'ok').length;
    const protectedCnt = rows.filter(r => r.status === 'protected').length;
    const unmatched = rows.filter(r => r.status === 'unmatched').length;
    const skip = rows.filter(r => r.status === 'skip').length;
    if (summaryEl) {
      summaryEl.textContent = `정산주 ${weekStart || '-'} · 반영 ${fmt(ok)} · 보호 ${fmt(protectedCnt)} · 미매칭 ${fmt(unmatched)} · 미집계 ${fmt(skip)} · 총 ${fmt(rows.length)}`;
    }
    if (!resultEl) return;
    if (!rows.length) {
      resultEl.innerHTML = '<p class="form-help">동기화 대상 라이더가 없습니다. 먼저 주간 데이터를 조회/수집하세요.</p>';
      return;
    }
    const labelOf = {
      ok: '<span style="color:#1e824c">반영</span>',
      protected: '<span style="color:#b8860b">보호</span>',
      unmatched: '<span style="color:#c0392b">미매칭</span>',
      skip: '<span style="color:#7f8c8d">미집계</span>'
    };
    const body = rows.map(r => `<tr>
      <td>${labelOf[r.status] || esc(r.status)}</td>
      <td>${esc(r.name || '-')}</td>
      <td>${esc(r.matchKey || '-')}</td>
      <td>${esc(r.driverName || '-')}</td>
      <td>${r.rate == null ? '-' : r.rate + '%'}</td>
      <td>${esc(r.reason || '')}</td>
    </tr>`).join('');
    resultEl.innerHTML = `<div class="dashboard-baemin-table-wrap"><table class="admin-table">
      <thead><tr><th>결과</th><th>이름</th><th>쿠팡ID</th><th>매칭기사</th><th>거절율</th><th>비고</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
  }

  async function run() {
    if (state.running) { toast('이미 동기화 중입니다.'); return; }
    const host = window.BremCoupangRiderStatusAdmin;
    if (!host?.getWeekContext) { toast('쿠팡현황을 먼저 열어 주세요.'); return; }

    state.running = true;
    const btn = $('coupangRejectionSyncBtn');
    if (btn) { btn.disabled = true; if (!btn.dataset.defaultLabel) btn.dataset.defaultLabel = btn.textContent; btn.textContent = '동기화 중…'; }

    try {
      try { await window.BremStorage?.ensureSectionLoaded?.('rejections'); } catch { /* ignore */ }
      try { await window.BremStorage?.ensureSectionLoaded?.('drivers'); } catch { /* ignore */ }
      if (host.loadWeek) await host.loadWeek();

      const ctx = host.getWeekContext();
      const weekStart = ctx.weekStart;
      const erpMap = buildErpMap();
      const entries = [];
      const results = [];

      (ctx.riders || []).forEach(r => {
        const matchKey = String(r.matchKey || '').trim();
        const base = { name: r.name, matchKey, rate: r.rate };
        if (!matchKey) {
          results.push({ ...base, status: 'unmatched', reason: '이름/전화 부족(쿠팡ID 없음)' });
          return;
        }
        if (r.rate == null) {
          results.push({ ...base, status: 'skip', reason: '완료+거절+취소 0' });
          return;
        }
        const driver = erpMap.get(matchKey);
        if (!driver?.id) {
          results.push({ ...base, status: 'unmatched', reason: '기사 쿠팡ID 미등록' });
          return;
        }
        const existing = window.BremStorage?.rejections?.getEntryForWeek?.(driver.id, weekStart, 'coupang');
        if (existing && PROTECTED_SOURCES.has(String(existing.source || 'manual').trim().toLowerCase())) {
          results.push({ ...base, status: 'protected', driverName: driver.name || driver.id, reason: `기존 ${existing.source} 유지` });
          return;
        }
        entries.push({
          driverId: driver.id,
          weekStart,
          platform: 'coupang',
          rate: Number(r.rate),
          source: SYNC_SOURCE,
          stats: {
            completeCount: r.complete || 0,
            rejectCount: r.reject || 0,
            cancelCount: r.cancel || 0,
            unmeasured: false
          }
        });
        results.push({ ...base, status: 'ok', driverName: driver.name || driver.id, reason: `완료 ${fmt(r.complete)} · 거절 ${fmt(r.reject)} · 취소 ${fmt(r.cancel)}` });
      });

      if (entries.length) {
        await window.BremStorage.rejections.upsertWeeklyBatch(entries);
        try {
          const pub = await window.BremStorage.riderViewPublish.publishAllToRiderView();
          toast(`거절율 ${entries.length}명 반영 완료 · 라이더앱 반영 ${fmt(pub?.rejectionsPublished || entries.length)}건`);
        } catch (e) {
          toast(`거절율 ${entries.length}명 저장 완료 (라이더앱 반영 실패: ${e.message || e})`);
        }
        document.dispatchEvent(new CustomEvent('brem-heavy-data-ready'));
      } else {
        toast('반영할 거절율이 없습니다. (미매칭/보호/미집계만 존재)');
      }

      renderResults(results, weekStart);
    } catch (error) {
      toast(error.message || '거절율 동기화에 실패했습니다.');
      renderResults([], '');
    } finally {
      state.running = false;
      if (btn) { btn.disabled = false; if (btn.dataset.defaultLabel) btn.textContent = btn.dataset.defaultLabel; }
    }
  }

  function bind() {
    const btn = $('coupangRejectionSyncBtn');
    if (btn && !btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => { void run(); });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  window.BremCoupangRejectionSync = { run };
})();
