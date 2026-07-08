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

  const tables = ['riders', 'settings', 'profiles', 'notices', 'promotions'];
  const counts = {};
  let failed = 0;

  for (const table of tables) {
    try {
      const { count, error } = await withTimeout(
        supabase.from(table).select('*', { count: 'exact', head: true }),
        15000
      );
      if (error) throw error;
      counts[table] = count ?? 0;
    } catch {
      counts[table] = null;
      failed += 1;
    }
  }

  res.status(200).json({
    ok: failed < tables.length,
    counts,
    message: failed
      ? '일부 테이블 조회가 지연되고 있습니다. 데이터 삭제가 아니라 Supabase 응답 지연일 수 있습니다.'
      : '데이터가 Supabase에 존재합니다.',
    checkedAt: new Date().toISOString()
  });
};
