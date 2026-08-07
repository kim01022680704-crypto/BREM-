const BremCoupangDeliveryFee = (function () {
  const FORMAT_ID = 'brem-coupang-delivery';
  const SHEET_KEYWORD = '오더별 상세내역';
  const FALLBACK_SHEET_INDEX = 2;

  function normalizeName(value) {
    if (typeof window.BremDriverUtils?.normalizeCoupangMatchKey === 'function') {
      return window.BremDriverUtils.normalizeCoupangMatchKey(value);
    }
    return String(value || '')
      .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '')
      .replace(/\s+/g, '')
      .trim();
  }

  function parseDateToken(token) {
    const raw = String(token || '').trim();
    if (!/^\d{8}$/.test(raw)) return '';
    const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    const check = new Date(`${date}T00:00:00`);
    if (Number.isNaN(check.getTime())) return '';
    return date;
  }

  function weekStartOf(dateValue) {
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
    const diff = (day - 3 + 7) % 7;
    date.setDate(date.getDate() - diff);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function parseFileName(fileName) {
    const base = String(fileName || '').replace(/\.(xlsx|xls)$/i, '').trim();

    // 배민식 기간: 배달처리비_팀명_YYYYMMDD_YYYYMMDD
    const feeRange = base.match(/^배달처리비_(.+)_(\d{8})_(\d{8})$/i);
    if (feeRange) {
      return {
        label: '배달처리비',
        teamName: feeRange[1],
        startDate: parseDateToken(feeRange[2]),
        endDate: parseDateToken(feeRange[3]),
        dateMode: 'range'
      };
    }

    const parts = base.split('_').filter(Boolean);
    const dateParts = parts.filter(part => /^\d{8}$/.test(part));

    // 기간 두 개
    if (dateParts.length >= 2) {
      const endToken = dateParts[dateParts.length - 1];
      const startToken = dateParts[dateParts.length - 2];
      const prefixParts = parts.slice(0, parts.indexOf(startToken));
      return {
        label: prefixParts[0] || '쿠팡배달처리비',
        teamName: prefixParts.slice(1).join('_') || prefixParts[0] || '',
        startDate: parseDateToken(startToken),
        endDate: parseDateToken(endToken),
        dateMode: 'range'
      };
    }

    // 쿠팡 주정산서: 배달현황_지역_팀_YYYYMMDD (배달처리비 포함, 날짜 1개)
    if (dateParts.length === 1) {
      const dateToken = dateParts[0];
      const date = parseDateToken(dateToken);
      const prefixParts = parts.slice(0, parts.lastIndexOf(dateToken));
      return {
        label: prefixParts[0] || '배달현황',
        teamName: prefixParts.slice(1).join('_') || prefixParts[0] || '',
        startDate: date,
        endDate: date,
        fileDate: date,
        dateMode: 'single',
        weekStart: weekStartOf(date)
      };
    }

    return null;
  }

  function coupangIdOf(driver, rider) {
    const utils = window.BremDriverUtils;
    if (utils?.getErpCoupangId) {
      const erpId = normalizeName(utils.getErpCoupangId(driver));
      if (erpId) return erpId;
    }
    if (utils?.makeDriverLoginId && driver) {
      const loginId = normalizeName(utils.makeDriverLoginId(driver));
      if (loginId) return loginId;
    }
    return normalizeName(rider?.coupangLoginKey || rider?.matchKey || '');
  }

  function indexKeysForRider(nameOrId) {
    const raw = normalizeName(nameOrId);
    if (!raw) return [];
    const keys = new Set([raw]);
    // 쿠팡ID(이름+뒤4) → 이름 부분도 키로 등록
    const nameOnly = raw.replace(/\d{4}$/, '');
    if (nameOnly && nameOnly !== raw) keys.add(nameOnly);
    return [...keys];
  }

  function buildIndex(parsedRows) {
    const index = new Map();
    (parsedRows || []).forEach(row => {
      const name = normalizeName(row.name || row.riderId || row.rawName);
      if (!name) return;
      if (Number(row.orderCount || 0) <= 0 || Number(row.deliveryAmount || 0) <= 0) return;

      const entry = {
        rawName: row.rawName || name,
        name,
        riderId: name,
        orderCount: Number(row.orderCount || 0),
        deliveryAmount: Number(row.deliveryAmount || 0),
        deliveryFees: Array.isArray(row.deliveryFees)
          ? row.deliveryFees.map(fee => Number(fee || 0)).filter(fee => fee > 0)
          : [],
        avgUnitPrice: 0
      };

      const prev = index.get(`id:${name}`);
      if (prev) {
        entry.orderCount += Number(prev.orderCount || 0);
        entry.deliveryAmount += Number(prev.deliveryAmount || 0);
        entry.deliveryFees = [...(prev.deliveryFees || []), ...entry.deliveryFees];
      }
      entry.avgUnitPrice = entry.orderCount > 0
        ? Math.round(entry.deliveryAmount / entry.orderCount)
        : 0;

      indexKeysForRider(name).forEach(key => {
        index.set(`id:${key}`, entry);
      });
    });
    return index;
  }

  function lookup(index, rider, driver) {
    if (!index || !index.size) return null;

    const candidates = [
      coupangIdOf(driver, rider),
      rider?.coupangLoginKey,
      rider?.matchKey,
      driver?.coupangLoginKey,
      driver?.name,
      rider?.riderName,
      rider?.driverName,
      rider?.name,
      rider?.originalName
    ];

    for (const candidate of candidates) {
      for (const key of indexKeysForRider(candidate)) {
        const hit = index.get(`id:${key}`);
        if (hit) return hit;
      }
    }
    return null;
  }

  function assertDateMatch(settlement, meta) {
    if (!settlement || !meta) return;
    const settlementStart = String(settlement.startDate || '').slice(0, 10);
    const settlementEnd = String(settlement.endDate || '').slice(0, 10);

    // 쿠팡 주정산서(배달현황_…_YYYYMMDD): 파일 날짜가 주정산 기간 안이거나, 같은 수~화 주차면 OK
    if (meta.dateMode === 'single') {
      const fileDate = String(meta.fileDate || meta.startDate || '').slice(0, 10);
      if (!fileDate) {
        throw new Error('쿠팡 주정산서 파일명에서 날짜(YYYYMMDD)를 읽지 못했습니다. 예: 배달현황_경남_양산동부(Z)_20260801');
      }
      const inRange = settlementStart && settlementEnd
        && fileDate >= settlementStart
        && fileDate <= settlementEnd;
      const sameWeek = settlementStart
        && (meta.weekStart === settlementStart || weekStartOf(fileDate) === settlementStart);
      if (!inRange && !sameWeek) {
        throw new Error(
          `쿠팡 파일 날짜(${fileDate})가 선택한 쿠팡 주정산 기간(${settlementStart} ~ ${settlementEnd})과 맞지 않습니다.`
        );
      }
      return;
    }

    if (!meta.startDate || !meta.endDate) {
      throw new Error('쿠팡 파일명에서 정산기간을 읽지 못했습니다. 예: 배달현황_경남_양산동부(Z)_20260801');
    }
    if (settlementStart && meta.startDate !== settlementStart) {
      throw new Error(`쿠팡 파일 시작일(${meta.startDate})이 쿠팡 주정산서(${settlementStart})와 다릅니다.`);
    }
    if (settlementEnd && meta.endDate !== settlementEnd) {
      throw new Error(`쿠팡 파일 종료일(${meta.endDate})이 쿠팡 주정산서(${settlementEnd})와 다릅니다.`);
    }
  }

  async function parseFile(file, password) {
    if (!file) throw new Error('쿠팡 배달처리비 정산서 파일을 선택하세요.');
    const meta = parseFileName(file.name);
    if (!meta || !(meta.fileDate || (meta.startDate && meta.endDate))) {
      throw new Error('쿠팡 파일명 형식을 확인하세요. 예: 배달현황_경남_양산동부(Z)_20260801 (주정산서, 끝 YYYYMMDD)');
    }

    const format = SettlementFormats.getFormat(FORMAT_ID);
    const arrayBuffer = await file.arrayBuffer();
    const openOptions = {
      formatId: FORMAT_ID,
      format,
      sheetName: SHEET_KEYWORD,
      sheetMatcher: (name) => String(name || '').includes(SHEET_KEYWORD),
      sheetIndex: Number.isFinite(Number(format.sheetIndex)) ? Number(format.sheetIndex) : FALLBACK_SHEET_INDEX
    };
    const rows = await BremSettlementParser.openWorkbookSheetRows(
      new Uint8Array(arrayBuffer),
      BremSettlementParser.normalizePassword(password),
      openOptions
    );
    const parsed = BremSettlementParser.parseRowsWithFormat(rows, format);
    if (!parsed?.parsedRows?.length) {
      throw new Error('쿠팡 배달처리비(3시트 오더별 상세내역)에서 B열(이름)·Y열(정산금액) 데이터를 읽지 못했습니다.');
    }

    const index = buildIndex(parsed.parsedRows);
    return {
      fileName: file.name,
      teamName: meta.teamName,
      startDate: meta.startDate,
      endDate: meta.endDate,
      riderCount: parsed.parsedRows.length,
      totalDeliveries: parsed.totalDeliveries || 0,
      totalDeliveryAmount: parsed.totalDeliveryAmount || 0,
      rows: parsed.parsedRows,
      index
    };
  }

  function formatMetaLabel(meta) {
    if (!meta) return '';
    if (meta.dateMode === 'single') {
      return `쿠팡 ${meta.teamName || '-'} · ${meta.fileDate || meta.startDate} · ${meta.riderCount || 0}명`;
    }
    return `쿠팡 ${meta.teamName || '-'} · ${meta.startDate} ~ ${meta.endDate} · ${meta.riderCount || 0}명`;
  }

  return {
    parseFileName,
    parseFile,
    buildIndex,
    lookup,
    assertDateMatch,
    formatMetaLabel,
    normalizeName
  };
})();
