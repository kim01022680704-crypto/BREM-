/**
 * 배민Biz 로컬 세션 서버 포트 — 단일 설정 소스
 *
 * - ERP 브라우저 → PC localhost URL: DEFAULT(3939) 고정 (Vercel env 무시)
 * - PC session-server listen 포트: BAEMIN_SESSION_LOCAL_PORT (기본 3939)
 */
const DEFAULT_BAEMIN_SESSION_LOCAL_PORT = 3939;
const LOCAL_HOSTS = ['127.0.0.1', 'localhost'];

function resolveBaeminSessionListenPort() {
  const fromEnv = Number(process.env.BAEMIN_SESSION_LOCAL_PORT);
  if (Number.isFinite(fromEnv) && fromEnv > 0 && fromEnv < 65536) {
    return fromEnv;
  }
  return DEFAULT_BAEMIN_SESSION_LOCAL_PORT;
}

/** ERP·브라우저가 PC localhost에 접속할 때 쓰는 포트 (운영 API 응답용) */
function resolveBaeminSessionClientPort() {
  return DEFAULT_BAEMIN_SESSION_LOCAL_PORT;
}

function buildLocalSessionUrls(port, hosts = LOCAL_HOSTS) {
  const normalizedPort = Number(port) || DEFAULT_BAEMIN_SESSION_LOCAL_PORT;
  const primaryHost = hosts[0] || '127.0.0.1';
  const localSessionUrl = `http://${primaryHost}:${normalizedPort}`;
  const healthUrls = hosts.map(host => `http://${host}:${normalizedPort}/health`);
  return {
    port: normalizedPort,
    localSessionUrl,
    localHealthUrl: healthUrls[0],
    localHealthUrls: healthUrls
  };
}

/** Vercel/운영 API → ERP 브라우저에 내려주는 localhost URL */
function getErpLocalSessionConfig() {
  return buildLocalSessionUrls(resolveBaeminSessionClientPort());
}

/** PC session-server가 실제로 listen 할 포트·URL */
function getListenLocalSessionConfig() {
  return buildLocalSessionUrls(resolveBaeminSessionListenPort());
}

function buildStartUrl({ setupId, setupSecret, apiBase, port = resolveBaeminSessionClientPort() }) {
  const params = new URLSearchParams({
    setupId: String(setupId || ''),
    setupSecret: String(setupSecret || ''),
    apiBase: String(apiBase || 'https://brem.kr').trim()
  });
  return `http://127.0.0.1:${port}/start?${params.toString()}`;
}

module.exports = {
  DEFAULT_BAEMIN_SESSION_LOCAL_PORT,
  LOCAL_HOSTS,
  resolveBaeminSessionListenPort,
  resolveBaeminSessionClientPort,
  buildLocalSessionUrls,
  getErpLocalSessionConfig,
  getListenLocalSessionConfig,
  buildStartUrl
};
