const { getServiceClient } = require('./admin-bootstrap');
const {
  DEFAULT_WEEKDAY_QUOTA,
  cloneDefaultWeekdayQuota,
  normalizeWeekdayQuotaMatrix
} = require('./baemin-quota');

const WEEKDAY_QUOTA_KEY = 'baemin_weekday_quota_matrix';

async function readWeekdayQuotaMatrix() {
  const supabase = getServiceClient();
  if (!supabase) return cloneDefaultWeekdayQuota();
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', WEEKDAY_QUOTA_KEY)
    .maybeSingle();
  if (error) throw new Error(error.message || '요일별 할당을 불러오지 못했습니다.');
  if (!data?.value) return cloneDefaultWeekdayQuota();
  return normalizeWeekdayQuotaMatrix(data.value);
}

async function saveWeekdayQuotaMatrix(matrix, updatedBy = '') {
  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }
  const normalized = normalizeWeekdayQuotaMatrix(matrix);
  const payload = {
    ...normalized,
    _meta: {
      updatedAt: new Date().toISOString(),
      updatedBy: String(updatedBy || '').trim()
    }
  };
  const { error } = await supabase.from('settings').upsert({
    key: WEEKDAY_QUOTA_KEY,
    value: payload,
    description: '배민현황 1세트 요일별 할당 (월~일 × 시간대)',
    updated_at: new Date().toISOString()
  }, { onConflict: 'key' });
  if (error) {
    return { ok: false, status: 500, error: error.message || '요일별 할당 저장에 실패했습니다.' };
  }
  return {
    ok: true,
    matrix: normalized,
    updatedAt: payload._meta.updatedAt,
    updatedBy: payload._meta.updatedBy
  };
}

async function getWeekdayQuotaForAdmin() {
  try {
    const supabase = getServiceClient();
    let updatedAt = null;
    let updatedBy = '';
    let matrix = cloneDefaultWeekdayQuota();
    if (supabase) {
      const { data, error } = await supabase
        .from('settings')
        .select('value, updated_at')
        .eq('key', WEEKDAY_QUOTA_KEY)
        .maybeSingle();
      if (error) {
        return { ok: false, status: 500, error: error.message || '요일별 할당 조회 실패' };
      }
      if (data?.value) {
        const raw = data.value;
        matrix = normalizeWeekdayQuotaMatrix(raw);
        updatedAt = String(raw?._meta?.updatedAt || data.updated_at || '').trim() || null;
        updatedBy = String(raw?._meta?.updatedBy || '').trim();
      }
    }
    return {
      ok: true,
      matrix,
      defaults: cloneDefaultWeekdayQuota(),
      updatedAt,
      updatedBy,
      isDefault: !updatedAt
    };
  } catch (error) {
    return { ok: false, status: 500, error: error.message || '요일별 할당 조회 실패' };
  }
}

async function saveWeekdayQuotaForAdmin(matrix, updatedBy = '') {
  return saveWeekdayQuotaMatrix(matrix, updatedBy);
}

module.exports = {
  WEEKDAY_QUOTA_KEY,
  DEFAULT_WEEKDAY_QUOTA,
  readWeekdayQuotaMatrix,
  saveWeekdayQuotaMatrix,
  getWeekdayQuotaForAdmin,
  saveWeekdayQuotaForAdmin
};
