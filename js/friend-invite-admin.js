/**
 * 친구초대 — 소개자 기본 조건, 친구 연결(조건 고정), 정산주 달성 정리.
 * 콜수는 그 주 주정산서의 배민+쿠팡. 직계약에 행이 있으면 직계약, 없으면 브로.
 * 지급액은 이 화면에서만 확인하고 주정산 금액에는 넣지 않는다.
 */
const BremFriendInviteAdmin = (function () {
  const MAX_WEEKS = 12;
  const DAY_MS = 24 * 60 * 60 * 1000;

  const state = {
    bound: false,
    week: '',
    filter: 'all',
    referrerId: '',
    friendId: '',
    callIndex: null,
    callIndexWeek: '',
    searchTokens: { referrer: 0, friend: 0 }
  };

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  function showToast(message) {
    document.dispatchEvent(new CustomEvent('brem-admin-toast', { detail: { message } }));
  }

  function ymd(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function parseDay(value) {
    const raw = String(value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
    const date = new Date(`${raw}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function todayKey() {
    const now = new Date();
    return ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  }

  /** 달력 날짜가 속한 정산주 수요일 (수~화). */
  function weekStartWednesday(dateValue) {
    const date = parseDay(dateValue);
    if (!date) return '';
    const diff = (date.getDay() - 3 + 7) % 7;
    date.setDate(date.getDate() - diff);
    return ymd(date);
  }

  /**
   * 주정산서 시작일 → 적용 수요일.
   * 시작일이 화요일로 저장된 건 하루 밀린 값이므로 다음 날(수요일)로 본다.
   */
  function settlementWeek(record) {
    const raw = String(record?.startDate || record?.baseSettlementDate || '').slice(0, 10);
    const date = parseDay(raw);
    if (!date) return '';
    if (date.getDay() === 2) {
      date.setDate(date.getDate() + 1);
      return ymd(date);
    }
    return weekStartWednesday(raw);
  }

  function weekEnd(weekStart) {
    const date = parseDay(weekStart);
    if (!date) return '';
    date.setDate(date.getDate() + 6);
    return ymd(date);
  }

  function shortDate(iso) {
    const parts = String(iso || '').split('-');
    if (parts.length < 3) return iso || '-';
    return `${Number(parts[1])}/${Number(parts[2])}`;
  }

  function weekOffset(joinWeek, currentWeek) {
    const start = parseDay(joinWeek);
    const current = parseDay(currentWeek);
    if (!start || !current) return 0;
    return Math.round((current.getTime() - start.getTime()) / (7 * DAY_MS));
  }

  function won(amount) {
    return `${Number(amount || 0).toLocaleString('ko-KR')}원`;
  }

  function clampInt(value, min, max) {
    const number = Math.round(Number(value));
    if (!Number.isFinite(number)) return null;
    if (number < min || number > max) return null;
    return number;
  }

  function drivers() {
    return BremStorage.drivers?.getAll?.() || [];
  }

  function driverById(id) {
    const key = String(id || '');
    if (!key) return null;
    return BremStorage.drivers?.getById?.(key) || null;
  }

  async function hydrateLinkedNames() {
    const data = store();
    const ids = new Set();
    data.profiles.forEach(profile => ids.add(profile.driverId));
    data.links.forEach(link => {
      ids.add(link.referrerId);
      ids.add(link.friendId);
    });
    const missing = [...ids].filter(id => id && !driverById(id));
    if (!missing.length || !BremStorage.drivers?.fetchById) return;
    await Promise.all(missing.map(id => BremStorage.drivers.fetchById(id).catch(() => null)));
    if (missing.some(id => driverById(id))) render();
  }

  function driverLabel(driver) {
    if (!driver) return '-';
    const name = String(driver.name || '').trim() || '이름 없음';
    const phone = String(driver.phone || '').trim();
    const status = String(driver.status || '').trim();
    return [name, phone, status].filter(Boolean).join(' · ');
  }

  function driverName(id) {
    const driver = driverById(id);
    return String(driver?.name || '').trim() || '삭제된 기사';
  }

  function store() {
    return BremStorage.friendInvites?.get?.() || { profiles: [], links: [] };
  }

  async function saveStore(next) {
    const result = BremStorage.friendInvites.save(next);
    if (result && typeof result.then === 'function') await result;
  }

  function platformOf(record) {
    const raw = String(record?.platform || '').toLowerCase();
    if (raw.includes('coupang') || raw.includes('쿠팡')) return 'coupang';
    if (raw.includes('baemin') || raw.includes('배민')) return 'baemin';
    return '';
  }

  function buildCallIndex(weekStart) {
    const index = new Map();
    function bump(driverId, platform, channel, count) {
      if (!driverId || (platform !== 'baemin' && platform !== 'coupang')) return;
      const row = index.get(driverId) || {
        baemin: { direct: 0, bro: 0, directRows: 0, broRows: 0 },
        coupang: { direct: 0, bro: 0, directRows: 0, broRows: 0 }
      };
      const slot = row[platform];
      slot[channel] += count;
      slot[`${channel}Rows`] += 1;
      index.set(driverId, row);
    }
    ['direct', 'bro'].forEach(channel => {
      const list = BremStorage.weeklySettlements?.getAll?.(channel) || [];
      list.forEach(record => {
        if (settlementWeek(record) !== weekStart) return;
        const platform = platformOf(record);
        (record.riders || []).forEach(rider => {
          const driverId = String(rider.matchedRiderId || '').trim();
          bump(driverId, platform, channel, Math.round(Number(rider.weeklyOrderCount || 0)));
        });
      });
    });
    return index;
  }

  function callsFor(driverId) {
    if (state.callIndexWeek !== state.week) {
      state.callIndex = buildCallIndex(state.week);
      state.callIndexWeek = state.week;
    }
    const row = state.callIndex?.get(String(driverId || ''));
    if (!row) return { calls: 0, hasRow: false };
    function pick(slot) {
      if (slot.directRows > 0) return slot.direct;
      if (slot.broRows > 0) return slot.bro;
      return null;
    }
    const baemin = pick(row.baemin);
    const coupang = pick(row.coupang);
    return {
      calls: (baemin || 0) + (coupang || 0),
      hasRow: baemin != null || coupang != null
    };
  }

  function invalidateCalls() {
    state.callIndex = null;
    state.callIndexWeek = '';
  }

  function payTargetLabel(payTarget) {
    if (payTarget === 'both') return '둘 다';
    if (payTarget === 'friend') return '친구만';
    return '미선택';
  }

  function splitPay(link, hit) {
    const amount = hit ? Number(link.payAmount || 0) : 0;
    if (hit && link.payTarget === 'both') {
      return { friendPay: amount, referrerPay: amount };
    }
    if (hit && link.payTarget === 'friend') {
      return { friendPay: amount, referrerPay: 0 };
    }
    return { friendPay: 0, referrerPay: 0 };
  }

  function evaluate(link) {
    const index = weekOffset(link.joinWeek, state.week);
    const emptyPay = { friendPay: 0, referrerPay: 0 };
    if (index < 0) return { kind: 'wait', weekNo: 0, calls: null, hasRow: false, ...emptyPay };
    const info = callsFor(link.friendId);
    if (index >= Number(link.payoutWeeks || 0)) {
      return { kind: 'done', weekNo: Number(link.payoutWeeks || 0), calls: info.hasRow ? info.calls : null, hasRow: info.hasRow, ...emptyPay };
    }
    const weekNo = index + 1;
    if (!info.hasRow) return { kind: 'pending', weekNo, calls: null, hasRow: false, ...emptyPay };
    if (info.calls >= Number(link.goalCalls || 0)) {
      return { kind: 'hit', weekNo, calls: info.calls, hasRow: true, ...splitPay(link, true) };
    }
    return { kind: 'miss', weekNo, calls: info.calls, hasRow: true, ...emptyPay };
  }

  function resultLabel(kind) {
    if (kind === 'hit') return '달성';
    if (kind === 'miss') return '미달';
    if (kind === 'pending') return '정산서 없음';
    if (kind === 'wait') return '시작 전';
    return '종료';
  }

  function searchDrivers(query) {
    const keyword = String(query || '').trim();
    if (!keyword) return [];
    const nameQuery = keyword.replace(/\s+/g, '').toLowerCase();
    const phoneQuery = keyword.replace(/\D/g, '');
    const hits = [];
    drivers().forEach(driver => {
      const name = String(driver.name || '').replace(/\s+/g, '').toLowerCase();
      const phone = String(driver.phone || '').replace(/\D/g, '');
      const nameHit = nameQuery && name.includes(nameQuery);
      const phoneHit = phoneQuery.length >= 3 && phone.includes(phoneQuery);
      if (!nameHit && !phoneHit) return;
      hits.push(driver);
    });
    hits.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko'));
    return hits.slice(0, 12);
  }

  function renderSearchResults(containerId, query, action) {
    const box = $(containerId);
    if (!box) return;
    const hits = searchDrivers(query);
    if (!String(query || '').trim()) {
      box.innerHTML = '';
      box.hidden = true;
      return;
    }
    if (!hits.length) {
      box.hidden = false;
      box.innerHTML = '<p class="friend-invite-empty">맞는 기사가 없습니다.</p>';
      return;
    }
    box.hidden = false;
    box.innerHTML = hits.map(driver => `
      <button type="button" data-action="${action}" data-id="${escapeHtml(driver.id)}">
        ${escapeHtml(driverLabel(driver))}
      </button>
    `).join('');
  }

  function renderReferrerPick() {
    const line = $('friendInviteReferrerPick');
    if (!line) return;
    const driver = driverById(state.referrerId);
    line.textContent = driver ? `선택한 소개자: ${driverLabel(driver)}` : '소개자를 검색해서 고르세요.';
  }

  function renderFriendPick() {
    const line = $('friendInviteFriendPick');
    if (!line) return;
    const driver = driverById(state.friendId);
    line.textContent = driver ? `선택한 친구: ${driverLabel(driver)}` : '친구를 검색해서 고르세요.';
  }

  function renderProfileTable() {
    const host = $('friendInviteProfileTable');
    if (!host) return;
    const profiles = store().profiles.slice().sort((a, b) => driverName(a.driverId).localeCompare(driverName(b.driverId), 'ko'));
    if (!profiles.length) {
      host.innerHTML = '<p class="form-help">저장된 소개자 조건이 없습니다.</p>';
      return;
    }
    host.innerHTML = `
      <div class="table-wrap">
        <table class="promotion-table friend-invite-table">
          <thead>
            <tr>
              <th>소개자</th>
              <th>주간 목표 콜</th>
              <th>달성 지급액</th>
              <th>지급 주 수</th>
              <th>지급 대상</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${profiles.map(profile => `
              <tr>
                <td>${escapeHtml(driverName(profile.driverId))}</td>
                <td>${Number(profile.goalCalls).toLocaleString('ko-KR')}</td>
                <td>${won(profile.payAmount)}</td>
                <td>${Number(profile.payoutWeeks)}</td>
                <td>${escapeHtml(payTargetLabel(profile.payTarget))}</td>
                <td>
                  <button type="button" class="small-btn" data-action="edit-profile" data-id="${escapeHtml(profile.driverId)}">수정</button>
                  <button type="button" class="small-btn danger-btn" data-action="delete-profile" data-id="${escapeHtml(profile.driverId)}">삭제</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderLinkReferrerSelect() {
    const select = $('friendInviteLinkReferrer');
    const hint = $('friendInviteLinkHint');
    if (!select) return;
    const current = select.value || state.referrerId;
    const profiles = store().profiles.slice().sort((a, b) => driverName(a.driverId).localeCompare(driverName(b.driverId), 'ko'));
    select.innerHTML = '<option value="">소개자 선택</option>' + profiles.map(profile => `
      <option value="${escapeHtml(profile.driverId)}">${escapeHtml(driverName(profile.driverId))} · ${Number(profile.goalCalls)}콜 · ${won(profile.payAmount)} · ${Number(profile.payoutWeeks)}주 · ${escapeHtml(payTargetLabel(profile.payTarget))}</option>
    `).join('');
    if (profiles.some(profile => profile.driverId === current)) select.value = current;
    const selected = profiles.find(profile => profile.driverId === select.value);
    if (hint) {
      hint.textContent = selected
        ? `지금 연결하면 ${Number(selected.goalCalls)}콜, ${won(selected.payAmount)}, ${Number(selected.payoutWeeks)}주, 지급 대상 ${payTargetLabel(selected.payTarget)}이 이 친구에게 고정됩니다.`
        : '소개자 조건을 먼저 저장한 뒤 친구를 연결합니다.';
    }
  }

  function renderLinkTable() {
    const host = $('friendInviteLinkTable');
    if (!host) return;
    const links = store().links.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    if (!links.length) {
      host.innerHTML = '<p class="form-help">연결된 친구가 없습니다.</p>';
      return;
    }
    host.innerHTML = `
      <div class="table-wrap">
        <table class="promotion-table friend-invite-table">
          <thead>
            <tr>
              <th>소개자</th>
              <th>친구</th>
              <th>가입 정산주</th>
              <th>목표 콜</th>
              <th>지급액</th>
              <th>지급 주 수</th>
              <th>지급 대상</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${links.map(link => `
              <tr>
                <td>${escapeHtml(driverName(link.referrerId))}</td>
                <td>${escapeHtml(driverName(link.friendId))}</td>
                <td>${escapeHtml(shortDate(link.joinWeek))}</td>
                <td>${Number(link.goalCalls).toLocaleString('ko-KR')}</td>
                <td>${won(link.payAmount)}</td>
                <td>${Number(link.payoutWeeks)}</td>
                <td>${escapeHtml(payTargetLabel(link.payTarget))}</td>
                <td><button type="button" class="small-btn danger-btn" data-action="delete-link" data-id="${escapeHtml(link.id)}">연결 해제</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderWeekLabel() {
    const label = $('friendInviteWeekLabel');
    const input = $('friendInviteWeek');
    if (input) input.value = state.week;
    if (label) label.textContent = state.week ? `${shortDate(state.week)} ~ ${shortDate(weekEnd(state.week))} (수~화)` : '';
  }

  function renderResults() {
    const host = $('friendInviteResultTable');
    const stats = $('friendInviteStats');
    if (!host) return;
    const data = store();
    const profileById = new Map(data.profiles.map(profile => [profile.driverId, profile]));
    const rows = data.links.map(link => ({
      link,
      referrerName: driverName(link.referrerId),
      friendName: driverName(link.friendId),
      result: evaluate(link),
      referrerStill: profileById.has(link.referrerId)
    }));
    const payRows = rows.filter(row => row.result.kind === 'hit');
    const friendPaySum = payRows.reduce((sum, row) => sum + row.result.friendPay, 0);
    const referrerPaySum = payRows.reduce((sum, row) => sum + row.result.referrerPay, 0);
    const friendPayCount = payRows.filter(row => row.result.friendPay > 0).length;
    const referrerPayCount = payRows.filter(row => row.result.referrerPay > 0).length;
    if (stats) {
      stats.innerHTML = `
        <p>친구 지급 <strong>${friendPayCount.toLocaleString('ko-KR')}명 · ${won(friendPaySum)}</strong></p>
        <p>소개자 지급 <strong>${referrerPayCount.toLocaleString('ko-KR')}명 · ${won(referrerPaySum)}</strong></p>
        <p>지급 합계 <strong>${won(friendPaySum + referrerPaySum)}</strong></p>
        <p>연결 <strong>${rows.length.toLocaleString('ko-KR')}명</strong></p>
      `;
    }
    document.querySelectorAll('[data-friend-invite-filter]').forEach(button => {
      button.classList.toggle('active', button.dataset.friendInviteFilter === state.filter);
    });
    const visible = rows.filter(row => {
      if (state.filter === 'all') return true;
      return row.result.kind === state.filter;
    });
    const order = { hit: 0, miss: 1, pending: 2, wait: 3, done: 4 };
    visible.sort((a, b) => (order[a.result.kind] - order[b.result.kind]) || a.referrerName.localeCompare(b.referrerName, 'ko') || a.friendName.localeCompare(b.friendName, 'ko'));
    if (!rows.length) {
      host.innerHTML = '<p class="form-help">연결된 친구가 없어 정리할 내용이 없습니다.</p>';
      return;
    }
    if (!visible.length) {
      host.innerHTML = '<p class="form-help">이 구분에 해당하는 친구가 없습니다.</p>';
      return;
    }
    host.innerHTML = `
      <div class="table-wrap">
        <table class="promotion-table friend-invite-table">
          <thead>
            <tr>
              <th>소개자</th>
              <th>친구</th>
              <th>가입 정산주</th>
              <th>주차</th>
              <th>이번 주 콜</th>
              <th>목표</th>
              <th>결과</th>
              <th>지급 대상</th>
              <th>친구 지급</th>
              <th>소개자 지급</th>
            </tr>
          </thead>
          <tbody>
            ${visible.map(row => {
              const weekText = row.result.kind === 'wait'
                ? '-'
                : `${row.result.weekNo}/${Number(row.link.payoutWeeks)}주`;
              const callText = row.result.calls == null ? '-' : Number(row.result.calls).toLocaleString('ko-KR');
              return `
                <tr>
                  <td>${escapeHtml(row.referrerName)}</td>
                  <td>${escapeHtml(row.friendName)}</td>
                  <td>${escapeHtml(shortDate(row.link.joinWeek))}</td>
                  <td>${escapeHtml(weekText)}</td>
                  <td>${callText}</td>
                  <td>${Number(row.link.goalCalls).toLocaleString('ko-KR')}</td>
                  <td>${escapeHtml(resultLabel(row.result.kind))}</td>
                  <td>${escapeHtml(payTargetLabel(row.link.payTarget))}</td>
                  <td>${won(row.result.friendPay)}</td>
                  <td>${won(row.result.referrerPay)}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function render() {
    renderReferrerPick();
    renderFriendPick();
    renderProfileTable();
    renderLinkReferrerSelect();
    renderLinkTable();
    renderWeekLabel();
    renderResults();
  }

  function fillProfileForm(profile) {
    const goal = $('friendInviteGoal');
    const pay = $('friendInvitePay');
    const weeks = $('friendInviteWeeks');
    const target = $('friendInvitePayTarget');
    if (goal) goal.value = profile ? profile.goalCalls : '';
    if (pay) pay.value = profile ? profile.payAmount : '';
    if (weeks) weeks.value = profile ? profile.payoutWeeks : '';
    if (target) target.value = profile?.payTarget === 'both' || profile?.payTarget === 'friend' ? profile.payTarget : '';
  }

  function pickReferrer(id) {
    state.referrerId = String(id || '');
    const profile = store().profiles.find(item => item.driverId === state.referrerId);
    const query = $('friendInviteReferrerQuery');
    if (query) query.value = driverName(state.referrerId);
    renderSearchResults('friendInviteReferrerResults', '', 'pick-referrer');
    fillProfileForm(profile);
    renderReferrerPick();
    const select = $('friendInviteLinkReferrer');
    if (select && store().profiles.some(item => item.driverId === state.referrerId)) {
      select.value = state.referrerId;
      renderLinkReferrerSelect();
    }
  }

  function pickFriend(id) {
    state.friendId = String(id || '');
    const driver = driverById(state.friendId);
    const query = $('friendInviteFriendQuery');
    if (query) query.value = driver ? String(driver.name || '') : '';
    renderSearchResults('friendInviteFriendResults', '', 'pick-friend');
    const joinInput = $('friendInviteJoinWeek');
    if (joinInput && driver?.joinDate) {
      const week = weekStartWednesday(driver.joinDate);
      if (week) joinInput.value = week;
    } else if (joinInput && !joinInput.value) {
      joinInput.value = state.week;
    }
    renderFriendPick();
  }

  async function saveProfile(event) {
    event.preventDefault();
    const driverId = state.referrerId;
    if (!driverById(driverId)) {
      showToast('소개자를 검색해서 고르세요.');
      return;
    }
    const goalCalls = clampInt($('friendInviteGoal')?.value, 1, 9999);
    const payAmount = clampInt($('friendInvitePay')?.value, 0, 10000000);
    const payoutWeeks = clampInt($('friendInviteWeeks')?.value, 1, MAX_WEEKS);
    const payTarget = $('friendInvitePayTarget')?.value === 'both' || $('friendInvitePayTarget')?.value === 'friend'
      ? $('friendInvitePayTarget').value
      : '';
    if (goalCalls == null || payAmount == null || payoutWeeks == null) {
      showToast(`목표는 1~9999콜, 지급액은 0원 이상, 지급 주는 1~${MAX_WEEKS}주로 입력하세요.`);
      return;
    }
    if (!payTarget) {
      showToast('지급 대상을 친구만 또는 둘 다로 선택하세요.');
      return;
    }
    const data = store();
    const nextProfile = {
      driverId,
      goalCalls,
      payAmount,
      payoutWeeks,
      payTarget,
      updatedAt: new Date().toISOString()
    };
    const profiles = data.profiles.filter(item => item.driverId !== driverId);
    profiles.unshift(nextProfile);
    try {
      await saveStore({ profiles, links: data.links });
      showToast('소개자 조건을 저장했습니다. 이미 연결된 친구 조건은 바뀌지 않습니다.');
      render();
    } catch (error) {
      showToast(error?.message || '조건을 저장하지 못했습니다.');
    }
  }

  async function saveLink(event) {
    event.preventDefault();
    const referrerId = String($('friendInviteLinkReferrer')?.value || '').trim();
    const friendId = state.friendId;
    const data = store();
    const profile = data.profiles.find(item => item.driverId === referrerId);
    if (!profile) {
      showToast('소개자 기본 조건을 먼저 저장하세요.');
      return;
    }
    if (profile.payTarget !== 'friend' && profile.payTarget !== 'both') {
      showToast('소개자 조건에서 지급 대상을 먼저 선택하세요.');
      return;
    }
    if (!driverById(friendId)) {
      showToast('친구를 검색해서 고르세요.');
      return;
    }
    if (friendId === referrerId) {
      showToast('본인을 친구로 연결할 수 없습니다.');
      return;
    }
    if (data.links.some(link => link.friendId === friendId)) {
      showToast('이미 연결된 친구입니다. 조건을 바꾸려면 연결을 해제한 뒤 다시 연결하세요.');
      return;
    }
    const joinWeek = weekStartWednesday($('friendInviteJoinWeek')?.value);
    if (!joinWeek) {
      showToast('가입 정산주를 선택하세요.');
      return;
    }
    const link = {
      id: BremStorage.createId(),
      referrerId,
      friendId,
      joinWeek,
      goalCalls: profile.goalCalls,
      payAmount: profile.payAmount,
      payoutWeeks: profile.payoutWeeks,
      payTarget: profile.payTarget,
      createdAt: new Date().toISOString()
    };
    try {
      await saveStore({ profiles: data.profiles, links: [link, ...data.links] });
      showToast('친구를 연결했습니다. 이 친구 조건은 지금 값으로 고정됩니다.');
      state.friendId = '';
      const query = $('friendInviteFriendQuery');
      if (query) query.value = '';
      renderFriendPick();
      render();
    } catch (error) {
      showToast(error?.message || '친구를 연결하지 못했습니다.');
    }
  }

  async function deleteProfile(driverId) {
    const data = store();
    const linked = data.links.filter(link => link.referrerId === driverId).length;
    const name = driverName(driverId);
    const message = linked
      ? `${name} 기본 조건을 지웁니다. 이미 연결된 친구 ${linked}명의 고정 조건은 남습니다.`
      : `${name} 기본 조건을 지웁니다.`;
    if (!window.confirm(message)) return;
    try {
      await saveStore({
        profiles: data.profiles.filter(item => item.driverId !== driverId),
        links: data.links
      });
      if (state.referrerId === driverId) {
        state.referrerId = '';
        fillProfileForm(null);
      }
      showToast('소개자 조건을 삭제했습니다.');
      render();
    } catch (error) {
      showToast(error?.message || '조건을 삭제하지 못했습니다.');
    }
  }

  async function deleteLink(id) {
    const data = store();
    const link = data.links.find(item => item.id === id);
    if (!link) return;
    if (!window.confirm(`${driverName(link.referrerId)} → ${driverName(link.friendId)} 연결을 해제합니다.`)) return;
    try {
      await saveStore({
        profiles: data.profiles,
        links: data.links.filter(item => item.id !== id)
      });
      showToast('연결을 해제했습니다.');
      render();
    } catch (error) {
      showToast(error?.message || '연결을 해제하지 못했습니다.');
    }
  }

  async function runDriverSearch(kind, containerId, query, action) {
    renderSearchResults(containerId, query, action);
    const keyword = String(query || '').trim();
    if (keyword.length < 1 || !BremStorage.searchDriversAndMerge) return;
    const token = (state.searchTokens[kind] || 0) + 1;
    state.searchTokens[kind] = token;
    try {
      await BremStorage.searchDriversAndMerge(keyword, { limit: 30 });
    } catch (error) {
      return;
    }
    if (state.searchTokens[kind] !== token) return;
    const inputId = kind === 'referrer' ? 'friendInviteReferrerQuery' : 'friendInviteFriendQuery';
    const input = $(inputId);
    if (document.activeElement !== input) return;
    if (String(input.value || '').trim() !== keyword) return;
    renderSearchResults(containerId, keyword, action);
  }

  function onClick(event) {
    const inReferrerSearch = event.target.closest('#friendInviteReferrerResults, #friendInviteReferrerQuery');
    const inFriendSearch = event.target.closest('#friendInviteFriendResults, #friendInviteFriendQuery');
    if (!inReferrerSearch) renderSearchResults('friendInviteReferrerResults', '', 'pick-referrer');
    if (!inFriendSearch) renderSearchResults('friendInviteFriendResults', '', 'pick-friend');
    const button = event.target.closest('[data-action], [data-friend-invite-filter]');
    if (!button || !event.currentTarget.contains(button)) return;
    const filter = button.dataset.friendInviteFilter;
    if (filter) {
      state.filter = filter;
      renderResults();
      return;
    }
    const action = button.dataset.action;
    const id = button.dataset.id;
    if (action === 'pick-referrer') pickReferrer(id);
    if (action === 'pick-friend') pickFriend(id);
    if (action === 'edit-profile') pickReferrer(id);
    if (action === 'delete-profile') void deleteProfile(id);
    if (action === 'delete-link') void deleteLink(id);
  }

  function onInput(event) {
    const target = event.target;
    if (target.id === 'friendInviteReferrerQuery') {
      state.referrerId = '';
      renderReferrerPick();
      void runDriverSearch('referrer', 'friendInviteReferrerResults', target.value, 'pick-referrer');
    }
    if (target.id === 'friendInviteFriendQuery') {
      state.friendId = '';
      renderFriendPick();
      void runDriverSearch('friend', 'friendInviteFriendResults', target.value, 'pick-friend');
    }
  }

  function onChange(event) {
    const target = event.target;
    if (target.id === 'friendInviteWeek') {
      const week = weekStartWednesday(target.value);
      state.week = week || weekStartWednesday(todayKey());
      invalidateCalls();
      renderWeekLabel();
      renderResults();
    }
    if (target.id === 'friendInviteJoinWeek') {
      const week = weekStartWednesday(target.value);
      if (week && target.value !== week) target.value = week;
    }
    if (target.id === 'friendInviteLinkReferrer') renderLinkReferrerSelect();
  }

  function bind() {
    if (state.bound) return;
    const root = $('friend-invite');
    if (!root) return;
    state.bound = true;
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    $('friendInviteProfileForm')?.addEventListener('submit', event => { void saveProfile(event); });
    $('friendInviteLinkForm')?.addEventListener('submit', event => { void saveLink(event); });
  }

  function refresh() {
    bind();
    if (!state.week) state.week = weekStartWednesday(todayKey());
    invalidateCalls();
    const joinInput = $('friendInviteJoinWeek');
    if (joinInput && !joinInput.value) joinInput.value = state.week;
    render();
    void hydrateLinkedNames();
  }

  return { refresh };
})();
