#!/usr/bin/env node
/**
 * 로컬 배민Biz 정산주 수집 테스트
 * Usage: node scripts/test-baemin-week-collect.js
 */
require('dotenv').config();

const { computeCollectDateRange } = require('../server/baemin-settlement-week');

async function main() {
  const range = computeCollectDateRange();
  console.log('[TEST] 정산주 수집 범위', range);

  const health = await fetch('http://127.0.0.1:3939/health').then(r => r.json()).catch(() => null);
  if (!health?.ok) {
    console.error('[TEST] 로컬 session-server 가 실행 중이 아닙니다.');
    process.exit(1);
  }
  console.log('[TEST] server version=', health.version, 'browserOpen=', health.browser?.browserOpen, 'loggedIn=', health.browser?.sessionLoggedIn);

  if (!health.browser?.sessionLoggedIn) {
    console.warn('[TEST] 브라우저 로그인 필요 — ERP [브라우저 열기/세션 유지] 후 배민 로그인하세요.');
  }

  const probe = await fetch('http://127.0.0.1:3939/probe/network', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ referenceDate: range.referenceDate })
  }).then(r => r.json()).catch(error => ({ ok: false, message: error.message }));

  console.log('[TEST] network probe uniqueApiPaths=', probe.uniqueApiPaths || []);
  console.log('[TEST] network probe bySource=', JSON.stringify(probe.bySource || {}, null, 2));
  if (probe.responseSamples) {
    console.log('[TEST] responseSamples keys=', Object.keys(probe.responseSamples));
  }

  const collect = await fetch('http://127.0.0.1:3939/collect/full', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ collectDate: range.referenceDate })
  }).then(r => r.json()).catch(error => ({ ok: false, message: error.message }));

  console.log('[TEST] collect result=', JSON.stringify({
    ok: collect.ok,
    message: collect.message,
    savedTotal: collect.savedTotal,
    summaryTotals: collect.summaryTotals,
    dateRange: collect.dateRange,
    results: collect.results || collect.record?.results
  }, null, 2));

  process.exit(collect.ok ? 0 : 1);
}

main().catch(error => {
  console.error('[TEST] failed', error);
  process.exit(1);
});
