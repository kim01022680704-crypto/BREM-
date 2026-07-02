const { getServiceClient } = require('./admin-bootstrap');
const { extractPartnerRegionKey } = require('./baemin-partner-match');

const PARTNER_REGION_MAP_KEY = 'baemin_partner_region_map';

function normalizePartnerId(partnerId) {
  return String(partnerId || '').trim().toUpperCase();
}

function formatRegionDisplay(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  return text
    .replace(/([가-힣])([a-z])(?=[가-힣]|$)/gi, (_, kor, letter) => `${kor}${letter.toUpperCase()}`)
    .replace(/([가-힣]{2,})([a-z])$/i, (_, kor, letter) => `${kor}${letter.toUpperCase()}`);
}

function isGenericPartnerName(name) {
  const text = String(name || '').trim();
  if (!text) return true;
  if (/^DP\d{6,}$/i.test(text)) return true;
  return /^(주식회사)?팀브로$/i.test(text.replace(/\s+/g, ''));
}

function inferRegionFromPartnerName(partnerName) {
  const compact = String(partnerName || '').trim().replace(/\s+/g, '');
  if (!compact || isGenericPartnerName(compact)) return '';

  const standardMatch = compact.match(/^표준(.+?)(?:팀브로|팀|브로)?$/i);
  if (standardMatch?.[1]) {
    const region = standardMatch[1].replace(/(?:팀브로|팀|브로)$/i, '').trim();
    if (region && !isGenericPartnerName(region)) {
      return formatRegionDisplay(region);
    }
  }

  const key = extractPartnerRegionKey(compact);
  if (!key || isGenericPartnerName(key) || /^dp\d/i.test(key)) return '';
  return formatRegionDisplay(key);
}

function normalizeRegionMap(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const map = {};
  Object.entries(raw).forEach(([partnerId, regionName]) => {
    const pid = normalizePartnerId(partnerId);
    const region = String(regionName || '').trim();
    if (!/^DP\d{6,}$/.test(pid) || !region) return;
    map[pid] = region;
  });
  return map;
}

async function readPartnerRegionMap() {
  const supabase = getServiceClient();
  if (!supabase) return {};
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', PARTNER_REGION_MAP_KEY)
    .maybeSingle();
  if (error) throw new Error(error.message || '협력사 지역 매핑을 불러오지 못했습니다.');
  return normalizeRegionMap(data?.value);
}

async function savePartnerRegionMap(map, updatedBy = '') {
  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }
  const normalized = normalizeRegionMap(map);
  const { error } = await supabase.from('settings').upsert({
    key: PARTNER_REGION_MAP_KEY,
    value: normalized,
    description: '배민현황 DP코드 → 지역명 매핑',
    updated_at: new Date().toISOString()
  }, { onConflict: 'key' });
  if (error) {
    return { ok: false, status: 500, error: error.message || '협력사 지역 매핑 저장에 실패했습니다.' };
  }
  return { ok: true, map: normalized };
}

function resolvePartnerDisplay(partnerId, partnerName = '', parsedRegion = '', regionMap = null) {
  const pid = normalizePartnerId(partnerId);
  const name = String(partnerName || '').trim();
  const saved = regionMap?.[pid] || '';
  const parsed = String(parsedRegion || '').trim();
  const inferred = inferRegionFromPartnerName(name);
  const regionName = saved || parsed || inferred || '';
  const displayName = regionName || (isGenericPartnerName(name) ? pid : name) || pid;
  return {
    partnerId: pid,
    partnerName: name || pid,
    regionName,
    displayName
  };
}

async function getPartnerRegionMapForAdmin() {
  try {
    const map = await readPartnerRegionMap();
    const items = Object.entries(map)
      .map(([partnerId, regionName]) => ({ partnerId, regionName }))
      .sort((a, b) => String(a.regionName).localeCompare(String(b.regionName), 'ko'));
    return { ok: true, map, items, count: items.length };
  } catch (error) {
    return { ok: false, status: 500, error: error.message || '협력사 지역 매핑 조회 실패' };
  }
}

async function upsertPartnerRegionEntry(partnerId, regionName, updatedBy = '') {
  const pid = normalizePartnerId(partnerId);
  const region = String(regionName || '').trim();
  if (!/^DP\d{6,}$/.test(pid)) {
    return { ok: false, status: 400, error: 'DP 코드 형식이 올바르지 않습니다.' };
  }
  if (!region) {
    return { ok: false, status: 400, error: '지역명을 입력하세요.' };
  }
  const map = await readPartnerRegionMap();
  map[pid] = region;
  const saved = await savePartnerRegionMap(map, updatedBy);
  if (!saved.ok) return saved;
  return { ok: true, partnerId: pid, regionName: region, map: saved.map };
}

async function deletePartnerRegionEntry(partnerId) {
  const pid = normalizePartnerId(partnerId);
  if (!/^DP\d{6,}$/.test(pid)) {
    return { ok: false, status: 400, error: 'DP 코드 형식이 올바르지 않습니다.' };
  }
  const map = await readPartnerRegionMap();
  if (!map[pid]) {
    return { ok: true, map, removed: false };
  }
  delete map[pid];
  const saved = await savePartnerRegionMap(map);
  if (!saved.ok) return saved;
  return { ok: true, map: saved.map, removed: true };
}

module.exports = {
  PARTNER_REGION_MAP_KEY,
  formatRegionDisplay,
  inferRegionFromPartnerName,
  readPartnerRegionMap,
  savePartnerRegionMap,
  resolvePartnerDisplay,
  getPartnerRegionMapForAdmin,
  upsertPartnerRegionEntry,
  deletePartnerRegionEntry
};
