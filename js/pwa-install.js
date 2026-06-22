/**
 * BREM PWA — 홈 화면 설치 버튼 (Chrome / 삼성 인터넷 / iPhone)
 */
(function () {
  var btn = document.getElementById('bremPwaInstallBtn');
  var help = document.getElementById('bremPwaInstallHelp');
  var helpTitle = document.getElementById('bremPwaInstallHelpTitle');
  var helpBody = document.getElementById('bremPwaInstallHelpBody');
  var helpClose = document.getElementById('bremPwaInstallHelpClose');
  if (!btn || !help) return;

  var deferredPrompt = null;
  var labelEl = btn.querySelector('.brem-pwa-install-label');
  var chromeHint = document.getElementById('bremPwaChromeHint');

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
  }

  function detectBrowser() {
    var ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
    if (/SamsungBrowser/i.test(ua)) return 'samsung';
    if (/CriOS|Chrome/i.test(ua) && !/Edg|OPR|SamsungBrowser/i.test(ua)) return 'chrome';
    if (/Android/i.test(ua)) return 'android';
    return 'other';
  }

  var HELP = {
    samsung: {
      title: '삼성 인터넷 — 홈 화면에 추가',
      steps: [
        '화면 아래 또는 오른쪽 아래 <strong>≡ (메뉴)</strong>를 누릅니다.',
        '<strong>「현재 페이지 추가」</strong> 또는 <strong>「홈 화면에 추가」</strong>를 선택합니다.',
        '<strong>추가</strong>를 누르면 홈 화면에 BREM 아이콘이 생깁니다.'
      ]
    },
    chrome: {
      title: 'Chrome — 앱 설치',
      steps: [
        '아래 <strong>앱 설치</strong> 버튼을 다시 눌러 보세요.',
        '안내창이 없으면 주소창 오른쪽 <strong>⋮ (메뉴)</strong> → <strong>앱 설치</strong> 또는 <strong>홈 화면에 추가</strong>를 선택하세요.'
      ]
    },
    android: {
      title: 'Android — 홈 화면에 추가',
      steps: [
        '브라우저 <strong>⋮ (메뉴)</strong> 또는 <strong>≡ (메뉴)</strong>를 엽니다.',
        '<strong>앱 설치</strong>, <strong>홈 화면에 추가</strong>, <strong>현재 페이지 추가</strong> 중 보이는 항목을 선택합니다.',
        'Chrome을 쓰면 설치가 더 잘 됩니다.'
      ]
    },
    ios: {
      title: 'iPhone — 홈 화면에 추가',
      steps: [
        'Safari 하단 <strong>공유(↑)</strong> 버튼을 누릅니다.',
        '<strong>「홈 화면에 추가」</strong>를 선택합니다.',
        '오른쪽 위 <strong>추가</strong>를 누릅니다.'
      ]
    },
    other: {
      title: '홈 화면에 추가',
      steps: [
        '브라우저 메뉴에서 <strong>홈 화면에 추가</strong> 또는 <strong>앱 설치</strong>를 찾아 선택하세요.',
        'Chrome(Android) 또는 Safari(iPhone) 사용을 권장합니다.'
      ]
    }
  };

  function openHelp(browser) {
    var info = HELP[browser] || HELP.other;
    helpTitle.textContent = info.title;
    helpBody.innerHTML = info.steps.map(function (step, i) {
      return '<li>' + step + '</li>';
    }).join('');
    help.hidden = false;
    document.body.classList.add('brem-pwa-help-open');
  }

  function closeHelp() {
    help.hidden = true;
    document.body.classList.remove('brem-pwa-help-open');
  }

  if (isStandalone()) {
    btn.hidden = true;
    return;
  }

  btn.hidden = false;

  function showChromeHint() {
    if (!chromeHint) return;
    if (!window.matchMedia('(max-width: 430px)').matches) {
      chromeHint.hidden = true;
      return;
    }
    var browser = detectBrowser();
    chromeHint.hidden = !(browser === 'samsung' || browser === 'android' || browser === 'other');
  }

  showChromeHint();
  window.addEventListener('resize', function () {
    showChromeHint();
  });

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    if (labelEl) labelEl.textContent = '앱 설치 (모바일)';
  });

  btn.addEventListener('click', function () {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function () {
        deferredPrompt = null;
      });
      return;
    }
    openHelp(detectBrowser());
  });

  if (helpClose) {
    helpClose.addEventListener('click', closeHelp);
  }

  help.addEventListener('click', function (e) {
    if (e.target === help) closeHelp();
  });
})();
