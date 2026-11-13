/**
 * Tasa del dólar (admin): BCV al inicio, manual con duración, doble clic → BCV.
 * Misma API que caja (/api/tasa-bcv*).
 */
(function () {
  const state = {
    price: null,
    source: null,
    locked: false,
    lock: null,
    bcv_tasa: null,
    date: null
  };

  function money(n) {
    return Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }

  function applyPayload(j) {
    if (!j || !(Number(j.tasa) > 0)) return false;
    state.price = Number(j.tasa);
    state.source = j.source || state.source;
    state.locked = !!j.locked;
    state.lock = j.lock || null;
    state.date = j.fecha || state.date;
    if (j.bcv_tasa != null && Number(j.bcv_tasa) > 0) state.bcv_tasa = Number(j.bcv_tasa);
    updateUi();
    return true;
  }

  function updateUi() {
    const chipVal = document.getElementById('adminTasaDisplay');
    const chip = document.getElementById('adminTasaChip');
    const panelVal = document.getElementById('adminTasaPanelValue');
    const panelMeta = document.getElementById('adminTasaPanelMeta');
    const txt = state.price != null ? money(state.price) : '—';
    if (chipVal) chipVal.textContent = txt;
    if (panelVal) panelVal.textContent = txt;
    let meta = state.locked ? 'Tasa manual' : ('BCV · ' + (state.source || '—'));
    if (state.locked && state.lock && state.lock.expires_at) {
      try {
        meta += ' hasta ' + new Date(state.lock.expires_at).toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' });
      } catch (_) {}
    }
    if (panelMeta) panelMeta.textContent = meta;
    if (chip) {
      chip.title = meta + ' · Clic: cambiar · Doble clic: BCV';
      chip.classList.toggle('manual', !!state.locked);
    }
  }

  async function refresh() {
    try {
      const res = await fetch('/api/tasa-bcv', { credentials: 'include' });
      const j = await res.json().catch(() => null);
      if (j) applyPayload(j);
    } catch (_) {}
  }

  async function saveManual() {
    const input = document.getElementById('adminTasaInput');
    const dur = document.getElementById('adminTasaDuration');
    const err = document.getElementById('adminTasaMsg');
    const v = parseFloat(input && input.value);
    const days = Math.max(1, Number((dur && dur.value) || 7) || 7);
    if (!v || v <= 0) {
      if (err) err.textContent = 'Ingresa un valor válido mayor a 0';
      return;
    }
    try {
      const res = await fetch('/api/tasa-bcv/manual', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasa: v, duration_days: days })
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j || !j.ok) {
        if (err) err.textContent = (j && j.error) || 'No se pudo guardar';
        return;
      }
      applyPayload(j);
      if (err) err.textContent = 'Guardada por ' + days + (days === 1 ? ' día' : ' días');
      hideModal();
    } catch (_) {
      if (err) err.textContent = 'Sin conexión';
    }
  }

  async function useBcv() {
    const err = document.getElementById('adminTasaMsg');
    try {
      const res = await fetch('/api/tasa-bcv/usar-bcv', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j || !j.ok) {
        if (err) err.textContent = (j && j.error) || 'No se pudo obtener BCV';
        return;
      }
      applyPayload(j);
      if (err) err.textContent = 'Tasa BCV restaurada';
      hideModal();
    } catch (_) {
      if (err) err.textContent = 'Sin conexión';
    }
  }

  function showModal() {
    const modal = document.getElementById('adminTasaModal');
    const input = document.getElementById('adminTasaInput');
    const dur = document.getElementById('adminTasaDuration');
    const err = document.getElementById('adminTasaMsg');
    if (err) err.textContent = '';
    if (input && state.price) input.value = String(state.price);
    if (dur) {
      const days = (state.lock && state.lock.duration_days) || 7;
      if ([...dur.options].some((o) => Number(o.value) === Number(days))) dur.value = String(days);
      else dur.value = '7';
    }
    if (modal) modal.style.display = 'flex';
  }

  function hideModal() {
    const modal = document.getElementById('adminTasaModal');
    if (modal) modal.style.display = 'none';
  }

  function bind() {
    const chip = document.getElementById('adminTasaChip');
    if (chip) {
      let t = null;
      chip.style.cursor = 'pointer';
      chip.addEventListener('click', (e) => {
        if (e.detail > 1) return;
        clearTimeout(t);
        t = setTimeout(showModal, 280);
      });
      chip.addEventListener('dblclick', (e) => {
        e.preventDefault();
        clearTimeout(t);
        useBcv();
      });
    }
    const openBtn = document.getElementById('adminTasaOpenBtn');
    if (openBtn) openBtn.addEventListener('click', showModal);
    const saveBtn = document.getElementById('adminTasaSave');
    if (saveBtn) saveBtn.addEventListener('click', saveManual);
    const bcvBtn = document.getElementById('adminTasaUseBcv');
    if (bcvBtn) bcvBtn.addEventListener('click', useBcv);
    const cancelBtn = document.getElementById('adminTasaCancel');
    if (cancelBtn) cancelBtn.addEventListener('click', hideModal);
  }

  document.addEventListener('DOMContentLoaded', () => {
    bind();
    refresh();
    setInterval(refresh, 5 * 60 * 1000);
  });

  window.MaxTasaAdmin = { refresh, showModal, useBcv, saveManual };
})();
