/**
 * CLI 배민Biz 세션 갱신 (로컬 서버 없이 URL 직접 실행)
 * Run: npm run baemin:session-refresh -- --setup-id=... --setup-secret=...
 */
require('dotenv').config();

const { spawn, exec } = require('child_process');
const path = require('path');

function readArg(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find(arg => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : '';
}

const setupId = readArg('setup-id');
const setupSecret = readArg('setup-secret');
const apiBase = readArg('api-base') || 'https://brem.kr';
const port = process.env.BAEMIN_SESSION_LOCAL_PORT || '3939';

if (!setupId || !setupSecret) {
  console.error('Usage: npm run baemin:session-refresh -- --setup-id=UUID --setup-secret=TOKEN');
  process.exit(1);
}

const url = `http://127.0.0.1:${port}/start?setupId=${encodeURIComponent(setupId)}&setupSecret=${encodeURIComponent(setupSecret)}&apiBase=${encodeURIComponent(apiBase)}`;
console.log('Opening local session refresh:', url);

const serverScript = path.join(__dirname, 'baemin-session-local-server.js');
const server = spawn(process.execPath, [serverScript], {
  stdio: 'inherit',
  env: process.env
});

setTimeout(() => {
  if (process.platform === 'win32') {
    exec(`start "" "${url}"`);
  } else if (process.platform === 'darwin') {
    exec(`open "${url}"`);
  } else {
    exec(`xdg-open "${url}"`);
  }
  console.log('If browser did not open, visit:', url);
}, 1500);

process.on('SIGINT', () => {
  server.kill('SIGINT');
  process.exit(0);
});
