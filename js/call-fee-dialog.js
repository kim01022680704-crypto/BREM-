(function () {
  let activeResolve = null;
  let initialized = false;

  const $ = selector => document.querySelector(selector);

  function normalizeUnit(value) {
    if (value == null || value === '') return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0 || !Number.isInteger(numeric)) return null;
    return numeric;
  }

  function close(result) {
    const root = $('#callFeeSetupDialog');
    if (root) root.hidden = true;
    const resolve = activeResolve;
    activeResolve = null;
    if (resolve) resolve(result);
  }

  function init() {
    if (initialized) return;
    const root = $('#callFeeSetupDialog');
    const form = $('#callFeeSetupForm');
    const input = $('#callFeeSetupUnit');
    const error = $('#callFeeSetupError');
    if (!root || !form || !input || !error) return;

    initialized = true;
    form.addEventListener('submit', event => {
      event.preventDefault();
      const unit = normalizeUnit(input.value);
      if (unit == null) {
        error.textContent = '0 이상의 정수 단가를 입력하세요. 수수료가 없으면 0을 입력합니다.';
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        return;
      }
      error.textContent = '';
      input.removeAttribute('aria-invalid');
      close(unit);
    });
    root.querySelectorAll('[data-close-call-fee-dialog]').forEach(button => {
      button.addEventListener('click', () => close(null));
    });
    root.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(null);
      }
    });
  }

  function open(options = {}) {
    init();
    const root = $('#callFeeSetupDialog');
    const input = $('#callFeeSetupUnit');
    if (!root || !input) return Promise.resolve(null);

    if (activeResolve) close(null);

    const platform = String(options.platform || '').toLowerCase() === 'baemin' ? '배민' : '쿠팡';
    const kind = options.kind === 'weekly' ? '직계약 주정산서' : '일정산서';
    const title = $('#callFeeSetupTitle');
    const meta = $('#callFeeSetupMeta');
    const calls = $('#callFeeSetupCalls');
    const error = $('#callFeeSetupError');
    const initial = normalizeUnit(options.initialValue);

    if (title) title.textContent = `${platform} ${kind} 콜수수료 설정`;
    if (meta) {
      const fileName = String(options.fileName || '').trim() || '파일명 없음';
      const period = String(options.period || '').trim() || '기간 미확인';
      meta.textContent = `${fileName} · ${period}`;
    }
    if (calls) {
      calls.textContent = `${Number(options.totalCalls || 0).toLocaleString('ko-KR')}콜`;
    }
    if (error) error.textContent = '';
    input.removeAttribute('aria-invalid');
    input.value = initial == null ? '' : String(initial);
    root.hidden = false;

    return new Promise(resolve => {
      activeResolve = resolve;
      window.setTimeout(() => {
        input.focus();
        input.select();
      }, 0);
    });
  }

  window.BremCallFeeDialog = {
    open,
    normalizeUnit
  };
})();
