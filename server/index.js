require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { parseSettlementFile } = require('./settlement-parser');
const riderInquiriesStore = require('./rider-inquiries-store');
const riderInquiriesSupabase = require('./rider-inquiries-supabase');
const adminBootstrap = require('./admin-bootstrap');
const adminUsers = require('./admin-users');
const adminAuth = require('./admin-auth');
const { getPublicConfig } = require('./public-config');
const app = express();
const PORT = process.env.PORT || 3000;
const ROOT_DIR = path.join(__dirname, '..');
const isProduction = process.env.NODE_ENV === 'production';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const allowed = /\.xlsx$/i.test(file.originalname);
    if (!allowed) {
      cb(new Error('xlsx 파일만 업로드할 수 있습니다.'));
      return;
    }
    cb(null, true);
  }
});

app.disable('x-powered-by');

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  if (/\.(css|js|png|jpg|jpeg|webp|svg|ico|woff2?)$/i.test(req.path)) {
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  }
  return next();
});

function useSupabaseInquiries() {
  return riderInquiriesSupabase.isEnabled();
}

app.get('/api/public-config', (req, res) => {
  res.json(getPublicConfig());
});

app.post('/api/admin/sign-in', async (req, res) => {
  try {
    const { login, password } = req.body || {};
    const result = await adminAuth.signInAdmin(login, password);
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || '관리자 로그인에 실패했습니다.' });
  }
});

app.post('/api/admin/ensure-profile', async (req, res) => {
  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return res.status(401).json({ error: 'Authorization Bearer 토큰이 필요합니다.' });
    }

    const config = getPublicConfig();
    const result = await adminBootstrap.ensureInitialAdminFromToken(token, config.initialAdmin.email);
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || '관리자 profiles 연결에 실패했습니다.' });
  }
});

function getBearerToken(req) {
  return String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
}

app.get('/api/admin/users/me', async (req, res) => {
  try {
    const result = await adminUsers.getMyAdminAccount(getBearerToken(req));
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json({ ok: true, account: result.account });
  } catch (error) {
    res.status(500).json({ error: error.message || '관리자 계정 정보를 불러오지 못했습니다.' });
  }
});

app.get('/api/admin/users', async (req, res) => {
  try {
    const result = await adminUsers.listAdminUsers(getBearerToken(req));
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json({ ok: true, accounts: result.accounts });
  } catch (error) {
    res.status(500).json({ error: error.message || '관리자 계정 목록을 불러오지 못했습니다.' });
  }
});

app.post('/api/admin/users', async (req, res) => {
  try {
    const result = await adminUsers.createAdminUser(getBearerToken(req), req.body || {});
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || '관리자 계정 생성에 실패했습니다.' });
  }
});

app.patch('/api/admin/users/:userId', async (req, res) => {
  try {
    const result = await adminUsers.updateAdminUser(getBearerToken(req), req.params.userId, req.body || {});
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || '관리자 계정 수정에 실패했습니다.' });
  }
});

app.delete('/api/admin/users/:userId', async (req, res) => {
  try {
    const result = await adminUsers.deleteAdminUser(getBearerToken(req), req.params.userId);
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || '관리자 계정 삭제에 실패했습니다.' });
  }
});

app.get('/api/rider-inquiries', async (req, res) => {
  try {
    if (useSupabaseInquiries()) {
      return res.json(await riderInquiriesSupabase.readAll());
    }
    res.json(riderInquiriesStore.readAll());
  } catch (error) {
    res.status(500).json({ error: error.message || '문의 목록을 불러오지 못했습니다.' });
  }
});

app.post('/api/rider-inquiries', async (req, res) => {
  try {
    const { name, phone, area, inquiryType, message } = req.body || {};
    if (!String(name || '').trim() || !String(phone || '').trim() || !String(message || '').trim()) {
      return res.status(400).json({ error: '이름, 연락처, 문의 내용은 필수입니다.' });
    }
    const payload = { name, phone, area, inquiryType, message };
    if (useSupabaseInquiries()) {
      const record = await riderInquiriesSupabase.createInquiry(payload);
      return res.status(201).json(record);
    }
    const record = riderInquiriesStore.createInquiry(payload);
    res.status(201).json(record);
  } catch (error) {
    res.status(500).json({ error: error.message || '문의 접수에 실패했습니다.' });
  }
});

app.patch('/api/rider-inquiries/:id', async (req, res) => {
  try {
    if (useSupabaseInquiries()) {
      return res.json(await riderInquiriesSupabase.updateStatus(req.params.id, req.body?.status));
    }
    const list = riderInquiriesStore.updateStatus(req.params.id, req.body?.status);
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message || '문의 상태 변경에 실패했습니다.' });
  }
});

app.delete('/api/rider-inquiries/:id', async (req, res) => {
  try {
    if (useSupabaseInquiries()) {
      return res.json(await riderInquiriesSupabase.removeById(req.params.id));
    }
    const list = riderInquiriesStore.removeById(req.params.id);
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message || '문의 삭제에 실패했습니다.' });
  }
});

app.post('/api/settlement/preview', upload.single('file'), async (req, res) => {  try {
    if (!req.file) {
      return res.status(400).json({ error: '정산표 파일을 선택해주세요.' });
    }

    const password = String(req.body.password || '');
    const period = String(req.body.period || '').trim();
    let drivers = [];

    try {
      drivers = JSON.parse(req.body.drivers || '[]');
    } catch {
      return res.status(400).json({ error: '기사 목록 형식이 올바르지 않습니다.' });
    }

    const result = await parseSettlementFile({
      buffer: req.file.buffer,
      password,
      drivers,
      period
    });

    res.json(result);
  } catch (error) {
    if (error.code === 'WRONG_PASSWORD') {
      return res.status(401).json({ error: error.message });
    }
    if (error.code === 'PASSWORD_REQUIRED') {
      return res.status(400).json({ error: error.message });
    }
    res.status(400).json({ error: error.message || '정산표를 처리하지 못했습니다.' });
  }
});

app.use(express.static(ROOT_DIR));

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: '파일 업로드에 실패했습니다.' });
  }
  if (error) {
    return res.status(400).json({ error: error.message || '요청 처리 중 오류가 발생했습니다.' });
  }
  return next();
});

module.exports = app;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`BREM server running at http://localhost:${PORT}`);
    if (useSupabaseInquiries()) {
      console.log('Rider inquiries storage: Supabase');
    } else {
      console.log('Rider inquiries storage: local file (data/rider_inquiries.json)');
    }
    if (!isProduction) {
      console.log('Development mode — serve pages through this server for /api routes.');
    }
  });
}