'use strict';

const { getServiceClient } = require('../../server/admin-bootstrap');

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('timeout')), ms);
    })
  ]);
}

// 핵심 데이터 + 급여 일정산 관련 테이블을 함께 점검한다.
const HEALTH_TABLES = [
  'riders',
  'settings',
  'profiles',
  'notices',
  'promotions',
  'daily_settlements',
  'weekly_settlements',
  'admin_calls',
  'lease_contracts',
  'lease_arrears',
  'payroll_slip_lines'
];

// settings 에 JSON 배열로 저장되어 무한 증가할 수 있는 키 — 크기를 함께 리포트한다.
const SETTINGS_ARRAY_KEYS = [
  'brem_payroll_withdrawal_requests_v1',
  'brem_payroll_daily_settlement_roster_v1',
  'brem_payroll_daily_excluded_settlements_v1'
];

async function countTable(supabase, table) {
  try {
    const { count, error } = await withTimeout(
      supabase.from(table).select('*', { count: 'exact', head: true }),
      12000
    );
    if (error) throw error;
    return { table, count: count ?? 0, ok: true };
  } catch (err) {
    return { table, count: null, ok: false, error: err?.message || 'error' };
  }
}

async function inspectSettingsArray(supabase, key) {
  try {
    const { data, error } = await withTimeout(
      supabase.from('settings').select('value').eq('key', key).maybeSingle(),
      12000
    );
    if (error) throw error;
    const value = data?.value;
    const length = Array.isArray(value) ? value.length : (value == null ? 0 : -1);
    const bytes = value == null ? 0 : Buffer.byteLength(JSON.stringify(value), 'utf8');
    return { key, length, bytes, ok: true };
  } catch (err) {
    return { key, length: null, bytes: null, ok: false, error: err?.message || 'error' };
  }
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const supabase = getServiceClient();
  if (!supabase) {
    res.status(503).json({ ok: false, error: 'Supabase not configured' });
    return;
  }

  // 순차 대기(테이블당 15s)로 최대 수십 초 걸리던 것을 병렬 실행으로 단축한다.
  const [tableResults, settingsResults] = await Promise.all([
    Promise.all(HEALTH_TABLES.map(table => countTable(supabase, table))),
    Promise.all(SETTINGS_ARRAY_KEYS.map(key => inspectSettingsArray(supabase, key)))
  ]);

  const counts = {};
  let failed = 0;
  tableResults.forEach(result => {
    counts[result.table] = result.ok ? result.count : null;
    if (!result.ok) failed += 1;
  });

  const settingsBlobs = {};
  settingsResults.forEach(result => {
    settingsBlobs[result.key] = result.ok
      ? { length: result.length, bytes: result.bytes }
      : { length: null, bytes: null, error: result.error };
  });

  // 출금신청 배열이 과도하게 커지면 읽기/쓰기가 느려지고 경합 위험이 커진다.
  const requestsBlob = settingsBlobs['brem_payroll_withdrawal_requests_v1'];
  const warnings = [];
  if (requestsBlob && Number(requestsBlob.bytes) > 512 * 1024) {
    warnings.push('출금신청 데이터(brem_payroll_withdrawal_requests_v1)가 512KB를 초과합니다. 오래된 처리완료/취소 건 정리(아카이브)를 권장합니다.');
  }

  res.status(200).json({
    ok: failed < tableResults.length,
    counts,
    settingsBlobs,
    warnings,
    message: failed
      ? '일부 테이블 조회가 지연되고 있습니다. 데이터 삭제가 아니라 Supabase 응답 지연일 수 있습니다.'
      : '데이터가 Supabase에 존재합니다.',
    checkedAt: new Date().toISOString()
  });
};
