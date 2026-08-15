/**
 * PostgREST 페이지네이션 헬퍼.
 * soft .limit(N) 으로 조용히 잘리는 대신, 필요한 행을 끝까지 모은다.
 */
async function fetchAllPages(buildQuery, options = {}) {
  const pageSize = Math.max(1, Number(options.pageSize) || 1000);
  const maxRows = Math.max(pageSize, Number(options.maxRows) || 200000);
  const rows = [];
  let offset = 0;

  while (offset < maxRows) {
    const result = await buildQuery(offset, pageSize);
    if (result?.error) throw result.error;
    const batch = Array.isArray(result?.data) ? result.data : [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }

  return rows;
}

async function upsertInChunks(supabase, table, rows, options = {}) {
  if (!rows?.length) return 0;
  const chunkSize = Math.max(1, Number(options.chunkSize) || 400);
  const onConflict = options.onConflict || 'id';
  let total = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict });
    if (error) throw error;
    total += chunk.length;
  }
  return total;
}

module.exports = {
  fetchAllPages,
  upsertInChunks
};
