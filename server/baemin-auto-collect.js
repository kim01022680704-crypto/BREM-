const { getServiceClient } = require('./admin-bootstrap');
const { runFullCollectPipeline, getLatestMenuCollectStatus, getBizCollectTableStatus } = require('./baemin-collect-pipeline');

const AUTO_COLLECT_SETTINGS_KEY = 'brem_baemin_auto_collect_status';
const DEFAULT_SCHEDULE = ['10:00', '14:00', '17:00', '20:00', '23:30'];
const KST_TIMEZONE = 'Asia/Seoul';

function getKSTDateTimeParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: KST_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = {};
  formatter.formatToParts(date).forEach(part => {
    if (part.type !== 'literal') parts[part.type] = part.value;
  });
  return parts;
}

function todayDateStringKST(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: KST_TIMEZONE }).format(date);
}

function normalizeSchedule(schedule) {
  const list = Array.isArray(schedule) ? schedule : DEFAULT_SCHEDULE;
  return list
    .map(slot => String(slot || '').trim())
    .filter(Boolean)
    .map(slot => {
      const match = slot.match(/^(\d{1,2}):(\d{2})$/);
      if (!match) return null;
      return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
    })
    .filter(Boolean)
    .sort();
}

async function readSettingsValue(key) {
  const supabase = getServiceClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error) throw new Error(error.message || '설정을 불러오지 못했습니다.');
  return data?.value ?? null;
}

async function writeSettingsValue(key, value, description) {
  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }
  const { error } = await supabase.from('settings').upsert({
    key,
    value,
    description: description || key,
    updated_at: new Date().toISOString()
  }, { onConflict: 'key' });
  if (error) {
    return { ok: false, status: 500, error: error.message || '설정 저장에 실패했습니다.' };
  }
  return { ok: true };
}

async function getAutoCollectRecord() {
  const raw = await readSettingsValue(AUTO_COLLECT_SETTINGS_KEY);
  const schedule = normalizeSchedule(raw?.schedule || DEFAULT_SCHEDULE);
  return {
    schedule,
    enabled: raw?.enabled !== false,
    lastRunAt: raw?.lastRunAt || null,
    lastStatus: raw?.lastStatus || null,
    lastError: raw?.lastError || '',
    lastCaptureDate: raw?.lastCaptureDate || null,
    lastSavedCount: Number(raw?.lastSavedCount || 0),
    lastTotalCompleteSum: Number(raw?.lastTotalCompleteSum || 0),
    nextScheduledAt: raw?.nextScheduledAt || null,
    localServerLastSeenAt: raw?.localServerLastSeenAt || null,
    sessionPaused: Boolean(raw?.sessionPaused),
    source: raw?.source || 'local_scheduler'
  };
}

async function updateAutoCollectRecord(patch = {}) {
  const current = await getAutoCollectRecord();
  const next = {
    ...current,
    ...patch,
    schedule: normalizeSchedule(patch.schedule || current.schedule),
    updatedAt: new Date().toISOString()
  };
  const saved = await writeSettingsValue(
    AUTO_COLLECT_SETTINGS_KEY,
    next,
    'Baemin Biz auto-collect scheduler status (server-only)'
  );
  if (!saved.ok) return saved;
  return { ok: true, record: next };
}

function kstDateTimeToUtcIso(year, month, day, hour, minute) {
  const utcMs = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour) - 9, Number(minute), 0, 0);
  return new Date(utcMs).toISOString();
}

function addDaysToKSTParts(parts, days) {
  const utcMs = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) - 9, Number(parts.minute), 0, 0);
  const next = new Date(utcMs + days * 24 * 60 * 60 * 1000);
  return getKSTDateTimeParts(next);
}

function computeNextScheduledAt(schedule = DEFAULT_SCHEDULE, fromDate = new Date()) {
  const normalized = normalizeSchedule(schedule);
  if (!normalized.length) return null;

  const parts = getKSTDateTimeParts(fromDate);
  const currentMinutes = Number(parts.hour) * 60 + Number(parts.minute);

  for (const slot of normalized) {
    const [hourText, minuteText] = slot.split(':');
    const slotMinutes = Number(hourText) * 60 + Number(minuteText);
    if (slotMinutes > currentMinutes) {
      return kstDateTimeToUtcIso(parts.year, parts.month, parts.day, hourText, minuteText);
    }
  }

  const first = normalized[0].split(':');
  const tomorrow = addDaysToKSTParts(parts, 1);
  return kstDateTimeToUtcIso(tomorrow.year, tomorrow.month, tomorrow.day, first[0], first[1]);
}

function getCurrentKSTSlot(schedule = DEFAULT_SCHEDULE, now = new Date()) {
  const normalized = normalizeSchedule(schedule);
  const parts = getKSTDateTimeParts(now);
  const current = `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
  if (!normalized.includes(current)) return null;
  return `${parts.year}-${parts.month}-${parts.day}_${current}`;
}

async function touchLocalServerHeartbeat(extra = {}) {
  const nextScheduledAt = computeNextScheduledAt(extra.schedule || DEFAULT_SCHEDULE);
  return updateAutoCollectRecord({
    localServerLastSeenAt: new Date().toISOString(),
    nextScheduledAt,
    ...extra
  });
}

async function recordFailedRun({
  error,
  sessionExpired = false,
  captureDate,
  source = 'local_scheduler'
}) {
  const record = await getAutoCollectRecord();
  const nextScheduledAt = computeNextScheduledAt(record.schedule);
  return updateAutoCollectRecord({
    lastRunAt: new Date().toISOString(),
    lastStatus: 'failed',
    lastError: String(error || '자동 수집 실패'),
    lastCaptureDate: captureDate || todayDateStringKST(),
    sessionPaused: sessionExpired,
    nextScheduledAt,
    source
  });
}

async function recordSuccessfulRun({
  captureDate,
  savedCount,
  totalCompleteSum,
  source = 'local_scheduler'
}) {
  const record = await getAutoCollectRecord();
  const nextScheduledAt = computeNextScheduledAt(record.schedule);
  return updateAutoCollectRecord({
    lastRunAt: new Date().toISOString(),
    lastStatus: 'success',
    lastError: '',
    lastCaptureDate: captureDate,
    lastSavedCount: Number(savedCount || 0),
    lastTotalCompleteSum: Number(totalCompleteSum || 0),
    sessionPaused: false,
    nextScheduledAt,
    source
  });
}

async function clearSessionPause() {
  return updateAutoCollectRecord({ sessionPaused: false, lastError: '' });
}

async function runAutoCollectJob(options = {}) {
  const captureDate = String(options.captureDate || todayDateStringKST()).slice(0, 10);
  const source = String(options.source || 'local_scheduler').trim();
  const sessionCookie = String(options.sessionCookie || '').trim();

  const pipelineResult = await runFullCollectPipeline({
    collectDate: captureDate,
    source,
    sessionCookie: sessionCookie || undefined
  });
  const deliveryResult = pipelineResult.results?.delivery_status;

  if (!pipelineResult.ok) {
    const sessionExpired = Boolean(pipelineResult.sessionExpired);
    const result = await recordFailedRun({
      error: pipelineResult.message || '자동 수집 실패',
      sessionExpired,
      captureDate,
      source
    });
    return {
      ok: false,
      message: pipelineResult.message,
      sessionExpired,
      results: pipelineResult.results,
      record: result.record
    };
  }

  const savedCount = Number(pipelineResult.savedTotal || deliveryResult?.savedCount || 0);
  const totalCompleteSum = Number(
    deliveryResult?.rawItems?.reduce((sum, item) => {
      const acceptance = item?.deliveryAcceptanceCount || {};
      return sum + Number(acceptance.totalComplete || 0);
    }, 0) || 0
  );

  const result = await recordSuccessfulRun({
    captureDate,
    savedCount,
    totalCompleteSum,
    source
  });

  return {
    ok: true,
    captureDate,
    savedCount,
    totalCompleteSum,
    results: pipelineResult.results,
    sessionExpired: false,
    record: result.record
  };
}

function getBaeminSessionModule() {
  return require('./baemin-delivery-session');
}

async function getAutoCollectStatusForAdmin() {
  const record = await getAutoCollectRecord();
  const session = await getBaeminSessionModule().getStoredSessionRecord();
  const nextScheduledAt = record.nextScheduledAt || computeNextScheduledAt(record.schedule);
  const localSeenAt = record.localServerLastSeenAt ? Date.parse(record.localServerLastSeenAt) : 0;
  const localServerRecentlyActive = localSeenAt > 0 && (Date.now() - localSeenAt) < 2 * 60 * 1000;
  const menuStatus = await getLatestMenuCollectStatus(record.lastCaptureDate || todayDateStringKST());

  return {
    schedule: record.schedule,
    enabled: record.enabled,
    lastRunAt: record.lastRunAt,
    lastStatus: record.lastStatus,
    lastError: record.lastError,
    lastCaptureDate: record.lastCaptureDate,
    lastSavedCount: record.lastSavedCount,
    lastTotalCompleteSum: record.lastTotalCompleteSum,
    nextScheduledAt,
    localServerLastSeenAt: record.localServerLastSeenAt,
    localServerRecentlyActive,
    sessionPaused: record.sessionPaused || Boolean(session?.lastError),
    sessionExpired: Boolean(session?.lastError) || record.sessionPaused,
    sessionUpdatedAt: session?.updatedAt || null,
    sessionLastValidatedAt: session?.lastValidatedAt || null,
    menuStatus
  };
}

module.exports = {
  AUTO_COLLECT_SETTINGS_KEY,
  DEFAULT_SCHEDULE,
  todayDateStringKST,
  normalizeSchedule,
  getAutoCollectRecord,
  updateAutoCollectRecord,
  computeNextScheduledAt,
  getCurrentKSTSlot,
  touchLocalServerHeartbeat,
  clearSessionPause,
  runAutoCollectJob,
  getAutoCollectStatusForAdmin
};
