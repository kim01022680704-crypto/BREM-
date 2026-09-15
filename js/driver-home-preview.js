/**
 * 기사앱 홈 v2 (프리뷰 디자인) — 표시 전용 미러 모듈.
 *
 * 핵심 원칙:
 *  - driver.js(정산/금액/수락율 등 계산·렌더 로직)는 절대 건드리지 않는다.
 *  - 원본 홈 요소(프로필/라이브옵스/주간지표/목표/미션/장기근속)는 그대로 두되
 *    CSS(.driver-home-legacy)로 숨기고, 이 모듈이 원본의 "이미 계산된 값"을
 *    새 프리뷰 카드(.driver-home-v2)로 복사만 한다.
 *  - 즉, 화면에 보이는 숫자는 항상 driver.js가 만든 값과 동일하다.
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function txt(id) { const el = $(id); return el ? (el.textContent || '').trim() : ''; }
  function setTxt(id, value) { const el = $(id); if (el) el.textContent = value; }

  // "1,234콜" / "512건" / " 38 " → 정수
  function toInt(s) {
    const n = parseInt(String(s == null ? '' : s).replace(/[^0-9-]/g, ''), 10);
    return Number.isFinite(n) ? n : 0;
  }
  // 숫자에서 단위(건/콜/공백) 제거 → "512건" → "512", "-" → "-"
  function stripUnit(s) {
    const v = String(s == null ? '' : s).trim();
    if (!v || v === '-') return '-';
    const m = v.replace(/[건콜\s]/g, '');
    return m === '' ? '-' : m;
  }
  function comma(n) { return Number(n || 0).toLocaleString('ko-KR'); }

  // 미션 sim 텍스트에서 "약 392,000원" 형태의 금액을 추출 (driver.js가 계산한 값)
  function parseMissionAmount(wrapId) {
    const wrap = $(wrapId);
    if (!wrap || wrap.hidden) return null;
    const now = wrap.querySelector('.mission-sim__now');
    if (!now) return null;
    const t = now.textContent || '';
    // "이번 주 512콜 → 약 392,000원 (..." 또는 "... 아직 지급 시작 ..."
    const won = t.match(/약\s*([\d,]+)\s*원/);
    const calls = t.match(/이번\s*주\s*([\d,]+)\s*콜/);
    return {
      amount: won ? toInt(won[1]) : 0,
      amountText: won ? (comma(toInt(won[1])) + '원') : '0원',
      callsText: calls ? (comma(toInt(calls[1])) + '콜') : '',
      started: !!won
    };
  }

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  ready(function () {
    const root = $('driver-home-v2') || document.querySelector('.driver-home-v2');
    if (!root) return;

    // ---------- 정적 배선 (1회) ----------
    // 정보 버튼 → 기존 정보수정 팝업
    const infoBtn = $('hv2InfoBtn');
    if (infoBtn) infoBtn.addEventListener('click', function () { $('driverProfileEditToggle')?.click(); });

    // 관리자 문의하기 버튼 → 기존 문의 팝업 (레거시 버튼 클릭)
    const inquiryBtn = $('hv2InquiryBtn');
    if (inquiryBtn) inquiryBtn.addEventListener('click', function () { $('driverAdminInquiryBtn')?.click(); });

    // 관리메뉴 버튼 → 기존 대시보드 버튼 클릭
    const adminMap = [
      ['hv2AdminDash', 'driverRegionDashboardBtn'],
      ['hv2AdminBranch', 'driverBranchDashboardBtn'],
      ['hv2AdminCrew', 'driverCrewLeaderBtn']
    ];
    adminMap.forEach(function (pair) {
      const btn = $(pair[0]);
      if (btn) btn.addEventListener('click', function () { $(pair[1])?.click(); });
    });

    // 목표 카드 → 기존 목표 설정 모달
    $('hv2WeekTarget')?.addEventListener('click', function () { $('weekTargetCard')?.click(); });
    $('hv2MonthTarget')?.addEventListener('click', function () { $('monthTargetCard')?.click(); });

    // 오늘/주간 세그먼트 토글 (홈 내부에서만 동작)
    const seg = $('hv2Seg');
    if (seg) {
      seg.addEventListener('click', function (e) {
        const b = e.target.closest('button[data-period]');
        if (!b) return;
        const p = b.getAttribute('data-period');
        Array.from(seg.querySelectorAll('button')).forEach(function (x) {
          x.classList.toggle('is-active', x === b);
        });
        root.querySelectorAll('.ds-period').forEach(function (el) {
          el.hidden = el.getAttribute('data-period') !== p;
        });
      });
    }

    // ---------- 값 미러링 (원본 → v2) ----------
    let syncing = false;
    let observer = null;

    function sync() {
      if (syncing) return;
      syncing = true;
      try {
        // 프로필
        const name = txt('driverName') || '-';
        setTxt('hv2Name', name);
        setTxt('hv2Avatar', name && name !== '-' ? name.charAt(0) : '-');
        // 플랫폼 배지
        const platform = (txt('driverPlatform') || '').trim();
        const badges = $('hv2Badges');
        if (badges) {
          const parts = [];
          if (platform.includes('배민')) parts.push('<span class="platform-badge platform-badge--baemin">배민</span>');
          if (platform.includes('쿠팡')) parts.push('<span class="platform-badge platform-badge--coupang">쿠팡</span>');
          badges.innerHTML = parts.join('');
        }

        // 실시간 현황 — 오늘
        setTxt('hv2TdBmComplete', stripUnit(txt('baeminOpsComplete')));
        setTxt('hv2TdBmAccept', txt('baeminOpsAcceptRate') || '-');
        setTxt('hv2TdBmReject', stripUnit(txt('baeminOpsReject')));
        setTxt('hv2TdBmCancel', stripUnit(txt('baeminOpsCancel')));
        setTxt('hv2TdCpComplete', stripUnit(txt('coupangOpsComplete')));
        setTxt('hv2TdCpReject', txt('coupangOpsRejectRate') || '-');
        setTxt('hv2TdCpRejectN', stripUnit(txt('coupangOpsReject')));
        setTxt('hv2TdCpCancel', stripUnit(txt('coupangOpsCancel')));

        // 실시간 현황 — 주간
        setTxt('hv2WkBmComplete', stripUnit(txt('baeminRateComplete')));
        setTxt('hv2WkBmAccept', txt('weeklyAcceptanceRateBaemin') || '-');
        setTxt('hv2WkBmReject', stripUnit(txt('baeminRateReject')));
        setTxt('hv2WkBmCancel', stripUnit(txt('baeminRateDispatchCancel')));
        setTxt('hv2WkCpComplete', stripUnit(txt('coupangRateComplete')));
        setTxt('hv2WkCpReject', txt('weeklyRejectionRateCoupang') || '-');
        setTxt('hv2WkCpRejectN', stripUnit(txt('coupangRateReject')));
        setTxt('hv2WkCpCancel', stripUnit(txt('coupangRateCancel')));

        // KPI
        const weekCalls = toInt(txt('weekCallsBaemin')) + toInt(txt('weekCallsCoupang'));
        setTxt('hv2KpiCalls', comma(weekCalls));
        setTxt('hv2KpiAccept', txt('weeklyAcceptanceRateBaemin') || '-');
        setTxt('hv2KpiReject', txt('weeklyRejectionRateCoupang') || '-');

        // 목표
        const weekTarget = txt('weekTarget') || '-';
        const monthTarget = txt('monthTarget') || '-';
        setTxt('hv2WeekTargetVal', weekTarget);
        setTxt('hv2MonthTargetVal', monthTarget);
        const weekAch = txt('weeklyAchievementRate');
        const monthAch = txt('monthAchievementRate');
        const monthCalls = toInt(txt('monthCallsBaemin')) + toInt(txt('monthCallsCoupang'));
        setTxt('hv2WeekTargetAch', weekAch && weekAch !== '-' ? ('달성 ' + comma(weekCalls) + '콜 · ' + weekAch) : ('달성 ' + comma(weekCalls) + '콜'));
        setTxt('hv2MonthTargetAch', monthAch && monthAch !== '-' ? ('달성 ' + comma(monthCalls) + '콜 · ' + monthAch) : ('달성 ' + comma(monthCalls) + '콜'));

        // 미션 (예상 프로모션 금액) — driver.js가 계산해 렌더한 값을 그대로 읽음
        const bm = parseMissionAmount('riderMissionBaeminWrap');
        const cp = parseMissionAmount('riderMissionCoupangWrap');
        let total = 0;
        const bmRow = $('hv2MissionBaemin');
        if (bmRow) {
          if (bm && bm.started) {
            bmRow.hidden = false;
            setTxt('hv2MissionBaeminCalls', [bm.callsText, txt('riderMissionBaeminTitle')].filter(Boolean).join(' · '));
            setTxt('hv2MissionBaeminAmt', bm.amountText);
            total += bm.amount;
          } else { bmRow.hidden = true; }
        }
        const cpRow = $('hv2MissionCoupang');
        if (cpRow) {
          if (cp && cp.started) {
            cpRow.hidden = false;
            setTxt('hv2MissionCoupangCalls', [cp.callsText, txt('riderMissionCoupangTitle')].filter(Boolean).join(' · '));
            setTxt('hv2MissionCoupangAmt', cp.amountText);
            total += cp.amount;
          } else { cpRow.hidden = true; }
        }
        setTxt('hv2MissionTotal', total > 0 ? ('약 ' + comma(total) + '원') : '예정 없음');

        // 장기근속
        const eventItem = txt('eventItem');
        const detail = txt('missionDetail');
        const ls = $('hv2LongService');
        const hasEvent = eventItem && eventItem !== '미선택' && /콜/.test(detail);
        if (ls) {
          ls.hidden = !hasEvent;
          if (hasEvent) {
            setTxt('hv2LsLabel', '장기근속 (' + eventItem + ')');
            setTxt('hv2LsValue', detail);
            const pct = detail.match(/·\s*([\d]+)\s*%/);
            const bar = $('hv2LsBar');
            if (bar) bar.style.width = (pct ? Math.max(0, Math.min(100, toInt(pct[1]))) : 0) + '%';
          }
        }

        // 관리메뉴 게이팅
        const gate = [
          ['hv2AdminDash', 'driverRegionDashboardBtn'],
          ['hv2AdminBranch', 'driverBranchDashboardBtn'],
          ['hv2AdminCrew', 'driverCrewLeaderBtn']
        ];
        let anyVisible = false;
        gate.forEach(function (pair) {
          const src = $(pair[1]);
          const dst = $(pair[0]);
          const visible = !!src && !src.hidden;
          if (dst) dst.hidden = !visible;
          if (visible) anyVisible = true;
        });
        const adminCard = $('hv2Admin');
        if (adminCard) adminCard.hidden = !anyVisible;
      } finally {
        syncing = false;
      }
    }

    // 원본 #result 변경을 감지해 재동기화 (디바운스). sync 중에는 관찰 중단→재개해 루프 방지.
    const resultEl = $('result');
    let timer = null;
    function schedule() {
      if (timer) return;
      timer = setTimeout(function () {
        timer = null;
        if (observer) observer.disconnect();
        sync();
        if (observer && resultEl) observer.observe(resultEl, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
      }, 120);
    }

    if (resultEl && 'MutationObserver' in window) {
      observer = new MutationObserver(schedule);
      observer.observe(resultEl, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
    }

    // 초기 동기화 (로그인 전이면 값이 없다가, 렌더되면 observer가 다시 호출)
    sync();
    setTimeout(sync, 400);
    setTimeout(sync, 1500);
  });
})();
