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
const ridersAdmin = require('./riders-admin');
const missionsAdmin = require('./missions-admin');
const baeminDeliveryCollect = require('./baemin-delivery-collect');
const baeminDeliverySession = require('./baemin-delivery-session');
const riderAuth = require('./rider-auth');
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

app.post('/api/rider/sign-in', async (req, res) => {
  try {
    const { login, password } = req.body || {};
    const result = await riderAuth.signInRider(login, password);
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json({
      ok: true,
      session: result.session,
      user: result.user,
      riderId: result.riderId,
      rider: result.rider,
      profile: result.profile
    });
  } catch (error) {
    res.status(500).json({ error: error.message || '기사 로그인에 실패했습니다.' });
  }
});

app.get('/api/rider/me', async (req, res) => {
  try {
    const result = await riderAuth.getRiderMe(getBearerToken(req));
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json({
      ok: true,
      riderId: result.riderId,
      rider: result.rider,
      profile: result.profile
    });
  } catch (error) {
    res.status(500).json({ error: error.message || '기사 정보를 불러오지 못했습니다.' });
  }
});

app.get('/api/rider/missions', async (req, res) => {
  try {
    const result = await riderAuth.getRiderAssignedMissions(getBearerToken(req));
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json({
      ok: true,
      riderId: result.riderId,
      missions: result.missions
    });
  } catch (error) {
    res.status(500).json({ error: error.message || '미션 정보를 불러오지 못했습니다.' });
  }
});

app.post('/api/rider/profile', async (req, res) => {
  try {
    const result = await riderAuth.updateRiderProfile(getBearerToken(req), req.body || {});
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json({
      ok: true,
      riderId: result.riderId,
      rider: result.rider,
      profile: result.profile
    });
  } catch (error) {
    res.status(500).json({ error: error.message || '기사 정보 저장에 실패했습니다.' });
  }
});

app.get('/api/admin/riders', async (req, res) => {
  try {
    const result = await ridersAdmin.listRiders(getBearerToken(req), {
      limit: req.query.limit,
      offset: req.query.offset,
      search: req.query.search,
      status: req.query.status
    });
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json({
      ok: true,
      riders: result.riders,
      total: result.total,
      hasMore: result.hasMore,
      limit: result.limit,
      offset: result.offset
    });
  } catch (error) {
    res.status(500).json({ error: error.message || '기사 목록을 불러오지 못했습니다.' });
  }
});

app.post('/api/admin/riders', async (req, res) => {
  try {
    const result = await ridersAdmin.upsertRider(getBearerToken(req), req.body?.rider || req.body);
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || '기사 저장에 실패했습니다.' });
  }
});

app.post('/api/admin/riders/bulk', async (req, res) => {
  try {
    const result = await ridersAdmin.bulkUpsertRiders(getBearerToken(req), req.body?.riders || [], {
      skipAuthProvision: req.body?.skipAuthProvision !== false,
      maxBatch: req.body?.maxBatch
    });
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error, failed: result.failed || [] });
    }
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || '기사 일괄 저장에 실패했습니다.' });
  }
});

app.post('/api/admin/riders/missions/bulk', async (req, res) => {
  try {
    const result = await ridersAdmin.bulkPatchRiderMissions(
      getBearerToken(req),
      req.body?.patches || [],
      { maxBatch: req.body?.maxBatch }
    );
    if (!result.ok) {
      return res.status(result.status || 400).json({
        error: result.error,
        failed: result.failed || []
      });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || '기사 미션 일괄 저장에 실패했습니다.' });
  }
});

app.post('/api/admin/riders/merge-selected', async (req, res) => {
  try {
    const result = await ridersAdmin.mergeSelectedRiders(getBearerToken(req), req.body?.riderIds || []);
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || '선택 기사 병합에 실패했습니다.' });
  }
});

app.post('/api/admin/riders/merge-auto', async (req, res) => {
  try {
    const result = await ridersAdmin.mergeAutoRiders(getBearerToken(req));
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || '전체 기사 자동병합에 실패했습니다.' });
  }
});

app.get('/api/admin/riders/count', async (req, res) => {
  try {
    const result = await ridersAdmin.countRiders(getBearerToken(req));
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json({ ok: true, count: result.count });
  } catch (error) {
    res.status(500).json({ error: error.message || '기사 수를 확인하지 못했습니다.' });
  }
});

app.delete('/api/admin/riders/all', async (req, res) => {
  try {
    const result = await ridersAdmin.deleteAllRiders(getBearerToken(req));
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || '기사 전체 삭제에 실패했습니다.' });
  }
});

app.delete('/api/admin/riders/:riderId', async (req, res) => {
  try {
    const result = await ridersAdmin.deleteRider(getBearerToken(req), req.params.riderId);
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || '기사 삭제에 실패했습니다.' });
  }
});

app.get('/api/admin/missions/status', async (req, res) => {
  try {
    const result = await missionsAdmin.getMissionsStatus(getBearerToken(req));
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error || result.message });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || '미션 테이블 상태를 확인하지 못했습니다.' });
  }
});

app.get('/api/admin/missions', async (req, res) => {
  try {
    const result = await missionsAdmin.listMissions(getBearerToken(req));
    if (!result.ok) {
      return res.status(result.status || 400).json({
        error: result.error || result.message,
        message: result.message || result.error
      });
    }
    res.json({ ok: true, missions: result.missions });
  } catch (error) {
    res.status(500).json({ error: error.message || '미션 목록을 불러오지 못했습니다.' });
  }
});

app.post('/api/admin/missions', async (req, res) => {
  try {
    const result = await missionsAdmin.upsertMission(getBearerToken(req), req.body?.mission || req.body);
    if (!result.ok) {
      return res.status(result.status || 400).json({
        error: result.error || result.message,
        message: result.message || result.error
      });
    }
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || '미션 저장에 실패했습니다.' });
  }
});

app.delete('/api/admin/missions/:missionId', async (req, res) => {
  try {
    const result = await missionsAdmin.deleteMission(getBearerToken(req), req.params.missionId);
    if (!result.ok) {
      return res.status(result.status || 400).json({
        error: result.error || result.message,
        message: result.message || result.error
      });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || '미션 삭제에 실패했습니다.' });
  }
});

app.get('/api/admin/baemin-delivery/config', async (req, res) => {
  try {
    const result = await baeminDeliveryCollect.getConfig(getBearerToken(req));
    if (!result.ok) {
      return res.status(result.status || 400).json({
        error: result.error || result.message,
        message: result.message || result.error
      });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || '배민 수집 설정을 확인하지 못했습니다.' });
  }
});

app.get('/api/admin/baemin-delivery/session', async (req, res) => {
  try {
    const result = await baeminDeliverySession.getSessionStatus(getBearerToken(req));
    if (!result.ok) {
      return res.status(result.status || 400).json({
        error: result.error || result.message,
        message: result.message || result.error
      });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || '배민 세션 상태를 확인하지 못했습니다.' });
  }
});

app.post('/api/admin/baemin-delivery/session/setup', async (req, res) => {
  try {
    const result = await baeminDeliverySession.createSessionSetup(getBearerToken(req));
    if (!result.ok) {
      return res.status(result.status || 400).json({
        error: result.error || result.message,
        message: result.message || result.error
      });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || '배민 세션 갱신 준비에 실패했습니다.' });
  }
});

app.get('/api/admin/baemin-delivery/session/setup', async (req, res) => {
  try {
    const result = await baeminDeliverySession.getSessionSetupStatus(
      getBearerToken(req),
      req.query.setupId
    );
    if (!result.ok) {
      return res.status(result.status || 400).json({
        error: result.error || result.message,
        message: result.message || result.error
      });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || '배민 세션 갱신 상태를 확인하지 못했습니다.' });
  }
});

app.post('/api/admin/baemin-delivery/session', async (req, res) => {
  try {
    const body = req.body || {};
    const setupId = String(body.setupId || '').trim();
    const setupSecret = String(body.setupSecret || '').trim();
    const cookie = String(body.cookie || '').trim();

    let result;
    if (setupId && setupSecret) {
      result = await baeminDeliverySession.completeSessionSetup(setupId, setupSecret, cookie, {
        source: 'playwright_local'
      });
    } else {
      result = await baeminDeliverySession.saveSessionViaAdmin(
        getBearerToken(req),
        cookie,
        'manual_admin'
      );
    }

    if (!result.ok) {
      return res.status(result.status || 400).json({
        error: result.error || result.message,
        message: result.message || result.error
      });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || '배민 세션 저장에 실패했습니다.' });
  }
});

app.get('/api/admin/baemin-delivery/latest', async (req, res) => {
  try {
    const result = await baeminDeliveryCollect.getLatestSummary(
      getBearerToken(req),
      req.query.captureDate
    );
    if (!result.ok) {
      return res.status(result.status || 400).json({
        error: result.error || result.message,
        message: result.message || result.error
      });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || '배민 수집 내역을 불러오지 못했습니다.' });
  }
});

app.post('/api/admin/baemin-delivery/collect', async (req, res) => {
  try {
    const result = await baeminDeliveryCollect.collectFromApi(getBearerToken(req), req.body || {});
    if (!result.ok) {
      return res.status(result.status || 400).json({
        error: result.error || result.message,
        message: result.message || result.error
      });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || '배민 자동 수집에 실패했습니다.' });
  }
});

app.post('/api/admin/baemin-delivery/import-json', async (req, res) => {
  try {
    const body = req.body || {};
    const result = await baeminDeliveryCollect.importFromJson(
      getBearerToken(req),
      body.payload ?? body.json ?? body,
      { captureDate: body.captureDate }
    );
    if (!result.ok) {
      return res.status(result.status || 400).json({
        error: result.error || result.message,
        message: result.message || result.error
      });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || '배민 JSON 저장에 실패했습니다.' });
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