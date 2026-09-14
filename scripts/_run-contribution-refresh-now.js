#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();
const contribution = require('../server/contribution-admin');

(async () => {
  console.log('now', new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }));
  console.log('biz date', contribution.currentContributionDate());
  const result = await contribution.refreshSnapshotCore({
    autoActivate: true,
    platform: 'all'
  });
  console.log(JSON.stringify(result, null, 2));
})().catch(error => {
  console.error(error);
  process.exit(1);
});
