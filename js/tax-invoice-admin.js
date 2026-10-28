// 계산서 관리 — 수~화 주차, 배민/쿠팡 엑셀 합계 등록
const BremTaxInvoiceAdmin = (function () {
  const $ = selector => document.querySelector(selector);
  const Parse = () => BremTaxInvoiceParse;

  const PLATFORMS = ['baemin', 'coupang'];

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatMoney(value) {
    return Number(value || 0).toLocaleString('ko-KR');
  }

  function showToast(message) {
    document.dispatchEvent(new CustomEvent('brem-admin-toast', { detail: { message } }));
  }

  function platformLabel(platform) {
    return platform === 'coupang' ? '쿠팡' : '배민';
  }

  function fieldsFor(platform) {
    const parse = Parse();
    return platform === 'coupang' ? parse.COUPANG_FIELDS : parse.BAEMIN_FIELDS;
  }

  function dateKeyFromDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function paintWeek(platform, value) {
    const picker = typeof BremDatePicker !== 'undefined' ? BremDatePicker : null;
    const hidden = $(`#taxInvoiceWeek-${platform}`);
    const button = $(`#taxInvoiceWeekBtn-${platform}`);
    const range = $(`#taxInvoiceWeekRange-${platform}`);
    if (!picker || !hidden) return '';
    const normalized = picker.applyWeekWednesday(value || picker.weekStartKey());
    hidden.value = normalized;
    if (button) {
      const weekday = picker.formatWeekdayKo(normalized);
      button.textContent = weekday
        ? `${picker.formatDate(normalized)}(${weekday})`
        : picker.formatDate(normalized);
    }
    if (range) range.textContent = picker.formatWednesdayWeekRangeLong(normalized) || '';
    return normalized;
  }

  function ensureWeek(platform) {
    const hidden = $(`#taxInvoiceWeek-${platform}`);
    const current = hidden?.value || (typeof BremDatePicker !== 'undefined' ? BremDatePicker.weekStartKey() : '') || '';
    return paintWeek(platform, current);
  }

  function readList() {
    let raw = window.BremStorage?.taxInvoices?.getAll?.() || [];
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch { raw = []; }
    }
    return Array.isArray(raw) ? raw : [];
  }

  function regionKey(region) {
    return String(region || '').replace(/\s+/g, '').toLowerCase();
  }

  function guessRegion(fileName, platform) {
    const weekly = window.BremWeeklySettlement;
    const base = String(fileName || '').replace(/\.(xlsx|xls)$/i, '').trim();
    if (platform === 'baemin') {
      const parsed = weekly?.parseBaeminFileName?.(fileName);
      let team = String(parsed?.teamName || '').trim();
      if (team && weekly?.canonicalBaeminTeamRegion) {
        team = weekly.canonicalBaeminTeamRegion(team) || team;
      }
      if (team) return team;
    } else {
      const parsed = weekly?.parseCoupangFileName?.(fileName);
      const region = String(parsed?.region || '').trim();
      if (region) return region;
    }
    return base || String(fileName || '파일');
  }

  function weekRows(platform) {
    const weekStart = ensureWeek(platform);
    return readList()
      .filter(item => item.platform === platform && item.weekStart === weekStart)
      .sort((a, b) => String(a.region || '').localeCompare(String(b.region || ''), 'ko'));
  }

  function render(platform) {
    const body = $(`#taxInvoiceRows-${platform}`);
    const summary = $(`#taxInvoiceSummary-${platform}`);
    if (!body) return;
    const fields = fieldsFor(platform);
    const rows = weekRows(platform);
    const colSpan = fields.length + 3;
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="${colSpan}" class="empty">이 주차에 등록된 ${platformLabel(platform)} 계산서가 없습니다.</td></tr>`;
      if (summary) summary.textContent = '엑셀을 고르고 비밀번호를 입력한 뒤 「엑셀 등록」을 누르세요.';
      return;
    }
    const totals = {};
    fields.forEach(field => { totals[field.key] = 0; });
    body.innerHTML = rows.map(row => {
      fields.forEach(field => {
        totals[field.key] += Number(row[field.key] || 0);
      });
      const amountCells = fields.map(field => (
        `<td class="weekly-amount-cell">${formatMoney(row[field.key])}</td>`
      )).join('');
      const sheetTitle = row.sourceSheet ? `시트 ${row.sourceSheet}` : '';
      return `<tr>
        <td>${escapeHtml(row.region || '-')}</td>
        <td title="${escapeHtml(sheetTitle)}">${escapeHtml(row.fileName || '-')}</td>
        ${amountCells}
        <td><button type="button" class="small-btn danger-btn" data-tax-invoice-delete="${escapeHtml(row.id)}">삭제</button></td>
      </tr>`;
    }).join('');
    const totalCells = fields.map(field => (
      `<td class="weekly-amount-cell">${formatMoney(totals[field.key])}</td>`
    )).join('');
    body.insertAdjacentHTML('beforeend', `<tr>
      <td colspan="2"><strong>합계 ${rows.length}건</strong></td>
      ${totalCells}
      <td></td>
    </tr>`);
    if (summary) {
      summary.textContent = `${platformLabel(platform)} ${rows.length}건 · 같은 지역을 다시 올리면 그 줄이 바뀝니다.`;
    }
  }

  function refresh() {
    PLATFORMS.forEach(platform => {
      ensureWeek(platform);
      render(platform);
    });
  }

  function onWeekPicked(platform, value) {
    paintWeek(platform, value);
    render(platform);
  }

  function shiftWeek(platform, delta) {
    const picker = typeof BremDatePicker !== 'undefined' ? BremDatePicker : null;
    const current = ensureWeek(platform);
    const date = new Date(`${current}T00:00:00`);
    if (Number.isNaN(date.getTime())) return;
    date.setDate(date.getDate() + (delta * 7));
    const next = picker?.applyWeekWednesday?.(dateKeyFromDate(date)) || dateKeyFromDate(date);
    paintWeek(platform, next);
    render(platform);
  }

  async function readSheets(file, password) {
    const client = typeof BremSettlementParser !== 'undefined' ? BremSettlementParser : null;
    if (!client?.readAllSheetCellMaps) {
      throw new Error('엑셀 읽기 모듈이 없습니다. 페이지를 새로고침하세요.');
    }
    const buffer = new Uint8Array(await file.arrayBuffer());
    const sheets = await client.readAllSheetCellMaps(buffer, password);
    if (!sheets?.length) {
      throw new Error('엑셀 시트를 읽지 못했습니다.');
    }
    return sheets;
  }

  async function parseFile(file, password, platform) {
    const sheets = await readSheets(file, password);
    const parse = Parse();
    const picked = parse.pickSheet(
      sheets,
      platform === 'coupang' ? parse.extractCoupang : parse.extractBaemin
    );
    if (!picked) {
      if (platform === 'coupang') {
        throw new Error('공급가액·총합계금액·총실지급액 항목을 찾지 못했습니다.');
      }
      throw new Error('공급가액 B31, 부가세액 C31, 공급대가 D31 칸을 읽지 못했습니다.');
    }
    return {
      region: guessRegion(file.name, platform),
      fileName: file.name,
      sourceSheet: picked.sheetName,
      amounts: picked.amounts
    };
  }

  async function upload(platform) {
    const fileInput = $(`#taxInvoiceFiles-${platform}`);
    const passwordInput = $(`#taxInvoicePassword-${platform}`);
    const button = $(`#taxInvoiceUploadBtn-${platform}`);
    const errorsEl = $(`#taxInvoiceErrors-${platform}`);
    const files = Array.from(fileInput?.files || []);
    const password = String(passwordInput?.value || '');
    if (!password.trim()) {
      showToast('엑셀 비밀번호를 입력하세요.');
      return;
    }
    if (!files.length) {
      showToast('엑셀 파일을 선택하세요. 여러 개도 한 번에 고를 수 있습니다.');
      return;
    }
    const weekStart = ensureWeek(platform);
    if (!weekStart) {
      showToast('정산 주(수요일)를 선택하세요.');
      return;
    }
    if (button) {
      button.disabled = true;
      button.textContent = `0/${files.length} 읽는 중`;
    }
    if (errorsEl) errorsEl.textContent = '';

    const parsed = [];
    const errors = [];
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      if (button) button.textContent = `${i + 1}/${files.length} 읽는 중`;
      try {
        parsed.push(await parseFile(file, password, platform));
      } catch (error) {
        errors.push(`${file.name}: ${error.message || '읽기 실패'}`);
      }
    }

    if (parsed.length) {
      const list = readList();
      let replaced = 0;
      parsed.forEach(item => {
        const key = regionKey(item.region);
        const index = list.findIndex(row => (
          row.platform === platform
          && row.weekStart === weekStart
          && regionKey(row.region) === key
        ));
        const record = {
          id: index >= 0 ? list[index].id : (window.BremStorage?.createId?.() || `inv_${Date.now()}`),
          platform,
          weekStart,
          region: item.region,
          fileName: item.fileName,
          sourceSheet: item.sourceSheet,
          uploadedAt: new Date().toISOString(),
          ...item.amounts
        };
        if (index >= 0) {
          list[index] = record;
          replaced += 1;
        } else {
          list.push(record);
        }
      });
      try {
        const result = window.BremStorage?.taxInvoices?.saveAll?.(list);
        if (window.BremStorage?.awaitPersist) await window.BremStorage.awaitPersist(result);
        const fresh = parsed.length - replaced;
        showToast(`${platformLabel(platform)} 계산서 ${parsed.length}건 등록 (신규 ${fresh} · 갱신 ${replaced})`);
      } catch (error) {
        errors.push(error.message || '저장에 실패했습니다.');
      }
    }

    if (fileInput) fileInput.value = '';
    if (button) {
      button.disabled = false;
      button.textContent = '엑셀 등록';
    }
    if (errorsEl) errorsEl.textContent = errors.join('\n');
    if (!parsed.length && errors.length) showToast(errors[0]);
    render(platform);
  }

  async function removeRecord(id) {
    const list = readList();
    const row = list.find(item => item.id === id);
    if (!row) return;
    const label = `${row.region || row.fileName || '이 계산서'}`;
    if (!window.confirm(`${label} 계산서를 이 주차에서 삭제할까요?`)) return;
    const next = list.filter(item => item.id !== id);
    const result = window.BremStorage?.taxInvoices?.saveAll?.(next);
    if (window.BremStorage?.awaitPersist) await window.BremStorage.awaitPersist(result);
    showToast('계산서를 삭제했습니다.');
    render(row.platform);
  }

  function bind() {
    if (bind.done) return;
    bind.done = true;
    PLATFORMS.forEach(platform => {
      $(`#taxInvoiceForm-${platform}`)?.addEventListener('submit', event => {
        event.preventDefault();
        void upload(platform);
      });
      $(`#taxInvoiceWeekPrevBtn-${platform}`)?.addEventListener('click', () => shiftWeek(platform, -1));
      $(`#taxInvoiceWeekNextBtn-${platform}`)?.addEventListener('click', () => shiftWeek(platform, 1));
      $(`#taxInvoiceReloadBtn-${platform}`)?.addEventListener('click', async () => {
        try {
          await window.BremStorage?.ensureSectionLoaded?.('tax-invoice-management', { force: true });
        } catch (error) {
          showToast(error.message || '불러오지 못했습니다.');
        }
        refresh();
      });
    });
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-tax-invoice-delete]');
      if (!button) return;
      void removeRecord(button.getAttribute('data-tax-invoice-delete'));
    });
  }

  bind();

  return { refresh, onWeekPicked };
})();

window.BremTaxInvoiceAdmin = BremTaxInvoiceAdmin;
