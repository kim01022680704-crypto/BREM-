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
    { key: 'leaseFee', label: '리스차감', group: 'deduct' },
    { key: 'loanFee', label: '대여차감', group: 'deduct' },
    { key: 'deductTotal', label: '공제합계', group: 'deduct', strong: true },

    { key: 'netPay', label: '총지급액', group: 'net', strong: true }
  ]);

  // 합칠 수 있는 숫자 열(최종입금에서 쿠팡+배민을 한 줄로 더할 때 쓴다)
  const NUMERIC_KEYS = Object.freeze(COLUMNS.filter(col => col.money !== false).map(col => col.key));

  // 일반공제 = 고용·산재·시간제보험 + 원천세·프로모션원천세 + 콜수수료 (차감내역·일정산수수료·선정산·리스·대여 제외)
  const GENERAL_DEDUCT_KEYS = Object.freeze([
    'employmentInsurance',
    'accidentInsurance',
    'hourlyInsurance',
    'withholdingTax',
    'promotionWithholdingTax',
    'callFee'
  ]);

  const WITHHOLDING_TAX_KEYS = Object.freeze([
    'withholdingTax',
    'promotionWithholdingTax'
  ]);

  function sumKeys(source, keys) {
    return keys.reduce(
      (sum, key) => sum + Math.round(Number(source?.[key] || 0)),
      0
    );
  }

  function generalDeductTotal(source) {
    return sumKeys(source, GENERAL_DEDUCT_KEYS);
  }

  function withholdingTaxTotal(source) {
    return sumKeys(source, WITHHOLDING_TAX_KEYS);
  }

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

  // 정산주(수 시작)를 구한다. 정산서 시작일이 화요일로 하루 밀려 기록되면
  // weekStartKey 는 이를 "직전 주 수요일"로 스냅해 한 주가 밀린다.
  // date-picker 의 applyWeekWednesday(화→다음날 수) 로 off-by-one 을 먼저 교정한다.
  function settlementWeek(record) {
    if (!record) return weekStartKey();
    const raw = String(record.startDate || '').slice(0, 10);
    if (!raw) return weekStartKey();
    if (window.BremDatePicker?.applyWeekWednesday) {
      return window.BremDatePicker.applyWeekWednesday(raw);
    }
    return weekStartKey(raw);
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

  // 같은 사람을 한 키로 모은다. 중복 등록으로 출금 driverId 와 정산 matchedRiderId 가
  // 달라도(이름+전화 / 배민ID) 같은 사람이면 선정산을 합쳐 배분한다.
  function canonicalDriverKey(driverId) {
    const id = String(driverId || '').trim();
    if (!id) return '';
    const driver = window.BremStorage?.drivers?.getById?.(id);
    if (driver) {
      const name = String(driver.name || '').replace(/\s+/g, '');
      const phone = String(driver.phone || driver.raw_data?.phone || '').replace(/\D/g, '').slice(-4);
      if (name && phone) return `np:${name}|${phone}`;
      const baeminId = String(driver.baeminId || driver.raw_data?.baeminId || '').trim();
      if (baeminId) {
        const key = window.BremWeeklySettlement?.baeminIdMatchKey?.(baeminId)
          || (/^\d+$/.test(baeminId) ? (baeminId.replace(/^0+/, '') || '0') : baeminId.toUpperCase());
        return `b:${key}`;
      }
    }
    return `id:${id}`;
  }

  function riderManualAdjustments(rider) {
    return (rider?.manualAdjustments && typeof rider.manualAdjustments === 'object')
      ? rider.manualAdjustments
      : {};
  }

  function pickOverrideAmount(map, driverId, manual, key) {
    if (driverId && map && Object.prototype.hasOwnProperty.call(map, driverId)) {
      return Math.max(0, Math.round(Number(map[driverId]?.amount || 0)));
    }
    if (manual && Object.prototype.hasOwnProperty.call(manual, key)) {
      return Math.max(0, Math.round(Number(manual[key] || 0)));
    }
    return null;
  }

  function riderRowBase(rider, settlement, platform, unitCallFee, adj) {
    const driverId = String(rider.matchedRiderId || '').trim();
    const amounts = rider.amounts || {};
    const manual = riderManualAdjustments(rider);
    const idLabel = platform === 'coupang'
      ? (rider.coupangLoginKey || '-')
      : (rider.baeminUserId || '-');
    const promo = driverId ? Number(adj.promoMap[driverId]?.amount || 0) : 0;
    const otherOverride = pickOverrideAmount(adj.otherMap, driverId, manual, 'other');
    const other = otherOverride == null ? 0 : otherOverride;
    const deliveryFee = Number(amounts.deliveryFee || 0);
    // 추가지급: 주정산서 금액이 기본. 수동 override(missionPay 맵/정산서)가 있으면 그 값(0 포함).
    const missionPayExcel = Number(amounts.missionPay || 0);
    const missionPayOverride = pickOverrideAmount(adj.missionMap, driverId, manual, 'missionPay');
    const missionPayManual = missionPayOverride != null;
    const missionPay = missionPayManual ? missionPayOverride : missionPayExcel;
    const deductionDetail = Number(amounts.deductionDetail || 0);
    const grossPay = deliveryFee + missionPay + other + promo;

    const callCount = Number(rider.weeklyOrderCount || rider.systemCallCount || 0);
    const employmentInsurance = Number(amounts.employmentInsurance || 0);
    const accidentInsurance = Number(amounts.accidentInsurance || 0);
    const hourlyInsurance = Number(amounts.hourlyInsurance || 0);
    const withholdingTax = Number(amounts.withholdingTax || 0);
    const promotionWithholdingTax = promoTax(promo + other);
    const callFee = Object.prototype.hasOwnProperty.call(amounts, 'callFee')
      ? Math.max(0, Math.round(Number(amounts.callFee || 0)))
      : callCount * unitCallFee;
    const baseDeduct = deductionDetail + employmentInsurance + accidentInsurance + hourlyInsurance
      + withholdingTax + promotionWithholdingTax + callFee;
    // 선정산·일정산수수료를 빼기 전 잔액 = 이 플랫폼이 흡수할 수 있는 한도(음수면 0)
    const capacity = Math.max(0, Math.round(grossPay - baseDeduct));

    return {
      driverId,
      canonicalKey: canonicalDriverKey(driverId),
      platform,
      settlementId: String(settlement.id || ''),
      region: String(settlement.region || ''),
      name: driverName(driverId, rider.driverName || rider.riderName || rider.originalName),
      idLabel,
      callCount,
      deliveryFee, missionPay, missionPayExcel, missionPayManual,
      deductionDetail, other, promo, grossPay,
      employmentInsurance, accidentInsurance, hourlyInsurance,
      withholdingTax, promotionWithholdingTax, callFee,
      baseDeduct, capacity
    };
  }

  function adjustmentMaps(settlement) {
    const store = window.BremStorage?.directSettlementAdjustments;
    const settlementId = settlement?.id;
    return {
      promoMap: store?.getSettlement?.('promotion', settlementId) || {},
      otherMap: store?.getSettlement?.('other', settlementId) || {},
      missionMap: store?.getSettlement?.('missionPay', settlementId) || {},
      leaseMap: store?.getSettlement?.('leaseFee', settlementId) || {},
      loanMap: store?.getSettlement?.('loanFee', settlementId) || {}
    };
  }

  // 이 주 모든 직계약 정산서에서 사람별·플랫폼별 선정산 흡수 한도(payable)를 모은다.
  function buildWeekCapacityMap(weekSettlements) {
    const map = new Map(); // canonicalKey -> { coupang, baemin }
    (Array.isArray(weekSettlements) ? weekSettlements : []).forEach(settlement => {
      const platform = normalizePlatform(settlement.platform);
      const unitCallFee = callFeeUnit(platform);
      const adj = adjustmentMaps(settlement);
      (Array.isArray(settlement.riders) ? settlement.riders : []).forEach(rider => {
        const base = riderRowBase(rider, settlement, platform, unitCallFee, adj);
        if (!base.canonicalKey) return;
        const prev = map.get(base.canonicalKey) || { coupang: 0, baemin: 0 };
        prev[platform] += base.capacity;
        map.set(base.canonicalKey, prev);
      });
    });
    return map;
  }

  /**
   * 사람별로 이 주 처리완료 출금을 플랫폼 정산에 배분한다(스필오버).
   * - 출금에 찍힌 플랫폼 정산에서 먼저 차감(금액 단위로 부분 배분)
   * - 그 플랫폼 실지급 한도를 넘으면 남은 금액을 반대 플랫폼 정산에서 차감
   * - 양쪽 한도를 다 넘으면 남는 금액은 찍힌(우선) 플랫폼에 남겨 총지급액이 음수로 표기
   * 반환: canonicalKey -> { coupang:{prepaid,fee}, baemin:{prepaid,fee} }
   */
  function allocateWeekWithdrawals(withdrawals, week, capacityMap) {
    const weekKey = String(week || '').slice(0, 10);
    const remaining = new Map();
    (capacityMap instanceof Map ? capacityMap : new Map()).forEach((v, k) => {
      remaining.set(k, {
        coupang: Math.max(0, Number(v.coupang || 0)),
        baemin: Math.max(0, Number(v.baemin || 0))
      });
    });
    const allocated = new Map();
    const ensure = k => {
      if (!allocated.has(k)) allocated.set(k, { coupang: { prepaid: 0, fee: 0 }, baemin: { prepaid: 0, fee: 0 } });
      return allocated.get(k);
    };
    let untaggedCount = 0;
    let untaggedAmount = 0;

    const rows = (Array.isArray(withdrawals) ? withdrawals : [])
      .filter(r => String(r.status || '') === 'completed'
        && String(r.weekStart || '').slice(0, 10) === weekKey
        && String(r.driverId || '').trim())
      .slice()
      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));

    rows.forEach(row => {
      const key = canonicalDriverKey(String(row.driverId || '').trim());
      if (!key) return;
      const prefer = normalizeWithdrawalPlatform(row.platform);
      const amount = Math.max(0, Math.round(Number(row.amount || 0)));
      const fee = withdrawalRowFee(row, prefer || 'coupang');
      if (!prefer) { untaggedCount += 1; untaggedAmount += amount; }
      let leftFee = fee;
      let leftPrepaid = amount;
      const rem = remaining.get(key) || { coupang: 0, baemin: 0 };
      const alloc = ensure(key);
      const order = prefer === 'baemin'
        ? ['baemin', 'coupang']
        : (prefer === 'coupang'
          ? ['coupang', 'baemin']
          : (rem.coupang >= rem.baemin ? ['coupang', 'baemin'] : ['baemin', 'coupang']));
      order.forEach(p => {
        if (leftFee + leftPrepaid <= 0) return;
        const room = Math.max(0, Number(rem[p] || 0));
        if (room <= 0) return;
        const takeFee = Math.min(leftFee, room);
        const takePrepaid = Math.min(leftPrepaid, room - takeFee);
        alloc[p].fee += takeFee;
        alloc[p].prepaid += takePrepaid;
        rem[p] -= (takeFee + takePrepaid);
        leftFee -= takeFee;
        leftPrepaid -= takePrepaid;
      });
      if (leftFee + leftPrepaid > 0) {
        const p = order[0];
        alloc[p].fee += leftFee;
        alloc[p].prepaid += leftPrepaid;
      }
      remaining.set(key, rem);
    });

    allocated.untaggedCount = untaggedCount;
    allocated.untaggedAmount = untaggedAmount;
    return allocated;
  }

  // 이 주 처리완료 출금을 사람별·플랫폼별로 정확히 합산한다.
  // 출금 기록에 찍힌 플랫폼 그대로(쿠팡 출금→쿠팡, 배민 출금→배민). 배분·스필오버 없음.
  // 반환 map[canonicalKey] = { coupang:{prepaid,fee}, baemin:{prepaid,fee} }
  // map.untaggedCount/untaggedAmount = 플랫폼 미지정 출금(어느 쪽에도 못 붙임)
  function buildWeekPrepaidByPlatform(withdrawals, week) {
    const weekKey = String(week || '').slice(0, 10);
    const map = new Map();
    let untaggedCount = 0;
    let untaggedAmount = 0;
    (Array.isArray(withdrawals) ? withdrawals : []).forEach(row => {
      if (String(row.status || '') !== 'completed') return;
      if (String(row.weekStart || '').slice(0, 10) !== weekKey) return;
      const amount = Math.max(0, Math.round(Number(row.amount || 0)));
      const p = normalizeWithdrawalPlatform(row.platform);
      if (!p) {
        // 플랫폼이 안 찍힌 출금은 쿠팡/배민 어디에 붙일지 알 수 없다 → 반영하지 않고 경고만.
        untaggedCount += 1;
        untaggedAmount += amount;
        return;
      }
      const key = canonicalDriverKey(String(row.driverId || '').trim());
      if (!key) return;
      const slot = map.get(key) || {
        coupang: { prepaid: 0, fee: 0 },
        baemin: { prepaid: 0, fee: 0 }
      };
      slot[p].prepaid += amount;
      slot[p].fee += withdrawalRowFee(row, p);
      map.set(key, slot);
    });
    map.untaggedCount = untaggedCount;
    map.untaggedAmount = untaggedAmount;
    return map;
  }

  function normalizeNameKey(value) {
    return String(value || '').replace(/\s+/g, '').toLowerCase();
  }

  function normalizePhoneKey(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function addDaysKey(startKey, days) {
    const date = new Date(`${String(startKey).slice(0, 10)}T00:00:00`);
    date.setDate(date.getDate() + Number(days || 0));
    return dateKey(date);
  }

  function weekEndFromStart(weekStart) {
    return addDaysKey(weekStart, 6);
  }

  function countLeaseActiveDays(weekStart, weekEnd, todayKey, contractStart, contractEnd) {
    if (!weekStart || !weekEnd) return 0;
    const upper = todayKey && todayKey < weekEnd ? todayKey : weekEnd;
    if (upper < weekStart) return 0;
    let count = 0;
    let cursor = weekStart;
    let guard = 0;
    while (cursor <= upper && guard < 60) {
      const afterStart = !contractStart || cursor >= contractStart;
      const beforeEnd = !contractEnd || cursor <= contractEnd;
      if (afterStart && beforeEnd) count += 1;
      cursor = addDaysKey(cursor, 1);
      guard += 1;
    }
    return count;
  }

  function isLeaseFinalApplied(contract) {
    if (!contract) return false;
    if (contract.finalApplyEnabled != null) return Boolean(contract.finalApplyEnabled);
    return Boolean(contract.rawData?.finalApplyEnabled || contract.raw_data?.finalApplyEnabled);
  }

  function contractDailyRent(contract) {
    const raw = contract?.rawData || contract?.raw_data || {};
    // 계약/렌탈 일렌탈료만 (차량 dailyLeaseCost·daily_cost 사용 금지)
    const daily = Math.max(0, Math.round(Number(
      contract?.daily_charge
      || contract?.dailyCharge
      || contract?.dailyRent
      || raw.dailyRent
      || 0
    )));
    if (daily > 0) return daily;
    const weekly = Math.max(0, Math.round(Number(contract?.weeklyRent || raw.weeklyRent || 0)));
    return weekly > 0 ? Math.round(weekly / 7) : 0;
  }

  /**
   * 반영된 리스 계약 → 기사별 주간 리스차감 총액 (플랫폼 미지정, 스필오버용).
   */
  function buildLeaseFeeIndex(contracts, weekStart) {
    const index = new Map();
    const start = String(weekStart || '').slice(0, 10);
    if (!start) return index;
    const end = weekEndFromStart(start);
    const today = dateKey(new Date());
    const ended = 'ended';
    (Array.isArray(contracts) ? contracts : []).forEach(contract => {
      if (!isLeaseFinalApplied(contract)) return;
      if (String(contract.status || '') === ended) return;
      const daily = contractDailyRent(contract);
      if (daily <= 0) return;
      const raw = contract.rawData || contract.raw_data || {};
      const cStart = String(contract.startDate || contract.start_date || raw.startDate || '').slice(0, 10);
      const deductStart = String(raw.deductStartDate || contract.deductStartDate || '').slice(0, 10);
      const effectiveStart = [cStart, deductStart].filter(Boolean).sort().pop() || '';
      const cEnd = String(contract.returnDate || contract.endDate || contract.end_date || raw.returnDate || raw.endDate || '').slice(0, 10);
      const days = countLeaseActiveDays(start, end, today, effectiveStart, cEnd);
      const amount = Math.max(0, Math.round(daily * days));
      if (amount <= 0) return;
      const driverId = String(contract.driverId || raw.driverId || '').trim();
      let key = driverId ? (canonicalDriverKey(driverId) || `id:${driverId}`) : '';
      if (!key) {
        const name = normalizeNameKey(contract.driverName || raw.driverName);
        const phone = normalizePhoneKey(contract.driverPhone || raw.driverPhone);
        if (name && phone) key = `np:${name}|${phone}`;
      }
      if (!key) return;
      const prev = index.get(key);
      if (prev) prev.amount += amount;
      else index.set(key, { amount, contractId: String(contract.id || '') });
    });
    return index;
  }

  function loadLeaseContractsForFee(explicit) {
    if (Array.isArray(explicit)) return explicit;
    try {
      return window.BremLeaseErp?.contracts?.()?.getAll?.() || [];
    } catch (_error) {
      return [];
    }
  }

  function loadDeductionLedgerForFee(explicit) {
    if (Array.isArray(explicit)) return explicit;
    try {
      return window.BremStorage?.deductionLedger?.getAll?.() || [];
    } catch (_error) {
      return [];
    }
  }

  function loadLeaseLoansForFee(explicit) {
    if (Array.isArray(explicit)) return explicit;
    try {
      return window.BremStorage?.leaseLoans?.getAll?.() || [];
    } catch (_error) {
      return [];
    }
  }

  /** 대여(반영) + 미납/수기(반영) → 기사별 주간 대여차감 총액 */
  function buildLoanFeeIndex(ledgerItems, weekStart, loanItems) {
    const index = new Map();
    const start = String(weekStart || '').slice(0, 10);
    if (!start) return index;
    const end = weekEndFromStart(start);
    const today = dateKey(new Date());

    const addItem = (item, { fullBalance = false } = {}) => {
      if (!item) return;
      if (item.finalApplyEnabled != null && !item.finalApplyEnabled) return;
      if (String(item.status || '') === 'paid' || String(item.status || '') === 'deleted') return;
      const balance = Math.max(0, Math.round(Number(item.balance != null ? item.balance : item.principal || 0)));
      if (balance <= 0) return;
      let amount = 0;
      if (fullBalance) {
        // 차감관리 미납·수기: 출금홀드와 동일하게 잔액 전액
        const deductStart = String(item.deductStartDate || item.weekStart || '').slice(0, 10);
        if (deductStart && today && today < deductStart) return;
        amount = balance;
      } else if (typeof window.BremStorage?.loanChargeInDateRange === 'function') {
        amount = window.BremStorage.loanChargeInDateRange(item, start, end, today);
      } else {
        const daily = Math.max(0, Math.round(Number(item.dailyDeduct || 0)));
        if (daily <= 0) return;
        const deductStart = String(item.deductStartDate || item.weekStart || '').slice(0, 10);
        const deductEnd = String(item.deductEndDate || '').slice(0, 10);
        const days = countLeaseActiveDays(start, end, today, deductStart, deductEnd);
        if (days <= 0) return;
        amount = Math.min(balance, daily * days);
        // 마지막날이 구간에 포함되면 잔액(또는 lastDayAmount) 보정
        if (deductEnd && deductEnd >= start && deductEnd <= end && deductEnd <= today) {
          const last = Math.max(0, Math.round(Number(item.lastDayAmount || 0)));
          if (last > daily) {
            const baseWithoutLast = Math.max(0, days - 1) * daily;
            amount = Math.min(balance, baseWithoutLast + last);
          }
        }
      }
      if (amount <= 0) return;
      const driverId = String(item.driverId || '').trim();
      let key = driverId ? (canonicalDriverKey(driverId) || `id:${driverId}`) : '';
      if (!key) {
        const name = normalizeNameKey(item.driverName);
        const phone = normalizePhoneKey(item.driverPhone);
        if (name && phone) key = `np:${name}|${phone}`;
      }
      if (!key) return;
      const prev = index.get(key);
      if (prev) prev.amount += amount;
      else index.set(key, { amount });
    };

    (Array.isArray(loanItems) ? loanItems : []).forEach(loan => {
      if (!loan?.finalApplyEnabled) return;
      addItem(loan);
    });
    (Array.isArray(ledgerItems) ? ledgerItems : []).forEach(item => {
      const kind = String(item.kind || '');
      if (kind === 'loan') return;
      if (kind !== 'unpaid' && kind !== 'manual') return;
      if (!item.finalApplyEnabled) return;
      addItem(item, { fullBalance: true });
    });
    return index;
  }

  function lookupDriverFeeAmount(row, feeIndex) {
    if (!feeIndex || !feeIndex.size) return 0;
    const driverId = String(row?.driverId || '').trim();
    const canon = row?.canonicalKey || (driverId ? canonicalDriverKey(driverId) : '');
    let entry = canon ? feeIndex.get(canon) : null;
    if (!entry && driverId) entry = feeIndex.get(`id:${driverId}`);
    if (!entry) {
      const name = normalizeNameKey(row?.name);
      const driver = driverId ? window.BremStorage?.drivers?.getById?.(driverId) : null;
      const phone = normalizePhoneKey(driver?.phone || driver?.raw_data?.phone || '');
      if (name && phone) entry = feeIndex.get(`np:${name}|${phone}`);
    }
    return Math.max(0, Math.round(Number(entry?.amount || 0)));
  }

  function allocateFeeAcrossPlatforms(totalByDriver, remainingCap) {
    const out = new Map();
    const ensure = (k) => {
      if (!out.has(k)) out.set(k, { coupang: 0, baemin: 0 });
      return out.get(k);
    };
    (totalByDriver instanceof Map ? totalByDriver : new Map()).forEach((entry, key) => {
      let left = Math.max(0, Math.round(Number(entry?.amount || entry || 0)));
      if (left <= 0) return;
      const rem = remainingCap.get(key) || { coupang: 0, baemin: 0 };
      const order = Number(rem.coupang || 0) >= Number(rem.baemin || 0)
        ? ['coupang', 'baemin']
        : ['baemin', 'coupang'];
      const alloc = ensure(key);
      order.forEach(p => {
        if (left <= 0) return;
        const room = Math.max(0, Number(rem[p] || 0));
        const take = room > 0 ? Math.min(left, room) : (p === order[0] ? left : 0);
        if (take <= 0) return;
        alloc[p] += take;
        rem[p] = Number(rem[p] || 0) - take;
        left -= take;
      });
      if (left > 0) {
        const prefer = order[0];
        alloc[prefer] += left;
        rem[prefer] = Number(rem[prefer] || 0) - left;
      }
      remainingCap.set(key, rem);
    });
    return out;
  }

  function buildDriverFeeTotalsFromIndex(feeIndex) {
    const byDriver = new Map();
    (feeIndex instanceof Map ? feeIndex : new Map()).forEach((entry, key) => {
      byDriver.set(key, { amount: Math.max(0, Math.round(Number(entry?.amount || 0))) });
    });
    return byDriver;
  }

  function buildLeaseLoanSpilloverAllocation(weekSettlements, options = {}) {
    const week = options.week || (weekSettlements?.[0] ? settlementWeek(weekSettlements[0]) : weekStartKey());
    const capacityMap = buildWeekCapacityMap(weekSettlements);
    const remaining = new Map();
    capacityMap.forEach((v, k) => {
      remaining.set(k, {
        coupang: Math.max(0, Number(v.coupang || 0)),
        baemin: Math.max(0, Number(v.baemin || 0))
      });
    });

    let allocation = options._allocation || null;
    if (!allocation && Array.isArray(options.withdrawals)) {
      allocation = allocateWeekWithdrawals(options.withdrawals, week, capacityMap);
    }
    if (allocation) {
      allocation.forEach((slice, key) => {
        const rem = remaining.get(key) || { coupang: 0, baemin: 0 };
        ['coupang', 'baemin'].forEach(p => {
          const used = Math.max(0, Number(slice?.[p]?.prepaid || 0)) + Math.max(0, Number(slice?.[p]?.fee || 0));
          rem[p] = Number(rem[p] || 0) - used;
        });
        remaining.set(key, rem);
      });
    }

    const leaseIndex = options._leaseFeeIndex
      || buildLeaseFeeIndex(loadLeaseContractsForFee(options.leaseContracts), week);
    const loanIndex = options._loanFeeIndex
      || buildLoanFeeIndex(
        loadDeductionLedgerForFee(options.ledgerItems),
        week,
        loadLeaseLoansForFee(options.loanItems)
      );

    const leaseTotals = buildDriverFeeTotalsFromIndex(leaseIndex);
    const loanTotals = buildDriverFeeTotalsFromIndex(loanIndex);
    const leaseAlloc = allocateFeeAcrossPlatforms(leaseTotals, remaining);
    const loanAlloc = allocateFeeAcrossPlatforms(loanTotals, remaining);
    return { leaseAlloc, loanAlloc, leaseIndex, loanIndex };
  }

  /**
   * 스필오버 배분 확인용 리포트.
   * 기사별 리스·대여·선정산이 쿠팡/배민에 어떻게 나뉘었는지 한 줄로 보여준다.
   */
  function buildSpilloverReport(weekSettlements, options = {}) {
    const list = Array.isArray(weekSettlements) ? weekSettlements : [];
    const week = options.week || (list[0] ? settlementWeek(list[0]) : weekStartKey());
    const capacityMap = buildWeekCapacityMap(list);
    const withdrawals = Array.isArray(options.withdrawals) ? options.withdrawals : [];
    const prepaidAlloc = allocateWeekWithdrawals(withdrawals, week, capacityMap);
    const spill = buildLeaseLoanSpilloverAllocation(list, {
      week,
      withdrawals,
      _allocation: prepaidAlloc,
      leaseContracts: options.leaseContracts,
      ledgerItems: options.ledgerItems,
      loanItems: options.loanItems
    });

    const metaByKey = new Map();
    list.forEach(settlement => {
      const platform = normalizePlatform(settlement.platform);
      const unitCallFee = callFeeUnit(platform);
      const adj = adjustmentMaps(settlement);
      (Array.isArray(settlement.riders) ? settlement.riders : []).forEach(rider => {
        const base = riderRowBase(rider, settlement, platform, unitCallFee, adj);
        if (!base.canonicalKey) return;
        const prev = metaByKey.get(base.canonicalKey) || {
          driverId: base.driverId,
          name: base.name,
          coupangId: '',
          baeminId: '',
          capacityCoupang: 0,
          capacityBaemin: 0
        };
        if (platform === 'coupang') prev.coupangId = base.idLabel !== '-' ? base.idLabel : prev.coupangId;
        if (platform === 'baemin') prev.baeminId = base.idLabel !== '-' ? base.idLabel : prev.baeminId;
        if (base.name && base.name !== '-') prev.name = base.name;
        if (base.driverId) prev.driverId = base.driverId;
        metaByKey.set(base.canonicalKey, prev);
      });
    });
    capacityMap.forEach((cap, key) => {
      const meta = metaByKey.get(key) || { name: key, driverId: '', coupangId: '', baeminId: '' };
      meta.capacityCoupang = Math.max(0, Math.round(Number(cap.coupang || 0)));
      meta.capacityBaemin = Math.max(0, Math.round(Number(cap.baemin || 0)));
      metaByKey.set(key, meta);
    });

    const keys = new Set([
      ...spill.leaseAlloc.keys(),
      ...spill.loanAlloc.keys(),
      ...(prepaidAlloc instanceof Map ? prepaidAlloc.keys() : [])
    ]);

    const rows = [];
    keys.forEach(key => {
      const meta = metaByKey.get(key) || { name: key, driverId: '', coupangId: '', baeminId: '' };
      const leaseTotal = Math.max(0, Math.round(Number(spill.leaseIndex.get(key)?.amount || 0)));
      const loanTotal = Math.max(0, Math.round(Number(spill.loanIndex.get(key)?.amount || 0)));
      const lease = spill.leaseAlloc.get(key) || { coupang: 0, baemin: 0 };
      const loan = spill.loanAlloc.get(key) || { coupang: 0, baemin: 0 };
      const prepaidSlice = prepaidAlloc?.get?.(key) || null;
      const prepaidCoupang = Math.max(0, Math.round(Number(prepaidSlice?.coupang?.prepaid || 0)));
      const prepaidBaemin = Math.max(0, Math.round(Number(prepaidSlice?.baemin?.prepaid || 0)));
      const prepaidTotal = prepaidCoupang + prepaidBaemin;
      if (leaseTotal <= 0 && loanTotal <= 0 && prepaidTotal <= 0) return;

      const leaseCoupang = Math.max(0, Math.round(Number(lease.coupang || 0)));
      const leaseBaemin = Math.max(0, Math.round(Number(lease.baemin || 0)));
      const loanCoupang = Math.max(0, Math.round(Number(loan.coupang || 0)));
      const loanBaemin = Math.max(0, Math.round(Number(loan.baemin || 0)));
      const crossed = (leaseCoupang > 0 && leaseBaemin > 0)
        || (loanCoupang > 0 && loanBaemin > 0)
        || (prepaidCoupang > 0 && prepaidBaemin > 0);
      const prefer = Number(meta.capacityCoupang || 0) >= Number(meta.capacityBaemin || 0) ? 'coupang' : 'baemin';

      rows.push({
        key,
        driverId: meta.driverId || '',
        name: meta.name || '-',
        coupangId: meta.coupangId || '',
        baeminId: meta.baeminId || '',
        capacityCoupang: meta.capacityCoupang || 0,
        capacityBaemin: meta.capacityBaemin || 0,
        prefer,
        leaseTotal,
        leaseCoupang,
        leaseBaemin,
        loanTotal,
        loanCoupang,
        loanBaemin,
        prepaidTotal,
        prepaidCoupang,
        prepaidBaemin,
        crossed
      });
    });

    rows.sort((a, b) => {
      if (a.crossed !== b.crossed) return a.crossed ? -1 : 1;
      return String(a.name).localeCompare(String(b.name), 'ko');
    });
    return { week, rows, spill, prepaidAlloc, capacityMap };
  }

  function resolveSpilloverFeeForRow(row, allocMap, feeIndex) {
    const driverId = String(row?.driverId || '').trim();
    const platform = normalizePlatform(row?.platform);
    const canon = row?.canonicalKey || (driverId ? canonicalDriverKey(driverId) : '');
    if (canon && allocMap?.has?.(canon)) {
      return Math.max(0, Math.round(Number(allocMap.get(canon)?.[platform] || 0)));
    }
    if (driverId && allocMap?.has?.(`id:${driverId}`)) {
      return Math.max(0, Math.round(Number(allocMap.get(`id:${driverId}`)?.[platform] || 0)));
    }
    const name = normalizeNameKey(row?.name);
    const driver = driverId ? window.BremStorage?.drivers?.getById?.(driverId) : null;
    const phone = normalizePhoneKey(driver?.phone || '');
    const namePhoneKey = (name && phone) ? `np:${name}|${phone}` : '';
    if (namePhoneKey && allocMap?.has?.(namePhoneKey)) {
      return Math.max(0, Math.round(Number(allocMap.get(namePhoneKey)?.[platform] || 0)));
    }
    return lookupDriverFeeAmount(row, feeIndex);
  }

  function resolveLeaseFeeForRow(row, leaseIndex) {
    return lookupDriverFeeAmount(row, leaseIndex);
  }

  function resolveLoanFeeForRow(row, loanIndex) {
    return lookupDriverFeeAmount(row, loanIndex);
  }

  // 정산서 1건 → 라이더별 정산 행.
  // 리스차감·대여차감: ERP driverId 기준 주간분 → 실지급 큰 플랫폼부터 스필오버.
  function computeRows(settlement, options = {}) {
    if (!settlement) return [];
    const platform = normalizePlatform(settlement.platform);
    const week = settlementWeek(settlement);
    const unitCallFee = callFeeUnit(platform);
    const adj = adjustmentMaps(settlement);

    let allocation = options._allocation || null;
    if (!allocation && Array.isArray(options.weekSettlements) && options.weekSettlements.length) {
      allocation = allocateWeekWithdrawals(
        options.withdrawals,
        week,
        buildWeekCapacityMap(options.weekSettlements)
      );
    }
    const strictMap = allocation ? null : (options._prepaidMap || buildWeekPrepaidByPlatform(options.withdrawals, week));
    const source = allocation || strictMap;
    const consumed = options._consumed || new Set();
    const leaseConsumed = options._leaseConsumed || new Set();
    const loanConsumed = options._loanConsumed || new Set();

    let spill = options._leaseLoanSpill || null;
    if (!spill) {
      const weekList = Array.isArray(options.weekSettlements) && options.weekSettlements.length
        ? options.weekSettlements
        : [settlement];
      spill = buildLeaseLoanSpilloverAllocation(weekList, {
        week,
        withdrawals: options.withdrawals,
        _allocation: allocation,
        leaseContracts: options.leaseContracts,
        ledgerItems: options.ledgerItems,
        loanItems: options.loanItems,
        _leaseFeeIndex: options._leaseFeeIndex,
        _loanFeeIndex: options._loanFeeIndex
      });
    }

    const rows = [];
    (Array.isArray(settlement.riders) ? settlement.riders : []).forEach(rider => {
      const base = riderRowBase(rider, settlement, platform, unitCallFee, adj);
      const key = base.canonicalKey;

      let prepaid = 0;
      let dailySettlementFee = 0;
      if (key) {
        const dedupeKey = `${key}:${platform}`;
        const slice = source.get(key)?.[platform];
        if (slice && !consumed.has(dedupeKey)) {
          consumed.add(dedupeKey);
          prepaid = Math.max(0, Math.round(Number(slice.prepaid || 0)));
          dailySettlementFee = Math.max(0, Math.round(Number(slice.fee || 0)));
        }
      }

      // 스필오버 배분은 플랫폼별로 이미 나뉘어 있음. 같은 플랫폼 행만 중복 방지.
      let leaseFee = 0;
      let leaseFeeManual = false;
      const leaseDedupe = `${key || base.driverId || base.name}:lease:${platform}`;
      if (!leaseConsumed.has(leaseDedupe)) {
        leaseFee = resolveSpilloverFeeForRow(base, spill.leaseAlloc, spill.leaseIndex);
        leaseConsumed.add(leaseDedupe);
      }
      // 정산결과 수동 override: 해당 정산서·기사만 (자동 스필오버 이후)
      const manual = riderManualAdjustments(rider);
      const leaseOverride = pickOverrideAmount(adj.leaseMap, base.driverId, manual, 'leaseFee');
      if (leaseOverride != null) {
        leaseFee = leaseOverride;
        leaseFeeManual = true;
      }

      let loanFee = 0;
      let loanFeeManual = false;
      const loanDedupe = `${key || base.driverId || base.name}:loan:${platform}`;
      if (!loanConsumed.has(loanDedupe)) {
        loanFee = resolveSpilloverFeeForRow(base, spill.loanAlloc, spill.loanIndex);
        loanConsumed.add(loanDedupe);
      }
      const loanOverride = pickOverrideAmount(adj.loanMap, base.driverId, manual, 'loanFee');
      if (loanOverride != null) {
        loanFee = loanOverride;
        loanFeeManual = true;
      }

      const deductTotal = base.baseDeduct + dailySettlementFee + prepaid + leaseFee + loanFee;
      const computedNet = base.grossPay - deductTotal;
      // 주정산 미리보기에서 「Z열 기준으로 지급액 맞추기」한 기사만 총지급액을 시트 Z로 둔다.
      // 배달비·공제 계산식은 그대로다. (저장 JSON 에서 true 가 1 로 올 수 있다)
      const payoutOverride = Math.round(Number(rider.amounts?.payoutOverride || 0));
      const useSheetPayout = rider.amounts?.useSheetPayout === true
        || rider.amounts?.useSheetPayout === 1
        || rider.amounts?.useSheetPayout === 'true'
        || payoutOverride > 0;
      const sheetPayout = payoutOverride || Math.round(Number(rider.amounts?.sheetPayout || 0));
      const netPay = useSheetPayout ? sheetPayout : computedNet;

      rows.push({
        driverId: base.driverId,
        platform,
        settlementId: base.settlementId,
        region: base.region,
        name: base.name,
        idLabel: base.idLabel,
        callCount: base.callCount,
        deliveryFee: base.deliveryFee,
        missionPay: base.missionPay,
        missionPayExcel: base.missionPayExcel,
        missionPayManual: base.missionPayManual,
        deductionDetail: base.deductionDetail,
        other: base.other,
        promo: base.promo,
        grossPay: base.grossPay,
        employmentInsurance: base.employmentInsurance,
        accidentInsurance: base.accidentInsurance,
        hourlyInsurance: base.hourlyInsurance,
        withholdingTax: base.withholdingTax,
        promotionWithholdingTax: base.promotionWithholdingTax,
        callFee: base.callFee,
        dailySettlementFee,
        prepaid,
        leaseFee,
        loanFee,
        leaseFeeManual,
        loanFeeManual,
        deductTotal,
        netPay,
        useSheetPayout,
        sheetPayout,
        untaggedWithdrawalCount: source.untaggedCount || 0,
        untaggedWithdrawalAmount: source.untaggedAmount || 0
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

  /** 원천세 신고용 — 선택 정산서의 기사별 지급합계(grossPay) 합산 */
  function buildGrossPayTotals(settlements) {
    const byPerson = new Map();
    (Array.isArray(settlements) ? settlements : []).forEach(settlement => {
      const platform = normalizePlatform(settlement.platform);
      const unitCallFee = callFeeUnit(platform);
      const adj = adjustmentMaps(settlement);
      (Array.isArray(settlement.riders) ? settlement.riders : []).forEach(rider => {
        const base = riderRowBase(rider, settlement, platform, unitCallFee, adj);
        const key = base.canonicalKey || `row:${base.platform}:${base.idLabel}:${base.name}`;
        const prev = byPerson.get(key);
        if (!prev) {
          byPerson.set(key, {
            key,
            driverId: base.driverId,
            name: base.name,
            grossPay: Math.round(Number(base.grossPay || 0)),
            platforms: new Set([platform]),
            idLabels: new Set(base.idLabel && base.idLabel !== '-' ? [base.idLabel] : [])
          });
          return;
        }
        prev.grossPay += Math.round(Number(base.grossPay || 0));
        prev.platforms.add(platform);
        if (!prev.driverId && base.driverId) prev.driverId = base.driverId;
        if (base.idLabel && base.idLabel !== '-') prev.idLabels.add(base.idLabel);
      });
    });
    return sortByName([...byPerson.values()].map(row => ({
      key: row.key,
      driverId: row.driverId,
      name: row.name,
      grossPay: row.grossPay,
      platformLabel: ['coupang', 'baemin']
        .filter(p => row.platforms.has(p))
        .map(p => (p === 'coupang' ? '쿠팡' : '배민'))
        .join('+'),
      idLabel: [...row.idLabels].join(' / ') || '-'
    })));
  }

  function sumRows(rows) {
    const totals = {};
    NUMERIC_KEYS.forEach(key => { totals[key] = 0; });
    let negativeNetCount = 0;
    let untaggedCount = 0;
    let untaggedAmount = 0;
    (Array.isArray(rows) ? rows : []).forEach(row => {
      NUMERIC_KEYS.forEach(key => { totals[key] += Number(row[key] || 0); });
      if (Number(row.netPay || 0) < 0) negativeNetCount += 1;
      if (!untaggedCount && Number(row.untaggedWithdrawalCount || 0) > 0) {
        untaggedCount = Number(row.untaggedWithdrawalCount || 0);
        untaggedAmount = Number(row.untaggedWithdrawalAmount || 0);
      }
    });
    totals.negativeNetCount = negativeNetCount;
    totals.untaggedWithdrawalCount = untaggedCount;
    totals.untaggedWithdrawalAmount = untaggedAmount;
    totals.generalDeduct = generalDeductTotal(totals);
    totals.withholdingTaxTotal = withholdingTaxTotal(totals);
    totals.grossAfterGeneralDeduct = Math.round(Number(totals.grossPay || 0)) - totals.generalDeduct;
    return totals;
  }

  return {
    PROMO_TAX_RATE,
    GROUPS,
    COLUMNS,
    NUMERIC_KEYS,
    GENERAL_DEDUCT_KEYS,
    WITHHOLDING_TAX_KEYS,
    generalDeductTotal,
    withholdingTaxTotal,
    promoTax,
    dateKey,
    weekStartKey,
    settlementWeek,
    normalizePlatform,
    normalizeWithdrawalPlatform,
    driverName,
    callFeeUnit,
    canonicalDriverKey,
    buildWeekPrepaidByPlatform,
    buildWeekCapacityMap,
    allocateWeekWithdrawals,
    buildLeaseLoanSpilloverAllocation,
    buildSpilloverReport,
    computeRows,
    buildGrossPayTotals,
    escapeHtml,
    theadHtml,
    sortByName,
    sumRows
  };
})();

if (typeof window !== 'undefined') window.BremDirectSettlementCalc = BremDirectSettlementCalc;
