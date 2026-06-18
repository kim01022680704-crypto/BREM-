(function () {
  const schedules = BremStorage.adminSchedules;
  if (!schedules) return;

  const state = {
    viewDate: new Date(),
    selectedDate: '',
    selectedIds: new Set(),
    detailId: ''
  };

  const daysEl = document.getElementById('adminScheduleDays');
  const monthTitleEl = document.getElementById('adminScheduleMonthTitle');
  const selectedDateLabelEl = document.getElementById('adminScheduleSelectedDateLabel');
  const selectedCountEl = document.getElementById('adminScheduleSelectedCount');
  const listToolbarEl = document.getElementById('adminScheduleListToolbar');
  const selectAllEl = document.getElementById('adminScheduleSelectAll');
  const bulkDeleteEl = document.getElementById('adminScheduleBulkDelete');
  const dayListEl = document.getElementById('adminScheduleDayList');
  const formEl = document.getElementById('adminScheduleForm');
  const editIdEl = document.getElementById('adminScheduleEditId');
  const createdByEl = document.getElementById('adminScheduleCreatedBy');
  const titleEl = document.getElementById('adminScheduleTitle');
  const memoEl = document.getElementById('adminScheduleMemo');
  const submitEl = document.getElementById('adminScheduleSubmit');
  const cancelEditEl = document.getElementById('adminScheduleCancelEdit');
  const detailEl = document.getElementById('adminScheduleDetail');
  const detailDateEl = document.getElementById('adminScheduleDetailDate');
  const detailTitleEl = document.getElementById('adminScheduleDetailTitle');
  const detailCreatorEl = document.getElementById('adminScheduleDetailCreator');
  const detailBodyEl = document.getElementById('adminScheduleDetailBody');
  const detailEditEl = document.getElementById('adminScheduleDetailEdit');

  function todayKey() {
    return BremDatePicker.today();
  }

  function dateKey(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function monthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  function formatDateLabel(value) {
    if (!value) return '날짜를 선택하세요';
    return BremDatePicker.formatDate(value);
  }

  function currentAdmin() {
    return BremStorage.auth.getAdminSessionAccount();
  }

  function defaultCreatorName() {
    return currentAdmin()?.name || '';
  }

  function creatorLabel(item) {
    return item.createdBy || '미확인';
  }

  function truncateText(value, max = 42) {
    const text = String(value || '').trim();
    if (text.length <= max) return text;
    return `${text.slice(0, max)}…`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showToast(message) {
    document.dispatchEvent(new CustomEvent('brem-admin-toast', { detail: { message } }));
  }

  function schedulesByDate(monthItems) {
    const map = new Map();
    monthItems.forEach(item => {
      if (!map.has(item.date)) map.set(item.date, []);
      map.get(item.date).push(item);
    });
    map.forEach(list => list.sort((a, b) => schedules.sortValue(a).localeCompare(schedules.sortValue(b))));
    return map;
  }

  function dayItems() {
    return state.selectedDate ? schedules.getByDate(state.selectedDate) : [];
  }

  function findItem(id) {
    return schedules.getAll().find(item => item.id === id) || null;
  }

  function pruneSelectedIds() {
    const validIds = new Set(dayItems().map(item => item.id));
    state.selectedIds.forEach(id => {
      if (!validIds.has(id)) state.selectedIds.delete(id);
    });
  }

  function updateSelectionUi(items = dayItems()) {
    const selectedCount = items.filter(item => state.selectedIds.has(item.id)).length;
    if (bulkDeleteEl) {
      bulkDeleteEl.disabled = selectedCount === 0;
      bulkDeleteEl.textContent = selectedCount > 0 ? `선택 삭제 (${selectedCount})` : '선택 삭제';
    }
    if (selectAllEl) {
      selectAllEl.checked = items.length > 0 && selectedCount === items.length;
      selectAllEl.indeterminate = selectedCount > 0 && selectedCount < items.length;
    }
  }

  function closeDetail() {
    state.detailId = '';
    if (detailEl) detailEl.hidden = true;
    renderDayList();
  }

  function openDetail(id) {
    const item = findItem(id);
    if (!item) return;

    state.detailId = id;
    if (detailDateEl) detailDateEl.textContent = formatDateLabel(item.date);
    if (detailTitleEl) detailTitleEl.textContent = item.title || '';
    if (detailCreatorEl) detailCreatorEl.textContent = `등록자: ${creatorLabel(item)}`;
    if (detailBodyEl) {
      detailBodyEl.textContent = item.memo?.trim() || '등록된 세부 내용이 없습니다.';
    }
    if (detailEditEl) detailEditEl.dataset.editSchedule = item.id;
    if (detailEl) detailEl.hidden = false;
    renderDayList();
  }

  function resetForm() {
    if (editIdEl) editIdEl.value = '';
    formEl?.reset();
    if (createdByEl) createdByEl.value = defaultCreatorName();
    if (submitEl) submitEl.textContent = '일정 등록';
    if (cancelEditEl) cancelEditEl.hidden = true;
  }

  function fillForm(item) {
    if (!item) {
      resetForm();
      return;
    }
    if (editIdEl) editIdEl.value = item.id;
    if (createdByEl) createdByEl.value = item.createdBy || defaultCreatorName();
    if (titleEl) titleEl.value = item.title || '';
    if (memoEl) memoEl.value = item.memo || '';
    if (submitEl) submitEl.textContent = '일정 수정';
    if (cancelEditEl) cancelEditEl.hidden = false;
  }

  function renderDayList() {
    if (!dayListEl) return;

    if (!state.selectedDate) {
      if (listToolbarEl) listToolbarEl.hidden = true;
      dayListEl.innerHTML = '<div class="empty">달력에서 날짜를 클릭하세요.</div>';
      if (selectedCountEl) selectedCountEl.textContent = '등록된 일정 0건';
      updateSelectionUi([]);
      return;
    }

    const items = dayItems();
    pruneSelectedIds();

    if (listToolbarEl) listToolbarEl.hidden = items.length === 0;
    if (selectedCountEl) {
      selectedCountEl.textContent = `등록된 일정 ${items.length}건`;
    }

    dayListEl.innerHTML = items.length
      ? items.map(item => `
          <article class="admin-schedule-item ${state.detailId === item.id ? 'is-detail-open' : ''} ${editIdEl?.value === item.id ? 'is-editing' : ''}">
            <div class="admin-schedule-item-row">
              <input
                type="checkbox"
                class="admin-schedule-item-check"
                data-schedule-select="${item.id}"
                ${state.selectedIds.has(item.id) ? 'checked' : ''}
                aria-label="${escapeHtml(item.title)} 선택"
              >
              <button type="button" class="admin-schedule-item-open" data-view-schedule="${item.id}">
                <span class="admin-schedule-item-head">
                  <strong>${escapeHtml(item.title)}</strong>
                  <span class="admin-schedule-creator">등록: ${escapeHtml(creatorLabel(item))}</span>
                </span>
                ${item.memo
                  ? `<span class="admin-schedule-item-preview">${escapeHtml(truncateText(item.memo))}</span>`
                  : '<span class="admin-schedule-item-preview admin-schedule-item-preview--empty">세부 내용 보기</span>'}
              </button>
            </div>
            <div class="notice-actions">
              <button type="button" class="small-btn" data-edit-schedule="${item.id}">수정</button>
            </div>
          </article>
        `).join('')
      : '<div class="empty">등록된 일정이 없습니다. 아래에서 추가하세요.</div>';

    updateSelectionUi(items);
  }

  function renderCalendar() {
    if (!daysEl || !monthTitleEl) return;

    const year = state.viewDate.getFullYear();
    const month = state.viewDate.getMonth();
    monthTitleEl.textContent = `${year}년 ${month + 1}월`;

    const monthItems = schedules.getByMonth(monthKey(state.viewDate));
    const grouped = schedulesByDate(monthItems);
    const currentMonth = monthKey(state.viewDate);
    const today = todayKey();

    const first = new Date(year, month, 1);
    const cursor = new Date(first);
    cursor.setDate(first.getDate() - first.getDay());

    let html = '';
    for (let i = 0; i < 42; i += 1) {
      const key = dateKey(cursor);
      const dayScheduleItems = grouped.get(key) || [];
      const isMuted = monthKey(cursor) !== currentMonth;
      const isSelected = key === state.selectedDate;
      const isToday = key === today;
      const classes = [
        'admin-schedule-day',
        isMuted ? 'is-muted' : '',
        isSelected ? 'is-selected' : '',
        isToday ? 'is-today' : '',
        dayScheduleItems.length ? 'has-events' : ''
      ].filter(Boolean).join(' ');

      const chips = dayScheduleItems.slice(0, 2).map(item => `
        <span class="admin-schedule-chip">${escapeHtml(item.title)}</span>
      `).join('');
      const more = dayScheduleItems.length > 2
        ? `<span class="admin-schedule-chip admin-schedule-chip--more">+${dayScheduleItems.length - 2}</span>`
        : '';

      html += `
        <button type="button" class="${classes}" data-schedule-date="${key}">
          <span class="admin-schedule-day-num">${cursor.getDate()}</span>
          <span class="admin-schedule-day-events">${chips}${more}</span>
        </button>
      `;
      cursor.setDate(cursor.getDate() + 1);
    }

    daysEl.innerHTML = html;
    if (selectedDateLabelEl) {
      selectedDateLabelEl.textContent = formatDateLabel(state.selectedDate);
    }
    renderDayList();
  }

  function selectDate(value) {
    state.selectedDate = value;
    state.selectedIds.clear();
    closeDetail();
    resetForm();
    renderCalendar();
  }

  function refresh() {
    if (state.detailId && !findItem(state.detailId)) {
      closeDetail();
    } else if (state.detailId) {
      openDetail(state.detailId);
    }
    renderCalendar();
  }

  function bindEvents() {
    document.getElementById('adminSchedulePrev')?.addEventListener('click', () => {
      state.viewDate = new Date(state.viewDate.getFullYear(), state.viewDate.getMonth() - 1, 1);
      renderCalendar();
    });

    document.getElementById('adminScheduleNext')?.addEventListener('click', () => {
      state.viewDate = new Date(state.viewDate.getFullYear(), state.viewDate.getMonth() + 1, 1);
      renderCalendar();
    });

    document.getElementById('adminScheduleToday')?.addEventListener('click', () => {
      const today = todayKey();
      state.viewDate = new Date(`${today}T00:00:00`);
      selectDate(today);
    });

    daysEl?.addEventListener('click', event => {
      const button = event.target.closest('[data-schedule-date]');
      if (!button) return;
      selectDate(button.dataset.scheduleDate);
    });

    selectAllEl?.addEventListener('change', () => {
      const items = dayItems();
      state.selectedIds.clear();
      if (selectAllEl.checked) {
        items.forEach(item => state.selectedIds.add(item.id));
      }
      renderDayList();
    });

    bulkDeleteEl?.addEventListener('click', () => {
      const ids = [...state.selectedIds];
      if (!ids.length) return;
      if (!window.confirm(`선택한 일정 ${ids.length}건을 삭제할까요?`)) return;
      if (state.detailId && ids.includes(state.detailId)) closeDetail();
      schedules.removeByIds(ids);
      state.selectedIds.clear();
      resetForm();
      renderCalendar();
      showToast(`일정 ${ids.length}건이 삭제되었습니다.`);
    });

    dayListEl?.addEventListener('change', event => {
      const checkbox = event.target.closest('[data-schedule-select]');
      if (!checkbox) return;
      if (checkbox.checked) {
        state.selectedIds.add(checkbox.dataset.scheduleSelect);
      } else {
        state.selectedIds.delete(checkbox.dataset.scheduleSelect);
      }
      updateSelectionUi();
    });

    dayListEl?.addEventListener('click', event => {
      const viewButton = event.target.closest('[data-view-schedule]');
      if (viewButton) {
        openDetail(viewButton.dataset.viewSchedule);
        return;
      }

      const editButton = event.target.closest('[data-edit-schedule]');
      if (!editButton) return;
      const item = dayItems().find(entry => entry.id === editButton.dataset.editSchedule);
      closeDetail();
      fillForm(item || null);
      renderDayList();
      formEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    detailEl?.addEventListener('click', event => {
      if (event.target.closest('[data-close-schedule-detail]')) {
        closeDetail();
        return;
      }

      const editButton = event.target.closest('#adminScheduleDetailEdit');
      if (!editButton) return;
      const item = findItem(editButton.dataset.editSchedule || state.detailId);
      closeDetail();
      fillForm(item);
      renderDayList();
      formEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && state.detailId) closeDetail();
    });

    cancelEditEl?.addEventListener('click', () => {
      resetForm();
      renderDayList();
    });

    formEl?.addEventListener('submit', event => {
      event.preventDefault();
      if (!state.selectedDate) {
        showToast('날짜를 먼저 선택하세요.');
        return;
      }

      const payload = {
        date: state.selectedDate,
        createdBy: createdByEl?.value.trim() || '',
        title: titleEl?.value.trim() || '',
        memo: memoEl?.value.trim() || ''
      };

      if (!payload.createdBy) {
        showToast('등록자를 입력하세요.');
        return;
      }

      if (!payload.title) {
        showToast('제목을 입력하세요.');
        return;
      }

      const editId = editIdEl?.value || '';
      if (editId) {
        schedules.update(editId, payload);
        showToast('일정이 수정되었습니다.');
        if (state.detailId === editId) openDetail(editId);
      } else {
        const admin = currentAdmin();
        schedules.create({
          ...payload,
          createdById: admin?.id || ''
        });
        showToast('일정이 등록되었습니다.');
      }

      resetForm();
      renderCalendar();
    });
  }

  bindEvents();
  state.viewDate = new Date(`${todayKey()}T00:00:00`);
  if (createdByEl) createdByEl.value = defaultCreatorName();
  renderCalendar();

  window.BremAdminSchedule = {
    refresh
  };
})();
