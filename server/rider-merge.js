function normalizeDriverName(value) {
  return String(value || '').replace(/\s/g, '').toLowerCase();
}

function normalizePhone(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function makeDriverMatchKey(name, phone) {
  const normName = normalizeDriverName(name);
  const normPhone = normalizePhone(phone);
  if (!normName || !normPhone) return '';
  return `${normName}|${normPhone}`;
}

function riderCompletenessScore(row) {
  let score = 0;
  if (String(row.long_event_item || '').trim()) score += 8;
  if (String(row.baemin_id || '').trim()) score += 4;
  if (String(row.bank_name || '').trim()) score += 2;
  if (String(row.account_number || '').trim()) score += 1;
  if (row.auth_user_id) score += 16;
  const updatedAt = Date.parse(row.updated_at || row.created_at || 0);
  if (!Number.isNaN(updatedAt)) score += updatedAt / 1e12;
  return score;
}

function pickCanonicalRider(rows) {
  return [...rows].sort((a, b) => {
    const scoreDiff = riderCompletenessScore(b) - riderCompletenessScore(a);
    if (scoreDiff !== 0) return scoreDiff;
    const createdA = Date.parse(a.created_at || 0);
    const createdB = Date.parse(b.created_at || 0);
    if (!Number.isNaN(createdA) && !Number.isNaN(createdB) && createdA !== createdB) {
      return createdA - createdB;
    }
    return String(a.id).localeCompare(String(b.id));
  })[0];
}

function mergeStringField(target, source, field) {
  if (!String(target[field] || '').trim() && String(source[field] || '').trim()) {
    target[field] = source[field];
  }
}

function mergeRiderRows(keep, donor) {
  const merged = { ...keep };

  [
    'name', 'phone', 'resident_number', 'bank_name', 'account_holder', 'account_number',
    'baemin_id', 'memo', 'long_event_item_id', 'long_event_item',
    'promotion_selector_coupang', 'promotion_selector_baemin',
    'promotion_rule_id_coupang', 'promotion_rule_id_baemin',
    'selected_mission_id', 'selected_mission_id_baemin', 'selected_mission_id_coupang'
  ].forEach(field => mergeStringField(merged, donor, field));

  if (donor.platform_baemin) merged.platform_baemin = true;
  if (donor.platform_coupang === false && merged.platform_coupang !== false) {
    merged.platform_coupang = donor.platform_coupang;
  }

  if (!merged.long_event_start_date && donor.long_event_start_date) {
    merged.long_event_start_date = donor.long_event_start_date;
  }
  if (!merged.join_date && donor.join_date) {
    merged.join_date = donor.join_date;
  }

  if (!merged.auth_user_id && donor.auth_user_id) {
    merged.auth_user_id = donor.auth_user_id;
  }

  const keepHidden = keep.hidden_fields && typeof keep.hidden_fields === 'object' ? keep.hidden_fields : {};
  const donorHidden = donor.hidden_fields && typeof donor.hidden_fields === 'object' ? donor.hidden_fields : {};
  merged.hidden_fields = { ...donorHidden, ...keepHidden };

  merged.updated_at = new Date().toISOString();
  return merged;
}

function groupDuplicateRiders(rows) {
  const groups = new Map();

  (rows || []).forEach(row => {
    const key = makeDriverMatchKey(row.name, row.phone);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });

  return [...groups.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([matchKey, members]) => ({ matchKey, members }));
}

async function fetchAllRiders(supabase, selectColumns) {
  const all = [];
  let offset = 0;
  const limit = 200;

  while (true) {
    const { data, error, count } = await supabase
      .from('riders')
      .select(selectColumns, { count: 'exact' })
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    all.push(...(data || []));
    const total = count ?? all.length;
    if (!data?.length || all.length >= total) break;
    offset += limit;
  }

  return all;
}

async function mergeDuplicateRiders(accessToken, options, deps = {}) {
  const verifyAdminCaller = deps.verifyAdminCaller;
  const getServiceClient = deps.getServiceClient;
  const riderToRow = deps.riderToRow;
  const provisionRiderAuthAccount = deps.provisionRiderAuthAccount;
  const selectColumns = deps.selectColumns;

  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const dryRun = Boolean(options.dryRun);
  const supabase = getServiceClient();
  const allRows = await fetchAllRiders(supabase, selectColumns);
  const duplicateGroups = groupDuplicateRiders(allRows);

  if (!duplicateGroups.length) {
    return {
      ok: true,
      dryRun,
      duplicateGroups: 0,
      ridersMerged: 0,
      ridersRemoved: 0,
      idRemap: {},
      details: []
    };
  }

  const idRemap = {};
  const details = [];
  const rowsToUpsert = [];
  const idsToDelete = [];

  duplicateGroups.forEach(({ matchKey, members }) => {
    const canonical = pickCanonicalRider(members);
    let merged = { ...canonical };
    const removedIds = [];

    members.forEach(member => {
      if (member.id === canonical.id) return;
      merged = mergeRiderRows(merged, member);
      idRemap[member.id] = canonical.id;
      removedIds.push(member.id);
      idsToDelete.push(member.id);
    });

    rowsToUpsert.push(merged);

    details.push({
      matchKey,
      keptId: canonical.id,
      keptName: canonical.name,
      keptPhone: canonical.phone,
      removedIds,
      memberCount: members.length
    });
  });

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      duplicateGroups: duplicateGroups.length,
      ridersMerged: rowsToUpsert.length,
      ridersRemoved: idsToDelete.length,
      idRemap,
      details
    };
  }

  for (const [fromId, toId] of Object.entries(idRemap)) {
    const { error } = await supabase
      .from('profiles')
      .update({ rider_id: toId })
      .eq('rider_id', fromId);
    if (error) {
      return { ok: false, status: 500, error: error.message || '프로필 기사 ID 갱신에 실패했습니다.' };
    }
  }

  if (rowsToUpsert.length) {
    let { error } = await supabase.from('riders').upsert(rowsToUpsert, { onConflict: 'id' });
    if (error) {
      return { ok: false, status: 400, error: error.message || '병합된 기사 저장에 실패했습니다.' };
    }
  }

  for (const id of idsToDelete) {
    const { error } = await supabase.from('riders').delete().eq('id', id);
    if (error) {
      return { ok: false, status: 400, error: error.message || `중복 기사 삭제에 실패했습니다. (${id})` };
    }
  }

  if (typeof provisionRiderAuthAccount === 'function') {
    for (const row of rowsToUpsert) {
      const provision = await provisionRiderAuthAccount(row);
      if (!provision.ok) {
        console.warn('[BREM] Rider auth provisioning failed after merge:', row.id, provision.error);
      }
    }
  }

  return {
    ok: true,
    dryRun: false,
    duplicateGroups: duplicateGroups.length,
    ridersMerged: rowsToUpsert.length,
    ridersRemoved: idsToDelete.length,
    idRemap,
    details
  };
}

module.exports = {
  makeDriverMatchKey,
  groupDuplicateRiders,
  mergeDuplicateRiders
};
