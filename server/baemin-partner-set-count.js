const { getServiceClient } = require('./admin-bootstrap');

const PARTNER_SET_COUNT_KEY = 'baemin_partner_set_count_map';

function normalizePartnerId(partnerId) {
  return String(partnerId || '').trim().toUpperCase();
}

function normalizeSetCount(value) {
  const num = Math.floor(Number(value));
  if (!Number.isFinite(num) || num < 1) return 0;
  return Math.min(num, 99);
}

function normalizeSetCountMap(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const map = {};
  Object.entries(raw).forEach(([partnerId, entry]) => {
    const pid = normalizePartnerId(partnerId);
    if (!/^DP\d{6,}$/.test(pid)) return;
    const setCount = normalizeSetCount(entry?.setCount ?? entry);
    if (!setCount) return;
    map[pid] = {
      setCount,
      updatedAt: String(entry?.updatedAt || '').trim() || null,
      updatedBy: String(entry?.updatedBy || '').trim() || ''
    };
  });
  return map;
}

async function readPartnerSetCountMap() {
  const supabase = getServiceClient();
  if (!supabase) return {};
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', PARTNER_SET_COUNT_KEY)
    .maybeSingle();
  if (error) throw new Error(error.message || '세트수 설정을 불러오지 못했습니다.');
  return normalizeSetCountMap(data?.value);
}

async function savePartnerSetCountMap(map, updatedBy = '') {
  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }
  const normalized = normalizeSetCountMap(map);
  const { error } = await supabase.from('settings').upsert({
    key: PARTNER_SET_COUNT_KEY,
    value: normalized,
    description: '배민현황 지역별 세트수',
    updated_at: new Date().toISOString()
  }, { onConflict: 'key' });
  if (error) {
    return { ok: false, status: 500, error: error.message || '세트수 저장에 실패했습니다.' };
  }
  return { ok: true, map: normalized, updatedBy };
}

async function getPartnerSetCountMapForAdmin() {
  try {
    const normalized = await readPartnerSetCountMap();
    const items = Object.entries(normalized).map(([partnerId, entry]) => ({
      partnerId,
      setCount: entry.setCount,
      updatedAt: entry.updatedAt,
      updatedBy: entry.updatedBy
    }));
    return { ok: true, map: normalized, items, count: items.length };
  } catch (error) {
    return { ok: false, status: 500, error: error.message || '세트수 조회 실패' };
  }
}

async function upsertPartnerSetCountEntry(partnerId, setCount, updatedBy = '') {
  const pid = normalizePartnerId(partnerId);
  const count = normalizeSetCount(setCount);
  if (!/^DP\d{6,}$/.test(pid)) {
    return { ok: false, status: 400, error: 'DP 코드 형식이 올바르지 않습니다.' };
  }
  if (!count) {
    return { ok: false, status: 400, error: '세트수는 1 이상 입력하세요.' };
  }
  const map = await readPartnerSetCountMap();
  const now = new Date().toISOString();
  map[pid] = { setCount: count, updatedAt: now, updatedBy: String(updatedBy || '').trim() };
  const saved = await savePartnerSetCountMap(map, updatedBy);
  if (!saved.ok) return saved;
  return { ok: true, partnerId: pid, setCount: count, map: saved.map, updatedAt: now };
}

module.exports = {
  PARTNER_SET_COUNT_KEY,
  normalizeSetCount,
  readPartnerSetCountMap,
  getPartnerSetCountMapForAdmin,
  upsertPartnerSetCountEntry
};
