/**
 * BREM 운영 환경(호스트) 판별 — brem.kr 전용
 */
(function () {
  function normalizeHost(hostname) {
    return String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
  }

  function isProductionHost(hostname) {
    const host = normalizeHost(hostname);
    if (!host || host === 'localhost' || host === '127.0.0.1') return false;
    if (host === 'brem.kr' || host === 'www.brem.kr') return true;
    if (host.endsWith('.brem.kr')) return true;
    return false;
  }

  window.BremEnv = {
    normalizeHost,
    isProductionHost
  };
})();
