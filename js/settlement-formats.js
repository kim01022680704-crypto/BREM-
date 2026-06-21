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
        settlementAmount: 'AC'
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
        deliveryAmount: 'AH'
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

  return {
    DEFAULT_FORMAT_ID,
    formats,
    columnToIndex,
    getFormat,
    getFormatForPlatform,
    isBaeminDelivery,
    listFormats
  };
})();
