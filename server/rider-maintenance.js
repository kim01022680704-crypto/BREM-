const { getServiceClient } = require('./admin-bootstrap');
const { getRiderMe } = require('./rider-auth');
const adminUsers = require('./admin-users');

const KEY = 'brem_rider_maintenance';
const PARTS = { oil: '오일', pad: '패드', drive: '구동계', other: '기타' };
const EXPENSE_CATS = { meal: '밥값', fuel: '기름값', coffee: '커피값', snack: '간식값', other: '기타' };

function emptyDoc() {
  return { bikes: [], logs: [], expenses: [] };
}

async function readDoc() {
  const supabase = getServiceClient();
  if (!supabase) return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 없습니다.' };
  const { data, error } = await supabase.from('settings').select('value').eq('key', KEY).maybeSingle();
  if (error) return { ok: false, status: 500, error: error.message || '정비기록을 읽지 못했습니다.' };
  const value = data?.value && typeof data.value === 'object' ? data.value : {};
  return {
    ok: true,
    doc: {
      bikes: Array.isArray(value.bikes) ? value.bikes : [],
      logs: Array.isArray(value.logs) ? value.logs : [],
      expenses: Array.isArray(value.expenses) ? value.expenses : []
    }
  };
}

async function writeDoc(doc) {
  const supabase = getServiceClient();
  if (!supabase) return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 없습니다.' };
  const { error } = await supabase.from('settings').upsert({
    key: KEY,
    value: { bikes: doc.bikes || [], logs: doc.logs || [], expenses: doc.expenses || [] },
    updated_at: new Date().toISOString()
  }, { onConflict: 'key' });
  if (error) return { ok: false, status: 500, error: error.message || '정비기록을 저장하지 못했습니다.' };
  return { ok: true };
}

function riderName(me) {
  return String(me.rider?.name || me.profile?.display_name || '').trim();
}

function mine(doc, riderId) {
  const id = String(riderId || '');
  return {
    bike: (doc.bikes || []).find(row => String(row.riderId) === id) || null,
    logs: (doc.logs || []).filter(row => String(row.riderId) === id)
      .sort((a, b) => String(b.date).localeCompare(String(a.date))),
    expenses: (doc.expenses || []).filter(row => String(row.riderId) === id)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
  };
}

async function listMine(accessToken) {
  const me = await getRiderMe(accessToken);
  if (!me.ok) return me;
  const loaded = await readDoc();
  if (!loaded.ok) return loaded;
  return { ok: true, ...mine(loaded.doc, me.riderId) };
}

async function saveBike(accessToken, body = {}) {
  const me = await getRiderMe(accessToken);
  if (!me.ok) return me;
  const model = String(body.model || '').trim();
  const cycleKm = Math.max(0, Math.round(Number(body.cycleKm) || 0));
  if (!model) return { ok: false, status: 400, error: '오토바이 종류를 입력하세요.' };
  if (!cycleKm) return { ok: false, status: 400, error: '교체주기 km를 입력하세요.' };
  const loaded = await readDoc();
  if (!loaded.ok) return loaded;
  const doc = loaded.doc;
  const bike = {
    riderId: me.riderId,
    name: riderName(me),
    phone: String(me.rider?.phone || '').trim(),
    model,
    cycleKm,
    updatedAt: new Date().toISOString()
  };
  const rest = doc.bikes.filter(row => String(row.riderId) !== String(me.riderId));
  doc.bikes = rest.concat(bike);
  const saved = await writeDoc(doc);
  if (!saved.ok) return saved;
  return { ok: true, ...mine(doc, me.riderId) };
}

async function saveLog(accessToken, body = {}) {
  const me = await getRiderMe(accessToken);
  if (!me.ok) return me;
  const date = String(body.date || '').slice(0, 10);
  const km = Math.max(0, Math.round(Number(body.km) || 0));
  const cost = Math.max(0, Math.round(Number(body.cost) || 0));
  const part = PARTS[body.part] ? body.part : '';
  const custom = String(body.custom || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, status: 400, error: '날짜를 선택하세요.' };
  if (!km) return { ok: false, status: 400, error: '내 오토바이 km를 입력하세요.' };
  if (!part) return { ok: false, status: 400, error: '교체 항목을 선택하세요.' };
  if (part === 'other' && !custom) return { ok: false, status: 400, error: '기타 항목을 직접 입력하세요.' };
  const loaded = await readDoc();
  if (!loaded.ok) return loaded;
  const doc = loaded.doc;
  const bike = doc.bikes.find(row => String(row.riderId) === String(me.riderId));
  const log = {
    id: `${me.riderId}-${Date.now()}`,
    riderId: me.riderId,
    name: riderName(me),
    phone: String(me.rider?.phone || '').trim(),
    bikeModel: bike?.model || '',
    date,
    km,
    cost,
    part,
    partLabel: part === 'other' ? custom : PARTS[part],
    createdAt: new Date().toISOString()
  };
  doc.logs = (doc.logs || []).concat(log);
  const saved = await writeDoc(doc);
  if (!saved.ok) return saved;
  return { ok: true, ...mine(doc, me.riderId) };
}

async function saveExpense(accessToken, body = {}) {
  const me = await getRiderMe(accessToken);
  if (!me.ok) return me;
  const date = String(body.date || '').slice(0, 10);
  const cost = Math.max(0, Math.round(Number(body.cost) || 0));
  const cat = EXPENSE_CATS[body.category] ? body.category : '';
  const custom = String(body.custom || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, status: 400, error: '날짜를 선택하세요.' };
  if (!cost) return { ok: false, status: 400, error: '금액을 입력하세요.' };
  if (!cat) return { ok: false, status: 400, error: '항목을 선택하세요.' };
  if (cat === 'other' && !custom) return { ok: false, status: 400, error: '기타 항목을 직접 입력하세요.' };
  const loaded = await readDoc();
  if (!loaded.ok) return loaded;
  const doc = loaded.doc;
  doc.expenses = (doc.expenses || []).concat({
    id: `${me.riderId}-exp-${Date.now()}`,
    riderId: me.riderId,
    name: riderName(me),
    phone: String(me.rider?.phone || '').trim(),
    date,
    cost,
    category: cat,
    categoryLabel: cat === 'other' ? custom : EXPENSE_CATS[cat],
    createdAt: new Date().toISOString()
  });
  const saved = await writeDoc(doc);
  if (!saved.ok) return saved;
  return { ok: true, ...mine(doc, me.riderId) };
}

async function listAdmin(accessToken) {
  const admin = await adminUsers.getMyAdminAccount(accessToken);
  if (!admin.ok) return admin;
  const loaded = await readDoc();
  if (!loaded.ok) return loaded;
  const bikes = loaded.doc.bikes || [];
  const logs = (loaded.doc.logs || []).map(row => {
    const bike = bikes.find(item => String(item.riderId) === String(row.riderId));
    return {
      ...row,
      bikeModel: row.bikeModel || bike?.model || '',
      cycleKm: bike?.cycleKm || 0
    };
  }).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const expenses = (loaded.doc.expenses || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return { ok: true, bikes, logs, expenses };
}

module.exports = {
  KEY,
  PARTS,
  EXPENSE_CATS,
  emptyDoc,
  readDoc,
  writeDoc,
  listMine,
  saveBike,
  saveLog,
  saveExpense,
  listAdmin
};
