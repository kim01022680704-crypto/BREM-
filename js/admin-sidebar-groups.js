/* eslint-disable */
/**
 * ERP 사이드바 그룹형 네비게이션 (표시 전용)
 * - 기존 .nav-btn 요소를 "이동"만 하므로 admin.js의 클릭/활성/권한 바인딩이 100% 보존됨.
 * - 즐겨찾기는 실제 버튼을 .click()으로 프록시 → 기능/데이터/정산 로직 일절 변경 없음.
 */
(function () {
  'use strict';

  // data-section 기준 그룹. 'baemin-status:calls_rejection_sync' = data-baemin-menu-focus 버튼.
  // ※ ops에서 'baemin-status'(배민현황)를 focus 버튼보다 먼저 두어 pageTitle 기본값 보존.
  var GROUPS = [
    { key: 'home',   title: '홈 · 대시보드',     icon: 'home',   items: ['dashboard', 'admin-schedule'] },
    { key: 'comm',   title: '소통 · 공지',        icon: 'bell',   items: ['notices', 'urgent-missions', 'rider-push', 'rider-inquiries'] },
    { key: 'ops',    title: '콜 · 현황',          icon: 'chart',  items: ['calls', 'rejections', 'targets', 'contribution', 'baemin-biz-status', 'baemin-status', 'baemin-status:calls_rejection_sync', 'coupang-rider-status', 'coupang-status'] },
    { key: 'settle', title: '정산 · 급여',        icon: 'coin',   items: ['settlements', 'weekly-settlement', 'weekly-settlement-direct', 'promotion-settlement', 'settlement-result-direct', 'final-deposit', 'payroll-slips', 'payroll-slip-search', 'payroll-daily-settlement', 'revenue-management', 'tax-management'] },
    { key: 'promo',  title: '프로모션 · 이벤트',  icon: 'target', items: ['promotions', 'promotion-apply', 'missions', 'mission-results', 'mission-management'] },
    { key: 'rider',  title: '기사 · 자산',        icon: 'bike',   items: ['driver-management', 'inactive-drivers', 'lease-management'] },
    { key: 'sys',    title: '시스템',             icon: 'gear',   items: ['admin-account', 'data-backup'] }
  ];

  var ICONS = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    bell: '<path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    coin: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    bike: '<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M6 17l4-8h5l3 8M10 9l2-4h3"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 00-.1-1l2-1.5-2-3.5-2.4 1a7 7 0 00-1.7-1L14.5 2h-5l-.3 2.5a7 7 0 00-1.7 1l-2.4-1-2 3.5L3.1 11a7 7 0 000 2l-2 1.5 2 3.5 2.4-1a7 7 0 001.7 1L9.5 22h5l.3-2.5a7 7 0 001.7-1l2.4 1 2-3.5-2-1.5c.1-.3.1-.7.1-1z"/>',
    etc: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>'
  };
  function icon(name) {
    return '<svg class="sb-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || ICONS.etc) + '</svg>';
  }
  var CHEV = '<svg class="sb-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
  var STAR = '<svg viewBox="0 0 24 24"><path d="M12 2l3 6.9 7.5.6-5.7 4.9 1.8 7.3L12 17.8 5.1 21.7l1.8-7.3L1.2 9.5 8.7 8.9z"/></svg>';

  var FAV_KEY = 'brem_admin_fav_menu';
  var COLLAPSE_KEY = 'brem_admin_menu_collapsed';
  var DEFAULT_FAV = ['dashboard', 'baemin-status:calls_rejection_sync', 'payroll-slip-search'];

  var REAL = {};    // favKey -> 실제 nav-btn 요소
  var LABELS = {};  // favKey -> 버튼 라벨
  var FAV;

  function loadFav() {
    try { FAV = new Set(JSON.parse(localStorage.getItem(FAV_KEY)) || DEFAULT_FAV); }
    catch (e) { FAV = new Set(DEFAULT_FAV); }
  }
  function saveFav() { try { localStorage.setItem(FAV_KEY, JSON.stringify(Array.from(FAV))); } catch (e) {} }

  function findBtn(oldNav, key) {
    if (key.indexOf(':') > -1) {
      var p = key.split(':');
      return oldNav.querySelector('.nav-btn[data-section="' + p[0] + '"][data-baemin-menu-focus="' + p[1] + '"]');
    }
    var list = oldNav.querySelectorAll('.nav-btn[data-section="' + key + '"]');
    for (var i = 0; i < list.length; i++) {
      if (!list[i].hasAttribute('data-baemin-menu-focus')) return list[i];
    }
    return list[0] || null;
  }

  function init() {
    var sidebar = document.getElementById('sidebar');
    var groupHost = document.getElementById('adminNavGroups');
    var favHost = document.getElementById('adminFavHost');
    var scroll = document.getElementById('adminNavScroll');
    var oldNav = sidebar ? sidebar.querySelector('nav') : null;
    if (!sidebar || !groupHost || !oldNav) return;

    loadFav();

    // 1) 그룹 생성 + 기존 버튼 이동
    GROUPS.forEach(function (g) {
      var grp = document.createElement('div');
      grp.className = 'sb-group';
      grp.setAttribute('data-grp', g.key);

      var head = document.createElement('button');
      head.type = 'button';
      head.className = 'sb-ghead';
      head.setAttribute('data-ghead', '');

      var body = document.createElement('div');
      body.className = 'sb-gbody';

      var count = 0;
      g.items.forEach(function (key) {
        var btn = findBtn(oldNav, key);
        if (!btn) return;
        REAL[key] = btn;
        LABELS[key] = (btn.textContent || '').trim();
        var row = document.createElement('div');
        row.className = 'sb-item';
        row.appendChild(btn); // 이동(리스너 보존)
        var star = document.createElement('button');
        star.type = 'button';
        star.className = 'fav-toggle' + (FAV.has(key) ? ' on' : '');
        star.setAttribute('data-fav', key);
        star.setAttribute('aria-label', '즐겨찾기');
        star.title = '즐겨찾기 추가/삭제';
        star.innerHTML = STAR;
        row.appendChild(star);
        body.appendChild(row);
        count++;
      });

      head.innerHTML = icon(g.icon) + '<span class="sb-gtitle">' + g.title + '</span><span class="sb-gcount">' + count + '</span>' + CHEV;
      grp.appendChild(head);
      grp.appendChild(body);
      groupHost.appendChild(grp);
    });

    // 2) 매핑 누락된 나머지 버튼은 "기타" 그룹으로 (안전망)
    var leftovers = [].slice.call(oldNav.querySelectorAll('.nav-btn'));
    if (leftovers.length) {
      var grp = document.createElement('div');
      grp.className = 'sb-group'; grp.setAttribute('data-grp', 'etc');
      var head = document.createElement('button');
      head.type = 'button'; head.className = 'sb-ghead'; head.setAttribute('data-ghead', '');
      var body = document.createElement('div'); body.className = 'sb-gbody';
      leftovers.forEach(function (btn) {
        var key = btn.dataset.section || ('etc-' + Math.random().toString(36).slice(2));
        REAL[key] = btn; LABELS[key] = (btn.textContent || '').trim();
        var row = document.createElement('div'); row.className = 'sb-item';
        row.appendChild(btn);
        var star = document.createElement('button');
        star.type = 'button'; star.className = 'fav-toggle' + (FAV.has(key) ? ' on' : '');
        star.setAttribute('data-fav', key); star.setAttribute('aria-label', '즐겨찾기'); star.innerHTML = STAR;
        row.appendChild(star); body.appendChild(row);
      });
      head.innerHTML = icon('etc') + '<span class="sb-gtitle">기타</span><span class="sb-gcount">' + leftovers.length + '</span>' + CHEV;
      grp.appendChild(head); grp.appendChild(body); groupHost.appendChild(grp);
    }

    // 3) 이제 비어있는 원본 nav 숨김
    oldNav.style.display = 'none';

    // 4) 즐겨찾기 렌더
    function renderFav() {
      var keys = Array.from(FAV).filter(function (k) { return LABELS[k]; });
      if (!keys.length) {
        favHost.innerHTML = '<div class="sb-fav-empty">별 아이콘으로 즐겨찾기를 추가하세요.</div>';
        return;
      }
      favHost.innerHTML = '<div class="sb-fav-title">⭐ 즐겨찾기</div>' + keys.map(function (k) {
        return '<div class="sb-fav-item" data-goto="' + k + '"><span class="dot"></span>'
          + '<span class="sb-fav-label">' + LABELS[k] + '</span>'
          + '<button type="button" class="fav-toggle on" data-fav="' + k + '" aria-label="즐겨찾기 삭제">' + STAR + '</button></div>';
      }).join('');
      refreshActive();
      refreshHidden();
    }
    function syncStars() {
      [].forEach.call(groupHost.querySelectorAll('.fav-toggle'), function (b) {
        b.classList.toggle('on', FAV.has(b.getAttribute('data-fav')));
      });
    }
    function toggleFav(k) {
      if (FAV.has(k)) FAV.delete(k); else FAV.add(k);
      saveFav(); renderFav(); syncStars();
    }

    // 5) 활성/숨김 동기화 (권한 hidden, active 미러)
    function refreshActive() {
      [].forEach.call(document.querySelectorAll('.sb-fav-item'), function (it) {
        var b = REAL[it.getAttribute('data-goto')];
        it.classList.toggle('active', !!(b && b.classList.contains('active')));
      });
    }
    function refreshHidden() {
      [].forEach.call(groupHost.querySelectorAll('.sb-group'), function (grp) {
        var anyVisible = false;
        [].forEach.call(grp.querySelectorAll('.sb-item'), function (it) {
          var b = it.querySelector('.nav-btn');
          var hidden = !!(b && b.hidden);
          it.classList.toggle('sb-item--hidden', hidden);
          if (!hidden) anyVisible = true;
        });
        grp.classList.toggle('sb-group--empty', !anyVisible);
      });
      [].forEach.call(document.querySelectorAll('.sb-fav-item'), function (it) {
        var b = REAL[it.getAttribute('data-goto')];
        it.classList.toggle('sb-item--hidden', !!(b && b.hidden));
      });
    }

    // 6) 접힘 상태 복원/저장
    function persistCollapse() {
      var arr = [].map.call(groupHost.querySelectorAll('.sb-group.collapsed'), function (g) { return g.getAttribute('data-grp'); });
      try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(arr)); } catch (e) {}
    }
    (function restoreCollapse() {
      try {
        var arr = JSON.parse(localStorage.getItem(COLLAPSE_KEY)) || [];
        arr.forEach(function (k) {
          var g = groupHost.querySelector('.sb-group[data-grp="' + k + '"]');
          if (g) g.classList.add('collapsed');
        });
      } catch (e) {}
    })();

    // 7) 이벤트 위임 (scroll 컨테이너)
    scroll.addEventListener('click', function (e) {
      var star = e.target.closest('.fav-toggle');
      if (star) { e.preventDefault(); e.stopPropagation(); toggleFav(star.getAttribute('data-fav')); return; }
      var favItem = e.target.closest('.sb-fav-item');
      if (favItem) { var b = REAL[favItem.getAttribute('data-goto')]; if (b) b.click(); return; }
      var head = e.target.closest('[data-ghead]');
      if (head) { head.parentElement.classList.toggle('collapsed'); persistCollapse(); return; }
      // .nav-btn 클릭은 원래 admin.js 리스너가 처리 (여기서 관여 안 함)
    });

    // 8) 검색
    var search = document.getElementById('adminMenuSearch');
    if (search) {
      search.addEventListener('input', function () {
        var q = search.value.trim().toLowerCase();
        var any = false;
        [].forEach.call(groupHost.querySelectorAll('.sb-group'), function (grp) {
          var shown = 0;
          [].forEach.call(grp.querySelectorAll('.sb-item'), function (it) {
            var b = it.querySelector('.nav-btn');
            var label = (b ? b.textContent : '').toLowerCase();
            var hit = !!q && b && b.hidden ? false : label.indexOf(q) > -1 && !(b && b.hidden);
            it.style.display = hit ? '' : 'none';
            if (hit) shown++;
          });
          grp.style.display = shown ? '' : 'none';
          if (q) grp.classList.remove('collapsed');
          if (shown) any = true;
        });
        favHost.style.display = q ? 'none' : '';
        var nores = document.getElementById('adminMenuNoResult');
        if (nores) nores.hidden = any;
        if (!q) { refreshHidden(); } // 검색 해제 시 그룹 display 복원
      });
    }

    // 9) 권한/활성 변화 감지 → 빈 그룹 숨김 & 즐겨찾기 활성 미러
    try {
      var mo = new MutationObserver(function () { refreshHidden(); refreshActive(); });
      [].forEach.call(groupHost.querySelectorAll('.nav-btn'), function (b) {
        mo.observe(b, { attributes: true, attributeFilter: ['hidden', 'class'] });
      });
    } catch (e) {}

    renderFav();
    refreshHidden();
    refreshActive();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
