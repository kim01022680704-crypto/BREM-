/** 협력사명 fuzzy 매칭 — 표준울산남A팀브로 / 팀브로울산남A 등 동일 지사 처리 */

function compactPartnerText(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[()（）\[\]]/g, '')
    .toLowerCase();
}

function normalizePartnerLabel(name) {
  return compactPartnerText(name)
    .replace(/^표준/, '')
    .replace(/팀브로$/, '')
    .replace(/^팀브로/, '')
    .replace(/브로$/, '')
    .replace(/센터$/, '')
    .replace(/지사$/, '');
}

function extractPartnerRegionKey(name) {
  const text = compactPartnerText(name);
  const withoutPrefix = text
    .replace(/^표준/, '')
    .replace(/^팀브로/, '')
    .replace(/팀브로$/, '')
    .replace(/브로$/, '');
  const match = withoutPrefix.match(/([가-힣]{2,})([a-z])?$/i);
  if (!match) return normalizePartnerLabel(name);
  return `${match[1]}${(match[2] || '').toLowerCase()}`;
}

function partnerNamesMatch(a, b) {
  const left = String(a || '').trim();
  const right = String(b || '').trim();
  if (!left || !right) return false;
  if (left === right) return true;

  const na = normalizePartnerLabel(left);
  const nb = normalizePartnerLabel(right);
  if (na && nb && na === nb) return true;
  if (na && nb && (na.includes(nb) || nb.includes(na))) return true;

  const ra = extractPartnerRegionKey(left);
  const rb = extractPartnerRegionKey(right);
  return Boolean(ra && rb && ra === rb);
}

function textMatchesPartner(text, partnerId, partnerName) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (partnerId && raw.includes(partnerId)) return true;
  if (partnerName && partnerNamesMatch(raw, partnerName)) return true;
  return false;
}

function rowBelongsToPartner(row, partnerId, partnerName = '') {
  const id = String(partnerId || '').trim();
  if (!id) return true;

  const parsed = row?.parsed_json || {};
  const parsedId = String(parsed.partnerId || '').trim();
  if (parsedId === id) return true;

  const dedupe = String(row?.dedupe_key || '');
  if (dedupe.startsWith(`${id}:`)) return true;

  const parsedName = String(parsed.partnerName || '').trim();
  if (parsedName && partnerName && partnerNamesMatch(parsedName, partnerName)) {
    return parsedId === id || !parsedId || dedupe.startsWith(`${id}:`);
  }

  return false;
}

function pickBestPartnerName(existingName, candidateName) {
  const current = String(existingName || '').trim();
  const next = String(candidateName || '').trim();
  if (!current) return next;
  if (!next) return current;
  if (current.length >= next.length) return current;
  return next;
}

function sortPartnersForAdmin(partners = []) {
  return [...partners].sort((a, b) => String(a.partnerName || '').localeCompare(String(b.partnerName || ''), 'ko'));
}

module.exports = {
  compactPartnerText,
  normalizePartnerLabel,
  extractPartnerRegionKey,
  partnerNamesMatch,
  textMatchesPartner,
  rowBelongsToPartner,
  pickBestPartnerName,
  sortPartnersForAdmin
};
