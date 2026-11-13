/**
 * MAX — Configuración de IVA (admin) + helper global MaxIva
 * precio_venta en BD = base. Precio al público = base × (1 + IVA) si está activo.
 */
(function () {
  window.MaxIva = {
    activo: false,
    porcentaje: 16,
    factor() {
      if (!this.activo) return 1;
      const pct = Number(this.porcentaje) || 16;
      return 1 + pct / 100;
    },
    montoIva(base) {
      const b = Math.max(0, Number(base) || 0);
      if (!this.activo) return 0;
      return Number((b * ((Number(this.porcentaje) || 16) / 100)).toFixed(4));
    },
    precioPublico(base) {
      const b = Math.max(0, Number(base) || 0);
      if (!this.activo) return b;
      return Number((b * this.factor()).toFixed(4));
    },
    fmtUsd(n) {
      return '$' + Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },
    applyState(activo, porcentaje) {
      this.activo = !!activo;
      const pct = Number(porcentaje);
      this.porcentaje = Number.isFinite(pct) && pct >= 0 ? pct : 16;
      document.dispatchEvent(new CustomEvent('max-iva-changed', { detail: { activo: this.activo, porcentaje: this.porcentaje } }));
    }
  };

  function syncPreview() {
    const activo = !!(document.getElementById('ivaActivoToggle') || {}).checked;
    let pct = parseFloat((document.getElementById('ivaPorcentajeInput') || {}).value);
    if (!Number.isFinite(pct) || pct < 0) pct = 16;
    const base = 10;
    const iva = activo ? base * (pct / 100) : 0;
    const total = base + iva;

    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('ivaPrevBase', window.MaxIva.fmtUsd(base));
    set('ivaPrevPct', String(pct));
    set('ivaPrevIva', window.MaxIva.fmtUsd(iva));
    set('ivaPrevTotal', window.MaxIva.fmtUsd(total));

    const label = document.getElementById('ivaActivoLabel');
    if (label) label.textContent = activo ? 'Activado' : 'Apagado';

    const row = document.getElementById('ivaPrevIvaRow');
    if (row) row.style.display = activo ? '' : 'none';

    const badge = document.getElementById('ivaPrevBadge');
    if (badge) {
      badge.textContent = activo
        ? 'En inventario y etiquetas verás el precio al público (base + IVA). El cliente paga ese mismo monto.'
        : 'IVA desactivado — se muestra y cobra solo el precio registrado.';
      badge.classList.toggle('on', activo);
    }

    const box = document.getElementById('ivaPreviewBox');
    if (box) box.classList.toggle('iva-on', activo);

    updateProdHint(activo, pct);
    updatePrecioPublicoPreview();
  }

  function updateProdHint(activo, pct) {
    const hint = document.getElementById('prodPrecioIvaHint');
    if (!hint) return;
    if (activo) {
      hint.innerHTML = `Registra el precio <strong>base</strong>. El cliente paga base + IVA (${pct}%). Abajo verás el <strong>precio al público</strong> que sale en etiquetas y caja.`;
    } else {
      hint.textContent = 'Precio de venta. Si activas IVA en Impuestos, se sumará automáticamente al público.';
    }
  }

  function updatePrecioPublicoPreview() {
    const input = document.getElementById('prodPrecio');
    const out = document.getElementById('prodPrecioPublico');
    const wrap = document.getElementById('prodPrecioPublicoWrap');
    if (!input || !out) return;
    const base = parseFloat(input.value) || 0;
    const activo = window.MaxIva.activo;
    const pub = window.MaxIva.precioPublico(base);
    const iva = window.MaxIva.montoIva(base);
    if (wrap) wrap.style.display = activo ? '' : 'none';
    out.textContent = activo
      ? `${window.MaxIva.fmtUsd(pub)} al público (base ${window.MaxIva.fmtUsd(base)} + IVA ${window.MaxIva.fmtUsd(iva)})`
      : '';

    const editIn = document.getElementById('editPrecio');
    const editOut = document.getElementById('editPrecioPublico');
    const editWrap = document.getElementById('editPrecioPublicoWrap');
    if (editIn && editOut) {
      const b2 = parseFloat(editIn.value) || 0;
      const p2 = window.MaxIva.precioPublico(b2);
      const i2 = window.MaxIva.montoIva(b2);
      if (editWrap) editWrap.style.display = window.MaxIva.activo ? '' : 'none';
      editOut.textContent = window.MaxIva.activo
        ? `${window.MaxIva.fmtUsd(p2)} al público (+ IVA ${window.MaxIva.fmtUsd(i2)})`
        : '';
    }
  }

  async function loadIva() {
    try {
      const res = await fetch('/api/admin/config/iva', { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) return;
      const toggle = document.getElementById('ivaActivoToggle');
      const pctInput = document.getElementById('ivaPorcentajeInput');
      if (toggle) toggle.checked = !!data.activo;
      if (pctInput) pctInput.value = Number(data.porcentaje != null ? data.porcentaje : 16);
  window.MaxIva.applyState(!!data.activo, Number(data.porcentaje || 16));
      window.MaxIva._loaded = true;
      syncPreview();
    } catch (e) {
      console.warn('No se pudo cargar IVA:', e);
    }
  }

  async function saveIva() {
    const btn = document.getElementById('ivaGuardarBtn');
    const msg = document.getElementById('ivaSaveMsg');
    const activo = !!(document.getElementById('ivaActivoToggle') || {}).checked;
    let porcentaje = parseFloat((document.getElementById('ivaPorcentajeInput') || {}).value);
    if (!Number.isFinite(porcentaje) || porcentaje < 0) porcentaje = 16;
    if (btn) btn.disabled = true;
    if (msg) { msg.textContent = 'Guardando…'; msg.className = 'iva-save-msg'; }
    try {
      const res = await fetch('/api/admin/config/iva', {
        credentials: 'include',
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activo, porcentaje })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'No se pudo guardar');
      }
      window.MaxIva.applyState(!!data.activo, Number(data.porcentaje || 16));
      if (msg) {
        msg.textContent = data.mensaje || 'Guardado';
        msg.className = 'iva-save-msg ok';
      }
      syncPreview();
      // Refrescar listado de productos para mostrar precio al público
      if (typeof window.refrescarListadoProductosAdmin === 'function') {
        window.refrescarListadoProductosAdmin();
      }
    } catch (e) {
      if (msg) {
        msg.textContent = e.message || 'Error al guardar';
        msg.className = 'iva-save-msg err';
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function bind() {
    const toggle = document.getElementById('ivaActivoToggle');
    const pct = document.getElementById('ivaPorcentajeInput');
    const btn = document.getElementById('ivaGuardarBtn');
    const prodPrecio = document.getElementById('prodPrecio');
    const editPrecio = document.getElementById('editPrecio');
    if (toggle) toggle.addEventListener('change', syncPreview);
    if (pct) pct.addEventListener('input', syncPreview);
    if (btn) btn.addEventListener('click', saveIva);
    if (prodPrecio) prodPrecio.addEventListener('input', updatePrecioPublicoPreview);
    if (editPrecio) editPrecio.addEventListener('input', updatePrecioPublicoPreview);

    const orig = window.switchTab;
    if (typeof orig === 'function' && !orig._ivaWrapped) {
      window.switchTab = function (tab) {
        orig(tab);
        if (tab === 'impuestos') loadIva();
      };
      window.switchTab._ivaWrapped = true;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    bind();
    loadIva();
  });

  document.addEventListener('max-iva-changed', () => {
    if (typeof window.refrescarListadoProductosAdmin === 'function') {
      window.refrescarListadoProductosAdmin();
    }
    updatePrecioPublicoPreview();
  });

  window.MaxIva.updatePrecioPublicoPreview = updatePrecioPublicoPreview;
})();
