const path = require('path');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { parseSettlementFile } = require('./settlement-parser');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT_DIR = path.join(__dirname, '..');

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

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(ROOT_DIR));

app.post('/api/settlement/preview', upload.single('file'), async (req, res) => {
  try {
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

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: '파일 업로드에 실패했습니다.' });
  }
  if (error) {
    return res.status(400).json({ error: error.message || '요청 처리 중 오류가 발생했습니다.' });
  }
  return next();
});

app.listen(PORT, () => {
  console.log(`BREM server running at http://localhost:${PORT}`);
});
