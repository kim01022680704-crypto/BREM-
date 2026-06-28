(function () {
  const state = {
    config: null,
    loading: false,
    collecting: false,
    setupPollTimer: null,
    statusPollTimer: null,
    localHealthPollTimer: null,
    localServerRunning: false,
    localBrowser: null,
    localSession: null,
    localAutoCollect: null,
    localSessionConfig: {
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
    updateActionButtons();
  }

  function setCollecting(collecting) {
    state.collecting = collecting;
    updateActionButtons();
  }

  function updateActionButtons() {
    const fullBtn = $('baeminFullCollectBtn');
    const browserBtn = $('baeminBrowserOpenBtn');
    const shutdownBtn = $('baeminServerShutdownBtn');
    const jsonBtn = $('baeminDeliveryJsonPasteBtn');
    const sessionBtn = $('baeminDeliverySessionRefreshBtn');
    const localCollecting = Boolean(state.localAutoCollect?.collectRunning || state.collecting);

    if (fullBtn) {
      fullBtn.disabled = state.loading || localCollecting || !state.localServerRunning;
      fullBtn.textContent = localCollecting ? '이미 수집 중…' : '배민 전체 데이터 수집';
    }
    if (browserBtn) {
      browserBtn.disabled = state.loading || localCollecting || !state.localServerRunning;
    }
    if (shutdownBtn) {
      shutdownBtn.disabled = state.loading || localCollecting || !state.localServerRunning;
    }
    if (jsonBtn) jsonBtn.disabled = state.loading || localCollecting;
    if (sessionBtn) sessionBtn.disabled = state.loading || localCollecting;
  }

  function isSessionExpired(config) {
    if (state.localSession?.state === 'ok' && !state.localSession?.paused) return false;
    if (state.localBrowser?.browserOpen && state.localBrowser?.sessionLoggedIn) return false;
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
    const local = state.localAutoCollect || {};
    const browser = state.localBrowser || {};
    const session = state.localSession || {};
    const localRunning = state.localServerRunning || auto.localServerRecentlyActive;
    const sessionExpired = isSessionExpired(config)
      || session.state === 'expired'
      || Boolean(local.sessionPaused);
    const localCollecting = Boolean(local.collectRunning || state.collecting);
    const scheduleText = (auto.schedule || local.schedule || ['10:00', '14:00', '17:00', '20:00', '23:30']).join(', ');
    const lastCollect = local.lastCollectResult || {};

    el.className = sessionExpired
      ? 'baemin-auto-collect-panel baemin-auto-collect-panel--paused'
      : 'baemin-auto-collect-panel';

    const lastRunAt = local.lastRunAt || auto.lastRunAt;
    const lastStatus = local.lastStatus || auto.lastStatus;
    const lastError = local.lastError || auto.lastError;

    const lastRunSummary = lastStatus === 'success'
      ? `${formatStatusLabel(lastStatus)} · ${formatNumber(local.lastSavedCount || auto.lastSavedCount || lastCollect.savedTotal || 0)}건`
      : (lastStatus === 'failed'
        ? `${formatStatusLabel(lastStatus)}${lastError ? ` — ${lastError}` : ''}`
        : (lastCollect.message || '-'));

    const sessionStateLabel = sessionExpired
      ? '만료 — 갱신 필요'
      : (session.state === 'ok' || config?.sessionConfigured ? '정상' : '없음');

    el.innerHTML = `
      <strong>로컬 자동수집 서버</strong>
      <dl class="baemin-auto-collect-grid">
        <div>
          <dt>로컬 서버</dt>
          <dd>${localRunning ? '실행 중' : '중지됨'}</dd>
        </div>
        <div>
          <dt>Playwright 브라우저</dt>
          <dd>${browser.browserOpen ? '유지 중' : '닫힘/미실행'}</dd>
        </div>
        <div>
          <dt>세션 상태</dt>
          <dd>${sessionStateLabel}</dd>
        </div>
        <div>
          <dt>현재 수집 중</dt>
          <dd>${localCollecting ? '예 — 이미 수집 중입니다' : '아니오'}</dd>
        </div>
        <div>
          <dt>마지막 수집</dt>
          <dd>${formatDateTime(lastRunAt || lastCollect.at)}</dd>
        </div>
        <div>
          <dt>마지막 결과</dt>
          <dd>${lastRunSummary}</dd>
        </div>
        <div>
          <dt>다음 자동 수집</dt>
          <dd>${localRunning && !sessionExpired ? formatDateTime(local.nextScheduledAt || auto.nextScheduledAt) : '-'}</dd>
        </div>
        <div>
          <dt>브라우저 URL</dt>
          <dd style="word-break:break-all;font-size:0.82rem">${browser.currentUrl || '-'}</dd>
        </div>
      </dl>
      <p class="baemin-auto-collect-schedule">스케줄(KST): ${scheduleText} · PC에서 <code>npm run baemin:session-server</code> 실행 · 수집 후에도 브라우저 유지</p>
    `;

    updateActionButtons();
  }

  function renderMenuCollectStatus(config) {
    const el = $('baeminDeliveryMenuCollectStatus');
    if (!el) return;

    const menus = config?.menuStatus || config?.autoCollect?.menuStatus || [];
    if (!menus.length) {
      el.innerHTML = '<strong>메뉴별 수집</strong><p class="form-help">아직 수집 기록이 없습니다.</p>';
      return;
    }

    const rows = menus.map(menu => {
      const statusClass = menu.lastStatus === 'success'
        ? 'baemin-menu-collect-status--success'
        : (menu.lastStatus === 'failed' ? 'baemin-menu-collect-status--failed' : 'baemin-menu-collect-status--idle');
      const statusLabel = menu.lastStatus === 'success'
        ? '성공'
        : (menu.lastStatus === 'failed' ? '실패' : '-');
      const errorText = menu.lastStatus === 'failed' && menu.lastError
        ? `<br><span style="font-size:0.8rem">${menu.lastError}</span>`
        : '';
      return `
        <tr>
          <td>${menu.label || menu.id}</td>
          <td>${formatDateTime(menu.lastCollectedAt)}</td>
          <td class="${statusClass}">${statusLabel}${errorText}</td>
          <td>${formatNumber(menu.rowCount || 0)}</td>
        </tr>
      `;
    }).join('');

    el.innerHTML = `
      <strong>메뉴별 수집 상태</strong>
      <table class="baemin-menu-collect-table">
        <thead>
          <tr>
            <th>수집 대상</th>
            <th>마지막 수집</th>
            <th>결과</th>
            <th>저장 건수</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  function renderConfig(config) {
    state.config = config;
    const hint = $('baeminDeliveryConfigHint');
    if (!hint) return;

    renderSessionStatus(config);
    renderAutoCollectStatus(config);
    renderMenuCollectStatus(config);

    const missingLegacy = !config?.tableExists;
    const missingBiz = config?.bizCollectTableExists === false;

      if (missingLegacy || missingBiz) {
      hint.textContent = 'Supabase 테이블이 없습니다. supabase/baemin_all_migrations.sql 내용 전체를 SQL Editor에 붙여넣고 Run 하세요.';
      hint.className = 'form-help form-help--warn';
      return;
    }

    hint.textContent = '자동 수집은 PC 로컬 세션 서버가 켜져 있을 때만 동작합니다. 세션은 Supabase settings에 저장됩니다.';
    hint.className = 'form-help';
  }

  function todayKstDate() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
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

    const savedCount = Number(result.savedCount || 0);
    if (savedCount <= 0) {
      box.hidden = false;
      box.className = 'baemin-collect-result baemin-collect-result--error';
      box.innerHTML = `
        <strong>저장된 데이터 없음</strong>
        <p>수집 API는 호출됐지만 Supabase에 저장된 건수가 0입니다.</p>
        <ul class="baemin-collect-stats">
          <li>1) Supabase SQL Editor에서 <code>baemin_all_migrations.sql</code> 실행</li>
          <li>2) [배민 세션 갱신] 후 세션 연결됨 확인</li>
          <li>3) 수집 날짜를 <strong>오늘(KST)</strong>로 맞추기</li>
        </ul>
        ${renderMenuResultsList(result.menuResults || result.results)}
      `;
      return;
    }

    box.hidden = false;
    box.className = 'baemin-collect-result baemin-collect-result--success';
    const range = result.dateRange;
    const totals = result.summaryTotals || {};
    box.innerHTML = `
      <strong>수집 완료</strong>
      <ul class="baemin-collect-stats">
        <li>수집 기준일: <strong>${result.captureDate || '-'}</strong></li>
        <li>정산주 범위: <strong>${range ? `${range.fromDate} ~ ${range.toDate}` : '-'}</strong></li>
        <li>수집일수: <strong>${formatNumber(totals.dayCount || range?.dayCount || 0)}</strong></li>
        <li>라이더수: <strong>${formatNumber(totals.riderCount || 0)}</strong></li>
        <li>총 저장 건수: <strong>${formatNumber(result.savedCount)}</strong></li>
        <li>완료합계: <strong>${formatNumber(totals.completeTotal || result.totalCompleteSum || 0)}</strong></li>
        <li>거절합계: <strong>${formatNumber(totals.rejectTotal || 0)}</strong></li>
        <li>취소합계: <strong>${formatNumber(totals.cancelTotal || 0)}</strong></li>
      </ul>
      ${renderMenuResultsList(result.menuResults)}
    `;
  }

  function renderMenuResultsList(menuResults) {
    if (!menuResults || typeof menuResults !== 'object') return '';
    const items = Object.entries(menuResults).map(([id, row]) => {
      const label = row.label || id;
      const status = row.ok ? '성공' : '실패';
      const detail = row.ok
        ? `${formatNumber(row.savedCount || 0)}건`
        : (row.message || row.error || '실패');
      return `<li>${label}: <strong>${status}</strong> (${detail})</li>`;
    });
    if (!items.length) return '';
    return `<ul class="baemin-collect-stats">${items.join('')}</ul>`;
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
    (state.localSessionConfig?.localHealthUrls || []).forEach(push);

    const port = setup?.localSessionPort
      || config?.localSessionPort
      || state.localSessionConfig?.port
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
        state.localSessionConfig = {
          ...state.localSessionConfig,
          ...payload.baeminSessionLocal
        };
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
          state.localSessionConfig = {
            ...state.localSessionConfig,
            port: payload.port
          };
        }
        return {
          running: true,
          autoCollect: payload.autoCollect || null,
          browser: payload.browser || null,
          session: payload.session || null,
          version: payload.version || '',
          healthUrl
        };
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
    state.localBrowser = local.browser;
    state.localSession = local.session;
    if (state.config) renderAutoCollectStatus(state.config);
    updateActionButtons();
  }

  function getLocalServerBaseUrl() {
    const port = state.localSessionConfig?.port || 3939;
    return `http://127.0.0.1:${port}`;
  }

  async function callLocalServer(path, options = {}) {
    const base = getLocalServerBaseUrl();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || 120000);
    try {
      const response = await fetch(`${base}${path}`, {
        method: options.method || 'GET',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        body: options.body != null ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
        cache: 'no-store',
        mode: 'cors'
      });
      clearTimeout(timer);
      const payload = await response.json().catch(() => ({}));
      return { ok: response.ok, status: response.status, ...payload };
    } catch (error) {
      clearTimeout(timer);
      return { ok: false, message: error.message || '로컬 서버 연결 실패' };
    }
  }

  async function openLocalBrowser() {
    if (state.loading || state.collecting) return;

    const local = await fetchLocalHealth(state.config, null);
    state.localServerRunning = local.running;
    if (!local.running) {
      showToast('로컬 세션 서버가 실행 중이 아닙니다. npm run baemin:session-server 를 실행하세요.');
      return;
    }

    setLoading(true);
    const result = await callLocalServer('/browser/open', { method: 'POST', timeoutMs: 60000 });
    setLoading(false);
    await refreshLocalServerStatus();

    if (!result.ok) {
      showToast(result.message || '브라우저 열기에 실패했습니다.');
      return;
    }
    showToast(result.message || 'Playwright 브라우저를 열었습니다.');
  }

  async function runFullCollect() {
    if (state.loading || state.collecting) return;

    const local = await fetchLocalHealth(state.config, null);
    state.localServerRunning = local.running;
    if (!local.running) {
      showToast('로컬 세션 서버가 실행 중이 아닙니다. npm run baemin:session-server 를 실행하세요.');
      return;
    }

    if (local.autoCollect?.collectRunning) {
      showToast('이미 수집 중입니다.');
      return;
    }

    setCollecting(true);
    renderSummary(null);

    const captureDate = $('baeminDeliveryCaptureDate')?.value || todayKstDate();
    const result = await callLocalServer('/collect/full', {
      method: 'POST',
      body: { collectDate: captureDate },
      timeoutMs: 300000
    });

    await refreshLocalServerStatus();
    setCollecting(false);

    if (result.status === 409 && result.message?.includes('이미 수집')) {
      showToast('이미 수집 중입니다.');
      return;
    }

    if (!result.ok) {
      renderSummary(null, result.message || '배민 전체 데이터 수집에 실패했습니다.');
      await loadConfig();
      return;
    }

    const savedCount = Number(result.savedCount || 0);
    const menuResults = result.results
      ? Object.fromEntries(Object.entries(result.results).map(([id, row]) => [id, {
        label: row.label || id,
        ok: row.ok,
        savedCount: row.savedCount,
        message: row.message
      }]))
      : null;

    if (savedCount <= 0) {
      renderSummary({
        captureDate: result.collectDate || captureDate,
        savedCount,
        totalCompleteSum: result.totalCompleteSum,
        menuResults
      }, result.message || '저장된 데이터가 0건입니다.');
      await loadConfig();
      return;
    }

    renderSummary({
      captureDate: result.collectDate || captureDate,
      savedCount,
      totalCompleteSum: result.summaryTotals?.completeTotal || result.totalCompleteSum,
      summaryTotals: result.summaryTotals,
      dateRange: result.dateRange,
      menuResults
    });
    showToast(`배민 전체 데이터 수집 완료 — ${formatNumber(savedCount)}건 저장`);
    await loadConfig();
    await loadAllSubtabData();
  }

  async function shutdownLocalServer() {
    if (state.loading || state.collecting) return;

    const local = await fetchLocalHealth(state.config, null);
    if (!local.running) {
      showToast('로컬 세션 서버가 이미 중지되어 있습니다.');
      return;
    }

    if (!window.confirm('자동수집 서버를 종료합니다. Playwright 브라우저도 함께 닫힙니다. 계속할까요?')) {
      return;
    }

    setLoading(true);
    const result = await callLocalServer('/shutdown', { method: 'POST', timeoutMs: 10000 });
    setLoading(false);

    state.localServerRunning = false;
    state.localBrowser = null;
    state.localAutoCollect = null;
    if (state.config) renderAutoCollectStatus(state.config);

    showToast(result.message || '자동수집 서버 종료를 요청했습니다.');
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
    const portLabel = setup.localSessionPort || state.localSessionConfig?.port || 3939;
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
    const captureDate = dateInput?.value || todayKstDate();
    const result = await adminApi(`/api/admin/baemin-delivery/latest?captureDate=${encodeURIComponent(captureDate)}`);
    if (result.ok && result.savedCount > 0) {
      renderSummary({
        captureDate: result.captureDate,
        savedCount: result.savedCount,
        totalCompleteSum: result.totalCompleteSum,
        menuResults: result.byMenu
          ? Object.fromEntries(Object.entries(result.byMenu).map(([id, count]) => [id, {
            label: id,
            ok: true,
            savedCount: count
          }]))
          : null
      });
    }
  }

  async function loadSubtabData(sourceMenu) {
    const captureDate = $('baeminDeliveryCaptureDate')?.value || todayKstDate();
    const result = await adminApi(
      `/api/admin/baemin-delivery/items?collectDate=${encodeURIComponent(captureDate)}&sourceMenu=${encodeURIComponent(sourceMenu)}`
    );

    const summaryMap = {
      delivery_status: 'baeminDeliveryStatusSummary',
      daily_history: 'baeminDailyHistorySummary',
      rider_history: 'baeminRiderHistorySummary'
    };
    const rowsMap = {
      delivery_status: 'baeminDeliveryStatusRows',
      daily_history: 'baeminDailyHistoryRows',
      rider_history: 'baeminRiderHistoryRows'
    };

    const summaryEl = $(summaryMap[sourceMenu]);
    const rowsEl = $(rowsMap[sourceMenu]);
    if (!rowsEl) return;

    if (!result.ok) {
      if (summaryEl) summaryEl.textContent = result.message || '데이터를 불러오지 못했습니다.';
      rowsEl.innerHTML = '';
      return;
    }

    const items = result.items || [];
    if (summaryEl) {
      summaryEl.textContent = `${captureDate} · ${formatNumber(items.length)}건`;
    }

    if (!items.length) {
      rowsEl.innerHTML = '<tr><td colspan="6" class="form-help">수집된 데이터가 없습니다. [배민 전체 데이터 수집]을 실행하세요.</td></tr>';
      return;
    }

    if (sourceMenu === 'delivery_status') {
      rowsEl.innerHTML = items.map(row => {
        const p = row.parsed_json || {};
        return `<tr>
          <td>${row.rider_name || '-'}</td>
          <td>${row.rider_user_id || '-'}</td>
          <td>${row.phone_number || '-'}</td>
          <td>${formatNumber(p.totalComplete || 0)}</td>
          <td>${formatNumber(p.foodReject || 0)}</td>
          <td>${formatNumber(p.cancelCount || 0)}</td>
          <td>${formatNumber(p.morningCount || 0)}</td>
          <td>${formatNumber(p.afternoonCount || 0)}</td>
          <td>${formatNumber(p.eveningCount || 0)}</td>
          <td>${formatNumber(p.midnightCount || 0)}</td>
          <td>${formatDateTime(row.collected_at)}</td>
        </tr>`;
      }).join('');
      return;
    }

    if (sourceMenu === 'daily_history') {
      rowsEl.innerHTML = items.map(row => {
        const p = row.parsed_json || {};
        return `<tr>
          <td>${p.deliveryDate || row.collect_date || '-'}</td>
          <td>${formatNumber(p.totalComplete || 0)}</td>
          <td>${formatNumber(p.foodReject || 0)}</td>
          <td>${formatNumber(p.cancelCount || 0)}</td>
          <td>${formatNumber(p.morningCount || 0)}</td>
          <td>${formatNumber(p.afternoonCount || 0)}</td>
          <td>${formatNumber(p.eveningCount || 0)}</td>
          <td>${formatNumber(p.midnightCount || 0)}</td>
          <td>${formatDateTime(row.collected_at)}</td>
        </tr>`;
      }).join('');
      return;
    }

    rowsEl.innerHTML = items.map(row => {
      const p = row.parsed_json || {};
      const deliveryCount = Number(row.raw_json?.deliveryCount || p.totalComplete || 0);
      return `<tr>
        <td>${row.rider_name || '-'}</td>
        <td>${row.rider_user_id || '-'}</td>
        <td>${row.phone_number || '-'}</td>
        <td>${formatNumber(p.totalComplete || deliveryCount || 0)}</td>
        <td>${formatNumber(p.foodReject || 0)}</td>
        <td>${formatNumber(p.cancelCount || 0)}</td>
        <td>${formatNumber(p.morningCount || 0)}</td>
        <td>${formatNumber(p.afternoonCount || 0)}</td>
        <td>${formatNumber(p.eveningCount || 0)}</td>
        <td>${formatNumber(p.midnightCount || 0)}</td>
        <td>${formatDateTime(row.collected_at)}</td>
      </tr>`;
    }).join('');
  }

  function switchBaeminSubtab(tabId) {
    state.activeSubtab = tabId;
    document.querySelectorAll('[data-baemin-subtab]').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.baeminSubtab === tabId);
    });
    document.querySelectorAll('[data-baemin-panel]').forEach(panel => {
      const active = panel.dataset.baeminPanel === tabId;
      panel.hidden = !active;
    });
    if (tabId !== 'collect') {
      void loadSubtabData(tabId);
    }
  }

  async function loadAllSubtabData() {
    await Promise.all([
      loadSubtabData('delivery_status'),
      loadSubtabData('daily_history'),
      loadSubtabData('rider_history')
    ]);
  }

  async function runAutoCollect() {
    return runFullCollect();
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

    $('baeminBrowserOpenBtn')?.addEventListener('click', () => {
      void openLocalBrowser();
    });

    $('baeminFullCollectBtn')?.addEventListener('click', () => {
      void runFullCollect();
    });

    $('baeminServerShutdownBtn')?.addEventListener('click', () => {
      void shutdownLocalServer();
    });

    $('baeminDeliveryAutoCollectBtn')?.addEventListener('click', () => {
      void runFullCollect();
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
      if (state.activeSubtab && state.activeSubtab !== 'collect') {
        void loadSubtabData(state.activeSubtab);
      }
    });

    document.querySelectorAll('[data-baemin-subtab]').forEach(btn => {
      btn.addEventListener('click', () => {
        switchBaeminSubtab(btn.dataset.baeminSubtab || 'collect');
      });
    });
  }

  async function refresh() {
    bindEvents();
    stopStatusPoll();
    await loadPublicLocalSessionConfig();
    const dateInput = $('baeminDeliveryCaptureDate');
    if (dateInput && !dateInput.value) {
      dateInput.value = todayKstDate();
    }
    await loadConfig();
    await loadLatestSummary();
    await loadAllSubtabData();

    state.statusPollTimer = setInterval(async () => {
      await loadConfig();
    }, 15000);

    stopLocalHealthPoll();
    state.localHealthPollTimer = setInterval(async () => {
      await refreshLocalServerStatus();
    }, 4000);
  }

  function stopLocalHealthPoll() {
    if (state.localHealthPollTimer) {
      clearInterval(state.localHealthPollTimer);
      state.localHealthPollTimer = null;
    }
  }

  function stopPolling() {
    stopStatusPoll();
    stopLocalHealthPoll();
    stopSetupPoll();
  }

  window.BremBaeminDeliveryStatusAdmin = { refresh, stopPolling };
  bindEvents();
})();
