(function () {
  const STORAGE_KEY = 'brem_payroll_daily_settlement_roster_v1';

  function normalizePhone(value) {
    return String(value || '').replace(/[^0-9]/g, '');
  }

  function resolveDriverPlatformId(driver, platform) {
    const driverUtils = window.BremDriverUtils;
    if (!driver) return '';
    if (platform === 'coupang') {
      return String(
        driverUtils?.getErpCoupangId?.(driver)
        || driver.coupangId
        || driver.coupangLoginKey
        || ''
      ).replace(/\s/g, '');
    }
    if (platform === 'baemin') {
      return String(driver.baeminId || '').trim();
    }
    return '';
  }

  function readLegacyLocalStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function writeLegacyLocalStorage(list) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.isArray(list) ? list : []));
  }

  function isSupabaseStorage() {
    const config = window.BREM_SUPABASE_CONFIG || {};
    return config.mode === 'production'
      || config.backend === 'supabase'
      || Boolean(window.BremStorage?.payrollDailySettlement?.persistAll);
  }

  function readAll() {
    if (window.BremStorage?.payrollDailySettlement?.getAll) {
      return window.BremStorage.payrollDailySettlement.getAll();
    }
    if (isSupabaseStorage()) return [];
    return readLegacyLocalStorage();
  }

  function writeAll(list) {
    if (window.BremStorage?.payrollDailySettlement?.saveAll) {
      return window.BremStorage.payrollDailySettlement.saveAll(list);
    }
    if (isSupabaseStorage()) {
      throw new Error('Supabase 저장소가 준비되지 않았습니다. 새로고침 후 다시 시도하세요.');
    }
    writeLegacyLocalStorage(list);
    return Array.isArray(list) ? list : [];
  }

  async function persistAll(list) {
    if (window.BremStorage?.payrollDailySettlement?.persistAll) {
      return window.BremStorage.payrollDailySettlement.persistAll(list);
    }
    return writeAll(list);
  }

  function makeId() {
    return `pds_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function normalizePlatforms(item = {}) {
    if (window.BremStorage?.payrollDailySettlement?.normalizePlatform) {
      return window.BremStorage.payrollDailySettlement.normalizePlatform(item);
    }
    const baeminId = String(item.baeminId || '').trim();
    const coupangId = String(item.coupangId || '').trim();
    let platformBaemin = item.platformBaemin;
    let platformCoupang = item.platformCoupang;
    if (platformBaemin === undefined && platformCoupang === undefined) {
      if (baeminId && !coupangId) {
        platformBaemin = true;
        platformCoupang = false;
      } else if (coupangId && !baeminId) {
        platformBaemin = false;
        platformCoupang = true;
      } else {
        platformBaemin = true;
        platformCoupang = true;
      }
    } else {
      platformBaemin = platformBaemin !== false;
      platformCoupang = platformCoupang !== false;
    }
    if (!platformBaemin && !platformCoupang) {
      if (baeminId) platformBaemin = true;
      else if (coupangId) platformCoupang = true;
      else {
        platformBaemin = true;
        platformCoupang = true;
      }
    }
    return { platformBaemin, platformCoupang };
  }

  function platformLabel(item = {}) {
    const { platformBaemin, platformCoupang } = normalizePlatforms(item);
    if (platformBaemin && platformCoupang) return '배민+쿠팡';
    if (platformBaemin) return '배민';
    if (platformCoupang) return '쿠팡';
    return '-';
  }

  function buildPlatformFields(baeminId, coupangId, extra = {}) {
    return normalizePlatforms({
      baeminId,
      coupangId,
      platformBaemin: extra.platformBaemin,
      platformCoupang: extra.platformCoupang
    });
  }

  /** 배민ID 또는 쿠팡ID 중 하나 필수 · 입력값 그대로 저장 */
  function matchDriver(baeminId, coupangId, phone, drivers) {
    const baemin = String(baeminId || '').trim();
    const coupang = String(coupangId || '').trim().replace(/\s/g, '');
    const list = Array.isArray(drivers) ? drivers : [];

    if (!baemin && !coupang) {
      return { status: 'empty', driver: null, error: '배민ID 또는 쿠팡ID 중 하나 필수' };
    }

    const candidates = list.filter(driver => {
      const driverBaemin = resolveDriverPlatformId(driver, 'baemin');
      const driverCoupang = resolveDriverPlatformId(driver, 'coupang');
      if (baemin && driverBaemin !== baemin) return false;
      if (coupang && driverCoupang !== coupang) return false;
      return true;
    });

    if (candidates.length > 1) {
      return { status: 'duplicate', driver: null, error: '여러 기사와 매칭' };
    }
    if (!candidates.length) {
      return { status: 'unmatched', driver: null, error: '등록 기사 없음' };
    }
    return { status: 'matched', driver: candidates[0], error: '' };
  }

  function parseBulkRows(rows, drivers) {
    const parsed = [];
    const issues = [];
    (Array.isArray(rows) ? rows : []).forEach((row, index) => {
      const baeminId = String(row?.[0] ?? '').trim();
      const coupangId = String(row?.[1] ?? '').trim().replace(/\s/g, '');
      const phone = String(row?.[2] ?? '').trim();
      const region = String(row?.[3] ?? '').trim();
      if (!baeminId && !coupangId && !phone && !region) return;
      if (/배민|쿠팡|전화|지역/i.test(`${baeminId}${coupangId}${phone}${region}`) && index === 0) return;

      const match = matchDriver(baeminId, coupangId, phone, drivers);
      parsed.push({
        rowNumber: index + 1,
        baeminId,
        coupangId,
        phone,
        region,
        matchStatus: match.status,
        driverId: match.driver?.id || '',
        driverName: match.driver?.name || '',
        error: match.error
      });
      if (match.status !== 'matched') {
        issues.push(`${index + 1}행: ${match.error || match.status}`);
      }
    });
    return { rows: parsed, issues };
  }

  function upsertFromBulk(parsedRows) {
    const list = readAll();
    let added = 0;
    parsedRows.forEach(row => {
      if (row.matchStatus !== 'matched' || !row.driverId) return;
      const existing = list.find(item => item.driverId === row.driverId);
      if (existing) {
        existing.region = row.region || existing.region;
        existing.baeminId = row.baeminId || existing.baeminId;
        existing.coupangId = row.coupangId || existing.coupangId;
        existing.phone = row.phone || existing.phone;
        existing.driverName = row.driverName || existing.driverName;
        const platforms = buildPlatformFields(existing.baeminId, existing.coupangId);
        existing.platformBaemin = platforms.platformBaemin;
        existing.platformCoupang = platforms.platformCoupang;
        existing.updatedAt = new Date().toISOString();
      } else {
        const platforms = buildPlatformFields(row.baeminId, row.coupangId);
        list.push({
          id: makeId(),
          driverId: row.driverId,
          driverName: row.driverName,
          baeminId: row.baeminId || '',
          coupangId: row.coupangId || '',
          phone: row.phone || '',
          region: row.region || '',
          platformBaemin: platforms.platformBaemin,
          platformCoupang: platforms.platformCoupang,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        added += 1;
      }
    });
    return { list, added, persist: () => persistAll(list) };
  }

  async function applyBulkPersist(result) {
    await result.persist();
    return { list: readAll(), added: result.added };
  }

  function enrollDriver(driver, extra = {}) {
    if (!driver?.id) return { list: readAll(), persist: async () => readAll() };
    const list = readAll();
    const existing = list.find(item => item.driverId === driver.id);
    if (existing) {
      if (extra.region !== undefined) existing.region = String(extra.region || '').trim();
      if (extra.baeminId !== undefined) existing.baeminId = String(extra.baeminId || '').trim();
      if (extra.coupangId !== undefined) existing.coupangId = String(extra.coupangId || '').trim();
      if (extra.phone !== undefined) existing.phone = String(extra.phone || '').trim();
      if (extra.platformBaemin !== undefined || extra.platformCoupang !== undefined) {
        const platforms = normalizePlatforms({
          baeminId: existing.baeminId,
          coupangId: existing.coupangId,
          platformBaemin: extra.platformBaemin ?? existing.platformBaemin,
          platformCoupang: extra.platformCoupang ?? existing.platformCoupang
        });
        existing.platformBaemin = platforms.platformBaemin;
        existing.platformCoupang = platforms.platformCoupang;
      }
      existing.driverName = driver.name || existing.driverName;
      existing.updatedAt = new Date().toISOString();
      return { list, persist: () => persistAll(list) };
    }
    const baeminId = extra.baeminId ?? resolveDriverPlatformId(driver, 'baemin');
    const coupangId = extra.coupangId ?? resolveDriverPlatformId(driver, 'coupang');
    const platforms = buildPlatformFields(baeminId, coupangId, extra);
    list.push({
      id: makeId(),
      driverId: driver.id,
      driverName: driver.name || '',
      baeminId,
      coupangId,
      phone: extra.phone ?? (driver.phone || ''),
      region: String(extra.region || '').trim(),
      platformBaemin: platforms.platformBaemin,
      platformCoupang: platforms.platformCoupang,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    return { list, persist: () => persistAll(list) };
  }

  async function commitEnrollDriver(driver, extra = {}) {
    const result = enrollDriver(driver, extra);
    await result.persist();
    return readAll();
  }

  function unenrollByDriverId(driverId) {
    const id = String(driverId || '').trim();
    if (!id) return { list: readAll(), persist: async () => readAll() };
    const list = readAll().filter(item => item.driverId !== id);
    return { list, persist: () => persistAll(list) };
  }

  async function commitUnenrollByDriverId(driverId) {
    const result = unenrollByDriverId(driverId);
    await result.persist();
    return readAll();
  }

  function removeByIds(ids) {
    const idSet = new Set(Array.isArray(ids) ? ids : []);
    const list = readAll().filter(item => !idSet.has(item.id));
    return { list, persist: () => persistAll(list) };
  }

  async function commitRemoveByIds(ids) {
    const result = removeByIds(ids);
    await result.persist();
    return readAll();
  }

  async function commitSaveAll(list) {
    await persistAll(list);
    return readAll();
  }

  function getEnrolledDriverIdSet() {
    if (window.BremStorage?.payrollDailySettlement?.getEnrolledDriverIdSet) {
      return window.BremStorage.payrollDailySettlement.getEnrolledDriverIdSet();
    }
    return new Set(readAll().map(item => item.driverId).filter(Boolean));
  }

  function getRegionByDriverId(driverId) {
    if (window.BremStorage?.payrollDailySettlement?.getRegionByDriverId) {
      return window.BremStorage.payrollDailySettlement.getRegionByDriverId(driverId);
    }
    const item = readAll().find(row => row.driverId === driverId);
    return item?.region || '';
  }

  function readRegions() {
    if (window.BremStorage?.payrollDailySettlement?.getRegions) {
      return window.BremStorage.payrollDailySettlement.getRegions();
    }
    const seen = new Set();
    readAll().forEach(item => {
      const region = String(item.region || '').trim();
      if (region) seen.add(region);
    });
    return [...seen].sort((a, b) => a.localeCompare(b, 'ko'));
  }

  function readRegionOptions() {
    if (window.BremStorage?.payrollDailySettlement?.getRegionOptions) {
      return window.BremStorage.payrollDailySettlement.getRegionOptions();
    }
    return readRegions();
  }

  async function addRegion(name) {
    if (window.BremStorage?.payrollDailySettlement?.addRegion) {
      return window.BremStorage.payrollDailySettlement.addRegion(name);
    }
    return readRegions();
  }

  async function removeRegion(name) {
    if (window.BremStorage?.payrollDailySettlement?.removeRegion) {
      return window.BremStorage.payrollDailySettlement.removeRegion(name);
    }
    return readRegions();
  }

  function getByRegion(regionName) {
    if (window.BremStorage?.payrollDailySettlement?.getByRegion) {
      return window.BremStorage.payrollDailySettlement.getByRegion(regionName);
    }
    const region = String(regionName || '').trim();
    const list = readAll();
    if (!region || region === '__all__') return list;
    if (region === '__unset__') return list.filter(item => !String(item.region || '').trim());
    return list.filter(item => String(item.region || '').trim() === region);
  }

  function templateRows() {
    return [
      ['A 배민아이디', 'B 쿠팡아이디', 'C 전화번호(참고)', 'D 지역(참고)'],
      ['bm_sample01', '', '01012345678', '강남'],
      ['', '홍길동01098765432', '01098765432', '서초']
    ];
  }

  function exportRowsToExcel(rows, filename, sheetName = '일정산') {
    if (!window.XLSX) {
      throw new Error('엑셀 라이브러리를 불러오지 못했습니다.');
    }
    const list = Array.isArray(rows) ? rows : [];
    const data = [
      ['번호', '기사명', '배민ID', '쿠팡ID', '전화', '지역', '배민', '쿠팡', '플랫폼'],
      ...list.map((item, index) => {
        const platforms = normalizePlatforms(item);
        return [
          index + 1,
          item.driverName || '',
          item.baeminId || '',
          item.coupangId || '',
          item.phone || '',
          item.region || '',
          platforms.platformBaemin ? 'Y' : '',
          platforms.platformCoupang ? 'Y' : '',
          platformLabel(item)
        ];
      })
    ];
    const worksheet = window.XLSX.utils.aoa_to_sheet(data);
    const workbook = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    window.XLSX.writeFile(workbook, filename);
  }

  window.BremPayrollDailySettlementAdmin = Object.freeze({
    STORAGE_KEY,
    readAll,
    writeAll,
    persistAll,
    matchDriver,
    parseBulkRows,
    upsertFromBulk,
    applyBulkPersist,
    enrollDriver,
    commitEnrollDriver,
    unenrollByDriverId,
    commitUnenrollByDriverId,
    removeByIds,
    commitRemoveByIds,
    commitSaveAll,
    getEnrolledDriverIdSet,
    getRegionByDriverId,
    readRegions,
    readRegionOptions,
    addRegion,
    removeRegion,
    getByRegion,
    normalizePlatforms,
    platformLabel,
    exportRowsToExcel,
    templateRows,
    resolveDriverPlatformId
  });
})();
