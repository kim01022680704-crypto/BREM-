const { getServiceClient } = require('./admin-bootstrap');
const { verifyAdminCaller } = require('./admin-users');

const ALLOWED_TABLES = new Set([
  'lease_vehicles',
  'lease_contracts',
  'lease_payments',
  'lease_accidents',
  'lease_maintenance',
  'lease_profit_logs',
  'lease_arrears'
]);

const LEASE_VEHICLE_OPTIONAL_COLUMNS = [
  'unpaid_days',
  'payment_check',
  'unpaid_collection_method',
  'acquisition_tax_rate',
  'acquisition_tax_amount',
  'other_acquisition_cost',
  'total_acquisition_cost'
];

function isMissingLeaseVehicleColumnError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('lease_vehicles')
    && (
      message.includes('schema cache')
      || message.includes('could not find')
      || message.includes('does not exist')
    );
}

function stripOptionalLeaseVehicleColumns(row) {
  const next = { ...row };
  LEASE_VEHICLE_OPTIONAL_COLUMNS.forEach(key => {
    delete next[key];
  });
  return next;
}

async function upsertRowsInChunks(supabase, tableName, rows, chunkSize = 200) {
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    let payload = chunk;
    let { error } = await supabase.from(tableName).upsert(payload, { onConflict: 'id' });
    if (error && tableName === 'lease_vehicles' && isMissingLeaseVehicleColumnError(error)) {
      payload = chunk.map(stripOptionalLeaseVehicleColumns);
      ({ error } = await supabase.from(tableName).upsert(payload, { onConflict: 'id' }));
    }
    if (error) throw error;
  }
}

async function deleteRowsInChunks(supabase, tableName, ids, chunkSize = 200) {
  if (!ids.length) return;
  for (let index = 0; index < ids.length; index += chunkSize) {
    const chunk = ids.slice(index, index + chunkSize);
    const { error } = await supabase.from(tableName).delete().in('id', chunk);
    if (error) throw error;
  }
}

async function upsertLeaseErpRows(accessToken, payload = {}) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const table = String(payload.table || '').trim();
  if (!ALLOWED_TABLES.has(table)) {
    return { ok: false, status: 400, error: '지원하지 않는 리스 ERP 테이블입니다.' };
  }

  const rows = Array.isArray(payload.rows) ? payload.rows.filter(row => row?.id) : [];
  const deletedIds = Array.isArray(payload.deletedIds)
    ? payload.deletedIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  try {
    if (rows.length) {
      await upsertRowsInChunks(supabase, table, rows);
    }
    if (deletedIds.length) {
      await deleteRowsInChunks(supabase, table, deletedIds);
    }
    return { ok: true, upserted: rows.length, deleted: deletedIds.length };
  } catch (error) {
    return {
      ok: false,
      status: 400,
      error: error.message || '리스 ERP 데이터 저장에 실패했습니다.'
    };
  }
}

module.exports = {
  upsertLeaseErpRows
};
