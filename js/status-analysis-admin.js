/* 홈 · 대시보드 현황분석. 일정산 행의 콜수·금액·배달거리를 지역별로 집계한다. */
(function () {
  const VIEWS = [
    ['current', '현재 현황'],
    ['region', '지역별현황'],
    ['all', '전체현황'],
    ['trend', '상황추이']
  ];

  // 표 열 정의. value(row) 로 정렬·표시 값을 뽑는다.
  const COLUMNS = [
    { key: 'name', label: '기사', align: 'left', text: true },
    { key: 'rejectRate', label: '거절율', hint: '이 정산주에 입력된 거절율' },
    { key: 'region', label: '지역', align: 'left', text: true, regionOnly: true },
    { key: 'calls', label: '콜수', fmt: v => Math.round(v).toLocaleString('ko-KR') },
    { key: 'deliveryPay', label: '배달비', fmt: money },
    { key: 'meters', label: '배달거리', distance: true, fmt: v => km(v, 1) },
    { key: 'moneyRatio', label: '거리대비', hint: '50콜 이상만. 이 지역 평균(50콜 이상)을 100%로 둔 값. 금액=배달처리비÷거리, 콜=콜수÷거리. 100% 이상 파랑, 미만 빨강', compareOnly: true },
    { key: 'processPay', label: '배달처리비', fmt: money },
    { key: 'unit', label: '평균단가', hint: '배달처리비 ÷ 콜수', fmt: priceCell },
    { key: 'per50', label: '50m 단가', hint: '배달처리비 × 50 ÷ 거리', distance: true, fmt: priceCell },
    { key: 'per100', label: '100m 단가', hint: '배달처리비 × 100 ÷ 거리', distance: true, fmt: priceCell },
    { key: 'per1km', label: '1km 단가', hint: '배달처리비 × 1000 ÷ 거리', distance: true, fmt: priceCell },
    { key: 'avgMeters', label: '평균거리', hint: '배달거리 ÷ 콜수', distance: true, fmt: v => v == null ? '-' : km(v, 2) }
  ];

  const state = {
    view: 'current',
    platform: 'coupang',
    weekStart: '',
    region: '',
    trendRegion: '전체',
    trendMetric: 'calls',
    search: '',
    sortKey: 'calls',
    sortDir: 'desc',
    simOpen: false,
    simRegion: '전체',
    simMode: 'amount',
    simAmount: 200000,
    simKm: 50,
    simCalls: 100,
    bundles: loadBundles(),
    bundleOpen: false,
    bundlePick: [],
    bundleName: ''
  };

  function loadBundles() {
    try {
      const parsed = JSON.parse(localStorage.getItem('brem-status-region-bundles') || '[]');
      return Array.isArray(parsed) ? parsed.filter(item => item && item.name && Array.isArray(item.members)) : [];
    } catch (error) {
      return [];
    }
  }

  function saveBundles() {
    localStorage.setItem('brem-status-region-bundles', JSON.stringify(state.bundles));
  }

  let rangeKey = '';
  let loading = false;

  function todayIso() { return isoOf(new Date()); }

  function isoOf(date) {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
  }

  function weekStartKey(iso) {
    const date = new Date(`${iso}T00:00:00`);
    const diff = (date.getDay() - 3 + 7) % 7;
    date.setDate(date.getDate() - diff);
    return isoOf(date);
  }

  function addDays(iso, days) {
    const date = new Date(`${iso}T00:00:00`);
    date.setDate(date.getDate() + days);
    return isoOf(date);
  }

  function currentWeek() { return weekStartKey(todayIso()); }

  function weekOptions() {
    const current = currentWeek();
    const weeks = [];
    for (let index = 7; index >= 0; index -= 1) weeks.push(addDays(current, -7 * index));
    return weeks;
  }

  function weekLabel(start) {
    return `${start.slice(5).replace('-', '.')}–${addDays(start, 6).slice(5).replace('-', '.')}`;
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  function money(value) {
    return `${Math.round(Number(value) || 0).toLocaleString('ko-KR')}원`;
  }

  function km(meters, digits) {
    const value = Math.max(0, Number(meters) || 0) / 1000;
    return `${value.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}km`;
  }

  function priceCell(value) {
    return value == null ? '-' : money(value);
  }

  function phoneTail(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    return digits.length >= 4 ? digits.slice(-4) : '';
  }

  function regionName(driver, platform) {
    const raw = platform === 'baemin' ? driver?.regionBaemin : driver?.regionCoupang;
    return String(raw || '').trim() || '지역 없음';
  }

  function neededRange() {
    const weeks = weekOptions();
    return { start: weeks[0], end: addDays(weeks[weeks.length - 1], 6) };
  }

  function platformLabel(platform) {
    if (platform === 'all') return '합산';
    return platform === 'baemin' ? '배민' : '쿠팡';
  }

  function hasDistanceData(platform) {
    return platform !== 'baemin';
  }

  function memberKey(platform, region) {
    return `${platform}|${region}`;
  }

  function labelFor(viewPlatform, rowPlatform, rawRegion) {
    if (viewPlatform !== 'all') return rawRegion;
    const key = memberKey(rowPlatform, rawRegion);
    const bundle = state.bundles.find(item => item.members.includes(key));
    if (bundle) return bundle.name;
    return `${rowPlatform === 'baemin' ? '배민' : '쿠팡'}·${rawRegion}`;
  }

  function finalizeMetrics(row, platform) {
    const calls = row.calls || 0;
    const meters = row.meters || 0;
    const distancePay = row.distancePay != null ? Number(row.distancePay) : (platform === 'baemin' ? 0 : row.processPay);
    const hasDistance = hasDistanceData(platform) && meters > 0;
    row.distancePay = distancePay;
    row.unit = calls ? row.processPay / calls : null;
    row.per50 = hasDistance ? (distancePay * 50) / meters : null;
    row.per100 = hasDistance ? (distancePay * 100) / meters : null;
    row.per1km = hasDistance ? (distancePay * 1000) / meters : null;
    row.avgMeters = hasDistance && calls ? meters / calls : null;
    if (!hasDistanceData(platform)) row.meters = 0;
    return row;
  }

  function settlementParts(platform, start, end) {
    const allowed = new Set(platform === 'all' ? ['coupang', 'baemin'] : [platform]);
    const drivers = new Map((BremStorage.drivers?.getAll?.() || []).map(driver => [String(driver.id), driver]));
    const latest = new Map();
    (BremStorage.settlements?.getAll?.() || []).forEach(row => {
      const rowPlatform = String(row.platform || '');
      if (!allowed.has(rowPlatform)) return;
      const day = String(row.period || '').slice(0, 10);
      if (!day || day < start || day > end) return;
      const driverId = String(row.driverId || '');
      if (!driverId) return;
      const key = `${driverId}|${day}|${rowPlatform}`;
      const prev = latest.get(key);
      if (prev && String(row.appliedAt || '') < String(prev.appliedAt || '')) return;
      latest.set(key, row);
    });
    return [...latest.values()].map(row => {
      const rowPlatform = String(row.platform || '');
      const day = String(row.period || '').slice(0, 10);
      const driver = drivers.get(String(row.driverId));
      const rawRegion = driver ? regionName(driver, rowPlatform) : '지역 없음';
      const deliveryPay = Number(row.settlementAmount ?? row.deliveryAmount) || 0;
      const base = Number(row.deductionBase) || 0;
      const processPay = base > 0 ? base : deliveryPay;
      const meters = rowPlatform === 'coupang' ? Math.max(0, Math.round(Number(row.deliveryDistanceM) || 0)) : 0;
      return {
        driverId: String(row.driverId),
        platform: rowPlatform,
        name: driver?.name || '미등록',
        phone: phoneTail(driver?.phone),
        day,
        rawRegion,
        label: labelFor(platform, rowPlatform, rawRegion),
        calls: Number(row.orderCount) || 0,
        outsideCalls: rowPlatform === 'coupang'
          ? Math.max(0, Math.round(Number(row.outsideCallCount) || 0))
          : 0,
        deliveryPay,
        processPay,
        meters,
        distancePay: rowPlatform === 'coupang' ? processPay : 0
      };
    }).filter(part => part.calls > 0 || part.outsideCalls > 0 || part.deliveryPay || part.processPay || part.meters);
  }

  function foldParts(parts, platform) {
    const byDriver = new Map();
    parts.forEach(part => {
      const slot = byDriver.get(part.driverId) || {
        driverId: part.driverId,
        name: part.name,
        phone: part.phone,
        region: part.label,
        calls: 0,
        deliveryPay: 0,
        processPay: 0,
        meters: 0,
        distancePay: 0,
        labels: new Map()
      };
      slot.calls += part.calls;
      slot.deliveryPay += part.deliveryPay;
      slot.processPay += part.processPay;
      slot.meters += part.meters;
      slot.distancePay += part.distancePay;
      slot.labels.set(part.label, (slot.labels.get(part.label) || 0) + part.calls);
      byDriver.set(part.driverId, slot);
    });
    return [...byDriver.values()].map(slot => {
      const labels = [...slot.labels.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'));
      slot.region = labels.length <= 1 ? (labels[0]?.[0] || slot.region) : labels.map(([name]) => name).join(' + ');
      return finalizeMetrics(slot, platform);
    });
  }

  function aggregate(platform, start, end, regionFilter) {
    const parts = settlementParts(platform, start, end)
      .filter(part => !regionFilter || part.label === regionFilter);
    return foldParts(parts, platform);
  }

  function regionBuckets(platform, start, end) {
    const buckets = new Map();
    settlementParts(platform, start, end).forEach(part => {
      const list = buckets.get(part.label) || [];
      list.push(part);
      buckets.set(part.label, list);
    });
    return [...buckets.entries()].map(([label, list]) => [
      label,
      foldParts(list, platform).map(row => ({ ...row, region: label }))
    ]).sort((a, b) => {
      if (a[0] === '지역 없음' || a[0].endsWith('·지역 없음')) return 1;
      if (b[0] === '지역 없음' || b[0].endsWith('·지역 없음')) return -1;
      return b[1].length - a[1].length || a[0].localeCompare(b[0], 'ko');
    });
  }

  function sumRows(rows, platform) {
    const total = rows.reduce((acc, row) => {
      acc.calls += row.calls;
      acc.deliveryPay += row.deliveryPay;
      acc.processPay += row.processPay;
      acc.meters += row.meters;
      acc.distancePay += row.distancePay != null ? row.distancePay : (platform === 'baemin' ? 0 : row.processPay);
      return acc;
    }, { calls: 0, deliveryPay: 0, processPay: 0, meters: 0, distancePay: 0, name: '합계', region: '' });
    return finalizeMetrics(total, platform);
  }

  function matchesSearch(row) {
    const query = state.search.trim().toLowerCase();
    if (!query) return true;
    return `${row.name} ${row.phone}`.toLowerCase().includes(query);
  }

  function sortRows(rows) {
    const key = state.sortKey;
    const dir = state.sortDir === 'asc' ? 1 : -1;
    const column = COLUMNS.find(col => col.key === key);
    return [...rows].sort((a, b) => {
      if (column && column.text) {
        return String(a[key] || '').localeCompare(String(b[key] || ''), 'ko') * dir;
      }
      const av = a[key];
      const bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av === bv) return a.calls === b.calls ? 0 : (a.calls < b.calls ? 1 : -1);
      return (av < bv ? -1 : 1) * dir;
    });
  }

  function sortArrow(key) {
    if (state.sortKey !== key) return '<span class="sa-arrow">⇅</span>';
    return `<span class="sa-arrow is-on">${state.sortDir === 'asc' ? '▲' : '▼'}</span>`;
  }

  function kpiStrip(rows, platform) {
    const total = sumRows(rows, platform);
    const cards = [
      { label: '기사', value: `${rows.length.toLocaleString('ko-KR')}명` },
      { label: '총 콜수', value: `${Math.round(total.calls).toLocaleString('ko-KR')}콜`, accent: true },
      { label: '총 배달처리비', value: money(total.processPay) },
      { label: '평균단가', value: priceCell(total.unit), hint: '처리비 ÷ 콜수' }
    ];
    if (hasDistanceData(platform)) {
      cards.push({ label: '총 배달거리', value: km(total.meters, 1) });
      cards.push({ label: '평균거리', value: total.avgMeters == null ? '-' : km(total.avgMeters, 2), hint: '거리 ÷ 콜수' });
    }
    return `<div class="sa-kpis">${cards.map(card => `
      <div class="sa-kpi${card.accent ? ' sa-kpi--accent' : ''}">
        <span class="sa-kpi__label">${esc(card.label)}</span>
        <strong class="sa-kpi__value">${esc(card.value)}</strong>
        ${card.hint ? `<span class="sa-kpi__hint">${esc(card.hint)}</span>` : ''}
      </div>`).join('')}</div>`;
  }

  function fmtRatio(value) {
    return `${Math.round(value)}%`;
  }

  function ratioClass(value) {
    return value >= 100 ? 'sa-ratio--up' : 'sa-ratio--down';
  }

  // 지역 평균(같은 거리 기준)을 100%로 두고, 기사별 배달처리비·콜수 비율과 주간 거절율을 붙인다.
  function decorateRows(rows, platform, weekStart, comparable) {
    const payOf = row => platform === 'all' ? (Number(row.distancePay) || 0) : row.processPay;
    const basisRows = rows.filter(row => (row.calls || 0) >= 50);
    const basisPay = basisRows.reduce((sum, row) => sum + payOf(row), 0);
    const basisMeters = basisRows.reduce((sum, row) => sum + (row.meters || 0), 0);
    const basisCalls = basisRows.reduce((sum, row) => sum + (row.calls || 0), 0);
    const payPerM = basisMeters ? basisPay / basisMeters : 0;
    const callsPerM = basisMeters ? basisCalls / basisMeters : 0;
    return rows.map(row => {
      const meters = row.meters || 0;
      const counted = (row.calls || 0) >= 50;
      let moneyRatio = null;
      let callRatio = null;
      if (comparable && counted && meters > 0) {
        if (payPerM) moneyRatio = ((payOf(row) / meters) / payPerM) * 100;
        if (callsPerM) callRatio = ((row.calls / meters) / callsPerM) * 100;
      }
      const entry = weekStart && BremStorage.rejections?.getEntryForWeek
        ? BremStorage.rejections.getEntryForWeek(row.driverId, weekStart, platform)
        : null;
      let rejectRate = null;
      let rejectText = '-';
      if (entry) {
        if (entry.stats?.unmeasured || entry.rate == null) {
          rejectText = '미집계';
        } else {
          const rate = Number(entry.rate);
          if (Number.isFinite(rate)) {
            rejectRate = rate;
            rejectText = `${rate % 1 === 0 ? String(rate) : rate.toFixed(1)}%`;
          }
        }
      }
      return { ...row, moneyRatio, callRatio, rejectRate, rejectText };
    });
  }

  function tableHtml(rows, platform, options) {
    const opts = options || {};
    const withRegion = opts.withRegion === true;
    const rank = opts.rank !== false;
    const comparable = hasDistanceData(platform) && !withRegion;
    const columns = COLUMNS.filter(col => (!col.regionOnly || withRegion) && (!col.compareOnly || comparable));
    const enriched = decorateRows(rows, platform, opts.weekStart || '', comparable);
    const sorted = sortRows(enriched.filter(matchesSearch));
    const total = sumRows(rows, platform);

    const head = columns.map(col => {
      const align = col.align === 'left' ? ' sa-left' : '';
      const nameCol = col.key === 'name' ? ' sa-namecol' : '';
      return `<th class="${align.trim()}${nameCol}" data-sa-sort="${col.key}" title="${esc(col.hint || col.label)}">
        <span class="sa-th">${esc(col.label)}${sortArrow(col.key)}</span>
      </th>`;
    }).join('');

    const body = sorted.map((row, index) => {
      const cells = columns.map(col => {
        if (col.key === 'name') {
          const badge = rank ? `<span class="sa-rank">${index + 1}</span>` : '';
          const phone = row.phone ? `<span class="sa-sub">${esc(row.phone)}</span>` : '';
          return `<td class="sa-left sa-namecol"><div class="sa-name">${badge}<span>${esc(row.name)}</span>${phone}</div></td>`;
        }
        if (col.key === 'region') return `<td class="sa-left">${esc(row.region)}</td>`;
        if (col.key === 'rejectRate') return `<td>${esc(row.rejectText || '-')}</td>`;
        if (col.key === 'moneyRatio') {
          if (row.moneyRatio == null && row.callRatio == null) return '<td>-</td>';
          const money = row.moneyRatio == null ? '' : `<span class="sa-ratio__line ${ratioClass(row.moneyRatio)}">금액 ${fmtRatio(row.moneyRatio)}</span>`;
          const call = row.callRatio == null ? '' : `<span class="sa-ratio__line ${ratioClass(row.callRatio)}">콜 ${fmtRatio(row.callRatio)}</span>`;
          return `<td class="sa-ratio">${money}${call}</td>`;
        }
        const value = col.distance && !hasDistanceData(platform) ? '-' : col.fmt(row[col.key]);
        return `<td>${value}</td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    const measuredReject = enriched.filter(row => row.rejectRate != null);
    const rejectAvg = measuredReject.length
      ? measuredReject.reduce((sum, row) => sum + row.rejectRate, 0) / measuredReject.length
      : null;
    const footCells = columns.map((col, index) => {
      if (index === 0) return `<td class="sa-left sa-namecol">합계 ${sorted.length}명</td>`;
      if (col.key === 'region') return '<td></td>';
      if (col.key === 'rejectRate') return `<td>${rejectAvg == null ? '-' : `${rejectAvg.toFixed(1)}%`}</td>`;
      if (col.key === 'moneyRatio') return '<td class="sa-ratio"><span class="sa-ratio__line">기준 100%</span></td>';
      const value = col.distance && !hasDistanceData(platform) ? '-' : col.fmt(total[col.key]);
      return `<td>${value}</td>`;
    }).join('');

    const emptyMsg = state.search.trim()
      ? '검색 결과가 없습니다.'
      : '이 기간에 일정산이 없습니다.';

    return `
      <div class="sa-scroll">
        <table class="sa-table">
          <thead><tr>${head}</tr></thead>
          <tbody>${body || `<tr><td class="sa-empty" colspan="${columns.length}">${emptyMsg}</td></tr>`}</tbody>
          ${sorted.length ? `<tfoot><tr>${footCells}</tr></tfoot>` : ''}
        </table>
      </div>`;
  }

  function groupByRegion(rows) {
    const groups = new Map();
    rows.forEach(row => {
      const list = groups.get(row.region) || [];
      list.push(row);
      groups.set(row.region, list);
    });
    return [...groups.entries()].sort((a, b) => {
      if (a[0] === '지역 없음') return 1;
      if (b[0] === '지역 없음') return -1;
      return b[1].length - a[1].length || a[0].localeCompare(b[0], 'ko');
    });
  }

  // 시뮬레이션 기준 단가: 선택 지역/주의 집계에서 배달처리비 기준 단가를 뽑는다.
  function simBasis(platform, start, end, regionFilter) {
    const parts = settlementParts(platform, start, end)
      .filter(part => !regionFilter || part.label === regionFilter);
    let calls = 0;
    let processPay = 0;
    let distancePay = 0;
    let meters = 0;
    const riders = new Set();
    const days = new Set();
    parts.forEach(part => {
      calls += part.calls;
      processPay += part.processPay;
      distancePay += part.distancePay;
      meters += part.meters;
      riders.add(part.driverId);
      if (part.day) days.add(part.day);
    });
    return {
      calls,
      processPay,
      meters,
      riders: riders.size,
      days: days.size,
      perCall: calls ? processPay / calls : 0,
      perKm: meters ? (distancePay * 1000) / meters : 0,
      kmPerCall: calls ? meters / calls / 1000 : 0,
      dailyPerRider: (riders.size && days.size) ? calls / riders.size / days.size : 0
    };
  }

  function simNumber(value, suffix, digits) {
    if (value == null || !isFinite(value)) return '-';
    const rounded = digits ? Number(value).toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : Math.round(value).toLocaleString('ko-KR');
    return `${rounded}${suffix}`;
  }

  function simulationSection(platform, week, regions) {
    const end = addDays(week, 6);
    const simRegions = ['전체'].concat(regions);
    const simRegion = simRegions.includes(state.simRegion) ? state.simRegion : '전체';
    state.simRegion = simRegion;
    const basis = simBasis(platform, week, end, simRegion === '전체' ? '' : simRegion);
    const hasDistance = hasDistanceData(platform) && basis.meters > 0;

    const modes = [['amount', '금액 → 거리·콜'], ['distance', '거리 → 금액·콜'], ['calls', '콜수 → 금액·거리']];
    const activeMode = modes.some(m => m[0] === state.simMode) ? state.simMode : 'amount';
    state.simMode = activeMode;

    const inputValue = activeMode === 'amount' ? state.simAmount : activeMode === 'distance' ? state.simKm : state.simCalls;
    const inputUnit = activeMode === 'amount' ? '원' : activeMode === 'distance' ? 'km' : '콜';
    const inputLabel = activeMode === 'amount' ? '목표 금액' : activeMode === 'distance' ? '예상 주행거리' : '예상 콜수';

    let results = [];
    if (activeMode === 'amount') {
      const amt = Number(state.simAmount) || 0;
      const km = basis.perKm ? amt / basis.perKm : null;
      const calls = basis.perCall ? amt / basis.perCall : null;
      results = [
        { label: '필요 주행거리', value: hasDistance ? simNumber(km, 'km', 1) : '-', accent: true },
        { label: '필요 콜수', value: simNumber(calls, '콜'), accent: true }
      ];
    } else if (activeMode === 'distance') {
      const km = Number(state.simKm) || 0;
      const amt = hasDistance ? km * basis.perKm : null;
      const calls = basis.kmPerCall ? km / basis.kmPerCall : null;
      results = [
        { label: '예상 배달처리비', value: hasDistance ? simNumber(amt, '원') : '-', accent: true },
        { label: '예상 콜수', value: hasDistance ? simNumber(calls, '콜') : '-', accent: true }
      ];
    } else {
      const calls = Number(state.simCalls) || 0;
      const amt = basis.perCall ? calls * basis.perCall : null;
      const km = hasDistance ? calls * basis.kmPerCall : null;
      results = [
        { label: '예상 배달처리비', value: simNumber(amt, '원'), accent: true },
        { label: '예상 주행거리', value: hasDistance ? simNumber(km, 'km', 1) : '-', accent: true }
      ];
    }

    const regionSelect = `<select id="saSimRegion" class="sa-select" data-readonly-allow="true" aria-label="시뮬레이션 지역">
      ${simRegions.map(name => `<option value="${esc(name)}" ${name === simRegion ? 'selected' : ''}>${esc(name)}</option>`).join('')}
    </select>`;

    const modeTabs = `<div class="sa-seg sa-sim-modes">
      ${modes.map(([id, label]) => `<button type="button" class="sa-pill ${activeMode === id ? 'is-on' : ''}" data-sa-sim-mode="${id}" data-readonly-allow="true">${label}</button>`).join('')}
    </div>`;

    const input = `<label class="sa-sim-input">
      <span>${inputLabel}</span>
      <span class="sa-sim-input__box">
        <input id="saSimInput" type="text" inputmode="numeric" value="${esc(Number(inputValue).toLocaleString('ko-KR'))}" data-readonly-allow="true" autocomplete="off">
        <em>${inputUnit}</em>
      </span>
    </label>`;

    const resultCards = results.map(r => `
      <div class="sa-sim-card${r.accent ? ' is-accent' : ''}">
        <span class="sa-sim-card__label">${esc(r.label)}</span>
        <strong class="sa-sim-card__value">${esc(r.value)}</strong>
      </div>`).join('');

    // 금액별 환산표 (10만~100만 배달처리비 목표)
    const presets = [100000, 200000, 300000, 500000, 700000, 1000000];
    const presetRows = presets.map(amt => {
      const km = basis.perKm ? amt / basis.perKm : null;
      const calls = basis.perCall ? amt / basis.perCall : null;
      return `<tr>
        <td class="sa-left">${money(amt)}</td>
        <td>${hasDistance ? simNumber(km, 'km', 1) : '-'}</td>
        <td>${simNumber(calls, '콜')}</td>
      </tr>`;
    }).join('');
    const presetTable = basis.calls ? `
      <div class="sa-region__head" style="margin-top:14px">
        <h3>금액별 환산표</h3>
        <span class="sa-region__meta">배달처리비 목표 기준</span>
      </div>
      <div class="sa-scroll">
        <table class="sa-table">
          <thead><tr><th class="sa-left">목표 금액</th><th>필요 주행거리</th><th>필요 콜수</th></tr></thead>
          <tbody>${presetRows}</tbody>
        </table>
      </div>` : '';

    // 지역별 환산표: 입력값을 각 지역 단가로 따로 계산 (지역마다 거리가 다름)
    const amtIn = Number(state.simAmount) || 0;
    const kmIn = Number(state.simKm) || 0;
    const callsIn = Number(state.simCalls) || 0;
    const perRegion = regions.map(region => {
      const b = simBasis(platform, week, end, region);
      const rHasDist = hasDistanceData(platform) && b.meters > 0;
      let km = null, calls = null, amtOut = null;
      if (activeMode === 'amount') {
        km = rHasDist && b.perKm ? amtIn / b.perKm : null;
        calls = b.perCall ? amtIn / b.perCall : null;
      } else if (activeMode === 'distance') {
        amtOut = rHasDist ? kmIn * b.perKm : null;
        calls = rHasDist && b.kmPerCall ? kmIn / b.kmPerCall : null;
      } else {
        amtOut = b.perCall ? callsIn * b.perCall : null;
        km = rHasDist ? callsIn * b.kmPerCall : null;
      }
      return { region, b, rHasDist, km, calls, amtOut };
    }).filter(x => x.b.calls);

    perRegion.sort((a, b) => {
      if (activeMode === 'amount') {
        const av = a.km == null ? Infinity : a.km;
        const bv = b.km == null ? Infinity : b.km;
        return av - bv;
      }
      const av = a.amtOut == null ? -Infinity : a.amtOut;
      const bv = b.amtOut == null ? -Infinity : b.amtOut;
      return bv - av;
    });

    let perRegionHead = '';
    let perRegionBody = '';
    if (activeMode === 'amount') {
      perRegionHead = '<th class="sa-left">지역</th><th>필요 주행거리</th><th>필요 콜수</th><th>km당 단가</th>';
      perRegionBody = perRegion.map(x => `<tr>
        <td class="sa-left">${esc(x.region)}</td>
        <td>${x.rHasDist ? simNumber(x.km, 'km', 1) : '-'}</td>
        <td>${simNumber(x.calls, '콜')}</td>
        <td>${x.rHasDist ? simNumber(x.b.perKm, '원') : '-'}</td>
      </tr>`).join('');
    } else if (activeMode === 'distance') {
      perRegionHead = '<th class="sa-left">지역</th><th>예상 배달처리비</th><th>예상 콜수</th><th>km당 단가</th>';
      perRegionBody = perRegion.map(x => `<tr>
        <td class="sa-left">${esc(x.region)}</td>
        <td>${x.rHasDist ? simNumber(x.amtOut, '원') : '-'}</td>
        <td>${x.rHasDist ? simNumber(x.calls, '콜') : '-'}</td>
        <td>${x.rHasDist ? simNumber(x.b.perKm, '원') : '-'}</td>
      </tr>`).join('');
    } else {
      perRegionHead = '<th class="sa-left">지역</th><th>예상 배달처리비</th><th>예상 주행거리</th><th>콜당 단가</th>';
      perRegionBody = perRegion.map(x => `<tr>
        <td class="sa-left">${esc(x.region)}</td>
        <td>${simNumber(x.amtOut, '원')}</td>
        <td>${x.rHasDist ? simNumber(x.km, 'km', 1) : '-'}</td>
        <td>${simNumber(x.b.perCall, '원')}</td>
      </tr>`).join('');
    }

    const perRegionTitle = activeMode === 'amount'
      ? `목표 ${money(amtIn)} 기준`
      : activeMode === 'distance'
        ? `주행 ${simNumber(kmIn, 'km', 0)} 기준`
        : `${simNumber(callsIn, '콜')} 기준`;

    const perRegionTable = perRegion.length ? `
      <div class="sa-region__head" style="margin-top:14px">
        <h3>지역별 환산표</h3>
        <span class="sa-region__meta">${esc(perRegionTitle)} · 지역마다 단가·거리가 다름</span>
      </div>
      <div class="sa-scroll">
        <table class="sa-table">
          <thead><tr>${perRegionHead}</tr></thead>
          <tbody>${perRegionBody}</tbody>
        </table>
      </div>` : '';

    const basisLine = basis.calls
      ? `기준(${esc(simRegion)} · ${weekLabel(week)}): 콜당 ${simNumber(basis.perCall, '원')}${hasDistance ? ` · km당 ${simNumber(basis.perKm, '원')} · 콜당 ${simNumber(basis.kmPerCall, 'km', 2)}` : ''}`
      : '이 주·지역의 일정산 데이터가 없어 계산할 수 없습니다.';

    const baeminNote = platform === 'baemin' ? '<p class="sa-note">배민은 거리 데이터가 없어 거리 환산은 제공되지 않습니다.</p>' : '';

    return `
      <div class="sa-sim-bar">
        ${regionSelect}
        ${modeTabs}
        ${input}
      </div>
      <div class="sa-sim-results">${resultCards}</div>
      ${presetTable}
      ${perRegionTable}
      <p class="sa-note">${basisLine}</p>
      ${baeminNote}
      <p class="sa-note sa-sim-warn">※ 평균 단가를 고정한 선형 추정입니다. 실제 수익은 거리·시간대·프로모션에 따라 달라질 수 있습니다.</p>`;
  }

  function chartSvg(points, color, suffix, formatter) {
    const width = 860;
    const height = 360;
    const pad = { left: 70, right: 24, top: 40, bottom: 48 };
    const max = Math.max(...points.map(point => point.value), 1);
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;
    const ticks = 4;
    const grid = [];
    for (let i = 0; i <= ticks; i += 1) {
      const y = pad.top + (innerH / ticks) * i;
      const value = max * (1 - i / ticks);
      grid.push(`<line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${width - pad.right}" y2="${y.toFixed(1)}" stroke="#2a2a2a"/>`);
      grid.push(`<text x="${pad.left - 10}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="13" fill="#9a9aa2">${esc(formatter(value))}</text>`);
    }
    const coords = points.map((point, index) => {
      const x = pad.left + (points.length === 1 ? innerW / 2 : (index / (points.length - 1)) * innerW);
      const y = pad.top + innerH - (point.value / max) * innerH;
      return { ...point, x, y };
    });
    const area = `${coords.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} L${coords[coords.length - 1].x.toFixed(1)},${(pad.top + innerH).toFixed(1)} L${coords[0].x.toFixed(1)},${(pad.top + innerH).toFixed(1)} Z`;
    const line = coords.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const dots = coords.map(p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5" fill="${color}" stroke="#141414" stroke-width="2"><title>${esc(p.label)} · ${esc(p.text)}</title></circle>`).join('');
    const valueLabels = coords.map(p => {
      const above = p.y > pad.top + 26;
      const vy = above ? p.y - 14 : p.y + 20;
      return `<text x="${p.x.toFixed(1)}" y="${vy.toFixed(1)}" text-anchor="middle" font-size="13" font-weight="700" fill="${color}">${esc(p.text)}</text>`;
    }).join('');
    const labels = coords.map(p => `<text x="${p.x.toFixed(1)}" y="${height - 14}" text-anchor="middle" font-size="12" fill="#9a9aa2">${esc(p.label)}</text>`).join('');
    return `
      <svg class="sa-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img">
        ${grid.join('')}
        <path d="${area}" fill="${color}" fill-opacity="0.14"/>
        <path d="${line}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round"/>
        ${dots}${valueLabels}${labels}
      </svg>`;
  }

  function chartMulti(xLabels, series, formatter, options) {
    const opts = options || {};
    const width = 860;
    const height = opts.height || 280;
    const pad = { left: opts.padLeft || 68, right: 24, top: 44, bottom: opts.rotate ? 78 : 44 };
    const max = Math.max(1, ...series.flatMap(s => s.values));
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;
    const n = xLabels.length;
    const xOf = i => pad.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const yOf = v => pad.top + innerH - (v / max) * innerH;
    const ticks = 4;
    const ink = opts.print
      ? { grid: '#e7e5e4', axis: '#57534e', legend: '#1c1917', dot: '#ffffff' }
      : { grid: '#2a2a2a', axis: '#9a9aa2', legend: '#d4d4d8', dot: '#141414' };
    const grid = [];
    if (opts.print) grid.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);
    for (let i = 0; i <= ticks; i += 1) {
      const y = pad.top + (innerH / ticks) * i;
      const value = max * (1 - i / ticks);
      grid.push(`<line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${width - pad.right}" y2="${y.toFixed(1)}" stroke="${ink.grid}"/>`);
      grid.push(`<text x="${pad.left - 10}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="12" fill="${ink.axis}">${esc(formatter(value))}</text>`);
    }
    const paths = series.map(s => {
      const line = s.values.map((v, i) => `${i ? 'L' : 'M'}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ');
      const dots = s.values.map((v, i) => `<circle cx="${xOf(i).toFixed(1)}" cy="${yOf(v).toFixed(1)}" r="4" fill="${s.color}" stroke="${ink.dot}" stroke-width="2"><title>${esc(xLabels[i])} · ${esc(s.name)} ${esc(formatter(v))}</title></circle>`).join('');
      let valueLabels = '';
      if (opts.showValues) {
        valueLabels = s.values.map((v, i) => {
          const y = yOf(v);
          const above = y > pad.top + 24;
          return `<text x="${xOf(i).toFixed(1)}" y="${(above ? y - 10 : y + 18).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="700" fill="${s.color}">${esc(formatter(v))}</text>`;
        }).join('');
      }
      if (opts.markTurning) {
        const vals = s.values;
        const first = vals.findIndex(v => v > 0);
        let last = -1;
        for (let i = vals.length - 1; i >= 0; i -= 1) { if (vals[i] > 0) { last = i; break; } }
        const mark = (i, above) => {
          const x = xOf(i);
          const y = yOf(vals[i]);
          const ty = above ? Math.max(pad.top + 12, y - 12) : y + 20;
          return `<text x="${x.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="middle" font-size="12" font-weight="800" fill="${s.color}">${esc((above ? '▲' : '▼') + formatter(vals[i]))}</text>`;
        };
        if (first >= 0 && last > first) {
          const marks = [mark(first, vals[first] >= vals[first + 1])];
          for (let i = first + 1; i < last; i += 1) {
            const prev = vals[i - 1];
            const next = vals[i + 1];
            if (vals[i] > prev && vals[i] >= next && vals[i] > next) marks.push(mark(i, true));
            else if (vals[i] < prev && vals[i] <= next && vals[i] < next) marks.push(mark(i, false));
          }
          marks.push(mark(last, vals[last] >= vals[last - 1]));
          valueLabels += marks.join('');
        }
      }
      return `<path d="${line}" fill="none" stroke="${s.color}" stroke-width="3" stroke-linejoin="round"/>${dots}${valueLabels}`;
    }).join('');
    const labels = xLabels.map((lab, i) => {
      const x = xOf(i);
      if (opts.rotate) {
        const ly = height - pad.bottom + 16;
        return `<text x="${x.toFixed(1)}" y="${ly.toFixed(1)}" transform="rotate(-45 ${x.toFixed(1)} ${ly.toFixed(1)})" text-anchor="end" font-size="11" fill="${ink.axis}">${esc(lab)}</text>`;
      }
      return `<text x="${x.toFixed(1)}" y="${height - 14}" text-anchor="middle" font-size="11" fill="${ink.axis}">${esc(lab)}</text>`;
    }).join('');
    const legend = series.map((s, i) => `<g transform="translate(${pad.left + i * 110}, 14)"><rect width="13" height="13" rx="3" fill="${s.color}"/><text x="19" y="12" font-size="13" font-weight="700" fill="${ink.legend}">${esc(s.name)}</text></g>`).join('');
    return `
      <svg xmlns="http://www.w3.org/2000/svg" class="sa-chart sa-chart--multi" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif">
        ${grid.join('')}${legend}${paths}${labels}
      </svg>`;
  }

  function miniChart(points, color) {
    const width = 220;
    const height = 70;
    const max = Math.max(...points.map(point => point.value), 1);
    const coords = points.map((point, index) => {
      const x = 6 + (points.length === 1 ? (width - 12) / 2 : (index / (points.length - 1)) * (width - 12));
      const y = 8 + (height - 16) - (point.value / max) * (height - 16);
      return `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return `<svg class="sa-mini" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img">
      <path d="${coords}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/>
    </svg>`;
  }

  function searchBox() {
    return `<input id="saSearch" class="sa-search" type="search" placeholder="기사 이름·전화 뒤4자리 검색" value="${esc(state.search)}" data-readonly-allow="true" autocomplete="off">`;
  }

  function weekSelect(show) {
    if (!show) return '';
    const weeks = weekOptions();
    const selected = state.weekStart || currentWeek();
    const index = weeks.indexOf(selected);
    const isCurrent = selected === currentWeek();
    const prevOff = index <= 0 ? 'disabled' : '';
    const nextOff = index < 0 || index >= weeks.length - 1 ? 'disabled' : '';
    return `<div class="sa-weeknav" role="group" aria-label="정산주 선택">
      <button type="button" class="sa-weeknav__btn" data-sa-week-step="-1" ${prevOff} data-readonly-allow="true" aria-label="이전 주">‹</button>
      <select id="saWeek" class="sa-select sa-select--week" data-readonly-allow="true" aria-label="정산주">
        ${weeks.map(week => `<option value="${week}" ${week === selected ? 'selected' : ''}>수 ${weekLabel(week)}${week === currentWeek() ? ' · 이번주' : ''}</option>`).join('')}
      </select>
      <button type="button" class="sa-weeknav__btn" data-sa-week-step="1" ${nextOff} data-readonly-allow="true" aria-label="다음 주">›</button>
      ${isCurrent ? '' : '<button type="button" class="sa-weeknav__now" data-sa-week-now="1" data-readonly-allow="true">이번주</button>'}
    </div>`;
  }

  function controls(extra) {
    return `
      <div class="sa-bar">
        <div class="sa-tabs" role="tablist">
          ${VIEWS.map(([id, label]) => `<button type="button" class="sa-tab ${state.view === id ? 'is-on' : ''}" data-sa-view="${id}" data-readonly-allow="true">${label}</button>`).join('')}
        </div>
        <div class="sa-seg">
          <button type="button" class="sa-pill ${state.view === 'all' || state.platform === 'coupang' ? 'is-on' : ''}" data-sa-platform="coupang" data-readonly-allow="true">쿠팡</button>
          <button type="button" class="sa-pill ${state.view === 'all' || state.platform === 'baemin' ? 'is-on' : ''}" data-sa-platform="baemin" data-readonly-allow="true">배민</button>
          <button type="button" class="sa-pill ${state.view === 'all' || state.platform === 'all' ? 'is-on' : ''}" data-sa-platform="all" data-readonly-allow="true">합산</button>
        </div>
        ${state.view === 'all' || state.platform === 'all' ? '<button type="button" class="sa-bundle-open" data-sa-bundle-open="1" data-readonly-allow="true">지역 묶기</button>' : ''}
        <div class="sa-filters">${extra || ''}</div>
      </div>`;
  }

  function dailyBandMap(platform, start, end) {
    const days = new Map();
    settlementParts(platform, start, end).forEach(part => {
      const key = `${part.label}|${part.driverId}|${part.day}`;
      const slot = days.get(key) || { label: part.label, driverId: part.driverId, calls: 0, pay: 0, meters: 0 };
      slot.calls += part.calls;
      slot.pay += Number(part.processPay) || 0;
      slot.meters += part.meters;
      days.set(key, slot);
    });
    const map = new Map();
    days.forEach(part => {
      const band = Math.abs(part.pay - 150000) <= 5000 ? '15' : (Math.abs(part.pay - 200000) <= 5000 ? '20' : '');
      if (!band) return;
      const slot = map.get(part.label) || {
        n15: 0, c15: 0, m15: 0, d15: 0, p15: new Set(),
        n20: 0, c20: 0, m20: 0, d20: 0, p20: new Set()
      };
      slot[`n${band}`] += 1;
      slot[`p${band}`].add(part.driverId);
      slot[`c${band}`] += part.calls;
      if (part.meters > 0) {
        slot[`m${band}`] += part.meters;
        slot[`d${band}`] += 1;
      }
      map.set(part.label, slot);
    });
    return map;
  }

  function bandCell(slot, band, showKm) {
    if (!slot || !slot[`n${band}`]) return '-';
    const days = slot[`n${band}`];
    const calls = slot[`c${band}`] / days;
    const callText = `${calls.toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}콜`;
    let kmText = '';
    if (showKm) {
      kmText = slot[`d${band}`]
        ? ` · ${(slot[`m${band}`] / slot[`d${band}`] / 1000).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}km`
        : ' · -';
    }
    const people = slot[`p${band}`] ? slot[`p${band}`].size : days;
    return `<span class="sa-band">${callText}${kmText}<small>${people}명</small></span>`;
  }

  function summaryData(platform, grouped, start, end) {
    const bands = dailyBandMap(platform, start, end);
    return grouped.map(([region, list]) => {
      const row = finalizeMetrics({ ...sumRows(list, platform), region, riders: list.length }, platform);
      const band = bands.get(region);
      const pct = min => list.length ? (list.filter(r => (r.calls || 0) >= min).length / list.length) * 100 : null;
      const cnt = min => list.filter(r => (r.calls || 0) >= min).length;
      return {
        region,
        riders: list.length,
        calls: Math.round(row.calls),
        avgCalls: list.length ? row.calls / list.length : null,
        p250: pct(250), n250: cnt(250),
        p300: pct(300), n300: cnt(300),
        p350: pct(350), n350: cnt(350),
        p400: pct(400), n400: cnt(400),
        deliveryPay: Math.round(row.deliveryPay),
        km: row.meters ? row.meters / 1000 : (hasDistanceData(platform) ? 0 : null),
        processPay: Math.round(row.processPay),
        unit: row.unit,
        per50: row.per50, per100: row.per100, per1km: row.per1km,
        avgKm: row.avgMeters == null ? null : row.avgMeters / 1000,
        band15calls: band && band.n15 ? band.c15 / band.n15 : null,
        band15km: band && band.d15 ? band.m15 / band.d15 / 1000 : null,
        band15people: band && band.n15 ? band.p15.size : null,
        band20calls: band && band.n20 ? band.c20 / band.n20 : null,
        band20km: band && band.d20 ? band.m20 / band.d20 / 1000 : null,
        band20people: band && band.n20 ? band.p20.size : null
      };
    });
  }

  function exportCols(withDistance) {
    const cols = [
      { h: '지역', key: 'region', w: 16 },
      { h: '기사수', key: 'riders', w: 8, z: '#,##0"명"' },
      { h: '총콜수', key: 'calls', w: 10, z: '#,##0' },
      { h: '평균콜수', key: 'avgCalls', w: 9, z: '0.0' },
      { h: '250건↑', key: 'p250', w: 8, z: '0"%"' },
      { h: '(명)', key: 'n250', w: 6, z: '#,##0' },
      { h: '300건↑', key: 'p300', w: 8, z: '0"%"' },
      { h: '(명)', key: 'n300', w: 6, z: '#,##0' },
      { h: '350건↑', key: 'p350', w: 8, z: '0"%"' },
      { h: '(명)', key: 'n350', w: 6, z: '#,##0' },
      { h: '400건↑', key: 'p400', w: 8, z: '0"%"' },
      { h: '(명)', key: 'n400', w: 6, z: '#,##0' },
      { h: '배달비', key: 'deliveryPay', w: 13, z: '#,##0' }
    ];
    if (withDistance) cols.push({ h: '배달거리(km)', key: 'km', w: 11, z: '#,##0.0' });
    cols.push({ h: '배달처리비', key: 'processPay', w: 13, z: '#,##0' });
    cols.push({ h: '평균단가', key: 'unit', w: 9, z: '#,##0' });
    if (withDistance) {
      cols.push({ h: '50m단가', key: 'per50', w: 8, z: '#,##0' });
      cols.push({ h: '100m단가', key: 'per100', w: 8, z: '#,##0' });
      cols.push({ h: '1km단가', key: 'per1km', w: 9, z: '#,##0' });
      cols.push({ h: '평균거리(km)', key: 'avgKm', w: 11, z: '0.00' });
    }
    cols.push({ h: '15만 평균콜', key: 'band15calls', w: 10, z: '0.0' });
    if (withDistance) cols.push({ h: '15만 평균km', key: 'band15km', w: 10, z: '0.0' });
    cols.push({ h: '15만 인원', key: 'band15people', w: 9, z: '#,##0"명"' });
    cols.push({ h: '20만 평균콜', key: 'band20calls', w: 10, z: '0.0' });
    if (withDistance) cols.push({ h: '20만 평균km', key: 'band20km', w: 10, z: '0.0' });
    cols.push({ h: '20만 인원', key: 'band20people', w: 9, z: '#,##0"명"' });
    return cols;
  }

  var EXPORT_DISTANCE_KEYS = ['km', 'per50', 'per100', 'per1km', 'avgKm', 'band15km', 'band20km'];

  function exportThinBorder() {
    const side = { style: 'thin', color: { argb: 'FFD9D9D9' } };
    return { top: side, bottom: side, left: side, right: side };
  }

  function exportSection(ws, cols, startRow, sectionTitle, data, withDistance) {
    const total = cols.length;
    const distanceKeys = new Set(EXPORT_DISTANCE_KEYS);

    ws.mergeCells(startRow, 1, startRow, total);
    const head = ws.getCell(startRow, 1);
    head.value = sectionTitle;
    head.font = { bold: true, size: 13, color: { argb: 'FF1A1A1A' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE4B0' } };
    head.alignment = { vertical: 'middle', horizontal: 'left' };
    ws.getRow(startRow).height = 22;

    let r = startRow + 1;
    const headerRow = ws.getRow(r);
    cols.forEach((col, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = col.h;
      cell.font = { bold: true, color: { argb: 'FF1A1A1A' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD400' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = exportThinBorder();
    });
    headerRow.height = 30;
    r += 1;

    if (!data.length) {
      ws.mergeCells(r, 1, r, total);
      const empty = ws.getCell(r, 1);
      empty.value = '데이터가 없습니다.';
      empty.alignment = { horizontal: 'center' };
      empty.font = { color: { argb: 'FF999999' } };
      return r + 2;
    }

    data.forEach((row, idx) => {
      const dataRow = ws.getRow(r);
      cols.forEach((col, i) => {
        const cell = dataRow.getCell(i + 1);
        let value = row[col.key];
        if (!withDistance && distanceKeys.has(col.key)) value = null;
        cell.value = value == null ? '-' : value;
        if (col.z && value != null) cell.numFmt = col.z;
        cell.alignment = { vertical: 'middle', horizontal: col.key === 'region' ? 'left' : 'right' };
        cell.border = exportThinBorder();
        if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F7F7' } };
      });
      dataRow.height = 18;
      r += 1;
    });
    return r + 1;
  }

  async function exportExcel(week) {
    if (!window.ExcelJS) {
      alert('엑셀 모듈을 불러오는 중입니다. 잠시 후 다시 시도해주세요.');
      return;
    }
    const end = addDays(week, 6);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'BREM';
    const cols = exportCols(true);
    const total = cols.length;
    const ws = wb.addWorksheet('전체현황', {
      pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } }
    });
    cols.forEach((col, i) => { ws.getColumn(i + 1).width = col.w; });

    ws.mergeCells(1, 1, 1, total);
    const title = ws.getCell(1, 1);
    title.value = 'BREM 전체현황';
    title.font = { bold: true, size: 20, color: { argb: 'FF1A1A1A' } };
    title.alignment = { vertical: 'middle', horizontal: 'left' };
    ws.getRow(1).height = 32;

    ws.mergeCells(2, 1, 2, total);
    const period = ws.getCell(2, 1);
    period.value = `정산주 ${week.slice(0, 4)}년 ${weekLabel(week)} (수요일~화요일)`;
    period.font = { bold: true, size: 15, color: { argb: 'FF2A2A2A' } };
    period.alignment = { vertical: 'middle', horizontal: 'left' };
    ws.getRow(2).height = 26;

    ws.mergeCells(3, 1, 3, total);
    const note = ws.getCell(3, 1);
    note.value = '15만원대 145,000~155,000원 · 20만원대 195,000~205,000원 (배달처리비 기준) · 합산은 묶은 지역, 거리 항목은 쿠팡만';
    note.font = { size: 10, color: { argb: 'FF777777' } };
    note.alignment = { vertical: 'middle', horizontal: 'left' };
    ws.getRow(3).height = 16;

    let r = 5;
    r = exportSection(ws, cols, r, '지역 합계 · 쿠팡', summaryData('coupang', regionBuckets('coupang', week, end), week, end), true);
    r = exportSection(ws, cols, r, '지역 합계 · 배민', summaryData('baemin', regionBuckets('baemin', week, end), week, end), false);
    const bundleNames = new Set(state.bundles.map(item => item.name));
    const bundled = regionBuckets('all', week, end).filter(([label]) => bundleNames.has(label));
    r = exportSection(ws, cols, r, '지역 합계 · 합산(묶음)', summaryData('all', bundled, week, end), false);

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `BREM_전체현황_${week}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function regionSummaryTable(title, platform, grouped, withDistance, start, end) {
    const callBand = (list, min) => {
      const count = list.filter(row => (row.calls || 0) >= min).length;
      if (!list.length) return '-';
      return `${Math.round((count / list.length) * 100)}% (${count}명)`;
    };
    const avgCallsText = value => value == null ? '-' : value.toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const showDistance = withDistance && hasDistanceData(platform);
    const bands = start && end ? dailyBandMap(platform, start, end) : new Map();
    const summary = grouped.map(([region, list]) => {
      const row = finalizeMetrics({
        ...sumRows(list, platform),
        name: region,
        region,
        riders: list.length
      }, platform);
      row.avgCalls = list.length ? row.calls / list.length : null;
      row.band250 = callBand(list, 250);
      row.band300 = callBand(list, 300);
      row.band350 = callBand(list, 350);
      row.band400 = callBand(list, 400);
      return row;
    });
    const body = summary.map(row => `
      <tr>
        <td class="sa-left">${esc(row.region)}</td>
        <td>${row.riders}명</td>
        <td>${Math.round(row.calls).toLocaleString('ko-KR')}</td>
        <td>${avgCallsText(row.avgCalls)}</td>
        <td>${row.band250}</td>
        <td>${row.band300}</td>
        <td>${row.band350}</td>
        <td>${row.band400}</td>
        <td>${money(row.deliveryPay)}</td>
        ${showDistance ? `<td>${km(row.meters, 1)}</td>` : ''}
        <td>${money(row.processPay)}</td>
        <td>${priceCell(row.unit)}</td>
        ${showDistance ? `<td>${priceCell(row.per50)}</td><td>${priceCell(row.per100)}</td><td>${priceCell(row.per1km)}</td><td>${row.avgMeters == null ? '-' : km(row.avgMeters, 2)}</td>` : ''}
        <td>${bandCell(bands.get(row.region), '15', showDistance)}</td>
        <td>${bandCell(bands.get(row.region), '20', showDistance)}</td>
      </tr>`).join('');
    const cols = (showDistance ? 16 : 11) + 2;
    return `
      <section class="sa-region">
        <div class="sa-region__head"><h3>${esc(title)}</h3></div>
        <div class="sa-scroll">
          <table class="sa-table sa-table--dense">
            <thead><tr>
              <th class="sa-left">지역</th><th>기사</th><th>콜수</th>
              <th title="콜수 ÷ 기사">평균콜수</th>
              <th title="콜 250건 이상 기사">250건이상</th>
              <th title="콜 300건 이상 기사">300건이상</th>
              <th title="콜 350건 이상 기사">350건이상</th>
              <th title="콜 400건 이상 기사">400건이상</th>
              <th>배달비</th>
              ${showDistance ? '<th>배달거리</th>' : ''}
              <th>배달처리비</th>
              <th title="배달처리비 ÷ 콜수">평균단가</th>
              ${showDistance ? '<th title="배달처리비 × 50 ÷ 거리">50m 단가</th><th title="배달처리비 × 100 ÷ 거리">100m 단가</th><th title="배달처리비 × 1000 ÷ 거리">1km 단가</th><th title="배달거리 ÷ 콜수">평균거리</th>' : ''}
              <th title="하루 배달처리비 145,000~155,000원. 15만원 ±5천원">15만원대</th>
              <th title="하루 배달처리비 195,000~205,000원. 20만원 ±5천원">20만원대</th>
            </tr></thead>
            <tbody>${body || `<tr><td class="sa-empty" colspan="${cols}">일정산이 없습니다.</td></tr>`}</tbody>
          </table>
        </div>
      </section>`;
  }

  function payFmt(value) {
    const amount = Math.round(Number(value) || 0);
    const sign = amount < 0 ? '-' : '';
    const abs = Math.abs(amount);
    if (abs >= 100000000) {
      const eok = abs / 100000000;
      const text = eok >= 10 ? String(Math.round(eok)) : eok.toFixed(1).replace(/\.0$/, '');
      return `${sign}${text}억`;
    }
    if (abs >= 10000) return `${sign}${Math.round(abs / 10000).toLocaleString('ko-KR')}만`;
    return `${sign}${abs.toLocaleString('ko-KR')}`;
  }

  function focusModel() {
    const focusStart = addDays(currentWeek(), -14);
    const focusEnd = todayIso();
    const weekdayKr = ['일', '월', '화', '수', '목', '금', '토'];
    const trendRegion = state.trendRegion || '전체';
    const trendScope = trendRegion === '전체' ? '' : trendRegion;
    const platformSeries = [
      { key: 'coupang', name: '쿠팡', color: '#ffd400' },
      { key: 'baemin', name: '배민', color: '#60a5fa' }
    ];
    const callFmt = v => Math.round(v).toLocaleString('ko-KR');
    const focusWeeks = [4, 3, 2, 1, 0].map(index => addDays(currentWeek(), -7 * index));
    const weekLabels = focusWeeks.map(w => `${w.slice(5).replace('-', '/')} 주`);
    const weekTotals = platform => focusWeeks.map(w => sumRows(aggregate(platform, w, addDays(w, 6), trendScope), platform));
    const weekSeries = platformSeries.map(p => ({
      name: p.name,
      color: p.color,
      values: weekTotals(p.key).map(total => Math.round(total.calls))
    }));
    const weekPaySeries = platformSeries.map(p => ({
      name: p.name,
      color: p.color,
      values: weekTotals(p.key).map(total => Math.round(total.deliveryPay))
    }));
    const dayList = [];
    for (let day = focusStart; day <= focusEnd; day = addDays(day, 1)) dayList.push(day);
    const dayLabels = dayList.map(d => `${d.slice(5).replace('-', '/')}(${weekdayKr[new Date(`${d}T00:00:00`).getDay()]})`);
    const dayBuckets = platformSeries.map(p => {
      const calls = new Map();
      const pay = new Map();
      settlementParts(p.key, focusStart, focusEnd).forEach(part => {
        if (trendScope && part.label !== trendScope) return;
        calls.set(part.day, (calls.get(part.day) || 0) + part.calls);
        pay.set(part.day, (pay.get(part.day) || 0) + part.deliveryPay);
      });
      return { name: p.name, color: p.color, calls, pay };
    });
    const outsideStart = focusWeeks[0];
    const outsideEnd = addDays(focusWeeks[focusWeeks.length - 1], 6);
    const outsideParts = settlementParts('coupang', outsideStart, outsideEnd).filter(part => (
      !trendScope || part.label === trendScope
    ));
    const outsideByDay = new Map();
    outsideParts.forEach(part => {
      outsideByDay.set(part.day, (outsideByDay.get(part.day) || 0) + part.outsideCalls);
    });
    const outsideColor = '#fb923c';
    const weekOutsideSeries = [{
      name: '쿠팡 권외콜',
      color: outsideColor,
      values: focusWeeks.map(start => {
        const end = addDays(start, 6);
        return Math.round(outsideParts.reduce((sum, part) => (
          part.day >= start && part.day <= end ? sum + part.outsideCalls : sum
        ), 0));
      })
    }];
    const dayOutsideSeries = [{
      name: '쿠팡 권외콜',
      color: outsideColor,
      values: dayList.map(day => Math.round(outsideByDay.get(day) || 0))
    }];
    return {
      trendRegion,
      focusStart,
      focusEnd,
      weekLabels,
      weekSeries,
      weekPaySeries,
      dayLabels,
      daySeries: dayBuckets.map(p => ({
        name: p.name,
        color: p.color,
        values: dayList.map(d => Math.round(p.calls.get(d) || 0))
      })),
      dayPaySeries: dayBuckets.map(p => ({
        name: p.name,
        color: p.color,
        values: dayList.map(d => Math.round(p.pay.get(d) || 0))
      })),
      weekOutsideSeries,
      dayOutsideSeries,
      callFmt,
      payFmt
    };
  }

  function printSeries(series) {
    return series.map(item => ({
      ...item,
      color: item.name === '배민' ? '#1d4ed8' : (String(item.name).includes('권외') ? '#c2410c' : '#b8860b')
    }));
  }

  function loadSvgImage(svg, width, height) {
    const xml = svg.includes('xmlns=')
      ? svg
      : svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
    const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('차트를 이미지로 만들지 못했습니다.'));
      };
      img.src = url;
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function pdfFromJpeg(jpegBytes, pixelW, pixelH) {
    const enc = new TextEncoder();
    const chunks = [];
    const offsets = [0];
    let pos = 0;
    function add(data) {
      const bytes = typeof data === 'string' ? enc.encode(data) : data;
      chunks.push(bytes);
      pos += bytes.length;
    }
    function addObj(body) {
      offsets.push(pos);
      add(body);
    }
    add('%PDF-1.4\n');
    addObj('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    addObj('2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n');
    addObj('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>\nendobj\n');
    const content = 'q\n595.28 0 0 841.89 0 0 cm\n/Im0 Do\nQ\n';
    addObj(`4 0 obj\n<< /Length ${enc.encode(content).length} >>\nstream\n${content}endstream\nendobj\n`);
    offsets.push(pos);
    add(`5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pixelW} /Height ${pixelH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`);
    add(jpegBytes);
    add('\nendstream\nendobj\n');
    const xrefAt = pos;
    let xref = 'xref\n0 6\n0000000000 65535 f \n';
    for (let i = 1; i <= 5; i += 1) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    add(xref);
    add(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`);
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(total);
    let cursor = 0;
    chunks.forEach(chunk => {
      out.set(chunk, cursor);
      cursor += chunk.length;
    });
    return out;
  }

  function saveBytes(bytes, mime, filename) {
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function buildFocusSheet() {
    const model = focusModel();
    const rangeText = `${model.focusStart.slice(5).replace('-', '/')} ~ ${model.focusEnd.slice(5).replace('-', '/')}`;
    const charts = [
      {
        title: '주간 콜수',
        sub: '최근 5주',
        svg: chartMulti(model.weekLabels, printSeries(model.weekSeries), model.callFmt, { height: 220, showValues: true, print: true }),
        height: 220
      },
      {
        title: '주간 배달비',
        sub: '최근 5주 · 일정산 배달비',
        svg: chartMulti(model.weekLabels, printSeries(model.weekPaySeries), model.payFmt, { height: 220, showValues: true, padLeft: 78, print: true }),
        height: 220
      },
      {
        title: '일간 콜수',
        sub: `${rangeText} · 쿠팡·배민`,
        svg: chartMulti(model.dayLabels, printSeries(model.daySeries), model.callFmt, { height: 250, rotate: true, markTurning: true, print: true }),
        height: 250
      },
      {
        title: '일간 배달비',
        sub: `${rangeText} · 일정산 배달비`,
        svg: chartMulti(model.dayLabels, printSeries(model.dayPaySeries), model.payFmt, { height: 250, rotate: true, markTurning: true, padLeft: 78, print: true }),
        height: 250
      },
      {
        title: '주별 쿠팡 권외콜 완료',
        sub: '최근 5주 · 일정산 권외콜',
        svg: chartMulti(model.weekLabels, printSeries(model.weekOutsideSeries), model.callFmt, { height: 200, showValues: true, print: true }),
        height: 200
      },
      {
        title: '일별 쿠팡 권외콜 완료',
        sub: `${rangeText} · 일정산 권외콜`,
        svg: chartMulti(model.dayLabels, printSeries(model.dayOutsideSeries), model.callFmt, { height: 220, rotate: true, markTurning: true, print: true }),
        height: 220
      }
    ];
    const images = await Promise.all(charts.map(chart => loadSvgImage(chart.svg, 860, chart.height)));
    const pageW = 1240;
    const pageH = 1754;
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = pageW * scale;
    canvas.height = pageH * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = '#f5f4f1';
    ctx.fillRect(0, 0, pageW, pageH);

    const margin = 46;
    ctx.fillStyle = '#b8860b';
    ctx.fillRect(margin, 42, 8, 54);
    ctx.fillStyle = '#78716c';
    ctx.font = '600 16px "Malgun Gothic", sans-serif';
    ctx.fillText('BREM  지사데이터 분석', margin + 22, 62);
    ctx.fillStyle = '#1c1917';
    ctx.font = '800 34px "Malgun Gothic", sans-serif';
    ctx.fillText('콜수 · 배달비 · 쿠팡 권외콜', margin + 22, 100);
    ctx.fillStyle = '#57534e';
    ctx.font = '16px "Malgun Gothic", sans-serif';
    ctx.fillText(`${model.trendRegion}  ·  ${model.focusStart} ~ ${model.focusEnd}  ·  쿠팡 · 배민`, margin + 22, 128);

    const top = 156;
    const gap = 12;
    const bottom = pageH - 40;
    const chrome = 44;
    const budget = bottom - top - gap * (charts.length - 1) - chrome * charts.length;
    const heightSum = charts.reduce((sum, chart) => sum + chart.height, 0);
    let y = top;
    charts.forEach((chart, index) => {
      const imgH = Math.max(120, Math.floor(budget * (chart.height / heightSum)));
      const cardH = chrome + imgH;
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#e7e5e4';
      ctx.lineWidth = 1.5;
      roundRect(ctx, margin, y, pageW - margin * 2, cardH, 16);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#1c1917';
      ctx.font = '800 20px "Malgun Gothic", sans-serif';
      ctx.fillText(chart.title, margin + 20, y + 28);
      ctx.fillStyle = '#78716c';
      ctx.font = '14px "Malgun Gothic", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(chart.sub, pageW - margin - 20, y + 28);
      ctx.textAlign = 'left';
      ctx.drawImage(images[index], margin + 12, y + 38, pageW - margin * 2 - 24, imgH);
      y += cardH + gap;
    });

    ctx.fillStyle = '#a8a29e';
    ctx.font = '13px "Malgun Gothic", sans-serif';
    ctx.fillText('배달비는 일정산 지급액 · 정산주는 수요일~화요일', margin, pageH - 22);
    ctx.textAlign = 'right';
    ctx.fillText(todayIso(), pageW - margin, pageH - 22);
    ctx.textAlign = 'left';
    return { canvas, model };
  }

  async function downloadFocusSheet(kind) {
    const { canvas, model } = await buildFocusSheet();
    const region = String(model.trendRegion || '전체').replace(/[\\/:*?"<>|]/g, '');
    const base = `BREM_콜수배달비_${model.focusStart}_${region}`;
    if (kind === 'png') {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      saveBytes(new Uint8Array(await blob.arrayBuffer()), 'image/png', `${base}.png`);
      return;
    }
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    const jpeg = new Uint8Array(await blob.arrayBuffer());
    const pdf = pdfFromJpeg(jpeg, canvas.width, canvas.height);
    saveBytes(pdf, 'application/pdf', `${base}.pdf`);
  }

  function renderBody() {
    const platform = state.platform;
    const week = state.view === 'current' ? currentWeek() : (state.weekStart || currentWeek());
    const end = addDays(week, 6);
    const rows = aggregate(platform, week, end, '');
    const grouped = regionBuckets(platform, week, end);
    const regions = grouped.map(([name]) => name);

    if (state.view === 'current') {
      const extra = searchBox();
      const kpi = kpiStrip(rows, platform);
      const ratioNote = hasDistanceData(platform)
        ? '<p class="sa-note">거리대비: 50콜 이상만 집계하며, 그 평균을 100%로 둔 값입니다. 금액 = 배달처리비÷거리, 콜 = 콜수÷거리. <span class="sa-ratio--up">100% 이상 파랑</span> · <span class="sa-ratio--down">100% 미만 빨강</span>. 금액은 파랑이고 콜은 빨강이면, 거리 대비 돈은 많고 콜은 적은 기사입니다.</p>'
        : '';
      const caption = `<p class="sa-note">정산주 ${weekLabel(week)} · 수요일~화요일 · ${platformLabel(platform)}</p>${ratioNote}`;
      const blocks = grouped.map(([region, list]) => {
        const regionTotal = sumRows(list, platform);
        return `
          <section class="sa-region">
            <div class="sa-region__head">
              <h3>${esc(region)}</h3>
              <span class="sa-region__meta">${list.length}명 · ${Math.round(regionTotal.calls).toLocaleString('ko-KR')}콜 · 평균 ${priceCell(regionTotal.unit)}</span>
            </div>
            ${tableHtml(list, platform, { withRegion: false, weekStart: week })}
          </section>`;
      }).join('');
      return `${controls(extra)}${kpi}${caption}${blocks || '<p class="sa-empty-state">이번 주 일정산이 없습니다.</p>'}`;
    }

    if (state.view === 'all') {
      const coupangGroups = regionBuckets('coupang', week, end);
      const baeminGroups = regionBuckets('baemin', week, end);
      const bundleNames = new Set(state.bundles.map(item => item.name));
      const bundledGroups = regionBuckets('all', week, end).filter(([label]) => bundleNames.has(label));
      const simRegions = coupangGroups.map(([name]) => name);
      const simButton = `<button type="button" class="sa-sim-open" data-sa-sim-open="1" data-readonly-allow="true">📊 수익 시뮬레이션 열기</button>
        <button type="button" class="sa-export" data-sa-export="1" data-readonly-allow="true">⬇ 엑셀 내보내기</button>`;
      const simModal = state.simOpen ? `
        <div class="sa-modal" data-sa-sim-backdrop="1">
          <div class="sa-modal__panel" role="dialog" aria-modal="true" aria-label="수익 시뮬레이션">
            <div class="sa-modal__head">
              <div>
                <h2>수익 시뮬레이션</h2>
                <span>배달처리비 기준 · 평균 단가로 환산한 추정치</span>
              </div>
              <button type="button" class="sa-modal__close" data-sa-sim-close="1" aria-label="닫기">✕</button>
            </div>
            <div class="sa-modal__body">${simulationSection('coupang', week, simRegions)}</div>
          </div>
        </div>` : '';
      const bundleEmpty = bundledGroups.length
        ? ''
        : '<p class="sa-note">지역 묶기에서 합칠 지역을 2개 이상 고르면 합산 표에 나옵니다.</p>';
      return `
        ${controls(weekSelect(true))}
        <p class="sa-note">정산주 ${weekLabel(week)} · 수요일~화요일 · 쿠팡, 배민, 묶어 둔 지역 합산</p>
        ${simButton}
        ${regionSummaryTable('지역 합계 · 쿠팡', 'coupang', coupangGroups, true, week, end)}
        ${regionSummaryTable('지역 합계 · 배민', 'baemin', baeminGroups, false, week, end)}
        ${regionSummaryTable('지역 합계 · 합산', 'all', bundledGroups, false, week, end)}
        <p class="sa-note">15만원대는 하루 배달처리비 145,000~155,000원, 20만원대는 195,000~205,000원입니다. 칸 아래 명은 그 구간에 들어간 기사 수입니다.</p>
        ${bundleEmpty}
        ${simModal}`;
    }

    if (state.view === 'region') {
      const region = regions.includes(state.region) ? state.region : (regions[0] || '');
      state.region = region;
      const list = (grouped.find(([name]) => name === region) || ['', []])[1];
      const regionSelect = `<select id="saRegion" class="sa-select" data-readonly-allow="true" aria-label="지역">
        ${regions.map(name => `<option value="${esc(name)}" ${name === region ? 'selected' : ''}>${esc(name)}</option>`).join('')}
      </select>`;
      const ratioNote = hasDistanceData(platform)
        ? '<p class="sa-note">거리대비: 50콜 이상만 집계하며, 그 평균을 100%로 둔 값입니다. 금액 = 배달처리비÷거리, 콜 = 콜수÷거리. <span class="sa-ratio--up">100% 이상 파랑</span> · <span class="sa-ratio--down">100% 미만 빨강</span>. 금액은 파랑이고 콜은 빨강이면, 거리 대비 돈은 많고 콜은 적은 기사입니다.</p>'
        : '';
      return `${controls(`${regionSelect}${weekSelect(true)}${searchBox()}`)}${kpiStrip(list, platform)}<p class="sa-note">${esc(region || '지역 없음')} · ${weekLabel(week)}</p>${ratioNote}<section class="sa-region">${tableHtml(list, platform, { withRegion: false, weekStart: week })}</section>`;
    }

    // 상황추이: 지역 목록은 선택 주가 비어도 뜨도록 불러온 전체 기간에서 뽑는다.
    const trendRangeWeeks = weekOptions();
    const trendRangeRegions = trendRangeWeeks.length
      ? regionBuckets(platform, trendRangeWeeks[0], addDays(trendRangeWeeks[trendRangeWeeks.length - 1], 6)).map(([name]) => name)
      : regions;
    const trendRegions = ['전체'].concat(trendRangeRegions.length ? trendRangeRegions : regions);
    const trendRegion = trendRegions.includes(state.trendRegion) ? state.trendRegion : '전체';
    state.trendRegion = trendRegion;
    const weeks = weekOptions();
    const seriesFor = scope => weeks.map(start => {
      const list = aggregate(platform, start, addDays(start, 6), scope === '전체' ? '' : scope);
      const total = sumRows(list, platform);
      return {
        label: start.slice(5).replace('-', '/'),
        calls: total.calls,
        unit: total.calls ? total.unit : 0,
        per1km: total.per1km == null ? 0 : total.per1km,
        avgKm: total.avgMeters == null ? 0 : total.avgMeters / 1000
      };
    });
    const points = seriesFor(trendRegion);

    // 콜수 기준데이터 (2주전~현재) · 쿠팡·배민 한번에
    const focus = focusModel();
    const { focusStart, focusEnd, weekLabels, weekSeries, weekPaySeries, dayLabels, daySeries, dayPaySeries, weekOutsideSeries, dayOutsideSeries, callFmt } = focus;

    const focusSection = `
      <section class="sa-region">
        <div class="sa-region__head">
          <h3>콜수 기준데이터 · 2주전~현재</h3>
          <span class="sa-region__meta">${esc(trendRegion)} · 쿠팡·배민</span>
          <span class="sa-a4-actions">
            <button type="button" class="sa-a4" data-sa-a4="pdf" data-readonly-allow="true">A4 PDF</button>
            <button type="button" class="sa-a4" data-sa-a4="png" data-readonly-allow="true">A4 이미지</button>
          </span>
        </div>
        <div class="sa-charts sa-charts--focus">
          <article class="sa-chart-card">
            <div class="sa-chart-card__head"><h3>주간 콜수</h3><span>최근 5주 · 쿠팡·배민</span></div>
            ${chartMulti(weekLabels, weekSeries, callFmt, { height: 260, showValues: true })}
          </article>
          <article class="sa-chart-card">
            <div class="sa-chart-card__head"><h3>주간 배달비</h3><span>최근 5주 · 일정산 배달비 · 쿠팡·배민</span></div>
            ${chartMulti(weekLabels, weekPaySeries, focus.payFmt, { height: 260, showValues: true, padLeft: 78 })}
          </article>
          <article class="sa-chart-card">
            <div class="sa-chart-card__head"><h3>일간 콜수</h3><span>${focusStart.slice(5).replace('-', '/')} ~ ${focusEnd.slice(5).replace('-', '/')} · 쿠팡·배민</span></div>
            ${chartMulti(dayLabels, daySeries, callFmt, { height: 300, rotate: true, markTurning: true })}
          </article>
          <article class="sa-chart-card">
            <div class="sa-chart-card__head"><h3>일간 배달비</h3><span>${focusStart.slice(5).replace('-', '/')} ~ ${focusEnd.slice(5).replace('-', '/')} · 일정산 배달비</span></div>
            ${chartMulti(dayLabels, dayPaySeries, focus.payFmt, { height: 300, rotate: true, markTurning: true, padLeft: 78 })}
          </article>
          <article class="sa-chart-card">
            <div class="sa-chart-card__head"><h3>주별 쿠팡 권외콜 완료</h3><span>최근 5주 · 일정산 권외콜 완료건수</span></div>
            ${chartMulti(weekLabels, weekOutsideSeries, callFmt, { height: 260, showValues: true })}
          </article>
          <article class="sa-chart-card">
            <div class="sa-chart-card__head"><h3>일별 쿠팡 권외콜 완료</h3><span>${focusStart.slice(5).replace('-', '/')} ~ ${focusEnd.slice(5).replace('-', '/')} · 일정산 권외콜 완료건수</span></div>
            ${chartMulti(dayLabels, dayOutsideSeries, callFmt, { height: 300, rotate: true, markTurning: true })}
          </article>
        </div>
      </section>`;

    const regionSelect = `<select id="saTrendRegion" class="sa-select" data-readonly-allow="true" aria-label="추이 지역">
      ${trendRegions.map(name => `<option value="${esc(name)}" ${name === trendRegion ? 'selected' : ''}>${esc(name)}</option>`).join('')}
    </select>`;

    const bigCharts = `
      <div class="sa-charts">
        <article class="sa-chart-card">
          <div class="sa-chart-card__head"><h3>주간 콜수</h3><span>${esc(trendRegion)}</span></div>
          ${chartSvg(points.map(p => ({ label: p.label, value: p.calls, text: `${Math.round(p.calls)}콜` })), '#ffd400', '콜', v => Math.round(v).toLocaleString('ko-KR'))}
        </article>
        <article class="sa-chart-card">
          <div class="sa-chart-card__head"><h3>평균단가</h3><span>배달처리비 ÷ 콜수</span></div>
          ${chartSvg(points.map(p => ({ label: p.label, value: p.unit, text: money(p.unit) })), '#f59e0b', '원', v => `${Math.round(v).toLocaleString('ko-KR')}`)}
        </article>
        <article class="sa-chart-card">
          <div class="sa-chart-card__head"><h3>1km 단가</h3><span>배달처리비 × 1000 ÷ 거리</span></div>
          ${hasDistanceData(platform)
            ? chartSvg(points.map(p => ({ label: p.label, value: p.per1km, text: money(p.per1km) })), '#a78bfa', '원', v => `${Math.round(v).toLocaleString('ko-KR')}`)
            : '<p class="sa-note sa-chart-card__empty">배민 일정산에는 배달거리가 없습니다.</p>'}
        </article>
        <article class="sa-chart-card">
          <div class="sa-chart-card__head"><h3>평균거리</h3><span>배달거리 ÷ 콜수</span></div>
          ${hasDistanceData(platform)
            ? chartSvg(points.map(p => ({ label: p.label, value: p.avgKm, text: `${p.avgKm.toFixed(2)}km` })), '#38bdf8', 'km', v => v.toFixed(1))
            : '<p class="sa-note sa-chart-card__empty">배민 일정산에는 배달거리가 없습니다.</p>'}
        </article>
      </div>`;

    const miniCards = grouped.map(([region]) => {
      const regionPoints = seriesFor(region);
      const last = regionPoints[regionPoints.length - 1];
      return `
        <article class="sa-mini-card">
          <div class="sa-mini-card__head"><h4>${esc(region)}</h4><span>${Math.round(last.calls).toLocaleString('ko-KR')}콜</span></div>
          ${miniChart(regionPoints.map(p => ({ value: p.calls })), '#ffd400')}
        </article>`;
    }).join('');

    return `
      ${controls(regionSelect)}
      <p class="sa-note">최근 8주 추이 · ${platformLabel(platform)} · 가로축은 정산주 시작일</p>
      ${focusSection}
      ${bigCharts}
      <section class="sa-region">
        <div class="sa-region__head"><h3>지역별 주간 콜수 추이</h3><span class="sa-region__meta">각 지역 최근 8주</span></div>
        <div class="sa-mini-grid">${miniCards || '<p class="sa-note">지역 데이터가 없습니다.</p>'}</div>
      </section>`;
  }

  function memberLabel(key) {
    const [platform, ...rest] = String(key || '').split('|');
    return `${platform === 'baemin' ? '배민' : '쿠팡'}·${rest.join('|')}`;
  }

  function bundleModalHtml() {
    if (!state.bundleOpen) return '';
    const week = state.view === 'current' ? currentWeek() : (state.weekStart || currentWeek());
    const members = new Map();
    settlementParts('all', week, addDays(week, 6)).forEach(part => {
      const key = memberKey(part.platform, part.rawRegion);
      const slot = members.get(key) || { key, platform: part.platform, region: part.rawRegion, calls: 0 };
      slot.calls += part.calls;
      members.set(key, slot);
    });
    const chips = [...members.values()]
      .sort((a, b) => a.region.localeCompare(b.region, 'ko') || a.platform.localeCompare(b.platform))
      .map(item => {
        const used = state.bundles.find(group => group.members.includes(item.key));
        return `<button type="button" class="sa-chip ${state.bundlePick.includes(item.key) ? 'is-on' : ''}" data-sa-bundle-pick="${esc(item.key)}" data-readonly-allow="true">
          <em>${item.platform === 'baemin' ? '배민' : '쿠팡'}</em>${esc(item.region)}
          <span>${Math.round(item.calls).toLocaleString('ko-KR')}콜${used ? ` · ${esc(used.name)}` : ''}</span>
        </button>`;
      }).join('');
    const groups = state.bundles.map(group => `
      <div class="sa-bundle-card">
        <strong>${esc(group.name)}</strong>
        <span>${group.members.map(key => esc(memberLabel(key))).join(', ')}</span>
        <button type="button" data-sa-bundle-drop="${esc(group.id)}" data-readonly-allow="true">해제</button>
      </div>`).join('');
    return `
      <div class="sa-modal" data-sa-bundle-backdrop="1">
        <div class="sa-modal__panel" role="dialog" aria-modal="true" aria-label="지역 묶기">
          <div class="sa-modal__head">
            <div>
              <h2>지역 묶기</h2>
              <span>${weekLabel(week)} · 2개 이상 고르고 합산 이름을 정하면 한 줄로 합쳐집니다</span>
            </div>
            <button type="button" class="sa-modal__close" data-sa-bundle-close="1" data-readonly-allow="true" aria-label="닫기">✕</button>
          </div>
          <div class="sa-modal__body">
            <div class="sa-chip-list">${chips || '<p class="sa-note">이 주에 지역 데이터가 없습니다.</p>'}</div>
            <div class="sa-bundle-form">
              <input id="saBundleName" class="sa-search" type="text" placeholder="합산 이름 (예: 남구)" value="${esc(state.bundleName)}" data-readonly-allow="true" autocomplete="off">
              <button type="button" class="sa-bundle-save" data-sa-bundle-save="1" data-readonly-allow="true">선택한 지역 묶기</button>
            </div>
            <div class="sa-bundle-groups">${groups || '<p class="sa-note">아직 묶은 지역이 없습니다.</p>'}</div>
          </div>
        </div>
      </div>`;
  }

  function render() {
    const root = document.getElementById('statusAnalysisRoot');
    if (!root || !window.BremStorage) return;
    const range = neededRange();
    const key = `${range.start}|${range.end}`;
    if (rangeKey !== key) {
      root.innerHTML = '<p class="sa-note">일정산을 불러오는 중입니다…</p>';
      if (loading) return;
      loading = true;
      Promise.resolve(BremStorage.ensureSettlementsSinceDate?.(range.start, { untilDate: range.end, merge: true, force: true }))
        .then(() => { rangeKey = key; })
        .catch(error => { rangeKey = key; root.dataset.error = error?.message || ''; })
        .finally(() => { loading = false; render(); });
      return;
    }
    const activeId = document.activeElement && document.activeElement.id;
    const keepFocus = activeId === 'saSearch' || activeId === 'saSimInput' || activeId === 'saBundleName';
    const caret = keepFocus ? document.activeElement.selectionStart : null;
    root.innerHTML = renderBody() + bundleModalHtml();
    if (keepFocus) {
      const input = document.getElementById(activeId);
      if (input) {
        input.focus();
        if (caret != null) {
          const pos = Math.min(caret, input.value.length);
          try { input.setSelectionRange(pos, pos); } catch (_) {}
        }
      }
    }
  }

  const root = document.getElementById('statusAnalysisRoot');
  if (root) {
    root.addEventListener('click', event => {
      const view = event.target.closest('[data-sa-view]');
      const platform = event.target.closest('[data-sa-platform]');
      const sortTh = event.target.closest('[data-sa-sort]');
      const weekStep = event.target.closest('[data-sa-week-step]');
      const weekNow = event.target.closest('[data-sa-week-now]');
      const bundleOpen = event.target.closest('[data-sa-bundle-open]');
      const bundleClose = event.target.closest('[data-sa-bundle-close]');
      const bundleBackdrop = event.target.closest('[data-sa-bundle-backdrop]');
      const bundlePick = event.target.closest('[data-sa-bundle-pick]');
      const bundleSave = event.target.closest('[data-sa-bundle-save]');
      const bundleDrop = event.target.closest('[data-sa-bundle-drop]');
      if (bundleOpen) { state.bundleOpen = true; render(); return; }
      if (bundleClose || (bundleBackdrop && event.target === bundleBackdrop)) { state.bundleOpen = false; render(); return; }
      if (bundlePick) {
        const key = bundlePick.dataset.saBundlePick;
        state.bundleName = document.getElementById('saBundleName')?.value || '';
        state.bundlePick = state.bundlePick.includes(key)
          ? state.bundlePick.filter(item => item !== key)
          : state.bundlePick.concat(key);
        render();
        return;
      }
      if (bundleSave) {
        const name = (document.getElementById('saBundleName')?.value || '').trim();
        if (name && state.bundlePick.length >= 2) {
          state.bundles.forEach(group => {
            group.members = group.members.filter(item => !state.bundlePick.includes(item));
          });
          state.bundles = state.bundles.filter(group => group.members.length);
          state.bundles.push({ id: `b${Date.now()}`, name, members: state.bundlePick.slice() });
          state.bundlePick = [];
          state.bundleName = '';
          saveBundles();
        }
        render();
        return;
      }
      if (bundleDrop) {
        state.bundles = state.bundles.filter(group => group.id !== bundleDrop.dataset.saBundleDrop);
        saveBundles();
        render();
        return;
      }
      const simMode = event.target.closest('[data-sa-sim-mode]');
      const simOpen = event.target.closest('[data-sa-sim-open]');
      const simClose = event.target.closest('[data-sa-sim-close]');
      const backdrop = event.target.closest('[data-sa-sim-backdrop]');
      const a4Btn = event.target.closest('[data-sa-a4]');
      if (a4Btn) {
        const kind = a4Btn.dataset.saA4 === 'png' ? 'png' : 'pdf';
        a4Btn.disabled = true;
        downloadFocusSheet(kind)
          .catch(error => alert(`A4 내려받기 실패: ${error?.message || error}`))
          .finally(() => { a4Btn.disabled = false; });
        return;
      }
      const exportBtn = event.target.closest('[data-sa-export]');
      if (exportBtn) {
        const week = state.weekStart || currentWeek();
        exportBtn.disabled = true;
        Promise.resolve(exportExcel(week))
          .catch(error => alert(`엑셀 내보내기 실패: ${error?.message || error}`))
          .finally(() => { exportBtn.disabled = false; });
        return;
      }
      if (simOpen) { state.simOpen = true; render(); return; }
      if (simClose) { state.simOpen = false; render(); return; }
      if (backdrop && event.target === backdrop) { state.simOpen = false; render(); return; }
      if (simMode) { state.simMode = simMode.dataset.saSimMode; render(); return; }
      if (weekNow) { state.weekStart = currentWeek(); render(); return; }
      if (weekStep && !weekStep.disabled) {
        const weeks = weekOptions();
        const cur = weeks.indexOf(state.weekStart || currentWeek());
        const base = cur < 0 ? weeks.length - 1 : cur;
        const next = Math.min(weeks.length - 1, Math.max(0, base + Number(weekStep.dataset.saWeekStep)));
        state.weekStart = weeks[next];
        render();
        return;
      }
      if (view) { state.view = view.dataset.saView; render(); return; }
      if (platform) { state.platform = platform.dataset.saPlatform; render(); return; }
      if (sortTh) {
        const key = sortTh.dataset.saSort;
        if (state.sortKey === key) {
          state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortKey = key;
          state.sortDir = (key === 'name' || key === 'region') ? 'asc' : 'desc';
        }
        render();
      }
    });
    root.addEventListener('change', event => {
      if (event.target.id === 'saWeek') state.weekStart = event.target.value;
      if (event.target.id === 'saRegion') state.region = event.target.value;
      if (event.target.id === 'saTrendRegion') state.trendRegion = event.target.value;
      if (event.target.id === 'saSimRegion') state.simRegion = event.target.value;
      if (['saWeek', 'saRegion', 'saTrendRegion', 'saSimRegion'].includes(event.target.id)) render();
    });
    let searchTimer = null;
    let simTimer = null;
    root.addEventListener('input', event => {
      if (event.target.id === 'saSearch') {
        state.search = event.target.value;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(render, 160);
        return;
      }
      if (event.target.id === 'saSimInput') {
        const num = Number(String(event.target.value).replace(/[^\d.]/g, '')) || 0;
        if (state.simMode === 'amount') state.simAmount = num;
        else if (state.simMode === 'distance') state.simKm = num;
        else state.simCalls = num;
        clearTimeout(simTimer);
        simTimer = setTimeout(render, 220);
      }
    });
  }

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && (state.simOpen || state.bundleOpen)) {
      state.simOpen = false;
      state.bundleOpen = false;
      render();
    }
  });

  window.BremStatusAnalysis = { render };
})();
