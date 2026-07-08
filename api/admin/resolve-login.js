'use strict';

const { resolveAdminLoginEmail } = require('../../server/admin-auth');

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message || 'timeout')), ms);
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

  const login = req.query?.login || req.query?.name || '';
  try {
    const result = await withTimeout(
      resolveAdminLoginEmail(login),
      8000,
      '로그인 조회 시간 초과'
    );
    if (!result.ok) {
      res.status(result.status || 400).json({ error: result.error });
      return;
    }
    res.status(200).json({ ok: true, email: result.email });
  } catch (error) {
    res.status(504).json({ error: error.message || '로그인 조회 시간 초과' });
  }
};
