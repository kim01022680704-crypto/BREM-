const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const contribution = require('../server/contribution-admin');

function group(overrides = {}) {
  return {
    date: '2026-09-07',
    platform: 'baemin',
    region: 'DP000001',
    vendorOrPartner: 'DP000001',
    slotKey: 'evening',
    riderTotals: {
      rider1: { value: 12, name: '기사1', region: '양산', matchKey: '1', raw: {} }
    },
    assignedTarget: 100,
    regionComplete: 55,
    capturedAt: '2026-09-07T10:00:00.000Z',
    ...overrides
  };
}

function stateFromTransition(transition) {
  return {
    ...transition.state,
    vendor_or_partner: transition.state.vendor_or_partner,
    slot_key: transition.state.slot_key,
    rider_totals: transition.state.rider_totals,
    last_capture_key: transition.state.last_capture_key,
    last_captured_at: transition.state.last_captured_at,
    region_complete: transition.state.region_complete,
    assigned_target: transition.state.assigned_target,
    region_complete_reached: transition.state.region_complete_reached
  };
}

function run() {
  const exact08 = contribution.decomposeCoupangWeightedDelta(0.8);
  assert.deepStrictEqual(
    [exact08.count08, exact08.count10, exact08.exact],
    [1, 0, true]
  );
  const exactMax10 = contribution.decomposeCoupangWeightedDelta(8);
  assert.deepStrictEqual(
    [exactMax10.count08, exactMax10.count10, exactMax10.exact],
    [0, 8, true],
    'exact 조합은 n10 최대여야 한다'
  );
  const corrected = contribution.decomposeCoupangWeightedDelta(0.9);
  assert.deepStrictEqual(
    [corrected.count08, corrected.count10, corrected.corrected],
    [0, 1, true],
    '불가능한 0.9는 최소오차 후 n10 우선으로 보정한다'
  );
  assert.strictEqual(
    contribution.currentCoupangPeakKey(new Date('2026-09-07T16:00:00.000Z')),
    'POST_DINNER',
    'KST 새벽 1시는 전날 저녁논피크여야 한다'
  );
  assert.strictEqual(
    contribution.currentContributionDate(new Date('2026-09-07T16:00:00.000Z')),
    '2026-09-07',
    'KST 새벽 영업일은 전날이어야 한다'
  );
  assert.strictEqual(
    contribution.currentContributionDate(new Date('2026-09-09T20:59:00+09:00')),
    '2026-09-09',
    'KST 저녁은 당일 영업일이다'
  );
  assert.strictEqual(
    contribution.currentContributionDate(new Date('2026-09-10T05:59:00+09:00')),
    '2026-09-09'
  );
  assert.deepStrictEqual(
    contribution.startedBaeminSlotKeys(new Date('2026-09-09T11:30:00.000Z')),
    ['morning', 'afternoon', 'evening', 'midnight'],
    '저녁 20시 이후에도 오늘 시작한 배민 타임을 마감 캡처해야 한다'
  );
  assert.deepStrictEqual(
    contribution.startedBaeminSlotKeys(new Date('2026-09-09T02:00:00.000Z')),
    ['morning'],
    '오전 11시에는 아침점심만 열려 있어야 한다'
  );
  assert.deepStrictEqual(
    contribution.contributionCollectDates(new Date('2026-09-10T01:00:00+09:00')),
    ['2026-09-09', '2026-09-10'],
    '자정 이후 크롤은 달력일·영업일을 함께 읽어야 한다'
  );
  assert.deepStrictEqual(
    contribution.contributionCollectDates(new Date('2026-09-10T12:00:00+09:00')),
    ['2026-09-10']
  );
  assert.strictEqual(
    contribution.itemContributionDate(
      { collected_at: '2026-09-10T01:10:00+09:00' },
      new Date('2026-09-10T01:10:00+09:00')
    ),
    '2026-09-09',
    '새벽 크롤은 전날 심야 원장에 붙어야 한다'
  );
  assert.deepStrictEqual(
    contribution.filterItemsForContributionDate([
      { collected_at: '2026-09-10T01:10:00+09:00', id: 'night' },
      { collected_at: '2026-09-10T07:10:00+09:00', id: 'morning' }
    ], '2026-09-10', new Date('2026-09-10T07:10:00+09:00')).map(item => item.id),
    ['morning'],
    '새 영업일이 되면 전날 심야 크롤은 제외해야 한다'
  );

  const emptyIndexes = { byBaeminId: new Map(), byNamePhone: new Map(), byName: new Map() };
  const splitVendors = contribution.buildCoupangCurrentGroups(
    [
      {
        collected_at: '2026-09-09T01:30:00.000Z',
        vendor_id: 'morning-vendor',
        rider_name: '아침매장',
        phone_number: '01011112222',
        parsed_json: { lunchPeak: 0, dinnerPeak: 0, nonPeak: 4 }
      },
      {
        collected_at: '2026-09-09T03:10:00.000Z',
        vendor_id: 'lunch-vendor',
        rider_name: '점심매장',
        phone_number: '01033334444',
        parsed_json: { lunchPeak: 2.4, dinnerPeak: 0, nonPeak: 1 }
      }
    ],
    [],
    emptyIndexes,
    '2026-09-09',
    new Date('2026-09-09T03:10:00.000Z')
  );
  const morningVendor = splitVendors.find(group => group.vendorOrPartner === 'morning-vendor');
  const lunchVendor = splitVendors.find(group => group.vendorOrPartner === 'lunch-vendor');
  assert.strictEqual(morningVendor.slotKey, 'MORNING', '먼저 크롤된 매장은 자기 시각 피크를 써야 한다');
  assert.strictEqual(lunchVendor.slotKey, 'LUNCH', '나중 매장의 시각으로 전체 피크를 덮으면 안 된다');
  assert.strictEqual(
    Object.values(morningVendor.riderTotals)[0].value,
    4,
    '아침 매장은 nonPeak를 써야 한다'
  );
  assert.strictEqual(
    Object.values(lunchVendor.riderTotals)[0].value,
    2.4,
    '점심 매장은 lunchPeak를 써야 한다'
  );
  const staleDropped = contribution.filterLatestWave([
    { collected_at: '2026-09-09T01:00:00.000Z', vendor_id: 'v1' },
    { collected_at: '2026-09-09T03:00:00.000Z', vendor_id: 'v1' }
  ], item => item.vendor_id);
  assert.deepStrictEqual(
    staleDropped.map(item => item.collected_at),
    ['2026-09-09T03:00:00.000Z'],
    '같은 매장의 이전 크롤 웨이브는 버려야 한다'
  );

  const configV1 = contribution.normalizeConfig({
    active: true,
    version: 3,
    baeminPointsPerCall: 10,
    coupangPoints08: 8,
    coupangPoints10: 10
  });

  const baseline = contribution.computeCaptureTransition(group(), null, configV1, {
    baselineOnly: true
  });
  assert.strictEqual(baseline.events.length, 0, '활성화 baseline은 0점이어야 한다');

  const firstDelta = contribution.computeCaptureTransition(group({
    riderTotals: {
      rider1: { value: 15, name: '기사1', region: '양산', matchKey: '1', raw: {} }
    },
    regionComplete: 58,
    capturedAt: '2026-09-07T10:05:00.000Z'
  }), stateFromTransition(baseline), configV1);
  assert.strictEqual(firstDelta.events[0].credited_calls, 3);
  assert.strictEqual(firstDelta.events[0].points, 30);
  assert.strictEqual(firstDelta.events[0].rule_version, 3);

  const configV2 = { ...configV1, version: 4, baeminPointsPerCall: 20 };
  const futureRule = contribution.computeCaptureTransition(group({
    riderTotals: {
      rider1: { value: 16, name: '기사1', region: '양산', matchKey: '1', raw: {} }
    },
    regionComplete: 59,
    capturedAt: '2026-09-07T10:10:00.000Z'
  }), stateFromTransition(firstDelta), configV2);
  assert.strictEqual(futureRule.events[0].points, 20);
  assert.strictEqual(firstDelta.events[0].points, 30, '과거 이벤트 점수는 바뀌지 않는다');
  const progressRows = contribution.buildRegionProgress(
    firstDelta.events,
    [stateFromTransition(firstDelta)]
  );
  assert.strictEqual(progressRows[0].completed, 58);
  assert.strictEqual(progressRows[0].target, 100);
  assert.strictEqual(progressRows[0].points, 30);

  const reaching = contribution.computeCaptureTransition(group({
    riderTotals: {
      rider1: { value: 60, name: '기사1', region: '양산', matchKey: '1', raw: {} }
    },
    assignedTarget: 100,
    regionComplete: 105,
    capturedAt: '2026-09-07T10:15:00.000Z'
  }), stateFromTransition(futureRule), configV2);
  assert.strictEqual(reaching.events[0].credited_calls, 41);
  assert.strictEqual(reaching.events[0].points, 820);
  assert.strictEqual(reaching.events[0].region, 'DP000001', '이벤트 지역은 ERP 기사 지역이 아닌 실제 운행센터여야 한다');
  assert.strictEqual(reaching.events[0].raw_json.cappedAtTarget, true);
  assert.strictEqual(reaching.state.frozen, true, '초과 달성 capture 이후 영구 frozen');

  const afterFrozen = contribution.computeCaptureTransition(group({
    riderTotals: {
      rider1: { value: 70, name: '기사1', region: '양산', matchKey: '1', raw: {} }
    },
    regionComplete: 115,
    capturedAt: '2026-09-07T10:20:00.000Z'
  }), stateFromTransition(reaching), configV2);
  assert.strictEqual(afterFrozen.skipped, 'frozen');

  const duplicate = contribution.computeCaptureTransition(
    group(),
    stateFromTransition(baseline),
    configV1
  );
  assert.strictEqual(duplicate.skipped, 'duplicate_or_reverse');

  const activatedDuringEvening = {
    ...configV1,
    activatedAt: '2026-09-07T09:00:00.000Z'
  };
  const lateCurrentSlotSnapshot = contribution.computeCaptureTransition(
    group({ capturedAt: '2026-09-07T10:30:00.000Z' }),
    null,
    activatedDuringEvening
  );
  assert.strictEqual(
    lateCurrentSlotSnapshot.events.length,
    0,
    '활성화 당시 누락된 현재 슬롯 snapshot은 뒤늦게 와도 baseline이어야 한다'
  );

  const futureSlot = contribution.computeCaptureTransition(group({
    platform: 'coupang',
    slotKey: 'POST_DINNER',
    riderTotals: {
      rider1: { value: 2, name: '기사1', region: '양산', matchKey: '1', raw: {} }
    },
    regionComplete: 2,
    capturedAt: '2026-09-07T12:00:00.000Z'
  }), null, activatedDuringEvening);
  assert.strictEqual(futureSlot.events.length, 0, '쿠팡 누적 논피크 첫 capture는 baseline이어야 한다');

  const coupang = contribution.computeCaptureTransition(group({
    platform: 'coupang',
    region: '쿠팡양산',
    vendorOrPartner: '777',
    slotKey: 'LUNCH',
    riderTotals: {
      rider1: { value: 1.8, name: '기사1', region: '쿠팡양산', matchKey: '1', raw: {} }
    },
    regionComplete: 1.8
  }), null, configV1);
  assert.deepStrictEqual(
    [coupang.events[0].count_08, coupang.events[0].count_10, coupang.events[0].points],
    [1, 1, 18]
  );
  assert.strictEqual(coupang.events[0].estimated, true);
  assert.strictEqual(coupang.events[0].raw_json.estimate.exact, true);
  assert.strictEqual(
    contribution.coupangAbsolute({ completeCount: 99, nonPeak: 2.4 }, 'POST_DINNER'),
    2.4,
    '쿠팡 논피크는 전체 완료가 아닌 nonPeak 값만 사용해야 한다'
  );

  const separatedVendors = contribution.aggregateDaily([
    {
      ...coupang.events[0],
      vendor_or_partner: 'vendor-a',
      points: 10,
      credited_calls: 1
    },
    {
      ...coupang.events[0],
      vendor_or_partner: 'vendor-b',
      points: 20,
      credited_calls: 2
    }
  ], []);
  assert.strictEqual(separatedVendors.items.length, 2, '같은 지역 기사라도 쿠팡 vendor별 원장은 분리해야 한다');
  const enrichedRider = contribution.aggregateDaily(
    [firstDelta.events[0]],
    [],
    new Map([['rider1', { erpId: '기사11234', baeminId: 'baemin-rider-1', regionBaemin: 'DP000001' }]])
  ).items[0];
  assert.strictEqual(enrichedRider.erp_id, '기사11234');
  assert.strictEqual(enrichedRider.baemin_id, 'baemin-rider-1');
  assert.strictEqual(enrichedRider.matched, true);
  assert.strictEqual(enrichedRider.assigned_region, 'DP000001');
  assert.strictEqual(enrichedRider.region_matched, true);

  const unmatchedRider = contribution.aggregateDaily(
    [{ ...firstDelta.events[0], rider_id: 'crawl:baemin:ghost', name: '미매칭' }],
    []
  ).items[0];
  assert.strictEqual(unmatchedRider.matched, false);
  assert.strictEqual(unmatchedRider.region_matched, false);

  const regionNormalized = contribution.aggregateDaily(
    [{ ...firstDelta.events[0], region: '과거 ERP 지역' }],
    [{
      ...stateFromTransition(firstDelta),
      region: '실제 운행센터'
    }]
  ).items[0];
  assert.strictEqual(regionNormalized.region, '실제 운행센터', '기존 이벤트도 현재 센터 상태 기준으로 표시해야 한다');

  const weekRange = contribution.contributionWeekRange('2026-09-10');
  assert.deepStrictEqual(weekRange, { fromDate: '2026-09-07', toDate: '2026-09-13' });
  const weekly = contribution.aggregateWeekly([
    { ...firstDelta.events[0], date: '2026-09-07', points: 30, credited_calls: 3 },
    { ...firstDelta.events[0], date: '2026-09-08', points: 20, credited_calls: 2 }
  ], [], new Map([['rider1', { erpId: '기사11234', baeminId: 'baemin-rider-1' }]]));
  assert.strictEqual(weekly.items.length, 1, '주간에는 같은 지역 기사를 한 줄로 합산해야 한다');
  assert.strictEqual(weekly.items[0].points, 50);
  assert.strictEqual(weekly.items[0].credited_calls, 5);
  assert.strictEqual(weekly.items[0].slot_key, 'weekly');

  const serverSource = fs.readFileSync(
    path.join(ROOT, 'server', 'contribution-admin.js'),
    'utf8'
  );
  const indexSource = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
  const baeminPipeline = fs.readFileSync(
    path.join(ROOT, 'server', 'baemin-collect-pipeline.js'),
    'utf8'
  );
  const coupangPipeline = fs.readFileSync(
    path.join(ROOT, 'server', 'coupang-collect-pipeline.js'),
    'utf8'
  );
  const schema = fs.readFileSync(
    path.join(ROOT, 'supabase', 'contribution_ledger_v3.sql'),
    'utf8'
  );

  assert(serverSource.includes("const CONFIG_KEY = 'brem_contribution_ledger_v3_config'"));
  assert(!serverSource.includes(".from('contribution_daily')"), 'legacy daily를 조회하면 안 된다');
  assert(serverSource.includes("if (peakKey === 'LUNCH')"));
  assert(serverSource.includes("if (peakKey === 'DINNER')"));
  assert(serverSource.includes('return nonNegative(parsed.nonPeak)'), '쿠팡 논피크 필드 사용 누락');
  assert(serverSource.includes('const autoRefreshJobs = new Map()'), '자동 크롤 병합 큐 누락');
  assert(serverSource.includes('AUTO_REFRESH_COALESCE_MS'), '크롤 반영 병합 대기 누락');
  assert(!serverSource.includes('AUTO_REFRESH_GAP_MS'), '크롤 캡처를 시간 기준으로 건너뛰면 안 된다');
  assert(serverSource.includes('loadRidersCached'), '기사 목록 반복 조회 캐시 누락');
  assert(serverSource.includes('meta.slotKey = currentCoupangPeakKey'), '쿠팡 매장별 시각 매칭 누락');
  assert(serverSource.includes('function contributionCollectDates'), '영업일 크롤 날짜 범위 누락');
  assert(serverSource.includes('filterItemsForContributionDate'), '영업일 슬롯 필터 누락');
  assert(
    /const date = currentContributionDate\(now\)/.test(serverSource),
    '원장 저장은 크롤 collect_date가 아니라 영업일을 써야 한다'
  );
  assert(
    serverSource.includes('const date = currentContributionDate(options.now || new Date())'),
    '자동 반영 큐도 영업일 기준으로 넘어가야 한다'
  );
  assert(serverSource.includes('function startedBaeminSlotKeys'), '배민 지난 타임 마감 캡처 누락');
  assert(serverSource.includes('ensureContributionHeartbeat'), '기여도 자동 반영 하트비트 누락');
  assert(
    /await freezeEndedStates\(supabase, date, platform, now\);/.test(serverSource),
    '슬롯 마감은 원장 기록 뒤에 해야 한다'
  );
  assert(serverSource.includes('attempt < 5'), '원장 동시 저장 충돌 재시도 누락');
  assert(serverSource.includes('options.autoActivate === true'), '크롤 감지 자동 활성화 누락');
  assert(serverSource.includes('기여도 자동 활성화'), '자동 활성화 결과 안내 누락');
  [
    "app.get('/api/admin/contribution/config'",
    "app.post('/api/admin/contribution/config'",
    "app.post('/api/admin/contribution/activate'",
    "app.get('/api/admin/contribution/events'",
    "app.get('/api/admin/contribution/daily'",
    "app.post('/api/admin/contribution/refresh'"
  ].forEach(route => assert(indexSource.includes(route), `${route} route 누락`));
  assert(
    baeminPipeline.includes("platform: 'baemin'")
      && baeminPipeline.includes('autoActivate: true')
      && !baeminPipeline.includes('await contributionAdmin.scheduleAutoRefresh'),
    '배민 크롤 저장 훅 누락 또는 크롤이 기여도 반영을 기다리면 안 된다'
  );
  assert(
    coupangPipeline.includes("platform: 'coupang'")
      && coupangPipeline.includes('autoActivate: hasRiderDaily')
      && !coupangPipeline.includes('await contributionAdmin.scheduleAutoRefresh'),
    '쿠팡 크롤 저장 훅 누락 또는 크롤이 기여도 반영을 기다리면 안 된다'
  );
  [
    'create table if not exists public.contribution_ledger_events',
    'create table if not exists public.contribution_slot_states',
    'brem_record_contribution_capture_v3',
    'for update',
    'append-only',
    'rule_snapshot jsonb',
    'rider_totals jsonb',
    'frozen_at timestamptz'
  ].forEach(token => assert(schema.includes(token), `schema invariant 누락: ${token}`));

  console.log('contribution ledger v3 tests: OK');
}

run();
