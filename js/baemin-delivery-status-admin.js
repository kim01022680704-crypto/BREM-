(function () {
  const state = {
    config: null,
    loading: false,
    setupPollTimer: null,
    statusPollTimer: null,
    localServerRunning: false,
    localAutoCollect: null,
    localSession: {
      port: 3939,
      localHealthUrls: [
        'http://127.0.0.1:3939/health',
        'http://localhost:3939/health'
      ]
    }
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

  function formatDateTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  }

  function formatStatusLabel(status) {
    if (status === 'success') return '성공';
    if (status === 'failed') return '실패';
    return '-';
  }

  function setLoading(loading) {
    state.loading = loading;
    const autoBtn = $('baeminDeliveryAutoCollectBtn');
    const jsonBtn = $('baeminDeliveryJsonPasteBtn');
    const sessionBtn = $('baeminDeliverySessionRefreshBtn');
    if (autoBtn) {
      autoBtn.disabled = loading;
      autoBtn.textContent = loading ? '수집 중…' : '배민 자동 수집';
    }
    if (jsonBtn) jsonBtn.disabled = loading;
    if (sessionBtn) sessionBtn.disabled = loading;
  }

  function isSessionExpired(config) {
    return Boolean(config?.sessionLastError || config?.autoCollect?.sessionExpired || config?.autoCollect?.sessionPaused);
  }

  function renderSessionStatus(config) {
    const el = $('baeminDeliverySessionStatus');
    if (!el) return;

    if (isSessionExpired(config)) {
      el.className = 'baemin-session-status baemin-session-status--error';
      const message = config?.sessionLastError || config?.autoCollect?.lastError || '배민 로그인 만료';
      el.innerHTML = `<strong>세션 만료 — 배민 세션 갱신 필요</strong> — ${message} · <button type="button" class="link-btn" id="baeminSessionRefreshInlineBtn">세션 갱신</button>`;
      $('baeminSessionRefreshInlineBtn')?.addEventListener('click', () => void startSessionRefresh());
      return;
    }

    if (config?.sessionConfigured) {
      el.className = 'baemin-session-status baemin-session-status--ok';
      el.innerHTML = `
        <strong>배민 세션 연결됨</strong>
        · 갱신: ${formatDateTime(config.sessionUpdatedAt)}
        · 확인: ${formatDateTime(config.sessionLastValidatedAt)}
      `;
      return;
    }

    el.className = 'baemin-session-status baemin-session-status--warn';
    el.innerHTML = '<strong>배민 세션 없음</strong> — [배민 세션 갱신]으로 로그인하세요.';
  }

  function renderAutoCollectStatus(config) {
    const el = $('baeminDeliveryAutoCollectStatus');
    if (!el) return;

    const auto = config?.autoCollect || {};
    const localRunning = state.localServerRunning || auto.localServerRecentlyActive;
    const sessionExpired = isSessionExpired(config);
    const scheduleText = (auto.schedule || ['10:00', '14:00', '17:00', '20:00', '23:30']).join(', ');

    el.className = sessionExpired
      ? 'baemin-auto-collect-panel baemin-auto-collect-panel--paused'
      : 'baemin-auto-collect-panel';

    const lastRunSummary = auto.lastStatus === 'success'
      ? `${formatStatusLabel(auto.lastStatus)} · ${formatNumber(auto.lastSavedCount)}명 · 완료 ${formatNumber(auto.lastTotalCompleteSum)}건`
      : formatStatusLabel(auto.lastStatus);

    el.innerHTML = `
      <strong>자동 수집 (PC 로컬 서버)</strong>
      <dl class="baemin-auto-collect-grid">
        <div>
          <dt>마지막 수집</dt>
          <dd>${formatDateTime(auto.lastRunAt)}</dd>
        </div>
        <div>
          <dt>마지막 결과</dt>
          <dd>${lastRunSummary}${auto.lastError && auto.lastStatus === 'failed' ? `<br><span style="font-weight:600;font-size:0.82rem">${auto.lastError}</span>` : ''}</dd>
        </div>
        <div>
          <dt>세션 상태</dt>
          <dd>${sessionExpired ? '만료 — 갱신 필요' : (config?.sessionConfigured ? '정상' : '없음')}</dd>
        </div>
        <div>
          <dt>로컬 서버</dt>
          <dd>${localRunning ? '실행 중' : '중지됨'}</dd>
        </div>
        <div>
          <dt>다음 자동 수집</dt>
          <dd>${localRunning && !sessionExpired ? formatDateTime(auto.nextScheduledAt) : '-'}</dd>
        </div>
      </dl>
      <p class="baemin-auto-collect-schedule">스케줄(KST): ${scheduleText} · PC에서 <code>npm run baemin:session-server</code> 실행 시 자동 수집</p>
    `;
  }

  function renderConfig(config) {
    state.config = config;
    const hint = $('baeminDeliveryConfigHint');
    if (!hint) return;

    renderSessionStatus(config);
    renderAutoCollectStatus(config);

    if (!config?.tableExists) {
      hint.textContent = 'Supabase 테이블이 없습니다. supabase/baemin_delivery_status_migration.sql 을 SQL Editor에서 실행하세요.';
      hint.className = 'form-help form-help--warn';
      return;
    }

    hint.textContent = '자동 수집은 PC 로컬 세션 서버가 켜져 있을 때만 동작합니다. 세션은 Supabase settings에 저장됩니다.';
    hint.className = 'form-help';
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

  function stopSetupPoll() {
    if (state.setupPollTimer) {
      clearInterval(state.setupPollTimer);
      state.setupPollTimer = null;
    }
  }

  function stopStatusPoll() {
    if (state.statusPollTimer) {
      clearInterval(state.statusPollTimer);
      state.statusPollTimer = null;
    }
  }

  function renderSetupDialog(contentHtml) {
    const dialog = $('baeminDeliverySessionDialog');
    const body = $('baeminDeliverySessionDialogBody');
    if (body) body.innerHTML = contentHtml;
    if (dialog?.showModal) dialog.showModal();
  }

  function closeSetupDialog() {
    stopSetupPoll();
    const dialog = $('baeminDeliverySessionDialog');
    if (dialog?.close) dialog.close();
  }

  function collectLocalHealthUrls(config, setup) {
    const urls = [];
    const push = value => {
      const text = String(value || '').trim();
      if (text && !urls.includes(text)) urls.push(text);
    };

    (setup?.localHealthUrls || []).forEach(push);
    push(setup?.localHealthUrl);
    (config?.localHealthUrls || []).forEach(push);
    push(config?.localHealthUrl);
    (state.localSession?.localHealthUrls || []).forEach(push);

    const port = setup?.localSessionPort
      || config?.localSessionPort
      || state.localSession?.port
      || 3939;
    push(`http://127.0.0.1:${port}/health`);
    push(`http://localhost:${port}/health`);

    return urls;
  }

  async function loadPublicLocalSessionConfig() {
    try {
      const response = await fetch('/api/public-config', { cache: 'no-store' });
      if (!response.ok) return;
      const payload = await response.json().catch(() => ({}));
      if (payload?.baeminSessionLocal) {
        state.localSession = payload.baeminSessionLocal;
      }
    } catch {
      // ignore — defaults remain
    }
  }

  async function fetchLocalHealth(config, setup) {
    const healthUrls = collectLocalHealthUrls(config, setup);
    for (const healthUrl of healthUrls) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2000);
        const response = await fetch(healthUrl, {
          signal: controller.signal,
          cache: 'no-store',
          mode: 'cors'
        });
        clearTimeout(timer);
        if (!response.ok) continue;
        const payload = await response.json().catch(() => ({}));
        if (payload?.port) {
          state.localSession = {
            ...state.localSession,
            port: payload.port
          };
        }
        return { running: true, autoCollect: payload.autoCollect || null, healthUrl };
      } catch {
        // try next host/port candidate
      }
    }
    return { running: false, autoCollect: null, healthUrl: healthUrls[0] || '' };
  }

  async function refreshLocalServerStatus() {
    const local = await fetchLocalHealth(state.config, null);
    state.localServerRunning = local.running;
    state.localAutoCollect = local.autoCollect;
    if (state.config) renderAutoCollectStatus(state.config);
  }

  function pollSessionSetup(setupId) {
    stopSetupPoll();
    state.setupPollTimer = setInterval(async () => {
      const status = await adminApi(`/api/admin/baemin-delivery/session/setup?setupId=${encodeURIComponent(setupId)}`);
      if (!status.ok) return;

      if (status.status === 'completed') {
        stopSetupPoll();
        renderSetupDialog('<p><strong>세션 저장 완료!</strong> 창을 닫으면 자동 수집이 재개됩니다.</p>');
        await loadConfig();
        showToast('배민Biz 세션이 저장되었습니다.');
        return;
      }

      if (status.status === 'failed' || status.status === 'expired') {
        stopSetupPoll();
        renderSetupDialog(`<p class="form-help form-help--warn">${status.message || '세션 갱신에 실패했습니다.'}</p>`);
      }
    }, 2000);
  }

  async function startSessionRefresh() {
    if (state.loading) return;
    setLoading(true);

    const setup = await adminApi('/api/admin/baemin-delivery/session/setup', { method: 'POST', body: '{}' });
    setLoading(false);

    if (!setup.ok) {
      showToast(setup.message || '세션 갱신 준비에 실패했습니다.');
      return;
    }

    const localRunning = await fetchLocalHealth(state.config, setup);
    state.localServerRunning = localRunning.running;
    const portLabel = setup.localSessionPort || state.localSession?.port || 3939;
    const instructions = localRunning.running
      ? `<p>로컬 세션 서버가 실행 중입니다. (포트 ${portLabel})</p><p>브라우저 창에서 배민Biz 로그인·휴대폰 인증을 완료하세요.</p>`
      : `<p><strong>로컬 세션 서버에 연결하지 못했습니다.</strong></p>
         <p>PC 터미널에서 프로젝트 폴더로 이동 후 아래 명령을 실행하세요:</p>
         <pre class="baemin-cli-block">npm run baemin:session-server</pre>
         <p>기본 포트: <strong>${portLabel}</strong> · 확인 URL: <code>${localRunning.healthUrl || setup.localHealthUrl || `http://127.0.0.1:${portLabel}/health`}</code></p>
         <p>서버 실행 후 ERP에서 [배민 세션 갱신]을 다시 누르거나 아래 URL을 브라우저에서 엽니다:</p>
         <pre class="baemin-cli-block">${setup.startUrl}</pre>`;

    renderSetupDialog(`${instructions}<p class="hint">완료되면 이 창이 자동으로 갱신됩니다.</p>`);

    if (setup.startUrl) {
      window.open(setup.startUrl, '_blank', 'noopener,noreferrer,width=520,height=720');
    }

    pollSessionSetup(setup.setupId);
  }

  async function saveManualCookie() {
    const cookie = String($('baeminDeliverySessionCookie')?.value || '').trim();
    if (!cookie) {
      showToast('쿠키를 입력하세요.');
      return;
    }
    const result = await adminApi('/api/admin/baemin-delivery/session', {
      method: 'POST',
      body: JSON.stringify({ cookie })
    });
    if (!result.ok) {
      showToast(result.message || '쿠키 저장에 실패했습니다.');
      return;
    }
    showToast('비상용 쿠키가 저장되었습니다.');
    await loadConfig();
  }

  async function loadConfig() {
    const result = await adminApi('/api/admin/baemin-delivery/config');
    if (result.ok) {
      renderConfig(result);
      await refreshLocalServerStatus();
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
    const advancedOpen = $('baeminDeliveryAdvancedPanel')?.open;
    const sessionCookie = advancedOpen
      ? String($('baeminDeliverySessionCookie')?.value || '').trim()
      : '';
    const body = { captureDate };
    if (sessionCookie) body.sessionCookie = sessionCookie;

    const result = await adminApi('/api/admin/baemin-delivery/collect', {
      method: 'POST',
      body: JSON.stringify(body)
    });

    setLoading(false);
    if (!result.ok) {
      renderSummary(null, result.message || '배민 자동 수집에 실패했습니다.');
      await loadConfig();
      return;
    }
    renderSummary(result);
    showToast('배민 자동 수집이 완료되었습니다.');
    await loadConfig();
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

    $('baeminDeliverySessionRefreshBtn')?.addEventListener('click', () => {
      void startSessionRefresh();
    });

    $('baeminDeliveryAutoCollectBtn')?.addEventListener('click', () => {
      void runAutoCollect();
    });

    $('baeminDeliveryJsonPasteBtn')?.addEventListener('click', () => {
      openJsonDialog();
    });

    $('baeminDeliveryManualCookieSaveBtn')?.addEventListener('click', () => {
      void saveManualCookie();
    });

    $('baeminDeliveryJsonSubmitBtn')?.addEventListener('click', () => {
      void submitJsonImport();
    });

    $('baeminDeliveryJsonCancelBtn')?.addEventListener('click', () => {
      closeJsonDialog();
    });

    $('baeminDeliverySessionDialogCloseBtn')?.addEventListener('click', () => {
      closeSetupDialog();
    });

    $('baeminDeliveryCaptureDate')?.addEventListener('change', () => {
      void loadLatestSummary();
    });
  }

  async function refresh() {
    bindEvents();
    stopStatusPoll();
    await loadPublicLocalSessionConfig();
    const dateInput = $('baeminDeliveryCaptureDate');
    if (dateInput && !dateInput.value) {
      dateInput.value = new Date().toISOString().slice(0, 10);
    }
    await loadConfig();
    await loadLatestSummary();

    state.statusPollTimer = setInterval(async () => {
      await loadConfig();
    }, 15000);
  }

  function stopPolling() {
    stopStatusPoll();
    stopSetupPoll();
  }

  window.BremBaeminDeliveryStatusAdmin = { refresh, stopPolling };
  bindEvents();
})();
