/**
 * 기사 하단 메뉴.
 * 네이티브 앱 · 설치한 PWA · 휴대폰 화면에서 탭으로 전환.
 * PC 브라우저 큰 화면은 기존 버튼 유지. ?appnav=1 로 강제 가능.
 * 기사대시보드·크루장은 서버에서 부여된 계정만 탭을 보여 준다.
 */
(function () {
  function isStandalonePwa() {
    try {
      return window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
    } catch {
      return false;
    }
  }

  function isPhoneViewport() {
    try {
      return window.matchMedia('(max-width: 900px)').matches;
    } catch {
      return false;
    }
  }

  const wantNav = Boolean(window.BREM_IS_NATIVE_APP)
    || Boolean(window.BREM_IS_INSTALLED_SHELL)
    || isStandalonePwa()
    || isPhoneViewport()
    || /(?:^|[?&])appnav=1(?:&|$)/.test(String(location.search || ''));
  if (!wantNav) return;

  const root = document.documentElement;
  const nav = document.getElementById('driverAppNav');
  const mainApp = document.getElementById('driverMainApp');
  if (!nav) return;

  root.classList.add('brem-app-nav');
  nav.hidden = false;

  const buttons = Array.from(nav.querySelectorAll('[data-driver-tab]'));
  const gated = {
    dash: nav.querySelector('[data-driver-tab="dash"]'),
    crew: nav.querySelector('[data-driver-tab="crew"]')
  };

  let current = 'home';

  function isLoggedIn() {
    return Boolean(mainApp && !mainApp.hidden);
  }

  function setGatedVisible(kind, visible) {
    const btn = gated[kind];
    if (!btn) return;
    btn.hidden = !visible;
    if (!visible && current === kind) setTab('home', { fromGate: true });
  }

  function syncActive() {
    buttons.forEach((btn) => {
      const on = btn.dataset.driverTab === current;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-current', on ? 'page' : 'false');
    });
    root.dataset.driverTab = current;
  }

  function closeAllPanels() {
    window.BremDriverWithdrawal?.close?.();
    window.BremDriverWeeklyPayslip?.close?.();
    window.BremDriverRegionDashboard?.close?.();
    window.BremDriverCrewLeader?.close?.();
    window.BremDriverUrgentMissions?.close?.();
    window.BremDriverInquiries?.close?.();
  }

  function openTabPanel(tab) {
    if (tab === 'notice') return;
    if (tab === 'mission') window.BremDriverUrgentMissions?.open?.();
    else if (tab === 'withdraw') window.BremDriverWithdrawal?.open?.();
    else if (tab === 'payslip') window.BremDriverWeeklyPayslip?.open?.();
    else if (tab === 'dash') window.BremDriverRegionDashboard?.open?.();
    else if (tab === 'crew') window.BremDriverCrewLeader?.open?.();
  }

  function setTab(tab, options = {}) {
    const next = String(tab || 'home');
    if (next !== 'home' && gated[next] && gated[next].hidden) {
      setTab('home');
      return false;
    }
    current = next;
    syncActive();
    if (!options.keepPanels) closeAllPanels();
    if (next === 'home' || next === 'notice') return true;
    openTabPanel(next);
    return true;
  }

  function handleBack() {
    if (!isLoggedIn()) return false;
    if (current === 'home') return false;
    setTab('home');
    return true;
  }

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.driverTab;
      if (!tab || btn.hidden) return;
      if (tab === current) {
        if (tab !== 'home') openTabPanel(tab);
        return;
      }
      setTab(tab);
    });
  });

  document.addEventListener('brem-driver-feature-visibility', (event) => {
    const kind = event?.detail?.kind;
    if (kind !== 'dash' && kind !== 'crew') return;
    setGatedVisible(kind, event.detail.visible);
  });

  if (mainApp) {
    const loginWatcher = new MutationObserver(() => {
      if (!isLoggedIn()) {
        setGatedVisible('dash', false);
        setGatedVisible('crew', false);
        setTab('home', { keepPanels: true });
      }
    });
    loginWatcher.observe(mainApp, { attributes: true, attributeFilter: ['hidden'] });
  }

  setGatedVisible('dash', false);
  setGatedVisible('crew', false);
  setTab('home', { keepPanels: true });
  void window.BremDriverRegionDashboard?.refreshEntryVisibility?.();
  void window.BremDriverCrewLeader?.refreshEntryVisibility?.();

  window.BremDriverAppNav = {
    setTab,
    handleBack,
    getTab() {
      return current;
    }
  };
})();
