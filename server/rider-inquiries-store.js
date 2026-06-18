const fs = require('fs');
const path = require('path');

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

function readAll() {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
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

function createId() {
  return `inq-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function createInquiry(payload) {
  const list = readAll();
  const record = {
    id: createId(),
    name: String(payload.name || '').trim(),
    phone: String(payload.phone || '').trim(),
    area: String(payload.area || '').trim(),
    inquiryType: String(payload.inquiryType || '라이더 지원').trim(),
    message: String(payload.message || '').trim(),
    status: 'new',
    createdAt: new Date().toISOString()
  };
  list.unshift(record);
  writeAll(list);
  return record;
}

function updateStatus(id, status) {
  const list = readAll().map(item => (
    item.id === id
      ? { ...item, status: String(status || 'new'), updatedAt: new Date().toISOString() }
      : item
  ));
  writeAll(list);
  return list;
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
  updateStatus,
  removeById
};
