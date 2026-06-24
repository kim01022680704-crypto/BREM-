/**
 * 리스 ERP — 미납 / 사고 / 정비 패널
 */
const BremLeaseErpPanels = (function () {
  const erp = () => window.BremLeaseErp;
  const $ = id => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatMoney(value) {
    const num = Number(value || 0);
    if (!num) return '-';
    return `${num.toLocaleString('ko-KR')}원`;
  }

  function formatDate(value) {
    if (!value) return '-';
    return BremDatePicker?.formatDate?.(value) || String(value).slice(0, 10);
  }

  function showToast(message) {
    document.dispatchEvent(new CustomEvent('brem-admin-toast', { detail: { message } }));
  }

  function vehicleOptions() {
    return erp()?.vehicles().getAll().map(item => ({
      id: item.id,
      label: `${item.vehicleNumber || item.model || item.id} · ${item.renter || item.rentalAssignment?.renter || '-'}`
    })) || [];
  }

  function fillVehicleSelect(selectEl) {
    if (!selectEl) return;
    const previous = selectEl.value;
    selectEl.innerHTML = ['<option value="">차량 선택</option>'].concat(
      vehicleOptions().map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`)
    ).join('');
    if (previous) selectEl.value = previous;
  }

  function renderPayments() {
    const rowsEl = $('leasePaymentRows');
    if (!rowsEl || !erp()) return;
    const list = erp().payments().getAll();
    if (!list.length) {
      rowsEl.innerHTML = '<tr><td colspan="9" class="empty">등록된 납부 기록이 없습니다.</td></tr>';
      return;
    }
    const vehicleMap = new Map(erp().vehicles().getAll().map(item => [item.id, item]));
    rowsEl.innerHTML = list.map(item => {
      const vehicle = vehicleMap.get(item.vehicleId);
      return `
        <tr>
          <td>${escapeHtml(vehicle?.vehicleNumber || '-')}</td>
          <td>${formatDate(item.dueDate)}</td>
          <td>${formatDate(item.paidDate)}</td>
          <td>${formatMoney(item.chargeAmount)}</td>
          <td>${formatMoney(item.paidAmount)}</td>
          <td>${formatMoney(item.unpaidAmount)}</td>
          <td>${item.overdueDays || 0}일</td>
          <td>${escapeHtml(BremLeaseProfit.paymentStatusLabel(item.paymentStatus))}</td>
          <td><button type="button" class="small-btn danger-btn" data-delete-lease-payment="${escapeHtml(item.id)}">삭제</button></td>
        </tr>
      `;
    }).join('');
  }

  function renderAccidents() {
    const rowsEl = $('leaseAccidentRows');
    if (!rowsEl || !erp()) return;
    const list = erp().accidents().getAll();
    if (!list.length) {
      rowsEl.innerHTML = '<tr><td colspan="8" class="empty">등록된 사고 기록이 없습니다.</td></tr>';
      return;
    }
    rowsEl.innerHTML = list.map(item => `
      <tr>
        <td>${formatDate(item.accidentDate)}</td>
        <td>${escapeHtml(item.driverName || '-')}</td>
        <td>${escapeHtml(item.vehicleNumber || '-')}</td>
        <td>${formatMoney(item.repairCost)}</td>
        <td>${formatMoney(item.insurancePayout)}</td>
        <td>${formatMoney(item.selfPay)}</td>
        <td>${formatMoney(item.actualLoss)}</td>
        <td><button type="button" class="small-btn danger-btn" data-delete-lease-accident="${escapeHtml(item.id)}">삭제</button></td>
      </tr>
    `).join('');
  }

  function renderMaintenance() {
    const rowsEl = $('leaseMaintenanceRows');
    if (!rowsEl || !erp()) return;
    const list = erp().maintenance().getAll();
    if (!list.length) {
      rowsEl.innerHTML = '<tr><td colspan="7" class="empty">등록된 정비 기록이 없습니다.</td></tr>';
      return;
    }
    rowsEl.innerHTML = list.map(item => `
      <tr>
        <td>${formatDate(item.maintenanceDate)}</td>
        <td>${escapeHtml(item.vehicleNumber || '-')}</td>
        <td>${escapeHtml(item.description || '-')}</td>
        <td>${formatMoney(item.maintenanceCost)}</td>
        <td>${formatMoney(item.partsCost)}</td>
        <td>${escapeHtml(item.memo || '-')}</td>
        <td><button type="button" class="small-btn danger-btn" data-delete-lease-maintenance="${escapeHtml(item.id)}">삭제</button></td>
      </tr>
    `).join('');
  }

  function setActiveTab(tab) {
    document.querySelectorAll('[data-lease-erp-tab]').forEach(button => {
      const active = button.dataset.leaseErpTab === tab;
      button.classList.toggle('active', active);
    });
    document.querySelectorAll('[data-lease-erp-panel]').forEach(panel => {
      panel.hidden = panel.dataset.leaseErpPanel !== tab;
    });
  }

  function exportSheet(filename, headers, rows) {
    if (!window.XLSX) {
      showToast('엑셀 라이브러리를 불러오지 못했습니다.');
      return;
    }
    const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'data');
    XLSX.writeFile(workbook, filename);
  }

  function exportAll() {
    if (!erp()) return;
    const vehicles = erp().vehicles().getAll();
    exportSheet(
      `BREM_차량현황_${BremLeaseProfit.todayKey()}.xlsx`,
      ['차량번호', '기종', '구분', '상태', '렌탈자', '리스회사', '하루청구', '하루원가', '하루보험', '일순수익', '주순수익', '월순수익', '미납금'],
      vehicles.map(item => {
        const profit = BremLeaseProfit.computeDailyProfit(item);
        return [
          item.vehicleNumber,
          item.model,
          BremLeaseProfit.vehicleCategoryLabel(item.vehicleCategory),
          BremLeaseProfit.vehicleStatusLabel(item.vehicleStatus),
          item.renter || item.rentalAssignment?.renter || '',
          item.leaseCompany || item.lessor || '',
          item.dailyChargeAmount || item.dailyRent || 0,
          item.dailyLeaseCost || 0,
          item.dailyInsuranceCost || 0,
          profit.dailyNet,
          profit.weeklyNet,
          profit.monthlyNet,
          item.unpaidAmount || 0
        ];
      })
    );
  }

  function bindEvents() {
    if (bindEvents.bound) return;
    bindEvents.bound = true;

    document.querySelectorAll('[data-lease-erp-tab]').forEach(button => {
      button.addEventListener('click', () => setActiveTab(button.dataset.leaseErpTab));
    });

    $('leasePaymentForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      if (!erp()) return;
      const vehicleId = $('leasePaymentVehicle')?.value || '';
      if (!vehicleId) {
        showToast('차량을 선택하세요.');
        return;
      }
      erp().payments().create({
        vehicleId,
        dueDate: $('leasePaymentDueDate')?.value || '',
        paidDate: $('leasePaymentPaidDate')?.value || '',
        chargeAmount: $('leasePaymentCharge')?.value || 0,
        paidAmount: $('leasePaymentPaid')?.value || 0,
        paymentStatus: $('leasePaymentStatus')?.value || '',
        memo: $('leasePaymentMemo')?.value || ''
      });
      await erp().persistAll();
      event.target.reset();
      fillVehicleSelect($('leasePaymentVehicle'));
      renderPayments();
      window.BremAdminLease?.refresh?.();
      showToast('납부 기록이 저장되었습니다.');
    });

    $('leaseAccidentForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      if (!erp()) return;
      const vehicleId = $('leaseAccidentVehicle')?.value || '';
      const vehicle = erp().vehicles().getById(vehicleId);
      erp().accidents().create({
        vehicleId,
        accidentDate: $('leaseAccidentDate')?.value || '',
        driverName: $('leaseAccidentDriver')?.value || '',
        vehicleNumber: vehicle?.vehicleNumber || $('leaseAccidentVehicleNo')?.value || '',
        repairCost: $('leaseAccidentRepair')?.value || 0,
        insurancePayout: $('leaseAccidentInsurance')?.value || 0,
        selfPay: $('leaseAccidentSelfPay')?.value || 0,
        memo: $('leaseAccidentMemo')?.value || ''
      });
      await erp().persistAll();
      event.target.reset();
      fillVehicleSelect($('leaseAccidentVehicle'));
      renderAccidents();
      window.BremAdminLease?.refresh?.();
      showToast('사고 기록이 저장되었습니다.');
    });

    $('leaseMaintenanceForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      if (!erp()) return;
      const vehicleId = $('leaseMaintenanceVehicle')?.value || '';
      const vehicle = erp().vehicles().getById(vehicleId);
      erp().maintenance().create({
        vehicleId,
        maintenanceDate: $('leaseMaintenanceDate')?.value || '',
        vehicleNumber: vehicle?.vehicleNumber || $('leaseMaintenanceVehicleNo')?.value || '',
        description: $('leaseMaintenanceDesc')?.value || '',
        maintenanceCost: $('leaseMaintenanceCost')?.value || 0,
        partsCost: $('leaseMaintenanceParts')?.value || 0,
        memo: $('leaseMaintenanceMemo')?.value || ''
      });
      await erp().persistAll();
      event.target.reset();
      fillVehicleSelect($('leaseMaintenanceVehicle'));
      renderMaintenance();
      window.BremAdminLease?.refresh?.();
      showToast('정비 기록이 저장되었습니다.');
    });

    document.addEventListener('click', async event => {
      const paymentDelete = event.target.closest('[data-delete-lease-payment]');
      if (paymentDelete && erp()) {
        erp().payments().removeById(paymentDelete.dataset.deleteLeasePayment);
        await erp().persistAll();
        renderPayments();
        window.BremAdminLease?.refresh?.();
        return;
      }
      const accidentDelete = event.target.closest('[data-delete-lease-accident]');
      if (accidentDelete && erp()) {
        erp().accidents().removeById(accidentDelete.dataset.deleteLeaseAccident);
        await erp().persistAll();
        renderAccidents();
        window.BremAdminLease?.refresh?.();
        return;
      }
      const maintenanceDelete = event.target.closest('[data-delete-lease-maintenance]');
      if (maintenanceDelete && erp()) {
        erp().maintenance().removeById(maintenanceDelete.dataset.deleteLeaseMaintenance);
        await erp().persistAll();
        renderMaintenance();
        window.BremAdminLease?.refresh?.();
      }
    });

    $('leaseErpExportAllBtn')?.addEventListener('click', exportAll);
  }

  function refresh() {
    if (!erp()) return;
    fillVehicleSelect($('leasePaymentVehicle'));
    fillVehicleSelect($('leaseAccidentVehicle'));
    fillVehicleSelect($('leaseMaintenanceVehicle'));
    renderPayments();
    renderAccidents();
    renderMaintenance();
  }

  function init() {
    if (!erp() || !$('lease-management')) return;
    bindEvents();
    setActiveTab('vehicles');
    refresh();
  }

  return { init, refresh };
})();

document.addEventListener('DOMContentLoaded', () => {
  BremLeaseErpPanels.init();
});
