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
      // 브램_울산_중구중앙_2026_06-4 → 중구중앙 (연도 바로 앞 위치명)
      result.region = parts.length >= 4 ? String(parts[parts.length - 3] || '').trim() : '';
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

  function normalizePeriodDay(period) {
    return String(period || '').slice(0, 10);
  }

  function pickLatestSettlementRecord(records = []) {
    if (!records.length) return null;
    return records.slice().sort((a, b) => (
      String(b.appliedAt || '').localeCompare(String(a.appliedAt || ''))
      || String(b.id || '').localeCompare(String(a.id || ''))
    ))[0];
  }

  function buildDriverCallStatsForPeriod(driverId, startDate, endDate, platform) {
    const p = normalizePlatform(platform);
    const start = String(startDate || '').slice(0, 10);
    const end = String(endDate || '').slice(0, 10);
    const byDay = {};

    BremStorage.settlements.getAll().forEach(record => {
      if (record.driverId !== driverId) return;
      if (normalizePlatform(record.platform) !== p) return;
      const day = normalizePeriodDay(record.period);
      if (start && day < start) return;
      if (end && day > end) return;
      const next = {
        callCount: Number(record.orderCount || 0),
        deliveryAmount: Number(record.deliveryAmount ?? record.settlementAmount ?? 0),
        source: 'settlement',
        appliedAt: String(record.appliedAt || ''),
        recordId: String(record.id || '')
      };
      const prev = byDay[day];
      if (!prev || next.appliedAt >= String(prev.appliedAt || '')) {
        byDay[day] = next;
      }
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

  function nameMatchesDriverRecord(record, driver, platform) {
    if (!driver) return false;
    if (record?.driverId && record.driverId === driver.id) return true;
    const driverName = normalizeName(driver.name, platform);
    const candidates = [
      record?.driverName,
      record?.rawName,
      record?.name,
      record?.riderName,
      record?.originalName
    ]
      .map(value => normalizeName(value, platform))
      .filter(Boolean);
    return candidates.some(name => name === driverName || name.includes(driverName) || driverName.includes(name));
  }

  function findDailyUploadHints(day, platform, driver) {
    const p = normalizePlatform(platform);
    const hints = [];
    const logs = (BremStorage.settlementUploadLogs?.getAll?.() || []).filter(log => (
      log.kind === 'daily'
      && normalizePlatform(log.platform) === p
      && String(log.period || log.startDate || '').slice(0, 10) === day
    ));

    if (!logs.length) {
      hints.push('해당 날짜 일정산 업로드 기록 없음');
      return hints;
    }

    logs.forEach(log => {
      const fileLabel = log.fileName || '파일명 없음';
      const inApplied = (log.appliedRecords || []).some(row => row.driverId === driver?.id);
      const inMatched = (log.matchedRecords || []).some(row => row.driverId === driver?.id);
      const unmatchedRow = (log.unmatchedRecords || []).find(row => nameMatchesDriverRecord(row, driver, p));

      if (inApplied || inMatched) {
        const row = [...(log.appliedRecords || []), ...(log.matchedRecords || [])]
          .find(item => item.driverId === driver?.id);
        hints.push(`업로드 반영 · ${fileLabel}${row ? ` · ${row.orderCount}건` : ''}`);
      } else if (unmatchedRow) {
        hints.push(`업로드 미매칭 · ${fileLabel} · 엑셀 ${unmatchedRow.orderCount}건`);
      } else if (log.status === 'applied') {
        hints.push(`업로드됐으나 이 기사 없음 · ${fileLabel}`);
      } else {
        hints.push(`업로드 기록 · ${fileLabel} (${log.status || '상태 미상'})`);
      }
    });

    return [...new Set(hints)];
  }

  function buildCallCountExcessInsights(audit = {}) {
    const insights = [];
    const delta = audit.delta;
    if (delta === null || delta <= 0) return insights;

    const platform = normalizePlatform(audit.platform);
    const dayAudits = audit.dayAudits || [];
    const weekly = audit.weeklyOrderCount;
    const system = audit.systemCallCount;

    if (platform === 'baemin') {
      insights.push(
        '배민 일정산: U열(가게도착)·V열·AH열 중 하나라도 빈칸/0이면 해당 행 전체 무효(콜 0건)입니다. 주간서 D열과 다르면 해당 날짜 일정산을 삭제→재업로드→반영하세요.'
      );
      if (system > (weekly || 0)) {
        insights.push(
          '표시된 시스템 콜수는 DB에 저장된 업로드 결과입니다. U·V·AH 무효 규칙 적용 전에 반영된 건수가 남아 있을 수 있습니다.'
        );
      }
    }

    const duplicateDays = dayAudits.filter(day => (day.settlements || []).length > 1);
    duplicateDays.forEach(day => {
      const used = (day.settlements || []).find(row => row.id === day.usedSettlementId);
      const skipped = (day.settlements || []).filter(row => row.id !== day.usedSettlementId);
      const skippedCounts = skipped.map(row => Number(row.orderCount || 0));
      if (used && skippedCounts.some(count => count !== Number(used.orderCount || 0))) {
        insights.push(
          `${day.label}: 같은 날 일정산 ${day.settlements.length}건 — 반영 ${used.orderCount}건(최신), 미반영 ${skippedCounts.join('/')}건`
        );
      }
    });

    const daysWithData = dayAudits.filter(day => day.usedCount > 0);
    const missingDays = dayAudits.filter(day => day.status === 'missing');
    if (missingDays.length && weekly !== null && system > weekly) {
      insights.push(
        `누락 ${missingDays.length}일(${missingDays.map(day => day.label).join(', ')})이 있어도 업로드된 날만 합쳐 ${system}건 → 주간서(${weekly})보다 ${delta}건 많음. 누락 때문이 아닙니다.`
      );
    }

    if (delta === 1) {
      insights.push(
        '검수: ① 아래 일별 반영 콜수 합 확인 ② 콜수 많은 날 일정산 엑셀에서 U·V·AH 모두 유효한 행 수 직접 세기 ③ 중복 업로드·조정/환불 행 1건 있는지 확인'
      );
      const topDays = daysWithData
        .slice()
        .sort((a, b) => Number(b.usedCount || 0) - Number(a.usedCount || 0))
        .slice(0, 3);
      if (topDays.length) {
        insights.push(`우선 확인: ${topDays.map(day => `${day.label} ${day.usedCount}건`).join(', ')}`);
      }
    }

    return insights;
  }

  function buildDriverCallAudit(driverId, startDate, endDate, platform, weeklyOrderCount = null) {
    const p = normalizePlatform(platform);
    const start = String(startDate || '').slice(0, 10);
    const end = String(endDate || '').slice(0, 10);
    const driver = BremStorage.drivers.getById(driverId);
    const stats = buildDriverCallStatsForPeriod(driverId, start, end, p);
    const days = listDaysInclusive(start, end);

    const settlementsByDay = {};
    BremStorage.settlements.getAll().forEach(record => {
      if (record.driverId !== driverId) return;
      if (normalizePlatform(record.platform) !== p) return;
      const day = normalizePeriodDay(record.period);
      if (start && day < start) return;
      if (end && day > end) return;
      if (!settlementsByDay[day]) settlementsByDay[day] = [];
      settlementsByDay[day].push({
        id: record.id,
        orderCount: Number(record.orderCount || 0),
        settlementAmount: Number(record.settlementAmount ?? record.deliveryAmount ?? 0),
        appliedAt: record.appliedAt || record.createdAt || ''
      });
    });

    const callsByDay = {};
    BremStorage.calls.getAll().forEach(call => {
      if (call.driverId !== driverId) return;
      if (normalizePlatform(call.platform) !== p) return;
      const day = String(call.date).slice(0, 10);
      if (start && day < start) return;
      if (end && day > end) return;
      if (!callsByDay[day]) callsByDay[day] = [];
      callsByDay[day].push({
        id: call.id,
        count: Number(call.count || 0),
        date: day
      });
    });

    let runningSum = 0;
    const dayAudits = days.map(day => {
      const settlements = settlementsByDay[day] || [];
      const calls = callsByDay[day] || [];
      const usedSettlement = pickLatestSettlementRecord(settlements);
      const usedEntry = stats.byDay[day] || null;
      const uploadHints = findDailyUploadHints(day, p, driver);
      let status = 'missing';
      if (settlements.length > 1) status = 'duplicate_settlement';
      else if (settlements.length === 1) status = 'settlement';
      else if (calls.length > 0) status = 'call_only';
      else if (usedEntry) status = usedEntry.source || 'unknown';

      const settlementSum = settlements.reduce((sum, row) => sum + Number(row.orderCount || 0), 0);
      const callSum = calls.reduce((sum, row) => sum + Number(row.count || 0), 0);
      const usedCount = Number(usedEntry?.callCount || 0);
      runningSum += usedCount;

      return {
        date: day,
        label: day.slice(5),
        status,
        usedCount,
        cumulativeSum: runningSum,
        source: usedEntry?.source || 'none',
        usedSettlementId: usedSettlement?.id || '',
        settlements,
        calls,
        settlementSum,
        callSum,
        uploadHints
      };
    });

    const weekly = weeklyOrderCount === null || weeklyOrderCount === undefined
      ? null
      : Number(weeklyOrderCount || 0);
    const systemCallCount = Number(stats.callCount || 0);
    const delta = weekly === null ? null : systemCallCount - weekly;
    const daysWithData = dayAudits.filter(day => day.usedCount > 0);
    const sumWithData = daysWithData.reduce((sum, day) => sum + day.usedCount, 0);
    const missingDays = dayAudits.filter(day => day.status === 'missing');
    const duplicateDays = dayAudits.filter(day => day.settlements.length > 1);

    const insights = [];
    if (weekly !== null && weekly === systemCallCount && weekly > 0) {
      insights.push('주간서 콜수와 시스템 합계가 같습니다. (일정산 합이 주간서와 일치)');
    } else if (weekly !== null && weekly !== systemCallCount) {
      insights.push(`주간정산서 ${weekly}건 vs 일정산 합계 ${systemCallCount}건 — ${systemCallCount > weekly ? '일정산이 1건 이상 많음' : '주간서가 1건 이상 많음'}`);
    }
    if (delta !== null && delta !== 0) {
      insights.push(delta > 0
        ? `시스템 합계가 주간서보다 ${delta}건 많습니다.`
        : `시스템 합계가 주간서보다 ${Math.abs(delta)}건 적습니다.`);
    }
    if (missingDays.length) {
      insights.push(`일정산/콜입력 없는 날 ${missingDays.length}일: ${missingDays.map(day => day.label).join(', ')}`);
    }
    if (duplicateDays.length) {
      insights.push(`같은 날 일정산 중복 ${duplicateDays.length}일 (마지막 1건만 합산): ${duplicateDays.map(day => day.label).join(', ')}`);
    }
    if (weekly !== null && sumWithData > weekly) {
      insights.push(`데이터 있는 ${daysWithData.length}일 합(${sumWithData})만으로도 주간서(${weekly})보다 ${sumWithData - weekly}건 많습니다.`);
    }
    duplicateDays.forEach(day => {
      const used = day.usedCount;
      if (day.settlementSum !== used) {
        insights.push(`${day.label}: 일정산 ${day.settlements.length}건 합 ${day.settlementSum}건 · 반영 ${used}건`);
      }
    });
    insights.push(...buildCallCountExcessInsights({
      platform: p,
      delta,
      weeklyOrderCount: weekly,
      systemCallCount,
      dayAudits
    }));

    return {
      driverId,
      driverName: driver?.name || '',
      platform: p,
      startDate: start,
      endDate: end,
      weeklyOrderCount: weekly,
      systemCallCount,
      delta,
      dayAudits,
      insights,
      stats
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

  function refreshWeeklySettlementRiders(record) {
    if (!record) return record;
    const platform = normalizePlatform(record.platform);
    const period = resolveWeeklyComparePeriod(record);
    const riders = (record.riders || []).map(rider => (
      rider?.matchedRiderId
        ? refreshRiderCallMatch(rider, {
          platform,
          startDate: period.startDate,
          endDate: period.endDate
        })
        : rider
    ));
    const matchedRiders = riders.filter(rider => rider.matched !== false && rider.matchedRiderId);
    return {
      ...record,
      riders,
      summary: {
        ...(record.summary || {}),
        totalExtracted: riders.length,
        matchedRiders: matchedRiders.length,
        unmatchedRiders: riders.length - matchedRiders.length,
        callCountMismatches: matchedRiders.filter(rider => rider.callCountMatched === false).length
      }
    };
  }

  function saveWeeklySettlement(record) {
    const refreshed = refreshWeeklySettlementRiders(record);
    return BremStorage.weeklySettlements.save(refreshed);
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

  async function clearDriverPeriodCallData(driverId, startDate, endDate, platform) {
    const id = String(driverId || '').trim();
    const p = normalizePlatform(platform);
    const start = String(startDate || '').slice(0, 10);
    const end = String(endDate || '').slice(0, 10);
    const days = new Set(listDaysInclusive(start, end));

    const settlementIds = BremStorage.settlements.getAll()
      .filter(item => item.driverId === id
        && normalizePlatform(item.platform) === p
        && days.has(normalizePeriodDay(item.period)))
      .map(item => item.id);

    for (const settlementId of settlementIds) {
      await BremStorage.settlements.removeByIdAsync(settlementId);
    }

    const callIds = BremStorage.calls.getAll()
      .filter(item => item.driverId === id
        && normalizePlatform(item.platform) === p
        && days.has(String(item.date).slice(0, 10)))
      .map(item => item.id);

    for (const callId of callIds) {
      await BremStorage.calls.removeByIdAsync(callId);
    }
  }

  async function applyWeeklySettlementCallCount({
    driverId,
    startDate,
    endDate,
    platform,
    weeklyOrderCount
  } = {}) {
    const id = String(driverId || '').trim();
    const p = normalizePlatform(platform);
    const start = String(startDate || '').slice(0, 10);
    const end = String(endDate || '').slice(0, 10);
    const target = Number(weeklyOrderCount || 0);

    if (!id) throw new Error('매칭된 기사가 없습니다.');
    if (!start || !end) throw new Error('정산 기간이 없습니다.');
    if (target < 0) throw new Error('주간정산서 콜수가 올바르지 않습니다.');

    const beforeAudit = buildDriverCallAudit(id, start, end, p, target);
    const current = Number(beforeAudit.systemCallCount || 0);
    if (target === current) {
      return {
        ok: true,
        applied: false,
        weeklyOrderCount: target,
        systemCallCount: current,
        updates: []
      };
    }

    await clearDriverPeriodCallData(id, start, end, p);

    const writeResult = BremStorage.calls.upsertDaily({
      driverId: id,
      date: end,
      count: target,
      platform: p,
      logEdit: true
    });
    await BremStorage.awaitPersist?.(writeResult);
    await BremStorage.flushStorage?.();

    const afterAudit = buildDriverCallAudit(id, start, end, p, target);
    return {
      ok: true,
      applied: true,
      weeklyOrderCount: target,
      systemCallCount: Number(afterAudit.systemCallCount || 0),
      updates: [{ date: end, count: target, source: 'call' }]
    };
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
    buildDriverCallAudit,
    applyWeeklySettlementCallCount,
    matchSettlementRidersWithExistingData,
    buildWeeklySummary,
    buildMatchedNamesLabel,
    buildWeeklySettlementRecord,
    refreshWeeklySettlementRiders,
    saveWeeklySettlement,
    loadWeeklySettlements,
    deleteWeeklySettlement,
    saveManualNameMapping,
    loadManualNameMappings,
    resolveBaeminDriver,
    processWeeklyUpload
  };
})();
