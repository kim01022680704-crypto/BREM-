/**
 * 대량이체 입금은행 표기.
 * 이미 이체에 쓰고 있는 이름(농협, 국민은행, 토스뱅크…)으로 맞춘다.
 * 모르는 이름은 그대로 둔다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.window === root) root.BremBankName = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const GROUPS = [
    ['카카오뱅크', ['090', '카카오', '카카오뱅크', '카카오은행', 'kakaobank', 'kakaobank']],
    ['카카오페이증권', ['288', '카카오페이', '카카오페이증권']],
    ['토스뱅크', ['092', '토스', '토스뱅크', '토스은행', 'toss', 'tossbank']],
    ['국민은행', ['004', '국민', '국민은행', 'kb국민', 'kb국민은행']],
    ['신한은행', ['088', '신한', '신한은행']],
    ['우리은행', ['020', '우리', '우리은행']],
    ['하나은행', ['081', '하나', '하나은행', 'keb하나', 'keb하나은행']],
    ['기업은행', ['003', '기업', '기업은행', 'ibk', 'ibk기업', 'ibk기업은행']],
    ['농협', ['011', '농협', '농협은행', 'nh농협', 'nh농협은행', '농협중앙', '농협중앙회', '지역농협', '단위농협', '지역농축협']],
    ['새마을금고', ['045', '새마을', '새마을금고', 'mg새마을', 'mg새마을금고']],
    ['경남은행', ['039', '경남', '경남은행']],
    ['부산은행', ['032', '부산', '부산은행']],
    ['케이뱅크', ['089', '케이뱅크', 'k뱅크', 'kbank']],
    ['우체국', ['071', '우체국', '우체국은행', '우체국예금']],
    ['신협', ['048', '신협', '신용협동조합']],
    ['수협', ['007', '수협', '수협은행', 'sh수협', 'sh수협은행']],
    ['SC제일은행', ['023', '제일', '제일은행', 'sc제일', 'sc제일은행', 'sc은행', 'cs은행']],
    ['대구은행', ['031', '대구', '대구은행', 'im뱅크', '아이엠뱅크', 'dgb']],
    ['저축은행', ['050', '저축은행', '상호저축은행']],
    ['산업은행', ['002', '산업', '산업은행', 'kdb']],
    ['전북은행', ['037', '전북', '전북은행']],
    ['광주은행', ['034', '광주', '광주은행']],
    ['제주은행', ['035', '제주', '제주은행']],
    ['씨티은행', ['027', '씨티', '씨티은행', '한국씨티', '한국씨티은행', 'citi']],
    ['삼성증권', ['240', '삼성증권']],
    ['키움증권', ['264', '키움증권']]
  ];

  const ALIAS = {};
  GROUPS.forEach(([canonical, aliases]) => {
    aliases.forEach(alias => {
      ALIAS[alias] = canonical;
    });
  });

  function compactKey(value) {
    return String(value || '')
      .trim()
      .replace(/[（(][^)）]*[)）]/g, '')
      .replace(/\s+/g, '')
      .replace(/[()（）.·,/_-]/g, '')
      .replace(/벵크/g, '뱅크')
      .replace(/뱅큼/g, '뱅크')
      .replace(/뱅그/g, '뱅크')
      .replace(/은헹/g, '은행')
      .toLowerCase();
  }

  function normalizeBankName(value) {
    const raw = String(value || '').trim().replace(/\s+/g, ' ');
    if (!raw) return '';
    const key = compactKey(raw);
    return ALIAS[key] || raw;
  }

  const INPUT_IDS = [
    'driverBankName',
    'driverEditBankName',
    'driverWithdrawalBankName',
    'settlementMatchBankName',
    'driverRegionBulkCreateBankName'
  ];

  function applyInput(input) {
    if (!input) return;
    const next = normalizeBankName(input.value);
    if (next !== input.value) input.value = next;
  }

  function bindBankNameInputs() {
    if (typeof document === 'undefined' || document.documentElement?.dataset?.bremBankBound === '1') return;
    document.documentElement.dataset.bremBankBound = '1';
    const applyKnown = () => INPUT_IDS.forEach(id => applyInput(document.getElementById(id)));
    document.addEventListener('blur', event => {
      const id = event.target && event.target.id;
      if (INPUT_IDS.includes(id)) applyInput(event.target);
    }, true);
    document.addEventListener('change', event => {
      const id = event.target && event.target.id;
      if (INPUT_IDS.includes(id)) applyInput(event.target);
    }, true);
    document.addEventListener('submit', applyKnown, true);
    applyKnown();
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bindBankNameInputs);
    } else {
      bindBankNameInputs();
    }
  }

  return { normalizeBankName, bindBankNameInputs };
});
