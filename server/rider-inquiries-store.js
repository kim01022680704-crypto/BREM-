const fs = require('fs');
const path = require('path');
const {
  nowIso,
  purgeList,
  extraFromPayload,
  enrichRecord
} = require('./rider-inquiries-shared');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'rider_inquiries.json');

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, '[]', 'utf8');
  }
}

function readRaw() {
  ensureDataFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(list) {
  ensureDataFile();
  const next = Array.isArray(list) ? list : [];
  fs.writeFileSync(DATA_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function readAll() {
  const kept = purgeList(readRaw()).map(item => enrichRecord(item, item));
  writeAll(kept);
  return kept;
}

function createId() {
  return `inq-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function createInquiry(payload) {
  const list = readAll();
  const extra = extraFromPayload(payload);
  const record = enrichRecord({
    id: createId(),
    name: String(payload.name || '').trim(),
    phone: String(payload.phone || '').trim(),
    area: String(payload.area || '').trim(),
    inquiryType: String(payload.inquiryType || '라이더 지원').trim(),
    message: String(payload.message || '').trim(),
    status: 'new',
    createdAt: nowIso(),
    ...extra
  }, extra);
  list.unshift(record);
  writeAll(list);
  return record;
}

function updateInquiry(id, patch = {}) {
  const list = readAll();
  const index = list.findIndex(item => item.id === id);
  if (index < 0) throw new Error('문의를 찾지 못했습니다.');
  const current = { ...list[index] };
  if (patch.adminReply != null) {
    const reply = String(patch.adminReply || '').trim();
    if (!reply) throw new Error('답장 내용을 입력하세요.');
    current.adminReply = reply;
    current.adminRepliedAt = nowIso();
  }
  if (patch.riderAck) {
    current.riderAckAt = nowIso();
  }
  let nextStatus = patch.status != null ? String(patch.status || 'new') : current.status;
  if (patch.adminReply != null && nextStatus === 'new') nextStatus = 'read';
  current.status = nextStatus;
  current.updatedAt = nowIso();
  list[index] = current;
  writeAll(list);
  return list;
}

function updateStatus(id, status) {
  return updateInquiry(id, { status });
}

function removeById(id) {
  const list = readAll().filter(item => item.id !== id);
  writeAll(list);
  return list;
}

module.exports = {
  readAll,
  writeAll,
  createInquiry,
  updateInquiry,
  updateStatus,
  removeById
};
