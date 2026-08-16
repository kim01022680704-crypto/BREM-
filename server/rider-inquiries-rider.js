const { getRiderMe } = require('./rider-auth');
const riderInquiriesStore = require('./rider-inquiries-store');
const riderInquiriesSupabase = require('./rider-inquiries-supabase');
const { matchesRider, sanitizePayslipSnapshot } = require('./rider-inquiries-shared');

function useSupabase() {
  return riderInquiriesSupabase.isEnabled();
}

function store() {
  return useSupabase() ? riderInquiriesSupabase : riderInquiriesStore;
}

function riderArea(rider = {}) {
  const raw = rider.raw_data && typeof rider.raw_data === 'object' ? rider.raw_data : {};
  return String(
    raw.regionBaemin || raw.regionCoupang || rider.regionBaemin || rider.regionCoupang || ''
  ).trim();
}

async function listMine(accessToken) {
  const me = await getRiderMe(accessToken);
  if (!me.ok) return me;
  const list = await store().readAll();
  return {
    ok: true,
    inquiries: list.filter(item => matchesRider(item, me.riderId, me.rider?.phone))
  };
}

async function createMine(accessToken, body = {}) {
  const me = await getRiderMe(accessToken);
  if (!me.ok) return me;

  const source = body.source === 'payslip' ? 'payslip' : 'app';
  const message = String(body.message || '').trim();
  if (!message) {
    return { ok: false, status: 400, error: source === 'payslip' ? '문의 사유를 입력하세요.' : '문의 내용을 입력하세요.' };
  }

  let payslipSnapshot = null;
  if (source === 'payslip') {
    payslipSnapshot = sanitizePayslipSnapshot(body.payslipSnapshot);
    if (!payslipSnapshot) {
      return { ok: false, status: 400, error: '주급명세서 내용이 없어 문의할 수 없습니다.' };
    }
  }

  const record = await store().createInquiry({
    name: String(me.rider?.name || me.profile?.display_name || '').trim(),
    phone: String(me.rider?.phone || '').trim(),
    area: riderArea(me.rider),
    inquiryType: source === 'payslip' ? '주급명세서' : '기사앱 문의',
    message,
    riderId: me.riderId,
    source,
    weekStart: String(body.weekStart || payslipSnapshot?.weekStart || '').slice(0, 10),
    payslipSnapshot
  });

  return { ok: true, inquiry: record };
}

module.exports = {
  listMine,
  createMine
};
