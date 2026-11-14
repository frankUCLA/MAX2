/*
  devoluciones.js — módulo de devoluciones en caja
*/
(function () {
  const CODIGO_BARRAS_DEVOLUCIONES = '879436512';

  function devFetch(path, opts) {
    if (typeof posFetch === 'function') return posFetch(path, opts);
    const base = (localStorage.getItem('serverBaseUrl') || '').replace(/\/$/, '');
    const url = path.startsWith('http') ? path : (base + path);
    return fetch(url, Object.assign({ credentials: 'include' }, opts || {}));
  }

  function setMsg(id, text, kind) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text || '';
    el.className = 'dev-msg' + (kind ? ' ' + kind : '');
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtMoney(n) {
    return '$' + Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtQty(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return '0';
    if (Math.abs(x - Math.round(x)) < 1e-9) return String(Math.round(x));
    return String(parseFloat(x.toFixed(6)));
  }

  function fmtFecha(v) {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v || '');
    return d.toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' });
  }

  function bindUi() {
    const panelDevoluciones = document.getElementById('panelDevoluciones');
    const btnBuscarVenta = document.getElementById('btnBuscarVentaDevolucion');
    const inputVenta = document.getElementById('devolucionNumeroVenta');
    const resultados = document.getElementById('ventasClienteDevolucion');

    if (btnBuscarVenta && !btnBuscarVenta._devBound) {
      btnBuscarVenta._devBound = true;
      btnBuscarVenta.addEventListener('click', buscarVentasCliente);
    }
    if (inputVenta && !inputVenta._devBound) {
      inputVenta._devBound = true;
      inputVenta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          buscarVentasCliente();
        }
      });
    }
    if (resultados && !resultados._devBound) {
      resultados._devBound = true;
      resultados.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-dev-return]');
        if (!btn) return;
        const id = Number(btn.getAttribute('data-dev-return'));
        const max = Number(btn.getAttribute('data-dev-max'));
        if (id) procesarDevolucion(id, max);
      });
      resultados.addEventListener('input', (e) => {
        const input = e.target.closest('.dev-qty');
        if (!input) return;
        const line = input.closest('.dev-line');
        const preview = line && line.querySelector('.dev-refund');
        const precio = Number(input.getAttribute('data-precio') || 0);
        const qty = Number(input.value || 0);
        if (preview) preview.textContent = fmtMoney(Math.max(0, precio * qty));
      });
    }
  }

  async function handleDevolucionesBarcode(rawCode) {
    const code = String(rawCode || '').trim();
    if (code !== CODIGO_BARRAS_DEVOLUCIONES) return false;

    const wrap = document.getElementById('panelDevolucionesWrap');
    const acceso = document.getElementById('form-acceso-devoluciones');
    const panel = document.getElementById('panelDevoluciones');
    const inputVenta = document.getElementById('devolucionNumeroVenta');
    if (wrap) wrap.style.display = 'flex';

    setMsg('devolucionLockMsg', 'Validando código…');
    try {
      const res = await devFetch('/api/devoluciones/validar-codigo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo_barras: code })
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setMsg('devolucionLockMsg', 'Sesión de caja vencida. Vuelve a abrir el terminal.', 'err');
        return 'error';
      }
      if (!data.ok) {
        setMsg('devolucionLockMsg', data.error || 'Código de barras no válido.', 'err');
        return 'error';
      }
      if (acceso) acceso.style.display = 'none';
      if (panel) panel.style.display = 'block';
      setMsg('devolucionLockMsg', '');
      setMsg('devolucionMsg', '');
      setTimeout(() => { try { inputVenta && inputVenta.focus(); } catch (_) {} }, 50);
      return true;
    } catch (error) {
      setMsg('devolucionLockMsg', 'No se pudo validar el código. Revisa la conexión.', 'err');
      return 'error';
    }
  }

  async function buscarVentasCliente() {
    const inputVenta = document.getElementById('devolucionNumeroVenta');
    const contenedor = document.getElementById('ventasClienteDevolucion');
    if (!inputVenta || !contenedor) return;

    const idVentaNum = parseInt(String(inputVenta.value || '').trim(), 10);
    if (!idVentaNum || idVentaNum <= 0) {
      setMsg('devolucionMsg', 'Escribe el número de ticket.', 'err');
      return;
    }

    setMsg('devolucionMsg', 'Buscando ticket…');
    contenedor.innerHTML = '<div class="dev-empty"><strong>Buscando…</strong><span>Consultando la venta #' + idVentaNum + '</span></div>';

    try {
      const res = await devFetch('/api/devoluciones/venta?id_venta=' + encodeURIComponent(idVentaNum));
      const data = await res.json().catch(() => ({}));

      if (!res.ok && res.status === 401) {
        setMsg('devolucionMsg', 'Sesión de caja vencida. Vuelve a abrir el terminal.', 'err');
        contenedor.innerHTML = '';
        return;
      }
      if (data.error && !(data.ventas && data.ventas.length)) {
        setMsg('devolucionMsg', data.error, 'err');
        contenedor.innerHTML = '<div class="dev-empty"><strong>No encontrado</strong><span>' + escapeHtml(data.error) + '</span></div>';
        return;
      }
      if (!(data.ok && data.ventas && data.ventas.length)) {
        setMsg('devolucionMsg', 'No se encontró la venta.', 'err');
        contenedor.innerHTML = '<div class="dev-empty"><strong>Sin ticket</strong><span>No hay una venta con el número ' + idVentaNum + '.</span></div>';
        return;
      }

      contenedor.innerHTML = data.ventas.map((venta) => {
        const fuera = !!(venta.fuera_de_plazo);
        const horasRestantes = Number(venta.horas_restantes != null ? venta.horas_restantes : 0);
        const tiempoOk = !fuera && horasRestantes > 0;
        const pill = tiempoOk
          ? `<span class="dev-pill ok">${Math.max(1, Math.floor(horasRestantes))} h restantes</span>`
          : `<span class="dev-pill warn">Fuera de plazo (48 h)</span>`;
        const detalles = venta.detalles || [];
        const lineas = detalles.length
          ? detalles.map((det) => {
              const disponible = Number(det.disponible || 0);
              const precio = Number(det.precio_neto || det.precio_unitario || 0);
              const talla = det.nombre_talla && det.nombre_talla !== '-' ? ` · Talla ${escapeHtml(det.nombre_talla)}` : '';
              const can = disponible > 0 && tiempoOk;
              const step = Math.abs(disponible - Math.round(disponible)) > 1e-9 ? '0.000001' : '1';
              const qtyVal = disponible > 0 ? fmtQty(disponible) : '1';
              const refund = fmtMoney(precio * (disponible > 0 ? disponible : 0));
              return `<div class="dev-line ${can ? '' : 'is-off'}">
                <div>
                  <div class="dev-line-name">${escapeHtml(det.nombre_producto || 'Producto')}</div>
                  <div class="dev-line-meta">Vendidas ${fmtQty(det.cantidad)}${talla} · Disponibles ${fmtQty(disponible)} · ${fmtMoney(precio)} c/u</div>
                </div>
                <div class="dev-line-actions">
                  <div class="dev-refund-box">
                    <span>Reembolso</span>
                    <strong class="dev-refund">${can ? refund : '—'}</strong>
                  </div>
                  <input class="dev-qty" id="devQty-${det.id_detalle}" type="number" min="${step}" max="${disponible || 1}" step="${step}" value="${qtyVal}" data-precio="${precio}" ${can ? '' : 'disabled'}>
                  <button type="button" class="dev-btn dev-btn-ok" data-dev-return="${det.id_detalle}" data-dev-max="${disponible}" ${can ? '' : 'disabled'}>Devolver</button>
                </div>
              </div>`;
            }).join('')
          : '<div class="dev-empty"><strong>Sin productos</strong><span>Esta venta no tiene líneas para devolver.</span></div>';
        return `<article class="dev-ticket ${tiempoOk ? '' : 'is-late'}">
          <div class="dev-ticket-head">
            <div>
              <strong>Ticket #${venta.id_venta}</strong>
              <div class="dev-line-meta">${fmtFecha(venta.fecha_hora)} · Total ${fmtMoney(venta.total_venta)}</div>
            </div>
            ${pill}
          </div>
          ${lineas}
        </article>`;
      }).join('');

      if (data.fuera_de_plazo || (data.ventas[0] && data.ventas[0].fuera_de_plazo)) {
        setMsg('devolucionMsg', 'Ticket encontrado, pero ya pasaron 48 horas. No se puede devolver.', 'err');
      } else {
        setMsg('devolucionMsg', 'Ticket encontrado. Elige cantidad y confirma.', 'ok');
      }
    } catch (error) {
      setMsg('devolucionMsg', 'Error al buscar: ' + (error.message || 'conexión'), 'err');
      contenedor.innerHTML = '<div class="dev-empty"><strong>Sin conexión</strong><span>No se pudo consultar el servidor.</span></div>';
    }
  }

  async function procesarDevolucion(idDetalle, cantidadMax) {
    const qtyEl = document.getElementById('devQty-' + idDetalle);
    const cantidad = parseFloat(qtyEl ? qtyEl.value : cantidadMax);
    const max = Number(cantidadMax || 0);
    if (!Number.isFinite(cantidad) || cantidad <= 0 || cantidad > max + 1e-9) {
      setMsg('devolucionMsg', 'Cantidad inválida. Máximo: ' + fmtQty(max), 'err');
      return;
    }
    const ok = await (typeof maxConfirm === 'function'
      ? maxConfirm('¿Devolver ' + fmtQty(cantidad) + ' de este producto y reembolsar al cliente?', { title: 'Confirmar devolución', okText: 'Devolver' })
      : Promise.resolve(true));
    if (!ok) return;

    setMsg('devolucionMsg', 'Procesando devolución…');
    try {
      const res = await devFetch('/api/devoluciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_detalle: idDetalle, cantidad })
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        setMsg('devolucionMsg', 'Listo. Reembolso ' + fmtMoney(data.monto_reembolsado) + '. El inventario ya se restauró.', 'ok');
        buscarVentasCliente();
        if (Array.isArray(data.stock_updates) && typeof applyStockUpdates === 'function') {
          applyStockUpdates(data.stock_updates);
        } else if (typeof loadProductosForCaja === 'function') {
          loadProductosForCaja().catch(() => {});
        }
        if (typeof window.cargarProductos === 'function') window.cargarProductos();
      } else {
        setMsg('devolucionMsg', data.error || 'No se pudo registrar la devolución', 'err');
      }
    } catch (error) {
      setMsg('devolucionMsg', 'Error de conexión al devolver', 'err');
    }
  }

  window.buscarVentasCliente = buscarVentasCliente;
  window.procesarDevolucion = procesarDevolucion;
  window.handleDevolucionesBarcode = handleDevolucionesBarcode;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindUi);
  } else {
    bindUi();
  }
})();
