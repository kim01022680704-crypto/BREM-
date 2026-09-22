/**
 * 명절처럼 수~화 운행주는 그대로인데 지급·마무리가 갈라지는 주.
 * 이번 추석(2026-09-16 주): 배민 16~20 / 21~22 분할, 쿠팡은 한 주, 마무리는 29일 이후.
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
          title: '배민 운행분'
        },
        {
          platform: 'baemin',
          startDate: '2026-09-21',
          endDate: '2026-09-22',
          paymentDate: '2026-09-29',
          kind: 'ops',
          title: '배민 운행분'
        },
        {
          platform: 'coupang',
          startDate: '2026-09-16',
          endDate: '2026-09-22',
          paymentDate: '2026-09-28',
          kind: 'ops',
          title: '쿠팡 운행분'
        },
        {
          platform: 'baemin',
          paymentDate: '2026-09-29',
          kind: 'promotion',
          title: '배민 자체 프로모션'
        },
        {
          platform: 'coupang',
          paymentDate: '2026-09-28',
          kind: 'promotion',
          title: '쿠팡 자체 프로모션'
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
        '배민 9/16~9/20, 쿠팡 9/16~9/22, 배민 9/21~9/22를 들어온 순서대로 마무리하면 그 구간만 출금이 닫힙니다.',
        `전체 마무리는 ${exception.finalizeAfter} 프로모션까지 들어온 뒤에 하세요. 전체를 먼저 누르면 아직 안 온 구간까지 0원이 됩니다.`
      ].join('\n')
    };
  }

  function bannerLines(exception) {
    if (!exception) return [];
    return [
      `운행주는 그대로 ${exception.weekStart}(수) ~ ${exception.weekEnd}(화) 입니다.`,
      '배민 9/16~9/20 → 9/23(수) 정산 · 9/21~9/22 → 9/29(화) 정산 · 자체 프로모션 9/29(화) 지급',
      '쿠팡 9/16~9/22 → 9/28(월) 정산 · 자체 프로모션 9/28(월) 지급',
      '일정산 정산일은 지급일이 아니라 운행일입니다. 9/23·9/28·9/29로 올리면 다음 주에 섞입니다.',
      '정산마무리는 들어온 구간만 따로 하세요. 배민 16~20 / 쿠팡 / 배민 21~22. 전체 마무리는 마지막에.'
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
