'use strict';

const adminAuth = require('../../server/admin-auth');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const login = body.login;
  const password = body.password;

  try {
    const result = await adminAuth.signInAdmin(login, password);
    if (!result.ok) {
      res.status(result.status || 400).json({ error: result.error });
      return;
    }
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || '관리자 로그인에 실패했습니다.' });
  }
};
