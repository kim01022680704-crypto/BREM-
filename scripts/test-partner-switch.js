/**
 * 협력사 목록/전환 테스트 (세션서버 + Playwright 브라우저 필요)
 * 사용: node scripts/test-partner-switch.js
 */
const { listPartnerCentersViaPage, selectPartnerCenter, resolveCenterContextViaPage } = require('../server/baemin-center-context');

async function main() {
  const health = await fetch('http://127.0.0.1:3939/health').then(r => r.json()).catch(() => null);
  if (!health?.ok) {
    console.error('세션서버가 실행 중이 아닙니다. npm run baemin:session-server');
    process.exit(1);
  }
  console.log('[test] server', health.version, '| browser', health.browser?.browserOpen);

  const open = await fetch('http://127.0.0.1:3939/browser/open', { method: 'POST' }).then(r => r.json()).catch(() => ({}));
  if (!open.ok) console.warn('[test] browser/open:', open.message || 'skip');

  const tabs = await fetch('http://127.0.0.1:3939/browser/tabs').then(r => r.json()).catch(() => ({}));
  const pageUrl = tabs?.tabs?.[0]?.url || '';
  console.log('[test] tab', pageUrl);

  const probe = await fetch('http://127.0.0.1:3939/debug/partner-probe', { method: 'POST' }).then(r => r.json());
  console.log(JSON.stringify(probe, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
