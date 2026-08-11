(function () {
  const state = {
    config: null,
    loading: false,
    collecting: false,
    sessionRefreshing: false,
    applying: false,
    setupPollTimer: null,
    statusPollTimer: null,
    localHealthPollTimer: null,
    localServerRunning: false,
    localBrowser: null,
    localSession: null,
    localAutoCollect: null,
    activeSection: 'baemin-biz-status',
    activePartnerId: '',
    selectedPartnerIds: [],
    dashboardSelectedPartnerIds: [],
    dashboardBaeminRegions: [],
    dashboardWeekPartnerId: '',
    dashboardWeekCache: {},
    dashboardLivePollTimer: null,
    dashboardLiveBusy: false,
    dashboardLiveFetchedAt: 0,
    dashboardLastActivity: 0,
    activeMenu: 'delivery_status',
    partners: [],
    contamination: null,
    appliedCollectDate: '',
    viewWeekStart: '',
    riderViewFromDate: '',
    riderViewToDate: '',
    riderCollectRange: null,
    dailyCollectRange: null,
    lastRiderDayResults: null,
    lastCoverage: { rider_history: null, daily_history: null },
    partnerRegionMap: {},
    partnerRegionItems: [],
    viewPartnerIds: [],
    partnerSetCountMap: {},
    weekdayQuotaMatrix: null,
    weekdayQuotaMeta: { updatedAt: '', updatedBy: '', isDefault: true },
    canManageRegions: false,
    viewLoaded: false,
    lastClientRefreshAt: '',
    grandTotals: null,
    bizPreviewCollectDate: '',
    dataCache: {
      key: '',
      byPartner: {},
      loadingPartner: ''
    },
    statusAutoLoop: {
      active: false,
      round: 0,
      phase: 'idle',
      message: '',
      waitEndsAt: 0,
      timer: null
    },
    riderLiveSyncRunning: false,
    crawlOperatorAllowed: false,
    localSessionConfig: {
      port: 3939,
      localHealthUrls: [
        'http://127.0.0.1:3939/health',
        'http://localhost:3939/health'
      ]
    }
  };

  function $(id) {
    return document.getElementById(id);
  }

  function showToast(message) {
    document.dispatchEvent(new CustomEvent('brem-admin-toast', { detail: { message } }));
  }

  async function adminApi(path, options = {}) {
    const token = await BremStorage.resolveAdminAccessToken?.();
    if (!token) {
      return { ok: false, message: '관리자 로그인이 필요합니다.' };
    }

    try {
      const response = await fetch(path, {
        credentials: 'same-origin',
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          ok: false,
          message: payload.message || payload.error || `요청 실패 (${response.status})`
        };
      }
      return { ok: true, ...payload };
    } catch (error) {
      return { ok: false, message: error.message || '네트워크 오류' };
    }
  }

  const MENU_IDS = ['delivery_status', 'daily_history', 'rider_history'];
  const VIEW_MENU_IDS = [...MENU_IDS, 'quota_achievement', 'weekday_quota', 'accept_rate_live', 'calls_rejection_sync'];
  const REGION_MAP_CACHE_KEY = 'brem_baemin_region_map_v2';

  const WEEKDAY_QUOTA_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const WEEKDAY_QUOTA_SLOT_KEYS = ['morning', 'afternoon', 'evening', 'midnight'];
  const WEEKDAY_QUOTA_SLOT_LABELS = {
    morning: '아침점심',
    afternoon: '오후',
    evening: '저녁',
    midnight: '심야'
  };
  /** 1세트 기본값 — 토 심야 31 (업로드 표 기준; 구코드 토 심야 35와 다름) */
  const DEFAULT_WEEKDAY_QUOTA = {
    mon: { morning: 21, afternoon: 20, evening: 30, midnight: 29 },
    tue: { morning: 21, afternoon: 20, evening: 30, midnight: 29 },
    wed: { morning: 21, afternoon: 20, evening: 30, midnight: 29 },
    thu: { morning: 21, afternoon: 20, evening: 30, midnight: 29 },
    fri: { morning: 24, afternoon: 21, evening: 32, midnight: 33 },
    sat: { morning: 31, afternoon: 22, evening: 36, midnight: 31 },
    sun: { morning: 33, afternoon: 22, evening: 35, midnight: 30 }
  };

  function cloneDefaultWeekdayQuota() {
    return JSON.parse(JSON.stringify(DEFAULT_WEEKDAY_QUOTA));
  }

  function normalizeQuotaSlotValue(value, fallback = 0) {
    const num = Math.floor(Number(value));
    if (!Number.isFinite(num) || num < 0) return Math.max(0, Math.floor(Number(fallback) || 0));
    return Math.min(num, 9999);
  }

  function normalizeWeekdayQuotaMatrix(raw) {
    const defaults = cloneDefaultWeekdayQuota();
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const matrix = {};
    WEEKDAY_QUOTA_KEYS.forEach(day => {
      const row = source[day] && typeof source[day] === 'object' ? source[day] : {};
      const fallback = defaults[day];
      matrix[day] = {};
      WEEKDAY_QUOTA_SLOT_KEYS.forEach(slot => {
        matrix[day][slot] = normalizeQuotaSlotValue(row[slot], fallback[slot]);
      });
    });
    return matrix;
  }

  function ensureWeekdayQuotaMatrix() {
    if (!state.weekdayQuotaMatrix) {
      state.weekdayQuotaMatrix = cloneDefaultWeekdayQuota();
    }
    return state.weekdayQuotaMatrix;
  }

  function weekdayKeyKst(dateKey) {
    const date = String(dateKey || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'mon';
    const dow = new Date(`${date}T12:00:00+09:00`).getUTCDay();
    return WEEKDAY_QUOTA_KEYS[(dow + 6) % 7];
  }

  function weekdayShortLabelKst(dateKey) {
    const key = weekdayKeyKst(dateKey);
    return ({ mon: '월', tue: '화', wed: '수', thu: '목', fri: '금', sat: '토', sun: '일' })[key] || '';
  }

  function formatDeliveryDateWithWeekday(dateKey) {
    const date = String(dateKey || '').slice(0, 10);
    const wd = weekdayShortLabelKst(date);
    return wd ? `${date} (${wd})` : date;
  }

  function normalizeSetCount(value) {
    const num = Math.floor(Number(value));
    if (!Number.isFinite(num) || num < 1) return 1;
    return Math.min(num, 99);
  }

  function computeSlotTargets(setCount, dateKey) {
    const sets = normalizeSetCount(setCount);
    const matrix = ensureWeekdayQuotaMatrix();
    const day = weekdayKeyKst(dateKey);
    const base = matrix[day] || matrix.mon;
    return {
      morning: base.morning * sets,
      afternoon: base.afternoon * sets,
      evening: base.evening * sets,
      midnight: base.midnight * sets
    };
  }

  function formatProgress(actual, target) {
    const done = Number(actual || 0);
    const goal = Math.max(0, Number(target || 0));
    const percent = goal > 0 ? Math.round((done / goal) * 1000) / 10 : (done > 0 ? 100 : 0);
    return {
      actual: done,
      target: goal,
      label: `${formatNumber(done)}/${formatNumber(goal)}`,
      percent,
      percentLabel: `${percent}%`
    };
  }

  function getPartnerSetCount(partnerId) {
    const pid = normalizePartnerId(partnerId);
    return normalizeSetCount(state.partnerSetCountMap?.[pid]?.setCount || 1);
  }

  function isDrivingStatus(statusDesc) {
    const compact = String(statusDesc || '').replace(/\s+/g, '');
    if (!compact) return false;
    if (compact.includes('운행종료') || compact.includes('운행중지') || compact.includes('운행불가')) return false;
    return compact.includes('운행중');
  }

  function countDrivingRiders(items = []) {
    return (items || []).reduce((sum, row) => {
      const status = row?.parsed_json?.statusDesc || row?.statusDesc || '';
      return sum + (isDrivingStatus(status) ? 1 : 0);
    }, 0);
  }

  function partnerIdFromDedupeKey(dedupeKey = '') {
    const prefix = String(dedupeKey || '').split(':')[0].trim().toUpperCase();
    return /^DP\d{6,}$/.test(prefix) ? prefix : '';
  }

  /** 서버 응답이 섞여 와도 화면에는 선택 지역만 표시 */
  function filterRowsByPartnerId(items, partnerId) {
    const want = normalizePartnerId(partnerId);
    if (!want) return [];
    return (items || []).filter(row => {
      const fromKey = partnerIdFromDedupeKey(row?.dedupe_key);
      if (fromKey) return fromKey === want;
      // 기간 합산 라이더 행처럼 dedupe_key 가 비어 있으면 parsed partnerId 로 판별
      const fromParsed = normalizePartnerId(row?.parsed_json?.partnerId);
      return fromParsed === want;
    });
  }

  function filterRowsByPartnerIds(items, partnerIds = []) {
    const want = new Set((partnerIds || []).map(normalizePartnerId).filter(Boolean));
    if (!want.size) return [];
    return (items || []).filter(row => {
      const fromKey = partnerIdFromDedupeKey(row?.dedupe_key);
      if (fromKey) return want.has(fromKey);
      const fromParsed = normalizePartnerId(row?.parsed_json?.partnerId);
      return want.has(fromParsed);
    });
  }

  function resolveRowPartnerId(row) {
    return partnerIdFromDedupeKey(row?.dedupe_key)
      || normalizePartnerId(row?.parsed_json?.partnerId)
      || '';
  }

  function partnerLabelById(partnerId) {
    const pid = normalizePartnerId(partnerId);
    const partner = (state.partners || []).find(item => normalizePartnerId(item.partnerId) === pid);
    if (partner) return partnerDisplayLabel(partner);
    const dash = (state.dashboardBaeminRegions || []).find(item => item.partnerId === pid);
    if (dash?.regionName) return dash.regionName;
    return resolveRegisteredRegionName(pid) || pid || '-';
  }

  async function refreshDeliveryLiveFromLocalServer() {
    if (!state.localServerRunning) {
      try {
        await refreshLocalServerStatus();
      } catch (_e) { /* ignore */ }
    }
    if (!state.localServerRunning) {
      return { ok: false, skipped: true, message: '로컬 세션 서버 미실행 — 최신 저장 데이터로 조회합니다.' };
    }
    if (state.collecting || state.applying || state.localAutoCollect?.collectRunning || state.riderLiveSyncRunning || state.statusAutoLoop?.active) {
      return { ok: false, skipped: true, message: '다른 수집이 진행 중이라 저장 스냅샷으로 조회합니다.' };
    }
    const result = await callLocalServer('/rider-live-sync', {
      method: 'POST',
      body: {},
      timeoutMs: 300000
    });
    if (!result.ok) {
      return {
        ok: false,
        skipped: false,
        message: result.message || '실시간 수집에 실패했습니다. 저장 스냅샷으로 조회합니다.'
      };
    }
    invalidateDataCache();
    if (result.collectDate) {
      state.appliedCollectDate = result.collectDate;
    }
    await loadViewConfig();
    return { ok: true, skipped: false, message: result.message || '실시간 수집·저장 완료', collectDate: result.collectDate };
  }

  function readCachedRegionMap() {
    try {
      const raw = sessionStorage.getItem(REGION_MAP_CACHE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeCachedRegionMap(map) {
    try {
      sessionStorage.setItem(REGION_MAP_CACHE_KEY, JSON.stringify(map || {}));
    } catch {
      /* ignore */
    }
  }

  function showRegionTabsFromMap(map = state.partnerRegionMap) {
    const viewPartners = filterPartnersForView(Object.keys(map || {}).map(id => ({
      partnerId: id,
      regionName: map[id],
      displayName: map[id]
    })));
    state.partners = viewPartners;
    const bar = $(tableUiConfig().partnerBarId);
    if (bar) bar.hidden = !viewPartners.length;
    renderPartnerTabs(viewPartners);
    updateWeekPickerVisibility();
    updatePanelVisibility();
  }

  function isViewSection() {
    return state.activeSection === 'baemin-status';
  }

  function resolveBizCaptureDate() {
    return String(
      state.bizPreviewCollectDate
      || $('baeminDeliveryCaptureDate')?.value
      || todayKstDate()
    ).slice(0, 10);
  }

  function setBizCaptureDate(date) {
    const value = String(date || '').slice(0, 10);
    if (!value) return;
    state.bizPreviewCollectDate = value;
    const dateInput = $('baeminDeliveryCaptureDate');
    if (dateInput) dateInput.value = value;
  }

  function clearBizPreviewTables(message) {
    const ui = tableUiConfig();
    const text = message || ui.emptyMessage;
    Object.entries(ui.rowsMap).forEach(([menu, rowsId]) => {
      const summaryId = ui.summaryMap[menu];
      const summaryEl = $(summaryId);
      const rowsEl = $(rowsId);
      const colspan = getBaeminTableColspan(menu, { showPartner: false, includeCollected: !isViewSection() });
      if (summaryEl) summaryEl.textContent = '데이터 없음';
      if (rowsEl) rowsEl.innerHTML = `<tr><td colspan="${colspan}" class="form-help">${text}</td></tr>`;
    });
  }

  function ensureBizCollectWeekStart() {
    if (state.bizCollectWeekStart) return state.bizCollectWeekStart;
    const today = todayKstDate();
    state.bizCollectWeekStart = window.BremDatePicker?.applyWeekWednesday?.(today) || today;
    return state.bizCollectWeekStart;
  }

  function syncBizCollectWeekPicker() {
    const hidden = $('baeminBizCollectWeekStart');
    const label = $('baeminBizCollectWeekLabel');
    const rangeLabel = $('baeminBizCollectWeekRangeLabel');
    const weekStart = ensureBizCollectWeekStart();
    if (hidden) hidden.value = weekStart;
    if (label && window.BremDatePicker) {
      const weekday = BremDatePicker.formatWeekdayKo?.(weekStart) || '';
      label.textContent = weekday
        ? `${BremDatePicker.formatDate(weekStart)}(${weekday})`
        : (BremDatePicker.formatDate(weekStart) || weekStart);
    }
    if (rangeLabel) {
      rangeLabel.textContent = weekStart
        ? `수집 ${formatViewWeekRangeLabel(weekStart)}`
        : '';
    }
  }

  function applyBizWeekToCollectRangeInputs(weekStart = ensureBizCollectWeekStart()) {
    const range = computeViewWeekQueryRange(weekStart);
    setEnhancedDateInput('baeminDailyCollectFrom', range.fromDate);
    setEnhancedDateInput('baeminDailyCollectTo', range.toDate);
    setEnhancedDateInput('baeminRiderCollectFrom', range.fromDate);
    setEnhancedDateInput('baeminRiderCollectTo', range.toDate);
    return range;
  }

  function handleBizCollectWeekSelect(value) {
    const normalized = window.BremDatePicker?.applyWeekWednesday?.(value) || String(value || '').slice(0, 10);
    state.bizCollectWeekStart = normalized;
    syncBizCollectWeekPicker();
    applyBizWeekToCollectRangeInputs(normalized);
  }

  function ensureViewWeekStart() {
    if (state.viewWeekStart) return state.viewWeekStart;
    const today = todayKstDate();
    state.viewWeekStart = settlementWednesdayOf(today)
      || window.BremDatePicker?.applyWeekWednesday?.(today)
      || today;
    return state.viewWeekStart;
  }

  function computeViewWeekQueryRange(weekStart = ensureViewWeekStart()) {
    const fromDate = settlementWednesdayOf(weekStart)
      || window.BremDatePicker?.applyWeekWednesday?.(weekStart)
      || String(weekStart || '').slice(0, 10);
    const weekEnd = window.BremDatePicker?.weekEndKey?.(fromDate) || addDaysDate(fromDate, 6);
    // 이번주 조회: 수요일 ~ 오늘(또는 주 종료 화요일 중 더 이른 날)
    const latest = todayKstDate();
    let toDate = weekEnd < latest ? weekEnd : latest;
    if (toDate < fromDate) {
      toDate = fromDate;
    }
    return { fromDate, toDate, weekEnd };
  }

  function formatViewWeekRangeLabel(weekStart) {
    const range = computeViewWeekQueryRange(weekStart);
    if (range.fromDate && range.toDate) {
      const fromDate = range.fromDate <= range.toDate ? range.fromDate : range.toDate;
      const toDate = range.fromDate <= range.toDate ? range.toDate : range.fromDate;
      return `${fromDate} ~ ${toDate}`;
    }
    if (window.BremDatePicker?.formatWednesdayWeekRange) {
      return BremDatePicker.formatWednesdayWeekRange(weekStart);
    }
    return weekStart || '';
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isGenericPartnerLabel(text) {
    const compact = String(text || '').replace(/\s+/g, '');
    if (!compact) return true;
    return /^(주식회사)?팀브로$/i.test(compact);
  }

  function resolveRegisteredRegionName(partnerId) {
    const id = String(partnerId || '').trim().toUpperCase();
    if (!id) return '';
    return String(state.partnerRegionMap?.[id] || state.partnerRegionMap?.[partnerId] || '').trim();
  }

  function normalizePartnerId(partnerId) {
    return String(partnerId || '').trim().toUpperCase();
  }

  function getSelectedPartnerIds() {
    if (isViewSection()) {
      const ids = [...new Set((state.selectedPartnerIds || []).map(normalizePartnerId).filter(Boolean))];
      if (ids.length) return ids;
      const one = normalizePartnerId(state.activePartnerId);
      return one ? [one] : [];
    }
    const one = normalizePartnerId(state.activePartnerId);
    return one ? [one] : [];
  }

  function syncSelectedPartnerIds(preferredId = '') {
    const allowed = new Set((state.partners || []).map(p => normalizePartnerId(p.partnerId)).filter(Boolean));
    let ids = [...new Set((state.selectedPartnerIds || []).map(normalizePartnerId).filter(id => allowed.has(id)))];
    const preferred = normalizePartnerId(preferredId);
    if (preferred && allowed.has(preferred) && !ids.includes(preferred)) {
      ids = [...ids, preferred];
    }
    if (!ids.length && preferred && allowed.has(preferred)) {
      ids = [preferred];
    }
    if (!ids.length && allowed.size) {
      const first = normalizePartnerId(state.partners[0]?.partnerId);
      if (first) ids = [first];
    }
    state.selectedPartnerIds = ids;
    if (!ids.includes(normalizePartnerId(state.activePartnerId))) {
      state.activePartnerId = ids[0] || '';
    }
    return ids;
  }

  function filterPartnersForView(partners = []) {
    const map = state.partnerRegionMap || {};
    // 계정 배정 지역만 (서버 viewPartnerIds). 없으면 map 키(=이미 스코프된 목록)
    const allowed = (state.viewPartnerIds || []).length
      ? new Set(state.viewPartnerIds.map(id => String(id || '').trim().toUpperCase()).filter(Boolean))
      : new Set(Object.keys(map).map(id => String(id || '').trim().toUpperCase()));
    const registeredIds = Object.keys(map)
      .map(id => String(id || '').trim().toUpperCase())
      .filter(id => allowed.has(id));
    if (!registeredIds.length) return [];

    const byId = new Map();
    (partners || []).forEach(partner => {
      const id = String(partner.partnerId || '').trim().toUpperCase();
      if (id) byId.set(id, partner);
    });

    return registeredIds
      .map(rawId => {
        const id = String(rawId || '').trim().toUpperCase();
        const regionName = String(map[rawId] || map[id] || '').trim();
        const hit = byId.get(id);
        if (hit) {
          return {
            ...hit,
            partnerId: id,
            regionName,
            displayName: regionName
          };
        }
        return {
          partnerId: id,
          partnerName: '',
          regionName,
          displayName: regionName,
          riderCount: 0,
          menuCounts: {
            delivery_status: 0,
            daily_history: 0,
            rider_history: 0
          }
        };
      })
      .sort((a, b) => String(a.displayName || '').localeCompare(String(b.displayName || ''), 'ko'));
  }

  function hasRegisteredViewPartners() {
    return Object.keys(state.partnerRegionMap || {}).length > 0;
  }

  function bizPartnerTabLabel(partner) {
    const id = normalizePartnerId(partner?.partnerId);
    return resolveRegisteredRegionName(id) || id || partner?.partnerName || '-';
  }

  function partnerDisplayLabel(partner) {
    if (!partner) return '-';
    const id = String(partner.partnerId || '').trim();
    const saved = state.partnerRegionMap?.[id] || state.partnerRegionMap?.[id.toUpperCase()];
    if (isViewSection()) {
      if (saved) return saved;
      return id || '-';
    }
    return partner.partnerName || partner.partnerId || '-';
  }

  function defaultRiderViewDateRange() {
    const saved = state.config?.riderCollectRange;
    if (saved?.fromDate && saved?.toDate && saved.toDate >= saved.fromDate) {
      return { fromDate: saved.fromDate, toDate: saved.toDate };
    }
    const toDate = addDaysDate(todayKstDate(), -1);
    return { fromDate: addDaysDate(toDate, -6), toDate };
  }

  function syncViewWeekPicker() {
    const hidden = $('baeminStatusWeekStart');
    const label = $('baeminStatusWeekStartLabel');
    const rangeLabel = $('baeminStatusWeekRangeLabel');
    const weekStart = ensureViewWeekStart();
    if (hidden) hidden.value = weekStart;
    if (label && window.BremDatePicker) {
      const weekday = BremDatePicker.formatWeekdayKo?.(weekStart) || '';
      label.textContent = weekday
        ? `${BremDatePicker.formatDate(weekStart)}(${weekday})`
        : (BremDatePicker.formatDate(weekStart) || weekStart);
    }
    if (rangeLabel) {
      rangeLabel.textContent = weekStart
        ? `조회 ${formatViewWeekRangeLabel(weekStart)}`
        : '';
    }
  }

  function syncRiderDateRangeInputs() {
    const weekRange = state.viewWeekStart ? computeViewWeekQueryRange(state.viewWeekStart) : null;
    const range = weekRange?.fromDate && weekRange?.toDate
      ? weekRange
      : defaultRiderViewDateRange();
    const fromEl = $('baeminStatusRiderFromDate');
    const toEl = $('baeminStatusRiderToDate');
    const metaEl = $('baeminStatusRiderRangeMeta');
    if (fromEl && !fromEl.dataset.touched) setEnhancedDateInput('baeminStatusRiderFromDate', range.fromDate);
    if (toEl && !toEl.dataset.touched) setEnhancedDateInput('baeminStatusRiderToDate', range.toDate);
    if (metaEl) {
      metaEl.textContent = state.config?.riderCollectRange?.label
        ? `BIZ 수집 기간: ${state.config.riderCollectRange.label}`
        : '기간 내 기사별 완료 합계 (BIZ 라이더별 현황과 동일)';
    }
  }

  function resolveRiderViewDateRange() {
    const fromInput = String($('baeminStatusRiderFromDate')?.value || state.riderViewFromDate || '').slice(0, 10);
    const toInput = String($('baeminStatusRiderToDate')?.value || state.riderViewToDate || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(fromInput) && /^\d{4}-\d{2}-\d{2}$/.test(toInput) && toInput >= fromInput) {
      return { fromDate: fromInput, toDate: toInput };
    }
    return defaultRiderViewDateRange();
  }

  /**
   * 선택 기간에 저장분이 없을 때, 서버가 알려준 최근 저장 기간(savedRange)으로
   * 날짜 입력을 바꾸고 1회만 자동 재조회한다. (재조회는 { autoFallback: true }로 무한루프 방지)
   * 반환 true = 자동 재조회를 시작함 → 호출부는 "데이터 없음" 안내를 생략한다.
   */
  function maybeAutoFallbackToSavedRange(result, range, options, reload, label) {
    if (options && options.autoFallback) return false;
    const saved = result && result.savedRange;
    if (!saved || !/^\d{4}-\d{2}-\d{2}$/.test(saved.fromDate || '') || !/^\d{4}-\d{2}-\d{2}$/.test(saved.toDate || '')) {
      return false;
    }
    if (saved.fromDate === range.fromDate && saved.toDate === range.toDate) return false;

    setEnhancedDateInput('baeminStatusRiderFromDate', saved.fromDate);
    setEnhancedDateInput('baeminStatusRiderToDate', saved.toDate);
    const fromEl = $('baeminStatusRiderFromDate');
    const toEl = $('baeminStatusRiderToDate');
    if (fromEl) fromEl.dataset.touched = '1';
    if (toEl) toEl.dataset.touched = '1';
    state.riderViewFromDate = saved.fromDate;
    state.riderViewToDate = saved.toDate;
    showToast(`선택 기간에 저장분이 없어 최근 저장 기간(${saved.fromDate}~${saved.toDate})으로 표시합니다.`);
    void reload({ autoFallback: true });
    return true;
  }

  function handleWeekSelect(value) {
    if (!isViewSection()) return;
    const normalized = window.BremDatePicker?.applyWeekWednesday?.(value) || String(value || '').slice(0, 10);
    state.viewWeekStart = normalized;
    syncViewWeekPicker();
    invalidateDataCache();
    if (state.activeMenu === 'rider_history' || state.activeMenu === 'daily_history') {
      const range = computeViewWeekQueryRange(normalized);
      setEnhancedDateInput('baeminStatusRiderFromDate', range.fromDate);
      setEnhancedDateInput('baeminStatusRiderToDate', range.toDate);
      const fromEl = $('baeminStatusRiderFromDate');
      const toEl = $('baeminStatusRiderToDate');
      if (fromEl) fromEl.dataset.touched = '1';
      if (toEl) toEl.dataset.touched = '1';
      state.riderViewFromDate = range.fromDate;
      state.riderViewToDate = range.toDate;
    }
    if (state.activeMenu === 'quota_achievement') {
      clearViewTablesForMenu(state.activeMenu, '정산주가 변경되었습니다. 지역별 할당 달성 조회를 눌러 주세요.');
      updateWeekPickerVisibility();
      return;
    }
    updateWeekPickerVisibility();
  }

  function updateWeekPickerVisibility() {
    const row = $('baeminStatusWeekPickerRow');
    const weekLoadBtn = $('baeminStatusWeekLoadBtn');
    const rangeToolbar = $('baeminStatusRangeToolbar');
    const deliveryToolbar = $('baeminStatusDeliveryToolbar');
    const acceptRateToolbar = $('baeminStatusAcceptRateToolbar');
    const syncToolbar = $('baeminStatusSyncToolbar');
    const setCountRow = $('baeminStatusSetCountRow');
    const menuNav = $('baeminStatusMenuNavBlock');
    if (!isViewSection()) {
      if (row) row.hidden = true;
      if (weekLoadBtn) weekLoadBtn.hidden = true;
      if (rangeToolbar) rangeToolbar.hidden = true;
      if (deliveryToolbar) deliveryToolbar.hidden = true;
      if (acceptRateToolbar) acceptRateToolbar.hidden = true;
      if (syncToolbar) syncToolbar.hidden = true;
      if (setCountRow) setCountRow.hidden = true;
      if (menuNav) menuNav.hidden = true;
      return;
    }
    const hasRegion = getSelectedPartnerIds().length > 0
      || Boolean(normalizePartnerId(state.activePartnerId));
    const hasAnyRegion = hasRegion
      || (state.partners || []).length > 0
      || Object.keys(state.partnerRegionMap || {}).length > 0;
    const showSync = state.activeMenu === 'calls_rejection_sync';
    if (menuNav) menuNav.hidden = !(hasAnyRegion || showSync);
    if (!hasAnyRegion && !showSync) {
      if (row) row.hidden = true;
      if (weekLoadBtn) weekLoadBtn.hidden = true;
      if (rangeToolbar) rangeToolbar.hidden = true;
      if (deliveryToolbar) deliveryToolbar.hidden = true;
      if (acceptRateToolbar) acceptRateToolbar.hidden = true;
      if (syncToolbar) syncToolbar.hidden = true;
      if (setCountRow) setCountRow.hidden = true;
      return;
    }

    // 메뉴별 컨트롤만 표시
    const showWeek = hasRegion && state.activeMenu === 'quota_achievement';
    const showRange = hasRegion && (state.activeMenu === 'rider_history' || state.activeMenu === 'daily_history');
    const showDeliveryQuery = hasRegion && state.activeMenu === 'delivery_status';
    const showAcceptRate = hasRegion && state.activeMenu === 'accept_rate_live';
    const showSetCount = hasRegion && state.activeMenu === 'quota_achievement';

    if (row) row.hidden = !showWeek;
    if (weekLoadBtn) weekLoadBtn.hidden = !showWeek;
    if (rangeToolbar) rangeToolbar.hidden = !showRange;
    if (deliveryToolbar) deliveryToolbar.hidden = !showDeliveryQuery;
    if (acceptRateToolbar) acceptRateToolbar.hidden = !showAcceptRate;
    if (syncToolbar) syncToolbar.hidden = !showSync;
    if (setCountRow) setCountRow.hidden = !showSetCount;

    if (showSetCount) renderSetCountRow(state.activePartnerId);
    if (state.activeMenu === 'weekday_quota' && hasRegion) {
      void ensureWeekdayQuotaLoaded().then(() => renderWeekdayQuotaEditor());
    }
    if (showAcceptRate || showSync) {
      if (showSync) ensureSyncDateRangeDefaults();
      const ranges = showSync ? resolveSyncDateRange() : computeAcceptRateDateRanges();
      const metaEl = showAcceptRate ? $('baeminStatusAcceptRateMeta') : $('baeminStatusSyncMeta');
      if (metaEl) {
        metaEl.textContent = showSync
          ? `전지역 · 선택기간 ${ranges.fromDate} ~ ${ranges.toDate} · 콜수=일별 · 거절율=주별`
          : (ranges.pastLabel
            ? `과거 ${ranges.pastLabel} · 현재 ${ranges.currentLabel} (배달현황 최신 반영)`
            : `과거 없음(수요일) · 현재 ${ranges.currentLabel} (배달현황 최신)`);
      }
    }
    if (showRange) {
      syncRiderDateRangeInputs();
      const metaEl = $('baeminStatusRiderRangeMeta');
      if (metaEl) {
        metaEl.textContent = state.activeMenu === 'daily_history'
          ? '기간 내 배달일별 집계 (BIZ 일별 현황과 동일)'
          : (state.config?.riderCollectRange?.label
            ? `BIZ 수집 기간: ${state.config.riderCollectRange.label}`
            : '기간 내 기사별 완료 합계 (BIZ 라이더별 현황과 동일)');
      }
    }
    if (showWeek) syncViewWeekPicker();
  }

  function addDaysDate(dateKey, days) {
    const base = String(dateKey || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(base)) return todayKstDate();
    const date = new Date(`${base}T12:00:00+09:00`);
    date.setDate(date.getDate() + Number(days || 0));
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(date);
  }

  /** admin 커스텀 날짜버튼(날짜 선택) 라벨까지 같이 맞춤 */
  function setEnhancedDateInput(inputId, dateValue) {
    const input = $(inputId);
    if (!input) return;
    const value = String(dateValue || '').slice(0, 10);
    input.value = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
    const label = document.getElementById(`${inputId}Label`)
      || document.querySelector(`[data-call-date-target="${inputId}"] span`);
    if (label) {
      label.textContent = input.value
        ? (window.BremDatePicker?.formatDate?.(input.value) || input.value)
        : '날짜 선택';
    }
  }

  function syncDailyCollectRangeInputs(range) {
    const meta = $('baeminDailyCollectRangeMeta');
    const fromDate = range?.fromDate || '';
    const toDate = range?.toDate || '';
    setEnhancedDateInput('baeminDailyCollectFrom', fromDate);
    setEnhancedDateInput('baeminDailyCollectTo', toDate);
    if (meta) {
      meta.textContent = range?.label
        ? `저장됨: ${range.label}`
        : '일별 배달내역은 설정한 기간을 하루씩 수집합니다.';
    }
    state.dailyCollectRange = range || null;
  }

  async function loadDailyCollectRange() {
    const result = await adminApi('/api/admin/baemin-delivery/daily-collect-range');
    if (result.ok) {
      syncDailyCollectRangeInputs(result.range || null);
      return result.range;
    }
    return null;
  }

  async function saveDailyCollectRangeFromUi() {
    const fromDate = $('baeminDailyCollectFrom')?.value || '';
    const toDate = $('baeminDailyCollectTo')?.value || '';
    const result = await adminApi('/api/admin/baemin-delivery/daily-collect-range', {
      method: 'POST',
      body: JSON.stringify({ fromDate, toDate })
    });
    if (!result.ok) {
      showToast(result.message || '일별 수집기간 저장에 실패했습니다.');
      return;
    }
    syncDailyCollectRangeInputs(result.range || null);
    showToast('일별 수집기간이 저장되었습니다.');
  }

  /** 이번주 정산주: 수요일 ~ 오늘 */
  function settlementWednesdayOf(dateKey = todayKstDate()) {
    const ref = String(dateKey || todayKstDate()).slice(0, 10);
    const fromPicker = window.BremDatePicker?.applyWeekWednesday?.(ref);
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(fromPicker || ''))) return fromPicker;
    // BremDatePicker 없을 때 KST 수요일로 직접 계산 (fallback이 오늘이 되면 안 됨)
    const dayName = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Seoul',
      weekday: 'long'
    }).format(new Date(`${ref}T12:00:00+09:00`));
    const map = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
    const day = map[dayName];
    if (day == null) return ref;
    return addDaysDate(ref, -((day - 3 + 7) % 7));
  }

  function computeThisWeekCollectRange() {
    const today = todayKstDate();
    const fromDate = settlementWednesdayOf(today);
    const toDate = today < fromDate ? fromDate : today;
    return { fromDate, toDate, weekStart: fromDate };
  }

  function applyThisWeekCollectRangeToInputs(kind) {
    const range = computeThisWeekCollectRange();
    if (kind === 'daily' || kind === 'both') {
      setEnhancedDateInput('baeminDailyCollectFrom', range.fromDate);
      setEnhancedDateInput('baeminDailyCollectTo', range.toDate);
    }
    if (kind === 'rider' || kind === 'both') {
      setEnhancedDateInput('baeminRiderCollectFrom', range.fromDate);
      setEnhancedDateInput('baeminRiderCollectTo', range.toDate);
    }
    if (kind === 'status' || kind === 'both') {
      setEnhancedDateInput('baeminStatusRiderFromDate', range.fromDate);
      setEnhancedDateInput('baeminStatusRiderToDate', range.toDate);
      const fromEl = $('baeminStatusRiderFromDate');
      const toEl = $('baeminStatusRiderToDate');
      if (fromEl) fromEl.dataset.touched = '1';
      if (toEl) toEl.dataset.touched = '1';
      state.riderViewFromDate = range.fromDate;
      state.riderViewToDate = range.toDate;
      state.viewWeekStart = range.weekStart;
      syncViewWeekPicker();
      const metaEl = $('baeminStatusRiderRangeMeta');
      if (metaEl) {
        metaEl.textContent = `이번주 ${range.fromDate} ~ ${range.toDate}`;
      }
    }
    return range;
  }

  async function applyAndSaveThisWeekCollectRange(kind) {
    const range = applyThisWeekCollectRangeToInputs(kind);
    if (!range?.fromDate || !range?.toDate) {
      showToast('이번주 기간을 계산하지 못했습니다.');
      return;
    }
    if (kind === 'status') {
      showToast(`이번주 ${range.fromDate} ~ ${range.toDate}`);
      return;
    }
    if (kind === 'daily') {
      await saveDailyCollectRangeFromUi();
      return;
    }
    if (kind === 'rider') {
      await saveRiderCollectRangeFromUi();
    }
  }

  function syncRiderCollectRangeInputs(range) {
    const meta = $('baeminRiderCollectRangeMeta');
    const fromDate = range?.fromDate || '';
    const toDate = range?.toDate || '';
    setEnhancedDateInput('baeminRiderCollectFrom', fromDate);
    setEnhancedDateInput('baeminRiderCollectTo', toDate);
    if (meta) {
      meta.textContent = range?.label
        ? `저장됨: ${range.label}`
        : '라이더별 배달내역은 설정한 기간을 하루씩 수집합니다.';
    }
    state.riderCollectRange = range || null;
  }

  async function loadRiderCollectRange() {
    const result = await adminApi('/api/admin/baemin-delivery/rider-collect-range');
    if (result.ok) {
      syncRiderCollectRangeInputs(result.range || null);
      return result.range;
    }
    return null;
  }

  async function saveRiderCollectRangeFromUi() {
    const fromDate = $('baeminRiderCollectFrom')?.value || '';
    const toDate = $('baeminRiderCollectTo')?.value || '';
    const result = await adminApi('/api/admin/baemin-delivery/rider-collect-range', {
      method: 'POST',
      body: JSON.stringify({ fromDate, toDate })
    });
    if (!result.ok) {
      showToast(result.message || '라이더 수집기간 저장에 실패했습니다.');
      return;
    }
    syncRiderCollectRangeInputs(result.range || null);
    showToast('라이더 수집기간이 저장되었습니다.');
  }

  function renderBizRiderHistoryPlaceholder(savedCount = null) {
    if (isViewSection()) return;
    const summaryEl = $('baeminBizRiderHistorySummary');
    const rowsEl = $('baeminBizRiderHistoryRows');
    const rangeLabel = state.riderCollectRange?.label
      || state.config?.menuDatePlan?.rider_history?.label
      || '설정 기간';
    if (summaryEl) {
      summaryEl.textContent = savedCount != null
        ? `${rangeLabel} · ${formatNumber(savedCount)}건 Supabase 저장됨`
        : `${rangeLabel} · 미리보기 생략`;
    }
    if (rowsEl) {
      const colspan = getBaeminTableColspan('rider_history', { showPartner: false, includeCollected: true });
      rowsEl.innerHTML = `<tr><td colspan="${colspan}" class="form-help">라이더별 배달내역은 데이터가 많아 BIZ 미리보기를 표시하지 않습니다. 수집 후 [배민현황 저장] → 시작일·종료일 선택 후 조회하세요.</td></tr>`;
    }
  }

  function readCollectRangeFromUi() {
    const weekStart = String(state.bizCollectWeekStart || $('baeminBizCollectWeekStart')?.value || '').slice(0, 10);
    return {
      dailyFromDate: $('baeminDailyCollectFrom')?.value || '',
      dailyToDate: $('baeminDailyCollectTo')?.value || '',
      riderFromDate: $('baeminRiderCollectFrom')?.value || '',
      riderToDate: $('baeminRiderCollectTo')?.value || '',
      weekStart: /^\d{4}-\d{2}-\d{2}$/.test(weekStart) ? weekStart : ''
    };
  }

  function totalsToParsed(totals = {}) {
    return {
      totalComplete: totals.completeTotal,
      foodReject: totals.foodReject,
      bmartReject: totals.bmartReject,
      storeReject: totals.storeReject,
      totalReject: totals.totalReject,
      foodCancel: totals.foodCancel,
      bmartCancel: totals.bmartCancel,
      storeCancel: totals.storeCancel,
      cancelCount: totals.cancelTotal,
      foodRiderFault: totals.foodRiderFault,
      bmartRiderFault: totals.bmartRiderFault,
      storeRiderFault: totals.storeRiderFault,
      riderFault: totals.riderFault,
      morningCount: totals.morningTotal,
      afternoonCount: totals.afternoonTotal,
      eveningCount: totals.eveningTotal,
      midnightCount: totals.midnightTotal
    };
  }

  function renderRiderHistoryRiderRows(partnerId, riders, meta = {}) {
    const fromDate = meta.fromDate || state.riderViewFromDate || '';
    const toDate = meta.toDate || state.riderViewToDate || '';
    state.riderViewFromDate = fromDate;
    state.riderViewToDate = toDate;
    renderSubtabRows('rider_history', partnerId, riders || [], {
      ...meta,
      weekStart: fromDate,
      weekEnd: toDate
    });
  }

  async function loadRiderHistoryData(options = {}) {
    if (!isViewSection()) return;
    const partnerId = normalizePartnerId(state.activePartnerId);
    if (!partnerId) {
      showToast('지역을 선택하세요.');
      return;
    }

    const range = resolveRiderViewDateRange();
    state.riderViewFromDate = range.fromDate;
    state.riderViewToDate = range.toDate;
    const loadBtn = $('baeminStatusRangeLoadBtn');
    loadBtn?.classList.add('is-loading');
    if (loadBtn) loadBtn.textContent = '조회 중…';

    const result = await adminApi(
      `/api/admin/baemin-delivery/view-rider-range?partnerId=${encodeURIComponent(partnerId)}&fromDate=${encodeURIComponent(range.fromDate)}&toDate=${encodeURIComponent(range.toDate)}`
    );

    loadBtn?.classList.remove('is-loading');
    if (loadBtn) loadBtn.textContent = '조회';

    if (!result.ok) {
      showToast(result.message || '라이더별 배달내역 불러오기에 실패했습니다.');
      return;
    }
    if (result.notApplied) {
      renderRiderHistoryRiderRows(partnerId, [], range);
      showToast(result.message || '배민 BIZ → [배민현황 저장]을 먼저 실행하세요.');
      return;
    }

    const riders = result.riders || [];
    const activeCount = riders.filter(row => Number(row.parsed_json?.totalComplete || 0) > 0).length;
    const cached = getCachedPartnerBundle(partnerId) || { meta: {} };
    cached.rider_history = riders;
    cached.rider_days = result.days || [];
    cached.meta = {
      ...(cached.meta || {}),
      riderFromDate: range.fromDate,
      riderToDate: range.toDate,
      riderLoaded: true
    };
    setCachedPartnerBundle(partnerId, cached);
    renderRiderHistoryRiderRows(partnerId, riders, range);

    if (!riders.length) {
      if (maybeAutoFallbackToSavedRange(result, range, options, loadRiderHistoryData, '라이더')) return;
      showToast(result.hint || `선택 기간 ${range.fromDate}~${range.toDate}에 라이더 데이터 없음`);
      return;
    }
    showToast(
      `${range.fromDate} ~ ${range.toDate} · 운행 ${formatNumber(activeCount)}명`
      + ` · 완료 ${formatNumber(result.totals?.completeTotal || 0)}건`
    );
  }

  async function loadDailyHistoryData(options = {}) {
    if (!isViewSection()) return;
    const partnerId = normalizePartnerId(state.activePartnerId);
    if (!partnerId) {
      showToast('지역을 선택하세요.');
      return;
    }

    const range = resolveRiderViewDateRange();
    state.riderViewFromDate = range.fromDate;
    state.riderViewToDate = range.toDate;
    const loadBtn = $('baeminStatusRangeLoadBtn');
    loadBtn?.classList.add('is-loading');
    if (loadBtn) loadBtn.textContent = '조회 중…';

    const result = await adminApi(
      `/api/admin/baemin-delivery/view-daily-range?partnerId=${encodeURIComponent(partnerId)}&fromDate=${encodeURIComponent(range.fromDate)}&toDate=${encodeURIComponent(range.toDate)}`
    );

    loadBtn?.classList.remove('is-loading');
    if (loadBtn) loadBtn.textContent = '조회';

    if (!result.ok) {
      showToast(result.message || '일별 배달내역 불러오기에 실패했습니다.');
      return;
    }
    if (result.notApplied) {
      clearViewTablesForMenu('daily_history', result.message || '배민 BIZ → [배민현황 저장]을 먼저 실행하세요.');
      showToast(result.message || '배민 BIZ → [배민현황 저장]을 먼저 실행하세요.');
      return;
    }

    const items = result.items || [];
    const cached = getCachedPartnerBundle(partnerId) || { meta: {} };
    cached.daily_history = items;
    cached.meta = {
      ...(cached.meta || {}),
      dailyFromDate: range.fromDate,
      dailyToDate: range.toDate,
      dailyLoaded: true,
      weekStart: range.fromDate,
      weekEnd: range.toDate
    };
    setCachedPartnerBundle(partnerId, cached);
    renderSubtabRows('daily_history', partnerId, items, {
      ...cached.meta,
      weekStart: range.fromDate,
      weekEnd: range.toDate
    });

    if (!items.length) {
      if (maybeAutoFallbackToSavedRange(result, range, options, loadDailyHistoryData, '일별')) return;
      showToast(result.hint || `선택 기간 ${range.fromDate}~${range.toDate}에 일별 데이터 없음`);
      return;
    }
    showToast(
      `${range.fromDate} ~ ${range.toDate} · ${formatNumber(items.length)}일`
      + ` · 완료 ${formatNumber(result.totals?.completeTotal || 0)}건`
    );
  }

  async function loadDeliveryStatusData() {
    if (!isViewSection()) return;
    const partnerIds = getSelectedPartnerIds();
    if (!partnerIds.length) {
      showToast('지역을 선택하세요.');
      return;
    }
    const loadBtn = $('baeminStatusDeliveryLoadBtn');
    loadBtn?.classList.add('is-loading');
    // 로컬 세션 서버 상태를 먼저 확인해, 꺼져 있으면 실시간 시도 없이 저장 스냅샷으로 바로 조회한다.
    if (!state.localServerRunning) {
      try { await refreshLocalServerStatus(); } catch (_e) { /* ignore */ }
    }
    const serverRunning = state.localServerRunning === true;
    if (loadBtn) loadBtn.textContent = serverRunning ? '실시간 조회 중…' : '저장값 조회 중…';
    let liveHint = '';        // 실시간 반영 시에만 truthy (표의 live 배지 판정에 사용)
    let sourceHint = ' · 저장 스냅샷';
    try {
      if (serverRunning) {
        const live = await refreshDeliveryLiveFromLocalServer();
        if (live.ok) {
          liveHint = ' · 실시간 반영';
          sourceHint = liveHint;
        } else if (!live.skipped && live.message) {
          showToast(live.message);
        }
      }

      if (!state.config?.applied) {
        await loadViewConfig();
      }
      const captureDate = state.appliedCollectDate
        || state.config?.applied?.collectDate
        || todayKstDate();

      const merged = [];
      let lastCollectDate = captureDate;
      for (const partnerId of partnerIds) {
        const result = await adminApi(buildViewItemsQuery(captureDate, 'delivery_status', partnerId));
        if (!result.ok) {
          showToast(result.message || `${partnerLabelById(partnerId)} 배달현황 불러오기 실패`);
          continue;
        }
        if (result.notApplied) {
          clearViewTablesForMenu(
            'delivery_status',
            result.message || '배민 BIZ → [배민현황 저장]을 먼저 실행하세요.'
          );
          showToast(result.message || '배민 BIZ → [배민현황 저장]을 먼저 실행하세요.');
          return;
        }
        const items = filterRowsByPartnerId(result.items || [], partnerId);
        const totals = {
          ...(result.totals || {}),
          rowCount: items.length,
          drivingCount: countDrivingRiders(items)
        };
        const cached = getCachedPartnerBundle(partnerId) || { meta: {}, totals: {} };
        cached.delivery_status = items;
        cached.totals = {
          ...(cached.totals || {}),
          delivery_status: totals
        };
        cached.meta = {
          ...(cached.meta || {}),
          captureDate: result.collectDate || captureDate,
          notApplied: false,
          deliveryLoaded: true
        };
        setCachedPartnerBundle(partnerId, cached);
        if (result.collectDate) lastCollectDate = result.collectDate;
        merged.push(...items);
      }

      state.viewLoaded = true;
      state.appliedCollectDate = lastCollectDate || captureDate;
      state.lastClientRefreshAt = new Date().toISOString();
      renderRefreshMeta();

      const drivingItems = merged.filter(row => isDrivingStatus(row?.parsed_json?.statusDesc || row?.statusDesc || ''));
      if (!drivingItems.length) {
        clearViewTablesForMenu(
          'delivery_status',
          merged.length
            ? '선택 지역에 운행중 기사가 없습니다.'
            : '저장된 배달현황이 없습니다. BIZ 수집 후 [배민현황 저장]을 실행하세요.'
        );
        renderGrandTotalsPanelMulti(partnerIds);
        showToast(merged.length ? `운행중 0명 (전체 ${formatNumber(merged.length)}명)` : '배달현황 데이터 없음');
        return;
      }

      renderDeliveryStatusRowsMulti(drivingItems, partnerIds, { live: Boolean(liveHint) });
      renderGrandTotalsPanelMulti(partnerIds);
      showToast(`운행중 ${formatNumber(drivingItems.length)}명 · 지역 ${partnerIds.length}곳${sourceHint}`);
    } finally {
      loadBtn?.classList.remove('is-loading');
      if (loadBtn) loadBtn.textContent = '배달현황 조회';
    }
  }

  /** 수~전일(과거) / 수~현재(현재=과거+배달현황 최신) */
  function computeAcceptRateDateRanges() {
    const today = todayKstDate();
    const fromDate = settlementWednesdayOf(today);
    const yesterday = addDaysDate(today, -1);
    const hasPast = /^\d{4}-\d{2}-\d{2}$/.test(yesterday) && yesterday >= fromDate;
    return {
      fromDate,
      today,
      yesterday,
      pastFromDate: hasPast ? fromDate : '',
      pastToDate: hasPast ? yesterday : '',
      pastLabel: hasPast ? `${fromDate} ~ ${yesterday}` : '',
      currentLabel: `${fromDate} ~ ${today}`,
      hasPast
    };
  }

  function extractAcceptRateMetrics(parsed = {}) {
    const complete = Math.max(0, Number(parsed.totalComplete || parsed.completeCount || 0) || 0);
    const foodReject = Math.max(0, Number(parsed.foodReject || 0) || 0);
    const foodCancel = Math.max(0, Number(parsed.foodCancel || 0) || 0);
    const foodRiderFault = Math.max(0, Number(parsed.foodRiderFault || 0) || 0);
    return { complete, foodReject, foodCancel, foodRiderFault };
  }

  function mergeAcceptRateMetrics(a = {}, b = {}) {
    return {
      complete: Number(a.complete || 0) + Number(b.complete || 0),
      foodReject: Number(a.foodReject || 0) + Number(b.foodReject || 0),
      foodCancel: Number(a.foodCancel || 0) + Number(b.foodCancel || 0),
      foodRiderFault: Number(a.foodRiderFault || 0) + Number(b.foodRiderFault || 0)
    };
  }

  /**
   * 100 - (거절푸드+배차취소푸드+배달취소라이더귀책푸드)
   *     / (완료+거절푸드+배차취소푸드+배달취소라이더귀책푸드) * 100
   */
  function calcAcceptRatePercent(metrics = {}) {
    const complete = Number(metrics.complete || 0);
    const deny = Number(metrics.foodReject || 0)
      + Number(metrics.foodCancel || 0)
      + Number(metrics.foodRiderFault || 0);
    const denom = complete + deny;
    if (denom <= 0) return null;
    return 100 - (deny / denom) * 100;
  }

  function formatAcceptRatePercent(value) {
    if (value == null || !Number.isFinite(Number(value))) return '-';
    return `${Number(value).toFixed(1)}%`;
  }

  function riderAcceptRateKey(row) {
    return String(row?.rider_user_id || row?.parsed_json?.riderUserId || '').trim();
  }

  function renderAcceptRateLiveRows(partnerId, rows, meta = {}) {
    const summaryEl = $('baeminStatusAcceptRateSummary');
    const rowsEl = $('baeminStatusAcceptRateRows');
    if (!rowsEl) return;
    const partnerLabel = partnerDisplayLabel(
      state.partners.find(partner => normalizePartnerId(partner.partnerId) === normalizePartnerId(partnerId))
    );
    const pastLabel = meta.pastLabel || '-';
    const currentLabel = meta.currentLabel || '-';
    if (summaryEl) {
      summaryEl.textContent = rows.length
        ? `${partnerLabel} · 과거 ${pastLabel} · 현재 ${currentLabel} · ${formatNumber(rows.length)}명`
        : `${partnerLabel} · 과거 ${pastLabel} · 현재 ${currentLabel} · 데이터 없음`;
    }
    if (!rows.length) {
      rowsEl.innerHTML = `<tr><td colspan="13" class="form-help">${meta.emptyMessage || '수락율 조회를 눌러 주세요.'}</td></tr>`;
      return;
    }
    rowsEl.innerHTML = rows.map(row => {
      const past = row.past || {};
      const current = row.current || {};
      return `<tr>
        <td>${escapeHtml(row.riderName || '-')}</td>
        <td>${escapeHtml(row.riderUserId || '-')}</td>
        <td>${escapeHtml(row.phoneNumber || '-')}</td>
        <td class="baemin-metric-cell">${formatNumber(past.complete || 0)}</td>
        <td class="baemin-metric-cell">${formatNumber(past.foodReject || 0)}</td>
        <td class="baemin-metric-cell">${formatNumber(past.foodCancel || 0)}</td>
        <td class="baemin-metric-cell">${formatNumber(past.foodRiderFault || 0)}</td>
        <td class="baemin-metric-cell baemin-metric-cell--total">${formatAcceptRatePercent(row.pastRate)}</td>
        <td class="baemin-metric-cell">${formatNumber(current.complete || 0)}</td>
        <td class="baemin-metric-cell">${formatNumber(current.foodReject || 0)}</td>
        <td class="baemin-metric-cell">${formatNumber(current.foodCancel || 0)}</td>
        <td class="baemin-metric-cell">${formatNumber(current.foodRiderFault || 0)}</td>
        <td class="baemin-metric-cell baemin-metric-cell--total">${formatAcceptRatePercent(row.currentRate)}</td>
      </tr>`;
    }).join('');
  }

  async function loadAcceptRateLiveData() {
    if (!isViewSection()) return;
    const partnerId = normalizePartnerId(state.activePartnerId);
    if (!partnerId) {
      showToast('지역을 선택하세요.');
      return;
    }

    const ranges = computeAcceptRateDateRanges();
    const loadBtn = $('baeminStatusAcceptRateLoadBtn');
    const metaEl = $('baeminStatusAcceptRateMeta');
    loadBtn?.classList.add('is-loading');
    if (loadBtn) loadBtn.textContent = '조회 중…';
    if (metaEl) {
      metaEl.textContent = ranges.pastLabel
        ? `과거 ${ranges.pastLabel} · 현재 ${ranges.currentLabel} (배달현황 최신 반영)`
        : `과거 없음(수요일) · 현재 ${ranges.currentLabel} (배달현황 최신)`;
    }

    try {
      if (!state.config?.applied) {
        await loadViewConfig();
      }
      const captureDate = state.appliedCollectDate
        || state.config?.applied?.collectDate
        || todayKstDate();

      const pastPromise = ranges.hasPast
        ? adminApi(
          `/api/admin/baemin-delivery/view-rider-range?partnerId=${encodeURIComponent(partnerId)}&fromDate=${encodeURIComponent(ranges.pastFromDate)}&toDate=${encodeURIComponent(ranges.pastToDate)}`
        )
        : Promise.resolve({ ok: true, riders: [], skipped: true });

      const deliveryPromise = adminApi(buildViewItemsQuery(captureDate, 'delivery_status', partnerId));
      const [pastResult, deliveryResult] = await Promise.all([pastPromise, deliveryPromise]);

      if (!pastResult.ok && !pastResult.skipped) {
        showToast(pastResult.message || '과거(수~전일) 라이더 데이터 불러오기에 실패했습니다.');
        return;
      }
      if (!deliveryResult.ok) {
        showToast(deliveryResult.message || '배달현황 최신 데이터 불러오기에 실패했습니다.');
        return;
      }
      if (pastResult.notApplied || deliveryResult.notApplied) {
        const msg = pastResult.message || deliveryResult.message
          || '배민 BIZ → [배민현황 저장]을 먼저 실행하세요.';
        renderAcceptRateLiveRows(partnerId, [], {
          ...ranges,
          emptyMessage: msg
        });
        showToast(msg);
        return;
      }

      const pastRiders = filterRowsByPartnerId(pastResult.riders || [], partnerId);
      const deliveryRows = filterRowsByPartnerId(deliveryResult.items || [], partnerId);
      const byKey = new Map();

      const upsert = (row, bucket) => {
        const key = riderAcceptRateKey(row) || `name:${String(row.rider_name || '').trim()}`;
        if (!key || key === 'name:') return;
        const metrics = extractAcceptRateMetrics(row.parsed_json || {});
        const prev = byKey.get(key) || {
          riderName: row.rider_name || '',
          riderUserId: row.rider_user_id || '',
          phoneNumber: row.phone_number || '',
          past: { complete: 0, foodReject: 0, foodCancel: 0, foodRiderFault: 0 },
          live: { complete: 0, foodReject: 0, foodCancel: 0, foodRiderFault: 0 }
        };
        if (row.rider_name) prev.riderName = row.rider_name;
        if (row.rider_user_id) prev.riderUserId = row.rider_user_id;
        if (row.phone_number) prev.phoneNumber = row.phone_number;
        prev[bucket] = mergeAcceptRateMetrics(prev[bucket], metrics);
        byKey.set(key, prev);
      };

      pastRiders.forEach(row => upsert(row, 'past'));
      deliveryRows.forEach(row => upsert(row, 'live'));

      const rows = [...byKey.values()]
        .map(entry => {
          const current = mergeAcceptRateMetrics(entry.past, entry.live);
          return {
            riderName: entry.riderName,
            riderUserId: entry.riderUserId,
            phoneNumber: entry.phoneNumber,
            past: { ...entry.past },
            live: { ...entry.live },
            current,
            pastRate: calcAcceptRatePercent(entry.past),
            currentRate: calcAcceptRatePercent(current),
            pastComplete: entry.past.complete,
            currentComplete: current.complete
          };
        })
        .filter(row => Number(row.pastComplete || 0) > 0 || Number(row.currentComplete || 0) > 0)
        .sort((a, b) => {
          const rateDiff = Number(b.currentRate ?? -1) - Number(a.currentRate ?? -1);
          if (rateDiff !== 0) return rateDiff;
          return String(a.riderName || '').localeCompare(String(b.riderName || ''), 'ko');
        });

      const cached = getCachedPartnerBundle(partnerId) || { meta: {} };
      cached.accept_rate_live = rows;
      cached.meta = {
        ...(cached.meta || {}),
        acceptRateLoaded: true,
        acceptRatePastLabel: ranges.pastLabel || '없음',
        acceptRateCurrentLabel: ranges.currentLabel,
        acceptRateCaptureDate: deliveryResult.collectDate || captureDate
      };
      setCachedPartnerBundle(partnerId, cached);
      state.viewLoaded = true;

      renderAcceptRateLiveRows(partnerId, rows, {
        pastLabel: ranges.pastLabel || '없음',
        currentLabel: ranges.currentLabel
      });

      // 조회마다 실시간 수락율 스냅샷 교체(삭제 후 upsert) — 실패해도 화면 조회는 유지
      void persistAcceptRateLiveSnapshot(partnerId, rows, ranges, deliveryResult.collectDate || captureDate);

      if (!rows.length) {
        showToast('수락율 대상 라이더가 없습니다. 라이더별·배달현황 수집 후 다시 조회하세요.');
        return;
      }
      showToast(
        `수락율 ${formatNumber(rows.length)}명 · 과거 ${ranges.pastLabel || '없음'} · 현재 ${ranges.currentLabel}`
      );
    } finally {
      loadBtn?.classList.remove('is-loading');
      if (loadBtn) loadBtn.textContent = '수락율 조회';
    }
  }

  async function persistAcceptRateLiveSnapshot(partnerId, rows, ranges, captureDate) {
    try {
      const syncHelper = window.BremBaeminCallsRejectionSync;
      const payloadRows = (rows || []).map(row => {
        const baeminId = String(row.riderUserId || '').trim();
        const driver = syncHelper?.matchDriverByBaeminId?.(baeminId) || null;
        return {
          weekStart: ranges.fromDate,
          partnerId,
          riderUserId: baeminId,
          riderName: row.riderName || '',
          phoneNumber: row.phoneNumber || '',
          driverId: driver?.id || '',
          pastFrom: ranges.pastFromDate || null,
          pastTo: ranges.pastToDate || null,
          pastComplete: row.past?.complete || 0,
          pastFoodReject: row.past?.foodReject || 0,
          pastFoodCancel: row.past?.foodCancel || 0,
          pastFoodRiderFault: row.past?.foodRiderFault || 0,
          pastAcceptRate: row.pastRate,
          liveComplete: row.live?.complete || 0,
          liveFoodReject: row.live?.foodReject || 0,
          liveFoodCancel: row.live?.foodCancel || 0,
          liveFoodRiderFault: row.live?.foodRiderFault || 0,
          currentComplete: row.current?.complete || 0,
          currentFoodReject: row.current?.foodReject || 0,
          currentFoodCancel: row.current?.foodCancel || 0,
          currentFoodRiderFault: row.current?.foodRiderFault || 0,
          currentAcceptRate: row.currentRate,
          sourceCaptureDate: captureDate || null
        };
      });
      await adminApi('/api/admin/baemin-delivery/live-accept-rates/replace', {
        method: 'POST',
        body: JSON.stringify({
          weekStart: ranges.fromDate,
          partnerId,
          rows: payloadRows
        })
      });
    } catch (_error) {
      // 스냅샷 저장 실패는 조회 UX를 막지 않음
    }
  }

  function listSyncPartnerIds() {
    const fromPartners = (state.partners || [])
      .map(partner => normalizePartnerId(partner.partnerId))
      .filter(Boolean);
    if (fromPartners.length) return [...new Set(fromPartners)];
    return Object.keys(state.partnerRegionMap || {})
      .map(id => normalizePartnerId(id))
      .filter(Boolean);
  }

  function partnerLabelForId(partnerId) {
    const pid = normalizePartnerId(partnerId);
    const partner = (state.partners || []).find(item => normalizePartnerId(item.partnerId) === pid);
    return partnerDisplayLabel(partner) || resolveRegisteredRegionName(pid) || pid || '-';
  }

  function syncSyncDateInputs(fromDate, toDate) {
    setEnhancedDateInput('baeminSyncFromDate', fromDate);
    setEnhancedDateInput('baeminSyncToDate', toDate);
    setEnhancedDateInput('baeminSyncFromDate2', fromDate);
    setEnhancedDateInput('baeminSyncToDate2', toDate);
    ['baeminSyncFromDate', 'baeminSyncToDate', 'baeminSyncFromDate2', 'baeminSyncToDate2'].forEach(id => {
      const el = $(id);
      if (el) el.dataset.touched = '1';
    });
  }

  function ensureSyncDateRangeDefaults() {
    const fromEl = $('baeminSyncFromDate') || $('baeminSyncFromDate2');
    const toEl = $('baeminSyncToDate') || $('baeminSyncToDate2');
    const fromVal = String(fromEl?.value || '').slice(0, 10);
    const toVal = String(toEl?.value || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(fromVal) && /^\d{4}-\d{2}-\d{2}$/.test(toVal) && toVal >= fromVal) {
      syncSyncDateInputs(fromVal, toVal);
      return { fromDate: fromVal, toDate: toVal };
    }
    const range = computeThisWeekCollectRange();
    syncSyncDateInputs(range.fromDate, range.toDate);
    return { fromDate: range.fromDate, toDate: range.toDate };
  }

  function resolveSyncDateRange() {
    const fromA = String($('baeminSyncFromDate')?.value || '').slice(0, 10);
    const toA = String($('baeminSyncToDate')?.value || '').slice(0, 10);
    const fromB = String($('baeminSyncFromDate2')?.value || '').slice(0, 10);
    const toB = String($('baeminSyncToDate2')?.value || '').slice(0, 10);
    const fromDate = /^\d{4}-\d{2}-\d{2}$/.test(fromA) ? fromA : fromB;
    const toDate = /^\d{4}-\d{2}-\d{2}$/.test(toA) ? toA : toB;
    if (/^\d{4}-\d{2}-\d{2}$/.test(fromDate) && /^\d{4}-\d{2}-\d{2}$/.test(toDate) && toDate >= fromDate) {
      return { fromDate, toDate, weekStart: settlementWednesdayOf(fromDate) };
    }
    return ensureSyncDateRangeDefaults();
  }

  function applySyncThisWeekRange() {
    const range = computeThisWeekCollectRange();
    syncSyncDateInputs(range.fromDate, range.toDate);
    const metaEl = $('baeminStatusSyncMeta');
    if (metaEl) {
      metaEl.textContent = `전지역 · 이번주 ${range.fromDate} ~ ${range.toDate} · 콜수=일별 · 거절율=주별`;
    }
    showToast(`동기화 기간: ${range.fromDate} ~ ${range.toDate}`);
    return range;
  }

  /** 선택 기간에 걸친 정산주(수요일) 목록 */
  function listSettlementWeeksInRange(fromDate, toDate) {
    const from = String(fromDate || '').slice(0, 10);
    const to = String(toDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) {
      return [];
    }
    const weeks = [];
    let wed = settlementWednesdayOf(from);
    while (wed <= to) {
      const weekEnd = addDaysDate(wed, 6);
      if (weekEnd >= from) weeks.push(wed);
      wed = addDaysDate(wed, 7);
      if (weeks.length > 60) break;
    }
    return weeks;
  }

  function resolveItemBusinessDate(row = {}) {
    const parts = String(row.dedupe_key || '').split(':');
    const a = String(parts[1] || '').slice(0, 10);
    const b = String(parts[2] || '').slice(0, 10);
    // 하루키(DP:배달일:riderId:rider) — dedupe 우선
    if (
      parts.length >= 4
      && parts[parts.length - 1] === 'rider'
      && /^\d{4}-\d{2}-\d{2}$/.test(a)
    ) {
      return a;
    }
    // 기간합산 키는 단일 배달일 없음
    if (/^\d{4}-\d{2}-\d{2}$/.test(a) && /^\d{4}-\d{2}-\d{2}$/.test(b) && a !== b) {
      return '';
    }
    const parsed = row.parsed_json || {};
    const fromParsed = String(parsed.businessDate || parsed.deliveryDate || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(fromParsed)) return fromParsed;
    for (const part of parts) {
      const day = String(part || '').slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
    }
    return '';
  }

  /** 콜수·거절율 동기화용 컨텍스트 — 전지역 · 선택 기간 */
  async function getSyncContext() {
    ensureSyncDateRangeDefaults();
    const range = resolveSyncDateRange();
    const fromDate = range.fromDate;
    const toDate = range.toDate;
    if (!state.config?.applied) {
      await loadViewConfig();
    }
    const captureDate = state.appliedCollectDate
      || state.config?.applied?.collectDate
      || todayKstDate();
    const partnerIds = listSyncPartnerIds();
    const weekStarts = listSettlementWeeksInRange(fromDate, toDate);
    const today = todayKstDate();
    const currentWeekStart = settlementWednesdayOf(today);
    const includeLive = weekStarts.includes(currentWeekStart) && toDate >= currentWeekStart;

    const riderResult = await adminApi(
      `/api/admin/baemin-delivery/view-rider-range?fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}&compact=1`
    );
    if (!riderResult.ok) {
      throw new Error(riderResult.message || '전지역 라이더별 배달내역 조회 실패');
    }
    if (riderResult.notApplied) {
      throw new Error(riderResult.message || '배민현황 저장 후 다시 시도하세요.');
    }

    let deliveryRows = [];
    if (includeLive && partnerIds.length) {
      const deliveryBundles = await Promise.all(partnerIds.map(async pid => {
        const result = await adminApi(buildViewItemsQuery(captureDate, 'delivery_status', pid));
        return { partnerId: pid, result };
      }));
      deliveryBundles.forEach(({ partnerId, result }) => {
        if (!result?.ok || result.notApplied) return;
        filterRowsByPartnerId(result.items || [], partnerId).forEach(row => deliveryRows.push(row));
      });
    }

    const riderItems = (riderResult.items || []).filter(row => {
      const pid = normalizePartnerId(
        row.parsed_json?.partnerId || partnerIdFromDedupeKey(row.dedupe_key) || ''
      );
      if (partnerIds.length && pid && !partnerIds.includes(pid)) return false;
      return true;
    });

    const byRiderWeek = new Map();
    const upsertWeek = (row, weekStart, bucket) => {
      const baeminId = String(row.rider_user_id || row.parsed_json?.riderUserId || '').trim();
      const key = `${baeminId || row.rider_name || ''}|${weekStart}`;
      if (!key || key.startsWith('|')) return;
      const metrics = extractAcceptRateMetrics(row.parsed_json || {});
      const prev = byRiderWeek.get(key) || {
        riderName: row.rider_name || '',
        riderUserId: baeminId,
        phoneNumber: row.phone_number || '',
        partnerId: normalizePartnerId(row.parsed_json?.partnerId || partnerIdFromDedupeKey(row.dedupe_key) || ''),
        weekStart,
        past: { complete: 0, foodReject: 0, foodCancel: 0, foodRiderFault: 0 },
        live: { complete: 0, foodReject: 0, foodCancel: 0, foodRiderFault: 0 }
      };
      if (row.rider_name) prev.riderName = row.rider_name;
      if (baeminId) prev.riderUserId = baeminId;
      if (row.phone_number) prev.phoneNumber = row.phone_number;
      const rowPid = normalizePartnerId(row.parsed_json?.partnerId || partnerIdFromDedupeKey(row.dedupe_key) || '');
      if (rowPid) prev.partnerId = rowPid;
      prev[bucket] = mergeAcceptRateMetrics(prev[bucket], metrics);
      byRiderWeek.set(key, prev);
    };

    riderItems.forEach(row => {
      const day = resolveItemBusinessDate(row);
      if (!day || day < fromDate || day > toDate) return;
      upsertWeek(row, settlementWednesdayOf(day), 'past');
    });
    deliveryRows.forEach(row => {
      upsertWeek(row, currentWeekStart, 'live');
    });

    const acceptRows = [...byRiderWeek.values()].map(entry => {
      const current = mergeAcceptRateMetrics(entry.past, entry.live);
      const isCurrentWeek = entry.weekStart === currentWeekStart;
      return {
        riderName: entry.riderName,
        riderUserId: entry.riderUserId,
        phoneNumber: entry.phoneNumber,
        partnerId: entry.partnerId || '',
        regionLabel: partnerLabelForId(entry.partnerId),
        weekStart: entry.weekStart,
        past: { ...entry.past },
        live: { ...entry.live },
        current,
        pastRate: calcAcceptRatePercent(entry.past),
        currentRate: calcAcceptRatePercent(isCurrentWeek ? current : entry.past)
      };
    });

    return {
      partnerId: 'ALL',
      partnerIds,
      partnerCount: partnerIds.length,
      fromDate,
      toDate,
      weekStart: range.weekStart,
      weekStarts,
      pastLabel: `${fromDate} ~ ${toDate}`,
      currentLabel: includeLive ? `${fromDate} ~ ${toDate} (+배달현황)` : `${fromDate} ~ ${toDate}`,
      riderItems,
      riderHint: riderResult.hint || '',
      acceptRows,
      allRegions: true,
      includeLive,
      currentWeekStart
    };
  }

  function listDatesInclusive(fromDate, toDate) {
    const from = String(fromDate || '').slice(0, 10);
    const to = String(toDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) {
      return [];
    }
    const dates = [];
    let cursor = from;
    while (cursor <= to) {
      dates.push(cursor);
      cursor = addDaysDate(cursor, 1);
    }
    return dates;
  }

  async function loadQuotaAchievementData() {
    if (!isViewSection()) return;
    const partnerIds = getSelectedPartnerIds();
    if (!partnerIds.length) {
      showToast('지역을 선택하세요.');
      return;
    }

    const weekStart = ensureViewWeekStart();
    const range = computeViewWeekQueryRange(weekStart);
    const loadBtn = $('baeminStatusWeekLoadBtn');
    loadBtn?.classList.add('is-loading');
    if (loadBtn) loadBtn.textContent = '조회 중…';

    await ensureWeekdayQuotaLoaded();

    let loadedAny = false;
    for (const partnerId of partnerIds) {
      const result = await adminApi(
        `/api/admin/baemin-delivery/view-daily-range?partnerId=${encodeURIComponent(partnerId)}&fromDate=${encodeURIComponent(range.fromDate)}&toDate=${encodeURIComponent(range.toDate)}`
      );

      if (!result.ok) {
        showToast(result.message || `${partnerLabelById(partnerId)} 지역별 할당 달성 불러오기 실패`);
        continue;
      }
      if (result.notApplied) {
        clearViewTablesForMenu('quota_achievement', result.message || '배민 BIZ → [배민현황 저장]을 먼저 실행하세요.');
        showToast(result.message || '배민 BIZ → [배민현황 저장]을 먼저 실행하세요.');
        loadBtn?.classList.remove('is-loading');
        if (loadBtn) loadBtn.textContent = '지역별 할당 달성 조회';
        return;
      }

      const items = result.items || [];
      const cached = getCachedPartnerBundle(partnerId) || { meta: {} };
      cached.daily_history = items;
      cached.meta = {
        ...(cached.meta || {}),
        weekStart: range.fromDate,
        weekEnd: range.toDate,
        quotaWeekStart: weekStart,
        quotaLoaded: true,
        dailyFromDate: range.fromDate,
        dailyToDate: range.toDate,
        dailyLoaded: true
      };
      setCachedPartnerBundle(partnerId, cached);
      loadedAny = true;
    }

    loadBtn?.classList.remove('is-loading');
    if (loadBtn) loadBtn.textContent = '지역별 할당 달성 조회';

    if (!loadedAny) {
      clearViewTablesForMenu('quota_achievement', '지역별 할당 달성 데이터가 없습니다.');
      return;
    }

    renderQuotaAchievementForSelection(partnerIds);
    renderGrandTotalsPanelMulti(partnerIds);
    renderSetCountRow(state.activePartnerId);
    showToast(`지역별 할당 달성 ${range.fromDate} ~ ${range.toDate} · 지역 ${partnerIds.length}곳`);
  }

  async function loadViewWeekMenuData() {
    if (!isViewSection()) return;
    if (state.activeMenu === 'rider_history') {
      await loadRiderHistoryData();
      return;
    }
    if (state.activeMenu === 'daily_history') {
      await loadDailyHistoryData();
      return;
    }
    if (state.activeMenu === 'delivery_status') {
      await loadDeliveryStatusData();
      return;
    }
    if (state.activeMenu === 'quota_achievement') {
      await loadQuotaAchievementData();
    }
  }

  function isHistoryViewMenu(menu = state.activeMenu) {
    return menu === 'daily_history' || menu === 'quota_achievement';
  }

  function buildViewFullBundleQuery(captureDate) {
    let query = `/api/admin/baemin-delivery/view-full-bundle?collectDate=${encodeURIComponent(captureDate)}`;
    query += `&weekStart=${encodeURIComponent(ensureViewWeekStart())}`;
    return query;
  }

  function buildViewBundleQuery(captureDate, sourceMenu, partnerId) {
    let query = `/api/admin/baemin-delivery/view-bundle?collectDate=${encodeURIComponent(captureDate)}&sourceMenu=${encodeURIComponent(sourceMenu)}`;
    if (partnerId) query += `&partnerId=${encodeURIComponent(partnerId)}`;
    if (isHistoryViewMenu(sourceMenu)) {
      query += `&weekStart=${encodeURIComponent(ensureViewWeekStart())}`;
    }
    return query;
  }

  function buildViewPartnersQuery(captureDate) {
    let query = `/api/admin/baemin-delivery/partners?collectDate=${encodeURIComponent(captureDate)}&appliedOnly=1`;
    if (isHistoryViewMenu()) {
      query += `&weekStart=${encodeURIComponent(ensureViewWeekStart())}&sourceMenu=${encodeURIComponent(state.activeMenu)}`;
    }
    return query;
  }

  function buildViewItemsQuery(captureDate, sourceMenu, partnerId) {
    let query = `/api/admin/baemin-delivery/items?collectDate=${encodeURIComponent(captureDate)}&sourceMenu=${encodeURIComponent(sourceMenu)}&partnerId=${encodeURIComponent(partnerId)}&appliedOnly=1`;
    if (isHistoryViewMenu(sourceMenu)) {
      query += `&weekStart=${encodeURIComponent(ensureViewWeekStart())}`;
    }
    return query;
  }

  function buildCacheKey() {
    const ui = tableUiConfig();
    if (isViewSection()) {
      const applied = state.config?.applied || {};
      const weekPart = isHistoryViewMenu() ? `:week=${ensureViewWeekStart()}` : '';
      const range = resolveRiderViewDateRange();
      const rangePart = (state.activeMenu === 'rider_history' || state.activeMenu === 'daily_history')
        ? `:range=${range.fromDate}:${range.toDate}`
        : '';
      const mapPart = Object.keys(state.partnerRegionMap || {}).sort().join('|');
      // 메뉴 전환해도 같은 지역 캐시 유지 (지역=대메뉴)
      return `view:${state.appliedCollectDate || applied.collectDate || ''}:${applied.batchId || ''}${weekPart}${rangePart}:map=${mapPart}`;
    }
    const captureDate = resolveBizCaptureDate();
    return `biz:${captureDate}`;
  }

  function invalidateDataCache() {
    state.dataCache = { key: '', byPartner: {}, loadingPartner: '' };
  }

  function getCachedPartnerBundle(partnerId) {
    const key = buildCacheKey();
    if (state.dataCache.key !== key) return null;
    return state.dataCache.byPartner[partnerId] || null;
  }

  function setCachedPartnerBundle(partnerId, bundle) {
    const key = buildCacheKey();
    if (state.dataCache.key !== key) {
      state.dataCache = { key, byPartner: {}, loadingPartner: '' };
    }
    state.dataCache.byPartner[partnerId] = bundle;
  }

  function tableUiConfig() {
    if (isViewSection()) {
      return {
        partnerBarId: 'baeminStatusPartnerSubtabBar',
        menuBarId: 'baeminStatusMenuSubtabBar',
        sectionRootId: 'baemin-status',
        panelAttr: 'data-baemin-panel',
        appliedQuery: '&appliedOnly=1',
        emptyMessage: '「배민 BIZ 현황」에서 수집 후 [배민현황 저장]을 눌러 주세요.',
        summaryMap: {
          delivery_status: 'baeminStatusDeliveryStatusSummary',
          daily_history: 'baeminStatusDailyHistorySummary',
          rider_history: 'baeminStatusRiderHistorySummary',
          quota_achievement: 'baeminStatusQuotaAchievementSummary',
          weekday_quota: 'baeminStatusWeekdayQuotaSummary',
          accept_rate_live: 'baeminStatusAcceptRateSummary',
          calls_rejection_sync: 'baeminStatusSyncSummary'
        },
        rowsMap: {
          delivery_status: 'baeminStatusDeliveryStatusRows',
          daily_history: 'baeminStatusDailyHistoryRows',
          rider_history: 'baeminStatusRiderHistoryRows',
          quota_achievement: 'baeminStatusQuotaAchievementRows',
          weekday_quota: 'baeminStatusWeekdayQuotaRows',
          accept_rate_live: 'baeminStatusAcceptRateRows',
          calls_rejection_sync: 'baeminStatusSyncRows'
        }
      };
    }
    return {
      partnerBarId: 'baeminBizPartnerSubtabBar',
      menuBarId: 'baeminBizMenuSubtabBar',
      sectionRootId: 'baemin-biz-status',
      panelAttr: 'data-baemin-biz-panel',
      appliedQuery: '',
      emptyMessage: '수집된 데이터가 없습니다. [배민 전체 데이터 수집]을 실행하세요.',
      summaryMap: {
        delivery_status: 'baeminBizDeliveryStatusSummary',
        daily_history: 'baeminBizDailyHistorySummary',
        rider_history: 'baeminBizRiderHistorySummary'
      },
      rowsMap: {
        delivery_status: 'baeminBizDeliveryStatusRows',
        daily_history: 'baeminBizDailyHistoryRows',
        rider_history: 'baeminBizRiderHistoryRows'
      }
    };
  }

  function syncPartnerColumnVisibility(show) {
    const root = isViewSection() ? '#baemin-status' : '#baemin-biz-status';
    document.querySelectorAll(`${root} .baemin-data-table`).forEach(table => {
      const headerCell = table.querySelector('thead tr th:first-child');
      if (headerCell && headerCell.textContent.trim() === '협력사') {
        headerCell.hidden = !show;
      }
      table.querySelectorAll('tbody tr td[data-partner-col]').forEach(cell => {
        cell.hidden = !show;
      });
    });
  }

  function formatPartnerCell(parsed, row = null) {
    const fromKey = partnerIdFromDedupeKey(row?.dedupe_key);
    const pid = fromKey || normalizePartnerId(parsed?.partnerId);
    if (isViewSection()) {
      return resolveRegisteredRegionName(pid) || pid || '-';
    }
    return parsed?.partnerName || pid || '-';
  }

  function renderRefreshMeta() {
    const meta = $('baeminStatusRefreshMeta');
    if (!meta || !isViewSection()) return;
    if (!state.lastClientRefreshAt) {
      meta.hidden = true;
      meta.textContent = '';
      return;
    }
    meta.hidden = false;
    meta.textContent = `최신화: ${formatDateTime(state.lastClientRefreshAt)}`;
  }

  function renderRegionRegistrationCard() {
    const card = $('baeminPartnerRegionCard');
    if (!card || !isViewSection()) return;
    card.hidden = !state.canManageRegions;
  }

  function getPartnerMenuTotals(partnerId, menu = 'delivery_status') {
    const bundle = getCachedPartnerBundle(normalizePartnerId(partnerId));
    return bundle?.totals?.[menu] || null;
  }

  function applyFullBundleToCache(byPartner = {}, collectDate = '', weekStart = '', weekEnd = '') {
    const key = buildCacheKey();
    state.dataCache = { key, byPartner: {}, loadingPartner: '' };
    Object.entries(byPartner || {}).forEach(([partnerId, data]) => {
      const pid = normalizePartnerId(partnerId);
      state.dataCache.byPartner[pid] = {
        delivery_status: data.delivery_status || [],
        daily_history: data.daily_history || [],
        rider_history: data.rider_history || [],
        totals: data.totals || {},
        meta: {
          ...(data.meta || {}),
          captureDate: data.meta?.captureDate || collectDate,
          weekStart: data.meta?.weekStart || weekStart || undefined,
          weekEnd: data.meta?.weekEnd || weekEnd || undefined
        }
      };
    });
  }

  function renderProgressCard(label, actual, target) {
    const prog = formatProgress(actual, target);
    const overClass = prog.percent > 100 ? ' baemin-grand-totals__percent--over' : '';
    return `<div class="baemin-grand-totals__card">
      <span class="baemin-grand-totals__label">${escapeHtml(label)}</span>
      <span class="baemin-grand-totals__value">${escapeHtml(prog.label)}</span>
      <span class="baemin-grand-totals__percent${overClass}">${escapeHtml(prog.percentLabel)}</span>
    </div>`;
  }

  function renderMetricCard(label, value, accent = false) {
    return `<div class="baemin-grand-totals__card">
      <span class="baemin-grand-totals__label">${escapeHtml(label)}</span>
      <span class="baemin-grand-totals__value${accent ? ' baemin-grand-totals__value--accent' : ''}">${formatNumber(value)}</span>
    </div>`;
  }

  function renderQuotaCell(actual, target) {
    const prog = formatProgress(actual, target);
    const achieved = prog.percent >= 100;
    const statusClass = achieved
      ? ' baemin-quota-tag--achieved'
      : ' baemin-quota-tag--missed';
    const percentClass = achieved
      ? ' baemin-quota-cell__percent--over'
      : ' baemin-quota-cell__percent--missed';
    return `<td class="baemin-quota-cell">
      <div class="baemin-quota-cell__value">${escapeHtml(prog.label)}</div>
      <div class="baemin-quota-cell__meta">
        <span class="baemin-quota-cell__percent${percentClass}">${escapeHtml(prog.percentLabel)}</span>
        <span class="baemin-quota-tag${statusClass}">${achieved ? '달성' : '미달성'}</span>
      </div>
    </td>`;
  }

  function renderSetCountRow(partnerId = state.activePartnerId) {
    const row = $('baeminStatusSetCountRow');
    const input = $('baeminStatusSetCount');
    const meta = $('baeminStatusSetCountMeta');
    const labelEl = $('baeminStatusSetCountLabel');
    if (!row || !isViewSection()) return;
    const pid = normalizePartnerId(partnerId);
    // 세트수는 지역별 할당 달성에서만 표시
    const show = Boolean(pid && state.activeMenu === 'quota_achievement');
    row.hidden = !show;
    if (!show) return;

    const partner = state.partners.find(p => normalizePartnerId(p.partnerId) === pid);
    const regionLabel = partnerDisplayLabel(partner) || pid;
    const entry = state.partnerSetCountMap?.[pid] || null;
    const count = entry ? normalizeSetCount(entry.setCount) : 1;

    if (labelEl) labelEl.textContent = `${regionLabel} 세트수`;
    if (input) {
      input.dataset.partnerId = pid;
      input.value = String(count);
    }
    if (meta) {
      meta.textContent = entry?.updatedAt
        ? `${regionLabel}(${pid}) · ${count}세트 · ${formatDateTime(entry.updatedAt)}${entry.updatedBy ? ` · ${entry.updatedBy}` : ''}`
        : `${regionLabel}(${pid}) · 아직 미저장(기본 1세트) · 이 지역에만 적용`;
    }
  }

  function renderQuotaAchievementRows(partnerId, items = [], meta = {}) {
    renderQuotaAchievementForSelection([normalizePartnerId(partnerId)].filter(Boolean), {
      [normalizePartnerId(partnerId)]: { items, meta }
    });
  }

  function renderQuotaAchievementForSelection(partnerIds = getSelectedPartnerIds(), bundlesById = null) {
    const rowsEl = $('baeminStatusQuotaAchievementRows');
    const summaryEl = $('baeminStatusQuotaAchievementSummary');
    if (!rowsEl) return;

    const ids = (partnerIds || []).map(normalizePartnerId).filter(Boolean);
    if (!ids.length) {
      if (summaryEl) summaryEl.textContent = '지역을 선택하세요';
      rowsEl.innerHTML = '<tr><td colspan="6" class="form-help">지역을 선택하고 지역별 할당 달성 조회를 눌러 주세요.</td></tr>';
      return;
    }

    const weekStart = ensureViewWeekStart();
    const weekRange = computeViewWeekQueryRange(weekStart);
    const sections = [];
    let filledTotal = 0;
    let dayTotal = 0;

    ids.forEach(pid => {
      const cached = bundlesById?.[pid] || getCachedPartnerBundle(pid) || {};
      const items = cached.items || cached.daily_history || [];
      const meta = cached.meta || {};
      const setCount = getPartnerSetCount(pid);
      const partnerLabel = partnerLabelById(pid);
      const fromDate = meta.weekStart || weekRange.fromDate;
      const toDate = meta.weekEnd || weekRange.toDate;
      const byDate = new Map();
      items.forEach(row => {
        const p = row.parsed_json || {};
        const date = String(p.deliveryDate || p.businessDate || row.collect_date || '').slice(0, 10);
        if (!date) return;
        const hit = byDate.get(date) || { morning: 0, afternoon: 0, evening: 0, midnight: 0 };
        hit.morning += Number(p.morningCount || 0);
        hit.afternoon += Number(p.afternoonCount || 0);
        hit.evening += Number(p.eveningCount || 0);
        hit.midnight += Number(p.midnightCount || 0);
        byDate.set(date, hit);
      });
      const dates = listDatesInclusive(fromDate, toDate);
      dayTotal += dates.length;
      const filledDays = dates.filter(date => byDate.has(date)).length;
      filledTotal += filledDays;
      if (!dates.length) return;
      if (!filledDays) {
        sections.push(`<tr>
          <td>${escapeHtml(partnerLabel)}</td>
          <td colspan="5" class="form-help">해당 정산주 일별 배달내역 없음</td>
        </tr>`);
        return;
      }
      dates.forEach(date => {
        const actual = byDate.get(date) || { morning: 0, afternoon: 0, evening: 0, midnight: 0 };
        const targets = computeSlotTargets(setCount, date);
        sections.push(`<tr>
          <td>${escapeHtml(partnerLabel)}</td>
          <td>${escapeHtml(formatDeliveryDateWithWeekday(date))}</td>
          ${renderQuotaCell(actual.morning, targets.morning)}
          ${renderQuotaCell(actual.afternoon, targets.afternoon)}
          ${renderQuotaCell(actual.evening, targets.evening)}
          ${renderQuotaCell(actual.midnight, targets.midnight)}
        </tr>`);
      });
    });

    const rangeLabel = `${weekRange.fromDate} ~ ${weekRange.toDate}`;
    if (summaryEl) {
      summaryEl.textContent = `지역 ${ids.length}곳 · ${rangeLabel} · 데이터 ${filledTotal}/${dayTotal || ids.length} · 지역별 할당 달성`;
    }
    if (!sections.length) {
      rowsEl.innerHTML = '<tr><td colspan="6" class="form-help">정산주를 선택하고 지역별 할당 달성 조회를 눌러 주세요.</td></tr>';
      return;
    }
    rowsEl.innerHTML = sections.join('');
  }

  function renderDeliveryStatusRowsMulti(items = [], partnerIds = [], meta = {}) {
    const rowsEl = $('baeminStatusDeliveryStatusRows');
    const summaryEl = $('baeminStatusDeliveryStatusSummary');
    if (!rowsEl) return;
    const ids = (partnerIds || []).map(normalizePartnerId).filter(Boolean);
    const showPartner = ids.length !== 1;
    syncPartnerColumnVisibility(showPartner);
    const drivingCount = countDrivingRiders(items);
    const labels = ids.map(partnerLabelById).join(', ');
    if (summaryEl) {
      summaryEl.textContent = `${labels || '선택 지역'} · 운행중 ${formatNumber(drivingCount)}명 · ${meta.live ? '실시간' : '저장 스냅샷'}`;
    }
    if (isViewSection()) {
      renderViewAppliedBanner(state.config?.applied || null);
    }
    if (!items.length) {
      rowsEl.innerHTML = `<tr><td colspan="${showPartner ? 13 : 12}" class="form-help">운행중 기사가 없습니다.</td></tr>`;
      return;
    }
    rowsEl.innerHTML = items.map(row => {
      const p = row.parsed_json || {};
      const pid = resolveRowPartnerId(row);
      const partnerCell = showPartner
        ? `<td data-partner-col>${escapeHtml(partnerLabelById(pid))}</td>`
        : '';
      return `<tr>
        ${partnerCell}
        <td>${escapeHtml(row.rider_name || '-')}</td>
        <td>${escapeHtml(p.statusDesc || '-')}</td>
        <td>${escapeHtml(row.rider_user_id || '-')}</td>
        <td>${escapeHtml(row.phone_number || '-')}</td>
        <td>${formatNumber(p.totalComplete || 0)}</td>
        ${formatServiceBreakdownCells(p)}
        <td>${formatNumber(p.morningCount || 0)}</td>
        <td>${formatNumber(p.afternoonCount || 0)}</td>
        <td>${formatNumber(p.eveningCount || 0)}</td>
        <td>${formatNumber(p.midnightCount || 0)}</td>
      </tr>`;
    }).join('');
  }

  function renderDeliveryStatusForSelection() {
    const partnerIds = getSelectedPartnerIds();
    const merged = [];
    partnerIds.forEach(pid => {
      const cached = getCachedPartnerBundle(pid);
      if (cached?.delivery_status?.length) {
        merged.push(...cached.delivery_status);
      }
    });
    const driving = merged.filter(row => isDrivingStatus(row?.parsed_json?.statusDesc || ''));
    if (!driving.length && !merged.length) {
      clearViewTablesForMenu('delivery_status', '배달현황 조회를 눌러 주세요');
      renderGrandTotalsPanelMulti(partnerIds);
      return;
    }
    renderDeliveryStatusRowsMulti(driving.length ? driving : merged, partnerIds, { live: false });
    renderGrandTotalsPanelMulti(partnerIds);
  }

  function renderGrandTotalsPanelMulti(partnerIds = getSelectedPartnerIds()) {
    const panel = $('baeminStatusGrandTotals');
    if (!panel || !isViewSection()) return;
    if (!state.viewLoaded || state.activeMenu !== 'delivery_status') {
      panel.hidden = true;
      panel.innerHTML = '';
      return;
    }
    const ids = (partnerIds || []).map(normalizePartnerId).filter(Boolean);
    if (!ids.length) {
      panel.hidden = true;
      panel.innerHTML = '';
      return;
    }

    const aggregate = {
      rowCount: 0,
      drivingCount: 0,
      completeTotal: 0,
      totalReject: 0,
      cancelTotal: 0,
      riderFault: 0,
      morningTotal: 0,
      afternoonTotal: 0,
      eveningTotal: 0,
      midnightTotal: 0
    };
    let setCountSum = 0;
    ids.forEach(pid => {
      const totals = getPartnerMenuTotals(pid, 'delivery_status') || {};
      const cached = getCachedPartnerBundle(pid);
      aggregate.rowCount += Number(totals.rowCount || cached?.delivery_status?.length || 0);
      aggregate.drivingCount += Number.isFinite(Number(totals.drivingCount))
        ? Number(totals.drivingCount)
        : countDrivingRiders(cached?.delivery_status || []);
      aggregate.completeTotal += Number(totals.completeTotal || 0);
      aggregate.totalReject += Number(totals.totalReject || 0);
      aggregate.cancelTotal += Number(totals.cancelTotal || 0);
      aggregate.riderFault += Number(totals.riderFault || 0);
      aggregate.morningTotal += Number(totals.morningTotal || 0);
      aggregate.afternoonTotal += Number(totals.afternoonTotal || 0);
      aggregate.eveningTotal += Number(totals.eveningTotal || 0);
      aggregate.midnightTotal += Number(totals.midnightTotal || 0);
      setCountSum += getPartnerSetCount(pid);
    });

    if (aggregate.rowCount <= 0) {
      panel.hidden = true;
      panel.innerHTML = '';
      return;
    }

    const labels = ids.map(partnerLabelById).join(', ');
    const avgSets = Math.max(1, Math.round(setCountSum / ids.length));
    const todayTargets = computeSlotTargets(avgSets, todayKstDate());
    panel.hidden = false;
    panel.innerHTML = `
      <p class="baemin-grand-totals__title">${escapeHtml(labels)} · 기사 전체 ${formatNumber(aggregate.rowCount)}명 · 운행중 ${formatNumber(aggregate.drivingCount)}명 · 지역 ${ids.length}곳</p>
      ${renderMetricCard('운행중', aggregate.drivingCount, true)}
      ${renderMetricCard('완료', aggregate.completeTotal, true)}
      ${renderMetricCard('거절 합계', aggregate.totalReject)}
      ${renderMetricCard('배차취소 합계', aggregate.cancelTotal)}
      ${renderMetricCard('배달취소(라이더귀책) 합계', aggregate.riderFault)}
      ${renderProgressCard('아침점심 합계', aggregate.morningTotal, todayTargets.morning)}
      ${renderProgressCard('오후 합계', aggregate.afternoonTotal, todayTargets.afternoon)}
      ${renderProgressCard('저녁 합계', aggregate.eveningTotal, todayTargets.evening)}
      ${renderProgressCard('심야 합계', aggregate.midnightTotal, todayTargets.midnight)}
    `;
  }

  function renderActiveViewFromCacheMulti() {
    const menu = state.activeMenu || 'delivery_status';
    if (menu === 'delivery_status') {
      renderDeliveryStatusForSelection();
      return;
    }
    if (menu === 'quota_achievement') {
      renderQuotaAchievementForSelection();
      renderGrandTotalsPanelMulti();
      return;
    }
    renderActiveViewFromCache();
  }

  function renderActiveViewFromCache() {
    const partnerId = normalizePartnerId(state.activePartnerId);
    const menu = state.activeMenu || 'delivery_status';
    if (!partnerId) return;
    const cached = getCachedPartnerBundle(partnerId);
    if (!cached) return;
    renderSetCountRow(partnerId);
    if (menu === 'quota_achievement') {
      renderQuotaAchievementForSelection();
      renderGrandTotalsPanelMulti();
      return;
    }
    if (menu === 'weekday_quota') {
      void ensureWeekdayQuotaLoaded().then(() => renderWeekdayQuotaEditor());
      renderGrandTotalsPanel('delivery_status', partnerId);
      return;
    }
    if (menu === 'accept_rate_live') {
      if (cached.meta?.acceptRateLoaded && Array.isArray(cached.accept_rate_live)) {
        renderAcceptRateLiveRows(partnerId, cached.accept_rate_live, {
          pastLabel: cached.meta.acceptRatePastLabel,
          currentLabel: cached.meta.acceptRateCurrentLabel
        });
      } else {
        clearViewTablesForMenu('accept_rate_live', '수락율 조회를 눌러 주세요.');
      }
      renderGrandTotalsPanel('delivery_status', partnerId);
      return;
    }
    if (menu === 'delivery_status') {
      renderDeliveryStatusForSelection();
      return;
    }
    if (menu === 'rider_history') {
      if (cached.rider_history?.length && cached.meta?.riderLoaded) {
        renderRiderHistoryRiderRows(partnerId, cached.rider_history, {
          fromDate: cached.meta.riderFromDate,
          toDate: cached.meta.riderToDate
        });
      }
      renderGrandTotalsPanel(menu, partnerId);
      return;
    }
    if (menu === 'daily_history') {
      if (cached.daily_history?.length && cached.meta?.dailyLoaded) {
        renderSubtabRows('daily_history', partnerId, cached.daily_history, cached.meta || {});
      }
      renderGrandTotalsPanel(menu, partnerId);
      return;
    }
    if (menu === 'calls_rejection_sync') {
      const summaryEl = $('baeminStatusSyncSummary');
      if (summaryEl && !summaryEl.textContent) {
        summaryEl.textContent = '전지역 · 콜수입력 / 거절율입력 버튼을 눌러 주세요';
      }
      renderGrandTotalsPanel('delivery_status', partnerId);
      void loadSyncReflectionStatus({ silent: true });
      return;
    }
    if (cached[menu]?.length) {
      renderSubtabRows(menu, partnerId, cached[menu], cached.meta || {});
    }
    renderGrandTotalsPanel(menu, partnerId);
  }

  function renderGrandTotalsPanel(menu = state.activeMenu, partnerId = state.activePartnerId) {
    const panel = $('baeminStatusGrandTotals');
    if (!panel || !isViewSection()) return;

    if (!state.viewLoaded || menu !== 'delivery_status') {
      panel.hidden = true;
      panel.innerHTML = '';
      return;
    }

    const pid = normalizePartnerId(partnerId);
    const totals = getPartnerMenuTotals(pid, 'delivery_status');
    if (!totals || Number(totals.rowCount || 0) <= 0) {
      panel.hidden = true;
      panel.innerHTML = '';
      return;
    }

    const partner = state.partners.find(item => normalizePartnerId(item.partnerId) === pid);
    const partnerLabel = partnerDisplayLabel(partner);
    const setCount = getPartnerSetCount(pid);
    const todayTargets = computeSlotTargets(setCount, todayKstDate());
    const cached = getCachedPartnerBundle(pid);
    const drivingCount = Number.isFinite(Number(totals.drivingCount))
      ? Number(totals.drivingCount)
      : countDrivingRiders(cached?.delivery_status || []);
    panel.hidden = false;
    panel.innerHTML = `
      <p class="baemin-grand-totals__title">${escapeHtml(partnerLabel)} · 기사 전체 ${formatNumber(totals.rowCount)}명 · 운행중 ${formatNumber(drivingCount)}명 · ${setCount}세트</p>
      ${renderMetricCard('운행중', drivingCount, true)}
      ${renderMetricCard('완료', totals.completeTotal, true)}
      ${renderMetricCard('거절 합계', totals.totalReject)}
      ${renderMetricCard('배차취소 합계', totals.cancelTotal)}
      ${renderMetricCard('배달취소(라이더귀책) 합계', totals.riderFault)}
      ${renderProgressCard('아침점심 합계', totals.morningTotal, todayTargets.morning)}
      ${renderProgressCard('오후 합계', totals.afternoonTotal, todayTargets.afternoon)}
      ${renderProgressCard('저녁 합계', totals.eveningTotal, todayTargets.evening)}
      ${renderProgressCard('심야 합계', totals.midnightTotal, todayTargets.midnight)}
    `;
  }

  function renderSyncReflectionCoverage(result, options = {}) {
    const el = $('baeminStatusSyncCoverageResult');
    const summary = $('baeminStatusSyncCoverageSummary');
    if (!el) return;

    if (!result?.ok) {
      el.innerHTML = `<p class="form-help form-help--warn">${escapeHtml(result?.message || '반영여부 조회 실패')}</p>`;
      if (summary) summary.textContent = '조회 실패';
      return;
    }

    const fromDate = options.fromDate || result.fromDate;
    const toDate = options.toDate || result.toDate;
    let rows = Array.isArray(result.rows) ? result.rows.slice() : [];
    rows = rows.filter(row => {
      const day = String(row.date || '').slice(0, 10);
      return day >= fromDate && day <= toDate;
    });
    rows.sort((a, b) => {
      const dateDiff = String(a.date).localeCompare(String(b.date));
      if (dateDiff) return dateDiff;
      return String(a.displayName || a.partnerId).localeCompare(String(b.displayName || b.partnerId), 'ko');
    });

    const okCount = rows.filter(row => row.status === 'ok').length;
    const missingCount = rows.filter(row => row.status === 'missing').length;
    if (summary) {
      summary.textContent = `반영완료 ${formatNumber(okCount)} · 미반영 ${formatNumber(missingCount)} · ${fromDate}~${toDate}`;
    }

    if (!rows.length) {
      el.innerHTML = `
        <p class="form-help">선택 기간에 표시할 날짜·지역이 없습니다. BIZ에서 라이더별 배달내역 수집 후 [배민현황 저장]하세요.</p>
        <p class="baemin-rider-day-results__meta">기간 ${escapeHtml(fromDate)} ~ ${escapeHtml(toDate)}</p>
      `;
      return;
    }

    el.innerHTML = `
      <div class="baemin-coverage-table-wrap">
        <table class="baemin-coverage-table">
          <thead>
            <tr>
              <th>날짜</th>
              <th>지역</th>
              <th>반영여부</th>
              <th>건수</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(row => {
              const isOk = row.status === 'ok';
              const label = row.statusLabel
                || (isOk ? '반영완료' : (row.status === 'pending' ? '예정' : '미반영'));
              return `<tr class="${isOk ? 'is-ok' : (row.status === 'missing' ? 'is-missing' : '')}">
                <td>${escapeHtml(row.date)}</td>
                <td>${escapeHtml(row.displayName || row.regionName || row.partnerId)}</td>
                <td class="${isOk ? 'status-ok' : 'status-missing'}">${escapeHtml(label)}</td>
                <td>${row.rowCount > 0 ? formatNumber(row.rowCount) : '-'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <p class="baemin-rider-day-results__meta">
        라이더별 배달내역 · ${escapeHtml(fromDate)} ~ ${escapeHtml(toDate)}
        · 반영완료 ${formatNumber(okCount)} · 미반영 ${formatNumber(missingCount)}
      </p>
    `;
  }

  async function loadSyncReflectionStatus(options = {}) {
    const btn = $('baeminSyncCoverageLoadBtn');
    ensureSyncDateRangeDefaults();
    const range = resolveSyncDateRange();
    const fromDate = range.fromDate;
    const toDate = range.toDate;
    const weekStarts = listSettlementWeeksInRange(fromDate, toDate);
    if (!weekStarts.length) {
      renderSyncReflectionCoverage({ ok: false, message: '선택 기간의 정산주를 찾을 수 없습니다.' });
      return null;
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = '조회 중…';
    }
    const summary = $('baeminStatusSyncCoverageSummary');
    if (summary) summary.textContent = '반영여부 조회 중…';

    try {
      const results = await Promise.all(weekStarts.map(weekStart => adminApi(
        `/api/admin/baemin-delivery/history-collect-coverage?menu=rider_history&weekStart=${encodeURIComponent(weekStart)}`
      )));
      const mergedRows = [];
      let firstOk = null;
      for (const result of results) {
        if (!result?.ok) continue;
        if (!firstOk) firstOk = result;
        (result.rows || []).forEach(row => mergedRows.push(row));
      }
      if (!firstOk) {
        const fail = results.find(r => r && !r.ok) || { message: '반영여부 조회 실패' };
        renderSyncReflectionCoverage({ ok: false, message: fail.message || fail.error || '반영여부 조회 실패' });
        if (!options.silent) showToast(fail.message || '반영여부 조회 실패');
        return fail;
      }
      const merged = {
        ...firstOk,
        fromDate,
        toDate,
        rows: mergedRows
      };
      renderSyncReflectionCoverage(merged, { fromDate, toDate });
      if (!options.silent) {
        const ok = mergedRows.filter(r => r.status === 'ok' && r.date >= fromDate && r.date <= toDate).length;
        const missing = mergedRows.filter(r => r.status === 'missing' && r.date >= fromDate && r.date <= toDate).length;
        showToast(`반영여부 · 완료 ${formatNumber(ok)} · 미반영 ${formatNumber(missing)}`);
      }
      return merged;
    } catch (error) {
      renderSyncReflectionCoverage({ ok: false, message: error.message || '반영여부 조회 실패' });
      if (!options.silent) showToast(error.message || '반영여부 조회 실패');
      return null;
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '반영여부 조회';
      }
    }
  }

  function clearViewTablesIdle(message) {
    const ui = tableUiConfig();
    const text = message || '「데이터 불러오기」를 눌러 Supabase 데이터를 조회하세요.';
    Object.entries(ui.rowsMap).forEach(([menu, rowsId]) => {
      const summaryId = ui.summaryMap[menu];
      const summaryEl = $(summaryId);
      const rowsEl = $(rowsId);
      const colspan = menu === 'accept_rate_live'
        ? 13
        : (menu === 'calls_rejection_sync'
          ? 7
          : (menu === 'quota_achievement'
            ? 6
            : (menu === 'weekday_quota'
              ? 8
              : getBaeminTableColspan(menu, { showPartner: false, includeCollected: false }))));
      if (summaryEl) {
        summaryEl.textContent = menu === 'accept_rate_live'
          ? '수락율 조회를 눌러 주세요'
          : (menu === 'calls_rejection_sync'
            ? '전지역 · 동기화 버튼 또는 아래 반영여부 확인'
            : '데이터 불러오기를 눌러 주세요');
      }
      if (rowsEl) {
        const idleText = menu === 'calls_rejection_sync'
          ? '전지역 대상 · 콜수입력 / 거절율입력 / 모두입력 버튼을 사용하세요. 반영여부는 위 표를 확인하세요.'
          : text;
        rowsEl.innerHTML = `<tr><td colspan="${colspan}" class="form-help">${idleText}</td></tr>`;
      }
    });
    renderGrandTotalsPanel(state.activeMenu, null);
  }

  async function loadPartnerRegionMap() {
    const result = await adminApi('/api/admin/baemin-delivery/partner-regions');
    if (!result.ok) {
      // 실패 시 타계정/전체 지역 캐시를 쓰지 않음
      state.partnerRegionMap = {};
      state.partnerRegionItems = [];
      state.viewPartnerIds = [];
      state.canManageRegions = false;
      renderPartnerRegionList([]);
      renderRegionRegistrationCard();
      if (isViewSection()) {
        state.partners = [];
        renderPartnerTabs([]);
        updateWeekPickerVisibility();
        updatePanelVisibility();
        showToast(result.message || '담당 지역을 불러오지 못했습니다. 계정 지역 배정을 확인하세요.');
      }
      return;
    }
    state.canManageRegions = Boolean(result.canManageRegions);
    state.partnerRegionMap = result.map || {};
    state.partnerRegionItems = Array.isArray(result.items) ? result.items : [];
    state.viewPartnerIds = Array.isArray(result.viewPartnerIds)
      ? result.viewPartnerIds.map(id => String(id || '').trim().toUpperCase()).filter(Boolean)
      : Object.keys(state.partnerRegionMap);
    writeCachedRegionMap(state.partnerRegionMap);
    // 지역 등록 목록만 전체(allItems). 조회 탭은 map/items(=배정 지역)만 사용
    renderPartnerRegionList(state.canManageRegions ? (result.allItems || result.items || []) : state.partnerRegionItems);
    renderRegionRegistrationCard();
    if (isViewSection()) showRegionTabsFromMap(state.partnerRegionMap);
    void initDashboardBaeminLive(true);
  }

  async function loadPartnerSetCountMap() {
    const result = await adminApi('/api/admin/baemin-delivery/partner-set-count');
    if (!result.ok) {
      state.partnerSetCountMap = {};
      return;
    }
    state.partnerSetCountMap = result.map || {};
  }

  async function ensureWeekdayQuotaLoaded(force = false) {
    if (!force && state.weekdayQuotaMatrix) return state.weekdayQuotaMatrix;
    const result = await adminApi('/api/admin/baemin-delivery/weekday-quota');
    if (!result.ok) {
      state.weekdayQuotaMatrix = cloneDefaultWeekdayQuota();
      state.weekdayQuotaMeta = { updatedAt: '', updatedBy: '', isDefault: true };
      return state.weekdayQuotaMatrix;
    }
    state.weekdayQuotaMatrix = normalizeWeekdayQuotaMatrix(result.matrix);
    state.weekdayQuotaMeta = {
      updatedAt: result.updatedAt || '',
      updatedBy: result.updatedBy || '',
      isDefault: Boolean(result.isDefault)
    };
    return state.weekdayQuotaMatrix;
  }

  function readWeekdayQuotaFromEditor() {
    const matrix = cloneDefaultWeekdayQuota();
    WEEKDAY_QUOTA_KEYS.forEach(day => {
      WEEKDAY_QUOTA_SLOT_KEYS.forEach(slot => {
        const input = document.querySelector(`[data-weekday-quota-day="${day}"][data-weekday-quota-slot="${slot}"]`);
        if (!input) return;
        matrix[day][slot] = normalizeQuotaSlotValue(input.value, matrix[day][slot]);
      });
    });
    return matrix;
  }

  function renderWeekdayQuotaEditor() {
    const rowsEl = $('baeminStatusWeekdayQuotaRows');
    const summaryEl = $('baeminStatusWeekdayQuotaSummary');
    const metaEl = $('baeminStatusWeekdayQuotaMeta');
    if (!rowsEl) return;

    const matrix = ensureWeekdayQuotaMatrix();
    rowsEl.innerHTML = WEEKDAY_QUOTA_SLOT_KEYS.map(slot => {
      const cells = WEEKDAY_QUOTA_KEYS.map(day => {
        const value = matrix[day]?.[slot] ?? 0;
        return `<td><input type="number" class="baemin-weekday-quota-input" min="0" max="9999" step="1" inputmode="numeric" value="${value}" data-weekday-quota-day="${day}" data-weekday-quota-slot="${slot}" aria-label="${WEEKDAY_QUOTA_SLOT_LABELS[slot]} ${day}"></td>`;
      }).join('');
      return `<tr>
        <th scope="row">${escapeHtml(WEEKDAY_QUOTA_SLOT_LABELS[slot])}</th>
        ${cells}
      </tr>`;
    }).join('');

    if (summaryEl) {
      summaryEl.textContent = '1세트 기준 · 저장 값이 지역별 할당 달성 목표로 사용됩니다';
    }
    if (metaEl) {
      const meta = state.weekdayQuotaMeta || {};
      metaEl.textContent = meta.updatedAt
        ? `저장 ${formatDateTime(meta.updatedAt)}${meta.updatedBy ? ` · ${meta.updatedBy}` : ''}`
        : '기본값 (아직 저장 없음) · 토 심야=31';
    }
  }

  async function saveWeekdayQuotaMatrix() {
    const matrix = readWeekdayQuotaFromEditor();
    const btn = $('baeminStatusWeekdayQuotaSaveBtn');
    btn?.classList.add('is-loading');
    if (btn) btn.textContent = '저장 중…';
    const result = await adminApi('/api/admin/baemin-delivery/weekday-quota', {
      method: 'POST',
      body: JSON.stringify({ matrix })
    });
    btn?.classList.remove('is-loading');
    if (btn) btn.textContent = '할당 저장';
    if (!result.ok) {
      showToast(result.message || result.error || '요일별 할당 저장에 실패했습니다.');
      return;
    }
    state.weekdayQuotaMatrix = normalizeWeekdayQuotaMatrix(result.matrix);
    state.weekdayQuotaMeta = {
      updatedAt: result.updatedAt || new Date().toISOString(),
      updatedBy: result.updatedBy || '',
      isDefault: false
    };
    renderWeekdayQuotaEditor();

    const pid = normalizePartnerId(state.activePartnerId);
    const cached = pid ? getCachedPartnerBundle(pid) : null;
    if (pid && cached && (cached.meta?.quotaLoaded || cached.daily_history?.length)) {
      renderQuotaAchievementRows(pid, cached.daily_history || [], cached.meta || {});
    }
    if (pid && state.activeMenu === 'delivery_status') {
      renderGrandTotalsPanel('delivery_status', pid);
    }
    showToast('요일별 할당을 저장했습니다. 지역별 할당 달성에 반영됩니다.');
  }

  async function resetWeekdayQuotaEditorToDefaults() {
    state.weekdayQuotaMatrix = cloneDefaultWeekdayQuota();
    renderWeekdayQuotaEditor();
    showToast('기본값으로 되돌렸습니다. [할당 저장]을 눌러 반영하세요.');
  }

  async function savePartnerSetCount() {
    const pid = normalizePartnerId(state.activePartnerId);
    if (!pid) {
      showToast('지역을 먼저 선택하세요.');
      return;
    }
    const input = $('baeminStatusSetCount');
    if (input?.dataset.partnerId && normalizePartnerId(input.dataset.partnerId) !== pid) {
      showToast('지역이 바뀌었습니다. 세트수를 다시 확인한 뒤 저장하세요.');
      renderSetCountRow(pid);
      return;
    }
    const setCount = normalizeSetCount(input?.value || 1);
    const regionLabel = partnerDisplayLabel(state.partners.find(p => normalizePartnerId(p.partnerId) === pid)) || pid;
    const result = await adminApi('/api/admin/baemin-delivery/partner-set-count', {
      method: 'POST',
      body: JSON.stringify({ partnerId: pid, setCount })
    });
    if (!result.ok) {
      showToast(result.message || result.error || '세트수 저장에 실패했습니다.');
      return;
    }
    state.partnerSetCountMap = {
      ...(state.partnerSetCountMap || {}),
      ...(result.map || {})
    };
    state.partnerSetCountMap[pid] = {
      setCount: result.setCount || setCount,
      updatedAt: result.updatedAt || new Date().toISOString(),
      updatedBy: result.updatedBy || ''
    };
    showToast(`${regionLabel} · ${setCount}세트 저장 (이 지역만 적용)`);
    renderSetCountRow(pid);
    if (state.activeMenu === 'quota_achievement') {
      const cached = getCachedPartnerBundle(pid);
      if (cached?.meta?.quotaLoaded || cached?.daily_history?.length) {
        renderQuotaAchievementRows(pid, cached.daily_history || [], cached.meta || {});
      }
    } else {
      renderActiveViewFromCache();
    }
  }

  function renderPartnerRegionList(items = []) {
    const list = $('baeminPartnerRegionList');
    if (!list) return;
    if (!items.length) {
      list.innerHTML = '<p class="baemin-partner-map-registry__empty">등록된 지역이 없습니다. DP 코드와 지역명을 입력해 등록하세요.</p>';
      return;
    }
    const activeId = normalizePartnerId(state.activePartnerId);
    list.innerHTML = `
      <table class="baemin-partner-map-table">
        <thead>
          <tr>
            <th>지역명</th>
            <th>DP 코드 (Biz 매칭)</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${items.map(item => {
            const id = normalizePartnerId(item.partnerId);
            const active = activeId === id ? ' is-active' : '';
            return `<tr class="${active.trim()}" data-partner-id="${escapeHtml(id)}">
              <td class="baemin-partner-map-table__region">${escapeHtml(item.regionName)}</td>
              <td class="baemin-partner-map-table__dp">${escapeHtml(id)}</td>
              <td class="baemin-partner-map-table__actions">
                <button type="button" data-remove-partner="${escapeHtml(id)}" title="삭제">삭제</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    `;

    list.querySelectorAll('[data-remove-partner]').forEach(btn => {
      btn.addEventListener('click', event => {
        event.stopPropagation();
        void removePartnerRegionEntry(btn.getAttribute('data-remove-partner') || '');
      });
    });
  }

  async function savePartnerRegionEntry(partnerId, regionName) {
    const pid = String(partnerId || '').trim().toUpperCase();
    const region = String(regionName || '').trim();
    if (!/^DP\d{6,}$/.test(pid)) {
      showToast('DP 코드 형식을 확인하세요. (예: DP2603302214)');
      return;
    }
    if (!region) {
      showToast('지역명을 입력하세요.');
      return;
    }
    const result = await adminApi('/api/admin/baemin-delivery/partner-regions', {
      method: 'POST',
      body: JSON.stringify({ partnerId: pid, regionName: region })
    });
    if (!result.ok) {
      showToast(result.message || result.error || '저장에 실패했습니다.');
      return;
    }
    showToast(`${region} (${pid}) 등록됨`);
    $('baeminPartnerRegionDp').value = '';
    $('baeminPartnerRegionName').value = '';
    await loadPartnerRegionMap();
    invalidateDataCache();
    state.activePartnerId = pid;
    if (isViewSection()) {
      if (state.viewLoaded) {
        await loadViewData({ silent: true });
      } else {
        const viewPartners = filterPartnersForView(Object.keys(state.partnerRegionMap).map(id => ({
          partnerId: id,
          displayName: state.partnerRegionMap[id]
        })));
        state.partners = viewPartners;
        renderPartnerTabs(viewPartners);
        updatePanelVisibility();
      }
      return;
    }
    await loadPartnerTabs();
    await loadPartnerBundle(pid, state.activeMenu);
  }

  async function removePartnerRegionEntry(partnerId) {
    const pid = String(partnerId || '').trim().toUpperCase();
    if (!pid) return;
    const result = await adminApi('/api/admin/baemin-delivery/partner-regions', {
      method: 'POST',
      body: JSON.stringify({ partnerId: pid, delete: true })
    });
    if (!result.ok) {
      showToast(result.message || result.error || '삭제에 실패했습니다.');
      return;
    }
    showToast('지역 매핑을 삭제했습니다.');
    await loadPartnerRegionMap();
    invalidateDataCache();
    if (isViewSection()) {
      if (state.viewLoaded) {
        await loadViewData({ silent: true });
      } else {
        const viewPartners = filterPartnersForView(Object.keys(state.partnerRegionMap).map(id => ({
          partnerId: id,
          displayName: state.partnerRegionMap[id]
        })));
        state.partners = viewPartners;
        renderPartnerTabs(viewPartners);
        updatePanelVisibility();
      }
      return;
    }
    await loadPartnerTabs();
  }

  function selectedPartnerId() {
    return String(state.activePartnerId || '').trim();
  }

  function renderContaminationBanner(contamination) {
    const el = $('baeminDeliveryContaminationStatus');
    const toolbar = $('baeminBizPartnerToolbar');
    if (!el || isViewSection()) return;

    const needsScrub = Boolean(contamination?.needsScrub);
    if (toolbar) toolbar.hidden = !state.partners.length;

    if (!needsScrub) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }

    const groups = contamination.duplicateGroups || [];
    const lines = groups.map(group => {
      const removed = (group.removePartnerNames || group.removePartnerIds || []).join(', ');
      const kept = group.keepPartnerName || group.keepPartnerId || '-';
      const menus = (group.menus || ['delivery_status']).map(menu => {
        if (menu === 'daily_history') return '일별';
        if (menu === 'rider_history') return '라이더별';
        return '배달현황';
      }).join('·');
      return `<li><strong>${removed}</strong> — ${menus} 데이터가 <strong>${kept}</strong> 과 동일</li>`;
    }).join('');

    const inconsistent = contamination.inconsistentPartners || [];
    const partialLines = inconsistent.map(row => {
      const counts = row.menuCounts || {};
      return `<li><strong>${row.partnerName || row.partnerId}</strong> — 배달 ${formatNumber(counts.delivery_status || 0)} · 일별 ${formatNumber(counts.daily_history || 0)} · 라이더 ${formatNumber(counts.rider_history || 0)} (메뉴별 건수 불일치)</li>`;
    }).join('');

    el.hidden = false;
    el.innerHTML = `
      <strong>협력사별 데이터가 섞여 있습니다</strong>
      <p class="form-help">배달현황만 막히고 일별/라이더 데이터가 다른 협력사 이름으로 저장된 경우가 있습니다. 아래 [협력사 중복 데이터 정리] 후 [수집일 데이터 전체 삭제] → 다시 수집하세요.</p>
      ${lines ? `<ul>${lines}</ul>` : ''}
      ${partialLines ? `<ul>${partialLines}</ul>` : ''}
    `;
  }

  function renderPartnerTabs(partners = []) {
    const ui = tableUiConfig();
    const bar = $(ui.partnerBarId);
    if (!bar) return;
    state.partners = Array.isArray(partners) ? partners : [];
    if (!state.partners.length) {
      bar.hidden = true;
      bar.innerHTML = '';
      state.selectedPartnerIds = [];
      const toolbar = $('baeminBizPartnerToolbar');
      if (toolbar) toolbar.hidden = true;
      if (!isViewSection()) {
        clearBizPreviewTables();
        updatePanelVisibility();
      }
      return;
    }

    if (isViewSection()) {
      syncSelectedPartnerIds(state.activePartnerId);
    }

    bar.hidden = false;
    const selected = new Set(getSelectedPartnerIds());
    bar.innerHTML = state.partners.map(partner => {
      const id = normalizePartnerId(partner.partnerId);
      const label = partnerDisplayLabel(partner);
      const active = isViewSection()
        ? (selected.has(id) ? ' is-active' : '')
        : (normalizePartnerId(state.activePartnerId) === id ? ' is-active' : '');
      if (isViewSection()) {
        return `<button type="button" class="baemin-region-tab${active}" data-baemin-partner="${id}" title="DP ${id} · 클릭하여 이 지역 선택" aria-pressed="${selected.has(id) ? 'true' : 'false'}">${escapeHtml(label)}</button>`;
      }
      const bizLabel = bizPartnerTabLabel(partner);
      const count = Number(partner.riderCount || 0);
      const menuCounts = partner.menuCounts || {};
      const menuHint = menuCounts.delivery_status || menuCounts.daily_history || menuCounts.rider_history
        ? `배달 ${formatNumber(menuCounts.delivery_status || 0)} · 일별 ${formatNumber(menuCounts.daily_history || 0)} · 라이더 ${formatNumber(menuCounts.rider_history || 0)}`
        : (count > 0 ? `${formatNumber(count)}명` : '');
      const countLabel = menuHint ? ` (${menuHint})` : '';
      const contaminated = partner.contaminated || partner.inconsistent ? ' is-contaminated' : '';
      const dupHint = partner.duplicateOf ? ` · ${partner.duplicateOf}와 중복` : '';
      const partialHint = partner.inconsistent ? ' · 메뉴 불일치' : '';
      return `<button type="button" class="promotion-tab${active}${contaminated}" data-baemin-partner="${id}" title="DP ${id} · ${bizLabel}${dupHint}${partialHint}">${escapeHtml(bizLabel)}${countLabel}</button>`;
    }).join('');

    bar.querySelectorAll('[data-baemin-partner]').forEach(btn => {
      btn.addEventListener('click', () => {
        // 뷰 지역탭은 단일선택(지역별). 다중선택 없음.
        switchBaeminPartner(btn.dataset.baeminPartner || '', { toggle: false });
      });
    });
    if (isViewSection()) {
      renderPartnerRegionList(state.partnerRegionItems || []);
    }
  }

  function clearViewTablesNotApplied() {
    const ui = tableUiConfig();
    const message = ui.emptyMessage;
    Object.entries(ui.rowsMap).forEach(([menu, rowsId]) => {
      const summaryId = ui.summaryMap[menu];
      const summaryEl = $(summaryId);
      const rowsEl = $(rowsId);
      const colspan = getBaeminTableColspan(menu, { showPartner: false, includeCollected: !isViewSection() });
      if (summaryEl) summaryEl.textContent = '적용된 데이터 없음';
      if (rowsEl) rowsEl.innerHTML = `<tr><td colspan="${colspan}" class="form-help">${message}</td></tr>`;
    });
  }

  async function loadPartnerTabs() {
    if (isViewSection() && !state.viewLoaded) {
      const viewPartners = filterPartnersForView(Object.keys(state.partnerRegionMap || {}).map(id => ({
        partnerId: id,
        regionName: state.partnerRegionMap[id],
        displayName: state.partnerRegionMap[id]
      })));
      state.partners = viewPartners;
      renderPartnerTabs(viewPartners);
      updateWeekPickerVisibility();
      updatePanelVisibility();
      return;
    }

    if (isViewSection() && state.viewLoaded) {
      renderPartnerTabs(state.partners || []);
      updateWeekPickerVisibility();
      updatePanelVisibility();
      return;
    }

    const ui = tableUiConfig();
    const captureDate = isViewSection()
      ? (state.appliedCollectDate || state.config?.applied?.collectDate || todayKstDate())
      : resolveBizCaptureDate();
    const partnersUrl = isViewSection()
      ? buildViewPartnersQuery(captureDate)
      : `/api/admin/baemin-delivery/partners?collectDate=${encodeURIComponent(captureDate)}${ui.appliedQuery}`;
    const result = await adminApi(partnersUrl);
    if (isViewSection() && result.notApplied && !isHistoryViewMenu()) {
      state.appliedCollectDate = '';
      state.activePartnerId = '';
      state.partners = [];
      renderPartnerTabs([]);
      renderViewAppliedBanner(null);
      clearViewTablesNotApplied();
      updatePanelVisibility();
      return;
    }
    state.appliedCollectDate = isViewSection() ? (result.collectDate || '') : captureDate;
    if (!isViewSection() && result.collectDate && result.collectDate !== captureDate) {
      setBizCaptureDate(result.collectDate);
    }
    const partners = result.ok ? (result.partners || []) : [];
    const viewPartners = isViewSection() ? filterPartnersForView(partners) : partners;
    state.contamination = result.contamination || null;
    const nextCacheKey = buildCacheKey();
    if (state.dataCache.key && state.dataCache.key !== nextCacheKey) {
      invalidateDataCache();
    }
    renderPartnerTabs(viewPartners);
    renderContaminationBanner(state.contamination);
    if (isViewSection()) {
      renderViewAppliedBanner(state.config?.applied || null);
      updateWeekPickerVisibility();
      if (!hasRegisteredViewPartners()) {
        state.activePartnerId = '';
        clearViewTablesForMenu(state.activeMenu, '상단에서 DP 코드와 지역명을 등록하면 탭이 표시됩니다.');
        updatePanelVisibility();
        return;
      }
    }
    if (state.activePartnerId && !viewPartners.some(partner => normalizePartnerId(partner.partnerId) === normalizePartnerId(state.activePartnerId))) {
      state.activePartnerId = '';
    }
    if (!state.activePartnerId && viewPartners.length) {
      switchBaeminPartner(viewPartners[0].partnerId);
    } else if (!viewPartners.length) {
      updatePanelVisibility();
    }
  }

  function updateMenuTabBar() {
    const ui = tableUiConfig();
    const menuBar = $(ui.menuBarId);
    if (!menuBar) return;
    if (isViewSection()) {
      menuBar.hidden = false;
    } else {
      menuBar.hidden = !(Boolean(state.activePartnerId) && state.partners.length > 0);
    }
    menuBar.querySelectorAll('[data-baemin-menu]').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.baeminMenu === state.activeMenu);
    });
    updateWeekPickerVisibility();
  }

  function updatePanelVisibility() {
    const ui = tableUiConfig();
    const section = document.getElementById(ui.sectionRootId);
    if (!section) return;
    const hasPartner = isViewSection()
      ? getSelectedPartnerIds().length > 0
      : Boolean(normalizePartnerId(state.activePartnerId));
    section.querySelectorAll(`[${ui.panelAttr}]`).forEach(panel => {
      const menu = panel.getAttribute(ui.panelAttr);
      if (isViewSection()) {
        // 콜수·거절율 동기화는 전지역 작업 → 지역 미선택이어도 패널 표시
        const allowWithoutPartner = menu === 'calls_rejection_sync';
        panel.hidden = (!hasPartner && !allowWithoutPartner) || state.activeMenu !== menu;
        return;
      }
      panel.hidden = hasPartner
        ? state.activeMenu !== menu
        : menu !== 'delivery_status';
    });
    const partnerBar = $(ui.partnerBarId);
    if (partnerBar) {
      partnerBar.hidden = isViewSection()
        ? !state.partners.length
        : !state.partners.length;
    }
    updateMenuTabBar();
    updateWeekPickerVisibility();
  }

  function switchBaeminPartner(partnerId, options = {}) {
    const ui = tableUiConfig();
    const id = normalizePartnerId(partnerId);
    if (!id) return;

    if (isViewSection() && options.toggle) {
      const allowed = new Set((state.partners || []).map(p => normalizePartnerId(p.partnerId)).filter(Boolean));
      if (!allowed.has(id)) return;
      const set = new Set(getSelectedPartnerIds());
      if (set.has(id)) {
        if (set.size <= 1) {
          showToast('최소 1개 지역은 선택되어 있어야 합니다.');
          return;
        }
        set.delete(id);
      } else {
        set.add(id);
      }
      state.selectedPartnerIds = [...set];
      state.activePartnerId = id;
      $(ui.partnerBarId)?.querySelectorAll('[data-baemin-partner]').forEach(btn => {
        const btnId = normalizePartnerId(btn.dataset.baeminPartner);
        const on = set.has(btnId);
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      updatePanelVisibility();
      // 다중 선택 변경 시 현재 메뉴 캐시/합계만 다시 그림 (조회는 버튼으로)
      if (state.activeMenu === 'weekday_quota') {
        void ensureWeekdayQuotaLoaded().then(() => renderWeekdayQuotaEditor());
        renderGrandTotalsPanel('delivery_status', state.activePartnerId);
        return;
      }
      if (state.activeMenu === 'delivery_status' || state.activeMenu === 'quota_achievement') {
        renderActiveViewFromCacheMulti();
        return;
      }
      // 단건 메뉴는 마지막 클릭 지역 기준으로 표시
    }

    state.activePartnerId = id;
    if (isViewSection() && !options.toggle) {
      state.selectedPartnerIds = [id];
    }
    if (!state.activeMenu) state.activeMenu = 'delivery_status';
    $(ui.partnerBarId)?.querySelectorAll('[data-baemin-partner]').forEach(btn => {
      const btnId = normalizePartnerId(btn.dataset.baeminPartner);
      const on = isViewSection()
        ? getSelectedPartnerIds().includes(btnId)
        : btnId === id;
      btn.classList.toggle('is-active', on);
      if (isViewSection()) btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    updatePanelVisibility();
    // 지역 전환 시 세트수 행을 항상 선택 지역 기준으로 갱신(지역별 할당 달성). self-guard로 다른 메뉴에선 숨김.
    renderSetCountRow(id);

    if (state.activeMenu === 'weekday_quota') {
      void ensureWeekdayQuotaLoaded().then(() => renderWeekdayQuotaEditor());
      renderGrandTotalsPanel('delivery_status', id);
      return;
    }
    if (state.activeMenu === 'accept_rate_live') {
      const cachedAccept = getCachedPartnerBundle(id);
      if (cachedAccept?.meta?.acceptRateLoaded && Array.isArray(cachedAccept.accept_rate_live)) {
        renderAcceptRateLiveRows(id, cachedAccept.accept_rate_live, {
          pastLabel: cachedAccept.meta.acceptRatePastLabel,
          currentLabel: cachedAccept.meta.acceptRateCurrentLabel
        });
      } else {
        clearViewTablesForMenu('accept_rate_live', '수락율 조회를 눌러 주세요.');
      }
      renderGrandTotalsPanel('delivery_status', id);
      return;
    }
    if (state.activeMenu === 'calls_rejection_sync') {
      clearViewTablesForMenu('calls_rejection_sync', '콜수입력 / 거절율입력 / 모두입력 / 실시간 입력 버튼을 사용하세요.');
      renderGrandTotalsPanel('delivery_status', id);
      void loadSyncReflectionStatus({ silent: true });
      return;
    }

    const cached = getCachedPartnerBundle(id);
    if (cached) {
      renderSetCountRow(id);
      if (state.activeMenu === 'quota_achievement') {
        renderQuotaAchievementForSelection();
      } else if (state.activeMenu === 'rider_history') {
        if (cached.rider_history?.length && cached.meta?.riderLoaded) {
          renderRiderHistoryRiderRows(id, cached.rider_history, {
            fromDate: cached.meta.riderFromDate,
            toDate: cached.meta.riderToDate
          });
        } else {
          clearViewTablesForMenu('rider_history', '시작일·종료일을 선택하고 조회를 눌러 주세요.');
        }
      } else if (state.activeMenu === 'daily_history') {
        if (cached.daily_history?.length && cached.meta?.dailyLoaded) {
          renderSubtabRows('daily_history', id, cached.daily_history, cached.meta || {});
        } else {
          clearViewTablesForMenu('daily_history', '시작일·종료일을 선택하고 조회를 눌러 주세요.');
        }
      } else if (state.activeMenu === 'delivery_status') {
        renderDeliveryStatusForSelection();
      } else if (cached[state.activeMenu]?.length) {
        renderSubtabRows(state.activeMenu, id, cached[state.activeMenu], cached.meta || {});
      } else {
        clearViewTablesForMenu(state.activeMenu);
      }
      renderGrandTotalsPanel(state.activeMenu === 'quota_achievement' ? 'delivery_status' : state.activeMenu, id);
      return;
    }
    if (isViewSection() && state.viewLoaded) {
      renderActiveViewFromCache();
      return;
    }
    void loadPartnerBundle(id, state.activeMenu);
  }

  function switchBaeminMenu(menuId) {
    const menu = String(menuId || '').trim();
    if (!menu) return;

    if (isViewSection()) {
      if (!getSelectedPartnerIds().length && menu !== 'calls_rejection_sync') {
        showToast('지역을 먼저 선택하세요.');
        return;
      }
      state.activeMenu = menu;
      updatePanelVisibility();
      renderSetCountRow(state.activePartnerId);
      if (menu === 'calls_rejection_sync') {
        clearViewTablesForMenu(menu, '전지역 대상 · 콜수입력 / 거절율입력 / 모두입력 / 실시간 입력 버튼을 사용하세요.');
        renderGrandTotalsPanel('delivery_status', state.activePartnerId);
        void loadSyncReflectionStatus({ silent: true });
        return;
      }
      if (menu === 'quota_achievement') {
        renderQuotaAchievementForSelection();
        renderGrandTotalsPanelMulti();
        return;
      }
      if (menu === 'delivery_status') {
        renderDeliveryStatusForSelection();
        return;
      }
      if (state.activePartnerId) {
        const cached = getCachedPartnerBundle(state.activePartnerId);
        if (menu === 'weekday_quota') {
          void ensureWeekdayQuotaLoaded().then(() => renderWeekdayQuotaEditor());
          renderGrandTotalsPanel('delivery_status', state.activePartnerId);
        } else if (menu === 'accept_rate_live') {
          if (cached?.meta?.acceptRateLoaded && Array.isArray(cached.accept_rate_live)) {
            renderAcceptRateLiveRows(state.activePartnerId, cached.accept_rate_live, {
              pastLabel: cached.meta.acceptRatePastLabel,
              currentLabel: cached.meta.acceptRateCurrentLabel
            });
          } else {
            clearViewTablesForMenu(menu, '수락율 조회를 눌러 주세요.');
          }
          renderGrandTotalsPanel('delivery_status', state.activePartnerId);
        } else if (menu === 'rider_history') {
          if (cached?.rider_history?.length && cached.meta?.riderLoaded) {
            renderRiderHistoryRiderRows(state.activePartnerId, cached.rider_history, {
              fromDate: cached.meta.riderFromDate,
              toDate: cached.meta.riderToDate
            });
          } else {
            clearViewTablesForMenu(menu, '시작일·종료일을 선택하고 조회를 눌러 주세요.');
          }
          renderGrandTotalsPanel('delivery_status', state.activePartnerId);
        } else if (menu === 'daily_history') {
          if (cached?.daily_history?.length && cached.meta?.dailyLoaded) {
            renderSubtabRows(menu, state.activePartnerId, cached.daily_history, cached.meta || {});
          } else {
            clearViewTablesForMenu(menu, '시작일·종료일을 선택하고 조회를 눌러 주세요.');
          }
          renderGrandTotalsPanel(menu, state.activePartnerId);
        } else if (cached?.[menu]) {
          renderSubtabRows(menu, state.activePartnerId, cached[menu], cached.meta || {});
          renderGrandTotalsPanel(menu, state.activePartnerId);
        } else {
          clearViewTablesForMenu(menu);
          renderGrandTotalsPanel(menu, state.activePartnerId);
        }
      } else {
        clearViewTablesForMenu(menu);
        renderGrandTotalsPanel(menu, '');
      }
      return;
    }

    if (!state.activePartnerId) return;
    state.activeMenu = menu;
    updatePanelVisibility();

    if (!isViewSection() && menu === 'rider_history') {
      renderBizRiderHistoryPlaceholder();
      return;
    }

    const cached = getCachedPartnerBundle(state.activePartnerId);
    if (cached?.[menu]) {
      renderSubtabRows(menu, state.activePartnerId, cached[menu], cached.meta || {});
      return;
    }
    void loadPartnerBundle(state.activePartnerId, menu);
  }

  function clearViewTablesForMenu(menuId, message) {
    const ui = tableUiConfig();
    const menu = String(menuId || '').trim();
    const rowsId = ui.rowsMap[menu];
    const summaryId = ui.summaryMap[menu];
    const summaryEl = $(summaryId);
    const rowsEl = $(rowsId);
    const text = message || ui.emptyMessage;
    if (summaryEl) {
      summaryEl.textContent = menu === 'quota_achievement'
        ? `${formatViewWeekRangeLabel(ensureViewWeekStart())} · 데이터 없음`
        : (menu === 'weekday_quota'
          ? '요일별 1세트 할당을 입력하세요'
          : (menu === 'accept_rate_live'
            ? '수락율 조회를 눌러 주세요'
            : (menu === 'calls_rejection_sync'
              ? '전지역 · 아래 반영여부 확인 후 동기화'
              : (menu === 'rider_history' || menu === 'daily_history'
                ? '시작일·종료일을 선택하고 조회를 눌러 주세요'
                : (menu === 'delivery_status'
                  ? '배달현황 조회를 눌러 주세요'
                  : '데이터 없음')))));
    }
    if (rowsEl) {
      const colspan = menu === 'quota_achievement'
        ? 6
        : (menu === 'weekday_quota'
          ? 8
          : (menu === 'accept_rate_live'
            ? 13
            : (menu === 'calls_rejection_sync'
              ? 7
              : (menu === 'rider_history' && isViewSection()
                ? 10
                : getBaeminTableColspan(menu, { showPartner: false, includeCollected: false })))));
      rowsEl.innerHTML = `<tr><td colspan="${colspan}" class="form-help">${text}</td></tr>`;
    }
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString('ko-KR');
  }

  const BAEMIN_SERVICE_METRICS = [
    {
      fields: ['foodReject', 'bmartReject', 'storeReject', 'totalReject'],
      totalKeys: ['totalReject', 'rejectTotal']
    },
    {
      fields: ['foodCancel', 'bmartCancel', 'storeCancel', 'cancelCount'],
      totalKeys: ['cancelCount', 'totalCancel', 'cancelTotal']
    },
    {
      fields: ['foodRiderFault', 'bmartRiderFault', 'storeRiderFault', 'riderFault'],
      totalKeys: ['riderFault', 'totalRiderFault']
    }
  ];

  const BAEMIN_TABLE_LAYOUTS = {
    delivery_status: {
      leading: ['협력사', '라이더', '운행상태', '배민ID', '연락처'],
      trailing: ['아침점심', '오후', '저녁', '심야']
    },
    daily_history: {
      leading: ['협력사', '배달일'],
      trailing: ['아침점심', '오후', '저녁', '심야']
    },
    rider_history: {
      leading: ['협력사', '라이더', '배민ID', '연락처'],
      trailing: ['아침점심', '오후', '저녁', '심야']
    }
  };

  const BAEMIN_METRIC_GROUP_LABELS = ['거절', '배차취소', '배달취소(라이더귀책)'];
  const BAEMIN_METRIC_SUB_LABELS = ['푸드', '비마트', '스토어', '합계'];

  function metricValue(parsed, field, totalKeys = []) {
    const p = parsed || {};
    if (field.startsWith('total') || field === 'cancelCount' || field === 'riderFault') {
      for (const key of [field, ...totalKeys]) {
        if (p[key] != null && p[key] !== '') return Number(p[key]) || 0;
      }
      return 0;
    }
    return Number(p[field] ?? 0) || 0;
  }

  function formatServiceBreakdownCells(parsed) {
    return BAEMIN_SERVICE_METRICS.map(metric => metric.fields.map((field, index) => {
      const isTotal = index === 3;
      const value = isTotal
        ? metricValue(parsed, field, metric.totalKeys)
        : metricValue(parsed, field);
      return `<td class="baemin-metric-cell${isTotal ? ' baemin-metric-cell--total' : ''}">${formatNumber(value)}</td>`;
    }).join('')).join('');
  }

  function getBaeminTableColspan(menu, { showPartner = false, includeCollected = true } = {}) {
    const layout = BAEMIN_TABLE_LAYOUTS[menu] || BAEMIN_TABLE_LAYOUTS.delivery_status;
    let leading = layout.leading.length;
    if (!showPartner) leading -= 1;
    return leading + 1 + (BAEMIN_METRIC_GROUP_LABELS.length * BAEMIN_METRIC_SUB_LABELS.length)
      + layout.trailing.length + (includeCollected ? 1 : 0);
  }

  function buildBaeminTableHeadHtml(menu, { showPartner = true, includeCollected = true } = {}) {
    const layout = BAEMIN_TABLE_LAYOUTS[menu] || BAEMIN_TABLE_LAYOUTS.delivery_status;
    const leading = showPartner ? layout.leading : layout.leading.slice(1);
    const row1 = [
      ...leading.map(label => `<th rowspan="2">${label}</th>`),
      '<th rowspan="2">완료</th>',
      ...BAEMIN_METRIC_GROUP_LABELS.map(label => `<th colspan="4" class="baemin-metric-group">${label}</th>`),
      ...layout.trailing.map(label => `<th rowspan="2">${label}</th>`)
    ];
    if (includeCollected) row1.push('<th rowspan="2">수집 시각</th>');
    const row2 = BAEMIN_METRIC_GROUP_LABELS.flatMap(() => BAEMIN_METRIC_SUB_LABELS
      .map(label => `<th class="baemin-metric-sub">${label}</th>`));
    return `<tr>${row1.join('')}</tr><tr>${row2.join('')}</tr>`;
  }

  function initBaeminServiceBreakdownTables() {
    const tableMap = [
      { tbodyId: 'baeminBizDeliveryStatusRows', menu: 'delivery_status', collected: true },
      { tbodyId: 'baeminBizDailyHistoryRows', menu: 'daily_history', collected: true },
      { tbodyId: 'baeminBizRiderHistoryRows', menu: 'rider_history', collected: true },
      { tbodyId: 'baeminStatusDeliveryStatusRows', menu: 'delivery_status', collected: false },
      { tbodyId: 'baeminStatusDailyHistoryRows', menu: 'daily_history', collected: false },
      { tbodyId: 'baeminStatusRiderHistoryRows', menu: 'rider_history', collected: false }
    ];
    tableMap.forEach(({ tbodyId, menu, collected }) => {
      const tbody = $(tbodyId);
      const thead = tbody?.closest('table')?.querySelector('thead');
      if (!thead) return;
      thead.innerHTML = buildBaeminTableHeadHtml(menu, { showPartner: false, includeCollected: collected });
    });
  }

  function formatDateTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  }

  function formatStatusLabel(status) {
    if (status === 'success') return '성공';
    if (status === 'failed') return '실패';
    return '-';
  }

  function setLoading(loading) {
    state.loading = loading;
    updateActionButtons();
  }

  function setCollecting(collecting) {
    state.collecting = collecting;
    updateActionButtons();
  }

  function updateActionButtons() {
    const fullBtn = $('baeminFullCollectBtn');
    const deliveryOnlyBtn = $('baeminDeliveryOnlyCollectBtn');
    const dailyCollectBtn = $('baeminDailyCollectBtn');
    const riderCollectBtn = $('baeminRiderCollectBtn');
    const browserBtn = $('baeminBrowserOpenBtn');
    const shutdownBtn = $('baeminServerShutdownBtn');
    const jsonBtn = $('baeminDeliveryJsonPasteBtn');
    const sessionBtn = $('baeminDeliverySessionRefreshBtn');
    const applyBtn = $('baeminDeliveryApplyBtn');
    const loopStartBtn = $('baeminStatusAutoLoopStartBtn');
    const loopStopBtn = $('baeminStatusAutoLoopStopBtn');
    const riderLiveSyncBtn = $('baeminRiderLiveSyncBtn');
    const loopActive = Boolean(state.statusAutoLoop?.active);
    const riderSyncing = Boolean(state.riderLiveSyncRunning);
    const localCollecting = Boolean(state.localAutoCollect?.collectRunning || state.collecting || loopActive || riderSyncing);

    if (fullBtn) {
      fullBtn.disabled = state.loading || localCollecting || !state.localServerRunning;
      fullBtn.textContent = localCollecting ? '이미 수집 중…' : '배민 전체 데이터 수집';
    }
    if (deliveryOnlyBtn) {
      deliveryOnlyBtn.disabled = state.loading || localCollecting || !state.localServerRunning;
      deliveryOnlyBtn.textContent = localCollecting ? '이미 수집 중…' : '배달현황만 수집';
    }
    if (dailyCollectBtn) {
      dailyCollectBtn.disabled = state.loading || localCollecting || !state.localServerRunning;
      dailyCollectBtn.textContent = localCollecting ? '수집 중…' : '일별 배달내역 수집';
    }
    if (riderCollectBtn) {
      riderCollectBtn.disabled = state.loading || localCollecting || !state.localServerRunning;
      riderCollectBtn.textContent = localCollecting ? '수집 중…' : '라이더별 배달내역 수집';
    }
    if (browserBtn) {
      browserBtn.disabled = state.loading || localCollecting || !state.localServerRunning;
    }
    if (shutdownBtn) {
      shutdownBtn.disabled = state.loading || localCollecting || !state.localServerRunning;
    }
    if (jsonBtn) jsonBtn.disabled = state.loading || localCollecting;
    if (sessionBtn) {
      sessionBtn.disabled = false;
      sessionBtn.textContent = state.sessionRefreshing ? '갱신 준비 중…' : '배민 세션 갱신';
    }
    if (applyBtn) {
      applyBtn.disabled = state.loading || state.applying || localCollecting || !state.localServerRunning;
    }
    if (loopStartBtn) {
      loopStartBtn.disabled = state.loading || loopActive || riderSyncing || !state.localServerRunning;
      loopStartBtn.textContent = loopActive ? '자동수집 진행 중…' : '배민현황 자동수집 시작';
    }
    if (loopStopBtn) {
      loopStopBtn.disabled = !loopActive;
    }
    if (riderLiveSyncBtn) {
      riderLiveSyncBtn.disabled = state.loading || loopActive || riderSyncing || !state.localServerRunning;
      riderLiveSyncBtn.textContent = riderSyncing ? '기사앱 반영 중…' : '기사앱 실시간 반영 (1회)';
    }
  }

  function isSessionExpired(config) {
    const authState = state.localSession?.authState || state.localAuthState;
    if (authState === 'recovering') return false;
    if (authState === 'authRequired') return true;
    if (authState === 'ok') return false;
    if (state.localSession?.state === 'ok' && !state.localSession?.paused) return false;
    if (state.localBrowser?.browserOpen && state.localBrowser?.sessionLoggedIn) return false;
    return Boolean(config?.sessionLastError || config?.autoCollect?.sessionExpired || config?.autoCollect?.sessionPaused);
  }

  function renderSessionStatus(config) {
    const el = $('baeminDeliverySessionStatus');
    if (!el) return;

    const authState = state.localSession?.authState || state.localAuthState || '';
    const authLabel = state.localSession?.authStateLabel
      || (authState === 'ok' ? '정상' : (authState === 'recovering' ? '복구 중' : (authState === 'authRequired' ? '로그인 필요' : '')));
    const authReason = state.localSession?.authRequiredReason || '';

    if (authState === 'recovering') {
      el.className = 'baemin-session-status baemin-session-status--warn';
      el.innerHTML = `<strong>세션 복구 중</strong> — ${escapeHtml(authReason || '로그인/휴대폰 인증 대기')}`;
      return;
    }

    if (isSessionExpired(config) || authState === 'authRequired') {
      el.className = 'baemin-session-status baemin-session-status--error';
      const message = authReason || config?.sessionLastError || config?.autoCollect?.lastError || '배민 로그인 만료';
      el.innerHTML = `<strong>${escapeHtml(authLabel || '세션 만료')} — 배민 세션 갱신/휴대폰 인증 필요</strong> — ${escapeHtml(message)} · <button type="button" class="link-btn" id="baeminSessionRefreshInlineBtn">세션 갱신</button>`;
      $('baeminSessionRefreshInlineBtn')?.addEventListener('click', () => void startSessionRefresh());
      return;
    }

    if (config?.sessionConfigured || authState === 'ok') {
      el.className = 'baemin-session-status baemin-session-status--ok';
      el.innerHTML = `
        <strong>배민 세션 연결됨${authLabel ? ` · ${escapeHtml(authLabel)}` : ''}</strong>
        · 갱신: ${formatDateTime(config.sessionUpdatedAt)}
        · 확인: ${formatDateTime(config.sessionLastValidatedAt)}
      `;
      return;
    }

    el.className = 'baemin-session-status baemin-session-status--warn';
    el.innerHTML = '<strong>배민 세션 없음</strong> — [배민 세션 갱신]으로 로그인하세요.';
  }

  function renderAutoCollectStatus(config) {
    const el = $('baeminDeliveryAutoCollectStatus');
    if (!el) return;

    const auto = config?.autoCollect || {};
    const local = state.localAutoCollect || {};
    const browser = state.localBrowser || {};
    const session = state.localSession || {};
    const localRunning = state.localServerRunning || auto.localServerRecentlyActive;
    const sessionExpired = isSessionExpired(config)
      || session.state === 'expired'
      || Boolean(local.sessionPaused);
    const localCollecting = Boolean(local.collectRunning || state.collecting);
    const collectProgress = state.localCollectProgress || local.collectProgress || {};
    const showProgress = localCollecting;
    const progressPercent = localCollecting
      ? Math.max(1, Math.min(100, Number(collectProgress.percent) || 0))
      : 0;
    const progressMessage = collectProgress.message || '수집 중…';
    const scheduleText = (auto.schedule || local.schedule || ['10:00', '14:00', '17:00', '20:00', '23:30']).join(', ');
    const lastCollect = local.lastCollectResult || {};

    el.className = sessionExpired
      ? 'baemin-auto-collect-panel baemin-auto-collect-panel--paused'
      : 'baemin-auto-collect-panel';

    const lastRunAt = local.lastRunAt || auto.lastRunAt;
    const lastStatus = local.lastStatus || auto.lastStatus;
    const lastError = local.lastError || auto.lastError;

    const lastRunSummary = lastStatus === 'success'
      ? `${formatStatusLabel(lastStatus)} · ${formatNumber(local.lastSavedCount || auto.lastSavedCount || lastCollect.savedTotal || 0)}건`
      : (lastStatus === 'failed'
        ? `${formatStatusLabel(lastStatus)}${lastError ? ` — ${lastError}` : ''}`
        : (lastCollect.message || '-'));

    const sessionStateLabel = sessionExpired
      ? '만료 — 갱신 필요'
      : (session.state === 'ok' || config?.sessionConfigured ? '정상' : '없음');

    el.innerHTML = `
      <strong>로컬 자동수집 서버</strong>
      <dl class="baemin-auto-collect-grid">
        <div>
          <dt>로컬 서버</dt>
          <dd>${localRunning ? '실행 중' : '중지됨'}</dd>
        </div>
        <div>
          <dt>Playwright 브라우저</dt>
          <dd>${browser.browserOpen ? '유지 중' : '닫힘/미실행'}</dd>
        </div>
        <div>
          <dt>세션 상태</dt>
          <dd>${sessionStateLabel}</dd>
        </div>
        <div>
          <dt>현재 수집 중</dt>
          <dd>${localCollecting
            ? (showProgress
              ? `${progressPercent}% · ${escapeHtml(progressMessage)}`
              : '예 — 수집 진행 중')
            : '아니오'}</dd>
        </div>
        <div>
          <dt>마지막 수집</dt>
          <dd>${formatDateTime(lastRunAt || lastCollect.at)}</dd>
        </div>
        <div>
          <dt>마지막 결과</dt>
          <dd>${lastRunSummary}</dd>
        </div>
        <div>
          <dt>다음 자동 수집</dt>
          <dd>${localRunning && !sessionExpired ? formatDateTime(local.nextScheduledAt || auto.nextScheduledAt) : '-'}</dd>
        </div>
        <div>
          <dt>브라우저 URL</dt>
          <dd style="word-break:break-all;font-size:0.82rem">${browser.currentUrl || '-'}</dd>
        </div>
      </dl>
      ${showProgress ? `
      <div class="baemin-collect-progress" role="progressbar" aria-valuenow="${progressPercent}" aria-valuemin="0" aria-valuemax="100">
        <div class="baemin-collect-progress__track">
          <div class="baemin-collect-progress__bar" style="width:${progressPercent}%"></div>
        </div>
        <p class="baemin-collect-progress__meta">
          <strong>${progressPercent}%</strong>
          · ${escapeHtml(progressMessage)}
          · 저장 ${formatNumber(collectProgress.savedSoFar || 0)}건
        </p>
      </div>
      ` : ''}
      <p class="baemin-auto-collect-schedule">스케줄(KST): ${scheduleText} · PC에서 <code>npm run baemin:session-server</code> 실행 · 수집 후에도 브라우저 유지</p>
    `;

    updateActionButtons();
  }

  function renderMenuDatePlan(menuDatePlan) {
    if (!menuDatePlan) return '';
    const rows = [
      ['배달현황', menuDatePlan.delivery_status?.label || '오늘 기준'],
      ['일별 배달내역', menuDatePlan.daily_history?.label || '-'],
      ['라이더별 배달내역', menuDatePlan.rider_history?.label || '-']
    ];
    return `
      <ul class="baemin-collect-stats baemin-collect-date-plan">
        ${rows.map(([label, range]) => `<li>${label}: <strong>${range}</strong></li>`).join('')}
      </ul>
    `;
  }

  function renderMenuCollectStatus(config) {
    const el = $('baeminDeliveryMenuCollectStatus');
    if (!el) return;

    const menus = config?.menuStatus || config?.autoCollect?.menuStatus || [];
    const menuDatePlan = config?.autoCollect?.menuDatePlan || config?.menuDatePlan || null;
    if (!menus.length) {
      el.innerHTML = `<strong>메뉴별 수집</strong>${renderMenuDatePlan(menuDatePlan)}<p class="form-help">아직 수집 기록이 없습니다.</p>`;
      return;
    }

    const rows = menus.map(menu => {
      const statusClass = menu.lastStatus === 'success'
        ? 'baemin-menu-collect-status--success'
        : (menu.lastStatus === 'failed' ? 'baemin-menu-collect-status--failed' : 'baemin-menu-collect-status--idle');
      const statusLabel = menu.lastStatus === 'success'
        ? '성공'
        : (menu.lastStatus === 'failed' ? '실패' : '-');
      const errorText = menu.lastStatus === 'failed' && menu.lastError
        ? `<br><span style="font-size:0.8rem">${menu.lastError}</span>`
        : '';
      return `
        <tr>
          <td>${menu.label || menu.id}</td>
          <td>${menu.dateRangeLabel || '-'}</td>
          <td>${formatDateTime(menu.lastCollectedAt)}</td>
          <td class="${statusClass}">${statusLabel}${errorText}</td>
          <td>${formatNumber(menu.rowCount || 0)}</td>
        </tr>
      `;
    }).join('');

    el.innerHTML = `
      <strong>메뉴별 수집 상태</strong>
      ${renderMenuDatePlan(menuDatePlan)}
      <p class="form-help">배달현황=오늘 기준 · 일별/라이더=어제가 속한 정산주 수요일~어제 (오늘 데이터 미제공 · 수요일엔 지난 정산주 7일 마감)</p>
      <table class="baemin-menu-collect-table">
        <thead>
          <tr>
            <th>수집 대상</th>
            <th>수집 기간</th>
            <th>마지막 수집</th>
            <th>결과</th>
            <th>저장 건수</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  function renderAppliedStatus(config) {
    const el = $('baeminDeliveryAppliedStatus');
    const applyBtn = $('baeminDeliveryApplyBtn');
    if (!el) return;

    const applied = config?.applied;
    if (!applied?.collectDate) {
      el.className = 'baemin-applied-status baemin-applied-status--warn';
      el.innerHTML = '<strong>아직 배민현황 저장 데이터 없음</strong> — 수집 미리보기 확인 후 [배민현황 저장]을 누르면 DP 코드 기준으로 Supabase에 저장됩니다.';
      if (applyBtn) {
        applyBtn.disabled = state.loading || state.applying || Boolean(state.statusAutoLoop?.active);
      }
      return;
    }

    el.className = 'baemin-applied-status baemin-applied-status--ok';
    el.innerHTML = `
      <strong>배민현황 저장됨 (Supabase · DP코드 기준)</strong>
      · 기준일 ${applied.collectDate}
      · ${formatNumber(applied.savedCount || applied.itemCount || 0)}건
      · 저장 ${formatDateTime(applied.appliedAt)}
    `;
    if (applyBtn) {
      applyBtn.disabled = state.loading || state.applying || Boolean(state.statusAutoLoop?.active);
    }
  }

  function renderDeliveryStatusMeta(applied) {
    const meta = $('baeminStatusDeliveryMeta');
    if (!meta || !isViewSection()) return;

    const data = applied || state.config?.applied;
    if (!data?.collectDate) {
      meta.hidden = true;
      meta.innerHTML = '';
      return;
    }

    const partnerNames = state.partners.map(partner => partnerDisplayLabel(partner)).filter(Boolean);
    const activePartner = state.partners.find(partner => normalizePartnerId(partner.partnerId) === normalizePartnerId(state.activePartnerId));
    const partnerLabel = activePartner ? partnerDisplayLabel(activePartner) : (partnerNames.length ? partnerNames.join(', ') : '-');
    const partnerDp = activePartner ? normalizePartnerId(activePartner.partnerId) : '';

    meta.hidden = false;
    meta.innerHTML = `
      <div class="baemin-view-meta__item">
        <span class="baemin-view-meta__label">지역</span>
        <span class="baemin-view-meta__value baemin-view-meta__value--accent">${escapeHtml(partnerLabel)}</span>
      </div>
      ${partnerDp ? `<div class="baemin-view-meta__item">
        <span class="baemin-view-meta__label">DP 코드</span>
        <span class="baemin-view-meta__value">${escapeHtml(partnerDp)}</span>
      </div>` : ''}
      <div class="baemin-view-meta__item">
        <span class="baemin-view-meta__label">저장일시</span>
        <span class="baemin-view-meta__value">${formatDateTime(data.appliedAt)}</span>
      </div>
      <div class="baemin-view-meta__item">
        <span class="baemin-view-meta__label">수집일시</span>
        <span class="baemin-view-meta__value">${formatDateTime(data.collectedAt)}</span>
      </div>
    `;
  }

  function formatStorageMenuCounts(byMenu = {}) {
    const rider = Number(byMenu.rider_history || 0);
    const daily = Number(byMenu.daily_history || 0);
    const status = Number(byMenu.delivery_status || 0);
    return `현황 ${formatNumber(status)} · 일별 ${formatNumber(daily)} · 라이더 ${formatNumber(rider)}`;
  }

  function renderStorageDiagnostics(config = {}) {
    const diagnostics = config?.storageDiagnostics;
    const bizEl = $('baeminStorageDiagnostics');
    if (!bizEl) return;

    if (!diagnostics?.ok) {
      bizEl.hidden = true;
      bizEl.innerHTML = '';
      return;
    }

    const bizLine = formatStorageMenuCounts(diagnostics.biz?.byMenu);
    const appliedLine = formatStorageMenuCounts(diagnostics.appliedSnapshot?.byMenu);
    const riderRange = diagnostics.appliedSnapshot?.riderBusinessRange;
    const rangeText = riderRange?.from && riderRange?.to
      ? ` · 배달일 ${riderRange.from} ~ ${riderRange.to}`
      : '';
    const issue = diagnostics.issues?.[0];
    const collectDates = Object.keys(diagnostics.biz?.byCollectDate || {}).sort().reverse().slice(0, 3);
    const dateHint = collectDates.length
      ? `<div class="form-help">BIZ 수집일: ${collectDates.map(date => {
        const row = diagnostics.biz.byCollectDate[date];
        const rider = Number(row?.byMenu?.rider_history || 0);
        return `${date}(라이더 ${formatNumber(rider)})`;
      }).join(' · ')}</div>`
      : '';

    bizEl.hidden = false;
    bizEl.className = issue
      ? 'baemin-applied-status baemin-applied-status--warn baemin-storage-diagnostics-wrap'
      : 'baemin-applied-status baemin-applied-status--ok baemin-storage-diagnostics-wrap';
    bizEl.innerHTML = `
      <strong>Supabase 저장 현황</strong>
      <div>BIZ 수집 — ${bizLine}</div>
      <div>배민현황 저장 — ${appliedLine}${rangeText}</div>
      ${dateHint}
      ${issue ? `<div class="form-help form-help--warn">${escapeHtml(issue.message)}</div>` : ''}
    `;
  }

  function renderViewAppliedBanner(applied) {
    const banner = $('baeminStatusAppliedBanner');
    if (!banner) return;

    const data = applied || state.config?.applied;
    const diagnostics = state.config?.storageDiagnostics;
    if (!data?.collectDate) {
      banner.hidden = false;
      banner.className = 'baemin-view-status-badge baemin-view-status-badge--warn';
      const issue = diagnostics?.issues?.find(item => item.code === 'NOT_APPLIED')
        || diagnostics?.issues?.[0];
      banner.innerHTML = issue
        ? escapeHtml(issue.message)
        : '저장 데이터 없음 — BIZ에서 [배민현황 저장]을 먼저 실행하세요.';
      renderDeliveryStatusMeta(null);
      return;
    }

    const riderCount = Number(diagnostics?.appliedSnapshot?.byMenu?.rider_history || data.savedCount || 0);
    const riderRange = diagnostics?.appliedSnapshot?.riderBusinessRange;
    const rangeText = riderRange?.from && riderRange?.to
      ? ` · 배달일 ${riderRange.from}~${riderRange.to}`
      : '';
    const issue = diagnostics?.issues?.[0];

    banner.hidden = false;
    banner.className = issue
      ? 'baemin-view-status-badge baemin-view-status-badge--warn'
      : 'baemin-view-status-badge baemin-view-status-badge--ok';
    banner.innerHTML = issue
      ? `${escapeHtml(issue.message)}<br><span class="form-help">저장 라이더 ${formatNumber(riderCount)}건${rangeText}</span>`
      : `Supabase 저장 · 라이더 ${formatNumber(riderCount)}건${rangeText}`;
    renderDeliveryStatusMeta(data);
  }

  function renderConfig(config) {
    state.config = config;
    const hint = $('baeminDeliveryConfigHint');
    if (hint) {
      renderSessionStatus(config);
      renderAutoCollectStatus(config);
      renderMenuCollectStatus(config);

      const missingLegacy = !config?.tableExists;
      const missingBiz = config?.bizCollectTableExists === false;

      if (missingLegacy || missingBiz) {
        hint.textContent = 'Supabase 테이블이 없습니다. supabase/baemin_all_migrations.sql 내용 전체를 SQL Editor에 붙여넣고 Run 하세요.';
        hint.className = 'form-help form-help--warn';
      } else {
        hint.textContent = '자동 수집은 PC 로컬 세션 서버가 켜져 있을 때만 동작합니다. 세션은 Supabase settings에 저장됩니다.';
        hint.className = 'form-help';
      }
    }

    renderAppliedStatus(config);
    renderStorageDiagnostics(config);
    syncDailyCollectRangeInputs(config?.dailyCollectRange || state.dailyCollectRange || null);
    syncRiderCollectRangeInputs(config?.riderCollectRange || state.riderCollectRange || null);
    initCoverageWeekDefaults();
    if (isViewSection()) {
      renderViewAppliedBanner(config?.applied);
    }
  }

  function todayKstDate() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  }

  function renderSummary(result, errorMessage) {
    const box = $('baeminDeliveryCollectResult');
    if (!box) return;

    if (errorMessage) {
      box.hidden = false;
      box.className = 'baemin-collect-result baemin-collect-result--error';
      box.innerHTML = `<strong>수집 실패</strong><p>${errorMessage}</p>`;
      return;
    }

    if (!result) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }

    const savedCount = Number(result.savedCount || 0);
    if (savedCount <= 0) {
      box.hidden = false;
      box.className = 'baemin-collect-result baemin-collect-result--error';
      box.innerHTML = `
        <strong>저장된 데이터 없음</strong>
        <p>수집 API는 호출됐지만 Supabase에 저장된 건수가 0입니다.</p>
        <ul class="baemin-collect-stats">
          <li>1) Supabase SQL Editor에서 <code>baemin_all_migrations.sql</code> 실행</li>
          <li>2) [배민 세션 갱신] 후 세션 연결됨 확인</li>
          <li>3) 수집 날짜를 <strong>오늘(KST)</strong>로 맞추기</li>
        </ul>
        ${renderMenuResultsList(result.menuResults || result.results)}
      `;
      return;
    }

    box.hidden = false;
    box.className = 'baemin-collect-result baemin-collect-result--success';
    const totals = result.summaryTotals || {};
    const riderDayResults = extractRiderDayResultsFromMenuResults(result.menuResults);
    if (riderDayResults.length) {
      renderRiderCollectDaysPanel({ dayResults: riderDayResults });
    }
    box.innerHTML = `
      <strong>수집 완료</strong>
      ${renderMenuDatePlan(result.menuDateRanges || result.menuDatePlan)}
      <ul class="baemin-collect-stats">
        <li>수집 기준일: <strong>${result.captureDate || '-'}</strong></li>
        <li>수집일수(일별/라이더): <strong>${formatNumber(totals.dayCount || result.dateRange?.dayCount || 0)}</strong></li>
        <li>라이더수: <strong>${formatNumber(totals.riderCount || 0)}</strong></li>
        <li>총 저장 건수: <strong>${formatNumber(result.savedCount)}</strong></li>
        <li>완료합계: <strong>${formatNumber(totals.completeTotal || result.totalCompleteSum || 0)}</strong></li>
        <li>거절합계: <strong>${formatNumber(totals.rejectTotal || 0)}</strong></li>
        <li>배차취소합계: <strong>${formatNumber(totals.cancelTotal || 0)}</strong></li>
      </ul>
      ${renderMenuResultsList(result.menuResults)}
      ${riderDayResults.length ? `
        <p class="form-help" style="margin-top:10px">라이더별 날짜 결과는 아래 <strong>라이더별 배달내역 수집결과</strong>를 확인하세요.</p>
      ` : ''}
    `;
  }

  function renderMenuResultsList(menuResults) {
    if (!menuResults || typeof menuResults !== 'object') return '';
    const items = Object.entries(menuResults).map(([id, row]) => {
      const label = row.label || id;
      const range = row.dateRangeLabel ? ` · ${row.dateRangeLabel}` : '';
      const status = row.ok ? '성공' : '실패';
      const detail = row.ok
        ? `${formatNumber(row.savedCount || 0)}건`
        : (row.message || row.error || '실패');
      return `<li>${label}${range}: <strong>${status}</strong> (${detail})</li>`;
    });
    if (!items.length) return '';
    return `<ul class="baemin-collect-stats">${items.join('')}</ul>`;
  }

  function extractRiderDayResultsFromMenuResults(menuResults) {
    if (!menuResults || typeof menuResults !== 'object') return [];
    const byDate = new Map();
    Object.entries(menuResults).forEach(([id, row]) => {
      const menuId = String(id || '').includes(':')
        ? String(id).split(':').pop()
        : String(id || '');
      if (menuId !== 'rider_history') return;
      const days = Array.isArray(row?.dayResults)
        ? row.dayResults
        : (Array.isArray(row?.meta?.dayResults) ? row.meta.dayResults : []);
      days.forEach(day => {
        const date = String(day?.date || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
        const prev = byDate.get(date) || { date, status: 'missing', savedCount: 0, message: '' };
        const status = String(day.status || '').trim();
        prev.savedCount += Number(day.savedCount || 0);
        if (status === 'ok' || (prev.status !== 'ok' && status === 'empty')) prev.status = status;
        else if (prev.status === 'missing' && status) prev.status = status;
        else if (status === 'failed' && prev.status !== 'ok') prev.status = 'failed';
        if (day.message) prev.message = day.message;
        byDate.set(date, prev);
      });
    });
    return [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }

  function coverageEls(menu) {
    if (menu === 'daily_history') {
      return {
        weekStart: 'baeminDailyCoverageWeekStart',
        weekLabel: 'baeminDailyCoverageWeekLabel',
        weekRange: 'baeminDailyCoverageWeekRangeLabel',
        loadBtn: 'baeminDailyCoverageLoadBtn',
        missingOnly: 'baeminDailyCoverageMissingOnly',
        result: 'baeminDailyCollectDaysResult'
      };
    }
    return {
      weekStart: 'baeminRiderCoverageWeekStart',
      weekLabel: 'baeminRiderCoverageWeekLabel',
      weekRange: 'baeminRiderCoverageWeekRangeLabel',
      loadBtn: 'baeminRiderCoverageLoadBtn',
      missingOnly: 'baeminRiderCoverageMissingOnly',
      result: 'baeminRiderCollectDaysResult'
    };
  }

  function syncCoverageWeekUi(menu, weekStart) {
    const ids = coverageEls(menu);
    const wed = settlementWednesdayOf(weekStart || todayKstDate());
    const weekEnd = addDaysDate(wed, 6);
    setEnhancedDateInput(ids.weekStart, wed);
    const label = $(ids.weekLabel);
    const range = $(ids.weekRange);
    if (label) label.textContent = wed;
    if (range) range.textContent = `${wed} ~ ${weekEnd}`;
    return { weekStart: wed, weekEnd };
  }

  function handleCoverageWeekSelect(menu, value) {
    syncCoverageWeekUi(menu, value);
  }

  function renderCoverageTable(menu, result, options = {}) {
    const ids = coverageEls(menu);
    const el = $(ids.result);
    if (!el) return;

    if (!result?.ok) {
      el.innerHTML = `<p class="form-help form-help--warn">${escapeHtml(result?.message || '조회 실패')}</p>`;
      return;
    }

    const missingOnly = options.missingOnly
      ?? Boolean($(ids.missingOnly)?.checked);
    let rows = Array.isArray(result.rows) ? result.rows.slice() : [];
    if (missingOnly) rows = rows.filter(row => row.status === 'missing');

    // 날짜 → 지역 순
    rows.sort((a, b) => {
      const dateDiff = String(a.date).localeCompare(String(b.date));
      if (dateDiff) return dateDiff;
      return String(a.displayName || a.partnerId).localeCompare(String(b.displayName || b.partnerId), 'ko');
    });

    const missingCount = (result.rows || []).filter(row => row.status === 'missing').length;
    const okCount = (result.rows || []).filter(row => row.status === 'ok').length;

    if (!rows.length) {
      el.innerHTML = `
        <p class="form-help">
          ${missingOnly ? '미수집 항목이 없습니다. 전부 반영완료입니다.' : '표시할 행이 없습니다.'}
        </p>
        <p class="baemin-rider-day-results__meta">
          기간 ${escapeHtml(result.fromDate)} ~ ${escapeHtml(result.toDate)}
          · 반영완료 ${formatNumber(okCount)}
          · 미수집 ${formatNumber(missingCount)}
        </p>
      `;
      return;
    }

    el.innerHTML = `
      <div class="baemin-coverage-table-wrap">
        <table class="baemin-coverage-table">
          <thead>
            <tr>
              <th>날짜</th>
              <th>지역</th>
              <th>결과</th>
              <th>건수</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(row => `
              <tr class="${row.status === 'ok' ? 'is-ok' : (row.status === 'missing' ? 'is-missing' : '')}">
                <td>${escapeHtml(row.date)}</td>
                <td>${escapeHtml(row.displayName || row.regionName || row.partnerId)}</td>
                <td class="${row.status === 'ok' ? 'status-ok' : (row.status === 'missing' ? 'status-missing' : '')}">${escapeHtml(row.statusLabel || (row.status === 'ok' ? '반영완료' : '미수집'))}</td>
                <td>${row.rowCount > 0 ? formatNumber(row.rowCount) : '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <p class="baemin-rider-day-results__meta">
        기간 ${escapeHtml(result.fromDate)} ~ ${escapeHtml(result.toDate)} (수~화)
        · 지역 ${formatNumber(result.partnerCount || 0)}곳
        · 반영완료 ${formatNumber(okCount)}
        · 미수집 ${formatNumber(missingCount)}
        ${missingOnly ? ' · 미수집만 표시' : ''}
      </p>
    `;
  }

  async function loadHistoryCollectCoverage(menu, options = {}) {
    const ids = coverageEls(menu);
    const btn = $(ids.loadBtn);
    const weekInput = String($(ids.weekStart)?.value || '').slice(0, 10);
    const synced = syncCoverageWeekUi(menu, weekInput || settlementWednesdayOf(todayKstDate()));
    const weekStart = synced.weekStart;

    if (btn) {
      btn.disabled = true;
      btn.textContent = '조회 중…';
    }
    try {
      const result = await adminApi(
        `/api/admin/baemin-delivery/history-collect-coverage?menu=${encodeURIComponent(menu)}&weekStart=${encodeURIComponent(weekStart)}`
      );
      if (result?.ok) {
        state.lastCoverage = state.lastCoverage || {};
        state.lastCoverage[menu] = result;
      }
      renderCoverageTable(menu, result, {
        missingOnly: Boolean($(ids.missingOnly)?.checked)
      });
      if (result.ok) {
        const missing = Number(result.missingCount || 0);
        showToast(
          missing > 0
            ? `${menu === 'daily_history' ? '일별' : '라이더'} ${result.fromDate}~${result.toDate} · 미수집 ${formatNumber(missing)}건`
            : `${menu === 'daily_history' ? '일별' : '라이더'} ${result.fromDate}~${result.toDate} · 전부 반영완료`
        );
      } else {
        showToast(result.message || '수집결과 조회 실패');
      }
      return result;
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '조회';
      }
    }
  }

  function renderRiderCollectDaysPanel(options = {}) {
    // 하위 호환: 수집 직후 dayResults가 오면 안내만 갱신. 상세는 [조회]로 확인.
    const el = $('baeminRiderCollectDaysResult');
    if (!el) return;
    if (Array.isArray(options.dayResults) && options.dayResults.length) {
      state.lastRiderDayResults = options.dayResults;
      const ok = options.dayResults.filter(d => d.status === 'ok').length;
      const fail = options.dayResults.filter(d => d.status !== 'ok').length;
      const existing = el.querySelector('.baemin-coverage-table-wrap');
      if (!existing) {
        el.innerHTML = `
          <p class="form-help">
            방금 수집: 완료 ${formatNumber(ok)}일${fail ? ` · 실패/없음 ${formatNumber(fail)}일` : ''}.
            정산주 선택 후 <strong>조회</strong>로 날짜·지역별 누락을 확인하세요.
          </p>
        `;
      }
    }
  }

  function initCoverageWeekDefaults() {
    const weekStart = settlementWednesdayOf(todayKstDate());
    syncCoverageWeekUi('rider_history', weekStart);
    syncCoverageWeekUi('daily_history', weekStart);
  }

  function stopSetupPoll() {
    if (state.setupPollTimer) {
      clearInterval(state.setupPollTimer);
      state.setupPollTimer = null;
    }
  }

  function stopStatusPoll() {
    if (state.statusPollTimer) {
      clearInterval(state.statusPollTimer);
      state.statusPollTimer = null;
    }
  }

  function renderSetupDialog(contentHtml) {
    const dialog = $('baeminDeliverySessionDialog');
    const body = $('baeminDeliverySessionDialogBody');
    if (body) body.innerHTML = contentHtml;
    if (!dialog) {
      showToast('세션 갱신 안내를 표시할 수 없습니다. 브라우저 열기를 사용하세요.');
      return;
    }
    try {
      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
      } else {
        dialog.setAttribute('open', 'open');
      }
    } catch {
      dialog.setAttribute('open', 'open');
    }
  }

  function closeSetupDialog() {
    stopSetupPoll();
    const dialog = $('baeminDeliverySessionDialog');
    if (dialog?.close) dialog.close();
  }

  function collectLocalHealthUrls(config, setup) {
    const urls = [];
    const push = value => {
      const text = String(value || '').trim();
      if (text && !urls.includes(text)) urls.push(text);
    };

    (setup?.localHealthUrls || []).forEach(push);
    push(setup?.localHealthUrl);
    (config?.localHealthUrls || []).forEach(push);
    push(config?.localHealthUrl);
    (state.localSessionConfig?.localHealthUrls || []).forEach(push);

    const port = setup?.localSessionPort
      || config?.localSessionPort
      || state.localSessionConfig?.port
      || 3939;
    push(`http://127.0.0.1:${port}/health`);
    push(`http://localhost:${port}/health`);

    return urls;
  }

  async function loadPublicLocalSessionConfig() {
    try {
      const response = await fetch('/api/public-config', { cache: 'no-store' });
      if (!response.ok) return;
      const payload = await response.json().catch(() => ({}));
      if (payload?.baeminSessionLocal) {
        state.localSessionConfig = {
          ...state.localSessionConfig,
          ...payload.baeminSessionLocal
        };
      }
    } catch {
      // ignore — defaults remain
    }
  }

  async function fetchLocalHealth(config, setup) {
    const healthUrls = collectLocalHealthUrls(config, setup);
    for (const healthUrl of healthUrls) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2000);
        const response = await fetch(healthUrl, {
          signal: controller.signal,
          cache: 'no-store',
          mode: 'cors'
        });
        clearTimeout(timer);
        if (!response.ok) continue;
        const payload = await response.json().catch(() => ({}));
        if (payload?.port) {
          state.localSessionConfig = {
            ...state.localSessionConfig,
            port: payload.port
          };
        }
        return {
          running: true,
          autoCollect: payload.autoCollect || null,
          collectProgress: payload.autoCollect?.collectProgress || payload.collectProgress || null,
          browser: payload.browser || null,
          session: {
            ...(payload.session || {}),
            authState: payload.session?.authState || payload.authState || null,
            authStateLabel: payload.session?.authStateLabel || null,
            authRequiredReason: payload.session?.authRequiredReason || null
          },
          authState: payload.authState || payload.session?.authState || null,
          statusLoop: payload.statusLoop || payload.autoCollect?.statusLoop || null,
          version: payload.version || '',
          features: payload.features || null,
          healthUrl
        };
      } catch {
        // try next host/port candidate
      }
    }
    return { running: false, autoCollect: null, healthUrl: healthUrls[0] || '' };
  }

  async function refreshLocalServerStatus() {
    const local = await fetchLocalHealth(state.config, null);
    state.localServerRunning = local.running;
    state.localAutoCollect = local.autoCollect;
    state.localCollectProgress = local.collectProgress || local.autoCollect?.collectProgress || null;
    state.localBrowser = local.browser;
    state.localSession = local.session;
    state.localAuthState = local.authState || local.session?.authState || null;
    syncStatusAutoLoopFromServer(local);
    if (state.config) {
      renderSessionStatus(state.config);
      renderAutoCollectStatus(state.config);
    }
    updateActionButtons();
  }

  function getLocalServerBaseUrl() {
    const port = state.localSessionConfig?.port || 3939;
    return `http://127.0.0.1:${port}`;
  }

  async function callLocalServer(path, options = {}) {
    const base = getLocalServerBaseUrl();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || 120000);
    try {
      const response = await fetch(`${base}${path}`, {
        method: options.method || 'GET',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        body: options.body != null ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
        cache: 'no-store',
        mode: 'cors'
      });
      clearTimeout(timer);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = payload.message || payload.error
          || (response.status === 404
            ? '로컬 세션 서버가 구버전입니다. PC 터미널에서 npm run baemin:session-server 를 재시작하세요.'
            : `로컬 서버 요청 실패 (${response.status})`);
        return { ok: false, status: response.status, message, ...payload };
      }
      return { ok: true, status: response.status, ...payload };
    } catch (error) {
      clearTimeout(timer);
      return { ok: false, message: error.message || '로컬 서버 연결 실패' };
    }
  }

  async function openLocalBrowser() {
    if (state.loading || state.collecting) return;

    const local = await fetchLocalHealth(state.config, null);
    state.localServerRunning = local.running;
    if (!local.running) {
      showToast('로컬 세션 서버가 실행 중이 아닙니다. npm run baemin:session-server 를 실행하세요.');
      return;
    }

    setLoading(true);
    const result = await callLocalServer('/browser/open', { method: 'POST', timeoutMs: 60000 });
    setLoading(false);
    await refreshLocalServerStatus();

    if (!result.ok) {
      showToast(result.message || '브라우저 열기에 실패했습니다.');
      return;
    }
    showToast(result.message || 'Playwright 브라우저를 열었습니다.');
  }

  async function runCollectRequest(options = {}) {
    if (state.loading || state.collecting || state.statusAutoLoop?.active) {
      if (state.statusAutoLoop?.active) showToast('배민현황 자동수집 진행 중입니다. 종료 후 다시 시도하세요.');
      return;
    }

    const ranges = readCollectRangeFromUi();
    if (options.endpoint === '/collect/daily') {
      if (!ranges.dailyFromDate || !ranges.dailyToDate || ranges.dailyToDate < ranges.dailyFromDate) {
        showToast('일별 수집 시작일과 종료일을 입력하세요.');
        return;
      }
    }
    if (options.endpoint === '/collect/rider') {
      if (!ranges.riderFromDate || !ranges.riderToDate || ranges.riderToDate < ranges.riderFromDate) {
        showToast('라이더 수집 시작일과 종료일을 확인하세요.');
        return;
      }
    }

    const local = await fetchLocalHealth(state.config, null);
    state.localServerRunning = local.running;
    if (!local.running) {
      showToast('로컬 세션 서버가 실행 중이 아닙니다. npm run baemin:session-server 를 실행하세요.');
      return;
    }

    if (options.endpoint === '/collect/daily' || options.endpoint === '/collect/rider') {
      const featureKey = options.endpoint === '/collect/daily' ? 'collectDaily' : 'collectRider';
      if (local.features && local.features[featureKey] === false) {
        showToast('로컬 세션 서버가 구버전입니다. npm run baemin:session-server 를 재시작하세요.');
        return;
      }
    }

    if (local.autoCollect?.collectRunning) {
      showToast('이미 수집 중입니다.');
      return;
    }

    setCollecting(true);
    renderSummary(null);

    const captureDate = resolveBizCaptureDate();
    const endpoint = options.endpoint || '/collect/full';
    const result = await callLocalServer(endpoint, {
      method: 'POST',
      body: {
        collectDate: captureDate,
        sourceMenus: options.sourceMenus || null,
        dailyFromDate: ranges.dailyFromDate,
        dailyToDate: ranges.dailyToDate,
        riderFromDate: ranges.riderFromDate,
        riderToDate: ranges.riderToDate,
        weekStart: options.weekStart || ranges.weekStart || null
      },
      timeoutMs: options.timeoutMs || 300000
    });

    let finalResult = result;
    if (!finalResult.ok && finalResult.status === 404 && options.sourceMenus?.length) {
      showToast('개별 수집 API 없음 — 전체 수집 경로로 재시도합니다.');
      finalResult = await callLocalServer('/collect/full', {
        method: 'POST',
        body: {
          collectDate: captureDate,
          sourceMenus: options.sourceMenus,
          dailyFromDate: ranges.dailyFromDate,
          dailyToDate: ranges.dailyToDate,
          riderFromDate: ranges.riderFromDate,
          riderToDate: ranges.riderToDate,
          weekStart: options.weekStart || ranges.weekStart || null
        },
        timeoutMs: options.timeoutMs || 300000
      });
    }

    await refreshLocalServerStatus();
    setCollecting(false);

    if (finalResult.status === 409 && finalResult.message?.includes('이미 수집')) {
      showToast('이미 수집 중입니다.');
      return;
    }

    const failLabel = options.failLabel || '배민 데이터 수집';

    if (!finalResult.ok) {
      renderSummary(null, finalResult.message || `${failLabel}에 실패했습니다.`);
      await loadConfig();
      return;
    }

    const savedCount = Number(finalResult.savedCount || 0);
    const menuResults = finalResult.results
      ? Object.fromEntries(Object.entries(finalResult.results).map(([id, row]) => [id, {
        label: row.label || id,
        ok: row.ok,
        savedCount: row.savedCount,
        message: row.message,
        dateRangeLabel: row.dateRangeLabel,
        dayResults: Array.isArray(row.dayResults)
          ? row.dayResults
          : (Array.isArray(row.meta?.dayResults) ? row.meta.dayResults : [])
      }]))
      : null;

    const riderDayResults = extractRiderDayResultsFromMenuResults(menuResults);
    if (riderDayResults.length) {
      renderRiderCollectDaysPanel({ dayResults: riderDayResults });
    }

    if (savedCount <= 0) {
      renderSummary({
        captureDate: finalResult.collectDate || captureDate,
        savedCount,
        totalCompleteSum: finalResult.totalCompleteSum,
        menuDateRanges: finalResult.menuDateRanges,
        menuResults
      }, finalResult.message || '저장된 데이터가 0건입니다.');
      await loadConfig();
      return;
    }

    renderSummary({
      captureDate: finalResult.collectDate || captureDate,
      savedCount,
      totalCompleteSum: finalResult.summaryTotals?.completeTotal || finalResult.totalCompleteSum,
      summaryTotals: finalResult.summaryTotals,
      dateRange: finalResult.dateRange,
      menuDateRanges: finalResult.menuDateRanges,
      menuResults
    });
    setBizCaptureDate(finalResult.collectDate || captureDate);
    const toastLabel = options.successToast || '배민 전체 데이터 수집 완료';
    showToast(`${toastLabel} — ${formatNumber(savedCount)}건 Supabase 저장${finalResult.partnerCount > 1 ? ` (DP ${finalResult.partnerCount}곳)` : ''}${finalResult.scrubResult?.deletedCount ? ` · 중복 정리 ${formatNumber(finalResult.scrubResult.deletedCount)}건` : ''}${options.endpoint === '/collect/rider' ? ' · 배민현황에서 기간별 조회' : ' · 미리보기 확인 후 [배민현황 저장]'}`);
    invalidateDataCache();
    await loadConfig();
    if (!isViewSection()) {
      state.activePartnerId = '';
      if (options.endpoint === '/collect/rider') {
        renderBizRiderHistoryPlaceholder(savedCount);
      } else {
        await loadAllSubtabData();
      }
    }
  }

  async function runFullCollect() {
    return runCollectRequest({
      endpoint: '/collect/full',
      failLabel: '배민 전체 데이터 수집',
      successToast: '배민 전체 데이터 수집 완료'
    });
  }

  async function runWeekFullCollect() {
    const weekStart = ensureBizCollectWeekStart();
    const range = applyBizWeekToCollectRangeInputs(weekStart);
    if (!range.fromDate || !range.toDate || range.toDate < range.fromDate) {
      showToast('정산주 기간을 확인하세요.');
      return;
    }
    return runCollectRequest({
      endpoint: '/collect/full',
      weekStart,
      failLabel: '정산주 전체수집',
      successToast: `정산주 전체수집 완료 (${range.fromDate}~${range.toDate})`,
      timeoutMs: 900000
    });
  }

  async function runDeliveryOnlyCollect() {
    return runCollectRequest({
      endpoint: '/collect/delivery',
      sourceMenus: ['delivery_status'],
      failLabel: '배달현황 수집',
      successToast: '배달현황 수집 완료',
      timeoutMs: 120000
    });
  }

  async function runDailyOnlyCollect() {
    return runCollectRequest({
      endpoint: '/collect/daily',
      sourceMenus: ['daily_history'],
      failLabel: '일별 배달내역 수집',
      successToast: '일별 배달내역 수집 완료',
      timeoutMs: 600000
    });
  }

  async function runRiderOnlyCollect() {
    return runCollectRequest({
      endpoint: '/collect/rider',
      sourceMenus: ['rider_history'],
      failLabel: '라이더별 배달내역 수집',
      successToast: '라이더별 배달내역 수집 완료',
      timeoutMs: 900000
    });
  }

  async function shutdownLocalServer() {
    if (state.loading || state.collecting) return;

    const local = await fetchLocalHealth(state.config, null);
    if (!local.running) {
      showToast('로컬 세션 서버가 이미 중지되어 있습니다.');
      return;
    }

    if (!window.confirm('자동수집 서버를 종료합니다. Playwright 브라우저도 함께 닫힙니다. 계속할까요?')) {
      return;
    }

    setLoading(true);
    const result = await callLocalServer('/shutdown', { method: 'POST', timeoutMs: 10000 });
    setLoading(false);

    state.localServerRunning = false;
    state.localBrowser = null;
    state.localAutoCollect = null;
    if (state.config) renderAutoCollectStatus(state.config);

    showToast(result.message || '자동수집 서버 종료를 요청했습니다.');
  }

  function pollSessionSetup(setupId) {
    stopSetupPoll();
    state.setupPollTimer = setInterval(async () => {
      const status = await adminApi(`/api/admin/baemin-delivery/session/setup?setupId=${encodeURIComponent(setupId)}`);
      if (!status.ok) return;

      if (status.status === 'completed') {
        stopSetupPoll();
        renderSetupDialog('<p><strong>세션 저장 완료!</strong> 창을 닫으면 자동 수집이 재개됩니다.</p>');
        await loadConfig();
        showToast('배민Biz 세션이 저장되었습니다.');
        return;
      }

      if (status.status === 'failed' || status.status === 'expired') {
        stopSetupPoll();
        renderSetupDialog(`<p class="form-help form-help--warn">${status.message || '세션 갱신에 실패했습니다.'}</p>`);
      }
    }, 2000);
  }

  async function startSessionRefresh() {
    if (state.sessionRefreshing) {
      showToast('세션 갱신 준비 중입니다…');
      return;
    }
    if (state.collecting || state.localAutoCollect?.collectRunning) {
      showToast('수집 진행 중입니다. 완료 후 다시 시도하거나 [브라우저 열기]를 사용하세요.');
    }

    state.sessionRefreshing = true;
    updateActionButtons();
    showToast('배민 세션 갱신을 준비합니다…');

    try {
      const setup = await adminApi('/api/admin/baemin-delivery/session/setup', { method: 'POST', body: '{}' });
      if (!setup.ok) {
        showToast(setup.message || '세션 갱신 준비에 실패했습니다.');
        return;
      }

      const localRunning = await fetchLocalHealth(state.config, setup);
      state.localServerRunning = localRunning.running;
      const portLabel = setup.localSessionPort || state.localSessionConfig?.port || 3939;
      const startLink = setup.startUrl
        ? `<p><a href="${setup.startUrl}" target="_blank" rel="noopener">로컬 세션 갱신 페이지 열기</a></p>`
        : '';

      if (localRunning.running) {
        const localRefresh = await callLocalServer('/session/refresh', {
          method: 'POST',
          body: {
            setupId: setup.setupId,
            setupSecret: setup.setupSecret,
            apiBase: 'https://brem.kr'
          },
          timeoutMs: 30000
        });
        if (!localRefresh.ok) {
          showToast(localRefresh.message || '로컬 세션 서버 갱신 요청에 실패했습니다.');
        }
      }

      const instructions = localRunning.running
        ? `<p>로컬 세션 서버가 실행 중입니다. (포트 ${portLabel})</p><p>Playwright 브라우저에서 배민Biz 로그인·휴대폰 인증을 완료하세요.</p>${startLink}`
        : `<p><strong>로컬 세션 서버에 연결하지 못했습니다.</strong></p>
           <p>PC 터미널에서 프로젝트 폴더로 이동 후 아래 명령을 실행하세요:</p>
           <pre class="baemin-cli-block">npm run baemin:session-server</pre>
           <p>기본 포트: <strong>${portLabel}</strong> · 확인 URL: <code>${localRunning.healthUrl || setup.localHealthUrl || `http://127.0.0.1:${portLabel}/health`}</code></p>
           <p>서버 실행 후 ERP에서 [배민 세션 갱신]을 다시 누르거나 아래 링크를 엽니다:</p>
           <pre class="baemin-cli-block">${setup.startUrl || ''}</pre>${startLink}`;

      renderSetupDialog(`${instructions}<p class="hint">완료되면 이 창이 자동으로 갱신됩니다.</p>`);

      if (setup.startUrl) {
        const popup = window.open(setup.startUrl, '_blank', 'noopener,noreferrer,width=520,height=720');
        if (!popup) {
          showToast('팝업이 차단되었습니다. 안내 창의 링크를 눌러 주세요.');
        }
      }

      pollSessionSetup(setup.setupId);
    } finally {
      state.sessionRefreshing = false;
      updateActionButtons();
    }
  }

  async function saveManualCookie() {
    const cookie = String($('baeminDeliverySessionCookie')?.value || '').trim();
    if (!cookie) {
      showToast('쿠키를 입력하세요.');
      return;
    }
    const result = await adminApi('/api/admin/baemin-delivery/session', {
      method: 'POST',
      body: JSON.stringify({ cookie })
    });
    if (!result.ok) {
      showToast(result.message || '쿠키 저장에 실패했습니다.');
      return;
    }
    showToast('비상용 쿠키가 저장되었습니다.');
    await loadConfig();
  }

  async function loadViewConfig(options = {}) {
    const silent = options.silent === true;
    // 자동(silent) 조회는 무거운 storageDiagnostics 전체 스캔을 생략(light=1).
    // 진단 UI는 silent에서 렌더하지 않으므로 결과 표시에는 영향이 없다.
    // 항상 light=1: storageDiagnostics 전체 스캔이 Vercel에서 타임아웃(500) 나기 쉬움
    const query = '/api/admin/baemin-delivery/config?viewOnly=1&light=1';
    const result = await adminApi(query);
    if (!result.ok) {
      if (!silent) showToast(result.message || `요청 실패 (${result.status || '?'})`);
      return result;
    }
    state.config = {
      ...(state.config || {}),
      tableExists: result.tableExists,
      bizCollectTableExists: result.bizCollectTableExists,
      applied: result.applied || null,
      baeminScope: result.baeminScope || null,
      riderCollectRange: result.riderCollectRange || null,
      dailyCollectRange: result.dailyCollectRange || null,
      // silent(light) 응답은 diagnostics가 없으므로 기존 값을 유지한다.
      storageDiagnostics: silent
        ? (state.config?.storageDiagnostics || null)
        : (result.storageDiagnostics || null)
    };
    state.canManageRegions = Boolean(result.canManageRegions);
    if (!silent) {
      renderViewAppliedBanner(result.applied || null);
      renderStorageDiagnostics(state.config);
      renderRegionRegistrationCard();
    } else if (result.applied) {
      // 대시보드 폴링: 배너/진단 UI는 건드리지 않고 applied만 갱신
      state.appliedCollectDate = result.applied.collectDate || state.appliedCollectDate || '';
    }
    return result;
  }

  async function loadViewData(options = {}) {
    if (state.loading) return;
    const silent = Boolean(options.silent);
    state.loading = true;
    const loadBtn = $('baeminStatusLoadBtn');
    loadBtn?.classList.add('is-loading');
    if (loadBtn) loadBtn.textContent = '불러오는 중…';

    invalidateDataCache();
    await Promise.all([
      loadPartnerRegionMap(),
      loadViewConfig(),
      loadPartnerSetCountMap(),
      ensureWeekdayQuotaLoaded(true)
    ]);

    const captureDate = state.config?.applied?.collectDate || todayKstDate();
    const weekStart = ensureViewWeekStart();
    const bundle = await adminApi(buildViewFullBundleQuery(captureDate));

    state.loading = false;
    loadBtn?.classList.remove('is-loading');
    if (loadBtn) loadBtn.textContent = '데이터 불러오기';

    if (!bundle.ok) {
      if (!silent) showToast(bundle.message || '데이터 불러오기에 실패했습니다.');
      state.viewLoaded = false;
      clearViewTablesIdle(bundle.message || '데이터를 불러오지 못했습니다.');
      return;
    }

    state.viewLoaded = true;
    state.lastClientRefreshAt = new Date().toISOString();
    state.appliedCollectDate = bundle.collectDate || captureDate;
    state.partners = filterPartnersForView(bundle.partners || []);

    applyFullBundleToCache(bundle.byPartner || {}, bundle.collectDate, bundle.weekStart || weekStart, bundle.weekEnd);
    state.partnerSetCountMap = bundle.setCountMap || state.partnerSetCountMap || {};

    renderRefreshMeta();
    renderPartnerTabs(state.partners);
    renderViewAppliedBanner(bundle.applied || state.config?.applied || null);

    if (bundle.notApplied) {
      clearViewTablesNotApplied();
      renderGrandTotalsPanel('delivery_status', '');
      updatePanelVisibility();
      if (!silent) showToast('저장된 배민현황 데이터가 없습니다. BIZ 현황에서 저장하세요.');
      return;
    }

    if (!state.partners.length) {
      state.activePartnerId = '';
      clearViewTablesIdle('배정된 지역이 없습니다. 관리자 계정에서 지역 노출을 설정하세요.');
      updatePanelVisibility();
      return;
    }

    if (!state.activePartnerId || !state.partners.some(p => normalizePartnerId(p.partnerId) === normalizePartnerId(state.activePartnerId))) {
      state.activePartnerId = normalizePartnerId(state.partners[0].partnerId);
    }

    $(tableUiConfig().partnerBarId)?.querySelectorAll('[data-baemin-partner]').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.baeminPartner === state.activePartnerId);
    });
    updatePanelVisibility();
    renderActiveViewFromCache();
    if (!silent) showToast(`배민현황 ${state.partners.length}개 지역 · 메뉴 전체 데이터를 불러왔습니다.`);
  }

  async function loadConfig(options = {}) {
    if (isViewSection()) {
      await loadViewConfig();
      return;
    }
    const query = options.light ? '?light=1' : '';
    const result = await adminApi(`/api/admin/baemin-delivery/config${query}`);
    if (result.ok) {
      const merged = options.light && state.config
        ? {
          ...state.config,
          ...result,
          storageDiagnostics: state.config.storageDiagnostics || result.storageDiagnostics || null
        }
        : result;
      state.config = merged;
      renderConfig(merged);
      await refreshLocalServerStatus();
      return;
    }
    renderConfig({ tableExists: false });
    if (result.message) showToast(result.message);
  }

  async function loadLatestSummary() {
    const captureDate = resolveBizCaptureDate();
    const result = await adminApi(`/api/admin/baemin-delivery/latest?captureDate=${encodeURIComponent(captureDate)}`);
    if (result.ok && result.savedCount > 0) {
      if (result.captureDate) setBizCaptureDate(result.captureDate);
      renderSummary({
        captureDate: result.captureDate,
        savedCount: result.savedCount,
        totalCompleteSum: result.totalCompleteSum,
        menuResults: result.byMenu
          ? Object.fromEntries(Object.entries(result.byMenu).map(([id, count]) => [id, {
            label: id,
            ok: true,
            savedCount: count
          }]))
          : null
      });
    }
  }

  async function loadPartnerBundle(partnerId, focusMenu = state.activeMenu) {
    const id = String(partnerId || '').trim();
    if (!id) return null;

    if (isViewSection()) {
      if (!state.viewLoaded && focusMenu !== 'weekday_quota') {
        clearViewTablesIdle();
        return null;
      }

      if (focusMenu === 'weekday_quota' || focusMenu === 'quota_achievement' || focusMenu === 'accept_rate_live' || focusMenu === 'calls_rejection_sync') {
        return null;
      }

      const cached = getCachedPartnerBundle(id);
      if (cached?.[focusMenu]) {
        renderSubtabRows(focusMenu, id, cached[focusMenu], cached.meta || {});
        renderGrandTotalsPanel(focusMenu, id);
        return cached;
      }
      return null;
    }

    const cachedMenus = isViewSection()
      ? MENU_IDS
      : MENU_IDS.filter(menu => menu !== 'rider_history');
    const cached = getCachedPartnerBundle(id);
    if (cached && cachedMenus.every(menu => Array.isArray(cached[menu]))) {
      if (focusMenu === 'rider_history' && !isViewSection()) {
        renderBizRiderHistoryPlaceholder();
      } else if (focusMenu && cached[focusMenu]) {
        renderSubtabRows(focusMenu, id, cached[focusMenu], cached.meta || {});
      }
      return cached;
    }

    if (state.dataCache.loadingPartner === id) return null;
    state.dataCache.loadingPartner = id;

    const ui = tableUiConfig();
    const captureDate = isViewSection()
      ? (state.appliedCollectDate || state.config?.applied?.collectDate || todayKstDate())
      : resolveBizCaptureDate();
    const partnerQuery = `&partnerId=${encodeURIComponent(id)}`;
    const menusToLoad = isViewSection()
      ? [String(focusMenu || state.activeMenu || 'delivery_status').trim()]
      : MENU_IDS.filter(menu => menu !== 'rider_history');

    const results = await Promise.all(menusToLoad.map(async sourceMenu => {
      const itemsUrl = isViewSection()
        ? buildViewItemsQuery(captureDate, sourceMenu, id)
        : `/api/admin/baemin-delivery/items?collectDate=${encodeURIComponent(captureDate)}&sourceMenu=${encodeURIComponent(sourceMenu)}${partnerQuery}${ui.appliedQuery}`;
      const result = await adminApi(itemsUrl);
      return { sourceMenu, result };
    }));

    state.dataCache.loadingPartner = '';
    const bundle = getCachedPartnerBundle(id) || { meta: { captureDate, notApplied: false } };
    bundle.meta = { captureDate, notApplied: false };
    results.forEach(({ sourceMenu, result }) => {
      if (isViewSection() && result.notApplied && sourceMenu === 'delivery_status') {
        bundle.meta.notApplied = true;
      }
      bundle[sourceMenu] = result.ok ? (result.items || []) : [];
      if (isViewSection() && result.weekStart) {
        bundle.meta.weekStart = result.weekStart;
        bundle.meta.weekEnd = result.weekEnd;
      }
    });
    setCachedPartnerBundle(id, bundle);

    if (focusMenu) {
      if (!isViewSection() && focusMenu === 'rider_history') {
        renderBizRiderHistoryPlaceholder();
      } else {
        renderSubtabRows(focusMenu, id, bundle[focusMenu] || [], bundle.meta);
      }
    }
    return bundle;
  }

  function renderSubtabRows(sourceMenu, partnerId, items, meta = {}) {
    const ui = tableUiConfig();
    const captureDate = meta.captureDate
      || (isViewSection()
        ? (state.appliedCollectDate || state.config?.applied?.collectDate || todayKstDate())
        : resolveBizCaptureDate());

    const summaryEl = $(ui.summaryMap[sourceMenu]);
    const rowsEl = $(ui.rowsMap[sourceMenu]);
    if (!rowsEl) return;

    if (isViewSection() && meta.notApplied && sourceMenu === 'delivery_status') {
      if (summaryEl) summaryEl.textContent = '적용된 데이터가 없습니다.';
      rowsEl.innerHTML = `<tr><td colspan="${getBaeminTableColspan(sourceMenu, { showPartner: false, includeCollected: false })}" class="form-help">${ui.emptyMessage}</td></tr>`;
      renderViewAppliedBanner(null);
      return;
    }

    const menuDatePlan = state.config?.autoCollect?.menuDatePlan || state.config?.menuDatePlan || null;
    const rangeLabel = meta.weekStart && meta.weekEnd
      ? `${meta.weekStart} ~ ${meta.weekEnd}`
      : menuDatePlan?.[sourceMenu]?.label;
    const partnerLabel = partnerDisplayLabel(state.partners.find(partner => normalizePartnerId(partner.partnerId) === normalizePartnerId(partnerId)));
    if (summaryEl) {
      if (sourceMenu === 'delivery_status') {
        const drivingCount = countDrivingRiders(items);
        summaryEl.textContent = isViewSection()
          ? `${partnerLabel} · 최신 적용 스냅샷 · ${formatNumber(items.length)}건 · 운행중 ${formatNumber(drivingCount)}명`
          : `${partnerLabel} · 적용 기준 (${captureDate}) · ${formatNumber(items.length)}건 · 운행중 ${formatNumber(drivingCount)}명`;
      } else if (rangeLabel) {
        const periodHint = sourceMenu === 'rider_history' ? ' · 기간 합계' : '';
        const activeCount = sourceMenu === 'rider_history'
          ? items.filter(row => Number(row.parsed_json?.totalComplete || 0) > 0).length
          : items.length;
        const completeSum = sourceMenu === 'rider_history'
          ? items.reduce((sum, row) => sum + Number(row.parsed_json?.totalComplete || 0), 0)
          : 0;
        const countLabel = sourceMenu === 'rider_history'
          ? `운행 ${formatNumber(activeCount)}명 · 완료 ${formatNumber(completeSum)}건`
          : `${formatNumber(items.length)}건`;
        summaryEl.textContent = `${partnerLabel} · ${rangeLabel} · ${countLabel}${periodHint}`;
      } else {
        summaryEl.textContent = `${partnerLabel} · ${captureDate} · ${formatNumber(items.length)}건`;
      }
    }

    if (isViewSection()) {
      renderViewAppliedBanner(state.config?.applied || null);
    }

    const showPartnerColumn = false;
    syncPartnerColumnVisibility(showPartnerColumn);
    const partnerCell = showPartnerColumn
      ? (p, row) => `<td data-partner-col>${formatPartnerCell(p, row)}</td>`
      : () => '';

    let viewItems = items;
    if (isViewSection() && partnerId && (sourceMenu === 'delivery_status' || sourceMenu === 'daily_history' || sourceMenu === 'rider_history')) {
      viewItems = filterRowsByPartnerId(items, partnerId);
    }

    // 합계는 실제 표시 행 기준으로 (필터 전 합계 / 빈 표 불일치 방지)
    if (summaryEl && sourceMenu === 'rider_history' && rangeLabel) {
      const activeCount = viewItems.filter(row => Number(row.parsed_json?.totalComplete || 0) > 0).length;
      const completeSum = viewItems.reduce((sum, row) => sum + Number(row.parsed_json?.totalComplete || 0), 0);
      summaryEl.textContent = `${partnerLabel} · ${rangeLabel} · 운행 ${formatNumber(activeCount)}명 · 완료 ${formatNumber(completeSum)}건 · 기간 합계`;
    }

    if (!viewItems.length) {
      const emptyColspan = getBaeminTableColspan(sourceMenu, {
        showPartner: showPartnerColumn,
        includeCollected: !isViewSection()
      });
      const emptyText = (items || []).length
        ? '선택 지역에 표시할 행이 없습니다. 기간을 확인하거나 다시 조회해 주세요.'
        : ui.emptyMessage;
      rowsEl.innerHTML = `<tr><td colspan="${emptyColspan}" class="form-help">${emptyText}</td></tr>`;
      return;
    }

    if (sourceMenu === 'delivery_status') {
      rowsEl.innerHTML = viewItems.map(row => {
        const p = row.parsed_json || {};
        const collectedCell = isViewSection()
          ? ''
          : `<td>${formatDateTime(row.collected_at)}</td>`;
        return `<tr>
          ${partnerCell(p, row)}
          <td>${row.rider_name || '-'}</td>
          <td>${p.statusDesc || '-'}</td>
          <td>${row.rider_user_id || '-'}</td>
          <td>${row.phone_number || '-'}</td>
          <td>${formatNumber(p.totalComplete || 0)}</td>
          ${formatServiceBreakdownCells(p)}
          <td>${formatNumber(p.morningCount || 0)}</td>
          <td>${formatNumber(p.afternoonCount || 0)}</td>
          <td>${formatNumber(p.eveningCount || 0)}</td>
          <td>${formatNumber(p.midnightCount || 0)}</td>
          ${collectedCell}
        </tr>`;
      }).join('');
      return;
    }

    if (sourceMenu === 'daily_history') {
      rowsEl.innerHTML = viewItems.map(row => {
        const p = row.parsed_json || {};
        const collectedCell = isViewSection()
          ? ''
          : `<td>${formatDateTime(row.collected_at)}</td>`;
        return `<tr>
          ${partnerCell(p, row)}
          <td>${escapeHtml(formatDeliveryDateWithWeekday(p.deliveryDate || row.collect_date || '-'))}</td>
          <td>${formatNumber(p.totalComplete || 0)}</td>
          ${formatServiceBreakdownCells(p)}
          <td>${formatNumber(p.morningCount || 0)}</td>
          <td>${formatNumber(p.afternoonCount || 0)}</td>
          <td>${formatNumber(p.eveningCount || 0)}</td>
          <td>${formatNumber(p.midnightCount || 0)}</td>
          ${collectedCell}
        </tr>`;
      }).join('');
      return;
    }

    const riderRows = sourceMenu === 'rider_history'
      ? [...viewItems].sort((a, b) => {
        const completeDiff = Number(b.parsed_json?.totalComplete || 0) - Number(a.parsed_json?.totalComplete || 0);
        if (completeDiff !== 0) return completeDiff;
        return String(a.rider_name || '').localeCompare(String(b.rider_name || ''), 'ko');
      })
      : viewItems;

    rowsEl.innerHTML = riderRows.map(row => {
      const p = row.parsed_json || {};
      const deliveryCount = Number(row.raw_json?.deliveryCount || p.totalComplete || 0);
      const collectedCell = isViewSection()
        ? ''
        : `<td>${formatDateTime(row.collected_at)}</td>`;
      return `<tr>
        ${partnerCell(p, row)}
        <td>${row.rider_name || '-'}</td>
        <td>${row.rider_user_id || '-'}</td>
        <td>${row.phone_number || '-'}</td>
        <td>${formatNumber(p.totalComplete || deliveryCount || 0)}</td>
        ${formatServiceBreakdownCells(p)}
        <td>${formatNumber(p.morningCount || 0)}</td>
        <td>${formatNumber(p.afternoonCount || 0)}</td>
        <td>${formatNumber(p.eveningCount || 0)}</td>
        <td>${formatNumber(p.midnightCount || 0)}</td>
        ${collectedCell}
      </tr>`;
    }).join('');
  }

  async function loadSubtabData(sourceMenu, partnerIdOverride = '') {
    const partnerId = String(partnerIdOverride || selectedPartnerId() || '').trim();
    if (!partnerId) return;
    await loadPartnerBundle(partnerId, sourceMenu);
  }

  async function scrubDuplicatePartners() {
    if (state.loading || state.collecting) return;
    const captureDate = resolveBizCaptureDate();
    if (!window.confirm(`${captureDate} 수집 데이터에서 협력사 간 동일 라이더 중복을 정리합니다.\n가장 먼저 수집된 협력사만 남기고 나머지 중복 협력사 데이터를 삭제합니다.\n계속할까요?`)) {
      return;
    }

    setLoading(true);
    const result = await adminApi('/api/admin/baemin-delivery/scrub-duplicates', {
      method: 'POST',
      body: JSON.stringify({ collectDate: captureDate })
    });
    setLoading(false);

    if (!result.ok) {
      showToast(result.message || result.error || '중복 정리에 실패했습니다.');
      return;
    }

    showToast(result.message || `중복 정리 완료 — ${formatNumber(result.deletedCount || 0)}건 삭제`);
    invalidateDataCache();
    state.activePartnerId = '';
    await loadAllSubtabData();
  }

  async function purgeCollectDateData() {
    if (state.loading || state.collecting) return;
    const captureDate = resolveBizCaptureDate();
    if (!window.confirm(`${captureDate} 수집 데이터를 전부 삭제합니다.\n삭제 후 [배민 전체 데이터 수집]으로 다시 받아야 합니다.\n계속할까요?`)) {
      return;
    }

    setLoading(true);
    const result = await adminApi('/api/admin/baemin-delivery/purge-collect', {
      method: 'POST',
      body: JSON.stringify({ collectDate: captureDate })
    });
    setLoading(false);

    if (!result.ok) {
      showToast(result.message || result.error || '삭제에 실패했습니다.');
      return;
    }

    showToast(result.message || `수집 데이터 ${formatNumber(result.deletedCount || 0)}건 삭제`);
    invalidateDataCache();
    state.activePartnerId = '';
    await loadAllSubtabData();
  }

  async function applyToErp() {
    if (state.applying || state.loading || state.statusAutoLoop?.active) return;
    const captureDate = resolveBizCaptureDate();
    state.applying = true;
    renderAppliedStatus(state.config);
    updateActionButtons();
    showToast('배민현황 저장 중… Supabase에 반영합니다.');

    const local = await fetchLocalHealth(state.config, null);
    state.localServerRunning = local.running;
    let result = null;

    if (!local.running) {
      state.applying = false;
      showToast('로컬 세션 서버가 꺼져 있습니다. npm run baemin:session-server 실행 후 [배민현황 저장]을 누르세요.');
      renderAppliedStatus(state.config);
      updateActionButtons();
      return;
    }

    result = await callLocalServer('/apply/erp', {
      method: 'POST',
      body: { collectDate: captureDate },
      timeoutMs: 600000
    });

    if (!result.ok && result.status === 404) {
      showToast('로컬 서버가 구버전입니다. npm run baemin:session-server 재시작 후 다시 시도하세요.');
      result = await adminApi('/api/admin/baemin-delivery/apply', {
        method: 'POST',
        body: JSON.stringify({ collectDate: captureDate })
      });
    }

    state.applying = false;
    updateActionButtons();
    if (!result.ok) {
      showToast(result.message || '배민현황 저장에 실패했습니다.');
      renderAppliedStatus(state.config);
      return;
    }
    showToast(
      `배민현황 Supabase 저장 완료 — ${result.collectDate} · ${formatNumber(result.itemCount || result.savedCount || 0)}건`
      + `${result.byMenu?.rider_history ? ` · 라이더 ${formatNumber(result.byMenu.rider_history)}` : ''}`
      + `${result.mergedAllDates ? ' · 전체 수집일 통합' : ''}`
    );
    invalidateDataCache();
    await loadConfig();
    if (!isViewSection()) {
      state.activePartnerId = '';
      await loadAllSubtabData();
    }
  }

  function syncStatusAutoLoopFromServer(payload) {
    const loop = payload?.statusLoop || payload?.autoCollect?.statusLoop || null;
    if (!loop) return;
    state.statusAutoLoop.active = Boolean(loop.active);
    state.statusAutoLoop.round = Number(loop.round || 0);
    state.statusAutoLoop.phase = loop.phase || 'idle';
    state.statusAutoLoop.message = loop.message || '';
    state.statusAutoLoop.waitEndsAt = Number(loop.waitEndsAt || 0);
    state.statusAutoLoop.lastError = loop.lastError || '';
    renderStatusAutoLoopPanel();
  }

  function setMorningRunStatus(text) {
    const el = $('baeminMorningRunStatus');
    if (el) el.textContent = text;
  }

  async function callCoupangLocal(pathName, options = {}) {
    const method = options.method || 'GET';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || 30000);
    try {
      const res = await fetch(`http://127.0.0.1:3940${pathName}`, {
        method,
        headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
        body: method === 'POST' ? JSON.stringify(options.body || {}) : undefined,
        signal: controller.signal
      });
      const json = await res.json().catch(() => ({}));
      return { ok: res.ok && json.ok !== false, status: res.status, ...json };
    } catch (error) {
      return { ok: false, message: error.message || '쿠팡 로컬 서버 연결 실패' };
    } finally {
      clearTimeout(timer);
    }
  }

  async function openCoupangNaverMail() {
    setMorningRunStatus('네이버 메일 창 여는 중…');
    const result = await callCoupangLocal('/naver/open', { method: 'POST', timeoutMs: 90000 });
    showToast(result.message || (result.ok ? '네이버 메일을 열었습니다.' : '네이버 메일 열기 실패'));
    setMorningRunStatus(result.message || '네이버메일(쿠팡 OTP용) — 최초 1회 로그인하세요.');
  }

  async function recoverCoupangAuthWithNaver() {
    setMorningRunStatus('쿠팡 네이버 OTP 복구 중…');
    const result = await callCoupangLocal('/auth/recover', { method: 'POST', timeoutMs: 180000 });
    showToast(result.message || (result.ok ? '쿠팡 인증 복구 완료' : '쿠팡 인증 복구 실패'));
    setMorningRunStatus(result.ok
      ? '쿠팡 네이버 OTP 복구 완료'
      : (result.message || '복구 실패 — 네이버메일 로그인/OTP 확인'));
  }

  function setMorningRunButtonsBusy(busy) {
    const labels = {
      baeminMorningRunBtn: busy
        ? '크롤링 실행 중…'
        : '출근 원버튼 (배민+쿠팡 수집·ERP·라이더반영)',
      crawlMorningStartBtn: busy ? '크롤링 중…' : '크롤링 시작'
    };
    Object.entries(labels).forEach(([id, text]) => {
      const el = $(id);
      if (!el) return;
      el.disabled = Boolean(busy);
      el.textContent = text;
    });
  }

  function setCrawlOperatorUiVisible(allowed) {
    const show = Boolean(allowed);
    ['crawlMorningStartBtn', 'baeminMorningRunRow'].forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.hidden = !show;
      el.classList.toggle('app-hidden', !show);
    });
  }

  async function refreshCrawlOperatorAccess() {
    try {
      const result = await adminApi('/api/admin/crawl/operator-access');
      const allowed = Boolean(result?.ok && result.allowed);
      state.crawlOperatorAllowed = allowed;
      setCrawlOperatorUiVisible(allowed);
      return allowed;
    } catch {
      state.crawlOperatorAllowed = false;
      setCrawlOperatorUiVisible(false);
      return false;
    }
  }

  async function runMorningOneButton() {
    if (!state.crawlOperatorAllowed) {
      showToast('크롤링 권한이 없는 관리자 계정입니다.');
      return;
    }
    const busy = $('crawlMorningStartBtn')?.disabled || $('baeminMorningRunBtn')?.disabled;
    if (busy) return;
    if (!window.confirm('크롤링을 시작할까요?\n배민 1회차 수집·저장·콜수/거절율 → 쿠팡 자동로그인·7일 수집·거절율 → 라이더 반영 → 자동순회\n(수요일은 전주 수~화 포함)')) {
      return;
    }
    setMorningRunButtonsBusy(true);
    setMorningRunStatus('크롤링 실행 중… (배민 bootstrap·인증 대기 포함, 수 분 걸릴 수 있음)');
    showToast('크롤링 시작');
    try {
      const port = state.localSessionConfig?.port || 3939;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 40 * 60 * 1000);
      let result;
      try {
        const res = await fetch(`http://127.0.0.1:${port}/morning-run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
          signal: controller.signal
        });
        result = await res.json().catch(() => ({}));
        result.ok = res.ok && result.ok !== false;
      } finally {
        clearTimeout(timer);
      }

      const weekLabel = result.weekRange?.label || '';
      if (!result.ok) {
        const failed = (result.steps || []).find(step => step.ok === false);
        const msg = failed?.message || result.message || '크롤링 실패';
        setMorningRunStatus(`실패 · ${weekLabel} · ${msg}`);
        showToast(msg);
        return;
      }
      const summary = (result.steps || []).map(step => step.name).join(' → ');
      setMorningRunStatus(`완료 · ${weekLabel} · ${summary}`);
      showToast(`크롤링 완료 · ${weekLabel}`);
      await refreshLocalServerStatus();
    } catch (error) {
      const msg = error?.name === 'AbortError'
        ? '크롤링 시간 초과'
        : (error.message || '크롤링 실패');
      setMorningRunStatus(msg);
      showToast(msg);
    } finally {
      setMorningRunButtonsBusy(false);
    }
  }

  function renderStatusAutoLoopPanel() {
    const el = $('baeminStatusAutoLoopStatus');
    const loop = state.statusAutoLoop || {};
    updateActionButtons();
    if (!el) return;

    if (!loop.active) {
      el.textContent = loop.message
        ? `중지됨 — ${loop.message}`
        : '자동수집: 첫 회차 배달+일별+라이더→저장→수락율 / 이후 배달현황→저장→수락율→30초 대기 반복';
      return;
    }

    if (loop.phase === 'bootstrap') {
      el.textContent = `${loop.round || 1}회차 부트스트랩 · ${loop.message || '배달현황+일별+라이더 수집 중…'}`;
      return;
    }
    if (loop.phase === 'collecting') {
      el.textContent = `${loop.round}회차 · 배달현황 수집 중…`;
      return;
    }
    if (loop.phase === 'applying') {
      el.textContent = `${loop.round}회차 · 배민현황 Supabase 저장 중…`;
      return;
    }
    if (loop.phase === 'rider_sync') {
      el.textContent = `${loop.round}회차 · 기사앱 수락율 반영 중…`;
      return;
    }
    if (loop.phase === 'waiting') {
      const leftSec = Math.max(0, Math.ceil((Number(loop.waitEndsAt || 0) - Date.now()) / 1000));
      const mm = String(Math.floor(leftSec / 60));
      const ss = String(leftSec % 60).padStart(2, '0');
      el.textContent = `${loop.round}회차 대기 ${mm}:${ss}`
        + (loop.message ? ` · ${loop.message}` : '');
      return;
    }
    el.textContent = `${loop.round}회차 · 자동수집 진행 중…${loop.message ? ` · ${loop.message}` : ''}`;
  }

  async function runRiderLiveSyncOnce() {
    if (state.riderLiveSyncRunning || state.statusAutoLoop?.active) {
      showToast('이미 수집/반영이 진행 중입니다.');
      return;
    }
    if (!state.localServerRunning) {
      showToast('로컬 세션 서버가 꺼져 있습니다. npm run baemin:session-server 실행 후 다시 시도하세요.');
      return;
    }
    if (state.collecting || state.applying || state.localAutoCollect?.collectRunning) {
      showToast('다른 수집/저장이 끝난 뒤 시작해 주세요.');
      return;
    }

    const statusEl = $('baeminRiderLiveSyncStatus');
    state.riderLiveSyncRunning = true;
    updateActionButtons();
    if (statusEl) statusEl.textContent = '1/3 배달현황 수집 중…';
    showToast('기사앱 실시간 반영 시작 — 수집 → 저장 → 수락율');

    try {
      const result = await callLocalServer('/rider-live-sync', {
        method: 'POST',
        body: {},
        timeoutMs: 600000
      });

      if (!result.ok) {
        if (statusEl) statusEl.textContent = `실패 — ${result.message || '기사앱 반영 실패'}`;
        showToast(result.message || '기사앱 실시간 반영에 실패했습니다.');
        return;
      }

      const rates = result.rates || {};
      const apply = result.apply || {};
      if (statusEl) {
        statusEl.textContent = result.message
          || `완료 · 저장 ${formatNumber(apply.itemCount || apply.savedCount || 0)}건 · 수락율 ${formatNumber(rates.riderCount || rates.upserted || 0)}명`;
      }
      showToast(result.message || '기사앱 실시간 반영 완료');
      invalidateDataCache();
      await loadConfig();
      if (!isViewSection()) {
        state.activePartnerId = '';
        await loadAllSubtabData();
      }
    } catch (error) {
      if (statusEl) statusEl.textContent = `실패 — ${error.message || '요청 오류'}`;
      showToast(error.message || '기사앱 실시간 반영에 실패했습니다.');
    } finally {
      state.riderLiveSyncRunning = false;
      updateActionButtons();
    }
  }

  async function startStatusAutoLoop() {
    if (state.statusAutoLoop.active) return;
    if (!state.localServerRunning) {
      showToast('로컬 세션 서버가 꺼져 있습니다. npm run baemin:session-server 실행 후 다시 시도하세요.');
      return;
    }
    if (state.collecting || state.applying || state.localAutoCollect?.collectRunning || state.riderLiveSyncRunning) {
      showToast('다른 수집/저장이 끝난 뒤 시작해 주세요.');
      return;
    }

    const result = await callLocalServer('/status-loop/start', {
      method: 'POST',
      body: {},
      timeoutMs: 15000
    });
    if (!result.ok) {
      if (result.status === 404) {
        showToast('세션 서버가 구버전입니다. scripts\\restart-baemin-session-server-e.bat 로 재시작하세요. (20260710b+)');
        return;
      }
      showToast(result.message || '자동수집 시작에 실패했습니다.');
      return;
    }
    syncStatusAutoLoopFromServer(result);
    showToast('배민현황 자동수집 시작 — 세션 서버에서 실행됩니다. 다른 메뉴를 봐도 종료 전까지 계속됩니다.');
    await refreshLocalServerStatus();
  }

  async function stopStatusAutoLoop() {
    const result = await callLocalServer('/status-loop/stop', {
      method: 'POST',
      body: {},
      timeoutMs: 15000
    });
    if (!result.ok && result.status === 404) {
      state.statusAutoLoop.active = false;
      state.statusAutoLoop.phase = 'idle';
      state.statusAutoLoop.message = '사용자가 종료함';
      renderStatusAutoLoopPanel();
      showToast('배민현황 자동수집을 종료했습니다.');
      return;
    }
    syncStatusAutoLoopFromServer(result);
    state.statusAutoLoop.active = false;
    state.statusAutoLoop.phase = 'idle';
    state.statusAutoLoop.message = result.statusLoop?.message || '사용자가 종료함';
    renderStatusAutoLoopPanel();
    showToast('배민현황 자동수집을 종료했습니다.');
    await refreshLocalServerStatus();
  }

  async function loadAllSubtabData() {
    await loadPartnerTabs();
    if (state.activePartnerId && state.activeMenu) {
      await loadSubtabData(state.activeMenu, state.activePartnerId);
    }
  }

  async function runAutoCollect() {
    return runFullCollect();
  }

  function openJsonDialog() {
    const dialog = $('baeminDeliveryJsonDialog');
    const textarea = $('baeminDeliveryJsonInput');
    if (textarea) textarea.value = '';
    if (dialog?.showModal) dialog.showModal();
  }

  function closeJsonDialog() {
    const dialog = $('baeminDeliveryJsonDialog');
    if (dialog?.close) dialog.close();
  }

  async function submitJsonImport() {
    const textarea = $('baeminDeliveryJsonInput');
    const raw = String(textarea?.value || '').trim();
    if (!raw) {
      showToast('JSON을 붙여넣으세요.');
      return;
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      showToast('JSON 형식이 올바르지 않습니다.');
      return;
    }

    if (state.loading) return;
    setLoading(true);
    closeJsonDialog();

    const captureDate = $('baeminDeliveryCaptureDate')?.value || new Date().toISOString().slice(0, 10);
    const result = await adminApi('/api/admin/baemin-delivery/import-json', {
      method: 'POST',
      body: JSON.stringify({ payload, captureDate })
    });

    setLoading(false);
    if (!result.ok) {
      renderSummary(null, result.message || 'JSON 저장에 실패했습니다.');
      return;
    }
    renderSummary(result);
    showToast('배민 JSON 데이터가 저장되었습니다.');
    if (!isViewSection()) {
      state.activePartnerId = '';
      await loadAllSubtabData();
    }
  }

  const DASHBOARD_CACHE_KEY = 'brem_dashboard_baemin_cache_v4';
  const DASHBOARD_REFRESHING_SUFFIX = ' · 최신 갱신 중…';

  function readDashboardCache() {
    try { return JSON.parse(localStorage.getItem(DASHBOARD_CACHE_KEY) || 'null'); } catch { return null; }
  }
  function saveDashboardCache(data) {
    try { localStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify(data)); } catch { /* ignore */ }
  }
  function mergeDashboardCache(patch) {
    const prev = readDashboardCache() || {};
    saveDashboardCache({ ...prev, ...patch, savedAt: Date.now() });
  }
  function stripRefreshingSuffix(text) {
    return String(text || '').replace(/\s*·\s*최신 갱신 중…$/, '');
  }
  function purgeLegacyBaeminDashboardCaches() {
    [
      'brem_dashboard_baemin_cache',
      'brem_dashboard_baemin_cache_v2',
      'brem_dashboard_baemin_cache_v3'
    ].forEach(key => {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    });
  }

  function buildBaeminScopeKey() {
    const account = window.BremStorage?.auth?.getAdminSessionAccount?.() || null;
    const accountId = String(account?.id || 'anon');
    const role = String(account?.role || '').toLowerCase();
    if (role === 'ceo' || role === 'director') return `acct:${accountId}:manage`;
    const ids = [...new Set((account?.baeminPartnerIds || [])
      .map(id => String(id || '').trim().toUpperCase())
      .filter(Boolean))]
      .sort()
      .join('|');
    return `acct:${accountId}:p:${ids || 'none'}`;
  }

  function currentBaeminAccountId() {
    return String(window.BremStorage?.auth?.getAdminSessionAccount?.()?.id || '').trim();
  }

  function isBaeminCacheAllowedForSession(cache) {
    if (!cache || !cache.panelsHtml) return false;
    const accountId = currentBaeminAccountId();
    if (!accountId) return false;
    if (cache.accountId && cache.accountId === accountId) return true;
    if (cache.scopeKey && String(cache.scopeKey).startsWith(`acct:${accountId}:`)) return true;
    return false;
  }

  function bindDashboardWeekRegionBarClicks(partnerIds = []) {
    const bar = $('dashboardBaeminWeekRegionBar');
    if (!bar) return;
    const ids = (partnerIds || []).map(normalizePartnerId).filter(Boolean);
    bar.querySelectorAll('[data-dashboard-week-partner]').forEach(btn => {
      btn.addEventListener('click', () => {
        const partnerId = normalizePartnerId(btn.dataset.dashboardWeekPartner || '');
        if (!partnerId || partnerId === state.dashboardWeekPartnerId) return;
        state.dashboardWeekPartnerId = partnerId;
        renderDashboardWeekRegionTabs(ids);
        void queryDashboardBaeminWeek([partnerId], { selectedOnly: true });
      });
    });
  }

  function dashboardActivityScore(parts = {}) {
    return Number(parts.drivingSum || 0)
      + Number(parts.morningSum || 0)
      + Number(parts.afternoonSum || 0)
      + Number(parts.eveningSum || 0)
      + Number(parts.midnightSum || 0);
  }

  function estimateActivityFromCache(cache) {
    if (!cache) return 0;
    if (Number(cache.activityScore) > 0) return Number(cache.activityScore);
    const drive = String(cache.summaryText || '').match(/운행중\s*([\d,]+)/);
    if (drive) {
      const n = Number(String(drive[1]).replace(/,/g, '')) || 0;
      if (n > 0) return n;
    }
    let sum = 0;
    const hits = String(cache.panelsHtml || '').match(/(\d+)\s*\/\s*\d+/g) || [];
    hits.forEach(token => {
      const m = String(token).match(/(\d+)\s*\//);
      if (m) sum += Number(m[1]) || 0;
    });
    return sum;
  }

  /** 자동갱신 중 빈·불완전 응답으로 표를 지우지 않음 — 이전 숫자 유지 후 준비되면 한 번에 교체 */
  function shouldKeepPreviousDashboardPaint({
    silent,
    hadTable,
    prevActivity,
    itemCount,
    loadedRegions,
    expectedRegions
  }) {
    if (!silent || !hadTable) return false;
    // 아이템 0건(빈 스냅샷/일시 실패)이면 기존 유지. 실제 0콜(아이템은 있음)은 정상 반영.
    if (prevActivity > 0 && Number(itemCount || 0) <= 0) return true;
    if (
      prevActivity > 0
      && Number(expectedRegions || 0) > 1
      && Number(loadedRegions || 0) < Math.ceil(Number(expectedRegions) / 2)
    ) {
      return true;
    }
    return false;
  }

  function persistTodayDashboardCache(activityScore) {
    const panelsEl = $('dashboardBaeminLivePanels');
    const summary = $('dashboardBaeminLiveSummary');
    const appliedEl = $('dashboardBaeminAppliedTime');
    if (!panelsEl?.querySelector('table')) return;
    const accountId = currentBaeminAccountId();
    if (!accountId) return;
    const score = activityScore == null ? state.dashboardLastActivity : Number(activityScore || 0);
    mergeDashboardCache({
      accountId,
      scopeKey: buildBaeminScopeKey(),
      panelsHtml: panelsEl.innerHTML,
      summaryText: stripRefreshingSuffix(summary?.textContent || ''),
      appliedHtml: appliedEl ? appliedEl.innerHTML : '',
      activityScore: score,
      regionMeta: (state.dashboardBaeminRegions || []).map(r => ({
        partnerId: r.partnerId,
        regionName: r.regionName
      }))
    });
  }

  function persistWeekDashboardCache() {
    const weekRows = $('dashboardBaeminWeekRows');
    const weekSummary = $('dashboardBaeminWeekSummary');
    const bar = $('dashboardBaeminWeekRegionBar');
    if (!weekRows?.querySelector('.dashboard-baemin-qcell')) return;
    const accountId = currentBaeminAccountId();
    if (!accountId) return;
    const partnerIds = (state.dashboardBaeminRegions || []).map(r => r.partnerId).filter(Boolean);
    mergeDashboardCache({
      accountId,
      scopeKey: buildBaeminScopeKey(),
      weekRowsHtml: weekRows.innerHTML,
      weekSummaryText: stripRefreshingSuffix(weekSummary?.textContent || ''),
      weekBarHtml: bar && !bar.hidden ? bar.innerHTML : '',
      weekPartnerIds: partnerIds,
      weekPartnerId: state.dashboardWeekPartnerId || partnerIds[0] || '',
      regionMeta: (state.dashboardBaeminRegions || []).map(r => ({
        partnerId: r.partnerId,
        regionName: r.regionName
      }))
    });
  }

  // 로그인 직후: 같은 계정의 마지막 숫자 즉시 표시 → 뒤에서 최신 갱신
  function paintDashboardCacheInstant() {
    const panelsEl = $('dashboardBaeminLivePanels');
    if (!panelsEl) return false;
    purgeLegacyBaeminDashboardCaches();

    const cache = readDashboardCache();
    if (!isBaeminCacheAllowedForSession(cache)) {
      const accountId = currentBaeminAccountId();
      if (cache?.accountId && accountId && cache.accountId !== accountId) {
        try { localStorage.removeItem(DASHBOARD_CACHE_KEY); } catch { /* ignore */ }
      }
      if (!panelsEl.querySelector('table')) {
        panelsEl.innerHTML = '<p class="form-help">마지막 현황 불러오는 중…</p>';
      }
      return false;
    }

    // 오늘 표: 비어 있을 때만 캐시로 채움 (이미 최신이면 유지)
    if (!panelsEl.querySelector('table') && cache.panelsHtml) {
      panelsEl.innerHTML = cache.panelsHtml;
      state.dashboardLastActivity = estimateActivityFromCache(cache);
      const summary = $('dashboardBaeminLiveSummary');
      if (summary && cache.summaryText) {
        summary.textContent = `${cache.summaryText}${DASHBOARD_REFRESHING_SUFFIX}`;
      }
      const appliedEl = $('dashboardBaeminAppliedTime');
      if (appliedEl && cache.appliedHtml) appliedEl.innerHTML = cache.appliedHtml;
    }

    // 주간 표·지역 탭(팀장 지역 전환): 캐시 즉시 복원
    const weekRows = $('dashboardBaeminWeekRows');
    if (weekRows && cache.weekRowsHtml && !weekRows.querySelector('.dashboard-baemin-qcell')) {
      weekRows.innerHTML = cache.weekRowsHtml;
      const weekSummary = $('dashboardBaeminWeekSummary');
      if (weekSummary && cache.weekSummaryText) {
        weekSummary.textContent = `${cache.weekSummaryText}${DASHBOARD_REFRESHING_SUFFIX}`;
      }
    }
    const bar = $('dashboardBaeminWeekRegionBar');
    const weekPartnerIds = Array.isArray(cache.weekPartnerIds)
      ? cache.weekPartnerIds.map(normalizePartnerId).filter(Boolean)
      : [];
    if (bar && cache.weekBarHtml && weekPartnerIds.length && (bar.hidden || !bar.querySelector('[data-dashboard-week-partner]'))) {
      state.dashboardWeekPartnerId = normalizePartnerId(cache.weekPartnerId) || weekPartnerIds[0];
      bar.hidden = false;
      bar.innerHTML = cache.weekBarHtml;
      bindDashboardWeekRegionBarClicks(weekPartnerIds);
    }
    return true;
  }

  async function initDashboardBaeminLive(force = false) {
    const panels = $('dashboardBaeminLivePanels');
    if (!panels) return;

    // 캐시된 마지막 결과를 즉시 표시(첫 표 렌더 전에만)
    paintDashboardCacheInstant();

    if (!force && state.dashboardBaeminRegions.length) {
      return;
    }

    const result = await adminApi('/api/admin/baemin-delivery/partner-regions');
    if (!result.ok) {
      panels.innerHTML = '<p class="form-help">담당 지역을 불러오지 못했습니다.</p>';
      return;
    }

    const items = Array.isArray(result.items) ? result.items : [];
    state.canManageRegions = Boolean(result.canManageRegions);
    state.viewPartnerIds = Array.isArray(result.viewPartnerIds)
      ? result.viewPartnerIds.map(id => String(id || '').trim().toUpperCase()).filter(Boolean)
      : Object.keys(result.map || {});
    state.partnerRegionMap = result.map || state.partnerRegionMap || {};
    state.dashboardBaeminRegions = items
      .map(item => ({
        partnerId: normalizePartnerId(item.partnerId),
        regionName: String(item.regionName || item.partnerId || '').trim()
      }))
      .filter(item => item.partnerId)
      .sort((a, b) => a.regionName.localeCompare(b.regionName, 'ko'));

    if (!state.dashboardBaeminRegions.length) {
      const summary = $('dashboardBaeminLiveSummary');
      const emptyMsg = state.canManageRegions
        ? '등록된 배민 지역이 없습니다. 배민현황에서 지역을 등록하세요.'
        : '계정에 배정된 배민 지역이 없습니다. 대표/총괄에게 지역 배정을 요청하세요.';
      if (summary) summary.textContent = emptyMsg;
      panels.innerHTML = `<p class="form-help">${emptyMsg}</p>`;
      const appliedEl = $('dashboardBaeminAppliedTime');
      if (appliedEl) appliedEl.textContent = '적용시간 —';
      return;
    }

    void queryDashboardBaeminLive({ silent: true });
  }

  function aggregateDeliveryStatusMetrics(items = []) {
    return (items || []).reduce((acc, row) => {
      const p = row?.parsed_json || {};
      acc.rowCount += 1;
      if (isDrivingStatus(p.statusDesc || row?.statusDesc || '')) acc.drivingCount += 1;
      acc.completeTotal += Number(p.totalComplete || 0);
      acc.totalReject += Number(p.totalReject || 0);
      acc.cancelTotal += Number(p.cancelCount || p.totalCancel || 0);
      acc.riderFault += Number(p.riderFault || p.totalRiderFault || 0);
      acc.morningTotal += Number(p.morningCount || 0);
      acc.afternoonTotal += Number(p.afternoonCount || 0);
      acc.eveningTotal += Number(p.eveningCount || 0);
      acc.midnightTotal += Number(p.midnightCount || 0);
      return acc;
    }, {
      rowCount: 0,
      drivingCount: 0,
      completeTotal: 0,
      totalReject: 0,
      cancelTotal: 0,
      riderFault: 0,
      morningTotal: 0,
      afternoonTotal: 0,
      eveningTotal: 0,
      midnightTotal: 0
    });
  }

  function renderCompactQuotaCell(actual, target) {
    const prog = formatProgress(actual, target);
    const achieved = prog.target > 0 ? prog.actual >= prog.target : prog.actual > 0;
    const statusClass = achieved ? ' baemin-quota-tag--achieved' : ' baemin-quota-tag--missed';
    const percentClass = achieved
      ? ' baemin-quota-cell__percent--over'
      : ' baemin-quota-cell__percent--missed';
    // 한 줄(비율+%%+태그)이면 숫자 자릿수 바뀔 때 열이 찌그러짐 → 2줄 고정
    return `<td class="dashboard-baemin-qcell">
      <div class="dashboard-baemin-qcell__stack">
        <span class="dashboard-baemin-qcell__ratio">${escapeHtml(prog.label)}</span>
        <span class="dashboard-baemin-qcell__meta">
          <span class="baemin-quota-cell__percent${percentClass}">${escapeHtml(prog.percentLabel)}</span>
          <span class="baemin-quota-tag${statusClass}">${achieved ? '달성' : '미달성'}</span>
        </span>
      </div>
    </td>`;
  }

  function renderDashboardTodayTable(regionRows, totals) {
    const summaryRow = `<tr class="dashboard-baemin-compact-table__summary">
      <td><strong>전체 합계</strong></td>
      <td>${formatNumber(totals.drivingSum)}명</td>
      ${renderCompactQuotaCell(totals.morningSum, totals.targetMorning)}
      ${renderCompactQuotaCell(totals.afternoonSum, totals.targetAfternoon)}
      ${renderCompactQuotaCell(totals.eveningSum, totals.targetEvening)}
      ${renderCompactQuotaCell(totals.midnightSum, totals.targetMidnight)}
    </tr>`;
    const bodyRows = regionRows.map(region => `<tr>
      <td>
        <strong class="dashboard-baemin-region-name">${escapeHtml(region.regionName)}</strong>
        <span class="dashboard-baemin-region-meta">${formatNumber(region.setCount)}세트</span>
      </td>
      <td>${formatNumber(region.drivingCount)}명</td>
      ${renderCompactQuotaCell(region.morningTotal, region.targets.morning)}
      ${renderCompactQuotaCell(region.afternoonTotal, region.targets.afternoon)}
      ${renderCompactQuotaCell(region.eveningTotal, region.targets.evening)}
      ${renderCompactQuotaCell(region.midnightTotal, region.targets.midnight)}
    </tr>`).join('');
    return `<div class="dashboard-baemin-table-wrap">
      <table class="admin-table dashboard-baemin-compact-table">
        <thead>
          <tr>
            <th>지역</th>
            <th>운행중</th>
            <th>아침점심</th>
            <th>오후</th>
            <th>저녁</th>
            <th>심야</th>
          </tr>
        </thead>
        <tbody>${summaryRow}${bodyRows}</tbody>
      </table>
    </div>`;
  }

  function renderDashboardWeekRegionTabs(partnerIds = []) {
    const bar = $('dashboardBaeminWeekRegionBar');
    if (!bar) return;
    const ids = (partnerIds || []).map(normalizePartnerId).filter(Boolean);
    if (!ids.length) {
      bar.hidden = true;
      bar.innerHTML = '';
      state.dashboardWeekPartnerId = '';
      return;
    }
    if (!ids.includes(state.dashboardWeekPartnerId)) {
      state.dashboardWeekPartnerId = ids[0];
    }
    bar.hidden = false;
    bar.innerHTML = ids.map(partnerId => {
      const regionName = state.dashboardBaeminRegions.find(r => r.partnerId === partnerId)?.regionName
        || partnerLabelById(partnerId)
        || partnerId;
      const active = partnerId === state.dashboardWeekPartnerId ? ' is-active' : '';
      return `<button type="button" class="baemin-region-tab${active}" data-dashboard-week-partner="${partnerId}" aria-pressed="${partnerId === state.dashboardWeekPartnerId ? 'true' : 'false'}">${escapeHtml(regionName)}</button>`;
    }).join('');
    bindDashboardWeekRegionBarClicks(ids);
  }

  function renderDashboardWeekRowsForPartner(partnerId, items = [], weekRange) {
    const rowsEl = $('dashboardBaeminWeekRows');
    const summaryEl = $('dashboardBaeminWeekSummary');
    if (!rowsEl) return;

    const pid = normalizePartnerId(partnerId);
    const regionName = state.dashboardBaeminRegions.find(r => r.partnerId === pid)?.regionName
      || partnerLabelById(pid)
      || pid;
    const setCount = getPartnerSetCount(pid);
    const byDate = new Map();
    (items || []).forEach(row => {
      const p = row.parsed_json || {};
      const date = String(p.deliveryDate || p.businessDate || row.collect_date || '').slice(0, 10);
      if (!date || date < weekRange.fromDate || date > weekRange.toDate) return;
      const hit = byDate.get(date) || { morning: 0, afternoon: 0, evening: 0, midnight: 0 };
      hit.morning += Number(p.morningCount || 0);
      hit.afternoon += Number(p.afternoonCount || 0);
      hit.evening += Number(p.eveningCount || 0);
      hit.midnight += Number(p.midnightCount || 0);
      byDate.set(date, hit);
    });

    const dates = listDatesInclusive(weekRange.fromDate, weekRange.toDate);
    const filledDays = dates.filter(date => byDate.has(date)).length;
    if (!dates.length) {
      rowsEl.innerHTML = '<tr><td colspan="6" class="form-help">이번주 조회 기간이 없습니다.</td></tr>';
      if (summaryEl) summaryEl.textContent = '조회 기간 없음';
      return;
    }

    rowsEl.innerHTML = dates.map(date => {
      const actual = byDate.get(date) || { morning: 0, afternoon: 0, evening: 0, midnight: 0 };
      const targets = computeSlotTargets(setCount, date);
      return `<tr>
        <td><strong class="dashboard-baemin-region-name">${escapeHtml(regionName)}</strong></td>
        <td>${escapeHtml(formatDeliveryDateWithWeekday(date))}</td>
        ${renderCompactQuotaCell(actual.morning, targets.morning)}
        ${renderCompactQuotaCell(actual.afternoon, targets.afternoon)}
        ${renderCompactQuotaCell(actual.evening, targets.evening)}
        ${renderCompactQuotaCell(actual.midnight, targets.midnight)}
      </tr>`;
    }).join('');

    if (summaryEl) {
      summaryEl.textContent = `${regionName} · ${weekRange.fromDate} ~ ${weekRange.toDate} · 데이터 ${formatNumber(filledDays)}/${formatNumber(dates.length)}일 · 이번주 수~오늘`;
    }
    persistWeekDashboardCache();
  }

  async function queryDashboardBaeminWeek(partnerIds = [], options = {}) {
    const rowsEl = $('dashboardBaeminWeekRows');
    const summaryEl = $('dashboardBaeminWeekSummary');
    if (!rowsEl) return;

    const silent = options.silent === true;
    const ids = (partnerIds || []).map(normalizePartnerId).filter(Boolean);
    if (!ids.length) {
      if (!silent) {
        renderDashboardWeekRegionTabs([]);
        if (summaryEl) summaryEl.textContent = '조회할 지역 없음';
        rowsEl.innerHTML = '<tr><td colspan="6" class="form-help">담당 지역이 없습니다.</td></tr>';
      }
      return;
    }

    // 배민현황 지역별 할당 달성과 동일: 이번주 수~오늘
    const thisWeek = computeThisWeekCollectRange();
    const weekRange = {
      fromDate: thisWeek.fromDate,
      toDate: thisWeek.toDate,
      weekEnd: window.BremDatePicker?.weekEndKey?.(thisWeek.fromDate) || addDaysDate(thisWeek.fromDate, 6)
    };

    // 자동 갱신: 기존 표 유지. 수동 조회만 메모리 캐시 비우고 로딩 문구 표시
    if (!options.selectedOnly && !silent) {
      state.dashboardWeekCache = {};
    }
    if (!options.selectedOnly) {
      renderDashboardWeekRegionTabs(ids);
    }

    const selectedId = normalizePartnerId(state.dashboardWeekPartnerId) || ids[0];
    state.dashboardWeekPartnerId = selectedId;
    if (!options.selectedOnly) {
      renderDashboardWeekRegionTabs(ids);
    }

    const keepUi = silent && Boolean(rowsEl.querySelector('.dashboard-baemin-qcell'));
    if (summaryEl && !keepUi) {
      const regionName = state.dashboardBaeminRegions.find(r => r.partnerId === selectedId)?.regionName
        || partnerLabelById(selectedId)
        || selectedId;
      summaryEl.textContent = `${regionName} · ${weekRange.fromDate} ~ ${weekRange.toDate} · 불러오는 중…`;
    }

    let items = null;
    const cached = state.dashboardWeekCache[selectedId];
    const canUseMem = !silent && !options.forceRefresh;
    if (
      canUseMem
      && cached?.items
      && cached.weekRange?.fromDate === weekRange.fromDate
      && cached.weekRange?.toDate === weekRange.toDate
    ) {
      items = cached.items;
    }
    if (!items) {
      const result = await adminApi(
        `/api/admin/baemin-delivery/view-daily-range?partnerId=${encodeURIComponent(selectedId)}&fromDate=${encodeURIComponent(weekRange.fromDate)}&toDate=${encodeURIComponent(weekRange.toDate)}`
      );
      if (!result.ok || result.notApplied) {
        if (!keepUi) {
          rowsEl.innerHTML = `<tr><td colspan="6" class="form-help">${escapeHtml(result.message || '일별 데이터 없음')}</td></tr>`;
          if (summaryEl) summaryEl.textContent = result.message || '일별 데이터 없음';
        }
        return;
      }
      items = result.items || [];
      state.dashboardWeekCache[selectedId] = { items, weekRange };
    }

    renderDashboardWeekRowsForPartner(selectedId, items, weekRange);

    // 나머지 지역은 병렬 백그라운드 캐시 (팀장 지역 탭 전환 빠르게)
    if (!options.selectedOnly) {
      const others = ids.filter(id => id !== selectedId);
      if (others.length) {
        void Promise.allSettled(
          others.map(partnerId => adminApi(
            `/api/admin/baemin-delivery/view-daily-range?partnerId=${encodeURIComponent(partnerId)}&fromDate=${encodeURIComponent(weekRange.fromDate)}&toDate=${encodeURIComponent(weekRange.toDate)}`
          ).then(result => {
            if (result?.ok && !result.notApplied) {
              state.dashboardWeekCache[partnerId] = { items: result.items || [], weekRange };
            }
          }))
        );
      }
    }
  }

  async function queryDashboardBaeminLive(options = {}) {
    const silent = options.silent === true;
    const summary = $('dashboardBaeminLiveSummary');
    const panelsEl = $('dashboardBaeminLivePanels');
    const appliedEl = $('dashboardBaeminAppliedTime');
    const btn = $('dashboardBaeminLiveQueryBtn');
    const card = $('dashboardBaeminLiveCard');
    if (!panelsEl) return;

    if (state.dashboardLiveBusy) return;
    state.dashboardLiveBusy = true;

    if (!state.dashboardBaeminRegions.length) {
      await initDashboardBaeminLive(true);
      if (!state.dashboardBaeminRegions.length) {
        state.dashboardLiveBusy = false;
        return;
      }
    }

    const partnerIds = state.dashboardBaeminRegions.map(r => r.partnerId);
    const today = todayKstDate();

    // 표가 있으면 숫자 유지한 채 소프트 갱신만 — 로딩 문구로 표를 비우지 않음
    const hadTable = Boolean(panelsEl.querySelector('table'));
    if (!silent) {
      btn?.classList.add('is-loading');
      if (btn) btn.textContent = '조회 중…';
      if (!hadTable && summary) summary.textContent = '오늘 스냅샷·할당 불러오는 중…';
      else card?.classList.add('is-soft-refreshing');
    } else {
      card?.classList.add('is-soft-refreshing');
    }

    try {
      if (silent) {
        // 자동 폴링: 적용시각 + 오늘 스냅샷만 (세트수/요일할당은 캐시 재사용)
        await loadViewConfig({ silent: true });
        if (!state.partnerSetCountMap || !Object.keys(state.partnerSetCountMap).length) {
          await loadPartnerSetCountMap();
        }
        if (!state.weekdayQuotaMatrix) {
          await ensureWeekdayQuotaLoaded();
        }
      } else {
        // 대시보드는 저장진단(무거운 전체 스캔)이 필요 없으므로 config는 light로.
        // 적용시각/세트수/요일할당만 새로 불러온다(결과 동일, 속도만 개선).
        await Promise.all([
          loadViewConfig({ silent: true }),
          loadPartnerSetCountMap(),
          ensureWeekdayQuotaLoaded()
        ]);
      }

      const captureDate = state.appliedCollectDate
        || state.config?.applied?.collectDate
        || today;
      const appliedAt = state.config?.applied?.appliedAt || state.config?.applied?.updatedAt || '';
      const queriedAt = new Date();

      const regionRows = [];
      let drivingSum = 0;
      let morningSum = 0;
      let afternoonSum = 0;
      let eveningSum = 0;
      let midnightSum = 0;
      let targetMorning = 0;
      let targetAfternoon = 0;
      let targetEvening = 0;
      let targetMidnight = 0;
      let loadedRegions = 0;
      let itemCount = 0;

      // 지역별 N회 왕복 대신 서버에서 한 번에(인증 1회 + 병렬) 조회. 실패 시 기존 방식으로 폴백.
      let snapshotResults;
      const dash = await adminApi(
        `/api/admin/baemin-delivery/dashboard-live?collectDate=${encodeURIComponent(captureDate)}&partnerIds=${encodeURIComponent(partnerIds.join(','))}`
      );
      if (dash.ok && dash.byPartner) {
        snapshotResults = partnerIds.map(partnerId => {
          const b = dash.byPartner[partnerId];
          return {
            partnerId,
            result: b
              ? { ok: b.ok !== false, items: b.items || [], notApplied: Boolean(b.notApplied), collectDate: b.collectDate || '', message: b.message || '' }
              : { ok: false, items: [], notApplied: false, message: '지역 스냅샷 없음' }
          };
        });
      } else {
        snapshotResults = await Promise.all(
          partnerIds.map(async partnerId => {
            const result = await adminApi(buildViewItemsQuery(captureDate, 'delivery_status', partnerId));
            return { partnerId, result };
          })
        );
      }

      const notAppliedHit = snapshotResults.find(entry => entry.result?.ok && entry.result.notApplied);
      if (notAppliedHit) {
        const result = notAppliedHit.result;
        // 자동갱신: 스냅샷 없음이어도 기존 표는 유지 (0으로 리셋 금지)
        if (!silent) {
          if (summary) {
            summary.textContent = result.message || '적용된 배민현황 스냅샷이 없습니다. BIZ 수집 후 저장하세요.';
          }
          panelsEl.innerHTML = `<p class="form-help">${escapeHtml(result.message || '적용된 스냅샷 없음')}</p>`;
          const weekRows = $('dashboardBaeminWeekRows');
          const weekSummary = $('dashboardBaeminWeekSummary');
          if (weekRows) weekRows.innerHTML = `<tr><td colspan="6" class="form-help">${escapeHtml(result.message || '적용된 스냅샷 없음')}</td></tr>`;
          if (weekSummary) weekSummary.textContent = '스냅샷 없음';
          showToast(result.message || '적용된 스냅샷이 없습니다.');
        }
        return;
      }

      for (const { partnerId, result } of snapshotResults) {
        if (!result?.ok || result.notApplied) continue;

        const items = filterRowsByPartnerId(result.items || [], partnerId);
        itemCount += items.length;
        const totals = aggregateDeliveryStatusMetrics(items);
        const setCount = getPartnerSetCount(partnerId);
        const targets = computeSlotTargets(setCount, today);
        const regionName = state.dashboardBaeminRegions.find(r => r.partnerId === partnerId)?.regionName
          || partnerLabelById(partnerId)
          || partnerId;
        loadedRegions += 1;
        drivingSum += totals.drivingCount;
        morningSum += totals.morningTotal;
        afternoonSum += totals.afternoonTotal;
        eveningSum += totals.eveningTotal;
        midnightSum += totals.midnightTotal;
        targetMorning += targets.morning;
        targetAfternoon += targets.afternoon;
        targetEvening += targets.evening;
        targetMidnight += targets.midnight;
        regionRows.push({
          partnerId,
          regionName,
          setCount,
          drivingCount: totals.drivingCount,
          morningTotal: totals.morningTotal,
          afternoonTotal: totals.afternoonTotal,
          eveningTotal: totals.eveningTotal,
          midnightTotal: totals.midnightTotal,
          targets
        });
      }

      regionRows.sort((a, b) => String(a.regionName).localeCompare(String(b.regionName), 'ko'));

      if (!regionRows.length) {
        if (!silent) {
          panelsEl.innerHTML = '<p class="form-help">조회할 지역 스냅샷이 없습니다.</p>';
          if (summary) summary.textContent = '스냅샷 없음';
        }
        return;
      }

      const nextActivity = dashboardActivityScore({
        drivingSum,
        morningSum,
        afternoonSum,
        eveningSum,
        midnightSum
      });
      const prevActivity = Number(state.dashboardLastActivity || 0);
      if (shouldKeepPreviousDashboardPaint({
        silent,
        hadTable,
        prevActivity,
        itemCount,
        loadedRegions,
        expectedRegions: partnerIds.length
      })) {
        // 빈·불완전 응답은 버리고 이전 숫자 유지 — 다음 폴링에서 다시 시도
        return;
      }

      const nextHtml = renderDashboardTodayTable(regionRows, {
        drivingSum,
        morningSum,
        afternoonSum,
        eveningSum,
        midnightSum,
        targetMorning,
        targetAfternoon,
        targetEvening,
        targetMidnight
      });
      // 적용시각·표는 새 결과가 준비된 뒤에만 교체 (중간 0 깜빡임 방지)
      if (appliedEl) {
        const appliedLabel = appliedAt
          ? `적용시간 ${formatDateTime(appliedAt)}`
          : '적용시간 — (스냅샷 미확인)';
        appliedEl.innerHTML = `${escapeHtml(appliedLabel)}<span class="dashboard-baemin-queried-at"> · 자동조회 ${escapeHtml(formatDateTime(queriedAt.toISOString()))}</span>`;
      }
      panelsEl.innerHTML = nextHtml;

      const summaryText = `오늘 ${today} · 지역 ${formatNumber(loadedRegions)}곳 · 운행중 ${formatNumber(drivingSum)}명 · 세트수 할당 대비`;
      if (summary) {
        summary.textContent = summaryText;
      }
      state.dashboardLastActivity = nextActivity;
      persistTodayDashboardCache(nextActivity);
      // 오늘 확정 후에만 주간 갱신 (실패/빈응답 때 주간까지 0으로 덮지 않음)
      void queryDashboardBaeminWeek(partnerIds, { silent, forceRefresh: silent });
      if (!silent) {
        showToast(`오늘 할당 · 운행중 ${formatNumber(drivingSum)}명 · 지역 ${formatNumber(loadedRegions)}곳`);
      }
    } finally {
      state.dashboardLiveBusy = false;
      state.dashboardLiveFetchedAt = Date.now();
      card?.classList.remove('is-soft-refreshing');
      if (!silent) {
        btn?.classList.remove('is-loading');
        if (btn) btn.textContent = '스냅샷 조회';
      } else if (btn && !btn.classList.contains('is-loading')) {
        btn.textContent = '스냅샷 조회';
      }
    }
  }

  function stopDashboardBaeminLivePoll() {
    if (state.dashboardLivePollTimer) {
      clearInterval(state.dashboardLivePollTimer);
      state.dashboardLivePollTimer = null;
    }
  }

  function startDashboardBaeminLivePoll() {
    stopDashboardBaeminLivePoll();
    // 배민 BIZ 자동수집 반영용 — 2분마다 오늘 스냅샷 조용히 재조회
    const POLL_MS = 2 * 60 * 1000;
    state.dashboardLivePollTimer = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      const dashboard = $('dashboard');
      if (dashboard && !dashboard.classList.contains('active')) return;
      if (state.dashboardLiveBusy) return;
      void queryDashboardBaeminLive({ silent: true });
    }, POLL_MS);
  }

  function openBaeminStatusFromDashboard() {
    try {
      sessionStorage.setItem('brem_baemin_menu_focus', 'delivery_status');
    } catch (_e) { /* ignore */ }
    const btn = document.querySelector('.nav-btn[data-section="baemin-status"]');
    if (btn) {
      btn.click();
      return;
    }
    document.dispatchEvent(new CustomEvent('brem-admin-goto-section', { detail: { sectionId: 'baemin-status' } }));
  }

  function bindEvents() {
    if (bindEvents.bound) return;
    bindEvents.bound = true;
    initBaeminServiceBreakdownTables();

    $('baeminDeliverySessionRefreshBtn')?.addEventListener('click', () => {
      void startSessionRefresh();
    });

    $('baeminBrowserOpenBtn')?.addEventListener('click', () => {
      void openLocalBrowser();
    });

    $('baeminFullCollectBtn')?.addEventListener('click', () => {
      void runFullCollect();
    });

    $('baeminWeekFullCollectBtn')?.addEventListener('click', () => {
      void runWeekFullCollect();
    });

    $('baeminDeliveryOnlyCollectBtn')?.addEventListener('click', () => {
      void runDeliveryOnlyCollect();
    });

    $('baeminServerShutdownBtn')?.addEventListener('click', () => {
      void shutdownLocalServer();
    });

    $('baeminDeliveryAutoCollectBtn')?.addEventListener('click', () => {
      void runFullCollect();
    });

    $('baeminDeliveryJsonPasteBtn')?.addEventListener('click', () => {
      openJsonDialog();
    });

    $('baeminDeliveryManualCookieSaveBtn')?.addEventListener('click', () => {
      void saveManualCookie();
    });

    $('baeminDeliveryJsonSubmitBtn')?.addEventListener('click', () => {
      void submitJsonImport();
    });

    $('baeminDeliveryJsonCancelBtn')?.addEventListener('click', () => {
      closeJsonDialog();
    });

    $('baeminDeliverySessionDialogCloseBtn')?.addEventListener('click', () => {
      closeSetupDialog();
    });

    $('baeminDeliveryApplyBtn')?.addEventListener('click', () => {
      void applyToErp();
    });

    $('baeminRiderLiveSyncBtn')?.addEventListener('click', () => {
      void runRiderLiveSyncOnce();
    });

    $('baeminStatusAutoLoopStartBtn')?.addEventListener('click', () => {
      void startStatusAutoLoop();
    });

    $('baeminStatusAutoLoopStopBtn')?.addEventListener('click', () => {
      void stopStatusAutoLoop();
    });

    $('baeminMorningRunBtn')?.addEventListener('click', () => {
      void runMorningOneButton();
    });
    $('crawlMorningStartBtn')?.addEventListener('click', () => {
      void runMorningOneButton();
    });
    $('coupangNaverMailOpenBtn')?.addEventListener('click', () => {
      void openCoupangNaverMail();
    });
    $('coupangAuthRecoverBtn')?.addEventListener('click', () => {
      void recoverCoupangAuthWithNaver();
    });
    void refreshCrawlOperatorAccess();

    $('baeminDeliveryScrubDupBtn')?.addEventListener('click', () => {
      void scrubDuplicatePartners();
    });

    $('baeminDeliveryPurgeCollectBtn')?.addEventListener('click', () => {
      void purgeCollectDateData();
    });

    $('baeminDeliveryCaptureDate')?.addEventListener('change', () => {
      state.bizPreviewCollectDate = $('baeminDeliveryCaptureDate')?.value || '';
      invalidateDataCache();
      void loadLatestSummary();
      if (!isViewSection()) {
        state.activePartnerId = '';
        void loadAllSubtabData();
      }
    });

    $('baeminPartnerRegionForm')?.addEventListener('submit', event => {
      event.preventDefault();
      if (!isViewSection() || !state.canManageRegions) return;
      void savePartnerRegionEntry(
        $('baeminPartnerRegionDp')?.value || '',
        $('baeminPartnerRegionName')?.value || ''
      );
    });

    $('baeminStatusLoadBtn')?.addEventListener('click', () => {
      void loadViewData();
    });

    $('baeminStatusWeekLoadBtn')?.addEventListener('click', () => {
      void loadViewWeekMenuData();
    });
    $('baeminStatusRangeLoadBtn')?.addEventListener('click', () => {
      if (state.activeMenu === 'daily_history') {
        void loadDailyHistoryData();
        return;
      }
      void loadRiderHistoryData();
    });
    $('baeminStatusDeliveryLoadBtn')?.addEventListener('click', () => {
      void loadDeliveryStatusData();
    });
    $('dashboardBaeminLiveQueryBtn')?.addEventListener('click', () => {
      void queryDashboardBaeminLive();
    });
    $('dashboardBaeminOpenStatusBtn')?.addEventListener('click', () => {
      openBaeminStatusFromDashboard();
    });
    // 초기 로딩 부담 완화: 파싱 시점(=로그인 화면)에는 조회하지 않는다.
    // 대시보드 렌더에서 refreshDashboardBaeminLive() 가 지역 조회와 폴러를 시작한다.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        const dashboard = $('dashboard');
        if (dashboard?.classList.contains('active') && !state.dashboardLiveBusy) {
          void queryDashboardBaeminLive({ silent: true });
        }
      }
    });
    $('baeminStatusAcceptRateLoadBtn')?.addEventListener('click', () => {
      void loadAcceptRateLiveData();
    });
    $('baeminStatusRiderFromDate')?.addEventListener('change', event => {
      event.target.dataset.touched = '1';
      state.riderViewFromDate = String(event.target.value || '').slice(0, 10);
      invalidateDataCache();
    });
    $('baeminStatusRiderToDate')?.addEventListener('change', event => {
      event.target.dataset.touched = '1';
      state.riderViewToDate = String(event.target.value || '').slice(0, 10);
      invalidateDataCache();
    });

    $('baeminDailyCollectBtn')?.addEventListener('click', () => {
      void runDailyOnlyCollect();
    });

    $('baeminRiderCollectBtn')?.addEventListener('click', () => {
      void runRiderOnlyCollect();
    });

    $('baeminRiderCoverageLoadBtn')?.addEventListener('click', () => {
      void loadHistoryCollectCoverage('rider_history');
    });
    $('baeminDailyCoverageLoadBtn')?.addEventListener('click', () => {
      void loadHistoryCollectCoverage('daily_history');
    });
    $('baeminSyncCoverageLoadBtn')?.addEventListener('click', () => {
      void loadSyncReflectionStatus();
    });
    ['baeminSyncFromDate', 'baeminSyncToDate', 'baeminSyncFromDate2', 'baeminSyncToDate2'].forEach(id => {
      $(id)?.addEventListener('change', () => {
        if (state.activeMenu === 'calls_rejection_sync') {
          void loadSyncReflectionStatus({ silent: true });
        }
      });
    });
    $('baeminSyncThisWeekBtn')?.addEventListener('click', () => {
      applySyncThisWeekRange();
      if (state.activeMenu === 'calls_rejection_sync') {
        void loadSyncReflectionStatus({ silent: true });
      }
    });
    $('baeminSyncThisWeekBtn2')?.addEventListener('click', () => {
      applySyncThisWeekRange();
      if (state.activeMenu === 'calls_rejection_sync') {
        void loadSyncReflectionStatus({ silent: true });
      }
    });
    $('baeminRiderCoverageMissingOnly')?.addEventListener('change', () => {
      const cached = state.lastCoverage?.rider_history;
      if (cached) renderCoverageTable('rider_history', cached);
    });
    $('baeminDailyCoverageMissingOnly')?.addEventListener('change', () => {
      const cached = state.lastCoverage?.daily_history;
      if (cached) renderCoverageTable('daily_history', cached);
    });

    $('baeminDailyCollectRangeSaveBtn')?.addEventListener('click', () => {
      void saveDailyCollectRangeFromUi();
    });

    $('baeminDailyCollectThisWeekBtn')?.addEventListener('click', () => {
      void applyAndSaveThisWeekCollectRange('daily');
    });

    $('baeminRiderCollectRangeSaveBtn')?.addEventListener('click', () => {
      void saveRiderCollectRangeFromUi();
    });

    $('baeminRiderCollectThisWeekBtn')?.addEventListener('click', () => {
      void applyAndSaveThisWeekCollectRange('rider');
    });

    $('baeminStatusThisWeekBtn')?.addEventListener('click', () => {
      void applyAndSaveThisWeekCollectRange('status');
    });

    $('baeminStatusSetCountSaveBtn')?.addEventListener('click', () => {
      void savePartnerSetCount();
    });

    $('baeminStatusWeekdayQuotaSaveBtn')?.addEventListener('click', () => {
      void saveWeekdayQuotaMatrix();
    });

    $('baeminStatusWeekdayQuotaResetBtn')?.addEventListener('click', () => {
      void resetWeekdayQuotaEditorToDefaults();
    });

    $('baeminStatusWeekStart')?.addEventListener('change', () => {
      if (!isViewSection()) return;
      handleWeekSelect($('baeminStatusWeekStart')?.value || '');
    });

    ['baeminStatusMenuSubtabBar', 'baeminBizMenuSubtabBar'].forEach(barId => {
      $(barId)?.querySelectorAll('[data-baemin-menu]').forEach(btn => {
        btn.addEventListener('click', () => {
          switchBaeminMenu(btn.dataset.baeminMenu || 'delivery_status');
        });
      });
    });
  }

  async function refresh(sectionId) {
    const nextSection = String(sectionId || state.activeSection || 'baemin-biz-status').trim();
    if (state.activeSection !== nextSection) {
      stopPolling();
      state.activePartnerId = '';
      state.partners = [];
      invalidateDataCache();
    }
    state.activeSection = nextSection;
    bindEvents();
    const dateInput = $('baeminDeliveryCaptureDate');
    if (dateInput && !dateInput.value) {
      dateInput.value = todayKstDate();
    }
    ensureBizCollectWeekStart();
    syncBizCollectWeekPicker();
    applyBizWeekToCollectRangeInputs(state.bizCollectWeekStart);

    if (isViewSection()) {
      try {
        const focus = sessionStorage.getItem('brem_baemin_menu_focus');
        if (focus && VIEW_MENU_IDS.includes(focus)) {
          state.activeMenu = focus;
          sessionStorage.removeItem('brem_baemin_menu_focus');
        }
      } catch (_error) {
        /* ignore */
      }
      if (!state.activeMenu) state.activeMenu = 'delivery_status';
      ensureViewWeekStart();
      syncViewWeekPicker();
      updateWeekPickerVisibility();
      invalidateDataCache();
      state.viewLoaded = false;
      state.lastClientRefreshAt = '';
      state.grandTotals = null;
      renderRefreshMeta();
      clearViewTablesIdle();
      state.partnerRegionMap = {};
      state.viewPartnerIds = [];
      state.partners = [];
      renderPartnerTabs([]);
      void loadPartnerRegionMap();
      void loadPartnerSetCountMap();
      void ensureWeekdayQuotaLoaded(true);
      void loadViewConfig();
      updatePanelVisibility();
      return;
    }

    await loadPartnerRegionMap();

    stopStatusPoll();
    await loadPublicLocalSessionConfig();
    await loadConfig();
    await Promise.all([loadDailyCollectRange(), loadRiderCollectRange()]);
    await loadLatestSummary();
    await loadAllSubtabData();

    state.statusPollTimer = setInterval(async () => {
      await loadConfig({ light: true });
    }, 15000);

    stopLocalHealthPoll();
    state.localHealthPollTimer = setInterval(async () => {
      await refreshLocalServerStatus();
    }, 4000);
  }

  function stopLocalHealthPoll() {
    if (state.localHealthPollTimer) {
      clearInterval(state.localHealthPollTimer);
      state.localHealthPollTimer = null;
    }
  }

  function stopPolling() {
    stopStatusPoll();
    stopLocalHealthPoll();
    stopSetupPoll();
  }

  window.BremBaeminDeliveryStatusAdmin = {
    refresh,
    stopPolling,
    handleWeekSelect,
    handleBizCollectWeekSelect,
    handleCoverageWeekSelect,
    loadViewData,
    showToast,
    adminApi,
    getSyncContext,
    applySyncThisWeekRange,
    syncSyncDateInputs,
    ensureSyncDateRangeDefaults,
    resolveSyncDateRange,
    loadSyncReflectionStatus,
    // 대시보드 진입: 마지막 스냅샷 즉시 표시 → 바로 조용히 최신 조회.
    // 재렌더 스팸 방지는 60초 스로틀. 2분 폴러로 이후 자동 갱신.
    refreshDashboardBaeminLive: () => {
      if (!state.dashboardLivePollTimer) startDashboardBaeminLivePoll();
      paintDashboardCacheInstant();
      const hadRegions = state.dashboardBaeminRegions.length > 0;
      if (!hadRegions) {
        void initDashboardBaeminLive(false);
        return;
      }
      if (state.dashboardLiveBusy) return;
      const staleMs = Date.now() - (state.dashboardLiveFetchedAt || 0);
      const weekEmpty = !$('dashboardBaeminWeekRows')?.querySelector('.dashboard-baemin-qcell');
      if (staleMs < 60 * 1000 && !weekEmpty) return;
      void queryDashboardBaeminLive({ silent: true });
    }
  };
  bindEvents();
  // 탑바 「크롤링 시작」은 배민 섹션 진입 전에도 권한 확인 (세션 준비 후 재확인)
  void refreshCrawlOperatorAccess();
  document.addEventListener('brem-admin-session-ready', () => {
    void refreshCrawlOperatorAccess();
  });
  // 스크립트 로드 직후(이미 세션 있는 새로고침)에도 캐시 선표시
  paintDashboardCacheInstant();
})();
