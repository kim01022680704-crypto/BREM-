(function () {
  const state = {
    config: null,
    loading: false
  };

  function $(id) {
    return document.getElementById(id);
  }

  function showToast(message) {
    document.dispatchEvent(new CustomEvent('brem-admin-toast', { detail: { message } }));
  }

  async function adminApi(path, options = {}) {
    const token = await BremStorage.resolveAdminAccessToken?.();
    if (!token) {
      return { ok: false, message: '관리자 로그인이 필요합니다.' };
    }

    try {
      const response = await fetch(path, {
        credentials: 'same-origin',
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          ok: false,
          message: payload.message || payload.error || `요청 실패 (${response.status})`
        };
      }
      return { ok: true, ...payload };
    } catch (error) {
      return { ok: false, message: error.message || '네트워크 오류' };
    }
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString('ko-KR');
  }

  function setLoading(loading) {
    state.loading = loading;
    const autoBtn = $('baeminDeliveryAutoCollectBtn');
    const jsonBtn = $('baeminDeliveryJsonPasteBtn');
    if (autoBtn) {
      autoBtn.disabled = loading;
      autoBtn.textContent = loading ? '수집 중…' : '배민 자동 수집';
    }
    if (jsonBtn) jsonBtn.disabled = loading;
  }

  function renderConfig(config) {
    state.config = config;
    const hint = $('baeminDeliveryConfigHint');
    const cookieField = $('baeminDeliveryCookieField');
    if (!hint) return;

    if (!config?.tableExists) {
      hint.textContent = 'Supabase 테이블이 없습니다. supabase/baemin_delivery_status_migration.sql 을 SQL Editor에서 실행하세요.';
      hint.className = 'form-help form-help--warn';
    } else if (config?.cookieConfigured) {
      hint.textContent = '서버 환경변수(BAEMIN_BIZ_SESSION_COOKIE)로 자동 수집합니다. Vercel에서는 Playwright 대신 쿠키 방식을 사용합니다.';
      hint.className = 'form-help';
      if (cookieField) cookieField.hidden = true;
    } else {
      hint.textContent = '환경변수 쿠키가 없습니다. 아래에 배민Biz 세션 쿠키를 입력하거나 JSON 붙여넣기를 사용하세요.';
      hint.className = 'form-help form-help--warn';
      if (cookieField) cookieField.hidden = false;
    }
  }

  function renderSummary(result, errorMessage) {
    const box = $('baeminDeliveryCollectResult');
    if (!box) return;

    if (errorMessage) {
      box.hidden = false;
      box.className = 'baemin-collect-result baemin-collect-result--error';
      box.innerHTML = `<strong>수집 실패</strong><p>${errorMessage}</p>`;
      return;
    }

    if (!result) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }

    box.hidden = false;
    box.className = 'baemin-collect-result baemin-collect-result--success';
    box.innerHTML = `
      <strong>수집 완료</strong>
      <ul class="baemin-collect-stats">
        <li>수집 날짜: <strong>${result.captureDate || '-'}</strong></li>
        <li>총 라이더 수: <strong>${formatNumber(result.totalRiders ?? result.uniqueRiders)}</strong></li>
        <li>총 완료건수: <strong>${formatNumber(result.totalCompleteSum)}</strong></li>
        <li>저장된 라이더 수: <strong>${formatNumber(result.savedCount)}</strong></li>
        <li>중복/키 없음 제외: <strong>${formatNumber((result.duplicateExcluded || 0) + (result.skippedNoKey || 0))}</strong></li>
      </ul>
    `;
  }

  async function loadConfig() {
    const result = await adminApi('/api/admin/baemin-delivery/config');
    if (result.ok) {
      renderConfig(result);
      return;
    }
    renderConfig({ tableExists: false });
    if (result.message) showToast(result.message);
  }

  async function loadLatestSummary() {
    const dateInput = $('baeminDeliveryCaptureDate');
    const captureDate = dateInput?.value || new Date().toISOString().slice(0, 10);
    const result = await adminApi(`/api/admin/baemin-delivery/latest?captureDate=${encodeURIComponent(captureDate)}`);
    if (result.ok && result.savedCount > 0) {
      renderSummary({
        captureDate: result.captureDate,
        totalRiders: result.savedCount,
        uniqueRiders: result.savedCount,
        totalCompleteSum: result.totalCompleteSum,
        savedCount: result.savedCount,
        duplicateExcluded: 0,
        skippedNoKey: 0
      });
    }
  }

  async function runAutoCollect() {
    if (state.loading) return;
    setLoading(true);
    renderSummary(null);

    const captureDate = $('baeminDeliveryCaptureDate')?.value || new Date().toISOString().slice(0, 10);
    const sessionCookie = String($('baeminDeliverySessionCookie')?.value || '').trim();
    const body = { captureDate };
    if (sessionCookie) body.sessionCookie = sessionCookie;

    const result = await adminApi('/api/admin/baemin-delivery/collect', {
      method: 'POST',
      body: JSON.stringify(body)
    });

    setLoading(false);
    if (!result.ok) {
      renderSummary(null, result.message || '배민 자동 수집에 실패했습니다.');
      return;
    }
    renderSummary(result);
    showToast('배민 자동 수집이 완료되었습니다.');
  }

  function openJsonDialog() {
    const dialog = $('baeminDeliveryJsonDialog');
    const textarea = $('baeminDeliveryJsonInput');
    if (textarea) textarea.value = '';
    if (dialog?.showModal) dialog.showModal();
  }

  function closeJsonDialog() {
    const dialog = $('baeminDeliveryJsonDialog');
    if (dialog?.close) dialog.close();
  }

  async function submitJsonImport() {
    const textarea = $('baeminDeliveryJsonInput');
    const raw = String(textarea?.value || '').trim();
    if (!raw) {
      showToast('JSON을 붙여넣으세요.');
      return;
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      showToast('JSON 형식이 올바르지 않습니다.');
      return;
    }

    if (state.loading) return;
    setLoading(true);
    closeJsonDialog();

    const captureDate = $('baeminDeliveryCaptureDate')?.value || new Date().toISOString().slice(0, 10);
    const result = await adminApi('/api/admin/baemin-delivery/import-json', {
      method: 'POST',
      body: JSON.stringify({ payload, captureDate })
    });

    setLoading(false);
    if (!result.ok) {
      renderSummary(null, result.message || 'JSON 저장에 실패했습니다.');
      return;
    }
    renderSummary(result);
    showToast('배민 JSON 데이터가 저장되었습니다.');
  }

  function bindEvents() {
    if (bindEvents.bound) return;
    bindEvents.bound = true;

    $('baeminDeliveryAutoCollectBtn')?.addEventListener('click', () => {
      void runAutoCollect();
    });

    $('baeminDeliveryJsonPasteBtn')?.addEventListener('click', () => {
      openJsonDialog();
    });

    $('baeminDeliveryJsonSubmitBtn')?.addEventListener('click', () => {
      void submitJsonImport();
    });

    $('baeminDeliveryJsonCancelBtn')?.addEventListener('click', () => {
      closeJsonDialog();
    });

    $('baeminDeliveryCaptureDate')?.addEventListener('change', () => {
      void loadLatestSummary();
    });
  }

  async function refresh() {
    bindEvents();
    const dateInput = $('baeminDeliveryCaptureDate');
    if (dateInput && !dateInput.value) {
      dateInput.value = new Date().toISOString().slice(0, 10);
    }
    await loadConfig();
    await loadLatestSummary();
  }

  window.BremBaeminDeliveryStatusAdmin = { refresh };
  bindEvents();
})();
