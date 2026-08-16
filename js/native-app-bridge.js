/**
 * BREM 네이티브 앱(Capacitor) 브리지 — 라이더 Android/iOS WebView용
 * - PWA 설치 UI 숨김
 * - 하드웨어 뒤로가기
 * - 외부 링크는 같은 WebView(_self)에서 열기
 * - 로그인 유지(앱 전용)
 * - 오프라인 안내
 */
(function () {
  var OFFLINE_ID = 'bremNativeOfflineBanner';

  function isCapacitorNative() {
    try {
      return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function'
        && window.Capacitor.isNativePlatform());
    } catch {
      return false;
    }
  }

  function isStandaloneDisplay() {
    try {
      return window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
    } catch {
      return false;
    }
  }

  function isOnline() {
    try {
      return navigator.onLine !== false;
    } catch {
      return true;
    }
  }

  window.BREM_IS_NATIVE_APP = isCapacitorNative();
  window.BREM_IS_INSTALLED_SHELL = window.BREM_IS_NATIVE_APP || isStandaloneDisplay();

  function hidePwaInstallUi() {
    if (!window.BREM_IS_INSTALLED_SHELL) return;
    var wrap = document.getElementById('bremPwaInstallWrap');
    if (wrap) wrap.hidden = true;
    document.documentElement.classList.add('brem-native-app');
    if (window.BREM_IS_NATIVE_APP) {
      document.documentElement.classList.add('brem-capacitor-app');
    }
  }

  function persistNativeRiderSession() {
    if (!window.BREM_IS_NATIVE_APP) return;
    try {
      window.BremLoginPrefs?.setKeepLoggedIn?.('rider', true);
    } catch {
      /* ignore */
    }
    var keep = document.getElementById('driverKeepLoggedIn');
    var keepLabel = keep && keep.closest ? keep.closest('.login-option') : null;
    if (keep) keep.checked = true;
    if (keepLabel) keepLabel.hidden = true;
  }

  function ensureOfflineBanner() {
    var banner = document.getElementById(OFFLINE_ID);
    if (banner) return banner;
    banner = document.createElement('div');
    banner.id = OFFLINE_ID;
    banner.className = 'brem-native-offline';
    banner.hidden = true;
    banner.innerHTML = '<p>인터넷 연결을 확인해주세요.</p><button type="button">다시 시도</button>';
    banner.querySelector('button').addEventListener('click', function () {
      if (isOnline()) {
        hideOfflineBanner();
        try { window.location.reload(); } catch { /* ignore */ }
      }
    });
    document.body.appendChild(banner);
    return banner;
  }

  function showOfflineBanner() {
    if (!window.BREM_IS_NATIVE_APP) return;
    var banner = ensureOfflineBanner();
    banner.hidden = false;
  }

  function hideOfflineBanner() {
    var banner = document.getElementById(OFFLINE_ID);
    if (banner) banner.hidden = true;
  }

  function syncOfflineBanner() {
    if (!window.BREM_IS_NATIVE_APP) return;
    if (isOnline()) hideOfflineBanner();
    else showOfflineBanner();
  }

  function bindNetworkBanner() {
    if (!window.BREM_IS_NATIVE_APP) return;
    window.addEventListener('online', syncOfflineBanner);
    window.addEventListener('offline', syncOfflineBanner);
    syncOfflineBanner();
  }

  function bindBackButton() {
    if (!window.BREM_IS_NATIVE_APP) return;
    var CapApp = window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (!CapApp || typeof CapApp.addListener !== 'function') return;

    CapApp.addListener('backButton', function (event) {
      try {
        if (window.BremDriverAppNav && typeof window.BremDriverAppNav.handleBack === 'function') {
          if (window.BremDriverAppNav.handleBack()) return;
        }
        if (window.history.length > 1) {
          window.history.back();
          return;
        }
      } catch {
        /* ignore */
      }
      if (event && event.canGoBack) return;
      CapApp.exitApp();
    });
  }

  function getPushPlugin() {
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.PushNotifications;
  }

  var pendingPushToken = '';
  var pushListenersBound = false;

  function savePendingPushToken() {
    if (!pendingPushToken || !window.BremStorage || !window.BremStorage.registerRiderPushTokenOnServer) return;
    void window.BremStorage.registerRiderPushTokenOnServer(pendingPushToken);
  }

  function bindPushListeners() {
    var Push = getPushPlugin();
    if (!Push || pushListenersBound) return;
    pushListenersBound = true;

    if (typeof Push.createChannel === 'function') {
      Push.createChannel({
        id: 'brem_urgent',
        name: '긴급미션',
        importance: 5,
        visibility: 1,
        sound: 'default'
      }).catch(function () { /* ignore */ });
    }

    Push.addListener('registration', function (event) {
      pendingPushToken = event && event.value ? String(event.value) : '';
      savePendingPushToken();
    });

    Push.addListener('pushNotificationReceived', function () {
      try { window.BremDriverUrgentMissions && window.BremDriverUrgentMissions.refresh && window.BremDriverUrgentMissions.refresh(); } catch { /* ignore */ }
    });

    Push.addListener('pushNotificationActionPerformed', function (action) {
      var data = action && action.notification && action.notification.data;
      if (data && data.type === 'urgent-mission' && window.BremDriverAppNav && window.BremDriverAppNav.setTab) {
        window.BremDriverAppNav.setTab('mission');
      }
    });
  }

  function startPush() {
    if (!window.BREM_IS_NATIVE_APP) return;
    var Push = getPushPlugin();
    if (!Push) return;
    bindPushListeners();
    Push.requestPermissions().then(function (status) {
      if (status && status.receive === 'granted') return Push.register();
    }).catch(function () { /* ignore */ });
  }

  function bindAppResume() {
    if (!window.BREM_IS_NATIVE_APP) return;
    var CapApp = window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (CapApp && typeof CapApp.addListener === 'function') {
      CapApp.addListener('appStateChange', function (state) {
        if (!state || !state.isActive) return;
        syncOfflineBanner();
        try { window.BremSessionSecurity?.touchActivity?.(); } catch { /* ignore */ }
      });
    }
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return;
      syncOfflineBanner();
      try { window.BremSessionSecurity?.touchActivity?.(); } catch { /* ignore */ }
    });
  }

  function bindExternalLinks() {
    if (!window.BREM_IS_NATIVE_APP) return;

    document.addEventListener('click', function (event) {
      var anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
      if (!anchor) return;
      var href = String(anchor.getAttribute('href') || '').trim();
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;

      var target = String(anchor.getAttribute('target') || '').toLowerCase();
      if (target !== '_blank') return;

      event.preventDefault();
      try {
        window.location.assign(href);
      } catch {
        window.location.href = href;
      }
    }, true);

    var originalOpen = window.open;
    window.open = function (url, target, features) {
      var href = String(url || '').trim();
      if (!href) return null;
      var dest = String(target || '_blank').toLowerCase();
      if (dest === '_blank' || dest === 'blank') {
        try {
          window.location.assign(href);
        } catch {
          window.location.href = href;
        }
        return null;
      }
      return originalOpen ? originalOpen.call(window, url, target, features) : null;
    };
  }

  function boot() {
    hidePwaInstallUi();
    persistNativeRiderSession();
    bindBackButton();
    bindAppResume();
    bindNetworkBanner();
    bindExternalLinks();
    startPush();
    document.addEventListener('brem-rider-session-ready', function () {
      savePendingPushToken();
      window.setTimeout(savePendingPushToken, 1500);
    });
    if (document.getElementById('driverMainApp') && !document.getElementById('driverMainApp').hidden) {
      savePendingPushToken();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
