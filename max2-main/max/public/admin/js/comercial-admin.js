// public/comercial-admin.js — Licencias, alertas de stock, dashboard v1
(function () {
  let curva7dChart = null;
  let curva7dSignature = '';
  const STOCK_POPUP_KEY = 'max_stock_popup_date';

  function fmtMoney(n) {
    return '$' + Number(n || 0).toFixed(2);
  }

  function renderCurva7d(curva) {
    const wrapId = 'curvaVentas7dWrap';
    const canvasId = 'curvaVentas7dChart';
    const helpers = window.MaxDashCharts;
    const rows = Array.isArray(curva) ? curva : [];
    const signature = rows.map((r) => `${r.dia}:${r.total}`).join('|');

    if (!rows.length) {
      if (helpers) helpers.showEmpty(wrapId, 'Sin ventas en los últimos 7 días');
      curva7dChart = null;
      curva7dSignature = '';
      return;
    }

    // Evitar redibujar cada 8s si los datos no cambiaron (no pisa otras gráficas)
    if (signature === curva7dSignature && curva7dChart) {
      try { curva7dChart.resize(); } catch (_) {}
      return;
    }
    curva7dSignature = signature;

    if (typeof Chart === 'undefined') {
      setTimeout(() => renderCurva7d(curva), 120);
      return;
    }

    const canvasEl = helpers
      ? helpers.ensureCanvas(wrapId, canvasId)
      : document.getElementById(canvasId);
    if (!canvasEl) return;

    if (helpers) helpers.destroyOn(canvasEl);
    if (curva7dChart) {
      try { curva7dChart.destroy(); } catch (_) {}
      curva7dChart = null;
    }

    const labels = rows.map((r) => {
      try {
        const d = new Date(r.dia);
        return d.toLocaleDateString('es-VE', { weekday: 'short', day: 'numeric', month: 'short' });
      } catch (_) {
        return String(r.dia || '');
      }
    });
    const values = rows.map((r) => Number(r.total || 0));
    const ctx = canvasEl.getContext('2d');
    let fill = 'rgba(37, 99, 235, 0.15)';
    try {
      const g = ctx.createLinearGradient(0, 0, 0, 260);
      g.addColorStop(0, 'rgba(37, 99, 235, 0.35)');
      g.addColorStop(1, 'rgba(37, 99, 235, 0.02)');
      fill = g;
    } catch (_) {}
    curva7dChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Ventas ($)',
          data: values,
          borderColor: '#2563eb',
          backgroundColor: fill,
          borderWidth: 3,
          fill: true,
          tension: 0.35,
          pointRadius: 5,
          pointHoverRadius: 7,
          pointBackgroundColor: '#fff',
          pointBorderColor: '#2563eb',
          pointBorderWidth: 2,
          spanGaps: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 600 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0f172a',
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              label: (c) => 'Ventas: $' + Number(c.parsed.y || 0).toFixed(2)
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#64748b', font: { size: 11 }, maxRotation: 0 }
          },
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(148,163,184,0.28)', drawBorder: false },
            ticks: {
              color: '#64748b',
              callback: (v) => '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })
            }
          }
        }
      }
    });
    requestAnimationFrame(() => {
      try { curva7dChart && curva7dChart.resize(); } catch (_) {}
    });
  }

  function closeStockAlertModal() {
    const modal = document.getElementById('stockAlertModal');
    if (modal) modal.style.display = 'none';
  }

  function maybeShowStockPopup(alertas) {
    const list = Array.isArray(alertas) ? alertas : [];
    if (!list.length) return;
    const today = new Date().toISOString().slice(0, 10);
    try {
      if (sessionStorage.getItem(STOCK_POPUP_KEY) === today) return;
    } catch (_) {}
    const modal = document.getElementById('stockAlertModal');
    const box = document.getElementById('stockAlertList');
    if (!modal || !box) return;
    box.innerHTML = list.slice(0, 15).map((p) => {
      const crit = Number(p.inventario) <= 0;
      return `<div class="item" style="border-left:3px solid ${crit ? '#dc2626' : '#f59e0b'};">
        <span><b>${p.nombre || 'Producto'}</b>${p.marca ? ' · ' + p.marca : ''}<br>
        <small style="color:#64748b;">Stock: ${p.inventario} / mín ${p.stock_minimo != null ? p.stock_minimo : '—'}</small></span>
      </div>`;
    }).join('');
    if (list.length > 15) {
      box.innerHTML += `<div class="item" style="color:#64748b;font-size:0.9em;">… y ${list.length - 15} más</div>`;
    }
    modal.style.display = 'block';
    try { sessionStorage.setItem(STOCK_POPUP_KEY, today); } catch (_) {}
  }

  function setupStockAlertModal() {
    const close = document.getElementById('stockAlertClose');
    const dismiss = document.getElementById('stockAlertDismiss');
    const goInv = document.getElementById('stockAlertGoInv');
    if (close) close.addEventListener('click', closeStockAlertModal);
    if (dismiss) dismiss.addEventListener('click', closeStockAlertModal);
    if (goInv) {
      goInv.addEventListener('click', () => {
        closeStockAlertModal();
        if (typeof window.switchTab === 'function') window.switchTab('inventario');
      });
    }
    const modal = document.getElementById('stockAlertModal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeStockAlertModal();
      });
    }
  }

  async function cargarLicenciasPanel() {
    const box = document.getElementById('licenciasEstadoBox');
    if (!box) return;
    box.innerHTML = '<div class="lic-loading">Cargando licencia…</div>';
    try {
      const res = await fetch('/api/licencias/estado', { credentials: 'include' });
      const data = await res.json();
      if (!data.ok && !data.licencia) {
        box.innerHTML = `<div class="lic-error">${data.error || 'Falta la migración comercial de licencias en la base de datos'}</div>`;
        return;
      }
      const lic = data.licencia || {};
      const cupos = data.cupos || { usados: 0, limite: 0 };
      const cajas = data.cajas || [];
      const cajaMayorRegistrada = cajas.some((c) => String(c.nombre_caja || '').trim().toLowerCase() === 'caja mayor');
      const sesiones = data.sesiones || [];
      const planCodigo = String(lic.tipo_plan || '').toUpperCase();
      const planNombre = ({ BASICO: 'Básico', ESTANDAR: 'Estándar', PRO: 'Pro', ULTRA: 'Ultra' })[planCodigo] || (lic.tipo_plan || '—');
      const planClass = ({ BASICO: 'basico', ESTANDAR: 'standard', PRO: 'pro', ULTRA: 'ultra' })[planCodigo] || 'basico';
      const planMetal = ({ BASICO: 'Bronce', ESTANDAR: 'Plata', PRO: 'Oro', ULTRA: 'Diamante' })[planCodigo] || 'Bronce';
      const proveedor = (lic.cliente || '—').trim();
      const pct = cupos.limite > 0 ? Math.min(100, Math.round((cupos.usados / cupos.limite) * 100)) : 0;
      const onlineIds = new Set((sesiones || []).map((s) => Number(s.id_caja)).filter(Boolean));

      const cajasHtml = cajas.length
        ? cajas.map((c) => {
            const activa = String(c.estado || '').toUpperCase() === 'ACTIVA';
            const online = onlineIds.has(Number(c.id_caja));
            const id = Number(c.id_caja);
            return `
              <article class="lic-caja-card lic-caja-card--${planClass} ${activa ? 'is-activa' : 'is-inactiva'}">
                <div class="lic-caja-top">
                  <span class="lic-caja-name">${escapeHtml(c.nombre_caja || 'Caja')}</span>
                  <span class="lic-caja-badge ${online ? 'online' : (activa ? 'idle' : 'off')}">${online ? 'En línea' : (activa ? 'Registrada' : 'Inactiva')}</span>
                </div>
                <div class="lic-caja-meta">
                  <span>Clave <code>${escapeHtml(c.clave_caja || '—')}</code></span>
                  ${c.direccion_mac ? `<span>MAC ${escapeHtml(c.direccion_mac)}</span>` : ''}
                </div>
                <div class="lic-caja-actions">
                  <button type="button" class="btn btn-small secondary lic-caja-hist-btn"
                    data-caja-id="${id}"
                    data-caja-nombre="${escapeHtml(c.nombre_caja || 'Caja')}">
                    Ver historial
                  </button>
                </div>
              </article>`;
          }).join('')
        : '<div class="lic-empty">Aún no hay cajas registradas.</div>';

      const sesionesHtml = sesiones.length
        ? `<div class="lic-sessions">
            <h4 class="lic-section-title">Sesiones activas</h4>
            <div class="lic-session-row">
              ${sesiones.map((s) => `
                <div class="lic-session-chip">
                  <strong>${escapeHtml(s.nombre_caja || 'Caja')}</strong>
                  <span>${escapeHtml(s.usuario || '—')}</span>
                </div>`).join('')}
            </div>
          </div>`
        : '';

      const red = data.red || {};
      const cajaUrl = red.caja_url || '';
      const cajaMayorUrl = red.caja_mayor_url || '';
      const cajaMayorPuerto = Number(red.caja_mayor_port_configurado) || 3011;
      const celularUrl = red.celular_url || '';
      const celularStatus = String(red.celular_status || 'off');
      const celularError = red.celular_error || '';
      const celularPermanente = !!red.celular_permanente;
      const qrReady = celularStatus === 'ready' && !!celularUrl;
      const estadoTxt =
        celularStatus === 'ready' && celularUrl
          ? 'Listo para escanear'
          : celularStatus === 'starting'
            ? 'Generando enlace… espera unos segundos'
            : celularStatus === 'error'
              ? ('Error: ' + (celularError || 'no disponible'))
              : 'Aún no hay enlace (espera ~10 s tras abrir MAX)';
      const cajaMayorRedHtml = window.maxSetupFeatureEnabled('cajaMayor') ? `
          <div class="lic-red-row" style="margin-top:10px;">
            <div class="lic-red-url">
              <span class="lic-red-label">Caja Mayor (misma Wi‑Fi)</span>
              <code id="licCajaMayorUrl">${escapeHtml(cajaMayorUrl || `Puerto ${cajaMayorPuerto} no disponible`)}</code>
              <small class="lic-qr-help">${cajaMayorUrl
                ? (cajaMayorRegistrada
                  ? 'Terminal registrada; comparte este enlace solo con la PC de Caja Mayor.'
                  : 'Pendiente de registrar la terminal; regístrala en esta sección antes de vender.')
                : 'MAX no pudo abrir el puerto dedicado. Verifica que esté libre y reinicia el servidor.'}</small>
            </div>
            <button type="button" class="btn" data-copy="${escapeHtml(cajaMayorUrl)}" ${cajaMayorUrl ? '' : 'disabled'}>Copiar</button>
          </div>` : '';
      const redHtml = `
        <section class="lic-red admin-card">
          <h4 class="lic-section-title">Acceso celular</h4>
          <p class="lic-red-hint">${celularPermanente
            ? 'Abre MAX-Móvil y escanea este QR una sola vez. La dirección queda guardada para los siguientes inicios.'
            : 'Escanea el QR con el teléfono para entrar. El enlace temporal puede cambiar al reiniciar MAX; configura un dominio fijo para vincular MAX-Móvil una sola vez.'} Inicia sesión con tu usuario y contraseña.</p>
          <div class="lic-qr-wrap">
            <div class="lic-qr-box" id="licQrBox">
              ${qrReady
                ? `<img id="licCelularQr" alt="QR celular" width="220" height="220" src="/api/celular/qr.png?t=${Date.now()}" />`
                : `<div class="lic-qr-placeholder">${escapeHtml(estadoTxt)}</div>`}
            </div>
            <div class="lic-qr-meta">
              <p class="lic-red-label">Estado: <strong>${escapeHtml(celularStatus)}</strong></p>
              <p class="lic-qr-help">${escapeHtml(estadoTxt)}</p>
              <button type="button" class="btn" id="licCelularRefresh">Actualizar QR</button>
            </div>
          </div>
          <div class="lic-red-row" style="margin-top:14px;">
            <div class="lic-red-url">
              <span class="lic-red-label">Caja en la misma Wi‑Fi (PC)</span>
              <code id="licCajaUrl">${escapeHtml(cajaUrl || '—')}</code>
            </div>
            <button type="button" class="btn" data-copy="${escapeHtml(cajaUrl)}">Copiar</button>
          </div>
          ${cajaMayorRedHtml}
        </section>`;

      box.innerHTML = `
        <section class="lic-hero lic-hero--${planClass}">
          <div class="lic-hero-main">
            <p class="lic-hero-label">Plan activo</p>
            <div class="lic-hero-plan-row">
              <h2 class="lic-hero-plan">${planNombre}</h2>
              <span class="lic-metal-badge lic-metal-badge--${planClass}">${planMetal}</span>
            </div>
            <p class="lic-hero-prov">Proveedor: <strong>${escapeHtml(proveedor)}</strong></p>
          </div>
          <div class="lic-hero-cupos">
            <p class="lic-cupos-label">Cupo POS</p>
            <p class="lic-cupos-value"><strong>${cupos.usados}</strong><span>/${cupos.limite}</span></p>
            <div class="lic-cupos-bar" aria-hidden="true"><i style="width:${pct}%"></i></div>
          </div>
        </section>
        ${redHtml}
        <section class="lic-cajas-block lic-cajas-block--${planClass}">
          <h4 class="lic-section-title">Cajas registradas <span class="lic-plan-chip lic-plan-chip--${planClass}">${planMetal}</span></h4>
          <div class="lic-cajas-grid">${cajasHtml}</div>
        </section>
        ${sesionesHtml}
      `;
      const cajaMayorRegistroBox = document.getElementById('cajaMayorRegistroBox');
      if (cajaMayorRegistroBox) cajaMayorRegistroBox.style.display = cajaMayorRegistrada ? 'none' : '';
      box.querySelectorAll('[data-copy]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const t = btn.getAttribute('data-copy') || '';
          if (!t) return;
          try {
            await navigator.clipboard.writeText(t);
            if (typeof maxToast === 'function') maxToast('Copiado', 'ok');
            else btn.textContent = 'Copiado';
          } catch (_) {
            prompt('Copia esta URL:', t);
          }
        });
      });
      const refreshCel = document.getElementById('licCelularRefresh');
      if (refreshCel) {
        refreshCel.addEventListener('click', () => cargarLicenciasPanel());
      }
      box.querySelectorAll('.lic-caja-hist-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = Number(btn.getAttribute('data-caja-id'));
          const nombre = btn.getAttribute('data-caja-nombre') || 'Caja';
          abrirHistorialCaja(id, nombre);
        });
      });
    } catch (e) {
      box.innerHTML = `<div class="lic-error">Error: ${escapeHtml(e.message)}</div>`;
    }
  }

  function ensureModalHistorialCaja() {
    if (document.getElementById('modalHistorialCaja')) return;
    const modal = document.createElement('div');
    modal.id = 'modalHistorialCaja';
    modal.className = 'lic-hist-modal';
    modal.innerHTML = `
      <div class="lic-hist-dialog" role="dialog" aria-modal="true" aria-labelledby="licHistTitle">
        <button type="button" class="lic-hist-close" id="cerrarModalHistorialCaja" title="Cerrar">&times;</button>
        <header class="lic-hist-head">
          <div>
            <p class="lic-hist-eyebrow">Historial de caja</p>
            <h3 id="licHistTitle">Caja</h3>
          </div>
          <div class="lic-hist-close-actions">
            <button type="button" class="btn primary" id="licHistCierreBtn">Imprimir cierre 57 mm</button>
            <p id="licHistCierreMsg" class="lic-hist-cierre-msg" aria-live="polite"></p>
          </div>
        </header>
        <div class="lic-hist-filters">
          <label class="lic-hist-field">Desde
            <input type="date" id="licHistDesde" />
          </label>
          <label class="lic-hist-field">Hasta
            <input type="date" id="licHistHasta" />
          </label>
          <label class="lic-hist-field">Rápido
            <select id="licHistDias">
              <option value="">—</option>
              <option value="7">Últimos 7 días</option>
              <option value="30" selected>Últimos 30 días</option>
              <option value="90">Últimos 90 días</option>
              <option value="365">Último año</option>
            </select>
          </label>
          <div class="lic-hist-filter-actions">
            <button type="button" class="btn btn-small primary" id="licHistBuscar">Buscar</button>
            <button type="button" class="btn btn-small secondary" id="licHistLimpiar">Limpiar fechas</button>
          </div>
        </div>
        <p id="licHistFiltroMsg" class="lic-hist-filtro-msg"></p>
        <div id="licHistResumen" class="lic-hist-resumen"></div>
        <div id="licHistBody" class="lic-hist-body">Cargando…</div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
    });
    document.getElementById('cerrarModalHistorialCaja').addEventListener('click', () => {
      modal.style.display = 'none';
    });
    document.getElementById('licHistCierreBtn').addEventListener('click', imprimirCierreCaja);

    const reload = () => {
      const id = Number(modal.getAttribute('data-caja-id'));
      const nombre = modal.getAttribute('data-caja-nombre') || 'Caja';
      if (id) cargarHistorialCaja(id, nombre);
    };

    document.getElementById('licHistBuscar').addEventListener('click', reload);
    document.getElementById('licHistDias').addEventListener('change', () => {
      // Al usar rango rápido, limpia fechas exactas
      const desde = document.getElementById('licHistDesde');
      const hasta = document.getElementById('licHistHasta');
      if (desde) desde.value = '';
      if (hasta) hasta.value = '';
      reload();
    });
    document.getElementById('licHistLimpiar').addEventListener('click', () => {
      const desde = document.getElementById('licHistDesde');
      const hasta = document.getElementById('licHistHasta');
      const dias = document.getElementById('licHistDias');
      if (desde) desde.value = '';
      if (hasta) hasta.value = '';
      if (dias) dias.value = '30';
      reload();
    });
    ['licHistDesde', 'licHistHasta'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', () => {
        const dias = document.getElementById('licHistDias');
        if (dias && (document.getElementById('licHistDesde').value || document.getElementById('licHistHasta').value)) {
          dias.value = '';
        }
      });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          reload();
        }
      });
    });
  }

  function fmtFechaHora(raw) {
    if (!raw) return { fecha: '—', hora: '—' };
    try {
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) {
        const s = String(raw);
        return { fecha: s.slice(0, 10), hora: s.slice(11, 19) || '—' };
      }
      return {
        fecha: d.toLocaleDateString('es-VE', { year: 'numeric', month: '2-digit', day: '2-digit' }),
        hora: d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      };
    } catch (_) {
      return { fecha: String(raw), hora: '—' };
    }
  }

  function isoHoy() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }

  function abrirHistorialCaja(idCaja, nombre) {
    ensureModalHistorialCaja();
    const modal = document.getElementById('modalHistorialCaja');
    modal.setAttribute('data-caja-id', String(idCaja));
    modal.setAttribute('data-caja-nombre', nombre || 'Caja');
    document.getElementById('licHistTitle').textContent = nombre || 'Caja';
    const dias = document.getElementById('licHistDias');
    const desde = document.getElementById('licHistDesde');
    const hasta = document.getElementById('licHistHasta');
    if (dias && !(desde && desde.value) && !(hasta && hasta.value)) {
      dias.value = '30';
    }
    actualizarBotonCierreCaja();
    modal.style.display = 'flex';
    cargarHistorialCaja(idCaja, nombre);
  }

  function getCierrePaperLayout() {
    const printer = window.MaxImpresora;
    const layout = printer && typeof printer.paperLayout === 'function'
      ? printer.paperLayout()
      : { mm: 57, fontPx: 10, titlePx: 12, totPx: 12 };
    const mm = Number(layout.mm) <= 57 ? 57 : 80;
    return {
      mm,
      fontPx: mm === 57 ? 10 : 13,
      titlePx: mm === 57 ? 12 : 16,
      totPx: mm === 57 ? 12 : 15
    };
  }

  function actualizarBotonCierreCaja() {
    const button = document.getElementById('licHistCierreBtn');
    if (button) button.textContent = `Imprimir cierre ${getCierrePaperLayout().mm} mm`;
  }

  function fechaLocalISO() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function buildCierreCajaHtml(nombreCaja, cierre, layout) {
    const printer = window.MaxImpresora;
    const empresa = printer && typeof printer.empresaFactura === 'function'
      ? printer.empresaFactura()
      : { nombre: 'MAX', rif: '', direccion: '', telefono: '' };
    const pagos = (Array.isArray(cierre.pagos) ? cierre.pagos : []).map((pago) => `
      <div class="row"><span>${escapeHtml(pago.tipo_pago || 'Sin forma de pago')}</span></div>
      <div class="row"><span>USD</span><strong>${fmtMoney(pago.monto_usd)}</strong></div>
      <div class="row"><span>Bs</span><strong>${Number(pago.monto_bs || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
      <div class="muted">${Number(pago.ventas || 0)} venta(s)</div>
    `).join('');
    const neto = Number(cierre.monto_ventas || 0) - Number(cierre.monto_devoluciones || 0);
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Cierre de caja</title>
<style>
@page{size:${layout.mm}mm auto;margin:0}
*{box-sizing:border-box}
html,body{width:${layout.mm}mm;max-width:${layout.mm}mm;margin:0;padding:0;color:#000!important;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{padding:2mm 3mm;font:900 ${layout.fontPx}px/1.3 "Courier New",monospace;-webkit-text-stroke:.35px #000;text-rendering:geometricPrecision}
.center{text-align:center}.title{font-size:${layout.titlePx}px;font-weight:900;-webkit-text-stroke:.45px #000}.line{border-top:1px solid #000;margin:6px 0}
.row{display:flex;justify-content:space-between;gap:4px;padding-top:4px}.row span{overflow-wrap:anywhere}.total{font-size:${layout.totPx}px;font-weight:900;padding-top:5px}
.muted{font-size:${Math.max(9, layout.fontPx - 1)}px}.section{padding:4px 0;border-bottom:1px dashed #888}
</style></head><body>
<div class="center title">${escapeHtml(empresa.nombre || 'MAX')}</div>
${empresa.rif ? `<div class="center">${escapeHtml(empresa.rif)}</div>` : ''}
${empresa.direccion ? `<div class="center">${escapeHtml(empresa.direccion)}</div>` : ''}
${empresa.telefono ? `<div class="center">Tel: ${escapeHtml(empresa.telefono)}</div>` : ''}
<div class="center title">CIERRE DE CAJA</div>
<div class="line"></div>
<div>Caja: ${escapeHtml(nombreCaja || 'Caja')}</div>
<div>Fecha: ${escapeHtml(cierre.fecha || fechaLocalISO())}</div>
<div class="line"></div>
<div class="section"><div class="row"><span>Ventas (${Number(cierre.ventas || 0)})</span><strong>${fmtMoney(cierre.monto_ventas)}</strong></div></div>
${pagos ? `<div class="section"><strong>Ventas por forma de pago</strong>${pagos}</div>` : '<div class="section center">Sin ventas registradas</div>'}
<div class="section"><div class="row"><span>Devoluciones (${Number(cierre.devoluciones || 0)})</span><strong>-${fmtMoney(cierre.monto_devoluciones)}</strong></div></div>
<div class="row total"><span>NETO DEL DÍA</span><strong>${fmtMoney(neto)}</strong></div>
<div class="line"></div><div class="center muted">Resumen de operaciones · ${escapeHtml(new Date().toLocaleString('es-VE'))}</div><br><br>
</body></html>`;
  }

  async function imprimirCierreCaja(event) {
    const button = event.currentTarget;
    const modal = document.getElementById('modalHistorialCaja');
    const message = document.getElementById('licHistCierreMsg');
    const printer = window.MaxImpresora;
    if (!printer || typeof printer.imprimirTicketHtml !== 'function') {
      if (message) {
        message.textContent = 'El módulo de impresión no está disponible. Recarga la página e inténtalo de nuevo.';
        message.classList.add('is-error');
      }
      return;
    }
    const idCaja = Number(modal && modal.getAttribute('data-caja-id'));
    if (!Number.isSafeInteger(idCaja) || idCaja <= 0) {
      if (message) {
        message.textContent = 'No se pudo identificar la caja.';
        message.classList.add('is-error');
      }
      return;
    }
    const nombreCaja = modal.getAttribute('data-caja-nombre') || 'Caja';
    button.disabled = true;
    button.textContent = 'Preparando cierre…';
    if (message) {
      message.textContent = '';
      message.classList.remove('is-error', 'is-ok');
    }
    try {
      const fecha = fechaLocalISO();
      const params = new URLSearchParams({ desde: fecha, hasta: fecha, cierre: '1', limit: '1' });
      const res = await fetch(`/api/licencias/cajas/${encodeURIComponent(idCaja)}/historial?${params}`, {
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok || !data.cierre) {
        throw new Error(data.error || 'No se pudo preparar el cierre de caja.');
      }
      button.textContent = 'Imprimiendo…';
      const result = await printer.imprimirTicketHtml(
        buildCierreCajaHtml(nombreCaja, data.cierre, getCierrePaperLayout())
      );
      if (!result || !result.ok) throw new Error(result && result.error || 'No se pudo imprimir el cierre de caja.');
      if (message) {
        message.textContent = `Cierre del ${fecha} impreso correctamente.`;
        message.classList.add('is-ok');
      }
    } catch (error) {
      if (message) {
        message.textContent = error.message || 'No se pudo imprimir el cierre de caja.';
        message.classList.add('is-error');
      }
    } finally {
      button.disabled = false;
      actualizarBotonCierreCaja();
    }
  }

  function getHistorialQuery() {
    const desdeEl = document.getElementById('licHistDesde');
    const hastaEl = document.getElementById('licHistHasta');
    const diasEl = document.getElementById('licHistDias');
    let desde = (desdeEl && desdeEl.value) ? String(desdeEl.value).slice(0, 10) : '';
    let hasta = (hastaEl && hastaEl.value) ? String(hastaEl.value).slice(0, 10) : '';
    const dias = Number(diasEl && diasEl.value) || 0;

    if (desde && !hasta) hasta = isoHoy();
    if (hasta && !desde) {
      // si solo puso "hasta", busca ese día exacto
      desde = hasta;
    }
    if (desde && hasta && desde > hasta) {
      const tmp = desde;
      desde = hasta;
      hasta = tmp;
      if (desdeEl) desdeEl.value = desde;
      if (hastaEl) hastaEl.value = hasta;
    }

    if (desde && hasta) {
      return {
        qs: `desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`,
        label: `del ${desde} al ${hasta}`
      };
    }
    const d = dias || 30;
    return {
      qs: `dias=${d}`,
      label: `en los últimos ${d} días`
    };
  }

  async function cargarHistorialCaja(idCaja, nombre) {
    const body = document.getElementById('licHistBody');
    const resumenEl = document.getElementById('licHistResumen');
    const msgEl = document.getElementById('licHistFiltroMsg');
    if (!body || !resumenEl) return;
    const filtro = getHistorialQuery();
    if (msgEl) msgEl.textContent = `Mostrando actividad ${filtro.label}`;
    body.innerHTML = '<div class="lic-loading">Cargando historial…</div>';
    resumenEl.innerHTML = '';
    try {
      const res = await fetch(
        `/api/licencias/cajas/${encodeURIComponent(idCaja)}/historial?${filtro.qs}`,
        { credentials: 'include' }
      );
      const data = await res.json();
      if (!data.ok) {
        body.innerHTML = `<div class="lic-error">${escapeHtml(data.error || 'No se pudo cargar')}</div>`;
        return;
      }
      const r = data.resumen || {};
      resumenEl.innerHTML = `
        <div class="lic-hist-kpi"><span>Ventas</span><strong>${Number(r.ventas || 0)}</strong></div>
        <div class="lic-hist-kpi"><span>Monto</span><strong>${fmtMoney(r.monto_ventas)}</strong></div>
        <div class="lic-hist-kpi"><span>Devoluciones</span><strong>${Number(r.devoluciones || 0)}</strong></div>
        <div class="lic-hist-kpi"><span>Reembolsado</span><strong>${fmtMoney(r.monto_devoluciones)}</strong></div>
      `;

      const ventas = Array.isArray(data.ventas) ? data.ventas : [];
      const devoluciones = Array.isArray(data.devoluciones) ? data.devoluciones : [];

      if (!ventas.length && !devoluciones.length) {
        body.innerHTML = `<div class="lic-empty">Sin actividad ${escapeHtml(filtro.label)}.</div>`;
        return;
      }

      const ventasHtml = ventas.length
        ? `<table class="lic-hist-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Hora</th>
                <th>Comprador</th>
                <th>Total</th>
                <th>Pago</th>
                <th>Devolución</th>
                <th>Factura</th>
              </tr>
            </thead>
            <tbody>
              ${ventas.map((v) => {
                const fh = fmtFechaHora(v.fecha_hora);
                const comprador = escapeHtml(v.cliente_nombre || 'Cliente general');
                const ced = v.cliente_cedula ? `<small>${escapeHtml(v.cliente_cedula)}</small>` : '';
                const nDev = Number(v.devoluciones_count || 0);
                const monDev = Number(v.monto_reembolsado || 0);
                const devCell = nDev > 0
                  ? `<span class="lic-hist-dev yes">Sí · ${nDev} · ${fmtMoney(monDev)}</span>`
                  : '<span class="lic-hist-dev no">No</span>';
                return `<tr>
                  <td>${fh.fecha}</td>
                  <td>${fh.hora}</td>
                  <td><div class="lic-hist-buyer">${comprador}${ced}</div></td>
                  <td>${fmtMoney(v.total_venta)}</td>
                  <td>${escapeHtml(v.tipo_pago || '—')}</td>
                  <td>${devCell}</td>
                  <td><button type="button" class="btn btn-small secondary lic-hist-print-btn" data-venta-id="${Number(v.id_venta)}">Imprimir factura</button></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>`
        : '<div class="lic-empty">Sin ventas en el período.</div>';

      const devHtml = devoluciones.length
        ? `<h4 class="lic-section-title" style="margin-top:1rem;">Detalle de devoluciones</h4>
           <table class="lic-hist-table">
             <thead>
               <tr>
                 <th>Fecha</th>
                 <th>Hora</th>
                 <th>Comprador</th>
                 <th>Producto</th>
                 <th>Cant.</th>
                 <th>Reembolso</th>
                 <th>Venta</th>
               </tr>
             </thead>
             <tbody>
               ${devoluciones.map((d) => {
                 const fh = fmtFechaHora(d.fecha_hora);
                 return `<tr>
                   <td>${fh.fecha}</td>
                   <td>${fh.hora}</td>
                   <td>${escapeHtml(d.cliente_nombre || '—')}</td>
                   <td>${escapeHtml(d.producto || '—')}</td>
                   <td>${Number(d.cantidad || 0)}</td>
                   <td>${fmtMoney(d.monto_reembolsado)}</td>
                   <td>#${d.id_venta}</td>
                 </tr>`;
               }).join('')}
             </tbody>
           </table>`
        : '';

      body.innerHTML = `
        <h4 class="lic-section-title">Ventas de ${escapeHtml(nombre || 'caja')}</h4>
        ${ventasHtml}
        ${devHtml}
      `;
    } catch (e) {
      body.innerHTML = `<div class="lic-error">Error: ${escapeHtml(e.message)}</div>`;
    }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function registrarCajaAdmin(e) {
    e.preventDefault();
    const nombre = document.getElementById('nuevaCajaNombre').value.trim();
    const clave = document.getElementById('nuevaCajaClave').value.trim();
    const mac = document.getElementById('nuevaCajaMac').value.trim();
    const authEl = document.getElementById('nuevaCajaAuth');
    const auth = authEl ? authEl.value.trim() : '';
    if (!nombre || !clave) return alert('Nombre y clave de la caja son requeridos');
    if (!auth) return alert('Ingresa la clave de autorización del proveedor MAX');
    const res = await fetch('/api/licencias/cajas', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre_caja: nombre,
        clave_caja: clave,
        direccion_mac: mac || null,
        clave_autorizacion: auth
      })
    });
    const data = await res.json();
    if (data.ok) {
      const planMap = { BASICO: 'Básico', ESTANDAR: 'Estándar', PRO: 'Pro', ULTRA: 'Ultra' };
      const planNom = planMap[String(data.plan || '').toUpperCase()] || data.plan || '';
      const cupos = data.cupos ? ` Cupos POS: ${data.cupos.usados}/${data.cupos.limite}.` : '';
      const upgradeTxt = data.upgrade && planNom ? ` Plan actualizado a ${planNom}.` : '';
      const msg = (data.message || 'Caja registrada') + upgradeTxt + cupos;
      if (typeof maxToast === 'function') maxToast(msg, 'ok');
      else alert(msg);
      e.target.reset();
      cargarLicenciasPanel();
    } else {
      if (typeof maxToast === 'function') maxToast(data.error || 'Error', 'error');
      else alert(data.error || 'Error');
    }
  }

  async function registrarCajaMayorAdmin(e) {
    e.preventDefault();
    const clave = document.getElementById('cajaMayorClave').value.trim();
    const auth = document.getElementById('cajaMayorAuth').value.trim();
    if (!clave) return alert('Ingresa una clave de acceso para Caja Mayor');
    if (!auth) return alert('Ingresa la clave de autorización del proveedor MAX');
    try {
      const res = await fetch('/api/licencias/cajas/mayor', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clave_caja: clave, clave_autorizacion: auth })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo registrar Caja Mayor');
      const cupos = data.cupos ? ` Cupos POS: ${data.cupos.usados}/${data.cupos.limite}.` : '';
      const msg = (data.message || 'Caja Mayor registrada') + cupos;
      if (typeof maxToast === 'function') maxToast(msg, 'ok');
      else alert(msg);
      e.target.reset();
      await cargarLicenciasPanel();
    } catch (error) {
      if (typeof maxToast === 'function') maxToast(error.message || 'Error al registrar Caja Mayor', 'error');
      else alert(error.message || 'Error al registrar Caja Mayor');
    }
  }

  let adminNotifs = [];

  function buildNotificaciones(data) {
    const list = [];
    const alertas = (data && data.stock_alertas) || [];
    alertas.forEach((p) => {
      list.push({
        type: Number(p.inventario) <= 0 ? 'danger' : 'warn',
        title: 'Stock bajo',
        body: `${p.nombre}${p.marca ? ' (' + p.marca + ')' : ''}: ${p.inventario} / mín ${p.stock_minimo}`,
        action: 'inventario'
      });
    });

    const vencimientos = (data && data.cxp_vencimientos) || [];
    vencimientos.forEach((v) => {
      const dias = Number(v.dias);
      const monto = Number(v.monto_pendiente || 0).toFixed(2);
      const prov = v.nombre_proveedor || 'Proveedor';
      const compra = v.id_compra ? `Compra #${v.id_compra}` : 'Cuenta';
      const fecha = v.fecha_vencimiento ? String(v.fecha_vencimiento).slice(0, 10) : '';
      let title = 'Pago a proveedor próximo';
      let type = 'info';
      let body = `${prov} · ${compra}: debes $${monto}` + (fecha ? ` · vence ${fecha}` : '');
      if (Number.isFinite(dias) && dias < 0) {
        title = 'Pago a proveedor vencido';
        type = 'danger';
        body = `${prov} · ${compra}: debes $${monto} · venció hace ${Math.abs(dias)} día(s)`;
      } else if (dias === 0) {
        title = 'Pago a proveedor hoy';
        type = 'warn';
        body = `${prov} · ${compra}: debes $${monto} · vence hoy`;
      } else if (dias === 1) {
        title = 'Pago a proveedor mañana';
        type = 'warn';
      }
      list.push({ type, title, body, action: 'cuentas_pagar' });
    });

    const cxp = Number((data && data.kpis && data.kpis.cxp_pendiente) || 0);
    if (cxp > 0 && !vencimientos.length) {
      list.push({
        type: 'info',
        title: 'Cuentas por pagar',
        body: `Hay $${cxp.toFixed(2)} pendientes de pago a proveedores.`,
        action: 'cuentas_pagar'
      });
    }

    const lic = data && data.licencia;
    if (lic && Number(lic.limite_cajas) > 0 && Number(lic.usados) >= Number(lic.limite_cajas)) {
      list.push({
        type: 'warn',
        title: 'Cupos de caja llenos',
        body: `Plan ${({ BASICO: 'Básico', ESTANDAR: 'Standard', PRO: 'Pro', ULTRA: 'Ultra' })[String(lic.tipo_plan || '').toUpperCase()] || lic.tipo_plan}: ${lic.usados}/${lic.limite_cajas} cajas en uso.`,
        action: 'licencias'
      });
    }

    return list;
  }

  function renderNotifBadge() {
    const badge = document.getElementById('notifBadge');
    const bell = document.getElementById('notifBell');
    const n = adminNotifs.length;
    if (badge) {
      if (n > 0) {
        badge.style.display = '';
        badge.textContent = n > 99 ? '99+' : String(n);
      } else {
        badge.style.display = 'none';
      }
    }
    if (bell) {
      bell.classList.toggle('notif-empty', n === 0);
      bell.title = n > 0 ? `${n} notificación(es)` : 'Sin notificaciones';
    }
  }

  function closeNotifPanel() {
    const panel = document.getElementById('notifPanel');
    const bell = document.getElementById('notifBell');
    if (panel) {
      panel.style.display = 'none';
      panel.setAttribute('aria-hidden', 'true');
    }
    if (bell) bell.setAttribute('aria-expanded', 'false');
  }

  function openNotifPanel() {
    if (!adminNotifs.length) return; // sin notificaciones: no hace nada
    const panel = document.getElementById('notifPanel');
    const list = document.getElementById('notifPanelList');
    const bell = document.getElementById('notifBell');
    if (!panel || !list) return;
    list.innerHTML = adminNotifs.map((n) => `
      <div class="notif-item ${n.type || ''}" data-action="${n.action || ''}">
        <div class="notif-item-title">${n.title}</div>
        <div class="notif-item-body">${n.body}</div>
      </div>
    `).join('');
    list.querySelectorAll('.notif-item[data-action]').forEach((el) => {
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => {
        const tab = el.getAttribute('data-action');
        closeNotifPanel();
        if (tab && typeof window.switchTab === 'function') window.switchTab(tab);
      });
    });
    panel.style.display = 'flex';
    panel.setAttribute('aria-hidden', 'false');
    if (bell) bell.setAttribute('aria-expanded', 'true');
  }

  function toggleNotifPanel() {
    const panel = document.getElementById('notifPanel');
    if (!panel) return;
    if (panel.style.display === 'flex') {
      closeNotifPanel();
      return;
    }
    openNotifPanel();
  }

  async function cargarNotificacionesAdmin() {
    try {
      const res = await fetch('/api/v1/dashboard/resumen', { credentials: 'include' });
      if (!res.ok) {
        adminNotifs = [];
        renderNotifBadge();
        return;
      }
      const data = await res.json();
      adminNotifs = buildNotificaciones(data);
      renderNotifBadge();
    } catch (_) {
      adminNotifs = [];
      renderNotifBadge();
    }
  }

  function setupNotifBell() {
    const bell = document.getElementById('notifBell');
    if (!bell) return;
    bell.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleNotifPanel();
    });
    bell.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleNotifPanel();
      }
    });
    document.addEventListener('click', (e) => {
      const panel = document.getElementById('notifPanel');
      if (!panel || panel.style.display !== 'flex') return;
      if (panel.contains(e.target) || bell.contains(e.target)) return;
      closeNotifPanel();
    });
  }

  async function enriquecerDashboardComercial() {
    try {
      const res = await fetch('/api/v1/dashboard/resumen', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      adminNotifs = buildNotificaciones(data);
      renderNotifBadge();
      const k = data.kpis || {};
      const setTxt = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
      };
      setTxt('kpiHoyVentas', `$${Number(k.ventas_hoy || 0).toFixed(2)}`);
      setTxt('kpiHoyEgresos', `$${Number(k.egresos_hoy || 0).toFixed(2)}`);
      setTxt('kpiHoyMargen', `$${Number(k.margen_estimado || 0).toFixed(2)}`);
      setTxt('kpiCxP', `$${Number(k.cxp_pendiente || 0).toFixed(2)}`);
      // compat: si aún existe el host antiguo
      const host = document.getElementById('comercialKpis');
      if (host) host.style.display = 'none';
      const cajasBox = document.getElementById('cajasActivasBox');
      if (cajasBox) {
        const cajas = data.cajas_activas || [];
        cajasBox.innerHTML = cajas.length
          ? cajas.map((c) => {
              const ventas = Number(c.ventas_hoy || 0);
              const n = Number(c.ventas_hoy_n || 0);
              const act = c.ultima_actividad
                ? (() => { try { return new Date(c.ultima_actividad).toLocaleTimeString('es-VE'); } catch (_) { return ''; } })()
                : '';
              return `<div class="item dash-caja-item">
                <span class="dash-caja-dot" title="En línea"></span>
                <span><b>${c.nombre_caja || 'Terminal'}</b> · ${c.usuario || 'cajero'}
                  <br><small style="color:#64748b;">Hoy: $${ventas.toFixed(2)} · ${n} venta(s)${act ? ' · activo ' + act : ''}</small>
                </span>
              </div>`;
            }).join('')
          : '<div class="item" style="color:#64748b;">Ninguna caja conectada ahora</div>';
      }
      if (data.licencia) {
        const el = document.getElementById('licenciaBadge');
        if (el) {
          const pn = ({ BASICO: 'Básico', ESTANDAR: 'Standard', PRO: 'Pro', ULTRA: 'Ultra' })[String(data.licencia.tipo_plan || '').toUpperCase()] || data.licencia.tipo_plan;
          el.textContent = `Plan ${pn}: ${data.licencia.usados}/${data.licencia.limite_cajas} cajas`;
        }
      }
      renderCurva7d(data.curva_7d);
      maybeShowStockPopup(data.stock_alertas);
    } catch (_) {}
  }

  let cajasLiveTimer = null;
  function startCajasLiveUpdates() {
    if (cajasLiveTimer) return;
    cajasLiveTimer = setInterval(() => {
      const panel = document.getElementById('dashboardPanel');
      if (panel && panel.style.display !== 'none') {
        enriquecerDashboardComercial();
      }
    }, 8000);
  }

  window.cargarLicenciasPanel = cargarLicenciasPanel;
  window.enriquecerDashboardComercial = enriquecerDashboardComercial;
  window.cargarNotificacionesAdmin = cargarNotificacionesAdmin;

  document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('formNuevaCaja');
    if (form) form.addEventListener('submit', registrarCajaAdmin);
    const cajaMayorForm = document.getElementById('formCajaMayor');
    if (cajaMayorForm && window.maxSetupFeatureEnabled('cajaMayor')) {
      cajaMayorForm.addEventListener('submit', registrarCajaMayorAdmin);
    }
    setupNotifBell();
    setupStockAlertModal();
    setTimeout(enriquecerDashboardComercial, 600);
    startCajasLiveUpdates();
    setInterval(cargarNotificacionesAdmin, 60000);
  });
})();
