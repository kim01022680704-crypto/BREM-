const BremDatePicker = (function () {
  function today() {
    const now = new Date();
    return [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0')
    ].join('-');
  }

  function dateKey(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

  function parseLocalDate(value) {
    const raw = String(value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
    const date = new Date(`${raw}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatDate(value) {
    const date = parseLocalDate(value);
    if (!date) return '';
    return new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date);
  }

  function formatWeekdayKo(value) {
    const date = parseLocalDate(value);
    return date ? WEEKDAY_KO[date.getDay()] : '';
  }

  function isWednesday(value) {
    const date = parseLocalDate(value);
    return Boolean(date && date.getDay() === 3);
  }

  function monthKeyFromDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  function currentMonth() {
    return monthKeyFromDate(new Date());
  }

  function formatMonthLabel(value, emptyLabel = '월 선택') {
    if (!value || !/^\d{4}-\d{2}$/.test(value)) return emptyLabel;
    const [year, month] = value.split('-');
    return `${year}년 ${month}월`;
  }

  function positionMonthPopup(popup, anchor, zIndex = 1400) {
    const rect = anchor.getBoundingClientRect();
    popup.hidden = false;
    popup.style.position = 'fixed';
    popup.style.top = `${Math.min(rect.bottom + 8, window.innerHeight - 340)}px`;
    popup.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - 340))}px`;
    popup.style.zIndex = String(zIndex);
  }

  function renderMonthGrid({ monthsContainer, titleEl, viewYear, selectedMonth, monthAttr }) {
    titleEl.textContent = `${viewYear}년`;
    const todayMonth = currentMonth();
    let html = '';
    for (let month = 1; month <= 12; month += 1) {
      const key = `${viewYear}-${String(month).padStart(2, '0')}`;
      const classes = [
        'month-cell',
        key === selectedMonth ? 'selected' : '',
        key === todayMonth ? 'today' : ''
      ].filter(Boolean).join(' ');
      html += `<button type="button" class="${classes}" ${monthAttr}="${key}">${month}월</button>`;
    }
    monthsContainer.innerHTML = html;
  }

  function positionPopup(popup, anchor, zIndex = 1400) {
    const rect = anchor.getBoundingClientRect();
    popup.hidden = false;
    popup.style.position = 'fixed';
    popup.style.top = `${Math.min(rect.bottom + 8, window.innerHeight - 420)}px`;
    popup.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - 372))}px`;
    popup.style.zIndex = String(zIndex);
  }

  function renderCalendar({ daysContainer, titleEl, viewDate, selectedDate, dayAttr, wednesdayOnly = false }) {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    titleEl.textContent = `${year}년 ${month + 1}월`;

    const first = new Date(year, month, 1);
    const cursor = new Date(first);
    cursor.setDate(first.getDate() - first.getDay());

    const currentMonth = monthKeyFromDate(viewDate);
    const todayKey = today();
    let html = '';
    for (let i = 0; i < 42; i++) {
      const key = dateKey(cursor);
      const isWednesday = cursor.getDay() === 3;
      const disabled = wednesdayOnly && !isWednesday;
      const classes = [
        'calendar-day',
        monthKeyFromDate(cursor) !== currentMonth ? 'muted' : '',
        key === selectedDate ? 'selected' : '',
        key === todayKey ? 'today' : '',
        wednesdayOnly && isWednesday ? 'pickable-wednesday' : '',
        disabled ? 'disabled' : ''
      ].filter(Boolean).join(' ');
      if (disabled) {
        html += `<span class="${classes}" aria-hidden="true">${cursor.getDate()}</span>`;
      } else {
        html += `<button type="button" class="${classes}" ${dayAttr}="${key}">${cursor.getDate()}</button>`;
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    daysContainer.innerHTML = html;
  }

  function weekStartKey(dateValue = today()) {
    const date = parseLocalDate(dateValue) || parseLocalDate(today());
    if (!date) return today();
    const day = date.getDay();
    const diff = (day - 3 + 7) % 7;
    date.setDate(date.getDate() - diff);
    return dateKey(date);
  }

  /** 주정산 시작일이 화요일로 하루 밀린 경우 다음날 수요일로 보정 */
  function applyWeekWednesday(dateValue) {
    const date = parseLocalDate(dateValue);
    if (!date) return weekStartKey(dateValue);
    const day = date.getDay();
    if (day === 3) return dateKey(date);
    if (day === 2) {
      date.setDate(date.getDate() + 1);
      return dateKey(date);
    }
    return weekStartKey(dateValue);
  }

  function weekEndKey(weekStart) {
    const date = parseLocalDate(applyWeekWednesday(weekStart));
    if (!date) return '';
    date.setDate(date.getDate() + 6);
    return dateKey(date);
  }

  function formatWednesdayWeekRange(weekStart) {
    const normalized = applyWeekWednesday(weekStart);
    if (!normalized) return '';
    const end = weekEndKey(normalized);
    return `${formatDate(normalized)}(${formatWeekdayKo(normalized)}) ~ ${formatDate(end)}(${formatWeekdayKo(end)})`;
  }

  function setupSingle(options) {
    const {
      popup,
      daysContainer,
      titleEl,
      prevBtn,
      nextBtn,
      hiddenInput,
      openButton,
      dayAttr = 'data-pick-date',
      emptyLabel = '날짜 선택',
      onSelect
    } = options;

    const state = {
      viewDate: new Date(`${hiddenInput.value || today()}T00:00:00`)
    };

    function refreshButtonLabel() {
      openButton.textContent = hiddenInput.value ? formatDate(hiddenInput.value) : emptyLabel;
    }

    function render() {
      renderCalendar({
        daysContainer,
        titleEl,
        viewDate: state.viewDate,
        selectedDate: hiddenInput.value || '',
        dayAttr
      });
    }

    function open() {
      state.viewDate = new Date(`${hiddenInput.value || today()}T00:00:00`);
      render();
      positionPopup(popup, openButton);
    }

    function close() {
      popup.hidden = true;
    }

    function selectDate(value) {
      hiddenInput.value = value;
      refreshButtonLabel();
      onSelect?.(value);
      close();
    }

    openButton.addEventListener('click', event => {
      event.preventDefault();
      open();
    });

    prevBtn.addEventListener('click', event => {
      event.stopPropagation();
      state.viewDate.setMonth(state.viewDate.getMonth() - 1);
      render();
    });

    nextBtn.addEventListener('click', event => {
      event.stopPropagation();
      state.viewDate.setMonth(state.viewDate.getMonth() + 1);
      render();
    });

    daysContainer.addEventListener('click', event => {
      const dayButton = event.target.closest(`[${dayAttr}]`);
      if (!dayButton) return;
      event.stopPropagation();
      selectDate(dayButton.getAttribute(dayAttr));
    });

    document.addEventListener('click', event => {
      if (popup.hidden) return;
      if (event.target.closest(`#${popup.id}`) || event.target === openButton || openButton.contains(event.target)) return;
      close();
    });

    refreshButtonLabel();

    return {
      setDate(value) {
        hiddenInput.value = value || '';
        refreshButtonLabel();
      },
      refreshButtonLabel
    };
  }

  function setupDelegated(options) {
    const {
      popup,
      daysContainer,
      titleEl,
      prevBtn,
      nextBtn,
      openSelector,
      dayAttr = 'data-pick-date',
      getContext
    } = options;

    const state = {
      viewDate: new Date(`${today()}T00:00:00`),
      active: null
    };

    function render() {
      const selectedDate = state.active?.hiddenInput.value || '';
      renderCalendar({
        daysContainer,
        titleEl,
        viewDate: state.viewDate,
        selectedDate,
        dayAttr
      });
    }

    function close() {
      popup.hidden = true;
      state.active = null;
    }

    document.addEventListener('click', event => {
      const openButton = event.target.closest(openSelector);
      if (openButton) {
        event.preventDefault();
        state.active = getContext(openButton);
        if (!state.active) return;
        state.viewDate = new Date(`${state.active.hiddenInput.value || today()}T00:00:00`);
        render();
        positionPopup(popup, openButton);
        return;
      }

      const dayButton = event.target.closest(`[${dayAttr}]`);
      if (dayButton && state.active) {
        event.stopPropagation();
        const value = dayButton.getAttribute(dayAttr);
        state.active.hiddenInput.value = value;
        state.active.refreshButtonLabel?.();
        state.active.onSelect?.(value);
        state.active.hiddenInput.dispatchEvent(new Event('input', { bubbles: true }));
        state.active.hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
        close();
        return;
      }

      if (popup.hidden) return;
      if (event.target.closest(`#${popup.id}`) || event.target.closest(openSelector)) return;
      close();
    });

    prevBtn.addEventListener('click', event => {
      event.stopPropagation();
      if (popup.hidden) return;
      state.viewDate.setMonth(state.viewDate.getMonth() - 1);
      render();
    });

    nextBtn.addEventListener('click', event => {
      event.stopPropagation();
      if (popup.hidden) return;
      state.viewDate.setMonth(state.viewDate.getMonth() + 1);
      render();
    });
  }

  function setupMonthSingle(options) {
    const {
      popup,
      monthsContainer,
      titleEl,
      prevBtn,
      nextBtn,
      todayBtn,
      hiddenInput,
      openButton,
      labelEl,
      monthAttr = 'data-pick-month',
      emptyLabel = '월 선택',
      onSelect
    } = options;

    const state = {
      viewYear: hiddenInput.value
        ? Number(hiddenInput.value.split('-')[0])
        : new Date().getFullYear()
    };

    function refreshLabels() {
      const text = formatMonthLabel(hiddenInput.value, emptyLabel);
      if (labelEl) {
        labelEl.textContent = text;
      } else if (openButton) {
        openButton.textContent = text;
      }
    }

    function render() {
      renderMonthGrid({
        monthsContainer,
        titleEl,
        viewYear: state.viewYear,
        selectedMonth: hiddenInput.value || '',
        monthAttr
      });
    }

    function open() {
      state.viewYear = hiddenInput.value
        ? Number(hiddenInput.value.split('-')[0])
        : new Date().getFullYear();
      render();
      positionMonthPopup(popup, openButton);
    }

    function close() {
      popup.hidden = true;
    }

    function selectMonth(value) {
      hiddenInput.value = value;
      refreshLabels();
      onSelect?.(value);
      close();
    }

    openButton.addEventListener('click', event => {
      event.preventDefault();
      open();
    });

    prevBtn.addEventListener('click', event => {
      event.stopPropagation();
      state.viewYear -= 1;
      render();
    });

    nextBtn.addEventListener('click', event => {
      event.stopPropagation();
      state.viewYear += 1;
      render();
    });

    todayBtn?.addEventListener('click', event => {
      event.stopPropagation();
      selectMonth(currentMonth());
    });

    monthsContainer.addEventListener('click', event => {
      const monthButton = event.target.closest(`[${monthAttr}]`);
      if (!monthButton) return;
      event.stopPropagation();
      selectMonth(monthButton.getAttribute(monthAttr));
    });

    document.addEventListener('click', event => {
      if (popup.hidden) return;
      if (event.target.closest(`#${popup.id}`) || event.target === openButton || openButton.contains(event.target)) return;
      close();
    });

    refreshLabels();

    return {
      setMonth(value) {
        hiddenInput.value = value || '';
        refreshLabels();
      },
      refreshLabels
    };
  }

  function setupWednesdayWeekDelegated(options) {
    const {
      popup,
      daysContainer,
      titleEl,
      prevBtn,
      nextBtn,
      todayBtn,
      openSelector,
      dayAttr = 'data-pick-wednesday',
      getContext
    } = options;

    const state = {
      viewDate: new Date(`${today()}T00:00:00`),
      active: null
    };

    function refreshContextLabels(context) {
      const value = context.hiddenInput.value;
      if (!context.labelEl) return;
      if (!value) {
        context.labelEl.textContent = '수요일 선택';
        return;
      }
      const normalized = applyWeekWednesday(value);
      const weekday = formatWeekdayKo(normalized);
      context.labelEl.textContent = weekday
        ? `${formatDate(normalized)}(${weekday})`
        : formatDate(normalized);
    }

    function render() {
      const selectedDate = state.active?.hiddenInput.value || '';
      renderCalendar({
        daysContainer,
        titleEl,
        viewDate: state.viewDate,
        selectedDate,
        dayAttr,
        wednesdayOnly: true
      });
    }

    function close() {
      popup.hidden = true;
      state.active = null;
    }

    function selectDate(context, value) {
      const normalized = applyWeekWednesday(value);
      context.hiddenInput.value = normalized;
      refreshContextLabels(context);
      context.onSelect?.(normalized);
      close();
    }

    document.addEventListener('click', event => {
      const openButton = event.target.closest(openSelector);
      if (openButton) {
        event.preventDefault();
        event.stopPropagation();
        state.active = getContext(openButton);
        if (!state.active?.hiddenInput) return;
        state.viewDate = new Date(`${state.active.hiddenInput.value || weekStartKey()}T00:00:00`);
        render();
        positionPopup(popup, openButton);
        return;
      }

      const dayButton = event.target.closest(`[${dayAttr}]`);
      if (dayButton && state.active) {
        event.stopPropagation();
        selectDate(state.active, dayButton.getAttribute(dayAttr));
        return;
      }

      if (popup.hidden) return;
      if (event.target.closest(`#${popup.id}`) || event.target.closest(openSelector)) return;
      close();
    });

    prevBtn.addEventListener('click', event => {
      event.stopPropagation();
      if (popup.hidden) return;
      state.viewDate.setMonth(state.viewDate.getMonth() - 1);
      render();
    });

    nextBtn.addEventListener('click', event => {
      event.stopPropagation();
      if (popup.hidden) return;
      state.viewDate.setMonth(state.viewDate.getMonth() + 1);
      render();
    });

    todayBtn?.addEventListener('click', event => {
      event.stopPropagation();
      if (!state.active) return;
      selectDate(state.active, weekStartKey());
    });
  }

  return {
    today,
    currentMonth,
    weekStartKey,
    applyWeekWednesday,
    weekEndKey,
    isWednesday,
    formatDate,
    formatWeekdayKo,
    formatWednesdayWeekRange,
    formatMonthLabel,
    setupSingle,
    setupDelegated,
    setupMonthSingle,
    setupWednesdayWeekDelegated
  };
})();
