/* eslint-disable */
/**
 * 기사등록 / 기사목록 간이 팝업 (모달 + iframe)
 * - 기존 페이지(rider-manage.html?register=1, drivers.html)를 그대로 iframe으로 재사용.
 * - 계산/정산/DB/API 로직은 일절 건드리지 않는 "표시(진입 경로) 전용" 모듈.
 * - JS 미로드 시에도 원본 <a href> 로 정상 이동(폴백).
 */
(function () {
  'use strict';

  var CONFIG = {
    register: {
      title: '기사 간이 등록',
      src: 'rider-manage.html?register=1&embed=1&simple=1&v=20261030kakao1',
      full: 'rider-manage.html?register=1'
    },
    list: {
      title: '기사 목록 · 확인',
      src: 'drivers.html?embed=1&simple=1',
      full: 'drivers.html'
    }
  };

  function editSrc(driverId) {
    return 'rider-manage.html?edit=' + encodeURIComponent(driverId)
      + '&embed=1&simple=1&v=20261029edit2&t=' + Date.now();
  }

  var modal, frame, titleEl, expandEl, dialogEl;
  var lastFocus = null;

  function els() {
    modal = modal || document.getElementById('driverPopupModal');
    frame = frame || document.getElementById('driverPopupFrame');
    titleEl = titleEl || document.getElementById('driverPopupTitle');
    expandEl = expandEl || document.getElementById('driverPopupExpand');
    dialogEl = dialogEl || (modal && modal.querySelector('.driver-popup-modal__dialog'));
    return modal && frame;
  }

  function loadingEl() {
    var el = document.getElementById('driverPopupLoading');
    if (el) return el;
    var body = modal && modal.querySelector('.driver-popup-modal__body');
    if (!body) return null;
    el = document.createElement('div');
    el.id = 'driverPopupLoading';
    el.className = 'driver-popup-modal__loading';
    el.hidden = true;
    el.innerHTML = '<strong>불러오는 중</strong><span>기사 정보를 확인하고 있습니다.</span>';
    body.appendChild(el);
    return el;
  }

  function setLoading(mode) {
    var el = loadingEl();
    if (!el) return;
    var title = el.querySelector('strong');
    var note = el.querySelector('span');
    if (mode === 'failed') {
      if (title) title.textContent = '기사 정보를 불러오지 못했습니다';
      if (note) note.textContent = '닫고 다시 열어 주세요.';
      el.hidden = false;
      return;
    }
    if (mode === 'loading') {
      if (title) title.textContent = '불러오는 중';
      if (note) note.textContent = '기사 정보를 확인하고 있습니다.';
      el.hidden = false;
      return;
    }
    el.hidden = true;
  }

  function show(conf) {
    if (titleEl) titleEl.textContent = conf.title;
    if (expandEl) expandEl.setAttribute('href', conf.full);
    if (dialogEl) dialogEl.setAttribute('data-popup-type', conf.type);
    setLoading(conf.type === 'edit' ? 'loading' : 'hide');
    if (frame) {
      frame.setAttribute('title', conf.title);
      frame.setAttribute('src', conf.src);
    }

    lastFocus = document.activeElement;
    modal.hidden = false;
    document.body.classList.add('driver-popup-open');
    var closeBtn = modal.querySelector('[data-close-driver-popup]');
    if (closeBtn && closeBtn.focus) {
      try { closeBtn.focus(); } catch (e) {}
    }
    return true;
  }

  function open(type) {
    if (!els()) return false;
    var conf = CONFIG[type];
    if (!conf) return false;
    return show({
      type: type,
      title: conf.title,
      src: conf.src,
      full: conf.full
    });
  }

  function openEdit(driverId, driverName) {
    if (!els()) return false;
    var id = String(driverId || '').trim();
    if (!id) return false;
    var name = String(driverName || '').trim();
    return show({
      type: 'edit',
      title: name ? (name + ' 정보 수정') : '정보 수정',
      src: editSrc(id),
      full: 'rider-manage.html?edit=' + encodeURIComponent(id)
    });
  }

  function close() {
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    document.body.classList.remove('driver-popup-open');
    // iframe 초기화(메모리/상태 정리)
    if (frame) {
      try { frame.setAttribute('src', 'about:blank'); } catch (e) {}
    }
    if (lastFocus && lastFocus.focus) {
      try { lastFocus.focus(); } catch (e) {}
    }
    lastFocus = null;
    setLoading('hide');
  }

  function onTriggerClick(e) {
    var trigger = e.target.closest('[data-driver-popup]');
    if (!trigger) return;
    var type = trigger.getAttribute('data-driver-popup');
    if (!CONFIG[type]) return;
    // 새 탭/새 창(Ctrl/Cmd/중간버튼)은 폴백(원본 링크)로 그대로 둔다
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return;
    e.preventDefault();
    open(type);
  }

  function init() {
    if (!els()) return;

    // 트리거(사이드바 기사등록/기사목록) 위임 바인딩
    document.addEventListener('click', onTriggerClick);

    window.addEventListener('message', function (event) {
      if (event.origin !== window.location.origin) return;
      if (!frame || event.source !== frame.contentWindow) return;
      var type = event.data && event.data.type;
      if (type === 'brem-driver-ready') setLoading('hide');
      if (type === 'brem-driver-load-failed') setLoading('failed');
    });

    // 닫기(배경/버튼) 위임
    modal.addEventListener('click', function (e) {
      if (e.target.closest('[data-close-driver-popup]')) {
        e.preventDefault();
        close();
      }
    });

    // ESC는 수정/등록 팝업만 닫는다. 뒤에 있는 기사상세는 유지한다.
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || !modal || modal.hidden) return;
      e.preventDefault();
      e.stopPropagation();
      close();
    }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.BremDriverPopups = {
    open: open,
    openEdit: openEdit,
    close: close,
    isOpen: function () {
      var el = document.getElementById('driverPopupModal');
      return !!(el && !el.hidden);
    }
  };
})();
