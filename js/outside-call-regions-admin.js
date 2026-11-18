/* 쿠팡 일정산 업로드 기록으로 권외 권역 목록을 만들고, 시·구·동 키워드를 저장한다. */
(function () {
  'use strict';

  const BODY_ID = 'outsideCallRegionsBody';
  let bound = false;
  let active = null;

  function store() {
    return window.BremStorage?.outsideCallRegions || null;
  }

  function parser() {
    return window.BremOutsideCall || null;
  }

  function showToast(message) {
    document.dispatchEvent(new CustomEvent('brem-admin-toast', { detail: { message } }));
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function keywordText(list) {
    return (Array.isArray(list) ? list : []).join('\n');
  }

  function preview(list) {
    const items = Array.isArray(list) ? list : [];
    if (!items.length) return '<span class="form-help">없음</span>';
    return items.map(item => `<span class="settlement-call-fee-log-badge">${escapeHtml(item)}</span>`).join(' ');
  }

  function regionsFromLogs() {
    const parse = parser()?.parseDailyFileRegion;
    if (typeof parse !== 'function') return [];
    const logs = window.BremStorage?.settlementUploadLogs?.getFiltered?.({
      kind: 'daily',
      platform: 'coupang'
    }) || [];
    const map = new Map();
    logs.forEach(log => {
      const region = parse(log.fileName || '');
      if (!region?.city || !region.region) return;
      const prev = map.get(region.key);
      const seenAt = String(log.uploadedAt || log.appliedAt || '');
      if (!prev || seenAt > prev.seenAt) {
        map.set(region.key, {
          ...region,
          seenAt,
          fileName: String(log.fileName || '')
        });
      }
    });
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, 'ko'));
  }

  function render() {
    const body = document.getElementById(BODY_ID);
    if (!body) return;
    const regions = regionsFromLogs();
    const saved = store();
    if (!regions.length) {
      body.innerHTML = '<p class="form-help">올린 쿠팡 일정산이 없습니다. 일정산서를 반영하면 시·지역 메뉴가 생깁니다.</p>';
      return;
    }
    body.innerHTML = `<div class="table-wrap"><table class="settlement-preview-table">
      <thead><tr><th>지역</th><th>큰 키워드</th><th>구 키워드</th><th>동 키워드</th><th></th></tr></thead>
      <tbody>
        ${regions.map(region => {
          const entry = saved?.get?.(region.city, region.region) || { large: [], gu: [], dong: [] };
          return `<tr>
            <td><strong>${escapeHtml(region.label)}</strong><div class="form-help">${escapeHtml(region.fileName)}</div></td>
            <td>${preview(entry.large)}</td>
            <td>${preview(entry.gu)}</td>
            <td>${preview(entry.dong)}</td>
            <td><button type="button" class="small-btn" data-outside-city="${escapeHtml(region.city)}" data-outside-region="${escapeHtml(region.region)}">키워드 설정</button></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>`;
  }

  function closeDialog() {
    const dialog = document.getElementById('outsideRegionKeywordDialog');
    if (dialog) dialog.hidden = true;
    active = null;
  }

  function openDialog(region) {
    active = region;
    const dialog = document.getElementById('outsideRegionKeywordDialog');
    const title = document.getElementById('outsideRegionKeywordMeta');
    const entry = store()?.get?.(region.city, region.region) || { large: [], gu: [], dong: [] };
    if (title) title.textContent = region.label;
    const large = document.getElementById('outsideRegionKeywordLarge');
    const gu = document.getElementById('outsideRegionKeywordGu');
    const dong = document.getElementById('outsideRegionKeywordDong');
    if (large) large.value = keywordText(entry.large);
    if (gu) gu.value = keywordText(entry.gu);
    if (dong) dong.value = keywordText(entry.dong);
    if (dialog) dialog.hidden = false;
    large?.focus?.();
  }

  function findRegion(key) {
    return regionsFromLogs().find(region => region.key === key) || null;
  }

  function bind() {
    if (bound) return;
    bound = true;
    const body = document.getElementById(BODY_ID);
    body?.addEventListener('click', event => {
      const button = event.target.closest('[data-outside-city]');
      if (!button) return;
      const region = findRegion(
        `${button.getAttribute('data-outside-city') || ''}\t${button.getAttribute('data-outside-region') || ''}`
      );
      if (region) openDialog(region);
    });
    document.querySelectorAll('[data-outside-region-tab]').forEach(button => {
      button.addEventListener('click', () => {
        const tab = button.getAttribute('data-outside-region-tab');
        document.querySelectorAll('[data-outside-region-tab]').forEach(item => {
          item.classList.toggle('active', item === button);
        });
        const coupang = document.getElementById('outsideCallRegionsCoupang');
        const baemin = document.getElementById('outsideCallRegionsBaemin');
        if (coupang) coupang.hidden = tab !== 'coupang';
        if (baemin) baemin.hidden = tab !== 'baemin';
      });
    });
    document.querySelectorAll('[data-close-outside-region-dialog]').forEach(button => {
      button.addEventListener('click', closeDialog);
    });
    document.getElementById('outsideRegionKeywordForm')?.addEventListener('submit', event => {
      event.preventDefault();
      if (!active) return;
      const normalize = parser()?.normalizeKeywordList || (value => String(value || '').split(/[\n,，]/).map(item => item.trim()).filter(Boolean));
      try {
        store()?.save?.(active.city, active.region, {
          large: normalize(document.getElementById('outsideRegionKeywordLarge')?.value),
          gu: normalize(document.getElementById('outsideRegionKeywordGu')?.value),
          dong: normalize(document.getElementById('outsideRegionKeywordDong')?.value)
        });
        showToast(`${active.label} 권역 키워드를 저장했습니다.`);
        closeDialog();
        render();
      } catch (error) {
        showToast(error?.message || '권역 키워드를 저장하지 못했습니다.');
      }
    });
  }

  function refresh() {
    bind();
    render();
  }

  window.BremOutsideCallRegionsAdmin = { refresh };
})();
