/**
 * ERP 기사들 정비기록. 조회만 한다.
 */
(function () {
  const rowsEl = document.getElementById('maintRows');
  if (!rowsEl) return;
  let logs = [];

  function won(n) { return Number(n || 0).toLocaleString('ko-KR'); }
  function fillMonths() {
    const year = document.getElementById('maintYear');
    const month = document.getElementById('maintMonth');
    const now = new Date();
    if (year && !year.options.length) {
      for (let y = now.getFullYear(); y >= now.getFullYear() - 3; y -= 1) {
        year.add(new Option(`${y}년`, String(y)));
      }
    }
    if (month && !month.options.length) {
      month.add(new Option('월 전체', ''));
      for (let m = 1; m <= 12; m += 1) month.add(new Option(`${m}월`, String(m).padStart(2, '0')));
      month.value = String(now.getMonth() + 1).padStart(2, '0');
    }
  }

  function paint() {
    fillMonths();
    const q = document.getElementById('maintSearch')?.value.trim() || '';
    const bike = document.getElementById('maintBike')?.value || '';
    const part = document.getElementById('maintPart')?.value || '';
    const year = document.getElementById('maintYear')?.value || '';
    const month = document.getElementById('maintMonth')?.value || '';
    const bikes = [...new Set(logs.map(row => row.bikeModel).filter(Boolean))];
    const bikeSel = document.getElementById('maintBike');
    if (bikeSel) {
      const current = bikeSel.value;
      bikeSel.innerHTML = '<option value="">오토바이 전체</option>' + bikes.map(name => `<option ${name === current ? 'selected' : ''}>${name}</option>`).join('');
    }
    const filtered = logs.filter(row => {
      const blob = `${row.name || ''}${row.phone || ''}`;
      if (q && !blob.includes(q)) return false;
      if (bike && row.bikeModel !== bike) return false;
      if (part === 'other') {
        if (['오일', '패드', '구동계'].includes(row.partLabel)) return false;
      } else if (part && row.partLabel !== part) return false;
      if (year && !String(row.date).startsWith(year)) return false;
      if (month && String(row.date).slice(5, 7) !== month) return false;
      return true;
    });
    rowsEl.innerHTML = filtered.map(row => `<tr><td>${row.name || ''}</td><td>${row.phone || ''}</td><td>${row.bikeModel || ''}</td><td>${String(row.date || '').replace(/-/g, '.')}</td><td>${won(row.km)}</td><td>${row.partLabel || ''}</td><td>${won(row.cost)}</td></tr>`).join('')
      || '<tr><td colspan="7">기록이 없습니다.</td></tr>';
  }

  async function load() {
    const token = await window.BremStorage?.resolveAdminAccessToken?.();
    if (!token) return;
    const res = await fetch('/api/admin/rider-maintenance', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return;
    logs = data.logs || [];
    paint();
  }

  ['maintSearch', 'maintBike', 'maintPart', 'maintYear', 'maintMonth'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', paint);
    document.getElementById(id)?.addEventListener('change', paint);
  });
  document.querySelector('[data-section="rider-maintenance"]')?.addEventListener('click', () => setTimeout(load, 0));
  fillMonths();
})();
