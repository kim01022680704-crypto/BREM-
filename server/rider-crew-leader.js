/**
 * 기사앱 — 조직도 크루장 관리
 * (지역 팀장 regionExposure.leader 와는 별개)
 */
const { getServiceClient } = require('./admin-bootstrap');
const { getRiderMe } = require('./rider-auth');

const ORG_CHART_KEY = 'brem_admin_driver_org_chart_v1';

function formatKstDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function normalizeSettlementWeekStart(dateValue) {
  const seed = String(dateValue || '').trim().slice(0, 10);
  const base = /^\d{4}-\d{2}-\d{2}$/.test(seed) ? seed : formatKstDateKey(new Date());
  const date = new Date(`${base}T12:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return formatKstDateKey(new Date());
  const dow = date.getUTCDay();
  const diff = (dow - 3 + 7) % 7;
  date.setUTCDate(date.getUTCDate() - diff);
  return formatKstDateKey(date);
}

function settlementWeekEnd(weekStart) {
  const startKey = normalizeSettlementWeekStart(weekStart);
  if (!startKey) return '';
  const start = new Date(`${startKey}T12:00:00+09:00`);
  if (Number.isNaN(start.getTime())) return '';
  start.setUTCDate(start.getUTCDate() + 6);
  return formatKstDateKey(start);
}

function isDrivingStatus(statusDesc) {
  const compact = String(statusDesc || '').replace(/\s+/g, '');
  if (!compact) return false;
  if (compact.includes('운행종료') || compact.includes('운행중지') || compact.includes('운행불가')) return false;
  return compact.includes('운행중');
}

function normalizeBaeminUserId(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const m = raw.match(/^(\d+)\.0+$/);
  return m ? m[1] : raw;
}

function baeminIdLookupVariants(value) {
  const raw = normalizeBaeminUserId(value);
  if (!raw) return [];
  const digits = raw.replace(/\D/g, '');
  const stripped = digits.replace(/^0+/, '') || digits;
  const withZero = digits.startsWith('0') ? digits : (digits.length >= 10 ? `0${digits}` : digits);
  return [...new Set([raw, digits, stripped, withZero].filter(Boolean))];
}

async function readOrgChart(supabase) {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', ORG_CHART_KEY)
    .maybeSingle();
  if (error) throw error;
  let raw = data?.value;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = {}; }
  }
  if (!raw || typeof raw !== 'object') raw = {};
  // 일부 저장 경로에서 { value: chart } 중첩
  if (!Array.isArray(raw.nodes) && raw.value && typeof raw.value === 'object') {
    raw = raw.value;
  }
  const nodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  return {
    nodes: nodes.map((node, index) => ({
      id: String(node.id || '').trim() || `node_${index}`,
      label: String(node.label || '').trim() || `박스 ${index + 1}`,
      parentId: node.parentId ? String(node.parentId) : '',
      memberRefs: Array.isArray(node.memberRefs)
        ? node.memberRefs
          .map(ref => ({
            kind: ref?.kind === 'admin' ? 'admin' : 'driver',
            id: String(ref?.id || '').trim()
          }))
          .filter(ref => ref.id)
        : [],
      leaderRef: node.leaderRef && String(node.leaderRef.id || '').trim()
        ? {
          kind: node.leaderRef.kind === 'admin' ? 'admin' : 'driver',
          id: String(node.leaderRef.id).trim()
        }
        : null
    })),
    topRepNodeId: String(raw.topRepNodeId || '').trim()
  };
}

function findCrewBoxForLeader(chart, riderId) {
  const id = String(riderId || '').trim();
  if (!id) return null;
  return (chart.nodes || []).find(node => (
    node.leaderRef?.kind === 'driver' && String(node.leaderRef.id || '') === id
  )) || null;
}

async function findCrewBoxForLeaderResolved(supabase, chart, riderId, rider) {
  const byId = findCrewBoxForLeader(chart, riderId);
  if (byId) return byId;

  const myName = String(rider?.name || '').trim();
  if (!myName) return null;

  const leaderIds = [...new Set(
    (chart.nodes || [])
      .filter(node => node.leaderRef?.kind === 'driver' && node.leaderRef.id)
      .map(node => String(node.leaderRef.id))
  )];
  if (!leaderIds.length) return null;

  const leaders = await loadRidersByIds(supabase, leaderIds);
  const nameToIds = new Map();
  leaders.forEach(row => {
    const name = String(row?.name || '').trim();
    const id = String(row?.id || '').trim();
    if (!name || !id) return;
    if (!nameToIds.has(name)) nameToIds.set(name, []);
    nameToIds.get(name).push(id);
  });
  const matchedIds = nameToIds.get(myName) || [];
  if (matchedIds.length !== 1) return null;
  const matchedId = matchedIds[0];
  return (chart.nodes || []).find(node => (
    node.leaderRef?.kind === 'driver' && String(node.leaderRef.id || '') === matchedId
  )) || null;
}

function collectSubtreeDriverIds(chart, rootNode) {
  if (!rootNode) return [];
  const byId = new Map((chart.nodes || []).map(node => [node.id, node]));
  const seenNodes = new Set();
  const driverIds = new Set();
  const queue = [rootNode.id];
  while (queue.length) {
    const nodeId = queue.shift();
    if (!nodeId || seenNodes.has(nodeId)) continue;
    seenNodes.add(nodeId);
    const node = byId.get(nodeId);
    if (!node) continue;
    (node.memberRefs || []).forEach(ref => {
      if (ref.kind === 'driver' && ref.id) driverIds.add(ref.id);
    });
    (chart.nodes || []).forEach(child => {
      if (child.parentId === nodeId) queue.push(child.id);
    });
  }
  return [...driverIds];
}

async function loadRidersByIds(supabase, driverIds) {
  const ids = [...new Set((driverIds || []).map(id => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return [];
  const rows = [];
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    const { data, error } = await supabase
      .from('riders')
      .select('id,name,phone,baemin_id,coupang_login_id,baemin_region,coupang_region')
      .in('id', chunk);
    if (error) throw error;
    rows.push(...(data || []));
  }
  const byId = new Map(rows.map(row => [String(row.id), row]));
  return ids.map(id => byId.get(id) || { id, name: '', phone: '', baemin_id: '', coupang_login_id: '' });
}

async function loadCallCounts(supabase, driverIds, weekStart, weekEnd, today) {
  const ids = [...new Set((driverIds || []).map(id => String(id || '').trim()).filter(Boolean))];
  const todayMap = new Map();
  const weekMap = new Map();
  const weekBaemin = new Map();
  const weekCoupang = new Map();
  const todayBaemin = new Map();
  const todayCoupang = new Map();
  if (!ids.length) {
    return { todayMap, weekMap, weekBaemin, weekCoupang, todayBaemin, todayCoupang };
  }

  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    const { data, error } = await supabase
      .from('admin_calls')
      .select('driver_id,date,platform,count')
      .in('driver_id', chunk)
      .gte('date', weekStart)
      .lte('date', weekEnd);
    if (error) throw error;
    (data || []).forEach(row => {
      const id = String(row.driver_id || '').trim();
      if (!id) return;
      const day = String(row.date || '').slice(0, 10);
      const count = Math.max(0, Math.round(Number(row.count || 0)));
      const platform = String(row.platform || '').toLowerCase();
      weekMap.set(id, (weekMap.get(id) || 0) + count);
      if (platform === 'baemin') weekBaemin.set(id, (weekBaemin.get(id) || 0) + count);
      if (platform === 'coupang') weekCoupang.set(id, (weekCoupang.get(id) || 0) + count);
      if (day === today) {
        todayMap.set(id, (todayMap.get(id) || 0) + count);
        if (platform === 'baemin') todayBaemin.set(id, (todayBaemin.get(id) || 0) + count);
        if (platform === 'coupang') todayCoupang.set(id, (todayCoupang.get(id) || 0) + count);
      }
    });
  }
  return { todayMap, weekMap, weekBaemin, weekCoupang, todayBaemin, todayCoupang };
}

/**
 * 배민 배달현황 스냅샷에서 운행중·오늘완료콜 매칭
 */
async function loadBaeminLiveByRiders(supabase, riders) {
  const result = new Map();
  const variantToDriver = new Map();
  (riders || []).forEach(rider => {
    const id = String(rider.id || '').trim();
    if (!id) return;
    baeminIdLookupVariants(rider.baemin_id || rider.baeminId).forEach(variant => {
      if (!variantToDriver.has(variant)) variantToDriver.set(variant, id);
    });
  });
  const variants = [...variantToDriver.keys()];
  if (!variants.length) return result;

  const tables = ['baemin_delivery_applied_items', 'baemin_biz_collect_items'];
  for (const table of tables) {
    for (let i = 0; i < variants.length; i += 80) {
      const chunk = variants.slice(i, i + 80);
      const { data, error } = await supabase
        .from(table)
        .select('collected_at,collect_date,rider_user_id,parsed_json')
        .eq('source_menu', 'delivery_status')
        .in('rider_user_id', chunk)
        .order('collected_at', { ascending: false })
        .limit(500);
      if (error) {
        if (/does not exist|Could not find the table/i.test(String(error.message || ''))) break;
        console.warn(`[BREM] crew-leader baemin ops (${table}):`, error.message || error);
        continue;
      }
      (data || []).forEach(row => {
        const driverId = variantToDriver.get(String(row.rider_user_id || '').trim());
        if (!driverId) return;
        const prev = result.get(driverId);
        const collectedAt = Date.parse(row.collected_at || '') || 0;
        if (prev && collectedAt && collectedAt < prev.collectedAt) return;
        const parsed = row.parsed_json || {};
        const complete = Math.max(0, Math.round(Number(parsed.totalComplete || parsed.completeCount || 0)));
        const operating = isDrivingStatus(parsed.statusDesc || parsed.status_desc || '');
        result.set(driverId, {
          operating,
          liveComplete: complete,
          collectDate: String(row.collect_date || '').slice(0, 10),
          collectedAt,
          statusDesc: String(parsed.statusDesc || parsed.status_desc || '').trim()
        });
      });
    }
    if (result.size) break;
  }
  return result;
}

async function getCrewLeaderDashboard(accessToken, options = {}) {
  const me = await getRiderMe(accessToken);
  if (!me.ok) return me;

  const riderId = String(me.rider?.id || '').trim();
  if (!riderId) {
    return { ok: false, status: 401, error: '기사 정보를 확인할 수 없습니다.' };
  }

  const supabase = getServiceClient();
  const chart = await readOrgChart(supabase);
  const box = await findCrewBoxForLeaderResolved(supabase, chart, riderId, me.rider);
  if (!box) {
    return {
      ok: true,
      isCrewLeader: false,
      members: [],
      box: null
    };
  }

  const boxMeta = {
    id: box.id,
    label: box.label,
    isTopRep: chart.topRepNodeId === box.id
  };

  // 버튼 노출용 가벼운 검사 — 콜/운행 집계 생략
  if (options.probe === true) {
    return {
      ok: true,
      isCrewLeader: true,
      probe: true,
      box: boxMeta,
      members: [],
      summary: null
    };
  }

  const memberIds = collectSubtreeDriverIds(chart, box);
  const weekStart = normalizeSettlementWeekStart(options.weekStart);
  const weekEnd = settlementWeekEnd(weekStart);
  const today = formatKstDateKey();

  const riders = await loadRidersByIds(supabase, memberIds);
  const [calls, liveMap] = await Promise.all([
    loadCallCounts(supabase, memberIds, weekStart, weekEnd, today),
    loadBaeminLiveByRiders(supabase, riders)
  ]);

  const members = riders.map(rider => {
    const id = String(rider.id || '').trim();
    const live = liveMap.get(id);
    const todayFromCalls = calls.todayMap.get(id) || 0;
    const weekCalls = calls.weekMap.get(id) || 0;
    // 현재 콜: 배민 라이브 완료가 있으면 그쪽을 우선(오늘 체감), 없으면 콜수 입력 합
    const liveComplete = live?.liveComplete || 0;
    const todayCalls = Math.max(todayFromCalls, liveComplete);
    let operating = null;
    if (live && (live.statusDesc || live.collectedAt)) {
      operating = Boolean(live.operating);
    }
    return {
      driverId: id,
      name: String(rider.name || '').trim() || '이름 없음',
      isSelf: id === riderId,
      operating,
      todayCalls,
      weekCalls,
      totalCalls: weekCalls,
      todayBaemin: Math.max(calls.todayBaemin.get(id) || 0, liveComplete),
      todayCoupang: calls.todayCoupang.get(id) || 0,
      weekBaemin: calls.weekBaemin.get(id) || 0,
      weekCoupang: calls.weekCoupang.get(id) || 0
    };
  }).sort((a, b) => {
    if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
    if (Boolean(a.operating) !== Boolean(b.operating)) return a.operating ? -1 : 1;
    return b.weekCalls - a.weekCalls || String(a.name).localeCompare(String(b.name), 'ko');
  });

  const operatingCount = members.filter(m => m.operating === true).length;
  const knownOps = members.filter(m => m.operating !== null).length;

  return {
    ok: true,
    isCrewLeader: true,
    box: boxMeta,
    weekStart,
    weekEnd,
    today,
    summary: {
      memberCount: members.length,
      operatingCount,
      operatingKnown: knownOps,
      todayCalls: members.reduce((sum, m) => sum + m.todayCalls, 0),
      weekCalls: members.reduce((sum, m) => sum + m.weekCalls, 0)
    },
    members
  };
}

module.exports = {
  getCrewLeaderDashboard,
  ORG_CHART_KEY
};
