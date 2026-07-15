/**
 * 쿠팡이츠 수집 소스 정의 + 응답 → 저장행 매핑 (순수 함수)
 * 라이브 디스커버리(2026-07)에서 확인한 partner.coupangeats.com API 형태 기준.
 * 인증은 Bearer JWT (Authorization 헤더). 값은 소수점으로 오기도 함(쿠팡 가중치).
 */

const COUPANG_ORIGIN = 'https://partner.coupangeats.com';
const COUPANG_API_BASE = `${COUPANG_ORIGIN}/bff/api`;

// 쿠팡 peakType ↔ 한글 라벨 (아침/점심피크/점심논피크/저녁피크/저녁논피크)
const PEAK_LABELS = {
  MORNING: '아침',
  LUNCH: '점심피크',
  POST_LUNCH: '점심논피크',
  DINNER: '저녁피크',
  POST_DINNER: '저녁논피크'
};
const PEAK_ORDER = ['MORNING', 'LUNCH', 'POST_LUNCH', 'DINNER', 'POST_DINNER'];

const COUPANG_COLLECT_MENUS = ['peak_realtime', 'weekly_performance', 'vendor_info', 'rider_daily'];

function digitsOnly(v) {
  return String(v || '').replace(/[^0-9]/g, '');
}

/** ERP 매칭 키: 이름 + 전화 뒤 4자리 (예: 고성재5595) */
function buildMatchKey(name, phone) {
  const nm = String(name || '').replace(/\s+/g, '').trim();
  const last4 = digitsOnly(phone).slice(-4);
  if (!nm && !last4) return '';
  return `${nm}${last4}`;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** GET /bff/api/v2/vendor/dashboard/{vendorId}/realtime-performance → 오늘 피크 현황 */
function mapRealtimeToItems(vendorId, vendorName, collectDate, payload) {
  const data = payload?.data || {};
  const peaks = Array.isArray(data.peakTimePerformance) ? data.peakTimePerformance : [];
  const vid = String(vendorId || '');
  return peaks.map(p => {
    const peakType = String(p.peakType || '').toUpperCase();
    return {
      collect_date: collectDate,
      source_menu: 'peak_realtime',
      vendor_id: vid,
      vendor_name: String(vendorName || ''),
      courier_id: '',
      rider_name: '',
      phone_number: '',
      match_key: '',
      dedupe_key: `${vid}:${collectDate}:peak:${peakType}`,
      parsed_json: {
        vendorId: vid,
        vendorName: String(vendorName || ''),
        date: collectDate,
        peakType,
        peakLabel: PEAK_LABELS[peakType] || peakType,
        goalCount: num(p.goalCount),
        completedCount: num(p.completedCount),
        remainingCount: num(p.remainingCount),
        achievementRate: p.achievementRate == null ? null : num(p.achievementRate),
        overallAchievementRate: data.overallAchievementRate == null ? null : num(data.overallAchievementRate),
        stats: data.stats || null
      },
      raw_json: {}
    };
  });
}

/** GET /bff/api/v2/vendor/dashboard/{vendorId}/weekly-performance?startDate= → 주간 요일x타임존 */
function mapWeeklyToItems(vendorId, vendorName, weekStart, payload) {
  const data = payload?.data || {};
  const days = Array.isArray(data.dailyAchievements) ? data.dailyAchievements : [];
  const vid = String(vendorId || '');
  const out = [];
  for (const d of days) {
    const dayOfWeek = String(d.dayOfWeek || '');
    const date = String(d.date || '').slice(0, 10);
    const details = Array.isArray(d.peakTimeDetails) ? d.peakTimeDetails : [];
    for (const t of details) {
      const peakType = String(t.peakTimeType || '').toUpperCase();
      out.push({
        collect_date: weekStart,
        source_menu: 'weekly_performance',
        vendor_id: vid,
        vendor_name: String(vendorName || ''),
        courier_id: '',
        rider_name: '',
        phone_number: '',
        match_key: '',
        dedupe_key: `${vid}:${weekStart}:${dayOfWeek}:${peakType}`,
        parsed_json: {
          vendorId: vid,
          vendorName: String(vendorName || ''),
          weekStart,
          dayOfWeek,
          date,
          peakType,
          peakLabel: PEAK_LABELS[peakType] || peakType,
          goalCount: num(t.goalCount),
          completedCount: t.completedCount == null ? null : num(t.completedCount),
          achievementRate: t.achievementRate == null ? null : num(t.achievementRate),
          dailyTargetAchievement: d.dailyTargetAchievement == null ? null : num(d.dailyTargetAchievement),
          rejectionCount: d.rejectionCount == null ? null : num(d.rejectionCount),
          rejectionRate: d.rejectionRate == null ? null : num(d.rejectionRate),
          weeklyRejectionRate: data.weeklyRejectionRate == null ? null : num(data.weeklyRejectionRate),
          weeklyAchievementRate: data.weeklyAchievementRate == null ? null : num(data.weeklyAchievementRate)
        },
        raw_json: {}
      });
    }
  }
  return out;
}

/** GET /bff/api/v2/vendor/dashboard/{anyVendorId}/daily-vendor-info → 지역(매장)별 요약 (전 매장) */
function mapVendorInfoToItems(collectDate, payload) {
  const data = payload?.data || {};
  const children = Array.isArray(data.childVendorRecordDtos) ? data.childVendorRecordDtos : [];
  return children.map(c => {
    const vid = String(c.vendorId || '');
    const cum = c.totalCumulativeStatus || {};
    const shift = c.currentTimeShiftStatus || {};
    const rider = c.currentRiderStatus || {};
    return {
      collect_date: collectDate,
      source_menu: 'vendor_info',
      vendor_id: vid,
      vendor_name: String(cum.vendorName || ''),
      courier_id: '',
      rider_name: '',
      phone_number: '',
      match_key: '',
      dedupe_key: `${vid}:${collectDate}:info`,
      parsed_json: {
        vendorId: vid,
        vendorName: String(cum.vendorName || ''),
        date: collectDate,
        rejectionRate: cum.rejectionRate == null ? null : num(cum.rejectionRate),
        orderViolationCount: cum.orderViolationCount == null ? null : num(cum.orderViolationCount),
        target: shift.target == null ? null : num(shift.target),
        onGoingCount: shift.onGoingCount == null ? null : num(shift.onGoingCount),
        completedCount: shift.completedCount == null ? null : num(shift.completedCount),
        riderTotalCount: num(rider.totalCount),
        riderOnLineCount: num(rider.onLineCount),
        thirdPartyEdpCount: num(rider.thirdPartyEdpCount),
        regularEdpCount: num(rider.regularEdpCount)
      },
      raw_json: {}
    };
  });
}

/**
 * 라이더별 일 실적.
 * POST /bff/api/v1/vendor/dashboard/daily-vendor-performance → data.vendorRecordDtos[] (vendorId 포함)
 * POST /bff/api/v1/vendor/dashboard/daily-edp-performance → data.edpRecordDtos[] (매장별 호출)
 * ERP 매칭키: 이름 + 전화 뒤4자리 → courierId
 */
function mapRiderToItems(collectDate, payload, fallbackVendorId, fallbackVendorName) {
  const data = payload?.data || {};
  const rows = Array.isArray(data.vendorRecordDtos)
    ? data.vendorRecordDtos
    : (Array.isArray(data.edpRecordDtos) ? data.edpRecordDtos : []);
  return rows.map(r => {
    const edp = r.edpDetail || {};
    const name = String(edp.name || '');
    const phone = String(edp.mobileNo || '');
    const courierId = String(r.courierId || '');
    const vid = String(r.vendorId || fallbackVendorId || '');
    const vname = String(r.vendorName || fallbackVendorName || '');
    const tr = r.totalRecords || {};
    const peaks = r.completeByPeaks || {};
    return {
      collect_date: collectDate,
      source_menu: 'rider_daily',
      vendor_id: vid,
      vendor_name: vname,
      courier_id: courierId,
      rider_name: name,
      phone_number: phone,
      match_key: buildMatchKey(name, phone),
      dedupe_key: `${vid || 'ALL'}:${collectDate}:${courierId || buildMatchKey(name, phone)}`,
      parsed_json: {
        vendorId: vid,
        vendorName: vname,
        date: collectDate,
        courierId,
        name,
        phone,
        matchKey: buildMatchKey(name, phone),
        edpStatus: r.edpStatus || '',
        delinkedStatus: r.delinkedStatus || '',
        peakTimeType: r.peakTimeType || '',
        completeCount: num(tr.completeCount),
        rejectCount: num(tr.rejectCount),
        cancelCount: num(tr.cancelCount),
        orderViolationCount: num(tr.orderViolationCount),
        lunchPeak: num(peaks.lunchPeak),
        dinnerPeak: num(peaks.dinnerPeak),
        nonPeak: num(peaks.nonPeak)
      },
      raw_json: {}
    };
  });
}

module.exports = {
  COUPANG_ORIGIN,
  COUPANG_API_BASE,
  PEAK_LABELS,
  PEAK_ORDER,
  COUPANG_COLLECT_MENUS,
  buildMatchKey,
  digitsOnly,
  mapRealtimeToItems,
  mapWeeklyToItems,
  mapVendorInfoToItems,
  mapRiderToItems
};
