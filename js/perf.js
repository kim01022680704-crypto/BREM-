/**
 * Lightweight perf helpers — save traces, console.time, debounce/throttle.
 */
window.BremPerf = (function () {
  const PREFIX = '[BREM:perf]';
  let activeSave = null;

  function label(name) {
    return `${PREFIX} ${name}`;
  }

  function time(name) {
    if (typeof console.time === 'function') console.time(label(name));
  }

  function timeEnd(name) {
    if (typeof console.timeEnd === 'function') console.timeEnd(label(name));
  }

  function beginSave(name) {
    activeSave = {
      name: String(name || 'save'),
      t0: performance.now(),
      phaseStart: performance.now(),
      phases: Object.create(null),
      apiCalls: 0,
      supabaseOps: 0
    };
    console.info('[BREM PERF]');
    console.info(`saveStart: ${activeSave.name}`);
    return activeSave;
  }

  function phase(name) {
    if (!activeSave) return;
    const now = performance.now();
    const key = String(name || 'step');
    activeSave.phases[key] = Math.round(now - activeSave.phaseStart);
    activeSave.phaseStart = now;
  }

  function countApi(n = 1) {
    if (activeSave) activeSave.apiCalls += Number(n) || 1;
  }

  function countSupabase(n = 1) {
    if (activeSave) activeSave.supabaseOps += Number(n) || 1;
  }

  function endSave() {
    if (!activeSave) return null;
    const total = Math.round(performance.now() - activeSave.t0);
    const order = ['prep', 'supabaseWrite', 'reloadData', 'renderUI'];
    order.forEach(key => {
      if (activeSave.phases[key] != null) {
        console.info(`${key}: ${activeSave.phases[key]}ms`);
      }
    });
    Object.keys(activeSave.phases).forEach(key => {
      if (!order.includes(key)) console.info(`${key}: ${activeSave.phases[key]}ms`);
    });
    if (activeSave.apiCalls) console.info(`apiCalls: ${activeSave.apiCalls}`);
    if (activeSave.supabaseOps) console.info(`supabaseOps: ${activeSave.supabaseOps}`);
    console.info(`total: ${total}ms`);
    const snapshot = { ...activeSave, total };
    activeSave = null;
    return snapshot;
  }

  async function runSave(name, steps = {}) {
    beginSave(name);
    try {
      if (typeof steps.prep === 'function') {
        await steps.prep();
        phase('prep');
      }
      if (typeof steps.write === 'function') {
        await steps.write();
        phase('supabaseWrite');
      }
      if (typeof steps.reload === 'function') {
        await steps.reload();
        phase('reloadData');
      }
      if (typeof steps.render === 'function') {
        await steps.render();
        phase('renderUI');
      }
      return true;
    } catch (error) {
      phase('error');
      throw error;
    } finally {
      endSave();
    }
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

  return {
    time,
    timeEnd,
    debounce,
    throttle,
    beginSave,
    phase,
    endSave,
    runSave,
    countApi,
    countSupabase
  };
})();
