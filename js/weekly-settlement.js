const BremWeeklySettlement = (function () {
  const BAEMIN_SHEET_KEYWORD = '을지_협력사 소속 라이더 정산 확인용';

  function normalizePlatform(platform) {
    return BremPlatforms.normalize(platform);
  }

  function dateKey(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function addDays(dateValue, days) {
    const date = new Date(`${String(dateValue).slice(0, 10)}T00:00:00`);
    date.setDate(date.getDate() + Number(days || 0));
    return dateKey(date);
  }

  function slugify(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^\w가-힣_-]+/g, '')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '') || 'unknown';
  }

  function calculateCoupangSettlementDates(baseSettlementDate) {
    const base = String(baseSettlementDate || '').slice(0, 10);
    if (!base) {
      return { baseSettlementDate: '', startDate: '', endDate: '', paymentDate: '' };
    }
    return {
      baseSettlementDate: base,
      startDate: base,
      endDate: addDays(base, 6),
      paymentDate: addDays(base, 9)
    };
  }

  function listDaysInclusive(startDate, endDate) {
    const start = String(startDate || '').slice(0, 10);
    const end = String(endDate || '').slice(0, 10);
    if (!start || !end || start > end) return [];
    const days = [];
    let cursor = start;
    while (cursor <= end) {
      days.push(cursor);
      cursor = addDays(cursor, 1);
    }
    return days;
  }

  function buildCallCountMismatchDetail(stats, startDate, endDate) {
    const byDay = stats?.byDay || {};
    const days = listDaysInclusive(startDate, endDate);
    if (!days.length) return '';

    const missingDays = [];
    const dayParts = [];
    days.forEach(day => {
      const entry = byDay[day];
      const label = day.slice(5);
      if (!entry) {
        missingDays.push(label);
        dayParts.push(`${label}:0`);
      } else {
        dayParts.push(`${label}:${entry.callCount}`);
      }
    });

    const parts = [`일별 ${dayParts.join(' · ')}`];
    if (missingDays.length) {
      parts.unshift(`누락 ${missingDays.length}일 (${missingDays.join(', ')})`);
    }
    return parts.join(' · ');
  }

  function parseCoupangFileName(fileName) {
    const baseName = String(fileName || '').replace(/\.(xlsx|xls)$/i, '');
    const parts = baseName.split('_').filter(Boolean);
    const result = { branch: '', region: '', year: '', month: '', week: '', settlementWeekLabel: '' };
    if (parts.length < 2) return result;

    const weekPart = parts[parts.length - 1] || '';
    const yearPart = parts[parts.length - 2] || '';
    if (/^\d{4}$/.test(yearPart)) {
      result.year = yearPart;
      const weekMatch = weekPart.match(/^(\d{1,2})-(\d+)$/);
      if (weekMatch) {
        result.month = weekMatch[1].padStart(2, '0');
        result.week = weekMatch[2];
      }
      result.branch = parts[0] || '';
      result.region = parts.slice(1, -2).join(' ').trim();
      if (result.year && result.month && result.week) {
        result.settlementWeekLabel = `${result.year}년 ${Number(result.month)}월 ${result.week}주차`;
      }
    }
    return result;
  }

  function parseBaeminFileName(fileName) {
    const baseName = String(fileName || '').replace(/\.(xlsx|xls)$/i, '');
    const result = { startDate: '', endDate: '', teamName: '' };
    const strict = baseName.match(/^(\d{4})(\d{2})(\d{2})_(\d{4})(\d{2})(\d{2})_(.+?)_정산서$/);
    if (strict) {
      result.startDate = `${strict[1]}-${strict[2]}-${strict[3]}`;
      result.endDate = `${strict[4]}-${strict[5]}-${strict[6]}`;
      result.teamName = strict[7];
      return result;
    }
    const parts = baseName.split('_').filter(Boolean);
    if (parts.length >= 3 && /^\d{8}$/.test(parts[0]) && /^\d{8}$/.test(parts[1])) {
      result.startDate = `${parts[0].slice(0, 4)}-${parts[0].slice(4, 6)}-${parts[0].slice(6, 8)}`;
      result.endDate = `${parts[1].slice(0, 4)}-${parts[1].slice(4, 6)}-${parts[1].slice(6, 8)}`;
      result.teamName = parts.slice(2).join('_').replace(/_?정산서$/i, '');
    }
    return result;
  }

  function normalizeCoupangName(rawName) {
    return String(rawName || '').trim().replace(/[0-9]+$/, '').trim();
  }

  function normalizeBaeminName(rawName) {
    return String(rawName || '').trim().replace(/\s+/g, '');
  }

  function normalizeBaeminUserId(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    if (/^\d+(\.0+)?$/.test(raw)) return String(Math.round(Number(raw)));
    return raw;
  }

  function normalizeName(rawName, platform) {
    return normalizePlatform(platform) === 'baemin'
      ? normalizeBaeminName(rawName)
      : normalizeCoupangName(rawName);
  }

  function columnIndex(column) {
    return SettlementFormats.columnToIndex(column);
  }

  function readCell(row, column) {
    const index = columnIndex(column);
    if (index < 0) return '';
    return row[index];
  }

  function cellText(value) {
    return BremSettlementParser.cellText(value);
  }

  async function readWeeklyRows(file, password, options = {}) {
    const arrayBuffer = await file.arrayBuffer();
    return BremSettlementParser.openWorkbookSheetRows(
      new Uint8Array(arrayBuffer),
      BremSettlementParser.normalizePassword(password),
      options
    );
  }

  function normalizeCoupangLoginKey(rawName) {
    return String(rawName || '').trim().replace(/\s+/g, '');
  }

  function makeCoupangLoginKeyForDriver(driver) {
    const name = String(driver?.name || '').replace(/\s/g, '');
    const phone = String(driver?.phone || '').replace(/[^0-9]/g, '').slice(-4);
    return `${name}${phone}`;
  }

  function pushUniqueRider(list, seen, key, rider) {
    if (!key || seen.has(key)) return;
    seen.add(key);
    list.push(rider);
  }

  function buildDriversInPeriod(startDate, endDate, platform) {
    const p = normalizePlatform(platform);
    const start = String(startDate || '').slice(0, 10);
    const end = String(endDate || '').slice(0, 10);
    const driverIds = new Set();

    BremStorage.settlements.getAll().forEach(record => {
      if (normalizePlatform(record.platform) !== p) return;
      const day = String(record.period).slice(0, 10);
      if (start && day < start) return;
      if (end && day > end) return;
      if (record.driverId) driverIds.add(record.driverId);
    });

    BremStorage.calls.getAll().forEach(call => {
      if (normalizePlatform(call.platform) !== p) return;
      const day = String(call.date).slice(0, 10);
      if (start && day < start) return;
      if (end && day > end) return;
      if (call.driverId) driverIds.add(call.driverId);
    });

    return driverIds;
  }

  function buildDriverCallStatsForPeriod(driverId, startDate, endDate, platform) {
    const p = normalizePlatform(platform);
    const start = String(startDate || '').slice(0, 10);
    const end = String(endDate || '').slice(0, 10);
    const byDay = {};

    BremStorage.settlements.getAll().forEach(record => {
      if (record.driverId !== driverId) return;
      if (normalizePlatform(record.platform) !== p) return;
      const day = String(record.period).slice(0, 10);
      if (start && day < start) return;
      if (end && day > end) return;
      byDay[day] = {
        callCount: Number(record.orderCount || 0),
        deliveryAmount: Number(record.deliveryAmount ?? record.settlementAmount ?? 0),
        source: 'settlement'
      };
    });

    BremStorage.calls.getAll().forEach(call => {
      if (call.driverId !== driverId) return;
      if (normalizePlatform(call.platform) !== p) return;
      const day = String(call.date).slice(0, 10);
      if (start && day < start) return;
      if (end && day > end) return;
      if (byDay[day]) return;
      byDay[day] = {
        callCount: Number(call.count || 0),
        deliveryAmount: 0,
        source: 'call'
      };
    });

    let callCount = 0;
    let deliveryAmount = 0;
    Object.values(byDay).forEach(day => {
      callCount += Number(day.callCount || 0);
      deliveryAmount += Number(day.deliveryAmount || 0);
    });

    return {
      callCount,
      deliveryAmount,
      byDay,
      uploadDays: Object.keys(byDay).length,
      hasData: Object.keys(byDay).length > 0
    };
  }

  async function extractCoupangWeeklyRiders(file, password, columnConfig = {}) {
    const nameColumn = columnConfig.nameColumn || 'C';
    const orderCountColumn = columnConfig.orderCountColumn || 'F';
    const startRow = Number(columnConfig.startRow || 12);
    const rows = await readWeeklyRows(file, password, { sheetIndex: 0 });
    const riders = [];
    const seen = new Set();
    const startIndex = Math.max(0, startRow - 1);

    for (let i = startIndex; i < rows.length; i += 1) {
      const rawName = cellText(readCell(rows[i] || [], nameColumn));
      if (!rawName) continue;
      const orderRaw = readCell(rows[i] || [], orderCountColumn);
      const weeklyOrderCount = Number(String(orderRaw ?? '').replace(/[^\d.-]/g, '')) || 0;
      const loginKey = normalizeCoupangLoginKey(rawName);
      pushUniqueRider(riders, seen, loginKey, {
        originalName: rawName,
        riderName: normalizeCoupangName(rawName),
        coupangLoginKey: loginKey,
        weeklyOrderCount
      });
    }

    if (!riders.length) {
      throw new Error('쿠팡 정산서에서 기사명을 읽지 못했습니다. 기사명 열/시작행을 확인하세요.');
    }
    return riders;
  }

  async function extractBaeminWeeklyRiders(file, password, columnConfig = {}) {
    const userIdColumn = columnConfig.userIdColumn || 'B';
    const nameColumn = columnConfig.nameColumn || 'C';
    const orderCountColumn = columnConfig.orderCountColumn || 'D';
    const startRow = Number(columnConfig.startRow || 2);
    const rows = await readWeeklyRows(file, password, {
      sheetMatcher: name => name.includes(BAEMIN_SHEET_KEYWORD)
    });
    const riders = [];
    const seen = new Set();
    const startIndex = Math.max(0, startRow - 1);

    for (let i = startIndex; i < rows.length; i += 1) {
      const rawName = cellText(readCell(rows[i] || [], nameColumn));
      const baeminUserId = cellText(readCell(rows[i] || [], userIdColumn));
      const normalizedUserId = normalizeBaeminUserId(baeminUserId);
      if (!normalizedUserId) continue;
      const orderRaw = readCell(rows[i] || [], orderCountColumn);
      const weeklyOrderCount = Number(String(orderRaw ?? '').replace(/[^\d.-]/g, '')) || 0;
      pushUniqueRider(riders, seen, normalizedUserId, {
        originalName: rawName,
        riderName: normalizeBaeminName(rawName),
        baeminUserId: normalizedUserId,
        weeklyOrderCount
      });
    }

    if (!riders.length) {
      throw new Error(`배민 정산서 "${BAEMIN_SHEET_KEYWORD}" 시트에서 User ID(B열)를 읽지 못했습니다.`);
    }
    return riders;
  }

  function findBaeminSettlementSheetName(sheetNames = []) {
    return sheetNames.find(name => name.includes(BAEMIN_SHEET_KEYWORD)) || '';
  }

  function findBaeminSettlementSheet(workbookOrNames) {
    if (Array.isArray(workbookOrNames)) return findBaeminSettlementSheetName(workbookOrNames);
    return findBaeminSettlementSheetName(workbookOrNames?.SheetNames || []);
  }

  function loadManualNameMappings() {
    return BremStorage.manualNameMappings.getAll();
  }

  function saveManualNameMapping(mapping) {
    return BremStorage.manualNameMappings.save(mapping);
  }

  function resolveDriverByManualMapping(originalName, riderName, platform, baeminUserId) {
    const p = normalizePlatform(platform);
    const mappings = loadManualNameMappings().filter(item => normalizePlatform(item.platform) === p);
    const manual = mappings.find(item => {
      const source = normalizeName(item.originalName, p);
      if (p === 'baemin') {
        const userId = normalizeBaeminUserId(baeminUserId);
        if (userId && normalizeBaeminUserId(item.originalName) === userId) return true;
      }
      return source === normalizeName(originalName, p) || source === normalizeName(riderName, p);
    });

    if (manual?.driverId) {
      return BremStorage.drivers.getById(manual.driverId) || null;
    }
    return null;
  }

  function resolveCoupangDriver(rider) {
    const manual = resolveDriverByManualMapping(rider.originalName, rider.riderName, 'coupang');
    if (manual) return manual;

    const loginKey = rider.coupangLoginKey || normalizeCoupangLoginKey(rider.originalName);
    if (loginKey) {
      const byLogin = BremStorage.drivers.getAll().find(driver => makeCoupangLoginKeyForDriver(driver) === loginKey);
      if (byLogin) return byLogin;
    }

    const normalizedTarget = normalizeCoupangName(rider.riderName || rider.originalName);
    return BremStorage.drivers.getAll().find(driver => normalizeCoupangName(driver.name) === normalizedTarget) || null;
  }

  function resolveBaeminDriver(rider) {
    const manual = resolveDriverByManualMapping(rider.originalName, rider.riderName, 'baemin', rider.baeminUserId);
    if (manual) return manual;

    const userId = normalizeBaeminUserId(rider.baeminUserId);
    if (!userId) return null;

    return BremStorage.drivers.getAll().find(
      driver => normalizeBaeminUserId(driver.baeminId) === userId
    ) || null;
  }

  function resolveDriverByWeeklyRider(rider, platform) {
    return normalizePlatform(platform) === 'baemin'
      ? resolveBaeminDriver(rider)
      : resolveCoupangDriver(rider);
  }

  function findDriverInPeriodByWeeklyRider(rider, platform, driverIdsInPeriod) {
    const p = normalizePlatform(platform);

    if (p === 'baemin') {
      const userId = normalizeBaeminUserId(rider.baeminUserId);
      if (!userId) return null;
      for (const driverId of driverIdsInPeriod) {
        const driver = BremStorage.drivers.getById(driverId);
        if (driver && normalizeBaeminUserId(driver.baeminId) === userId) return driver;
      }
      return null;
    }

    const loginKey = rider.coupangLoginKey || normalizeCoupangLoginKey(rider.originalName);
    if (loginKey) {
      for (const driverId of driverIdsInPeriod) {
        const driver = BremStorage.drivers.getById(driverId);
        if (driver && makeCoupangLoginKeyForDriver(driver) === loginKey) return driver;
      }
    }
    const normalizedTarget = normalizeCoupangName(rider.riderName || rider.originalName);
    for (const driverId of driverIdsInPeriod) {
      const driver = BremStorage.drivers.getById(driverId);
      if (driver && normalizeCoupangName(driver.name) === normalizedTarget) return driver;
    }
    return null;
  }

  function resolveDriverFromPeriodData(rider, platform, driverIdsInPeriod) {
    const p = normalizePlatform(platform);
    if (p === 'baemin') {
      return resolveBaeminDriver(rider);
    }

    const inPeriod = findDriverInPeriodByWeeklyRider(rider, platform, driverIdsInPeriod);
    if (inPeriod) return inPeriod;

    const resolved = resolveDriverByWeeklyRider(rider, platform);
    if (resolved && driverIdsInPeriod.has(resolved.id)) return resolved;

    return resolved || null;
  }

  function unmatchedReasonForRider(platform, driver, hasSystemData, rider) {
    const p = normalizePlatform(platform);
    if (p === 'baemin') {
      if (!normalizeBaeminUserId(rider?.baeminUserId)) return 'User ID 없음';
      if (!driver) return '배민 User ID 미매칭 (기사 관리 배민 ID 확인)';
      if (!hasSystemData) return '시스템 콜수/정산표 데이터 없음';
      return '미매칭';
    }
    if (driver && !hasSystemData) return '시스템 콜수/정산표 데이터 없음';
    return '쿠팡 ID(이름+연락처)/기사명 미매칭';
  }

  function evaluateCallCountMatch(rider, stats, startDate = '', endDate = '') {
    const weeklyOrderCount = Number(rider.weeklyOrderCount ?? 0);
    const systemCallCount = Number(stats.callCount || 0);
    const warnings = [];

    if (!stats.hasData) {
      warnings.push('시스템 콜수/정산표 데이터 없음');
      const detail = buildCallCountMismatchDetail(stats, startDate, endDate);
      if (detail) warnings.push(detail);
      return { weeklyOrderCount, systemCallCount, callCountMatched: false, warnings, callStatsByDay: stats.byDay || {} };
    }

    if (weeklyOrderCount > 0 && weeklyOrderCount !== systemCallCount) {
      warnings.push(`콜수 불일치 (주간서 ${weeklyOrderCount} / 시스템 ${systemCallCount})`);
      const detail = buildCallCountMismatchDetail(stats, startDate, endDate);
      if (detail) warnings.push(detail);
      return {
        weeklyOrderCount,
        systemCallCount,
        callCountMatched: false,
        warnings,
        callStatsByDay: stats.byDay || {}
      };
    }

    return {
      weeklyOrderCount,
      systemCallCount,
      callCountMatched: true,
      warnings,
      callStatsByDay: stats.byDay || {}
    };
  }

  function refreshRiderCallMatch(rider, { platform, startDate, endDate } = {}) {
    const driverId = rider?.matchedRiderId || '';
    if (!driverId) return rider;

    const stats = buildDriverCallStatsForPeriod(driverId, startDate, endDate, platform);
    const callMatch = evaluateCallCountMatch(rider, stats, startDate, endDate);
    return {
      ...rider,
      systemCallCount: callMatch.systemCallCount,
      callCountMatched: callMatch.callCountMatched,
      callStatsByDay: callMatch.callStatsByDay,
      warnings: callMatch.warnings
    };
  }

  function resolveWeeklyComparePeriod(record = {}) {
    const platform = normalizePlatform(record.platform);
    const startDate = String(record.startDate || record.baseSettlementDate || '').slice(0, 10);
    if (platform === 'coupang' && startDate) {
      const dates = calculateCoupangSettlementDates(record.baseSettlementDate || startDate);
      return { startDate: dates.startDate, endDate: dates.endDate };
    }
    return {
      startDate,
      endDate: String(record.endDate || '').slice(0, 10)
    };
  }

  function matchSettlementRidersWithExistingData(riders, platform, options = {}) {
    const p = normalizePlatform(platform);
    const startDate = options.startDate || '';
    const endDate = options.endDate || '';
    const driverIdsInPeriod = buildDriversInPeriod(startDate, endDate, p);

    return riders.map(rider => {
      const driver = resolveDriverFromPeriodData(rider, p, driverIdsInPeriod);
      const hasSystemData = Boolean(driver && driverIdsInPeriod.has(driver.id));
      const stats = driver && hasSystemData
        ? buildDriverCallStatsForPeriod(driver.id, startDate, endDate, p)
        : { callCount: 0, hasData: false };

      const callMatch = evaluateCallCountMatch(rider, stats, startDate, endDate);
      const matched = p === 'baemin'
        ? Boolean(driver && normalizeBaeminUserId(rider.baeminUserId))
        : hasSystemData && Boolean(driver);

      const warnings = matched ? [...callMatch.warnings] : [];
      if (matched && !hasSystemData) {
        warnings.push('시스템 콜수/정산표 데이터 없음');
      }

      return {
        originalName: rider.originalName,
        riderName: rider.riderName,
        coupangLoginKey: rider.coupangLoginKey || '',
        baeminUserId: rider.baeminUserId || '',
        driverName: driver?.name || '',
        matchedRiderId: driver?.id || '',
        matched,
        weeklyOrderCount: callMatch.weeklyOrderCount,
        systemCallCount: callMatch.systemCallCount,
        callCountMatched: matched && hasSystemData ? callMatch.callCountMatched : false,
        callStatsByDay: callMatch.callStatsByDay || {},
        warnings: matched ? warnings : [unmatchedReasonForRider(p, driver, hasSystemData, rider)]
      };
    });
  }

  function buildWeeklySummary(matchedRiders = [], unmatchedRiders = []) {
    const callCountMismatches = matchedRiders.filter(item => item.callCountMatched === false).length;
    return {
      totalExtracted: matchedRiders.length + unmatchedRiders.length,
      matchedRiders: matchedRiders.length,
      unmatchedRiders: unmatchedRiders.length,
      callCountMismatches
    };
  }

  function buildMatchedNamesLabel(matchedRiders = []) {
    return matchedRiders.map(item => item.driverName || item.riderName).filter(Boolean).join(', ');
  }

  function buildWeeklySettlementId({ platform, region, year, month, week, startDate }) {
    const p = normalizePlatform(platform);
    const regionSlug = slugify(region);
    if (year && month && week) return `weekly_${p}_${regionSlug}_${year}_${month}_${week}`;
    return `weekly_${p}_${regionSlug}_${String(startDate || '').replace(/-/g, '')}`;
  }

  function buildWeeklySettlementRecord(payload) {
    const platform = normalizePlatform(payload.platform);
    const matchedRiders = payload.matchedRiders || [];
    const parsedMeta = platform === 'coupang'
      ? parseCoupangFileName(payload.fileName || '')
      : parseBaeminFileName(payload.fileName || '');

    const dates = platform === 'coupang'
      ? calculateCoupangSettlementDates(payload.baseSettlementDate)
      : {
        baseSettlementDate: payload.baseSettlementDate || payload.startDate || parsedMeta.startDate || '',
        startDate: payload.startDate || parsedMeta.startDate || '',
        endDate: payload.endDate || parsedMeta.endDate || '',
        paymentDate: payload.paymentDate || calculateCoupangSettlementDates(payload.startDate || parsedMeta.startDate).paymentDate
      };

    const region = payload.region || parsedMeta.region || parsedMeta.teamName || '';

    return {
      id: payload.id || buildWeeklySettlementId({
        platform,
        region,
        year: parsedMeta.year,
        month: parsedMeta.month,
        week: parsedMeta.week,
        startDate: dates.startDate
      }),
      platform,
      region,
      fileName: payload.fileName || '',
      baseSettlementDate: dates.baseSettlementDate,
      startDate: dates.startDate,
      endDate: dates.endDate,
      paymentDate: dates.paymentDate,
      settlementWeekLabel: payload.settlementWeekLabel
        || parsedMeta.settlementWeekLabel
        || (dates.startDate && dates.endDate ? `${dates.startDate} ~ ${dates.endDate}` : ''),
      uploadedAt: payload.uploadedAt || new Date().toISOString(),
      matchedNamesLabel: buildMatchedNamesLabel(matchedRiders),
      riders: matchedRiders,
      summary: buildWeeklySummary(matchedRiders, payload.unmatchedRiders || [])
    };
  }

  function saveWeeklySettlement(record) {
    return BremStorage.weeklySettlements.save(record);
  }

  function loadWeeklySettlements(filter = {}) {
    let list = BremStorage.weeklySettlements.getAll();
    if (filter.platform) {
      list = list.filter(item => normalizePlatform(item.platform) === normalizePlatform(filter.platform));
    }
    if (filter.region) list = list.filter(item => item.region === filter.region);
    return list;
  }

  function deleteWeeklySettlement(id) {
    return BremStorage.weeklySettlements.remove(id);
  }

  async function processWeeklyUpload(options) {
    const platform = normalizePlatform(options.platform);
    const file = options.file;
    if (!file) throw new Error('정산서 파일을 선택하세요.');

    const columnConfig = options.columnConfig || {};
    const extracted = platform === 'coupang'
      ? await extractCoupangWeeklyRiders(file, options.password, columnConfig)
      : await extractBaeminWeeklyRiders(file, options.password, columnConfig);

    const allMatched = matchSettlementRidersWithExistingData(extracted, platform, {
      startDate: options.startDate,
      endDate: options.endDate
    });
    const matchedRiders = allMatched.filter(item => item.matched);
    const unmatchedRiders = allMatched.filter(item => !item.matched);

    const record = buildWeeklySettlementRecord({
      platform,
      region: options.region,
      fileName: file.name,
      baseSettlementDate: options.baseSettlementDate,
      startDate: options.startDate,
      endDate: options.endDate,
      paymentDate: options.paymentDate,
      settlementWeekLabel: options.settlementWeekLabel,
      matchedRiders,
      unmatchedRiders
    });

    return { ...record, previewUnmatched: unmatchedRiders };
  }

  return {
    BAEMIN_SHEET_KEYWORD,
    calculateCoupangSettlementDates,
    listDaysInclusive,
    buildCallCountMismatchDetail,
    refreshRiderCallMatch,
    resolveWeeklyComparePeriod,
    parseCoupangFileName,
    parseBaeminFileName,
    normalizeCoupangName,
    normalizeBaeminName,
    normalizeBaeminUserId,
    normalizeName,
    findBaeminSettlementSheetName,
    findBaeminSettlementSheet,
    extractCoupangWeeklyRiders,
    extractBaeminWeeklyRiders,
    buildDriversInPeriod,
    buildDriverCallStatsForPeriod,
    matchSettlementRidersWithExistingData,
    buildWeeklySummary,
    buildMatchedNamesLabel,
    buildWeeklySettlementRecord,
    saveWeeklySettlement,
    loadWeeklySettlements,
    deleteWeeklySettlement,
    saveManualNameMapping,
    loadManualNameMappings,
    resolveBaeminDriver,
    processWeeklyUpload
  };
})();
