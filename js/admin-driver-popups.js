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
      src: 'rider-manage.html?register=1&embed=1&simple=1',
      full: 'rider-manage.html?register=1'
    },
    list: {
      title: '기사 목록 · 확인',
      src: 'drivers.html?embed=1&simple=1',
      full: 'drivers.html'
    }
  };

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

  function open(type) {
    if (!els()) return false;
    var conf = CONFIG[type];
    if (!conf) return false;

    if (titleEl) titleEl.textContent = conf.title;
    if (expandEl) expandEl.setAttribute('href', conf.full);
    if (dialogEl) dialogEl.setAttribute('data-popup-type', type);

    // iframe 로드는 열릴 때만(불필요한 사전 로드 방지)
    if (frame.getAttribute('src') !== conf.src) {
      frame.setAttribute('src', conf.src);
    }

    lastFocus = document.activeElement;
    modal.hidden = false;
    document.body.classList.add('driver-popup-open');
    // 접근성: 닫기 버튼에 포커스
    var closeBtn = modal.querySelector('[data-close-driver-popup]');
    if (closeBtn && closeBtn.focus) {
      try { closeBtn.focus(); } catch (e) {}
    }
    return true;
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

    // 닫기(배경/버튼) 위임
    modal.addEventListener('click', function (e) {
      if (e.target.closest('[data-close-driver-popup]')) {
        e.preventDefault();
        close();
      }
    });

    // ESC 닫기
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal && !modal.hidden) {
        close();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
