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

  function normalizePhoneTail(value) {
    return String(value || '').replace(/\D/g, '').slice(-4);
  }

  function driverAliasKeys(driver) {
    if (!driver) return [];
    const keys = [];
    const id = String(driver.id || '').trim();
    if (id) keys.push(`id:${id}`);
    const baeminId = String(driver.baeminId || driver.raw_data?.baeminId || '').trim().toUpperCase();
    if (baeminId) keys.push(`baemin:${baeminId}`);
    const name = String(driver.name || '').replace(/\s+/g, '');
    const phone = normalizePhoneTail(driver.phone || driver.raw_data?.phone);
    if (name && phone) keys.push(`np:${name}|${phone}`);
    return keys;
  }

  // 중복 기사 등록 등으로 출금 driverId 와 정산 matchedRiderId 가 달라도
  // 같은 사람(배민ID / 이름+전화)이면 선정산을 붙인다.
  function buildDriverAliasLookup() {
    const byKey = new Map();
    const list = window.BremStorage?.drivers?.getAll?.() || [];
    list.forEach(driver => {
      const id = String(driver.id || '').trim();
      if (!id) return;
      driverAliasKeys(driver).forEach(key => {
        if (!byKey.has(key)) byKey.set(key, new Set());
        byKey.get(key).add(id);
      });
    });
    return byKey;
  }

  function expandDriverIds(driverId, aliasLookup) {
    const ids = new Set();
    const primary = String(driverId || '').trim();
    if (!primary) return ids;
    ids.add(primary);
    const driver = window.BremStorage?.drivers?.getById?.(primary);
    driverAliasKeys(driver).forEach(key => {
      (aliasLookup.get(key) || []).forEach(id => ids.add(id));
    });
    return ids;
  }

  // 이 주 선정산(일정산) 처리완료 금액·수수료 맵: driverId → { prepaid, fee }
  // 배민 출금 → 배민 정산만, 쿠팡 출금 → 쿠팡 정산만 차감한다.
  // (한쪽에 몰아 넣고 남은 금액을 반대편에서 까는 배분은 하지 않는다.)
  // 표시·공제 모두 처리완료 실금액을 그대로 쓴다. (지급한도로 깎지 않음)
  function completedWithdrawalMap(withdrawals, week, platform) {
    const target = normalizePlatform(platform);
    const map = new Map();
    let untaggedCount = 0;
    let untaggedAmount = 0;
    const aliasLookup = buildDriverAliasLookup();

    (Array.isArray(withdrawals) ? withdrawals : []).forEach(row => {
      if (String(row.status || '') !== 'completed') return;
      if (String(row.weekStart || '').slice(0, 10) !== week) return;
      const rowPlatform = normalizeWithdrawalPlatform(row.platform);
      if (!rowPlatform) {
        untaggedCount += 1;
        untaggedAmount += Math.max(0, Math.round(Number(row.amount || 0)));
        return;
      }
      if (rowPlatform !== target) return;
      const driverId = String(row.driverId || '').trim();
      if (!driverId) return;
      const amount = Math.max(0, Math.round(Number(row.amount || 0)));
      const fee = withdrawalRowFee(row, target);
      // 출금에 찍힌 id + 동일인 후보 id 모두에 같은 금액을 걸어 두고,
      // 정산행에서 한 번만 꺼내 쓰게 한다(아래 computeRows).
      expandDriverIds(driverId, aliasLookup).forEach(id => {
        const prev = map.get(id) || { prepaid: 0, fee: 0, sourceIds: new Set() };
        // 같은 출금건을 alias 로 중복 합산하지 않도록 source request id 를 기억한다.
        const sourceKey = String(row.id || `${driverId}:${amount}:${fee}:${row.completedAt || row.updatedAt || ''}`);
        if (prev.sourceIds.has(sourceKey)) return;
        prev.sourceIds.add(sourceKey);
        prev.prepaid += amount;
        prev.fee += fee;
        map.set(id, prev);
      });
    });

    map.untaggedCount = untaggedCount;
    map.untaggedAmount = untaggedAmount;
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
    const usedWithdrawalSources = new Set();

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

      // alias 맵에 걸린 출금은 sourceIds 기준으로 한 기사행에만 반영한다.
      let prepaid = 0;
      let dailySettlementFee = 0;
      if (driverId && withdrawMap.has(driverId)) {
        const wd = withdrawMap.get(driverId);
        const freshSources = [...(wd.sourceIds || [])].filter(key => !usedWithdrawalSources.has(key));
        if (freshSources.length) {
          freshSources.forEach(key => usedWithdrawalSources.add(key));
          prepaid = Math.max(0, Math.round(Number(wd.prepaid || 0)));
          dailySettlementFee = Math.max(0, Math.round(Number(wd.fee || 0)));
        }
      }

      const baseDeduct = deductionDetail + employmentInsurance + accidentInsurance + hourlyInsurance
        + withholdingTax + promotionWithholdingTax + callFee;
      const capacity = Math.max(0, Math.round(grossPay - baseDeduct));
      const prepaidConsume = prepaid + dailySettlementFee;
      const prepaidOver = prepaidConsume > capacity;
      const deductTotal = baseDeduct + dailySettlementFee + prepaid;
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
        deductTotal, netPay,
        prepaidRaw: prepaid,
        prepaidExcess: prepaidOver ? Math.max(0, prepaidConsume - capacity) : 0,
        prepaidCapped: false,
        prepaidOverCapacity: prepaidOver,
        untaggedWithdrawalCount: withdrawMap.untaggedCount || 0,
        untaggedWithdrawalAmount: withdrawMap.untaggedAmount || 0
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
    let prepaidOverCount = 0;
    let prepaidExcessTotal = 0;
    let negativeNetCount = 0;
    let untaggedCount = 0;
    let untaggedAmount = 0;
    (Array.isArray(rows) ? rows : []).forEach(row => {
      NUMERIC_KEYS.forEach(key => { totals[key] += Number(row[key] || 0); });
      if (row.prepaidOverCapacity) {
        prepaidOverCount += 1;
        prepaidExcessTotal += Math.max(0, Math.round(Number(row.prepaidExcess) || 0));
      }
      if (Number(row.netPay || 0) < 0) negativeNetCount += 1;
      if (!untaggedCount && Number(row.untaggedWithdrawalCount || 0) > 0) {
        untaggedCount = Number(row.untaggedWithdrawalCount || 0);
        untaggedAmount = Number(row.untaggedWithdrawalAmount || 0);
      }
    });
    totals.prepaidCappedCount = prepaidOverCount; // 하위 호환(요약 배지)
    totals.prepaidOverCount = prepaidOverCount;
    totals.prepaidExcessTotal = prepaidExcessTotal;
    totals.negativeNetCount = negativeNetCount;
    totals.untaggedWithdrawalCount = untaggedCount;
    totals.untaggedWithdrawalAmount = untaggedAmount;
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
    computeRows,
    escapeHtml,
    theadHtml,
    sortByName,
    sumRows
  };
})();

if (typeof window !== 'undefined') window.BremDirectSettlementCalc = BremDirectSettlementCalc;
