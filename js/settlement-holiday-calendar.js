/**
 * 명절처럼 수~화 운행주는 그대로인데 지급·마무리가 갈라지는 주.
 * 이번 추석(2026-09-16 주):
 *  - 배달료는 들어온 주정산 구간대로 입금 (배민 16~20 → 9/23, 21~22 → 9/29, 쿠팡 → 9/28)
 *  - 프로모션은 주정산이 잘려 들어와도 합쳐서 배민 9/29, 쿠팡 9/28
 */
(function () {
  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function todayKey() {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  function addDays(dateValue, days) {
    const raw = String(dateValue || '').slice(0, 10);
    const date = new Date(`${raw}T00:00:00`);
    if (Number.isNaN(date.getTime())) return '';
    date.setDate(date.getDate() + Number(days || 0));
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function weekStartFromDate(dateValue) {
    const raw = String(dateValue || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
    if (window.BremDatePicker?.weekStartKey) return window.BremDatePicker.weekStartKey(raw);
    const date = new Date(`${raw}T00:00:00`);
    if (Number.isNaN(date.getTime())) return '';
    const diff = (date.getDay() - 3 + 7) % 7;
    date.setDate(date.getDate() - diff);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function normalizePlatform(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'baemin' || raw === '배민') return 'baemin';
    if (raw === 'coupang' || raw === '쿠팡') return 'coupang';
    return '';
  }

  const EXCEPTIONS = [
    {
      id: 'chuseok-2026',
      label: '2026 추석 분할정산',
      weekStart: '2026-09-16',
      weekEnd: '2026-09-22',
      finalizeAfter: '2026-09-29',
      batches: [
        {
          platform: 'baemin',
          startDate: '2026-09-16',
          endDate: '2026-09-20',
          paymentDate: '2026-09-23',
          kind: 'ops',
          title: '배민 배달료'
        },
        {
          platform: 'baemin',
          startDate: '2026-09-21',
          endDate: '2026-09-22',
          paymentDate: '2026-09-29',
          kind: 'ops',
          title: '배민 잔여 배달료'
        },
        {
          platform: 'coupang',
          startDate: '2026-09-16',
          endDate: '2026-09-22',
          paymentDate: '2026-09-28',
          kind: 'ops',
          title: '쿠팡 배달료'
        },
        {
          platform: 'baemin',
          paymentDate: '2026-09-29',
          kind: 'promotion',
          title: '배민 자체 프로모션(합산)'
        },
        {
          platform: 'coupang',
          paymentDate: '2026-09-28',
          kind: 'promotion',
          title: '쿠팡 자체 프로모션(합산)'
        }
      ],
      payoutWaves: [
        {
          id: 'baemin-fee-0923',
          label: '배민 배달료',
          hint: '내일 입금 · 급여명세서 반영. 프로모션은 빼요.',
          paymentDate: '2026-09-23',
          platform: 'baemin',
          startDate: '2026-09-16',
          endDate: '2026-09-20',
          includePromo: false,
          includeDelivery: true,
          includeOther: true
        },
        {
          id: 'coupang-0928',
          label: '쿠팡 배달료+프로모션',
          hint: '9/28 입금. 프로모션은 잘린 주정산을 합칩니다.',
          paymentDate: '2026-09-28',
          platform: 'coupang',
          startDate: '2026-09-16',
          endDate: '2026-09-22',
          includePromo: true,
          includeDelivery: true,
          includeOther: true
        },
        {
          id: 'baemin-promo-0929',
          label: '배민 잔여배달료+프로모션',
          hint: '9/29 입금. 주정산 프로모션은 잘려 들어와도 여기서 합칩니다.',
          paymentDate: '2026-09-29',
          platform: 'baemin',
          startDate: '2026-09-21',
          endDate: '2026-09-22',
          includePromo: true,
          includeDelivery: true,
          includeOther: false
        }
      ]
    }
  ];

  function getExceptionForWeek(weekStart) {
    const key = String(weekStart || '').slice(0, 10);
    if (!key) return null;
    return EXCEPTIONS.find(item => item.weekStart === key) || null;
  }

  function getExceptionForDate(dateValue) {
    const day = String(dateValue || '').slice(0, 10);
    if (!day) return null;
    return EXCEPTIONS.find(item => day >= item.weekStart && day <= item.weekEnd)
      || getExceptionForWeek(weekStartFromDate(day));
  }

  function payoutDatesFor(exception) {
    return [...new Set((exception?.batches || []).map(item => item.paymentDate).filter(Boolean))];
  }

  function latestPaymentDate(weekStart) {
    const exception = getExceptionForWeek(weekStart);
    if (!exception) return '';
    return payoutDatesFor(exception).sort().pop() || '';
  }

  function payoutWavesForWeek(weekStart) {
    const exception = getExceptionForWeek(weekStart);
    return Array.isArray(exception?.payoutWaves) ? exception.payoutWaves.slice() : [];
  }

  function getPayoutWave(weekStart, waveId) {
    const id = String(waveId || '').trim();
    if (!id || id === 'all') return null;
    return payoutWavesForWeek(weekStart).find(item => item.id === id) || null;
  }

  function defaultPayoutWaveId(weekStart) {
    const waves = payoutWavesForWeek(weekStart);
    if (!waves.length) return '';
    const today = todayKey();
    const upcoming = waves.find(item => String(item.paymentDate || '') >= today);
    return (upcoming || waves[0]).id;
  }

  function upcomingPaymentDate(weekStart) {
    const waves = payoutWavesForWeek(weekStart);
    if (!waves.length) return '';
    const today = todayKey();
    const upcoming = waves.find(item => String(item.paymentDate || '') >= today);
    return (upcoming || waves[waves.length - 1]).paymentDate || '';
  }

  function paymentDateForRange({ platform, startDate, endDate, weekStart } = {}) {
    const p = normalizePlatform(platform);
    const start = String(startDate || '').slice(0, 10);
    const end = String(endDate || start).slice(0, 10);
    const week = String(weekStart || weekStartFromDate(start) || '').slice(0, 10);
    const exception = getExceptionForWeek(week)
      || (start ? getExceptionForDate(start) : null);
    if (!exception || !p) return '';

    const ops = exception.batches.filter(item => item.kind === 'ops' && item.platform === p);
    const exact = ops.find(item => item.startDate === start && item.endDate === end);
    if (exact) return exact.paymentDate;

    const inside = ops.find(item => start && end && start >= item.startDate && end <= item.endDate);
    if (inside) return inside.paymentDate;

    const overlapping = ops.filter(item => (
      start && end && start <= item.endDate && end >= item.startDate
    ));
    if (overlapping.length) {
      return overlapping.map(item => item.paymentDate).sort().pop();
    }

    if (week === exception.weekStart) {
      return ops.map(item => item.paymentDate).sort().pop() || '';
    }
    return '';
  }

  function isHolidayPayoutDate(dateValue) {
    const day = String(dateValue || '').slice(0, 10);
    return EXCEPTIONS.some(item => payoutDatesFor(item).includes(day));
  }

  function dailyPeriodWarning(period, platform) {
    const day = String(period || '').slice(0, 10);
    if (!isHolidayPayoutDate(day)) return '';
    const exception = EXCEPTIONS.find(item => payoutDatesFor(item).includes(day));
    if (!exception) return '';
    const p = normalizePlatform(platform);
    const batch = exception.batches.find(item => (
      item.paymentDate === day && (!p || item.platform === p)
    ));
    const opsHint = batch?.kind === 'ops' && batch.startDate
      ? `${batch.startDate} ~ ${batch.endDate} 운행일`
      : `${exception.weekStart} ~ ${exception.weekEnd} 운행일`;
    return [
      `${day}은 ${exception.label} 지급일입니다.`,
      `일정산 정산일은 ${opsHint}로 올리세요.`,
      `지급일로 올리면 다음 주(${addDays(exception.weekStart, 7)}~${addDays(exception.weekStart, 13)}) 일정산에 섞입니다.`
    ].join(' ');
  }

  function opsBatches(weekStart) {
    const exception = getExceptionForWeek(weekStart);
    return (exception?.batches || []).filter(item => item.kind === 'ops' && item.startDate && item.endDate);
  }

  function batchKey(batch) {
    const platform = normalizePlatform(batch?.platform);
    const startDate = String(batch?.startDate || '').slice(0, 10);
    const endDate = String(batch?.endDate || startDate).slice(0, 10);
    return platform && startDate ? `${platform}:${startDate}:${endDate}` : '';
  }

  function finalizeGuard(weekStart) {
    const exception = getExceptionForWeek(weekStart);
    if (!exception) return { blocked: false };
    const pending = exception.batches
      .map(item => {
        const pay = item.paymentDate || '';
        const range = item.startDate && item.endDate ? `${item.startDate}~${item.endDate}` : '자체 프로모션';
        const plat = item.platform === 'baemin' ? '배민' : '쿠팡';
        return `· ${plat} ${item.title} ${range} → ${pay} 지급`;
      })
      .join('\n');
    return {
      blocked: false,
      exception,
      finalizeAfter: exception.finalizeAfter,
      message: [
        `${exception.label} 주는 구간별로 따로 마무리하세요.`,
        '',
        pending,
        '',
        '배달료는 들어온 주정산 구간만 마무리하면 됩니다. 프로모션은 주정산이 잘려 들어와도 합쳐서 나중에 정산하세요.',
        `전체 마무리는 ${exception.finalizeAfter} 프로모션까지 들어온 뒤에 하세요. 전체를 먼저 누르면 아직 안 온 구간까지 0원이 됩니다.`
      ].join('\n')
    };
  }

  function listSettlementParts(record) {
    const listed = window.BremWeeklySettlement?.listBaeminSourceParts?.(record);
    if (Array.isArray(listed) && listed.length) return listed;
    return [{
      fileName: String(record?.fileName || 'settlement').trim() || 'settlement',
      startDate: String(record?.startDate || '').slice(0, 10),
      endDate: String(record?.endDate || record?.startDate || '').slice(0, 10),
      riders: Array.isArray(record?.riders) ? record.riders : []
    }];
  }

  function partMatchesWave(part, wave, weekStart) {
    if (!wave) return true;
    const start = String(part?.startDate || '').slice(0, 10);
    const end = String(part?.endDate || start).slice(0, 10);
    if (!wave.startDate) return true;
    const pay = paymentDateForRange({
      platform: wave.platform || 'baemin',
      startDate: start,
      endDate: end,
      weekStart
    });
    if (wave.paymentDate && pay && pay === wave.paymentDate) return true;
    if (!start || !end) return false;
    const overlaps = start <= wave.endDate && end >= wave.startDate;
    if (!overlaps) return false;
    if (pay && wave.paymentDate && pay !== wave.paymentDate) return false;
    return true;
  }

  function sliceSettlementForWave(settlement, wave, weekStart) {
    if (!settlement) return null;
    if (!wave || wave.id === 'all') {
      return {
        ...settlement,
        includePromo: true,
        includeOther: true,
        ignoreSheetPayout: false,
        payoutWaveId: '',
        payoutPaymentDate: ''
      };
    }
    const platform = normalizePlatform(settlement.platform);
    if (wave.platform && platform !== wave.platform) return null;

    const flags = {
      includePromo: wave.includePromo === true,
      includeOther: wave.includeOther !== false,
      ignoreSheetPayout: true,
      payoutWaveId: wave.id,
      payoutPaymentDate: wave.paymentDate || ''
    };

    if (!wave.startDate || platform === 'coupang') {
      return { ...settlement, ...flags };
    }

    const week = String(weekStart || weekStartFromDate(settlement.startDate) || '').slice(0, 10);
    const parts = listSettlementParts(settlement);
    const matched = parts.filter(part => partMatchesWave(part, wave, week));
    if (!matched.length) return null;

    const merge = window.BremWeeklySettlement?.mergeBaeminRidersFromParts;
    const riders = typeof merge === 'function'
      ? merge(matched)
      : matched.flatMap(part => (Array.isArray(part.riders) ? part.riders : []));
    const startDate = matched.map(part => part.startDate).filter(Boolean).sort()[0]
      || wave.startDate;
    const endDate = matched.map(part => part.endDate).filter(Boolean).sort().pop()
      || wave.endDate;
    return {
      ...settlement,
      ...flags,
      riders,
      startDate,
      endDate
    };
  }

  function settlementsForWave(list, wave, weekStart) {
    return (Array.isArray(list) ? list : [])
      .map(record => sliceSettlementForWave(record, wave, weekStart))
      .filter(Boolean);
  }

  function bannerLines(exception) {
    if (!exception) return [];
    return [
      `운행주는 그대로 ${exception.weekStart}(수) ~ ${exception.weekEnd}(화) 입니다.`,
      '주정산은 부분1·부분2·부분3으로 나눠 올리고 태그를 붙이세요. 부분 하나만 있어도 정산결과·최종입금·급여명세서가 됩니다.',
      '내일 배달료는 배민 16~20을 부분1(태그: 배달료)로 올리세요. 프로모션은 나중에 부분으로 올려 9/29에 합칩니다.',
      '쿠팡 배달료+프로모션은 9/28, 배민 21~22 배달료+합친 프로모션은 9/29. 합치기는 원할 때 기록에서 하세요.',
      '최종입금·최종결산에서 태그가 있는 부분을 체크하세요. 일정산 정산일은 지급일이 아니라 운행일입니다.'
    ];
  }

  function bannerHtml(exception) {
    if (!exception) return '';
    const lines = bannerLines(exception)
      .map(line => `<li>${line}</li>`)
      .join('');
    return (
      `<aside class="holiday-settlement-banner" role="status">`
      + `<h3>${exception.label} · ${exception.weekStart} ~ ${exception.weekEnd}</h3>`
      + `<ul>${lines}</ul>`
      + `</aside>`
    );
  }

  const BANNER_SECTIONS = [
    'settlements',
    'weekly-settlement',
    'weekly-settlement-direct',
    'promotion-apply',
    'payroll-slips',
    'payroll-daily-settlement',
    'settlement-result-direct',
    'final-deposit'
  ];

  function mountBanners(weekStart) {
    const exception = getExceptionForWeek(weekStart)
      || getExceptionForWeek(weekStartFromDate(todayKey()))
      || getExceptionForDate(todayKey());
    if (!exception) return;
    const html = bannerHtml(exception);
    BANNER_SECTIONS.forEach(id => {
      const section = document.getElementById(id);
      if (!section) return;
      let host = section.querySelector('[data-holiday-settlement-banner]');
      if (!host) {
        host = document.createElement('div');
        host.setAttribute('data-holiday-settlement-banner', id);
        section.insertBefore(host, section.firstChild);
      }
      host.innerHTML = html;
    });
  }

  window.BremSettlementHoliday = {
    exceptions: EXCEPTIONS,
    todayKey,
    weekStartFromDate,
    getExceptionForWeek,
    getExceptionForDate,
    paymentDateForRange,
    latestPaymentDate,
    upcomingPaymentDate,
    payoutWavesForWeek,
    getPayoutWave,
    defaultPayoutWaveId,
    sliceSettlementForWave,
    settlementsForWave,
    isHolidayPayoutDate,
    dailyPeriodWarning,
    opsBatches,
    batchKey,
    finalizeGuard,
    bannerHtml,
    mountBanners
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => mountBanners());
  } else {
    mountBanners();
  }
})();
