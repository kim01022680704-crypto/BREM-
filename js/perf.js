/**
 * Lightweight perf helpers — console.time labels + debounce/throttle.
 */
window.BremPerf = (function () {
  const PREFIX = '[BREM:perf]';

  function label(name) {
    return `${PREFIX} ${name}`;
  }

  function time(name) {
    if (typeof console.time === 'function') console.time(label(name));
  }

  function timeEnd(name) {
    if (typeof console.timeEnd === 'function') console.timeEnd(label(name));
  }

  function debounce(fn, waitMs = 200) {
    let timer = null;
    return function debounced(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), waitMs);
    };
  }

  function throttle(fn, waitMs = 200) {
    let lastRun = 0;
    let timer = null;
    return function throttled(...args) {
      const now = Date.now();
      const remaining = waitMs - (now - lastRun);
      if (remaining <= 0) {
        clearTimeout(timer);
        timer = null;
        lastRun = now;
        fn.apply(this, args);
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        lastRun = Date.now();
        timer = null;
        fn.apply(this, args);
      }, remaining);
    };
  }

  return { time, timeEnd, debounce, throttle };
})();
