const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function normalizePhone(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function isExpired(item, now = Date.now()) {
  const created = Date.parse(item?.createdAt || item?.created_at || '');
  if (!Number.isFinite(created)) return false;
  return now - created > RETENTION_MS;
}

function purgeList(list, now = Date.now()) {
  return (Array.isArray(list) ? list : []).filter(item => !isExpired(item, now));
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function sanitizeBucket(source = {}) {
  return {
    callCount: num(source.callCount),
    deliveryFee: num(source.deliveryFee),
    missionPay: num(source.missionPay),
    other: num(source.other),
    promo: num(source.promo),
    grossPay: num(source.grossPay),
    deductionDetail: num(source.deductionDetail),
    employmentInsurance: num(source.employmentInsurance),
    accidentInsurance: num(source.accidentInsurance),
    hourlyInsurance: num(source.hourlyInsurance),
    withholdingTax: num(source.withholdingTax),
    promotionWithholdingTax: num(source.promotionWithholdingTax),
    callFee: num(source.callFee),
    dailySettlementFee: num(source.dailySettlementFee),
    prepaid: num(source.prepaid),
    leaseFee: num(source.leaseFee),
    loanFee: num(source.loanFee),
    deductTotal: num(source.deductTotal),
    netPay: num(source.netPay)
  };
}

function sanitizePayslipSnapshot(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    weekStart: String(raw.weekStart || '').slice(0, 10),
    weekEnd: String(raw.weekEnd || '').slice(0, 10),
    weekLabel: String(raw.weekLabel || '').slice(0, 80),
    paymentDate: String(raw.paymentDate || '').slice(0, 10),
    riderName: String(raw.riderName || '').slice(0, 80),
    coupangId: String(raw.coupangId || '').slice(0, 80),
    baeminId: String(raw.baeminId || '').slice(0, 80),
    coupang: sanitizeBucket(raw.coupang),
    baemin: sanitizeBucket(raw.baemin)
  };
}

function extraFromPayload(payload = {}) {
  const source = payload.source === 'payslip' ? 'payslip' : (payload.source === 'app' ? 'app' : 'portal');
  return {
    riderId: String(payload.riderId || '').trim(),
    source,
    weekStart: String(payload.weekStart || '').slice(0, 10),
    payslipSnapshot: source === 'payslip' ? sanitizePayslipSnapshot(payload.payslipSnapshot) : null,
    adminReply: String(payload.adminReply || '').trim(),
    adminRepliedAt: String(payload.adminRepliedAt || '').trim(),
    riderAckAt: String(payload.riderAckAt || '').trim()
  };
}

function enrichRecord(record, raw = {}) {
  if (!record) return null;
  const extra = extraFromPayload({
    riderId: record.riderId || raw.riderId,
    source: record.source || raw.source,
    weekStart: record.weekStart || raw.weekStart,
    payslipSnapshot: record.payslipSnapshot || raw.payslipSnapshot,
    adminReply: record.adminReply || raw.adminReply,
    adminRepliedAt: record.adminRepliedAt || raw.adminRepliedAt,
    riderAckAt: record.riderAckAt || raw.riderAckAt
  });
  return {
    ...record,
    ...extra,
    source: extra.source || record.source || raw.source || 'portal'
  };
}

function statusLabel(item) {
  const status = typeof item === 'string' ? item : item?.status;
  if (status === 'done') return '처리완료';
  if (item && typeof item === 'object' && item.riderAckAt) return '기사확인';
  if (status === 'read') return '확인중';
  return '미확인';
}

function matchesRider(item, riderId, phone) {
  const id = String(riderId || '').trim();
  if (id && String(item.riderId || '') === id) return true;
  const mine = normalizePhone(phone);
  return Boolean(mine && normalizePhone(item.phone) === mine);
}

module.exports = {
  RETENTION_MS,
  nowIso,
  normalizePhone,
  isExpired,
  purgeList,
  sanitizePayslipSnapshot,
  extraFromPayload,
  enrichRecord,
  statusLabel,
  matchesRider
};
