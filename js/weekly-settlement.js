const BremWeeklySettlement = (function () {
  const BAEMIN_SHEET_KEYWORD = '을지_협력사 소속 라이더 정산 확인용';
  // 배민 정산서는 라이더 정산 시트가 항상 두 번째다.
  // 시트명은 파일마다 달라질 수 있어 이름보다 위치를 먼저 본다.
  const BAEMIN_SHEET_INDEX = 1;

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

  function yymmddToIso(yy, mm, dd) {
    const y = Number(yy);
    const m = Number(mm);
    const d = Number(dd);
    if (![y, m, d].every(Number.isFinite) || m < 1 || m > 12 || d < 1 || d > 31) return '';
    const year = y < 100 ? 2000 + y : y;
    return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  /** 수~화 주차 시작(수요일). 화요일 시작 off-by-one 은 다음날 수로 보정. */
  function baeminWeekStartKey(dateValue) {
    const raw = String(dateValue || '').slice(0, 10);
    if (!raw) return '';
    if (typeof window !== 'undefined' && window.BremDatePicker?.applyWeekWednesday) {
      return window.BremDatePicker.applyWeekWednesday(raw);
    }
    if (typeof window !== 'undefined' && window.BremDatePicker?.weekStartKey) {
      return window.BremDatePicker.weekStartKey(raw);
    }
    const date = new Date(`${raw}T00:00:00`);
    if (Number.isNaN(date.getTime())) return '';
    const day = date.getDay();
    if (day === 2) {
      date.setDate(date.getDate() + 1);
      return dateKey(date);
    }
    const diff = (day - 3 + 7) % 7;
    date.setDate(date.getDate() - diff);
    return dateKey(date);
  }

  function parseBaeminFileName(fileName) {
    const baseName = String(fileName || '').replace(/\.(xlsx|xls)$/i, '').trim();
    const result = { startDate: '', endDate: '', teamName: '' };
    const strict = baseName.match(/^(\d{4})(\d{2})(\d{2})_(\d{4})(\d{2})(\d{2})_(.+?)_정산서$/);
    if (strict) {
      result.startDate = `${strict[1]}-${strict[2]}-${strict[3]}`;
      result.endDate = `${strict[4]}-${strict[5]}-${strict[6]}`;
      result.teamName = String(strict[7] || '').trim();
      return result;
    }
    // 260729-260731 울산울주a  /  260729-260731_울산울주a  /  붙임상 지역명
    const compact = baseName.match(
      /^(\d{2})(\d{2})(\d{2})\s*[-–—_~]\s*(\d{2})(\d{2})(\d{2})(?:[\s_\-–—]*(.+))?$/
    );
    if (compact) {
      result.startDate = yymmddToIso(compact[1], compact[2], compact[3]);
      result.endDate = yymmddToIso(compact[4], compact[5], compact[6]);
      result.teamName = String(compact[7] || '').replace(/_?정산서$/i, '').trim();
      return result;
    }
    // 20260729-20260804 울산울주a
    const fullDash = baseName.match(
      /^(\d{4})(\d{2})(\d{2})\s*[-–—_~]\s*(\d{4})(\d{2})(\d{2})(?:[\s_\-–—]*(.+))?$/
    );
    if (fullDash) {
      result.startDate = `${fullDash[1]}-${fullDash[2]}-${fullDash[3]}`;
      result.endDate = `${fullDash[4]}-${fullDash[5]}-${fullDash[6]}`;
      result.teamName = String(fullDash[7] || '').replace(/_?정산서$/i, '').trim();
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

  function sumAmountMaps(a = {}, b = {}) {
    const out = { ...(a && typeof a === 'object' ? a : {}) };
    Object.entries(b && typeof b === 'object' ? b : {}).forEach(([key, value]) => {
      const left = Number(out[key] || 0);
      const right = Number(value || 0);
      out[key] = Math.round((Number.isFinite(left) ? left : 0) + (Number.isFinite(right) ? right : 0));
    });
    return out;
  }

  /** 배민ID 기준 기사 목록 합치기 — 콜수·amounts 전 항목 합산 */
  function mergeBaeminRiders(riderLists = []) {
    const byKey = new Map();
    (Array.isArray(riderLists) ? riderLists : []).forEach(list => {
      (Array.isArray(list) ? list : []).forEach(rider => {
        if (!rider) return;
        const key = baeminIdMatchKey(rider.baeminUserId)
          || String(rider.baeminUserId || '').trim()
          || baeminIdMatchKey(rider.matchedRiderId)
          || '';
        if (!key) return;
        if (!byKey.has(key)) {
          byKey.set(key, {
            ...rider,
            weeklyOrderCount: Math.round(Number(rider.weeklyOrderCount || 0)),
            amounts: rider.amounts && typeof rider.amounts === 'object'
              ? { ...rider.amounts }
              : undefined
          });
          return;
        }
        const existing = byKey.get(key);
        existing.weeklyOrderCount = Math.round(
          Number(existing.weeklyOrderCount || 0) + Number(rider.weeklyOrderCount || 0)
        );
        if (rider.amounts || existing.amounts) {
          existing.amounts = sumAmountMaps(existing.amounts, rider.amounts);
        }
        if (!existing.riderName && rider.riderName) existing.riderName = rider.riderName;
        if (!existing.originalName && rider.originalName) existing.originalName = rider.originalName;
        if (!existing.driverName && rider.driverName) existing.driverName = rider.driverName;
        if (
          String(rider.baeminUserId || '').startsWith('0')
          && !String(existing.baeminUserId || '').startsWith('0')
        ) {
          existing.baeminUserId = rider.baeminUserId;
        } else if (!existing.baeminUserId && rider.baeminUserId) {
          existing.baeminUserId = rider.baeminUserId;
        }
        if (!existing.matchedRiderId && rider.matchedRiderId) {
          existing.matchedRiderId = rider.matchedRiderId;
          existing.matched = true;
          if (rider.driverName) existing.driverName = rider.driverName;
        }
      });
    });
    return [...byKey.values()];
  }

  function listBaeminSourceParts(record) {
    if (Array.isArray(record?.sourceParts) && record.sourceParts.length) {
      return record.sourceParts.map(part => ({
        fileName: String(part.fileName || '').trim(),
        startDate: String(part.startDate || '').slice(0, 10),
        endDate: String(part.endDate || '').slice(0, 10),
        riders: Array.isArray(part.riders) ? part.riders : []
      })).filter(part => part.fileName);
    }
    const fileName = String(record?.fileName || '').trim();
    if (!fileName || fileName.includes(' + ')) {
      const names = fileName.split(/\s*\+\s*/).map(s => s.trim()).filter(Boolean);
      if (names.length > 1) {
        // 예전 합쳐진 라벨만 있고 part 없으면 통짜 riders 를 첫 파일에만 귀속
        return [{
          fileName: names[0],
          startDate: String(record?.startDate || '').slice(0, 10),
          endDate: String(record?.endDate || '').slice(0, 10),
          riders: Array.isArray(record?.riders) ? record.riders : []
        }];
      }
    }
    if (!fileName) return [];
    return [{
      fileName,
      startDate: String(record?.startDate || '').slice(0, 10),
      endDate: String(record?.endDate || '').slice(0, 10),
      riders: Array.isArray(record?.riders) ? record.riders : []
    }];
  }

  /**
   * 월말 쪼개진 배민 주정산 part 를 같은 지역·수~화 주에 upsert 후 기사별 합산.
   * 같은 fileName 재업로드면 그 part 만 교체(이중 합산 방지).
   */
  function upsertBaeminWeeklyParts(existing, incoming) {
    const base = existing && typeof existing === 'object' ? existing : null;
    const parts = listBaeminSourceParts(base);
    const incomingName = String(incoming?.fileName || '').trim();
    const incomingPart = {
      fileName: incomingName,
      startDate: String(incoming?.startDate || '').slice(0, 10),
      endDate: String(incoming?.endDate || '').slice(0, 10),
      riders: Array.isArray(incoming?.riders) ? incoming.riders : []
    };
    if (incomingName) {
      const idx = parts.findIndex(part => part.fileName === incomingName);
      if (idx >= 0) parts[idx] = incomingPart;
      else parts.push(incomingPart);
    }
    // 한 번에 여러 파일(incoming.sourceParts)도 반영
    (Array.isArray(incoming?.sourceParts) ? incoming.sourceParts : []).forEach(part => {
      const name = String(part?.fileName || '').trim();
      if (!name) return;
      const next = {
        fileName: name,
        startDate: String(part.startDate || '').slice(0, 10),
        endDate: String(part.endDate || '').slice(0, 10),
        riders: Array.isArray(part.riders) ? part.riders : []
      };
      const idx = parts.findIndex(item => item.fileName === name);
      if (idx >= 0) parts[idx] = next;
      else parts.push(next);
    });

    const startDate = parts.map(p => p.startDate).filter(Boolean).sort()[0]
      || String(incoming?.startDate || base?.startDate || '').slice(0, 10);
    const endDate = parts.map(p => p.endDate).filter(Boolean).sort().pop()
      || String(incoming?.endDate || base?.endDate || '').slice(0, 10);
    const fileNames = parts.map(p => p.fileName).filter(Boolean);
    const riders = mergeBaeminRiders(parts.map(p => p.riders));
    const region = String(incoming?.region || base?.region || '').trim();
    const channel = (incoming?.channel === 'direct' || base?.channel === 'direct') ? 'direct' : 'bro';
    const weekStart = baeminWeekStartKey(startDate);
    const id = incoming?.id || base?.id || buildWeeklySettlementId({
      platform: 'baemin',
      region,
      startDate: weekStart || startDate,
      channel
    });
    return {
      ...(base || {}),
      ...(incoming || {}),
      id,
      platform: 'baemin',
      channel,
      region,
      startDate,
      endDate,
      baseSettlementDate: startDate,
      settlementWeekLabel: startDate && endDate ? `${startDate} ~ ${endDate}` : (incoming?.settlementWeekLabel || base?.settlementWeekLabel || ''),
      fileName: fileNames.join(' + '),
      fileNames,
      sourceParts: parts,
      riders,
      matchedNamesLabel: buildMatchedNamesLabel(riders.filter(r => r.matched || r.matchedRiderId)),
      summary: buildWeeklySummary(
        riders.filter(r => r.matched || r.matchedRiderId),
        riders.filter(r => !r.matched && !r.matchedRiderId)
      )
    };
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
    // 엑셀이 숫자로 인식해 붙인 소수점 .0 만 제거하고, 앞자리 0 은 보존한다.
    // (예전엔 Number() 변환으로 "0123456" → "123456" 으로 앞 0 이 사라졌다)
    const m = raw.match(/^(\d+)\.0+$/);
    return m ? m[1] : raw;
  }

  // 매칭 비교용 키: 앞자리 0 유무·대소문자 차이를 무시해 과거 데이터와도 맞춘다.
  function baeminIdMatchKey(value) {
    const v = normalizeBaeminUserId(value).replace(/\s+/g, '');
    if (!v) return '';
    return /^\d+$/.test(v) ? (v.replace(/^0+/, '') || '0') : v.toLowerCase();
  }

  // 엑셀에서 앞 0 이 빠진 ID 와 기사 등록 ID(010…)가 같으면 등록 ID 를 쓴다.
  function preferRegisteredBaeminId(excelOrStoredId, driverOrRegisteredId) {
    const excel = normalizeBaeminUserId(excelOrStoredId);
    const registered = normalizeBaeminUserId(
      typeof driverOrRegisteredId === 'object'
        ? (driverOrRegisteredId?.baeminId || driverOrRegisteredId?.raw_data?.baeminId || '')
        : driverOrRegisteredId
    );
    if (!registered) return excel;
    if (!excel) return registered;
    if (baeminIdMatchKey(excel) === baeminIdMatchKey(registered)) return registered;
    return excel;
  }

  function parseAmount(value) {
    const num = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
    return Number.isFinite(num) ? num : 0;
  }

  // 직계약 배민 정산서 금액/공제 열 기본값 (사용자 지정: E/F/G, 공제 H/L/N/Y)
  const DIRECT_BAEMIN_AMOUNT_COLUMNS = Object.freeze({
    deliveryFee: 'E',           // 배달료
    missionPay: 'F',            // 추가지급(배민미션)
    totalDeliveryPay: 'G',      // 총배달료 지급계액 (프로모션·기타지급은 추후 합산)
    hourlyInsurance: 'H',       // 시간제보험(공제)
    employmentInsurance: 'L',   // 고용보험(공제)
    accidentInsurance: 'N',     // 산재보험(공제)
    withholdingTax: 'Y'         // 원천세(공제)
  });

  // 직계약 쿠팡 정산서 금액/공제 열 기본값.
  // AM 은 시트상 배달료이지만 AB(차감내역)가 이미 빠진 금액이다.
  // 그래서 표기·지급용 배달료 = AM + AB. 공제에서 AB를 다시 빼면 순지급이 AM 기준으로 맞는다.
  // 일정산서(brem-standard) 정산금액 열(AL)과는 다르다.
  // 공제: AB 차감내역 · AE 고용 · AG 산재 · AH 시간제는 정산서 수치 그대로.
  // 원천세만 정산서에 없어 AC × 3.3% 로 계산한다. 추가지급(미션) 항목은 없다.
  const DIRECT_COUPANG_AMOUNT_COLUMNS = Object.freeze({
    deliveryFee: 'AM',          // 시트 배달료(AB 차감 후) — 저장 시 AM+AB 로 보정
    deductionDetail: 'AB',      // 차감내역(공제)
    deductionBase: 'AC',        // 원천세 기준 금액
    employmentInsurance: 'AE',  // 고용보험(공제)
    accidentInsurance: 'AG',    // 산재보험(공제)
    hourlyInsurance: 'AH'       // 시간제보험(공제)
  });

  const COUPANG_WITHHOLDING_RATE = 0.033;

  function extractCoupangAmounts(row, amountColumns) {
    if (!amountColumns) return null;
    const cols = { ...DIRECT_COUPANG_AMOUNT_COLUMNS, ...amountColumns };
    const amDeliveryFee = parseAmount(readCell(row, cols.deliveryFee));
    // 차감내역·고용·산재·시간제는 정산서에 음수로 올 수 있어 절대값으로 맞춘다.
    // (부호를 그대로 두면 공제합계가 줄어 총지급액이 부푼다.)
    const deductionDetail = Math.abs(parseAmount(readCell(row, cols.deductionDetail)));
    // AM 은 AB가 이미 빠진 값이므로 표기 배달료는 AM+AB.
    const deliveryFee = amDeliveryFee + deductionDetail;
    // AC가 비어 있으면 시트 AM(원본)으로 대체 — 세금 기준은 시트 값을 우선.
    const deductionBase = Math.abs(parseAmount(readCell(row, cols.deductionBase)))
      || Math.abs(amDeliveryFee);
    return {
      deliveryFee,
      deliveryFeeAm: amDeliveryFee,
      deductionDetail,
      deductionBase,
      // 원천세만 우리가 AC×3.3% 로 계산한다. 나머지는 정산서 수치 그대로.
      withholdingTax: Math.floor(deductionBase * COUPANG_WITHHOLDING_RATE),
      employmentInsurance: Math.abs(parseAmount(readCell(row, cols.employmentInsurance))),
      accidentInsurance: Math.abs(parseAmount(readCell(row, cols.accidentInsurance))),
      hourlyInsurance: Math.abs(parseAmount(readCell(row, cols.hourlyInsurance)))
    };
  }

  function extractBaeminAmounts(row, amountColumns) {
    if (!amountColumns) return null;
    const cols = { ...DIRECT_BAEMIN_AMOUNT_COLUMNS, ...amountColumns };
    return {
      deliveryFee: parseAmount(readCell(row, cols.deliveryFee)),
      missionPay: parseAmount(readCell(row, cols.missionPay)),
      totalDeliveryPay: parseAmount(readCell(row, cols.totalDeliveryPay)),
      // 공제는 정산서에 음수로 적혀 오는 경우가 있어 절대값으로 맞춘다.
      // 부호를 그대로 두면 공제합계가 줄어 총지급액이 부풀어 오른다.
      hourlyInsurance: Math.abs(parseAmount(readCell(row, cols.hourlyInsurance))),
      employmentInsurance: Math.abs(parseAmount(readCell(row, cols.employmentInsurance))),
      accidentInsurance: Math.abs(parseAmount(readCell(row, cols.accidentInsurance))),
      withholdingTax: Math.abs(parseAmount(readCell(row, cols.withholdingTax)))
    };
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
    if (!key) return;
    if (seen.has(key)) {
      // 같은 매칭키면 앞자리 0 이 있는 ID 를 우선 보존
      const existing = list.find(item => (
        baeminIdMatchKey(item.baeminUserId) === key
        || baeminIdMatchKey(item.coupangLoginKey || item.originalName) === key
        || normalizeCoupangLoginKey(item.coupangLoginKey || item.originalName) === key
      ));
      if (
        existing
        && String(rider.baeminUserId || '').startsWith('0')
        && !String(existing.baeminUserId || '').startsWith('0')
      ) {
        existing.baeminUserId = rider.baeminUserId;
      }
      return;
    }
    seen.add(key);
    list.push(rider);
  }

  /**
   * 배민 한 파일 안 중복(같은 User ID / 같은 이름) → 콜수·amounts 합산.
   * User ID 가 있으면 ID 우선, 없으면 정규화 이름으로 합친다.
   */
  function pushOrSumBaeminRider(list, byKey, rider) {
    const idKey = baeminIdMatchKey(rider.baeminUserId);
    const nameKey = normalizeBaeminName(rider.riderName || rider.originalName);
    const key = idKey ? `id:${idKey}` : (nameKey ? `name:${nameKey}` : '');
    if (!key) return;
    if (!byKey.has(key)) {
      const row = {
        ...rider,
        weeklyOrderCount: Math.round(Number(rider.weeklyOrderCount || 0)),
        amounts: rider.amounts && typeof rider.amounts === 'object' ? { ...rider.amounts } : undefined
      };
      byKey.set(key, row);
      list.push(row);
      return;
    }
    const existing = byKey.get(key);
    existing.weeklyOrderCount = Math.round(
      Number(existing.weeklyOrderCount || 0) + Number(rider.weeklyOrderCount || 0)
    );
    if (rider.amounts || existing.amounts) {
      existing.amounts = sumAmountMaps(existing.amounts, rider.amounts);
    }
    if (!existing.riderName && rider.riderName) existing.riderName = rider.riderName;
    if (!existing.originalName && rider.originalName) existing.originalName = rider.originalName;
    if (
      String(rider.baeminUserId || '').startsWith('0')
      && !String(existing.baeminUserId || '').startsWith('0')
    ) {
      existing.baeminUserId = rider.baeminUserId;
    } else if (!existing.baeminUserId && rider.baeminUserId) {
      existing.baeminUserId = rider.baeminUserId;
    }
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
    // 직계약: 금액/공제 열이 지정되면 라이더별 amounts(배달료·고용/산재/시간제보험)를 함께 추출한다.
    const amountColumns = columnConfig.amountColumns || null;
    const rows = await readWeeklyRows(file, password, { sheetIndex: 0 });
    const riders = [];
    const seen = new Set();
    const startIndex = Math.max(0, startRow - 1);

    for (let i = startIndex; i < rows.length; i += 1) {
      const rawName = cellText(readCell(rows[i] || [], nameColumn));
      if (!rawName) continue;
      const orderRaw = readCell(rows[i] || [], orderCountColumn);
      // 직계약: 시작행을 여유있게 앞에 둬도 헤더·설명·합계 행이 섞이지 않도록
      // 오더수가 숫자인 실제 데이터 행만 읽는다. 브로 업로드는 기존 동작을 그대로 둔다.
      if (amountColumns && !/^[\d,]+(\.\d+)?$/.test(String(orderRaw ?? '').trim())) continue;
      const weeklyOrderCount = Number(String(orderRaw ?? '').replace(/[^\d.-]/g, '')) || 0;
      const loginKey = normalizeCoupangLoginKey(rawName);
      const rider = {
        originalName: rawName,
        riderName: normalizeCoupangName(rawName),
        coupangLoginKey: loginKey,
        weeklyOrderCount
      };
      const amounts = extractCoupangAmounts(rows[i] || [], amountColumns);
      if (amounts) rider.amounts = amounts;
      pushUniqueRider(riders, seen, loginKey, rider);
    }

    if (!riders.length) {
      throw new Error('쿠팡 정산서에서 기사명을 읽지 못했습니다. 기사명 열/시작행을 확인하세요.');
    }
    return riders;
  }

  function parseBaeminRiderRows(rows, options = {}) {
    const { userIdColumn, nameColumn, orderCountColumn, startIndex, amountColumns } = options;
    const riders = [];
    const byKey = new Map();

    for (let i = startIndex; i < rows.length; i += 1) {
      const rawName = cellText(readCell(rows[i] || [], nameColumn));
      const baeminUserId = cellText(readCell(rows[i] || [], userIdColumn));
      const normalizedUserId = normalizeBaeminUserId(baeminUserId);
      if (!normalizedUserId) continue;
      const orderRaw = readCell(rows[i] || [], orderCountColumn);
      // 직계약: User ID가 영문+숫자 로그인 ID(BC063824 등)라 숫자 필터를 못 쓴다.
      // 대신 시작행을 여유있게 앞에 둬도 헤더/설명/합계 행이 섞이지 않도록 처리건수(콜수)가 숫자인 실제 데이터 행만 읽는다.
      if (amountColumns && !/^[\d,]+(\.\d+)?$/.test(String(orderRaw ?? '').trim())) continue;
      const weeklyOrderCount = Number(String(orderRaw ?? '').replace(/[^\d.-]/g, '')) || 0;
      const rider = {
        originalName: rawName,
        riderName: normalizeBaeminName(rawName),
        // 앞 0 이 있으면 그대로 보존해 이후 매칭·표시에 쓴다.
        baeminUserId: normalizedUserId,
        weeklyOrderCount
      };
      const amounts = extractBaeminAmounts(rows[i] || [], amountColumns);
      if (amounts) rider.amounts = amounts;
      pushOrSumBaeminRider(riders, byKey, rider);
    }

    return riders;
  }

  async function extractBaeminWeeklyRiders(file, password, columnConfig = {}) {
    const parseOptions = {
      userIdColumn: columnConfig.userIdColumn || 'B',
      nameColumn: columnConfig.nameColumn || 'C',
      orderCountColumn: columnConfig.orderCountColumn || 'D',
      startIndex: Math.max(0, Number(columnConfig.startRow || 2) - 1),
      // 직계약: 금액/공제 열이 지정되면 라이더별 amounts(배달료·추가지급·총배달료·공제)를 함께 추출한다.
      amountColumns: columnConfig.amountColumns || null
    };

    // 두 번째 시트 → 시트명 매칭 → 첫 시트 순으로 시도하고,
    // User ID(B열)를 실제로 읽어낸 시트를 채택한다.
    const attempts = [
      { sheetIndex: BAEMIN_SHEET_INDEX },
      { sheetMatcher: name => name.includes(BAEMIN_SHEET_KEYWORD) },
      { sheetIndex: 0 }
    ];

    for (const attempt of attempts) {
      const rows = await readWeeklyRows(file, password, attempt);
      const riders = parseBaeminRiderRows(rows || [], parseOptions);
      if (riders.length) return canonicalizeBaeminRiderIds(riders);
    }

    throw new Error('배민 정산서 두 번째 시트에서 User ID(B열)를 읽지 못했습니다. 시트 순서와 열/시작행을 확인하세요.');
  }

  function findBaeminSettlementSheetName(sheetNames = []) {
    const names = Array.isArray(sheetNames) ? sheetNames : [];
    return names[BAEMIN_SHEET_INDEX]
      || names.find(name => String(name || '').includes(BAEMIN_SHEET_KEYWORD))
      || '';
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
        const userId = baeminIdMatchKey(baeminUserId);
        if (userId && baeminIdMatchKey(item.originalName) === userId) return true;
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
    if (manual) {
      // 호출측 rider.baeminUserId 를 등록 ID 로 복원할 수 있게 참조만 돌려준다.
      return manual;
    }

    const userId = baeminIdMatchKey(rider.baeminUserId);
    if (!userId) return null;

    return BremStorage.drivers.getAll().find(
      driver => baeminIdMatchKey(driver.baeminId) === userId
    ) || null;
  }

  // 정산 라이더 목록의 배민 ID 를 기사 등록값(앞 0 포함)으로 맞춘다.
  function canonicalizeBaeminRiderIds(riders) {
    return (Array.isArray(riders) ? riders : []).map(rider => {
      const driver = resolveBaeminDriver(rider);
      if (!driver?.baeminId) return rider;
      const fixed = preferRegisteredBaeminId(rider.baeminUserId, driver);
      if (!fixed || fixed === rider.baeminUserId) {
        return driver && !rider.matchedRiderId
          ? { ...rider, matchedRiderId: driver.id, driverName: driver.name || rider.driverName }
          : rider;
      }
      return {
        ...rider,
        baeminUserId: fixed,
        matchedRiderId: rider.matchedRiderId || driver.id,
        driverName: driver.name || rider.driverName
      };
    });
  }

  function resolveDriverByWeeklyRider(rider, platform) {
    return normalizePlatform(platform) === 'baemin'
      ? resolveBaeminDriver(rider)
      : resolveCoupangDriver(rider);
  }

  function findDriverInPeriodByWeeklyRider(rider, platform, driverIdsInPeriod) {
    const p = normalizePlatform(platform);

    if (p === 'baemin') {
      const userId = baeminIdMatchKey(rider.baeminUserId);
      if (!userId) return null;
      for (const driverId of driverIdsInPeriod) {
        const driver = BremStorage.drivers.getById(driverId);
        if (driver && baeminIdMatchKey(driver.baeminId) === userId) return driver;
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

  function isCallCountIgnored(rider) {
    return rider?.callCountIgnored === true;
  }

  // 실제 경고·카운트에 쓸 불일치: 관리자가 「콜수무시 승인」한 건은 제외한다.
  function isCallCountMismatch(rider) {
    return rider?.callCountMatched === false && !isCallCountIgnored(rider);
  }

  function refreshRiderCallMatch(rider, { platform, startDate, endDate } = {}) {
    const driverId = rider?.matchedRiderId || '';
    if (!driverId) return rider;

    const stats = buildDriverCallStatsForPeriod(driverId, startDate, endDate, platform);
    const callMatch = evaluateCallCountMatch(rider, stats, startDate, endDate);
    const ignored = isCallCountIgnored(rider);
    const warnings = ignored
      ? [`콜수무시 승인 (주간서 ${callMatch.weeklyOrderCount} / 시스템 ${callMatch.systemCallCount} · 시스템 콜수 유지)`]
      : callMatch.warnings;
    return {
      ...rider,
      systemCallCount: callMatch.systemCallCount,
      callCountMatched: callMatch.callCountMatched,
      callCountIgnored: ignored,
      callStatsByDay: callMatch.callStatsByDay,
      warnings
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
        // 엑셀에서 앞 0 이 빠졌어도 기사 등록 배민 ID(010…)로 복원
        baeminUserId: p === 'baemin'
          ? preferRegisteredBaeminId(rider.baeminUserId, driver)
          : (rider.baeminUserId || ''),
        driverName: driver?.name || '',
        matchedRiderId: driver?.id || '',
        matched,
        weeklyOrderCount: callMatch.weeklyOrderCount,
        systemCallCount: callMatch.systemCallCount,
        callCountMatched: matched && hasSystemData ? callMatch.callCountMatched : false,
        callStatsByDay: callMatch.callStatsByDay || {},
        // 직계약 금액/공제(있으면) 보존
        ...(rider.amounts ? { amounts: rider.amounts } : {}),
        warnings: matched ? warnings : [unmatchedReasonForRider(p, driver, hasSystemData, rider)]
      };
    });
  }

  function buildWeeklySummary(matchedRiders = [], unmatchedRiders = []) {
    const callCountMismatches = matchedRiders.filter(item => isCallCountMismatch(item)).length;
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

  function buildWeeklySettlementId({ platform, region, year, month, week, startDate, channel }) {
    const p = normalizePlatform(platform);
    const regionSlug = slugify(region);
    const prefix = channel === 'direct' ? 'weekly_direct' : 'weekly';
    if (year && month && week) return `${prefix}_${p}_${regionSlug}_${year}_${month}_${week}`;
    // 배민: 월말 쪼개진 파일이 같은 수~화 주를 공유하도록 startDate 대신 수요일 weekStart 사용
    const idDate = p === 'baemin'
      ? (baeminWeekStartKey(startDate) || startDate)
      : startDate;
    return `${prefix}_${p}_${regionSlug}_${String(idDate || '').replace(/-/g, '')}`;
  }

  function buildWeeklySettlementRecord(payload) {
    const platform = normalizePlatform(payload.platform);
    const channel = payload.channel === 'direct' ? 'direct' : 'bro';
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
    const fileNames = Array.isArray(payload.fileNames)
      ? payload.fileNames.map(String).filter(Boolean)
      : (payload.fileName ? [String(payload.fileName)] : []);
    const sourceParts = Array.isArray(payload.sourceParts) ? payload.sourceParts : null;

    return {
      id: payload.id || buildWeeklySettlementId({
        platform,
        region,
        year: parsedMeta.year,
        month: parsedMeta.month,
        week: parsedMeta.week,
        startDate: dates.startDate,
        channel
      }),
      platform,
      channel,
      region,
      fileName: fileNames.length ? fileNames.join(' + ') : (payload.fileName || ''),
      fileNames,
      sourceParts: sourceParts || undefined,
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
        callCountMismatches: matchedRiders.filter(rider => isCallCountMismatch(rider)).length
      }
    };
  }

  function setRiderCallCountIgnored(record, driverId, ignored = true) {
    if (!record || !driverId) return record;
    const targetId = String(driverId || '').trim();
    const riders = (record.riders || []).map(rider => {
      if (String(rider.matchedRiderId || '') !== targetId) return rider;
      return {
        ...rider,
        callCountIgnored: ignored === true
      };
    });
    return refreshWeeklySettlementRiders({ ...record, riders });
  }

  function saveWeeklySettlement(record) {
    // 채널(브로/직계약) 보존: 저장 키 라우팅에 사용되므로 반드시 유지.
    const channel = record.channel === 'direct' || record.summary?.channel === 'direct' ? 'direct' : 'bro';
    let toSave = record;
    // 배민: 같은 지역·수~화 주 기존 건이 있으면 part upsert 후 금액·콜수 합산
    if (normalizePlatform(record.platform) === 'baemin' && record.id) {
      const existing = BremStorage.weeklySettlements.getById(record.id, channel)
        || BremStorage.weeklySettlements.getById(record.id);
      if (existing && normalizePlatform(existing.platform) === 'baemin') {
        toSave = upsertBaeminWeeklyParts(existing, { ...record, channel });
      }
    }
    const refreshed = refreshWeeklySettlementRiders(toSave);
    refreshed.channel = channel;
    refreshed.summary = { ...(refreshed.summary || {}), channel };
    if (Array.isArray(toSave.fileNames)) refreshed.fileNames = toSave.fileNames;
    if (Array.isArray(toSave.sourceParts)) refreshed.sourceParts = toSave.sourceParts;
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

  // 직계약 정산서 삭제: 정산서 + 업로드 로그 + 그 정산서에 붙인 프로모션/기타지급까지 한 번에.
  // 하나만 남으면 정산결과·최종입금에 삭제한 건이 계속 보이거나, 로그가 되살아난다.
  async function deleteDirectSettlementCascade(id, options = {}) {
    const targetId = String(id || '').trim();
    if (!targetId) return null;
    const record = BremStorage.weeklySettlements.getById(targetId);
    const channel = record?.channel === 'bro' ? 'bro' : 'direct';
    if (record) BremStorage.weeklySettlements.remove(targetId, channel);
    else BremStorage.weeklySettlements.remove(targetId);
    BremStorage.settlementUploadLogs.removeByLinkedRecordId(targetId);
    if (options.logId) BremStorage.settlementUploadLogs.remove(options.logId);
    BremStorage.directSettlementAdjustments?.clearSettlement?.('promotion', targetId);
    BremStorage.directSettlementAdjustments?.clearSettlement?.('other', targetId);

    let blockedMessage = '';
    const onBlocked = (event) => {
      blockedMessage = event?.detail?.message || '데이터 저장이 보호 정책에 의해 차단되었습니다.';
    };
    document.addEventListener('brem-storage-persist-blocked', onBlocked);
    try {
      await BremStorage.flushStorage?.();
    } finally {
      document.removeEventListener('brem-storage-persist-blocked', onBlocked);
    }
    if (blockedMessage) {
      throw new Error(blockedMessage);
    }
    // 캐시에 남아 있으면 삭제 실패로 본다. (보호 차단 후 서버 값이 되살아난 경우 포함)
    if (BremStorage.weeklySettlements.getById(targetId, channel)
      || BremStorage.weeklySettlements.getById(targetId)) {
      throw new Error('정산서 삭제가 반영되지 않았습니다. 잠시 후 다시 시도하세요.');
    }
    return record;
  }

  async function processWeeklyUpload(options) {
    const platform = normalizePlatform(options.platform);
    const files = Array.isArray(options.files) && options.files.length
      ? options.files.filter(Boolean)
      : (options.file ? [options.file] : []);
    if (!files.length) throw new Error('정산서 파일을 선택하세요.');

    const columnConfig = options.columnConfig || {};
    const channel = options.channel === 'direct' ? 'direct' : 'bro';

    // 배민 여러 파일: 파일별 추출 후 지역·주차로 묶고 배민ID별 금액 합산
    if (platform === 'baemin' && files.length > 1) {
      const parts = [];
      for (const file of files) {
        const parsed = parseBaeminFileName(file.name);
        // 파일별 기간·지역은 파일명을 우선 (폼에 합친 기간이 들어와 반쪽 날짜가 덮이지 않게)
        const startDate = parsed.startDate || options.startDate || '';
        const endDate = parsed.endDate || options.endDate || '';
        const region = parsed.teamName || options.region || '';
        const riders = await extractBaeminWeeklyRiders(file, options.password, columnConfig);
        parts.push({
          fileName: file.name,
          startDate,
          endDate,
          region,
          weekStart: baeminWeekStartKey(startDate || parsed.startDate),
          riders
        });
      }
      const groups = new Map();
      parts.forEach(part => {
        const region = String(part.region || options.region || '').trim() || 'unknown';
        const weekStart = part.weekStart || baeminWeekStartKey(part.startDate) || '';
        const key = `${slugify(region)}|${weekStart}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(part);
      });

      const records = [];
      for (const groupParts of groups.values()) {
        const region = groupParts.map(p => p.region).find(Boolean) || options.region || '';
        const startDate = groupParts.map(p => p.startDate).filter(Boolean).sort()[0] || options.startDate || '';
        const endDate = groupParts.map(p => p.endDate).filter(Boolean).sort().pop() || options.endDate || '';
        const extracted = mergeBaeminRiders(groupParts.map(p => p.riders));
        const allMatched = matchSettlementRidersWithExistingData(extracted, platform, {
          startDate,
          endDate
        });
        const matchedRiders = allMatched.filter(item => item.matched);
        const unmatchedRiders = allMatched.filter(item => !item.matched);
        const sourceParts = groupParts.map(part => ({
          fileName: part.fileName,
          startDate: part.startDate,
          endDate: part.endDate,
          riders: matchSettlementRidersWithExistingData(part.riders, platform, { startDate, endDate })
        }));
        let record = buildWeeklySettlementRecord({
          platform,
          channel,
          region,
          fileName: groupParts.map(p => p.fileName).join(' + '),
          fileNames: groupParts.map(p => p.fileName),
          sourceParts,
          baseSettlementDate: startDate,
          startDate,
          endDate,
          paymentDate: options.paymentDate
            || calculateCoupangSettlementDates(startDate).paymentDate,
          // 합친 전체 기간을 우선 (폼에 한쪽 파일 기간만 남아 주차가 어긋나지 않게)
          settlementWeekLabel: (startDate && endDate ? `${startDate} ~ ${endDate}` : '')
            || options.settlementWeekLabel
            || '',
          matchedRiders,
          unmatchedRiders
        });
        record = {
          ...record,
          startDate,
          endDate,
          baseSettlementDate: startDate,
          settlementWeekLabel: startDate && endDate ? `${startDate} ~ ${endDate}` : record.settlementWeekLabel,
          sourceParts,
          fileNames: groupParts.map(p => p.fileName),
          previewUnmatched: unmatchedRiders
        };
        records.push(record);
      }
      if (records.length === 1) return records[0];
      return { ok: true, multi: true, records };
    }

    const file = files[0];
    const parsedMeta = platform === 'baemin' ? parseBaeminFileName(file.name) : {};
    const startDate = options.startDate || parsedMeta.startDate || '';
    const endDate = options.endDate || parsedMeta.endDate || '';

    const extracted = platform === 'coupang'
      ? await extractCoupangWeeklyRiders(file, options.password, columnConfig)
      : await extractBaeminWeeklyRiders(file, options.password, columnConfig);

    const allMatched = matchSettlementRidersWithExistingData(extracted, platform, {
      startDate,
      endDate
    });
    const matchedRiders = allMatched.filter(item => item.matched);
    const unmatchedRiders = allMatched.filter(item => !item.matched);

    const record = buildWeeklySettlementRecord({
      platform,
      channel,
      region: options.region || parsedMeta.teamName || '',
      fileName: file.name,
      fileNames: [file.name],
      sourceParts: platform === 'baemin'
        ? [{ fileName: file.name, startDate, endDate, riders: allMatched }]
        : undefined,
      baseSettlementDate: options.baseSettlementDate || startDate,
      startDate,
      endDate,
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

    await BremStorage.ensureSectionLoaded?.('settlements');
    await BremStorage.ensureSectionLoaded?.('calls');

    const settlementIds = [...new Set(BremStorage.settlements.getAll()
      .filter(item => item.driverId === id
        && normalizePlatform(item.platform) === p
        && days.has(normalizePeriodDay(item.period)))
      .map(item => item.id))];

    const callIds = [...new Set(BremStorage.calls.getAll()
      .filter(item => item.driverId === id
        && normalizePlatform(item.platform) === p
        && days.has(String(item.date).slice(0, 10)))
      .map(item => item.id))];

    if (settlementIds.length) {
      await BremStorage.settlements.removeByIdsAsync(settlementIds);
    }
    if (callIds.length) {
      await BremStorage.calls.removeByIdsAsync(callIds);
    }
    await BremStorage.flushStorage?.();
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
    BAEMIN_SHEET_INDEX,
    calculateCoupangSettlementDates,
    listDaysInclusive,
    buildCallCountMismatchDetail,
    isCallCountIgnored,
    isCallCountMismatch,
    refreshRiderCallMatch,
    setRiderCallCountIgnored,
    resolveWeeklyComparePeriod,
    parseCoupangFileName,
    parseBaeminFileName,
    baeminWeekStartKey,
    mergeBaeminRiders,
    upsertBaeminWeeklyParts,
    normalizeCoupangName,
    normalizeBaeminName,
    normalizeBaeminUserId,
    baeminIdMatchKey,
    preferRegisteredBaeminId,
    canonicalizeBaeminRiderIds,
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
    deleteDirectSettlementCascade,
    saveManualNameMapping,
    loadManualNameMappings,
    resolveBaeminDriver,
    processWeeklyUpload
  };
})();

if (typeof window !== 'undefined') window.BremWeeklySettlement = BremWeeklySettlement;
