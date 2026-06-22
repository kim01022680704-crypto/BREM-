/**
 * BREM PWA — 홈 화면 설치 버튼 (Chrome / 삼성 인터넷 / iPhone)
 */
(function () {
  var btn = document.getElementById('bremPwaInstallBtn');
  var help = document.getElementById('bremPwaInstallHelp');
  var helpTitle = document.getElementById('bremPwaInstallHelpTitle');
  var helpBody = document.getElementById('bremPwaInstallHelpBody');
  var helpCommon = document.getElementById('bremPwaInstallHelpCommon');
  var helpClose = document.getElementById('bremPwaInstallHelpClose');
  if (!btn || !help) return;

  var deferredPrompt = null;
  var labelEl = btn.querySelector('.brem-pwa-install-label');
  var chromeHint = document.getElementById('bremPwaChromeHint');

  var COMMON_NOTES = [
    '설치가 안 될 경우 Chrome 브라우저 사용을 권장합니다.',
    'Android Chrome에서 세부사항 보기가 나오면, 세부사항 보기 → 무시하고 설치 순서로 진행해주세요.'
  ];

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
  }

  function isMobileViewport() {
    return window.matchMedia('(max-width: 430px)').matches;
  }

  /** @returns {'android-chrome'|'android-samsung'|'android-other'|'ios-safari'|'ios-chrome'|'ios-other'|'desktop-chrome'|'other'} */
  function detectBrowser() {
    var ua = navigator.userAgent || '';
    var isIOS = /iPhone|iPad|iPod/i.test(ua);

    if (isIOS) {
      if (/CriOS/i.test(ua)) return 'ios-chrome';
      if (/FxiOS|EdgiOS|OPiOS|DuckDuckGo/i.test(ua)) return 'ios-other';
      return 'ios-safari';
    }

    if (/Android/i.test(ua)) {
      if (/SamsungBrowser/i.test(ua)) return 'android-samsung';
      if (/Chrome/i.test(ua) && !/EdgA|OPR|SamsungBrowser/i.test(ua)) return 'android-chrome';
      return 'android-other';
    }

    if (/Chrome/i.test(ua) && !/Edg|OPR/i.test(ua)) return 'desktop-chrome';
    return 'other';
  }

  var HELP = {
    'android-chrome': {
      title: 'Android Chrome — 앱 설치',
      steps: [
        '아래 <strong>앱 설치</strong> 버튼을 누르면 설치 팝업이 열립니다.',
        '설치 팝업에서 <strong>설치</strong> 또는 <strong>무시하고 설치</strong>를 선택합니다.',
        '<strong>세부사항 보기</strong>가 보이면, <strong>세부사항 보기</strong> → <strong>무시하고 설치</strong> 순서로 진행해주세요.',
        '팝업이 없으면 주소창 오른쪽 <strong>⋮ (메뉴)</strong> → <strong>앱 설치</strong> 또는 <strong>홈 화면에 추가</strong>를 선택하세요.'
      ]
    },
    'android-samsung': {
      title: '삼성 인터넷 — 앱 설치',
      steps: [
        '삼성 인터넷에서는 설치 팝업이 뜨지 않거나 경고가 나올 수 있습니다.',
        '<strong>Chrome 브라우저에서 접속 후 설치를 권장합니다.</strong>',
        'Chrome에서: 주소창 오른쪽 <strong>⋮</strong> → <strong>앱 설치</strong> 또는 <strong>홈 화면에 추가</strong>.',
        '삼성 인터넷 메뉴: <strong>≡</strong> → <strong>현재 페이지 추가</strong> 또는 <strong>홈 화면에 추가</strong>.'
      ]
    },
    'android-other': {
      title: 'Android — 앱 설치',
      steps: [
        '일부 브라우저에서는 설치 팝업이 지원되지 않습니다.',
        '<strong>Chrome 브라우저에서 접속 후 설치를 권장합니다.</strong>',
        'Chrome: <strong>⋮ (메뉴)</strong> → <strong>앱 설치</strong> 또는 <strong>홈 화면에 추가</strong>.',
        '다른 브라우저: 메뉴에서 <strong>홈 화면에 추가</strong> 또는 <strong>현재 페이지 추가</strong>를 찾아보세요.'
      ]
    },
    'ios-safari': {
      title: 'iPhone Safari — 홈 화면에 추가',
      steps: [
        'Safari 하단 <strong>공유(↑)</strong> 버튼을 누릅니다.',
        '<strong>「홈 화면에 추가」</strong>를 선택해주세요.',
        '오른쪽 위 <strong>추가</strong>를 누르면 홈 화면에 BREM 아이콘이 생깁니다.'
      ]
    },
    'ios-chrome': {
      title: 'iPhone Chrome — 홈 화면에 추가',
      steps: [
        '<strong>iPhone은 Safari에서 홈 화면 추가가 가장 안정적입니다.</strong>',
        'Safari로 이 페이지를 연 뒤, 하단 <strong>공유(↑)</strong> → <strong>홈 화면에 추가</strong> → <strong>추가</strong>.',
        'Chrome을 계속 쓰려면: 오른쪽 <strong>⋮</strong> → <strong>공유</strong> → <strong>홈 화면에 추가</strong> (기기·버전에 따라 항목명이 다를 수 있습니다).'
      ]
    },
    'ios-other': {
      title: 'iPhone — 홈 화면에 추가',
      steps: [
        '<strong>iPhone은 Safari에서 홈 화면 추가가 가장 안정적입니다.</strong>',
        'Safari에서 이 페이지를 연 뒤, <strong>공유(↑)</strong> → <strong>홈 화면에 추가</strong> → <strong>추가</strong>.'
      ]
    },
    'desktop-chrome': {
      title: 'Chrome — 앱 설치',
      steps: [
        '주소창 오른쪽 <strong>앱 설치</strong> 아이콘 또는 <strong>⋮ (메뉴)</strong> → <strong>앱 설치</strong>를 선택하세요.',
        '아래 <strong>앱 설치</strong> 버튼을 다시 눌러 설치 팝업을 열 수 있습니다.'
      ]
    },
    other: {
      title: '홈 화면에 추가',
      steps: [
        '브라우저 메뉴에서 <strong>홈 화면에 추가</strong> 또는 <strong>앱 설치</strong>를 찾아 선택하세요.',
        'Android는 Chrome, iPhone은 Safari 사용을 권장합니다.'
      ]
    }
  };

  var HINT_BY_BROWSER = {
    'android-chrome': '설치 팝업에서 「세부사항 보기」→「무시하고 설치」로 진행할 수 있습니다.',
    'android-samsung': 'Chrome 브라우저에서 접속 후 설치를 권장합니다.',
    'android-other': 'Chrome 브라우저에서 접속 후 설치를 권장합니다.',
    'ios-safari': 'Safari 공유(↑) → 「홈 화면에 추가」',
    'ios-chrome': 'iPhone은 Safari에서 홈 화면 추가가 가장 안정적입니다.',
    'ios-other': 'iPhone은 Safari에서 홈 화면 추가가 가장 안정적입니다.'
  };

  function renderCommonNotes() {
    if (!helpCommon) return;
    helpCommon.innerHTML = COMMON_NOTES.map(function (note) {
      return '<p class="brem-pwa-help__note">' + note + '</p>';
    }).join('');
  }

  function openHelp(browser) {
    var info = HELP[browser] || HELP.other;
    helpTitle.textContent = info.title;
    helpBody.innerHTML = info.steps.map(function (step) {
      return '<li>' + step + '</li>';
    }).join('');
    renderCommonNotes();
    help.hidden = false;
    document.body.classList.add('brem-pwa-help-open');
  }

  function closeHelp() {
    help.hidden = true;
    document.body.classList.remove('brem-pwa-help-open');
  }

  function runInstallPrompt(onDone) {
    if (!deferredPrompt) {
      if (onDone) onDone(false);
      return;
    }
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(function (choice) {
      deferredPrompt = null;
      if (onDone) onDone(choice.outcome === 'accepted');
    }).catch(function () {
      deferredPrompt = null;
      if (onDone) onDone(false);
    });
  }

  function updateInstallHint() {
    if (!chromeHint) return;
    if (!isMobileViewport()) {
      chromeHint.hidden = true;
      return;
    }
    var browser = detectBrowser();
    var hint = HINT_BY_BROWSER[browser];
    if (hint) {
      chromeHint.textContent = hint;
      chromeHint.hidden = false;
    } else {
      chromeHint.hidden = true;
    }
  }

  if (isStandalone()) {
    btn.hidden = true;
    return;
  }

  btn.hidden = false;
  updateInstallHint();
  window.addEventListener('resize', updateInstallHint);

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    if (labelEl) labelEl.textContent = '앱 설치 (모바일)';
  });

  btn.addEventListener('click', function () {
    var browser = detectBrowser();

    if (browser === 'android-chrome' && deferredPrompt) {
      runInstallPrompt(function (accepted) {
        if (!accepted) openHelp('android-chrome');
      });
      return;
    }

    if (deferredPrompt && (browser === 'desktop-chrome' || browser === 'other')) {
      runInstallPrompt(function (accepted) {
        if (!accepted) openHelp(browser);
      });
      return;
    }

    openHelp(browser);
  });

  if (helpClose) {
    helpClose.addEventListener('click', closeHelp);
  }

  help.addEventListener('click', function (e) {
    if (e.target === help) closeHelp();
  });
})();
