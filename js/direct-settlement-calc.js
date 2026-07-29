// 직계약 정산 계산·표 정의 공용 모듈.
// 「정산결과 (직계약)」과 「최종입금」이 같은 지급내역·공제내역을 쓰게 하려고 한 곳에 모았다.
// 열 정의가 화면마다 갈라지면 두 메뉴의 합계가 어긋나고, 엑셀 열도 밀린다.
const BremDirectSettlementCalc = (function () {
  const PROMO_TAX_RATE = 0.033;

  // 쿠팡·배민을 통일한다. 한쪽에만 있는 항목(배민 추가지급, 쿠팡 차감내역)도
  // 열을 빼지 않고 0으로 채워 두 플랫폼 표가 항상 같은 모양이 되게 한다.
  // 그래야 최종입금에서 쿠팡+배민을 한 사람 기준으로 합칠 수 있다.
  const GROUPS = Object.freeze([
    { id: 'info', label: '기사 정보' },
    { id: 'pay', label: '지급내역' },
    { id: 'deduct', label: '공제내역' },
    { id: 'net', label: '최종' }
  ]);

  const COLUMNS = Object.freeze([
    { key: 'name', label: '기사', group: 'info', money: false, strong: true },
    { key: 'idLabel', label: 'ID', group: 'info', money: false, tag: true },
    { key: 'callCount', label: '콜수', group: 'info' },

    { key: 'deliveryFee', label: '배달비', group: 'pay' },
    { key: 'missionPay', label: '추가지급(미션)', group: 'pay' },
    { key: 'other', label: '기타지급', group: 'pay' },
    { key: 'promo', label: 'BREM프로모션', group: 'pay' },
    { key: 'grossPay', label: '지급합계', group: 'pay', strong: true },

    // 차감내역은 정산서에서 이미 배달비에 반영돼 나온 금액이다. 공제합계에 더하면
    // 이중공제가 되므로 확인용으로만 싣는다.
    { key: 'deductionDetail', label: '차감내역(이미반영)', group: 'deduct', note: true },
    { key: 'employmentInsurance', label: '고용보험', group: 'deduct' },
    { key: 'accidentInsurance', label: '산재보험', group: 'deduct' },
    { key: 'hourlyInsurance', label: '시간제보험', group: 'deduct' },
    { key: 'withholdingTax', label: '원천세', group: 'deduct' },
    { key: 'promotionWithholdingTax', label: '프로모션원천세', group: 'deduct' },
    { key: 'callFee', label: '콜수수료', group: 'deduct' },
    { key: 'dailySettlementFee', label: '일정산수수료', group: 'deduct' },
    { key: 'prepaid', label: '선정산(처리완료)', group: 'deduct' },
    { key: 'deductTotal', label: '공제합계', group: 'deduct', strong: true },

    { key: 'netPay', label: '총지급액', group: 'net', strong: true }
  ]);

  // 합칠 수 있는 숫자 열(최종입금에서 쿠팡+배민을 한 줄로 더할 때 쓴다)
  const NUMERIC_KEYS = Object.freeze(COLUMNS.filter(col => col.money !== false).map(col => col.key));

  function promoTax(sum) {
    return Math.floor(Number(sum || 0) * PROMO_TAX_RATE);
  }

  function dateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // 정산주는 항상 수요일 시작.
  function weekStartKey(dateValue = dateKey(new Date())) {
    if (window.BremDatePicker?.weekStartKey) return window.BremDatePicker.weekStartKey(dateValue);
    const date = new Date(`${String(dateValue).slice(0, 10)}T00:00:00`);
    const diff = (date.getDay() - 3 + 7) % 7;
    date.setDate(date.getDate() - diff);
    return dateKey(date);
  }

  function settlementWeek(record) {
    if (!record) return weekStartKey();
    return weekStartKey(String(record.startDate || '').slice(0, 10) || weekStartKey());
  }

  function normalizePlatform(platform) {
    return String(platform || '') === 'coupang' ? 'coupang' : 'baemin';
  }

  function driverName(driverId, fallback) {
    const driver = window.BremStorage?.drivers?.getById?.(driverId);
    return driver?.name || fallback || '(이름 없음)';
  }

  // 콜수수료 단가(급여 일정산 설정) × 콜수
  function callFeeUnit(platform) {
    const fees = window.BremStorage?.payrollDailySettlement?.getFees?.(normalizePlatform(platform)) || {};
    return Math.max(0, Math.round(Number(fees.callFee || 0)));
  }

  function withdrawalRowFee(row, platform) {
    if (row.feeAmount != null) return Math.max(0, Math.round(Number(row.feeAmount) || 0));
    const fees = window.BremStorage?.payrollDailySettlement?.getFees?.(normalizePlatform(row.platform || platform)) || {};
    const resolve = window.BremStorage?.payrollDailySettlement?.resolveDailySettlementFee;
    return typeof resolve === 'function' ? resolve(Number(row.amount || 0), fees) : 0;
  }

  // 이 주 선정산(일정산) 처리완료 금액·수수료 맵: driverId → { prepaid, fee }
  function completedWithdrawalMap(withdrawals, week, platform) {
    const target = normalizePlatform(platform);
    const map = new Map();
    (Array.isArray(withdrawals) ? withdrawals : []).forEach(row => {
      if (String(row.status || '') !== 'completed') return;
      if (String(row.weekStart || '').slice(0, 10) !== week) return;
      const rowPlatform = String(row.platform || '');
      if (rowPlatform && rowPlatform !== target) return;
      const driverId = String(row.driverId || '').trim();
      if (!driverId) return;
      const prev = map.get(driverId) || { prepaid: 0, fee: 0 };
      prev.prepaid += Math.max(0, Math.round(Number(row.amount || 0)));
      prev.fee += withdrawalRowFee(row, target);
      map.set(driverId, prev);
    });
    return map;
  }

  // 정산서 1건 → 라이더별 정산 행. 쿠팡·배민 모두 같은 필드를 채운다.
  function computeRows(settlement, options = {}) {
    if (!settlement) return [];
    const platform = normalizePlatform(settlement.platform);
    const week = settlementWeek(settlement);

    const store = window.BremStorage?.directSettlementAdjustments;
    const promoMap = store?.getSettlement?.('promotion', settlement.id) || {};
    const otherMap = store?.getSettlement?.('other', settlement.id) || {};
    const withdrawMap = completedWithdrawalMap(options.withdrawals, week, platform);
    const unitCallFee = callFeeUnit(platform);

    const rows = [];
    (Array.isArray(settlement.riders) ? settlement.riders : []).forEach(rider => {
      const driverId = String(rider.matchedRiderId || '').trim();
      const amounts = rider.amounts || {};
      const idLabel = platform === 'coupang'
        ? (rider.coupangLoginKey || '-')
        : (rider.baeminUserId || '-');
      const promo = driverId ? Number(promoMap[driverId]?.amount || 0) : 0;
      const other = driverId ? Number(otherMap[driverId]?.amount || 0) : 0;
      const deliveryFee = Number(amounts.deliveryFee || 0);
      const missionPay = Number(amounts.missionPay || 0);
      const deductionDetail = Number(amounts.deductionDetail || 0);
      const grossPay = deliveryFee + missionPay + other + promo;

      const callCount = Number(rider.weeklyOrderCount || rider.systemCallCount || 0);
      const employmentInsurance = Number(amounts.employmentInsurance || 0);
      const accidentInsurance = Number(amounts.accidentInsurance || 0);
      const hourlyInsurance = Number(amounts.hourlyInsurance || 0);
      const withholdingTax = Number(amounts.withholdingTax || 0);
      const promotionWithholdingTax = promoTax(promo + other);
      const callFee = callCount * unitCallFee;
      const wd = driverId ? (withdrawMap.get(driverId) || { prepaid: 0, fee: 0 }) : { prepaid: 0, fee: 0 };
      const dailySettlementFee = wd.fee;
      const prepaid = wd.prepaid;
      const deductTotal = employmentInsurance + accidentInsurance + hourlyInsurance
        + withholdingTax + promotionWithholdingTax + callFee + dailySettlementFee + prepaid;
      const netPay = grossPay - deductTotal;

      rows.push({
        driverId,
        platform,
        settlementId: String(settlement.id || ''),
        region: String(settlement.region || ''),
        name: driverName(driverId, rider.driverName || rider.riderName || rider.originalName),
        idLabel,
        callCount,
        deliveryFee, missionPay, deductionDetail, other, promo, grossPay,
        employmentInsurance, accidentInsurance, hourlyInsurance,
        withholdingTax, promotionWithholdingTax, callFee, dailySettlementFee, prepaid,
        deductTotal, netPay
      });
    });
    return rows;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function groupLabel(groupId) {
    return GROUPS.find(group => group.id === groupId)?.label || '';
  }

  // 그룹 행 + 열 이름 행. 두 화면이 같은 헤더를 쓰게 여기서 만든다.
  // leadHtml 은 두 행에 걸치는 맨 앞 칸(예: 최종입금의 선택 체크박스)에 쓴다.
  function theadHtml(cols, leadHtml = '') {
    const runs = [];
    cols.forEach(col => {
      const last = runs[runs.length - 1];
      if (last && last.group === col.group) last.span += 1;
      else runs.push({ group: col.group, span: 1 });
    });
    const groupRow = runs
      .map(run => `<th colspan="${run.span}" class="settle-group-th settle-group-${run.group}">${escapeHtml(groupLabel(run.group))}</th>`)
      .join('');
    const labelRow = cols
      .map(col => `<th class="settle-col-${col.group}${col.note ? ' settle-col-note' : ''}">${escapeHtml(col.label)}</th>`)
      .join('');
    return `<tr class="settle-group-row">${leadHtml}${groupRow}</tr><tr>${labelRow}</tr>`;
  }

  function sortByName(rows) {
    return rows.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko-KR'));
  }

  function sumRows(rows) {
    const totals = {};
    NUMERIC_KEYS.forEach(key => { totals[key] = 0; });
    (Array.isArray(rows) ? rows : []).forEach(row => {
      NUMERIC_KEYS.forEach(key => { totals[key] += Number(row[key] || 0); });
    });
    return totals;
  }

  return {
    PROMO_TAX_RATE,
    GROUPS,
    COLUMNS,
    NUMERIC_KEYS,
    promoTax,
    dateKey,
    weekStartKey,
    settlementWeek,
    normalizePlatform,
    driverName,
    callFeeUnit,
    completedWithdrawalMap,
    computeRows,
    escapeHtml,
    theadHtml,
    sortByName,
    sumRows
  };
})();

if (typeof window !== 'undefined') window.BremDirectSettlementCalc = BremDirectSettlementCalc;
