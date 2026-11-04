let abortRequested = false;

// [복구] 수집 중단요청 플래그 API. 수집 루프(baemin-dashboard-live-collect / baemin-collect-pipeline)가
// 매 반복마다 isAbortRequested() 로 확인하고, 세션 서버는 requestAbort() 로 정지를 신호한다.
// (병합 중 이 함수들이 모듈에서 누락돼 수집이 isAbortRequested is not a function 으로 전부 실패했었음)
function requestAbort() {
  abortRequested = true;
  return true;
}

function clearAbort() {
  abortRequested = false;
  return true;
}

function isAbortRequested() {
  return abortRequested === true;
}

let state = {
  active: false,
  percent: 0,
  phase: '',
  collectDate: '',
  partnerIndex: 0,
  partnerTotal: 0,
  partnerId: '',
  partnerName: '',
  menuId: '',
  menuLabel: '',
  dayIndex: 0,
  dayTotal: 0,
  dayDate: '',
  savedSoFar: 0,
  message: '',
  startedAt: null,
  updatedAt: null
};

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function recomputePercent() {
  const partnerTotal = Number(state.partnerTotal) || 0;
  if (!partnerTotal) {
    state.percent = state.active ? 1 : 0;
    return;
  }
  const partnerDone = Math.max(0, Number(state.partnerIndex) - 1);
  const dayTotal = Number(state.dayTotal) || 0;
  const dayIndex = Number(state.dayIndex) || 0;
  let fraction = partnerDone / partnerTotal;
  if (dayTotal > 0) {
    fraction += (dayIndex / dayTotal) / partnerTotal;
  } else if (state.partnerIndex > 0) {
    fraction += 1 / partnerTotal;
  }
  state.percent = state.active ? clampPercent(fraction * 99) : clampPercent(fraction * 100);
}

function touch() {
  state.updatedAt = new Date().toISOString();
  recomputePercent();
}

function startCollect({
  collectDate = '',
  partnerTotal = 0,
  menuLabel = ''
} = {}) {
  abortRequested = false; // 새 수집 시작 시 이전 중단요청 초기화
  state = {
    active: true,
    percent: 1,
    phase: 'starting',
    collectDate: String(collectDate || '').slice(0, 10),
    partnerIndex: 0,
    partnerTotal: Number(partnerTotal) || 0,
    partnerId: '',
    partnerName: '',
    menuId: '',
    menuLabel: String(menuLabel || '').trim(),
    dayIndex: 0,
    dayTotal: 0,
    dayDate: '',
    savedSoFar: 0,
    message: '수집 준비 중…',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  touch();
  return getCollectProgress();
}

/** 이미 수집 중이면 false — 수동/자동/모닝 크롤 동시 실행 방지 */
function tryStartCollect(options = {}) {
  if (state.active) {
    return { ok: false, busy: true, progress: getCollectProgress() };
  }
  return { ok: true, busy: false, progress: startCollect(options) };
}

function isCollectActive() {
  return state.active === true;
}

function updatePartner({
  index = 0,
  total = 0,
  partnerId = '',
  partnerName = ''
} = {}) {
  if (!state.active) return getCollectProgress();
  state.partnerIndex = Number(index) || 0;
  if (total) state.partnerTotal = Number(total) || state.partnerTotal;
  state.partnerId = String(partnerId || '').trim();
  state.partnerName = String(partnerName || '').trim();
  state.dayIndex = 0;
  state.dayTotal = 0;
  state.dayDate = '';
  state.phase = 'partner';
  state.message = state.partnerName
    ? `협력사 ${state.partnerIndex}/${state.partnerTotal} · ${state.partnerName}`
    : `협력사 ${state.partnerIndex}/${state.partnerTotal}`;
  touch();
  return getCollectProgress();
}

function updateMenu({ menuId = '', menuLabel = '' } = {}) {
  if (!state.active) return getCollectProgress();
  state.menuId = String(menuId || '').trim();
  state.menuLabel = String(menuLabel || '').trim();
  state.phase = 'menu';
  if (state.menuLabel) {
    state.message = `${state.message.split(' · ')[0] || state.message} · ${state.menuLabel}`;
  }
  touch();
  return getCollectProgress();
}

function updateDay({
  dayIndex = 0,
  dayTotal = 0,
  dayDate = ''
} = {}) {
  if (!state.active) return getCollectProgress();
  state.dayIndex = Number(dayIndex) || 0;
  state.dayTotal = Number(dayTotal) || 0;
  state.dayDate = String(dayDate || '').slice(0, 10);
  state.phase = 'day';
  const base = state.partnerName
    ? `협력사 ${state.partnerIndex}/${state.partnerTotal} · ${state.partnerName}`
    : `협력사 ${state.partnerIndex}/${state.partnerTotal}`;
  if (state.dayDate && state.dayTotal) {
    state.message = `${base} · ${state.dayDate} (${state.dayIndex}/${state.dayTotal}일)`;
  } else {
    state.message = base;
  }
  touch();
  return getCollectProgress();
}

function addSaved(count = 0) {
  if (!state.active) return getCollectProgress();
  state.savedSoFar += Number(count) || 0;
  touch();
  return getCollectProgress();
}

function setPartnerTotal(total = 0) {
  if (!state.active) return getCollectProgress();
  state.partnerTotal = Math.max(1, Number(total) || 0);
  touch();
  return getCollectProgress();
}

function skipPartner({
  index = 0,
  total = 0,
  partnerId = '',
  partnerName = '',
  message = ''
} = {}) {
  if (!state.active) return getCollectProgress();
  state.partnerIndex = Number(index) || state.partnerIndex;
  if (total) state.partnerTotal = Number(total) || state.partnerTotal;
  state.partnerId = String(partnerId || '').trim();
  state.partnerName = String(partnerName || '').trim();
  state.dayIndex = 0;
  state.dayTotal = 0;
  state.dayDate = '';
  state.phase = 'partner_skip';
  const base = state.partnerName
    ? `협력사 ${state.partnerIndex}/${state.partnerTotal} · ${state.partnerName}`
    : `협력사 ${state.partnerIndex}/${state.partnerTotal}`;
  state.message = message || `${base} · 생략`;
  touch();
  return getCollectProgress();
}

function finishCollect({ ok = true, savedTotal = 0, message = '' } = {}) {
  state.active = false;
  state.percent = 100;
  state.phase = ok ? 'done' : 'failed';
  state.savedSoFar = Number(savedTotal) || state.savedSoFar;
  state.message = message || (ok ? `수집 완료 · ${state.savedSoFar}건` : '수집 실패');
  state.updatedAt = new Date().toISOString();
  return getCollectProgress();
}

function clearProgress() {
  abortRequested = false;
  state = {
    active: false,
    percent: 0,
    phase: '',
    collectDate: '',
    partnerIndex: 0,
    partnerTotal: 0,
    partnerId: '',
    partnerName: '',
    menuId: '',
    menuLabel: '',
    dayIndex: 0,
    dayTotal: 0,
    dayDate: '',
    savedSoFar: 0,
    message: '',
    startedAt: null,
    updatedAt: null
  };
  return getCollectProgress();
}

function getCollectProgress() {
  return { ...state };
}

module.exports = {
  startCollect,
  tryStartCollect,
  isCollectActive,
  updatePartner,
  updateMenu,
  updateDay,
  addSaved,
  setPartnerTotal,
  skipPartner,
  finishCollect,
  clearProgress,
  getCollectProgress,
  requestAbort,
  clearAbort,
  isAbortRequested
};
