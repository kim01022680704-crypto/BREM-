/* 쿠팡 일정산 업로드 기록으로 권외 권역 목록을 만들고, 시·구·동 키워드를 저장한다. */
(function () {
  'use strict';

  const BODY_ID = 'outsideCallRegionsBody';
  let bound = false;
  let active = null;
  let fileRegion = null;
  let keywordDirty = false;

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

  function fixedRegions() {
    const parse = parser()?.parseDailyFileRegion;
    const map = new Map();
    const saved = store()?.getAll?.() || {};
    Object.keys(saved).forEach(key => {
      const entry = saved[key] || {};
      const parts = String(key).split('\t');
      const city = String(entry.city || parts[0] || '').trim();
      const region = String(entry.region || parts[1] || '').trim();
      if (!city || !region || entry.closed === true) return;
      const stableKey = `${city}\t${region}`;
      map.set(stableKey, { city, region, label: `${city} ${region}`, key: stableKey });
    });
    const logs = window.BremStorage?.settlementUploadLogs?.getFiltered?.({
      kind: 'daily',
      platform: 'coupang'
    }) || [];
    const fresh = [];
    if (typeof parse === 'function') {
      logs.forEach(log => {
        const region = parse(log.fileName || '');
        if (!region?.city || !region.region || map.has(region.key)) return;
        if (saved[region.key]?.closed === true) return;
        map.set(region.key, {
          city: region.city,
          region: region.region,
          label: region.label,
          key: region.key
        });
        fresh.push(region);
      });
    }
    if (fresh.length) {
      try { store()?.rememberAll?.(fresh); } catch (error) { console.warn('[BREM] 권역 목록 고정 실패', error); }
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, 'ko'));
  }

  function regionChoices() {
    const map = new Map();
    fixedRegions().forEach(region => map.set(region.key, region));
    if (fileRegion?.key && !map.has(fileRegion.key)) map.set(fileRegion.key, fileRegion);
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, 'ko'));
  }

  function optionValue(region) {
    return encodeURIComponent(region?.key || '');
  }

  function selectedRegion() {
    const raw = document.getElementById('outsideWeeklyRegion')?.value || '';
    let key = raw;
    try { key = decodeURIComponent(raw); } catch (error) { key = raw; }
    return regionChoices().find(region => region.key === key) || null;
  }

  function fillRegionSelect() {
    const select = document.getElementById('outsideWeeklyRegion');
    if (!select) return;
    const current = select.value;
    const regions = regionChoices();
    if (!regions.length) {
      select.innerHTML = '<option value="">권역이 없습니다. 주정산서 파일 이름으로 만듭니다.</option>';
      return;
    }
    select.innerHTML = regions.map(region => (
      `<option value="${optionValue(region)}">${escapeHtml(region.label)}</option>`
    )).join('');
    const preferred = regions.some(region => optionValue(region) === current)
      ? current
      : optionValue(
        (fileRegion?.key && regions.find(region => region.key === fileRegion.key))
        || regions[0]
      );
    select.value = preferred;
  }

  function writeKeywordFields(spec) {
    const large = document.getElementById('outsideWeeklyLarge');
    const gu = document.getElementById('outsideWeeklyGu');
    const dong = document.getElementById('outsideWeeklyDong');
    if (large) large.value = keywordText(spec?.large);
    if (gu) gu.value = keywordText(spec?.gu);
    if (dong) dong.value = keywordText(spec?.dong);
  }

  function syncKeywordFields(force) {
    if (keywordDirty && !force) return;
    const region = selectedRegion();
    if (!region) {
      writeKeywordFields({ large: [], gu: [], dong: [] });
      keywordDirty = false;
      return;
    }
    const entry = store()?.get?.(region.city, region.region) || { large: [], gu: [], dong: [] };
    writeKeywordFields(entry);
    keywordDirty = false;
  }

  function checkedAddresses() {
    return [...document.querySelectorAll('[data-outside-area]:checked')].map(input => input.value).filter(Boolean);
  }

  function renderAreas(areas) {
    const box = document.getElementById('outsideWeeklyAreaResult');
    if (!box) return;
    const list = Array.isArray(areas) ? areas : [];
    if (!list.length) {
      box.innerHTML = '<p class="form-help outside-area-panel">오더별 상세내역에서 지역이 비어 있습니다.</p>';
      return;
    }
    box.innerHTML = `<div class="outside-area-panel">
      <p class="form-help">지역 ${list.length}개. 권내인 것만 체크하세요.</p>
      <div class="outside-area-actions">
        <button type="button" class="small-btn" id="outsideWeeklyCheckAll">모두 체크</button>
        <button type="button" class="small-btn" id="outsideWeeklyCheckNone">체크 해제</button>
      </div>
      <div class="outside-area-list">
        ${list.map(area => `<label class="outside-area-list__item">
          <input type="checkbox" data-outside-area value="${escapeHtml(area.text)}">
          <span>${escapeHtml(area.text)}</span>
          <span class="form-help">${area.count}건</span>
        </label>`).join('')}
      </div>
    </div>`;
    box.querySelector('#outsideWeeklyCheckAll')?.addEventListener('click', () => {
      box.querySelectorAll('[data-outside-area]').forEach(input => { input.checked = true; });
    });
    box.querySelector('#outsideWeeklyCheckNone')?.addEventListener('click', () => {
      box.querySelectorAll('[data-outside-area]').forEach(input => { input.checked = false; });
    });
  }

  async function loadWeeklyFile(event) {
    event.preventDefault();
    const file = document.getElementById('outsideWeeklyFile')?.files?.[0];
    const password = document.getElementById('outsideWeeklyPassword')?.value || '';
    if (!file) {
      showToast('주정산서 파일을 선택하세요.');
      return;
    }
    if (!String(password).trim()) {
      showToast('엑셀 비밀번호를 입력하세요.');
      return;
    }
    const parsed = parser()?.parseDailyFileRegion?.(file.name) || null;
    if (parsed?.city && parsed?.region) {
      fileRegion = parsed;
      fillRegionSelect();
      const select = document.getElementById('outsideWeeklyRegion');
      if (select) select.value = optionValue(parsed);
      syncKeywordFields(true);
    }
    const button = document.getElementById('outsideWeeklyLoadBtn');
    if (button) button.disabled = true;
    try {
      if (typeof BremSettlementParser?.openWorkbookSheetRows !== 'function') {
        throw new Error('정산서 읽기 준비가 되지 않았습니다. 새로고침 후 다시 시도하세요.');
      }
      const buffer = new Uint8Array(await file.arrayBuffer());
      const rows = await BremSettlementParser.openWorkbookSheetRows(
        buffer,
        BremSettlementParser.normalizePassword(password),
        {
          sheetMatcher: name => {
            const text = String(name || '');
            return text.includes('오더별') && text.includes('상세');
          }
        }
      );
      const areas = parser()?.listOrderAreas?.(rows);
      if (!areas) {
        const box = document.getElementById('outsideWeeklyAreaResult');
        if (box) box.innerHTML = '<p class="form-help outside-area-panel">오더별 상세내역에서 픽업지역·배달지역 칸을 찾지 못했습니다.</p>';
        showToast('오더별 상세내역에서 지역 칸을 찾지 못했습니다.');
        return;
      }
      renderAreas(areas);
      const meta = document.getElementById('outsideWeeklyFileMeta');
      if (meta) {
        meta.textContent = parsed?.label
          ? `${file.name} → ${parsed.label}. 권내 지역을 체크한 뒤 키워드를 채우세요.`
          : `${file.name}에서 시·지역을 읽지 못했습니다. 저장할 권역을 고르세요.`;
      }
      showToast(`지역 ${areas.length}개를 불러왔습니다.`);
    } catch (error) {
      showToast(error?.message || '주정산서를 읽지 못했습니다.');
    } finally {
      if (button) button.disabled = false;
    }
  }

  function fillKeywordsFromChecks() {
    const checked = checkedAddresses();
    if (!checked.length) {
      showToast('권내 지역을 체크하세요.');
      return;
    }
    const spec = parser()?.keywordsFromAddresses?.(checked) || { large: [], gu: [], dong: [] };
    writeKeywordFields(spec);
    keywordDirty = true;
    showToast(`시 ${spec.large.length}개, 구 ${spec.gu.length}개, 동 ${spec.dong.length}개를 채웠습니다. 고친 뒤 저장하세요.`);
  }

  function saveWeeklyKeywords() {
    const region = selectedRegion();
    if (!region) {
      showToast('저장할 권역을 고르세요.');
      return;
    }
    const normalize = parser()?.normalizeKeywordList
      || (value => String(value || '').split(/[\n,，]/).map(item => item.trim()).filter(Boolean));
    try {
      store()?.save?.(region.city, region.region, {
        large: normalize(document.getElementById('outsideWeeklyLarge')?.value),
        gu: normalize(document.getElementById('outsideWeeklyGu')?.value),
        dong: normalize(document.getElementById('outsideWeeklyDong')?.value)
      });
      keywordDirty = false;
      fileRegion = null;
      showToast(`${region.label} 권역 키워드를 저장했습니다.`);
      render();
    } catch (error) {
      showToast(error?.message || '권역 키워드를 저장하지 못했습니다.');
    }
  }

  function render() {
    fillRegionSelect();
    syncKeywordFields(false);
    const body = document.getElementById(BODY_ID);
    if (!body) return;
    const regions = fixedRegions();
    const saved = store();
    if (!regions.length) {
      body.innerHTML = '<p class="form-help">표시할 권역이 없습니다. 새 시·지역 일정산을 올리면 줄이 생깁니다.</p>';
      return;
    }
    body.innerHTML = `<div class="table-wrap"><table class="settlement-preview-table">
      <thead><tr><th>지역</th><th>큰 키워드</th><th>구 키워드</th><th>동 키워드</th><th></th></tr></thead>
      <tbody>
        ${regions.map(region => {
          const entry = saved?.get?.(region.city, region.region) || { large: [], gu: [], dong: [] };
          return `<tr>
            <td><strong>${escapeHtml(region.label)}</strong></td>
            <td>${preview(entry.large)}</td>
            <td>${preview(entry.gu)}</td>
            <td>${preview(entry.dong)}</td>
            <td>
              <button type="button" class="small-btn" data-outside-edit data-outside-city="${escapeHtml(region.city)}" data-outside-region="${escapeHtml(region.region)}">키워드 설정</button>
              <button type="button" class="small-btn danger-btn" data-outside-delete data-outside-city="${escapeHtml(region.city)}" data-outside-region="${escapeHtml(region.region)}">삭제</button>
            </td>
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
    return fixedRegions().find(region => region.key === key) || null;
  }

  function bind() {
    if (bound) return;
    bound = true;
    const body = document.getElementById(BODY_ID);
    body?.addEventListener('click', event => {
      const removeButton = event.target.closest('[data-outside-delete]');
      if (removeButton) {
        const city = removeButton.getAttribute('data-outside-city') || '';
        const regionName = removeButton.getAttribute('data-outside-region') || '';
        const label = `${city} ${regionName}`.trim();
        if (!city || !regionName) return;
        if (!window.confirm(`${label} 권역을 목록에서 뺄까요?\n접은 지역은 예전 일정산이 있어도 다시 나오지 않습니다.`)) return;
        try {
          store()?.remove?.(city, regionName);
          showToast(`${label} 권역을 목록에서 뺐습니다.`);
          render();
        } catch (error) {
          showToast(error?.message || '권역을 빼지 못했습니다.');
        }
        return;
      }
      const button = event.target.closest('[data-outside-edit]');
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
    document.getElementById('outsideWeeklyAreaForm')?.addEventListener('submit', event => {
      loadWeeklyFile(event);
    });
    document.getElementById('outsideWeeklyRegion')?.addEventListener('change', () => {
      syncKeywordFields(true);
    });
    ['outsideWeeklyLarge', 'outsideWeeklyGu', 'outsideWeeklyDong'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', () => {
        keywordDirty = true;
      });
    });
    document.getElementById('outsideWeeklyFillBtn')?.addEventListener('click', fillKeywordsFromChecks);
    document.getElementById('outsideWeeklySaveBtn')?.addEventListener('click', saveWeeklyKeywords);
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
