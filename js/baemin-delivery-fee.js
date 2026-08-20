const BremBaeminDeliveryFee = (function () {
  const FORMAT_ID = 'brem-baemin';

  function normalizeName(value) {
    return String(value || '')
      .replace(/[\u200b\u200c\u200d\ufeff\u00a0]/g, '')
      .trim()
      .replace(/\s+/g, '');
  }

  function parseDateToken(token) {
    const raw = String(token || '').trim();
    if (!/^\d{8}$/.test(raw)) return '';
    const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    const check = new Date(`${date}T00:00:00`);
    if (Number.isNaN(check.getTime())) return '';
    return date;
  }

  function parseFileName(fileName) {
    const base = String(fileName || '').replace(/\.(xlsx|xls)$/i, '').trim();
    const strict = base.match(/^배달처리비_(.+)_(\d{8})_(\d{8})$/i);
    if (strict) {
      return {
        label: '배달처리비',
        teamName: strict[1],
        startDate: parseDateToken(strict[2]),
        endDate: parseDateToken(strict[3])
      };
    }

    const parts = base.split('_').filter(Boolean);
    const dateParts = parts.filter(part => /^\d{8}$/.test(part));
    if (dateParts.length >= 2) {
      const endToken = dateParts[dateParts.length - 1];
      const startToken = dateParts[dateParts.length - 2];
      const prefixParts = parts.slice(0, parts.indexOf(startToken));
      return {
        label: prefixParts[0] || '배달처리비',
        teamName: prefixParts.slice(1).join('_') || prefixParts[0] || '',
        startDate: parseDateToken(startToken),
        endDate: parseDateToken(endToken)
      };
    }

    return null;
  }

  function baeminMatchKey(value) {
    if (typeof BremWeeklySettlement !== 'undefined'
      && typeof BremWeeklySettlement.baeminIdMatchKey === 'function') {
      return BremWeeklySettlement.baeminIdMatchKey(value);
    }
    const v = String(value || '').trim().replace(/\s+/g, '');
    if (!v) return '';
    return /^\d+$/.test(v) ? (v.replace(/^0+/, '') || '0') : v.toLowerCase();
  }

  function normalizeId(value) {
    const cleaned = String(value || '').replace(/[\u200b\u200c\u200d\ufeff\u00a0]/g, '');
    if (typeof BremWeeklySettlement !== 'undefined'
      && typeof BremWeeklySettlement.normalizeBaeminUserId === 'function') {
      return BremWeeklySettlement.normalizeBaeminUserId(cleaned);
    }
    return cleaned.trim();
  }

  // 앞 0 유무·원문·매칭키를 모두 인덱스에 넣어 어떤 형태로 와도 찾는다.
  function indexKeysForBaeminId(riderId) {
    const raw = normalizeId(riderId);
    if (!raw) return [];
    const key = baeminMatchKey(raw);
    const keys = new Set([raw, key].filter(Boolean));
    if (key && /^\d+$/.test(key)) {
      keys.add(`0${key}`);
      keys.add(key);
    }
    if (/^0\d+$/.test(raw)) keys.add(raw.replace(/^0+/, '') || '0');
    return [...keys];
  }

  function resolveIndex(index) {
    if (!index) return null;
    if (typeof index.get === 'function' && Number(index.size) > 0) return index;
    if (index.index && typeof index.index.get === 'function' && Number(index.index.size) > 0) {
      return index.index;
    }
    return null;
  }

  function buildIndex(parsedRows) {
    const index = new Map();
    (parsedRows || []).forEach(row => {
      const riderId = normalizeId(row.riderId || row.baeminUserId);
      const key = baeminMatchKey(riderId);
      if (Number(row.orderCount || 0) <= 0 || Number(row.deliveryAmount || 0) <= 0) return;
      if (!key && !normalizeName(row.name || row.rawName)) return;

      const feePairs = Array.isArray(row.deliveryFees)
        ? row.deliveryFees.map((fee, i) => ({
          fee: Number(fee || 0),
          weather: Boolean(row.weatherFlags?.[i])
        })).filter(item => item.fee > 0)
        : [];
      const prevById = key ? index.get(`id:${key}`) : null;
      const entry = {
        rawName: row.rawName,
        name: row.name,
        // 앞 0 이 있는 원문을 우선 보존
        riderId: riderId && String(riderId).startsWith('0')
          ? riderId
          : (prevById?.riderId || riderId),
        orderCount: Number(row.orderCount || 0),
        deliveryAmount: Number(row.deliveryAmount || 0),
        deliveryFees: feePairs.map(item => item.fee),
        weatherFlags: feePairs.map(item => item.weather),
        avgUnitPrice: 0
      };
      // 같은 매칭키로 이미 있으면 합산
      if (prevById) {
        entry.orderCount += Number(prevById.orderCount || 0);
        entry.deliveryAmount += Number(prevById.deliveryAmount || 0);
        entry.deliveryFees = [...(prevById.deliveryFees || []), ...entry.deliveryFees];
        entry.weatherFlags = [...(prevById.weatherFlags || []), ...entry.weatherFlags];
        if (String(prevById.riderId || '').startsWith('0')) entry.riderId = prevById.riderId;
      }
      entry.avgUnitPrice = entry.orderCount > 0
        ? Math.round(entry.deliveryAmount / entry.orderCount)
        : 0;

      indexKeysForBaeminId(entry.riderId).forEach(idKey => {
        index.set(`id:${idKey}`, entry);
      });
      const nameKey = normalizeName(entry.name || entry.rawName);
      if (nameKey && !index.has(`name:${nameKey}`)) {
        index.set(`name:${nameKey}`, entry);
      }
    });
    return index;
  }

  function lookup(index, rider, driver) {
    const map = resolveIndex(index);
    if (!map) return null;

    const candidates = [
      rider?.baeminUserId,
      rider?.baeminId,
      rider?.riderId,
      driver?.baeminId,
      driver?.baeminUserId,
      driver?.raw_data?.baeminId,
      driver?.raw_data?.baeminUserId,
      rider?.originalName
    ];
    for (const candidate of candidates) {
      for (const idKey of indexKeysForBaeminId(candidate)) {
        const hit = map.get(`id:${idKey}`);
        if (hit) return hit;
      }
    }

    const want = candidates.map(baeminMatchKey).filter(Boolean);
    if (want.length) {
      for (const [mapKey, entry] of map.entries()) {
        if (!String(mapKey).startsWith('id:')) continue;
        const entryKey = baeminMatchKey(String(mapKey).slice(3));
        if (want.includes(entryKey)) return entry;
      }
    }

    // K열 ID가 기사 배민 ID와 달라도 L열 라이더명으로 찾는다.
    const nameCandidates = [
      driver?.name,
      rider?.driverName,
      rider?.riderName,
      rider?.originalName,
      rider?.name
    ];
    for (const candidate of nameCandidates) {
      const nameKey = normalizeName(candidate);
      if (!nameKey) continue;
      const hit = map.get(`name:${nameKey}`);
      if (hit) return hit;
    }
    return null;
  }

  function assertDateMatch(settlement, meta) {
    if (!settlement || !meta) return;
    const settlementStart = String(settlement.startDate || '').slice(0, 10);
    const settlementEnd = String(settlement.endDate || '').slice(0, 10);
    if (!meta.startDate || !meta.endDate) {
      throw new Error('배달처리비 파일명에서 정산기간(YYYYMMDD_YYYYMMDD)을 읽지 못했습니다.');
    }
    if (settlementStart && meta.startDate !== settlementStart) {
      throw new Error(`배달처리비 시작일(${meta.startDate})이 주정산서(${settlementStart})와 다릅니다.`);
    }
    if (settlementEnd && meta.endDate !== settlementEnd) {
      throw new Error(`배달처리비 종료일(${meta.endDate})이 주정산서(${settlementEnd})와 다릅니다.`);
    }
  }

  async function parseFile(file, password) {
    if (!file) throw new Error('배달처리비 정산서 파일을 선택하세요.');
    const meta = parseFileName(file.name);
    if (!meta?.startDate || !meta?.endDate) {
      throw new Error('파일명 형식을 확인하세요. 예: 배달처리비_표준울산남A팀브로1_20260610_20260616');
    }

    const format = SettlementFormats.getFormat(FORMAT_ID);
    const arrayBuffer = await file.arrayBuffer();
    const rows = await BremSettlementParser.openWorkbookSheetRows(
      new Uint8Array(arrayBuffer),
      BremSettlementParser.normalizePassword(password),
      { formatId: FORMAT_ID, format }
    );
    const parsed = BremSettlementParser.parseRowsWithFormat(rows, format);
    if (!parsed?.parsedRows?.length) {
      throw new Error('배달처리비 파일에서 K열(User ID)·U열(가게도착)·V열·AH열(배달처리비) 데이터를 읽지 못했습니다.');
    }

    const index = buildIndex(parsed.parsedRows);
    if (!index.size) {
      const sample = (parsed.parsedRows || []).slice(0, 3)
        .map(row => row.riderId || row.name || '-')
        .join(', ');
      throw new Error(`배달처리비에서 ${parsed.parsedRows.length}명을 읽었지만 User ID 인덱스를 만들지 못했습니다. 예시: ${sample}`);
    }
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
    return `${meta.teamName || '-'} · ${meta.startDate} ~ ${meta.endDate} · ${meta.riderCount || 0}명`;
  }

  return {
    parseFileName,
    parseFile,
    lookup,
    assertDateMatch,
    formatMetaLabel,
    normalizeName
  };
})();
