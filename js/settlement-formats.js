const SettlementFormats = (function () {
  const DEFAULT_FORMAT_ID = 'brem-standard';

  const formats = {
    'brem-standard': {
      id: 'brem-standard',
      label: '쿠팡 기본 정산표',
      platform: 'coupang',
      mode: 'driver-row',
      sheetIndex: 0,
      startRow: 12,
      columns: {
        name: 'C',
        orderCount: 'F',
        hourlyInsurance: 'AH',
        // 일정산 쿠팡 배달료(정산금액)는 AL. 직계약 주정산 배달료(AM)와는 열이 다르다.
        settlementAmount: 'AL',
        // AL 은 콜수수료가 이미 빠진 금액이라 원천세·고용보험·산재보험 기준으로
        // 쓰면 금액이 맞지 않는다. 세 공제의 기준 금액은 AC 열을 쓴다.
        deductionBase: 'AC'
      },
      cleanName(rawName) {
        return String(rawName || '').trim().replace(/[0-9]+$/, '');
      }
    },
    'brem-baemin': {
      id: 'brem-baemin',
      label: '배민 배달 건별 정산서',
      platform: 'baemin',
      mode: 'baemin-delivery',
      sheetIndex: 0,
      startRow: 2,
      columns: {
        riderId: 'K',
        name: 'L',
        storeArrival: 'U',
        columnV: 'V',
        deliveryAmount: 'AH'
      },
      cleanName(rawName) {
        return String(rawName || '').trim().replace(/\s+/g, '');
      }
    },
    'brem-coupang-delivery': {
      id: 'brem-coupang-delivery',
      label: '쿠팡 오더별 상세내역',
      platform: 'coupang',
      mode: 'coupang-delivery',
      sheetIndex: 2,
      sheetMatcher: '오더별 상세내역',
      startRow: 2,
      columns: {
        name: 'B',
        deliveryAmount: 'Y'
      },
      cleanName(rawName) {
        return String(rawName || '').trim().replace(/\s+/g, '');
      }
    }
  };

  function columnToIndex(column) {
    const letters = String(column || '').trim().toUpperCase();
    if (!letters) return -1;

    let index = 0;
    for (let i = 0; i < letters.length; i++) {
      index = index * 26 + (letters.charCodeAt(i) - 64);
    }
    return index - 1;
  }

  function getFormat(formatId) {
    return formats[formatId || DEFAULT_FORMAT_ID] || formats[DEFAULT_FORMAT_ID];
  }

  function listFormats() {
    return Object.values(formats);
  }

  function getFormatForPlatform(platform) {
    if (platform === 'baemin') return formats['brem-baemin'] || formats[DEFAULT_FORMAT_ID];
    return formats[DEFAULT_FORMAT_ID];
  }

  function isBaeminDelivery(format) {
    return format?.mode === 'baemin-delivery';
  }

  function isCoupangDelivery(format) {
    return format?.mode === 'coupang-delivery';
  }

  return {
    DEFAULT_FORMAT_ID,
    formats,
    columnToIndex,
    getFormat,
    getFormatForPlatform,
    isBaeminDelivery,
    isCoupangDelivery,
    listFormats
  };
})();
