const { getServiceClient } = require('./admin-bootstrap');
const { getRiderMe } = require('./rider-auth');

const PUBLISH_META_KEY = 'brem_payroll_rider_publish';

function normalizePhone(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, '').toLowerCase();
}

function formatLocalDateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function normalizeSettlementWeekStart(dateValue) {
  const seed = String(dateValue || '').trim().slice(0, 10);
  const base = seed || formatLocalDateKey(new Date());
  const date = new Date(`${base}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  const day = date.getDay();
  // 시작일이 화요일로 하루 밀린 경우(off-by-one) 다음날 수요일로 교정한다.
  if (day === 2) {
    date.setDate(date.getDate() + 1);
    return formatLocalDateKey(date);
  }
  const diff = (day - 3 + 7) % 7;
  date.setDate(date.getDate() - diff);
  return formatLocalDateKey(date);
}

function settlementWeekEnd(weekStart) {
  const start = new Date(`${weekStart}T00:00:00`);
  if (Number.isNaN(start.getTime())) return '';
  start.setDate(start.getDate() + 6);
  return formatLocalDateKey(start);
}

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() + days);
  return formatLocalDateKey(date);
}

function defaultPaymentDateForWeekEnd(weekEnd) {
  return weekEnd ? addDays(weekEnd, 3) : '';
}

async function readSettingValue(supabase, key, fallback) {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error) throw error;
  if (data?.value !== undefined && data?.value !== null) return data.value;
  return fallback;
}

async function resolvePaymentDate(supabase, settlementWeekStart, settlementWeekEndDate) {
  try {
    const meta = await readSettingValue(supabase, PUBLISH_META_KEY, {});
    const fromMeta = meta?.weeks?.[settlementWeekStart]?.paymentDate;
    if (fromMeta) return String(fromMeta).slice(0, 10);
  } catch (_error) {
    /* ignore */
  }
  return defaultPaymentDateForWeekEnd(settlementWeekEndDate);
}

function parseMoney(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? Math.round(num) : 0;
}

function normalizePlatform(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'coupang' || raw === '쿠팡') return 'coupang';
  if (raw === 'baemin' || raw === '배민') return 'baemin';
  if (raw === 'both' || raw === '쿠팡·배민' || raw === '쿠팡/배민') return 'both';
  return '';
}

/**
 * 대리점명으로 정산 플랫폼 판정.
 * matchPlatform(기사 ID 매칭 결과)과 혼동하지 말 것 — both 는 "쿠팡·배민 ID 둘 다 있음"일 뿐.
 */
function detectBranchPlatform(branchName) {
  const text = String(branchName || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!text) return '';
  if (/쿠팡|coupang/.test(text)) return 'coupang';
  if (/배민|baemin|우아한/.test(text)) return 'baemin';
  // 팀브로 브랜드 단독(쿠팡 미포함)은 배민 소속
  if (/팀브로|teambro/.test(text)) return 'baemin';
  return '';
}

/** 정산결과(직계약)과 같은 지급·공제 키 */
function emptyDirectBucket() {
  return {
    callCount: 0,
    deliveryFee: 0,
    missionPay: 0,
    other: 0,
    promo: 0,
    grossPay: 0,
    deductionDetail: 0,
    employmentInsurance: 0,
    accidentInsurance: 0,
    hourlyInsurance: 0,
    withholdingTax: 0,
    promotionWithholdingTax: 0,
    callFee: 0,
    dailySettlementFee: 0,
    prepaid: 0,
    leaseFee: 0,
    loanFee: 0,
    deductTotal: 0,
    netPay: 0
  };
}

function addBuckets(target, source) {
  Object.keys(target).forEach(key => {
    target[key] += parseMoney(source?.[key]);
  });
  return target;
}

function finalizeBucket(bucket) {
  const next = { ...emptyDirectBucket(), ...(bucket || {}) };
  next.callCount = Math.max(0, Math.round(Number(next.callCount || 0)));
  next.grossPay = next.deliveryFee + next.missionPay + next.other + next.promo;
  next.deductTotal = next.deductionDetail
    + next.employmentInsurance
    + next.accidentInsurance
    + next.hourlyInsurance
    + next.withholdingTax
    + next.promotionWithholdingTax
    + next.callFee
    + next.dailySettlementFee
    + next.prepaid
    + next.leaseFee
    + next.loanFee;
  next.netPay = next.grossPay - next.deductTotal;
  return next;
}

function readRawPayslip(line) {
  const raw = line?.raw_data && typeof line.raw_data === 'object' ? line.raw_data : {};
  const payslip = raw.payslip && typeof raw.payslip === 'object' ? raw.payslip : raw;
  return { raw, payslip };
}

function lineToDirectBucket(line) {
  const { raw, payslip } = readRawPayslip(line);
  const get = (key, ...aliases) => {
    for (const name of [key, ...aliases]) {
      if (payslip[name] != null && payslip[name] !== '') return parseMoney(payslip[name]);
      if (raw[name] != null && raw[name] !== '') return parseMoney(raw[name]);
    }
    return 0;
  };

  const bucket = emptyDirectBucket();
  bucket.callCount = Math.max(0, Math.round(Number(
    payslip.callCount ?? raw.callCount ?? line?.call_count ?? 0
  )));
  bucket.deliveryFee = get('deliveryFee', 'totalDeliveryFee', 'basePay');
  bucket.missionPay = get('missionPay', 'baeminMission');
  bucket.other = get('other', 'otherPayment');
  bucket.promo = get('promo', 'bremPromotion');
  bucket.deductionDetail = get('deductionDetail');
  bucket.employmentInsurance = get('employmentInsurance');
  bucket.accidentInsurance = get('accidentInsurance', 'industrialAccidentInsurance');
  bucket.hourlyInsurance = get('hourlyInsurance');
  bucket.withholdingTax = get('withholdingTax', 'incomeTax');
  bucket.promotionWithholdingTax = get('promotionWithholdingTax');
  bucket.callFee = get('callFee');
  bucket.dailySettlementFee = get('dailySettlementFee');
  bucket.prepaid = get('prepaid');
  bucket.leaseFee = get('leaseFee');
  bucket.loanFee = get('loanFee');
  return finalizeBucket(bucket);
}

function resolveLinePlatform(line) {
  const { raw, payslip } = readRawPayslip(line);

  // 1) 명시 정산 플랫폼 (직계약·업로드)
  const explicit = normalizePlatform(
    payslip.platform
    || raw.platform
    || raw.branchPlatform
    || payslip.branchPlatform
  );
  if (explicit === 'coupang' || explicit === 'baemin') return explicit;

  // 2) 대리점명 (팀브로배민 등) — 정산 소속의 1순위 힌트
  const fromBranch = detectBranchPlatform(
    payslip.branchName
    || raw.branchName
    || line?.department
    || line?.branch_name
    || ''
  );
  if (fromBranch) return fromBranch;

  // 3) 파일명 힌트
  const fileHint = String(
    raw.fileName || raw.uploadFileName || payslip.fileName || raw.sourceFileName || ''
  ).toLowerCase();
  if (fileHint) {
    const hasBaemin = /배민|baemin/.test(fileHint);
    const hasCoupang = /쿠팡|coupang/.test(fileHint);
    if (hasBaemin && !hasCoupang) return 'baemin';
    if (hasCoupang && !hasBaemin) return 'coupang';
  }

  // 4) matchPlatform 은 "기사 ID 매칭" 결과.
  //    both = 쿠팡·배민 ID가 둘 다 있다는 뜻이지, 합산 명세가 아님.
  //    단일 플랫폼일 때만 사용한다.
  const match = normalizePlatform(raw.matchPlatform || payslip.matchPlatform);
  if (match === 'coupang' || match === 'baemin') return match;

  // payslip.platform 이 명시적으로 both 인 경우만 both (레거시 합산 명세)
  if (explicit === 'both') return 'both';
  return '';
}

/**
 * 한 줄을 쿠팡/배민 탭으로 나눈다.
 * - baemin/coupang 명시 → 전액 해당 탭
 * - both(명시) → 추가지급(미션)만 배민, 나머지 쿠팡 (레거시 합산 명세)
 * - 미지정 → ID both 착시로 쿠팡 몰아넣지 않음. 한쪽 ID만 있으면 그쪽, 아니면 배민(팀브로)
 */
function splitLineIntoPlatforms(line) {
  const platform = resolveLinePlatform(line);
  const full = lineToDirectBucket(line);
  const coupang = emptyDirectBucket();
  const baemin = emptyDirectBucket();

  if (platform === 'coupang') {
    addBuckets(coupang, full);
  } else if (platform === 'baemin') {
    addBuckets(baemin, full);
  } else if (platform === 'both') {
    // 레거시 합산 명세: 배민미션만 배민, 나머지 쿠팡
    baemin.missionPay = full.missionPay;
    coupang.callCount = full.callCount;
    coupang.deliveryFee = full.deliveryFee;
    coupang.other = full.other;
    coupang.promo = full.promo;
    coupang.deductionDetail = full.deductionDetail;
    coupang.employmentInsurance = full.employmentInsurance;
    coupang.accidentInsurance = full.accidentInsurance;
    coupang.hourlyInsurance = full.hourlyInsurance;
    coupang.withholdingTax = full.withholdingTax;
    coupang.promotionWithholdingTax = full.promotionWithholdingTax;
    coupang.callFee = full.callFee;
    coupang.dailySettlementFee = full.dailySettlementFee;
    coupang.prepaid = full.prepaid;
    coupang.leaseFee = full.leaseFee;
    coupang.loanFee = full.loanFee;
  } else {
    const { raw, payslip } = readRawPayslip(line);
    const hasBaemin = Boolean(String(raw.matchedBaeminId || payslip.baeminId || '').trim());
    const hasCoupang = Boolean(String(raw.matchedCoupangId || payslip.coupangId || '').trim());
    if (hasCoupang && !hasBaemin) addBuckets(coupang, full);
    else addBuckets(baemin, full);
  }

  return {
    coupang: finalizeBucket(coupang),
    baemin: finalizeBucket(baemin)
  };
}

function bucketToLegacyPayslip(bucket, meta = {}) {
  const row = finalizeBucket(bucket);
  return {
    riderName: meta.riderName || '',
    coupangId: meta.coupangId || '',
    baeminId: meta.baeminId || '',
    callCount: row.callCount,
    // 레거시 키 (기존 클라이언트·브로 호환)
    totalDeliveryFee: row.deliveryFee,
    baeminMission: row.missionPay,
    otherPayment: row.other,
    bremPromotion: row.promo,
    grossPaymentTotal: row.grossPay,
    employmentInsurance: row.employmentInsurance,
    industrialAccidentInsurance: row.accidentInsurance,
    hourlyInsurance: row.hourlyInsurance,
    withholdingTax: row.withholdingTax,
    promotionWithholdingTax: row.promotionWithholdingTax,
    callFee: row.callFee,
    dailySettlementFee: row.dailySettlementFee,
    deductionTotal: row.deductTotal,
    finalNetPay: row.netPay,
    // 직계약 정렬 키
    deliveryFee: row.deliveryFee,
    missionPay: row.missionPay,
    other: row.other,
    promo: row.promo,
    grossPay: row.grossPay,
    deductionDetail: row.deductionDetail,
    accidentInsurance: row.accidentInsurance,
    prepaid: row.prepaid,
    leaseFee: row.leaseFee,
    loanFee: row.loanFee,
    deductTotal: row.deductTotal,
    netPay: row.netPay,
    settlementWeekStart: meta.settlementWeekStart || '',
    settlementWeekEnd: meta.settlementWeekEnd || '',
    settlementWeekLabel: meta.settlementWeekLabel || ''
  };
}

function isDirectPayslipLine(line) {
  const raw = line?.raw_data && typeof line.raw_data === 'object' ? line.raw_data : {};
  if (String(raw.source || '').toLowerCase() === 'direct') return true;
  return String(line?.upload_id || '').startsWith('direct-');
}

function bucketHasActivity(bucket) {
  if (!bucket) return false;
  return Boolean(
    bucket.grossPay
    || bucket.deductTotal
    || bucket.callCount
    || bucket.deliveryFee
    || bucket.missionPay
    || bucket.promo
    || bucket.other
    || bucket.prepaid
    || bucket.leaseFee
    || bucket.loanFee
  );
}

function buildPayslipFromLines(weekLines, meta = {}) {
  const list = Array.isArray(weekLines) ? weekLines : [];
  const platforms = {
    coupang: emptyDirectBucket(),
    baemin: emptyDirectBucket()
  };

  list.forEach(line => {
    const split = splitLineIntoPlatforms(line);
    addBuckets(platforms.coupang, split.coupang);
    addBuckets(platforms.baemin, split.baemin);
  });

  platforms.coupang = finalizeBucket(platforms.coupang);
  platforms.baemin = finalizeBucket(platforms.baemin);

  const totals = emptyDirectBucket();
  addBuckets(totals, platforms.coupang);
  addBuckets(totals, platforms.baemin);
  const finalized = finalizeBucket(totals);

  const first = list[0] || null;
  const { raw, payslip } = first ? readRawPayslip(first) : { raw: {}, payslip: {} };
  const source = meta.source
    || (first && isDirectPayslipLine(first) ? 'direct' : 'bro');

  return {
    ...bucketToLegacyPayslip(finalized, {
      riderName: String(payslip.riderName || first?.rider_name || meta.riderName || '').trim(),
      coupangId: String(payslip.coupangId || raw.matchedCoupangId || meta.coupangId || '').trim(),
      baeminId: String(payslip.baeminId || raw.matchedBaeminId || meta.baeminId || '').trim(),
      settlementWeekStart: meta.settlementWeekStart || '',
      settlementWeekEnd: meta.settlementWeekEnd || '',
      settlementWeekLabel: meta.settlementWeekLabel
        || String(raw.settlementWeekLabel || '').trim()
    }),
    platforms: {
      coupang: platforms.coupang,
      baemin: platforms.baemin
    },
    source
  };
}

/**
 * 같은 주에 직계약+브로가 같이 있는 기사:
 * - 직계약 줄 → 그 플랫폼(쿠팡/배민)에만
 * - 브로가 both/미지정이면, 직계약이 이미 채운 플랫폼의 "반대쪽"에 브로 전액을 넣는다
 *   (예: 직계약=쿠팡, 브로=배민 근무 → 쿠팡탭=직계약, 배민탭=브로)
 * - 브로가 쿠팡/배민으로 명시돼 있으면 그대로 그 플랫폼에
 */
function buildPayslipFromMixedSources(weekLines, meta = {}) {
  const list = Array.isArray(weekLines) ? weekLines : [];
  const directLines = list.filter(isDirectPayslipLine);
  const broLines = list.filter(line => !isDirectPayslipLine(line));

  // 한쪽만 있으면 기존 로직 그대로
  if (!directLines.length || !broLines.length) {
    return buildPayslipFromLines(list, meta);
  }

  const platforms = {
    coupang: emptyDirectBucket(),
    baemin: emptyDirectBucket()
  };

  directLines.forEach(line => {
    const split = splitLineIntoPlatforms(line);
    addBuckets(platforms.coupang, split.coupang);
    addBuckets(platforms.baemin, split.baemin);
  });

  const directCoversCoupang = bucketHasActivity(finalizeBucket({ ...platforms.coupang }));
  const directCoversBaemin = bucketHasActivity(finalizeBucket({ ...platforms.baemin }));

  broLines.forEach(line => {
    const platform = resolveLinePlatform(line);
    const full = lineToDirectBucket(line);

    if (platform === 'coupang' || platform === 'baemin') {
      addBuckets(platforms[platform], full);
      return;
    }

    // both / 미지정
    if (directCoversCoupang && !directCoversBaemin) {
      addBuckets(platforms.baemin, full);
    } else if (directCoversBaemin && !directCoversCoupang) {
      addBuckets(platforms.coupang, full);
    } else {
      const split = splitLineIntoPlatforms(line);
      addBuckets(platforms.coupang, split.coupang);
      addBuckets(platforms.baemin, split.baemin);
    }
  });

  platforms.coupang = finalizeBucket(platforms.coupang);
  platforms.baemin = finalizeBucket(platforms.baemin);

  const totals = emptyDirectBucket();
  addBuckets(totals, platforms.coupang);
  addBuckets(totals, platforms.baemin);
  const finalized = finalizeBucket(totals);

  // 메타: 쿠팡ID는 직계약 우선, 배민ID는 브로 우선
  const directFirst = directLines[0];
  const broFirst = broLines[0];
  const directRaw = directFirst ? readRawPayslip(directFirst) : { raw: {}, payslip: {} };
  const broRaw = broFirst ? readRawPayslip(broFirst) : { raw: {}, payslip: {} };

  return {
    ...bucketToLegacyPayslip(finalized, {
      riderName: String(
        broRaw.payslip.riderName
        || directRaw.payslip.riderName
        || broFirst?.rider_name
        || directFirst?.rider_name
        || meta.riderName
        || ''
      ).trim(),
      coupangId: String(
        directRaw.payslip.coupangId
        || directRaw.raw.coupangId
        || broRaw.payslip.coupangId
        || broRaw.raw.matchedCoupangId
        || meta.coupangId
        || ''
      ).trim(),
      baeminId: String(
        broRaw.payslip.baeminId
        || broRaw.raw.matchedBaeminId
        || directRaw.payslip.baeminId
        || meta.baeminId
        || ''
      ).trim(),
      settlementWeekStart: meta.settlementWeekStart || '',
      settlementWeekEnd: meta.settlementWeekEnd || '',
      settlementWeekLabel: meta.settlementWeekLabel || ''
    }),
    platforms: {
      coupang: platforms.coupang,
      baemin: platforms.baemin
    },
    source: 'mixed'
  };
}

function contractMatchesRider(contractRow, rider) {
  const raw = contractRow?.raw_data && typeof contractRow.raw_data === 'object'
    ? contractRow.raw_data
    : {};
  if (raw.driverId && String(raw.driverId) === String(rider.id)) return true;
  const nameMatch = normalizeName(raw.driverName) && normalizeName(raw.driverName) === normalizeName(rider.name);
  const phoneMatch = normalizePhone(raw.driverPhone) && normalizePhone(raw.driverPhone) === normalizePhone(rider.phone);
  return nameMatch && phoneMatch;
}

/** 기사앱 리스차감(일) = 계약/렌탈 일렌탈료. 차량 리스비(daily_cost 등)는 절대 쓰지 않음. */
function resolveContractDailyRent(contractRow) {
  if (!contractRow) return 0;
  const raw = contractRow.raw_data && typeof contractRow.raw_data === 'object'
    ? contractRow.raw_data
    : {};
  // daily_charge = 계약 저장 시 일렌탈료 컬럼(원가와 무관). raw 구값보다 우선.
  const daily = Math.max(0, Math.round(Number(
    contractRow.daily_charge
    || raw.dailyRent
    || 0
  )));
  if (daily > 0) return daily;
  const weekly = Math.max(0, Math.round(Number(raw.weeklyRent || 0)));
  return weekly > 0 ? Math.round(weekly / 7) : 0;
}

function pickBestRiderContract(rows) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (!list.length) return null;
  const scored = list.map((row, index) => {
    const daily = resolveContractDailyRent(row);
    const status = String(row.status || '').toLowerCase();
    const activeBoost = status === 'ended' ? 0 : 100;
    return { row, score: activeBoost + (daily > 0 ? 10 : 0) - index * 0.001 };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].row;
}

/** 해당 기사 계약을 DB에서 직접 찾음 (200건 잘라서 누락되던 문제 수정). 차량 테이블은 조회하지 않음. */
async function loadContractsForRider(supabase, rider) {
  const riderId = String(rider?.id || '').trim();
  const selectCols = 'id,contract_type,status,daily_charge,raw_data,start_date,end_date,updated_at';
  const matches = [];

  if (riderId) {
    const byId = await supabase
      .from('lease_contracts')
      .select(selectCols)
      .eq('raw_data->>driverId', riderId)
      .order('updated_at', { ascending: false })
      .limit(100);
    if (!byId.error && byId.data?.length) {
      matches.push(...byId.data);
    }
  }

  if (!matches.length) {
    // 종료 제외 전체에서 이름·연락처 매칭 (차량 원가 테이블 미사용)
    const broad = await supabase
      .from('lease_contracts')
      .select(selectCols)
      .neq('status', 'ended')
      .order('updated_at', { ascending: false })
      .limit(5000);
    if (!broad.error) {
      (broad.data || []).forEach(row => {
        if (contractMatchesRider(row, rider)) matches.push(row);
      });
    }
  }

  // 활성 상태 우선, 없으면 ended 포함 재조회
  const active = matches.filter(row => {
    const status = String(row.status || '').toLowerCase();
    return status !== 'ended';
  });
  if (active.length) return active;

  if (riderId && !matches.length) {
    const anyStatus = await supabase
      .from('lease_contracts')
      .select(selectCols)
      .eq('raw_data->>driverId', riderId)
      .order('updated_at', { ascending: false })
      .limit(100);
    if (!anyStatus.error && anyStatus.data?.length) return anyStatus.data;
  }
  return matches;
}

async function healContractDailyRentRaw(supabase, contract, dailyRent) {
  if (!supabase || !contract?.id || dailyRent <= 0) return;
  const raw = { ...(contract.raw_data && typeof contract.raw_data === 'object' ? contract.raw_data : {}) };
  const rawDaily = Math.max(0, Math.round(Number(raw.dailyRent || 0)));
  const colDaily = Math.max(0, Math.round(Number(contract.daily_charge || 0)));
  if (rawDaily === dailyRent && colDaily === dailyRent) return;
  raw.dailyRent = dailyRent;
  raw.weeklyRent = Math.max(0, Math.round(Number(raw.weeklyRent || 0))) || dailyRent * 7;
  try {
    await supabase
      .from('lease_contracts')
      .update({
        daily_charge: dailyRent,
        raw_data: raw,
        updated_at: new Date().toISOString()
      })
      .eq('id', contract.id);
  } catch (_error) {
    /* 기사앱 노출이 우선 — heal 실패는 무시 */
  }
}

function loanItemMatchesRider(item, rider) {
  if (!item || !rider) return false;
  if (item.driverId && String(item.driverId) === String(rider.id)) return true;
  const nameMatch = normalizeName(item.driverName) && normalizeName(item.driverName) === normalizeName(rider.name);
  const phoneMatch = normalizePhone(item.driverPhone) && normalizePhone(item.driverPhone) === normalizePhone(rider.phone);
  return Boolean(nameMatch && phoneMatch);
}

function parseSettingsList(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

/**
 * 기사 주급명세서 상단용 리스/대여/미납 요약.
 * - dailyRent / dailyLoanDeduct: 하루 차감액 (헤더 표기)
 * - unpaidAmount: 미납/회수 잔액 (등록된 것만)
 * - leaseFee: 하위 호환(예전 오버레이). 주급 공제표는 발행 명세서 버킷이 기준.
 */
async function findRiderLeaseInfo(supabase, rider) {
  const empty = {
    ok: true,
    hasLease: false,
    isRental: false,
    contractType: '',
    dailyRent: 0,
    dailyLoanDeduct: 0,
    leaseFee: 0,
    weeklyRent: 0,
    unpaidAmount: 0,
    unpaidReason: '',
    vehicleNumber: '',
    finalApplyEnabled: false,
    contractId: ''
  };

  const [riderContracts, loansRes] = await Promise.all([
    loadContractsForRider(supabase, rider),
    supabase
      .from('settings')
      .select('value')
      .eq('key', 'brem_lease_loans_v1')
      .maybeSingle()
  ]);

  const contract = pickBestRiderContract(riderContracts);
  let dailyRent = 0;
  let weeklyRent = 0;
  let finalApplyEnabled = false;
  let vehicleNumber = '';
  let contractId = '';
  let contractType = '';
  let hasLease = false;
  let isRental = false;

  if (contract) {
    const raw = contract.raw_data || {};
    finalApplyEnabled = Boolean(raw.finalApplyEnabled);
    dailyRent = resolveContractDailyRent(contract);
    weeklyRent = Math.max(0, Math.round(Number(raw.weeklyRent || dailyRent * 7 || 0)));
    vehicleNumber = String(raw.vehicleNumber || '').trim();
    contractId = contract.id ? String(contract.id) : '';
    contractType = String(contract.contract_type || raw.contractType || 'lease');
    hasLease = contractType === 'lease';
    isRental = contractType === 'rental';
    // 기사앱 노출용 raw 보정 (차량 원가는 절대 수정하지 않음)
    if (dailyRent > 0) {
      void healContractDailyRentRaw(supabase, contract, dailyRent);
    }
  }

  // 대여(대출) 일차감액 — 활성(미완납) 건의 dailyDeduct 합산 (헤더 안내용)
  let dailyLoanDeduct = 0;
  const loans = parseSettingsList(loansRes?.data?.value);
  loans.forEach(item => {
    if (!loanItemMatchesRider(item, rider)) return;
    if (String(item.status || '') === 'paid' || String(item.status || '') === 'deleted') return;
    const balance = Math.max(0, Math.round(Number(
      item.balance != null ? item.balance : (Number(item.principal || 0) + Number(item.interest || 0))
    )));
    if (balance <= 0) return;
    dailyLoanDeduct += Math.max(0, Math.round(Number(item.dailyDeduct || 0)));
  });

  let unpaidAmount = 0;
  const unpaidReasons = [];
  const COMPLETED = new Set(['completed', 'recovered', 'done', 'paid', 'closed']);
  const { data: arrears } = await supabase
    .from('lease_arrears')
    .select('unpaid_amount,raw_data,collection_status,contract_id')
    .order('updated_at', { ascending: false })
    .limit(200);

  (arrears || []).forEach(row => {
    const rowRaw = row.raw_data || {};
    const sameDriver = String(rowRaw.driverId || '') === String(rider.id)
      || (
        normalizeName(rowRaw.driverName) === normalizeName(rider.name)
        && normalizePhone(rowRaw.driverPhone) === normalizePhone(rider.phone)
        && normalizeName(rowRaw.driverName)
      );
    const sameContract = contractId && String(row.contract_id || '') === contractId;
    if (!sameDriver && !sameContract) return;
    const status = String(row.collection_status || rowRaw.collectionStatus || '').toLowerCase();
    if (COMPLETED.has(status)) return;
    const remaining = Math.max(0, Number(row.unpaid_amount ?? rowRaw.unpaidAmount ?? 0));
    if (remaining <= 0) return;
    unpaidAmount += remaining;
    const reason = String(rowRaw.arrearReason || rowRaw.reason || '').trim()
      || (rowRaw.source === 'weekly-auto' ? '주정산 리스비 미납' : '리스비 미납');
    unpaidReasons.push(reason);
  });

  if (!contract && dailyLoanDeduct <= 0 && unpaidAmount <= 0) {
    return empty;
  }

  return {
    ok: true,
    hasLease,
    isRental,
    contractType,
    dailyRent,
    dailyLoanDeduct,
    // 하위 호환: 예전 클라이언트 오버레이용(주간 추정). 신규 헤더는 dailyRent 사용.
    leaseFee: finalApplyEnabled ? dailyRent : 0,
    weeklyRent,
    unpaidAmount,
    unpaidReason: [...new Set(unpaidReasons)].join(', '),
    vehicleNumber,
    finalApplyEnabled,
    contractId
  };
}

async function getRiderWeeklyPayslip(accessToken, weekStartInput) {
  const me = await getRiderMe(accessToken);
  if (!me.ok) return me;

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const requestedRaw = String(weekStartInput || '').trim();
  const hasRequestedWeek = /\d{4}-\d{2}-\d{2}/.test(requestedRaw);

  const [linesResult, noticesResult, leaseInfo] = await Promise.all([
    supabase
      .from('payroll_slip_lines')
      .select('*')
      .eq('driver_id', me.riderId)
      .not('rider_published_at', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(80),
    supabase
      .from('payroll_notices')
      .select('id,title,body,label,settlement_week_start,sort_order,rider_published_at,updated_at')
      .not('rider_published_at', 'is', null)
      .order('sort_order', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(30),
    findRiderLeaseInfo(supabase, me.rider)
  ]);

  const { data: lines, error } = linesResult;

  if (error) {
    if (/does not exist|relation|schema cache/i.test(error.message || '')) {
      return { ok: false, status: 400, error: '급여명세서 테이블이 준비되지 않았습니다.' };
    }
    return { ok: false, status: 500, error: error.message || '주급명세서를 불러오지 못했습니다.' };
  }

  let settlementWeekStart;
  if (hasRequestedWeek) {
    settlementWeekStart = normalizeSettlementWeekStart(requestedRaw);
  } else {
    let latestWeek = '';
    for (const row of (lines || [])) {
      const raw = row.raw_data || {};
      const wk = String(raw.settlementWeekStart || raw.settlementWeekPayKey || '').slice(0, 10);
      if (wk) {
        latestWeek = normalizeSettlementWeekStart(wk);
        break;
      }
    }
    settlementWeekStart = latestWeek || normalizeSettlementWeekStart('');
  }
  const settlementWeekEndDate = settlementWeekEnd(settlementWeekStart);
  const paymentDate = await resolvePaymentDate(supabase, settlementWeekStart, settlementWeekEndDate);

  // 같은 주에 쿠팡·배민 줄이 각각 있으면 모두 합친다. (예전엔 첫 줄만 써서 한쪽이 빠졌다)
  // 주차 문자열은 normalize 후 비교(화요일 off-by-one 저장분 포함).
  const weekLines = (lines || []).filter(row => {
    const raw = row.raw_data || {};
    const week = String(raw.settlementWeekStart || raw.settlementWeekPayKey || '').slice(0, 10);
    if (!week) return false;
    return week === settlementWeekStart || normalizeSettlementWeekStart(week) === settlementWeekStart;
  });

  let notices = [];
  if (!noticesResult.error) {
    notices = (noticesResult.data || [])
      .filter(row => {
        const scoped = String(row.settlement_week_start || '').slice(0, 10);
        return !scoped || scoped === settlementWeekStart;
      })
      .map(row => ({
        id: row.id,
        title: String(row.title || '').trim(),
        body: String(row.body || '').trim(),
        label: String(row.label || 'notice').trim(),
        settlementWeekStart: String(row.settlement_week_start || '').slice(0, 10),
        publishedAt: row.rider_published_at || row.updated_at || null
      }));
  }

  if (!leaseInfo.ok) {
    return { ok: false, status: 500, error: leaseInfo.error };
  }

  const loginId = `${String(me.rider?.name || '').replace(/\s/g, '')}${normalizePhone(me.rider?.phone).slice(-4)}`;
  const riderMeta = {
    id: me.riderId,
    name: me.rider?.name || '',
    phone: me.rider?.phone || '',
    coupangId: loginId,
    baeminId: String(me.rider?.baemin_id || me.rider?.baeminId || '').trim()
  };

  const weekMeta = {
    riderName: riderMeta.name,
    coupangId: riderMeta.coupangId,
    baeminId: riderMeta.baeminId,
    settlementWeekStart,
    settlementWeekEnd: settlementWeekEndDate,
    settlementWeekLabel: `${settlementWeekStart}(수) ~ ${settlementWeekEndDate}(화)`
  };
  // 직계약·브로가 같은 주에 있어도 합쳐 버리지 않고,
  // 쿠팡/배민 탭에 각각 맞게 넣는다 (직계약 쿠팡 + 브로 배민 등).
  const payslip = weekLines.length
    ? buildPayslipFromMixedSources(weekLines, weekMeta)
    : null;

  return {
    ok: true,
    riderId: me.riderId,
    settlementWeekStart,
    settlementWeekEnd: settlementWeekEndDate,
    paymentDate,
    settlementWeekLabel: payslip?.settlementWeekLabel
      || `${settlementWeekStart}(수) ~ ${settlementWeekEndDate}(화)`,
    hasPayslip: Boolean(payslip),
    payslip,
    rider: riderMeta,
    lease: {
      hasLease: leaseInfo.hasLease || leaseInfo.isRental,
      contractType: leaseInfo.contractType,
      leaseLabel: leaseInfo.hasLease ? '리스' : (leaseInfo.isRental ? '렌탈' : '없음'),
      dailyRent: leaseInfo.dailyRent || 0,
      dailyLoanDeduct: leaseInfo.dailyLoanDeduct || 0,
      leaseFee: leaseInfo.leaseFee,
      weeklyRent: leaseInfo.weeklyRent,
      unpaidAmount: leaseInfo.unpaidAmount,
      unpaidReason: leaseInfo.unpaidReason || '',
      vehicleNumber: leaseInfo.vehicleNumber || '',
      finalApplyEnabled: Boolean(leaseInfo.finalApplyEnabled)
    },
    notices
  };
}

module.exports = {
  getRiderWeeklyPayslip,
  normalizeSettlementWeekStart,
  settlementWeekEnd,
  defaultPaymentDateForWeekEnd,
  buildPayslipFromLines,
  buildPayslipFromMixedSources,
  lineToDirectBucket,
  splitLineIntoPlatforms,
  resolveLinePlatform,
  detectBranchPlatform
};
