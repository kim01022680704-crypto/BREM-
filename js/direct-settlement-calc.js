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

    // 차감내역(AB)은 주정산 총액(AM)에서 빼는 공제 항목이다. (원천세만 AC×3.3% 계산)
    { key: 'deductionDetail', label: '차감내역', group: 'deduct' },
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

  // 출금건 플랫폼. 비어 있거나 알 수 없으면 '' — 정산 차감에 쓰지 않는다.
  // (예전엔 platform 없으면 쿠팡·배민 양쪽에 들어가 교차 차감됐다.)
  function normalizeWithdrawalPlatform(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'coupang' || raw === '쿠팡') return 'coupang';
    if (raw === 'baemin' || raw === '배민') return 'baemin';
    return '';
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
    const rowPlatform = normalizeWithdrawalPlatform(row.platform) || normalizePlatform(platform);
    const fees = window.BremStorage?.payrollDailySettlement?.getFees?.(rowPlatform) || {};
    const resolve = window.BremStorage?.payrollDailySettlement?.resolveDailySettlementFee;
    return typeof resolve === 'function' ? resolve(Number(row.amount || 0), fees) : 0;
  }

  // 이 주 선정산(일정산) 처리완료 금액·수수료 맵: driverId → { prepaid, fee }
  // 배민 출금 → 배민 정산만, 쿠팡 출금 → 쿠팡 정산만 차감한다.
  function completedWithdrawalMap(withdrawals, week, platform) {
    const target = normalizePlatform(platform);
    const map = new Map();
    (Array.isArray(withdrawals) ? withdrawals : []).forEach(row => {
      if (String(row.status || '') !== 'completed') return;
      if (String(row.weekStart || '').slice(0, 10) !== week) return;
      const rowPlatform = normalizeWithdrawalPlatform(row.platform);
      if (!rowPlatform || rowPlatform !== target) return;
      const driverId = String(row.driverId || '').trim();
      if (!driverId) return;
      const prev = map.get(driverId) || { prepaid: 0, fee: 0 };
      prev.prepaid += Math.max(0, Math.round(Number(row.amount || 0)));
      prev.fee += withdrawalRowFee(row, target);
      map.set(driverId, prev);
    });
    return map;
  }

  // 출금 차감 전 플랫폼별 수용 한도(실지급). 정산서 기준.
  function buildWeekCapacityMap(settlements, week) {
    const map = new Map();
    const weekKey = String(week || '').slice(0, 10);
    (Array.isArray(settlements) ? settlements : []).forEach(settlement => {
      if (!settlement || settlementWeek(settlement) !== weekKey) return;
      const platform = normalizePlatform(settlement.platform);
      // 출금 없이 계산한 netPay = 그 플랫폼이 흡수할 수 있는 선정산+수수료 한도
      computeRows(settlement, { withdrawals: [], _skipAllocation: true }).forEach(row => {
        const driverId = String(row.driverId || '').trim();
        if (!driverId) return;
        const prev = map.get(driverId) || { coupang: 0, baemin: 0 };
        prev[platform] += Math.max(0, Math.round(Number(row.netPay) || 0));
        map.set(driverId, prev);
      });
    });
    return map;
  }

  /**
   * 합산 출금 시절 잘못된 플랫폼 태그를 보정한다.
   * 1) 기록된 플랫폼에 먼저 배정
   * 2) 그 플랫폼 한도를 넘치면 반대 플랫폼으로 넘김
   * → 쿠팡 정산에 배민 출금 전액이 들어가 총지급이 마이너스 되던 문제를 막는다.
   */
  function allocateWeekWithdrawals(withdrawals, week, capacityMap) {
    const weekKey = String(week || '').slice(0, 10);
    const remaining = new Map();
    (capacityMap instanceof Map ? capacityMap : new Map()).forEach((value, driverId) => {
      remaining.set(driverId, {
        coupang: Math.max(0, Number(value.coupang || 0)),
        baemin: Math.max(0, Number(value.baemin || 0))
      });
    });
    const allocated = new Map();

    const ensureAlloc = driverId => {
      if (!allocated.has(driverId)) {
        allocated.set(driverId, {
          coupang: { prepaid: 0, fee: 0 },
          baemin: { prepaid: 0, fee: 0 }
        });
      }
      return allocated.get(driverId);
    };

    const rows = (Array.isArray(withdrawals) ? withdrawals : [])
      .filter(row => String(row.status || '') === 'completed'
        && String(row.weekStart || '').slice(0, 10) === weekKey
        && String(row.driverId || '').trim())
      .slice()
      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));

    rows.forEach(row => {
      const driverId = String(row.driverId || '').trim();
      const prefer = normalizeWithdrawalPlatform(row.platform);
      const amount = Math.max(0, Math.round(Number(row.amount || 0)));
      const fee = withdrawalRowFee(row, prefer || 'coupang');
      let leftAmount = amount;
      let leftFee = fee;
      const rem = remaining.get(driverId) || { coupang: 0, baemin: 0 };
      const alloc = ensureAlloc(driverId);
      const order = prefer === 'baemin'
        ? ['baemin', 'coupang']
        : (prefer === 'coupang'
          ? ['coupang', 'baemin']
          : (rem.coupang >= rem.baemin ? ['coupang', 'baemin'] : ['baemin', 'coupang']));

      order.forEach(platform => {
        if (leftAmount + leftFee <= 0) return;
        const room = Math.max(0, Number(rem[platform] || 0));
        if (room <= 0) return;
        const takeTotal = Math.min(room, leftAmount + leftFee);
        const takeFee = Math.min(leftFee, takeTotal);
        const takeAmount = Math.min(leftAmount, takeTotal - takeFee);
        alloc[platform].fee += takeFee;
        alloc[platform].prepaid += takeAmount;
        rem[platform] -= (takeFee + takeAmount);
        leftFee -= takeFee;
        leftAmount -= takeAmount;
      });

      // 한도를 넘긴 초과출금은 원래 플랫폼(또는 우선 플랫폼)에 남겨 표시한다.
      if (leftAmount + leftFee > 0) {
        const platform = order[0];
        alloc[platform].prepaid += leftAmount;
        alloc[platform].fee += leftFee;
      }
      remaining.set(driverId, rem);
    });

    return allocated;
  }

  function withdrawalMapFromAllocation(allocation, platform) {
    const target = normalizePlatform(platform);
    const map = new Map();
    (allocation instanceof Map ? allocation : new Map()).forEach((value, driverId) => {
      const slice = value?.[target] || { prepaid: 0, fee: 0 };
      if (!slice.prepaid && !slice.fee) return;
      map.set(driverId, {
        prepaid: Math.max(0, Math.round(Number(slice.prepaid || 0))),
        fee: Math.max(0, Math.round(Number(slice.fee || 0)))
      });
    });
    return map;
  }

  function resolveWithdrawMap(settlement, options = {}) {
    const platform = normalizePlatform(settlement.platform);
    const week = settlementWeek(settlement);
    if (options._skipAllocation) {
      return completedWithdrawalMap(options.withdrawals, week, platform);
    }
    const weekSettlements = Array.isArray(options.weekSettlements) ? options.weekSettlements : null;
    if (weekSettlements && weekSettlements.length) {
      const capacity = buildWeekCapacityMap(weekSettlements, week);
      const allocation = allocateWeekWithdrawals(options.withdrawals, week, capacity);
      return withdrawalMapFromAllocation(allocation, platform);
    }
    return completedWithdrawalMap(options.withdrawals, week, platform);
  }

  // 정산서 1건 → 라이더별 정산 행. 쿠팡·배민 모두 같은 필드를 채운다.
  function computeRows(settlement, options = {}) {
    if (!settlement) return [];
    const platform = normalizePlatform(settlement.platform);
    const week = settlementWeek(settlement);

    const store = window.BremStorage?.directSettlementAdjustments;
    const promoMap = store?.getSettlement?.('promotion', settlement.id) || {};
    const otherMap = store?.getSettlement?.('other', settlement.id) || {};
    const withdrawMap = resolveWithdrawMap(settlement, options);
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
      const deductTotal = deductionDetail + employmentInsurance + accidentInsurance + hourlyInsurance
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
    normalizeWithdrawalPlatform,
    driverName,
    callFeeUnit,
    completedWithdrawalMap,
    buildWeekCapacityMap,
    allocateWeekWithdrawals,
    resolveWithdrawMap,
    computeRows,
    escapeHtml,
    theadHtml,
    sortByName,
    sumRows
  };
})();

if (typeof window !== 'undefined') window.BremDirectSettlementCalc = BremDirectSettlementCalc;
