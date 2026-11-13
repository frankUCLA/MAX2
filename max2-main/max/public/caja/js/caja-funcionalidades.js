// JS para mejorar la experiencia de Caja: carrito, cálculo y visualización de promociones
let cajaCart = [];
let productosCache = [];
let promocionesCache = [];
let categoriasCache = [];
let selectedCartIdx = null;
const PENDIENTES_KEY = 'max_pedidos_pendientes';
// Estado de la tasa del dólar (persiste en sessionStorage = mientras no apaguen/cierren sesión del navegador)
let tasaState = { date: null, price: null, source: null, offline: false, locked: false, lock: null, bcv_tasa: null };
let ivaState = { activo: false, porcentaje: 16 };
const CAJA_MAYOR_MODE = new URLSearchParams(window.location.search).get('modo') === 'mayor';
let posMayorProduct = null;
let posMayorSelectedTalla = null;

function apiBase() {
  const saved = localStorage.getItem('serverBaseUrl');
  if (saved && saved.trim()) return saved.replace(/\/$/, '');
  return '';
}

function posFetch(path, opts = {}) {
  const base = apiBase();
  const url = path.startsWith('http') ? path : (base + path);
  return fetch(url, Object.assign({ credentials: 'include' }, opts));
}

/** Redondeo comercial a 2 decimales. Nunca al alza: 1.20 se queda 1.20 (no 1.21). */
function roundMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return 0;
  return Math.round(x * 100) / 100;
}
function roundUpMoney(n) {
  return roundMoney(n);
}
/** Bs al entero más cercano: 681,20 → 681 · 681,50 → 682 (igual que etiqueta y factura). */
function roundBsEntero(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return 0;
  return Math.round(x);
}
function roundBsPos(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return 0;
  return Math.round(x);
}
function fmtBs(n) {
  return roundBsPos(n).toLocaleString('es-VE', { maximumFractionDigits: 0 });
}
function precioPublicoUsd(baseUsd) {
  const base = Number(baseUsd) || 0;
  return ivaState.activo ? calcConIva(base).total : roundMoney(base);
}
function precioPublicoBs(baseUsd) {
  return roundBsEntero(precioPublicoUsd(baseUsd) * Number(tasaState.price || 0));
}
function avisosTasaAdmin(msg) {
  const text = msg || 'La tasa del dólar se cambia en Admin → Impuestos / IVA.';
  if (typeof showNotification === 'function') showNotification(text, 'error', 4500);
  else alert(text);
}

function isPesoVolumenUnidad(unidad) {
  const u = String(unidad || '').toUpperCase();
  return u === 'KILO' || u === 'KG' || u === 'LITRO' || u === 'L';
}

function metaPesoVolumen(unidad) {
  const u = String(unidad || '').toUpperCase();
  if (u === 'LITRO' || u === 'L') {
    return { unidad: 'LITRO', baseLabel: 'L', fracLabel: 'ml', factor: 1000, precioLabel: 'Bs / litro' };
  }
  return { unidad: 'KILO', baseLabel: 'kg', fracLabel: 'g', factor: 1000, precioLabel: 'Bs / kilo' };
}

/** Formatea cantidades con hasta seis decimales para conservar el stock fraccionado. */
function formatStockQty(n, unidad) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  const u = String(unidad || 'UNIDAD').toUpperCase();
  const discrete = (u === 'UNIDAD' || u === 'CAJA' || u === 'PAQUETE');
  if (isPesoVolumenUnidad(u)) return String(parseFloat(v.toFixed(6)));
  if (discrete) {
    return Number.isInteger(v) || Math.abs(v - Math.round(v)) < 1e-9
      ? String(Math.round(v))
      : String(parseFloat(v.toFixed(3)));
  }
  return String(parseFloat(v.toFixed(3)));
}

function formatPesoVentaLine(it) {
  if (!it || !isPesoVolumenUnidad(it.unidad_medida)) return '';
  const meta = metaPesoVolumen(it.unidad_medida);
  const bs = it.monto_bs_venta != null ? Number(it.monto_bs_venta) : null;
  const parts = [];
  if (bs != null && bs > 0) {
    parts.push('Bs ' + fmtBs(bs));
  }
  const unitBs = Number(it.precio_unitario_bs || 0);
  if (unitBs > 0) {
    parts.push(fmtBs(unitBs) + ' Bs/' + meta.baseLabel);
  }
  return parts.join(' · ');
}

/** Totales de línea: en kilo/litro respeta el monto exacto en Bs que digitó el cajero */
function lineTotalsItem(it, descuentoUsd = 0) {
  const tasa = Number(tasaState.price || 0);
  const desc = Number(descuentoUsd) || 0;
  if (CAJA_MAYOR_MODE) {
    const qty = Number(it.cantidad) || 0;
    const unitUsd = roundMoney(it.precio_unitario);
    const unitBs = roundBsPos(it.precio_unitario_bs || unitUsd * tasa);
    const lineUsd = Math.max(0, roundMoney(unitUsd * qty - desc));
    return {
      lineUsd,
      lineBs: Math.max(0, roundBsPos(unitBs * qty - desc * tasa)),
      unitBs
    };
  }
  if (it && it.monto_bs_venta != null && Number(it.monto_bs_venta) > 0 && isPesoVolumenUnidad(it.unidad_medida)) {
    const bs = roundBsEntero(Number(it.monto_bs_venta));
    const usd = tasa > 0 ? (bs / tasa) : ((Number(it.precio_unitario) || 0) * (Number(it.cantidad) || 0));
    return {
      lineUsd: Math.max(0, Number((usd - desc).toFixed(4))),
      lineBs: Math.max(0, roundBsEntero(bs - (desc * (tasa || 0)))),
      unitBs: roundBsEntero(it.precio_unitario_bs || bs)
    };
  }
  const qty = Number(it.cantidad) || 0;
  const unitUsd = roundMoney(it.precio_unitario);
  const lineUsd = Math.max(0, roundMoney(unitUsd * qty - desc));
  const unitBs = Number(it.precio_unitario_bs) > 0
    ? roundBsEntero(it.precio_unitario_bs)
    : (tasa > 0 ? roundBsEntero(unitUsd * tasa) : 0);
  const lineBs = Math.max(0, roundBsEntero(unitBs * qty - (desc * (tasa || 0))));
  return { lineUsd, lineBs, unitBs };
}

/** Totales de ticket: Bs = suma de líneas ya redondeadas (igual que pago y factura). */
function computeCartMoneyTotals(items, tasaOverride) {
  const tasa = Number(tasaOverride != null ? tasaOverride : tasaState.price) || 0;
  let subtotalUsd = 0;
  let descuentosUsd = 0;
  let totalBsLineas = 0;
  (items || []).forEach((it) => {
    const desc = Number(it.descuento) || 0;
    const lt = lineTotalsItem(it, desc);
    subtotalUsd += lt.lineUsd + desc;
    descuentosUsd += desc;
    totalBsLineas += lt.lineBs;
  });
  const totalUsdNeto = Math.max(0, subtotalUsd - descuentosUsd);
  const ivaCalc = calcConIva(totalUsdNeto);
  if (!CAJA_MAYOR_MODE && tasa > 0) totalBsLineas = roundBsPos(totalUsdNeto * tasa);
  const baseBs = CAJA_MAYOR_MODE
    ? roundBsPos(totalBsLineas)
    : (tasa > 0 ? roundBsPos(ivaCalc.neto * tasa) : roundBsPos(totalBsLineas));
  const ivaBs = CAJA_MAYOR_MODE
    ? roundBsPos(baseBs * (ivaCalc.pct / 100))
    : (tasa > 0 ? roundBsPos(ivaCalc.iva * tasa) : 0);
  const totalBs = CAJA_MAYOR_MODE
    ? roundBsPos(baseBs + ivaBs)
    : roundBsEntero(totalBsLineas + (tasa > 0 ? roundBsPos(ivaCalc.iva * tasa) : 0));
  return {
    tasa,
    subtotalUsd,
    descuentosUsd,
    totalUsdNeto,
    totalUsd: ivaCalc.total,
    totalBsLineas,
    ivaBs,
    baseBs,
    totalBs,
    ivaCalc
  };
}

function resetVentaCantidadDefault() {
  const qty = document.getElementById('ventaCantidad');
  if (qty) qty.value = '1';
}

function normalizeCantidadProducto(prod, cantidadRaw) {
  const u = prod && prod.unidad_medida ? prod.unidad_medida : 'UNIDAD';
  let c = Number(cantidadRaw);
  if (!Number.isFinite(c) || c <= 0) c = 1;
  if (!isPesoVolumenUnidad(u)) {
    // Unidades / caja: siempre enteros (evita heredar 0.786888 del kilo)
    c = Math.max(1, Math.round(c));
  }
  return c;
}

function formatCantidadTicket(it) {
  if (it && isPesoVolumenUnidad(it.unidad_medida)) {
    const meta = metaPesoVolumen(it.unidad_medida);
    return String(parseFloat((Number(it.cantidad || 0) * meta.factor).toFixed(3)));
  }
  const c = Number(it && it.cantidad);
  if (!Number.isFinite(c) || c <= 0) return '1';
  if (Math.abs(c - Math.round(c)) < 1e-6) return String(Math.round(c));
  return String(parseFloat(c.toFixed(3)));
}

let visorProductoIdActual = null;

/** Aplica stock actualizado al cache local y refresca visor / selector */
function applyStockUpdates(updates) {
  if (!Array.isArray(updates) || !updates.length) return;
  let changed = false;
  let missing = false;
  const sel = document.getElementById('ventaProducto');
  for (const u of updates) {
    const p = (productosCache || []).find((x) => Number(x.id_producto) === Number(u.id_producto));
    if (!p) {
      missing = true;
      continue;
    }
    if (u.inventario != null) p.inventario = u.inventario;
    if (Array.isArray(u.tallas)) p.tallas = u.tallas;
    changed = true;
    if (sel) {
      const opt = sel.querySelector(`option[value="${p.id_producto}"]`);
      if (opt) {
        opt.textContent = `${p.marca || ''} - ${p.nombre} - $${parseFloat(p.precio_venta || 0).toFixed(2)} | Stock: ${formatStockQty(p.inventario, p.unidad_medida)}`;
      }
    }
  }
  if (missing) {
    // Producto nuevo o cache incompleto → recargar catálogo completo
    if (typeof loadProductosForCaja === 'function') {
      loadProductosForCaja().catch(() => {});
    }
    return;
  }
  if (!changed) return;
  if (typeof renderPosProductGrid === 'function') {
    try { renderPosProductGrid(); } catch (_) {}
  }
  const modal = document.getElementById('posVisorPrecioModal');
  const visorAbierto = modal && modal.style.display !== 'none' && modal.style.display !== '';
  if (visorAbierto) {
    const search = document.getElementById('posVisorSearch');
    if (search && search.value) renderVisorResults(search.value);
    if (visorProductoIdActual != null) showVisorProducto(visorProductoIdActual);
  }
}

function startStockStream() {
  if (typeof EventSource === 'undefined') return;
  try {
    if (window._stockEs) {
      try { window._stockEs.close(); } catch (_) {}
      window._stockEs = null;
    }
    const base = apiBase();
    const url = (base || '') + '/api/stock/stream';
    const es = new EventSource(url, { withCredentials: true });
    es.addEventListener('stock', (ev) => {
      try {
        const data = JSON.parse(ev.data || '{}');
        applyStockUpdates(data.updates || []);
      } catch (_) {}
    });
    es.onerror = () => { /* el navegador reintenta solo */ };
    window._stockEs = es;
  } catch (e) {
    console.warn('Stock stream no disponible:', e && e.message);
  }
}

function startTasaStream() {
  if (typeof EventSource === 'undefined') return;
  try {
    if (window._tasaEs) {
      try { window._tasaEs.close(); } catch (_) {}
      window._tasaEs = null;
    }
    const base = apiBase();
    const url = (base || '') + '/api/tasa-bcv/stream';
    const es = new EventSource(url, { withCredentials: true });
    let primera = true;
    es.addEventListener('tasa', (ev) => {
      try {
        const prev = Number(tasaState.price || 0);
        const data = JSON.parse(ev.data || '{}');
        if (!applyTasaServerPayload(data)) return;
        if (primera) {
          primera = false;
          return;
        }
        if (Number(tasaState.price) === prev) return;
        if (typeof showNotification === 'function') {
          showNotification('Tasa actualizada: ' + fmtBs(tasaState.price) + ' Bs', 'ok', 2500);
        }
      } catch (_) {}
    });
    es.onerror = () => {};
    window._tasaEs = es;
  } catch (e) {
    console.warn('Tasa stream no disponible:', e && e.message);
  }
}

function recalcCartFromTasa() {
  const tasa = Number(tasaState.price || 0);
  cajaCart.forEach((it) => {
    if (CAJA_MAYOR_MODE) return;
    if (it && it.monto_bs_venta != null && Number(it.monto_bs_venta) > 0 && isPesoVolumenUnidad(it.unidad_medida)) return;
    it.precio_unitario_bs = roundBsEntero(roundMoney(it.precio_unitario) * tasa);
  });
  if (typeof renderPosProductGrid === 'function') {
    try { renderPosProductGrid(); } catch (_) {}
  }
  if (typeof renderCart === 'function') {
    try { renderCart(); } catch (_) {}
  }
  if (typeof pagoState !== 'undefined' && pagoState && pagoState.abierto) {
    pagoState.tasa = tasa;
    const money = computeCartMoneyTotals(pagoState.cartSnapshot || cajaCart, tasa);
    pagoState.tasa = tasa;
    pagoState.totalUsd = money.totalUsd;
    pagoState.totalBs = money.totalBs;
    pagoState.subtotalUsd = money.subtotalUsd;
    pagoState.descuentosUsd = money.descuentosUsd;
    pagoState.baseNetoUsd = money.ivaCalc.neto;
    pagoState.montoIvaUsd = money.ivaCalc.iva;
    pagoState.montoIvaBs = money.ivaBs;
    pagoState.baseNetaBs = money.baseBs;
    const ivaBs = money.ivaBs;
    const totEl = document.getElementById('posPagoTotalBs');
    if (totEl) totEl.textContent = fmtBs(pagoState.totalBs);
    const ivaEl = document.getElementById('posPagoIvaBs');
    if (ivaEl) ivaEl.textContent = fmtBs(ivaBs);
    if (typeof renderPagoLines === 'function') renderPagoLines();
  }
  const visor = document.getElementById('posVisorPrecioModal');
  if (visor && visor.style.display !== 'none' && visor.style.display !== '' && visorProductoIdActual != null && typeof showVisorProducto === 'function') {
    showVisorProducto(visorProductoIdActual);
  }
}

function assetUrl(path) {
  if (!path) return '';
  if (String(path).startsWith('http')) return path;
  const base = apiBase();
  return base ? base + path : path;
}

function calcConIva(netoUsd) {
  const neto = Math.max(0, Number(netoUsd) || 0);
  if (!ivaState.activo) {
    const t = roundUpMoney(neto);
    return { neto: t, iva: 0, total: t, pct: 0, activo: false };
  }
  const pct = Number(ivaState.porcentaje) || 16;
  const ivaRaw = neto * (pct / 100);
  const total = roundUpMoney(neto + ivaRaw);
  const iva = roundUpMoney(Math.max(0, total - neto));
  return { neto: roundUpMoney(neto), iva, total, pct, activo: true };
}

async function loadIvaConfigCaja() {
  try {
    const res = await posFetch('/api/config/iva');
    const data = await res.json().catch(() => ({}));
    if (res.ok && data && data.ok !== false) {
      ivaState.activo = !!data.activo;
      ivaState.porcentaje = Number(data.porcentaje) > 0 ? Number(data.porcentaje) : 16;
    }
  } catch (_) {}
  updateIvaChipUI();
}

function updateIvaChipUI() {
  const chip = document.getElementById('posIvaChip');
  const pctEl = document.getElementById('posIvaChipPct');
  if (pctEl) pctEl.textContent = ivaState.activo ? 'Activo' : '—';
  if (chip) {
    chip.style.display = ivaState.activo ? '' : 'none';
    chip.title = ivaState.activo
      ? 'IVA activo: precios al público incluyen impuesto'
      : 'IVA desactivado';
  }
}
let tasaLastFetchTs = 0;
const TASA_SESSION_KEY = 'max_tasa_sesion';
const TASA_SESSION_KEY_LEGACY = 'modasoft_tasa_sesion';
const TASA_REFRESH_MS = 1000 * 60 * 5; // intentar actualizar online cada 5 min

function loadTasaFromSession() {
  try {
    const raw = sessionStorage.getItem(TASA_SESSION_KEY) || sessionStorage.getItem(TASA_SESSION_KEY_LEGACY);
    if (!raw) return;
    const j = JSON.parse(raw);
    if (j && Number(j.price) > 0) {
      tasaState.price = Number(j.price);
      tasaState.date = j.date || null;
      tasaState.source = j.source || 'session';
      tasaState.offline = !!j.offline;
      tasaState.locked = !!j.locked;
      tasaState.lock = j.lock || null;
      tasaState.bcv_tasa = j.bcv_tasa != null ? Number(j.bcv_tasa) : null;
      tasaLastFetchTs = Number(j.ts) || 0;
    }
  } catch (_) {}
}

function saveTasaToSession() {
  try {
    sessionStorage.setItem(TASA_SESSION_KEY, JSON.stringify({
      price: tasaState.price,
      date: tasaState.date,
      source: tasaState.source,
      offline: tasaState.offline,
      locked: !!tasaState.locked,
      lock: tasaState.lock,
      bcv_tasa: tasaState.bcv_tasa,
      ts: tasaLastFetchTs || Date.now()
    }));
  } catch (_) {}
}

function formatLockHint() {
  if (!tasaState.locked || !tasaState.lock || !tasaState.lock.expires_at) return '';
  try {
    const d = new Date(tasaState.lock.expires_at);
    return ' · manual hasta ' + d.toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' });
  } catch (_) {
    return ' · tasa manual';
  }
}

function updateTasaUI() {
  const el = document.getElementById('posTasaDisplay');
  const chip = document.getElementById('posTasaChip');
  if (el) {
    el.textContent = tasaState.price
      ? Number(tasaState.price).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
      : '—';
  }
  if (chip) {
    const base = tasaState.locked
      ? `Tasa manual${formatLockHint()}`
      : (tasaState.offline
        ? `Sin internet · tasa ${tasaState.source || 'guardada'} (${tasaState.date || 'hoy'})`
        : `Tasa BCV · ${tasaState.source || 'online'} (${tasaState.date || ''})`);
    chip.title = base + ' · La define el administrador';
    chip.style.cursor = 'default';
    chip.classList.toggle('offline', !!tasaState.offline);
    chip.classList.toggle('manual', !!tasaState.locked);
  }
}

function applyTasaServerPayload(j) {
  if (!j || typeof j !== 'object') return false;
  if (!(Number(j.tasa) > 0)) return false;
  tasaState.price = Number(j.tasa);
  if (j.fecha) tasaState.date = String(j.fecha);
  tasaState.source = j.source || tasaState.source;
  tasaState.offline = !!j.offline;
  tasaState.locked = !!j.locked;
  tasaState.lock = j.lock || null;
  if (j.bcv_tasa != null && Number(j.bcv_tasa) > 0) tasaState.bcv_tasa = Number(j.bcv_tasa);
  tasaLastFetchTs = Date.now();
  saveTasaToSession();
  updateTasaUI();
  recalcCartFromTasa();
  if (typeof calcularTotalesForm === 'function') calcularTotalesForm();
  return true;
}

function setTasaLocal(price, meta = {}) {
  tasaState.price = Number(price);
  tasaState.date = meta.date || new Date().toISOString().slice(0, 10);
  tasaState.source = meta.source || 'manual';
  tasaState.offline = !!meta.offline;
  if (meta.locked != null) tasaState.locked = !!meta.locked;
  if (meta.lock !== undefined) tasaState.lock = meta.lock;
  tasaLastFetchTs = Date.now();
  saveTasaToSession();
  updateTasaUI();
  if (typeof renderCart === 'function') renderCart();
  if (typeof calcularTotalesForm === 'function') calcularTotalesForm();
}

function showTasaModal(message) {
  avisosTasaAdmin(message || 'La tasa del dólar se cambia en Admin → Impuestos / IVA.');
}

async function restaurarTasaBcv() {
  try {
    const res = await posFetch('/api/tasa-bcv/usar-bcv', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j || !j.ok) {
      const err = document.getElementById('posTasaModalError');
      if (err) err.textContent = (j && j.error) || 'No se pudo obtener el BCV';
      return false;
    }
    applyTasaServerPayload(j);
    hideTasaModal();
    if (typeof showNotification === 'function') showNotification('Tasa BCV restaurada', 'ok', 2500);
    return true;
  } catch (e) {
    const err = document.getElementById('posTasaModalError');
    if (err) err.textContent = 'Sin conexión para restaurar BCV';
    return false;
  }
}

function hideTasaModal() {
  const modal = document.getElementById('posTasaModal');
  if (modal) modal.style.display = 'none';
}

async function ensureTasaAlAbrirCaja() {
  loadTasaFromSession();
  updateTasaUI();
  const ok = await refreshTasaFromServer(true);
  if (ok) {
    hideTasaModal();
    return tasaState.price;
  }
  if (tasaState.price > 0) {
    // Había tasa de esta sesión / servidor offline: seguir con ella
    tasaState.offline = true;
    saveTasaToSession();
    updateTasaUI();
    hideTasaModal();
    return tasaState.price;
  }
  avisosTasaAdmin('No hay tasa del dólar. El administrador debe fijarla en Impuestos / IVA.');
  return null;
}

document.addEventListener('DOMContentLoaded', async () => {
  if (document.getElementById('posProductGrid') || document.getElementById('ventaProducto')) {
    console.log('=== INICIANDO CAJA ===');

    try {
      console.log('Cargando datos iniciales...');
      await loadProductosForCaja();
      await loadPromociones();
      await loadCategorias();
      await ensureTasaAlAbrirCaja();
      await loadIvaConfigCaja();
      startStockStream();
      startTasaStream();
      console.log('Tasa:', tasaState.price, tasaState.source, 'offline=', tasaState.offline);

      // Refresco automático al volver a la ventana / recuperar red
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          loadProductosForCaja().catch(() => {});
          loadIvaConfigCaja().catch(() => {});
          startStockStream();
          startTasaStream();
        }
      });
      window.addEventListener('focus', () => {
        loadProductosForCaja().catch(() => {});
      });
      window.addEventListener('online', () => {
        loadProductosForCaja().catch(() => {});
        startStockStream();
        startTasaStream();
      });
      console.log('IVA:', ivaState.activo ? ivaState.porcentaje + '%' : 'off');
    } catch (e) {
      console.error('Error inicializando:', e);
      await loadProductosForCaja().catch(()=>{});
      await loadPromociones().catch(()=>{});
      await loadCategorias().catch(()=>{});
      await ensureTasaAlAbrirCaja().catch(()=>{});
      await loadIvaConfigCaja().catch(()=>{});
      startStockStream();
      startTasaStream();
    }

    // Listeners
    const btnAdd = document.getElementById('btnAgregarProducto');
    if (btnAdd) btnAdd.addEventListener('click', onAgregarAlCarrito);
    const btnPay = document.getElementById('btnPagarVenta');
    if (btnPay) btnPay.addEventListener('click', onPagarVenta);
    
    const btnAplicarTasaManual = document.getElementById('btnAplicarTasaManual');
    const tasaManualInput = document.getElementById('tasaManual');
    if (btnAplicarTasaManual && tasaManualInput) {
      btnAplicarTasaManual.addEventListener('click', function() {
        avisosTasaAdmin('La tasa del dólar solo se cambia en Admin.');
      });
      tasaManualInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') btnAplicarTasaManual.click();
      });
    }
    // Búsqueda automática de cliente por cédula (debounce)
    const cedInput = document.getElementById('ventaClienteCedula');
    if (cedInput) {
      let tCed;
      cedInput.addEventListener('input', function(e){
        clearTimeout(tCed);
        tCed = setTimeout(() => { buscarClientePorCedula(e.target.value.trim()); }, 350);
      });
      cedInput.addEventListener('blur', function(e){ buscarClientePorCedula(e.target.value.trim()); });
    }
    // Quitar resaltado de error al escribir en campos de cliente
    ['ventaClienteCedula', 'ventaClienteNombre', 'ventaClienteTelefono', 'ventaClienteDireccion', 'ventaClienteEmail']
      .forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', () => {
          const wrap = el.closest('.pos-field');
          if (wrap) wrap.classList.remove('is-invalid');
        });
      });
    // Render inicial del carrito (si hay items previos)
    renderCart();
      // Listeners para recalcular totales cuando cambia cantidad o precio en Bs
      const cantidadEl = document.getElementById('ventaCantidad');
      const precioBsEl = document.getElementById('ventaPrecioUnitarioBs');
      if (cantidadEl) cantidadEl.addEventListener('input', calcularTotalesForm);
      if (precioBsEl) precioBsEl.addEventListener('input', calcularTotalesForm);
    initPosValeryUI();
    // Mantener tasa actualizada si hay internet
    setInterval(() => { refreshTasaFromServer(false).catch(() => {}); }, TASA_REFRESH_MS);
    console.log('=== CAJA INICIADA ===');
  }
});

async function loadProductosForCaja() {
  try {
    const res = await posFetch('/api/productos');
    const data = await res.json();
    productosCache = data.productos || [];
    const sel = document.getElementById('ventaProducto');
    if (sel) {
      sel.innerHTML = `<option value="">Selecciona producto</option>`;
      productosCache.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id_producto;
        opt.textContent = `${p.marca || ''} - ${p.nombre} - $${parseFloat(p.precio_venta||0).toFixed(2)} | Stock: ${formatStockQty(p.inventario, p.unidad_medida)}`;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', onProductoChange);
    }
    if (typeof renderPosProductGrid === 'function') renderPosProductGrid();
  } catch (e) {
    console.error('Error cargando productos para caja:', e);
  }
}

// Aplica la respuesta de la API a tasaState
function applyTasaApiResponse(json) {
  try {
    if (!json || typeof json !== 'object') return false;
    if (json.current && typeof json.current === 'object') {
      if (typeof json.current.usd !== 'undefined') {
        const p = Number(json.current.usd);
        if (!Number.isNaN(p) && p > 0) {
          tasaState.price = p;
          tasaState.date = json.current.date ? String(json.current.date) : tasaState.date;
          return true;
        }
      }
    }
    if (typeof json.tasa !== 'undefined' || typeof json.valor !== 'undefined') {
      const p = Number(json.tasa || json.valor);
      if (!Number.isNaN(p) && p > 0) {
        tasaState.price = p;
        if (json.fecha) tasaState.date = String(json.fecha);
        tasaState.source = json.source || tasaState.source;
        tasaState.offline = !!json.offline;
        return true;
      }
    }
  } catch (e) { console.warn('applyTasaApiResponse error', e); }
  return false;
}

/** @returns {Promise<boolean>} true si obtuvo tasa válida del servidor */
async function refreshTasaFromServer(force = false) {
  try {
    // Si hay bloqueo manual vigente, no forzar overwrite del BCV
    const url = (force && !tasaState.locked) ? '/api/tasa-bcv?refresh=1' : '/api/tasa-bcv';
    const res = await fetch(url, { credentials: 'include' });
    const j = await res.json().catch(() => null);
    if (!j) return false;
    if (j.ok === false && !j.tasa) return false;
    if (!applyTasaServerPayload(j) && !applyTasaApiResponse(j)) return false;
    const cont = document.getElementById('tasaManualContainer');
    if (cont) cont.style.display = 'none';
    return true;
  } catch (e) {
    console.warn('refreshTasaFromServer:', e);
    return false;
  }
}

async function getTasa() {
  const now = Date.now();
  // Si hay tasa reciente, usarla; de fondo intenta refrescar si toca
  if (tasaState.price && (now - tasaLastFetchTs) < TASA_REFRESH_MS) {
    updateTasaUI();
    return tasaState.price;
  }
  const ok = await refreshTasaFromServer(false);
  if (ok && tasaState.price) return tasaState.price;
  if (tasaState.price) {
    tasaState.offline = true;
    updateTasaUI();
    return tasaState.price;
  }
  avisosTasaAdmin('No hay tasa del dólar. El administrador debe fijarla en Impuestos / IVA.');
  throw new Error('Tasa no disponible');
}

async function buscarClientePorCedula(cedula) {
  if (!cedula) return;
  try {
    const res = await posFetch('/api/clientes/buscar?cedula=' + encodeURIComponent(cedula));
    if (!res.ok) return;
    const j = await res.json();
    if (j && j.cliente) {
      const c = j.cliente;
      document.getElementById('ventaClienteNombre').value = c.nombre || '';
      document.getElementById('ventaClienteTelefono').value = c.telefono || '';
      const dirEl = document.getElementById('ventaClienteDireccion');
      if (dirEl) dirEl.value = c.direccion || '';
      document.getElementById('ventaClienteEmail').value = c.email || '';
      console.log('Cliente cargado por cédula:', c);
    }
  } catch (e) { console.warn('Error buscarClientePorCedula:', e); }
}

// Si un producto no trae id_categoria en la lista inicial, intentar obtener detalle del producto
async function ensureProductoTieneCategoria(prod) {
  if (!prod || prod.id_categoria !== undefined && prod.id_categoria !== null) return prod;
  try {
    const res = await posFetch(`/api/productos/${encodeURIComponent(prod.id_producto)}`);
    if (!res.ok) return prod;
    const json = await res.json();
    if (json && json.producto) {
      prod.id_categoria = json.producto.id_categoria || null;
      // también actualizar el cache global
      const idx = productosCache.findIndex(p => p.id_producto === prod.id_producto);
      if (idx >= 0) productosCache[idx] = Object.assign(productosCache[idx] || {}, prod);
    }
  } catch (e) {
    console.warn('No se pudo obtener detalle de producto para categoría:', e && e.message ? e.message : e);
  }
  return prod;
}

async function loadPromociones() {
  try {
    const res = await posFetch('/api/promociones/activas');
    if (!res.ok) {
      // Sin sesión o sin promociones: la caja sigue normal (no es error para el cajero)
      promocionesCache = [];
      console.warn('[LOAD PROMOCIONES] No disponibles (status ' + res.status + '). Se continúa sin promociones.');
      return;
    }
    const data = await res.json();
    promocionesCache = data.promociones || [];
    if (cajaCart.length > 0) renderCart();
  } catch (e) {
    console.warn('[LOAD PROMOCIONES]', e && e.message ? e.message : e);
    promocionesCache = [];
  }
}

async function loadCategorias() {
  try {
    const res = await posFetch('/api/categorias');
    if (!res.ok) {
      categoriasCache = [];
      return;
    }
    const data = await res.json();
    categoriasCache = data.categorias || [];
    const categoriaSel = document.getElementById('ventaCategoria');
    if (categoriaSel) {
      categoriaSel.innerHTML = '<option value="">Selecciona categoría</option>';
      categoriasCache.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat.id_categoria;
        opt.textContent = cat.nombre;
        categoriaSel.appendChild(opt);
      });
    }
    if (typeof renderPosDepartments === 'function') renderPosDepartments();
  } catch (e) {
    console.error('Error cargando categorías:', e);
    categoriasCache = [];
  }
}

function showNotification(message, type = 'info', timeout = 0) {
  const container = document.getElementById('cajaNotif');
  if (!container) return;
  container.innerHTML = `<div class="notif ${type}">${message}</div>`;
  if (timeout && timeout > 0) setTimeout(() => { container.innerHTML = ''; }, timeout);
}

function clearNotification() {
  const container = document.getElementById('cajaNotif');
  if (!container) return;
  container.innerHTML = '';
}

async function onProductoChange() {
  const pid = document.getElementById('ventaProducto').value;
  const prod = productosCache.find(p => String(p.id_producto) === String(pid));
  if (prod) {
    // Asegurar que el producto tenga id_categoria para las promos
    await ensureProductoTieneCategoria(prod);
    // Precio del producto viene en USD (precio_venta). Convertimos y mostramos el precio unitario en Bs.
    const usd = parseFloat(prod.precio_venta || 0) || 0;
    document.getElementById('ventaPrecioUnitario').value = usd.toFixed(2); // oculto, para referencia
    try {
      const tasa = await getTasa();
      const bs = usd * (Number(tasa) || 1);
      document.getElementById('ventaPrecioUnitarioBs').value = bs ? String(roundBsEntero(bs)) : '';
    } catch (e) {
      document.getElementById('ventaPrecioUnitarioBs').value = '';
    }
    const tallaSel = document.getElementById('ventaTalla');
    tallaSel.innerHTML = '<option value="">Selecciona talla</option>';
    (prod.tallas || []).forEach(t => {
      const o = document.createElement('option'); o.value = t.id_talla; o.textContent = `${t.nombre} (${t.cantidad})`; tallaSel.appendChild(o);
    });
    // Pre-seleccionar la categoría del producto si existe
    const categoriaSel = document.getElementById('ventaCategoria');
    if (categoriaSel && prod.id_categoria) {
      categoriaSel.value = prod.id_categoria;
    }
  }
  calcularTotalesForm();
}

function calcularTotalesForm() {
  // Precio base en Bs (visible). Convertir a USD usando tasa
  const precio_bs = parseFloat(document.getElementById('ventaPrecioUnitarioBs').value || 0) || 0;
  const cantidad = parseInt(document.getElementById('ventaCantidad').value || 0) || 0;
  const total_bs = precio_bs * cantidad;
  // calcular USD con tasa
  const tasa = Number(tasaState.price || 0);
  const precio_usd = tasa > 0 ? (precio_bs / tasa) : 0;
  const total_usd = precio_usd * cantidad;
  document.getElementById('ventaTotalDolar').value = total_usd ? `$${total_usd.toFixed(2)}` : '';
  document.getElementById('ventaTotalBs').value = total_bs ? fmtBs(total_bs) : '';
}

async function onAgregarAlCarrito(extra = null) {
  const id_producto = document.getElementById('ventaProducto').value;
  const id_talla = document.getElementById('ventaTalla').value || null;
  let cantidad = parseFloat(document.getElementById('ventaCantidad').value || 0);
  const tasa = await getTasa().catch(()=>tasaState.price || 0);
  // Precio ancla en USD del producto (sin ceil: 1.20 no puede pasar a 1.21)
  let precio_unitario = roundMoney(parseFloat((document.getElementById('ventaPrecioUnitario') || {}).value || 0) || 0);
  let precio_unitario_bs = roundBsPos(precio_unitario * (Number(tasa) || 0));
  const id_categoria_seleccionada = document.getElementById('ventaCategoria').value || null;
  if (!id_producto || !cantidad || cantidad <= 0) { alert('Selecciona producto y cantidad válida'); return; }
  
  let prod = productosCache.find(p => String(p.id_producto) === String(id_producto));
  if (!prod) {
    showNotification('No se puede agregar: no se encontró el producto en el inventario cargado.', 'error', 4500);
    return;
  }
  if (Array.isArray(prod.tallas) && prod.tallas.length && !id_talla) {
    if (!(getProductoStockDisponible(prod) > 0)) {
      showNotification(`No se puede agregar ${nombreMarcaProducto(prod)}: no tiene existencias disponibles. Registra stock en Inventario.`, 'error', 4500);
    } else {
      showNotification('Selecciona una talla con existencias para agregar el producto.', 'error', 3500);
    }
    return;
  }
  if (!(getProductoStockDisponible(prod, id_talla) > 0)) {
    showNotification(
      id_talla
        ? `No se puede agregar ${nombreMarcaProducto(prod)}: la talla seleccionada tiene 0 existencias. Revisa el stock en Inventario.`
        : `No se puede agregar ${nombreMarcaProducto(prod)}: tiene 0 existencias. Registra stock en Inventario.`,
      'error',
      4500
    );
    return;
  }

  // FORZAR CARGA DE PROMOCIONES ANTES DE AGREGAR
  if (!CAJA_MAYOR_MODE && (!promocionesCache || promocionesCache.length === 0)) {
    console.log('Cargando promociones antes de agregar al carrito...');
    await loadPromociones();
  }

  if (!(precio_unitario > 0)) {
    precio_unitario = roundMoney(Number(prod.precio_venta || 0));
    precio_unitario_bs = roundBsPos(precio_unitario * (Number(tasa) || 0));
  }
  // Si el producto no tiene categoría en cache, solicitar su detalle antes de añadir
  if (prod && (prod.id_categoria === undefined || prod.id_categoria === null)) {
    await ensureProductoTieneCategoria(prod).catch(()=>{});
    // refrescar referencia
    prod = productosCache.find(p => String(p.id_producto) === String(id_producto));
  }

  const esPeso = !!(extra && extra.monto_bs_venta != null) || isPesoVolumenUnidad(prod && prod.unidad_medida);
  // Unidades: nunca heredar decimales del kilo (0.786888)
  if (!esPeso) {
    cantidad = normalizeCantidadProducto(prod, cantidad);
  }

  // Usar la categoría seleccionada manualmente si existe, sino usar la del producto
  const categoriaFinal = id_categoria_seleccionada ? Number(id_categoria_seleccionada) : (prod ? (prod.id_categoria || null) : null);
  
  // IMPORTANTE: La talla NO afecta las promociones - cualquier talla (XS, S, M, L, XL, XXL, etc.) puede aplicar promociones
  const id_talla_final = id_talla ? Number(id_talla) : null;
  
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('Agregando al carrito:');
  console.log(`  Producto ID: ${id_producto}`);
  console.log(`  Talla ID: ${id_talla_final || 'Sin talla'} (NO afecta promociones)`);
  console.log(`  Cantidad: ${cantidad}`);
  console.log(`  Precio unitario: $${precio_unitario.toFixed(2)}`);
  console.log(`  Categoría: ${categoriaFinal || 'Sin categoría'}`);
  console.log(`  Promociones disponibles: ${promocionesCache.length}`);
  console.log(`  ⚠️ IMPORTANTE: Las promociones aplican a CUALQUIER talla (incluyendo XXL)`);
  console.log('═══════════════════════════════════════════════════════════════');

  const nuevo = {
    id_producto: Number(id_producto),
    id_talla: id_talla_final,
    cantidad: Number(cantidad),
    // Guardamos ambos: precio en USD (interno) y precio en Bs (para mostrar y consistencia)
    precio_unitario: Number(precio_unitario), // USD
    precio_unitario_bs: Number(precio_unitario_bs),
    nombre: prod ? (prod.nombre || prod.marca) : 'Producto',
    id_categoria: categoriaFinal,
    idCategoria: categoriaFinal, // también enviar como idCategoria para el servidor
    no_aplicar_promocion: CAJA_MAYOR_MODE,
    force_promotion_id: null,
    unidad_medida: prod ? (prod.unidad_medida || 'UNIDAD') : 'UNIDAD'
  };
  if (extra && typeof extra === 'object') {
    if (extra.monto_bs_venta != null) nuevo.monto_bs_venta = roundBsEntero(extra.monto_bs_venta);
    if (extra.fraccion_label) nuevo.fraccion_label = extra.fraccion_label;
    if (extra.unidad_medida) nuevo.unidad_medida = extra.unidad_medida;
    // Precio exacto para que línea = Bs digitados (sin deriva por redondeo)
    if (extra.precio_unitario != null) nuevo.precio_unitario = Number(extra.precio_unitario);
    if (extra.precio_unitario_bs != null) nuevo.precio_unitario_bs = Number(extra.precio_unitario_bs);
  }
  if (!esPeso) {
    nuevo.precio_unitario = roundMoney(nuevo.precio_unitario);
    nuevo.precio_unitario_bs = roundBsPos(nuevo.precio_unitario_bs);
  }

  // Misma línea si es el mismo producto + talla + precio (evita 100 filas del mismo ítem)
  // Kilo/litro por Bs: no fusionar (cada monto es una venta distinta)
  const sameLine = (a, b) =>
    !isPesoVolumenUnidad(a.unidad_medida) &&
    !isPesoVolumenUnidad(b.unidad_medida) &&
    Number(a.id_producto) === Number(b.id_producto) &&
    Number(a.id_talla || 0) === Number(b.id_talla || 0) &&
    (CAJA_MAYOR_MODE
      ? Number(a.precio_unitario_bs || 0) === Number(b.precio_unitario_bs || 0)
      : Number(a.precio_unitario || 0).toFixed(4) === Number(b.precio_unitario || 0).toFixed(4)) &&
    !!a.no_aplicar_promocion === !!b.no_aplicar_promocion &&
    Number(a.force_promotion_id || 0) === Number(b.force_promotion_id || 0);

  const existing = cajaCart.find(it => sameLine(it, nuevo));
  if (existing) {
    existing.cantidad = Number(existing.cantidad || 0) + Number(nuevo.cantidad || 0);
    // Mantener precio Bs alineado con la última tasa usada
    existing.precio_unitario_bs = Number(nuevo.precio_unitario_bs);
  } else {
    cajaCart.push(nuevo);
  }

  resetVentaCantidadDefault();
  renderCart();
}

function aplicarMejorPromocion(item) {
  // Si el cajero deshabilitó promociones para este item, retornar sin descuento
  if (CAJA_MAYOR_MODE || item.no_aplicar_promocion) {
    console.log('Promociones deshabilitadas para item:', item);
    return { descuento: 0, promo: null, detalle: null };
  }

  // Si no hay promociones en cache, retornar sin descuento
  if (!promocionesCache || promocionesCache.length === 0) {
    console.warn('No hay promociones en cache para evaluar');
    return { descuento: 0, promo: null, detalle: null };
  }
  
  console.log(`Evaluando promociones para item ${item.id_producto}. Promociones en cache: ${promocionesCache.length}`);
  // IMPORTANTE: Las promociones son INDEPENDIENTES de la talla (id_talla)
  // Una promoción aplica al producto sin importar si es XS, S, M, L, XL, XXL, etc.
  console.log(`[APLICAR PROMO] Talla del item: ${item.id_talla || 'Sin talla'} - Las promociones NO dependen de la talla`);

  const now = new Date();
  const todayStr = now.toISOString().slice(0,10);
  console.log(`[APLICAR PROMO] Fecha hoy: ${todayStr}`);
  
  // Filtrar promociones aplicables (activas y en rango de fechas)
  const pAplicables = promocionesCache.filter(p => {
    try {
      // Verificar que la promoción esté activa
      const estaActiva = p.activa === 1 || p.activa === true || p.activa === '1';
      if (!estaActiva) {
        console.log(`[FILTRO] Promoción ${p.id_promocion} ${p.nombre} no activa (activa=${p.activa}, tipo=${typeof p.activa})`);
        return false;
      }
      
      // Verificar fechas - usar formato date string para comparación
      const fechaInicioStr = p.fecha_inicio ? (p.fecha_inicio.toString().split('T')[0] || p.fecha_inicio.toString().substring(0, 10)) : null;
      const fechaFinStr = p.fecha_fin ? (p.fecha_fin.toString().split('T')[0] || p.fecha_fin.toString().substring(0, 10)) : null;
      
      if (fechaInicioStr && fechaInicioStr > todayStr) {
        console.log(`[FILTRO] Promoción ${p.id_promocion} ${p.nombre} no iniciada (${fechaInicioStr} > ${todayStr})`);
        return false;
      }
      if (fechaFinStr && fechaFinStr < todayStr) {
        console.log(`[FILTRO] Promoción ${p.id_promocion} ${p.nombre} expirada (${fechaFinStr} < ${todayStr})`);
        return false;
      }
      
      console.log(`[FILTRO] ✓ Promoción ${p.id_promocion} "${p.nombre}" APLICABLE (${fechaInicioStr || 'sin inicio'} - ${fechaFinStr || 'sin fin'})`);
      return true;
    } catch (e) { 
      console.warn(`[FILTRO] Error verificando promoción ${p.id_promocion}:`, e);
      return false; 
    }
  });

  // Si no hay promociones aplicables, retornar sin descuento
  if (pAplicables.length === 0) {
    console.log('[APLICAR PROMO] No hay promociones aplicables después de filtrar por fecha');
    console.log('[APLICAR PROMO] Promociones en cache:', promocionesCache.length);
    console.log('[APLICAR PROMO] Fecha hoy:', todayStr);
    return { descuento: 0, promo: null, detalle: null };
  }
  
  console.log(`[APLICAR PROMO] Promociones aplicables después de filtrar por fecha: ${pAplicables.length}`);

  // Obtener información del producto
  const prodInfo = productosCache.find(p => Number(p.id_producto) === Number(item.id_producto)) || {};
  
  // Obtener categoría: priorizar la del item (puede venir de selección manual), luego la del producto
  const prodCat = item.id_categoria || item.idCategoria || prodInfo.id_categoria || null;
  console.log(`Producto ${item.id_producto}, Categoría: ${prodCat}, Producto info:`, prodInfo);
  
  // Calcular subtotales
  const subtotal = item.precio_unitario * item.cantidad;
  const subtotalCarrito = cajaCart.reduce((s, it) => s + (it.precio_unitario * it.cantidad), 0);
  
  let mejor = { descuento: 0, promo: null, detalle: { subtotal } };

  // Si el cajero forzó una promoción específica
  if (item.force_promotion_id) {
    const forced = pAplicables.find(pp => Number(pp.id_promocion) === Number(item.force_promotion_id));
    if (forced) {
      // Verificar aplicabilidad por producto
      if (forced.id_producto && Number(forced.id_producto) !== Number(item.id_producto)) {
        // No aplicable por producto, continuar con evaluación normal
      }
      // Verificar aplicabilidad por categoría
      else if (forced.id_categoria) {
        const promoCat = forced.id_categoria ? Number(forced.id_categoria) : null;
        const itemCat = prodCat ? Number(prodCat) : null;
        
        if (!itemCat || !promoCat || promoCat !== itemCat) {
          // No aplicable por categoría, continuar con evaluación normal
          console.log(`  Promoción forzada no aplica: categoría promoción ${promoCat}, categoría item ${itemCat}`);
        } else {
          // Aplicable: calcular descuento forzado
          console.log(`  ✓ Aplicando promoción forzada por categoría ${promoCat}`);
          const descuentoForced = calcularDescuento(forced, subtotal, subtotalCarrito, item);
          if (descuentoForced > 0) {
            return { descuento: descuentoForced, promo: forced, detalle: { subtotal } };
          }
        }
      }
      // Promoción global (sin producto ni categoría específica)
      else {
        const descuentoForced = calcularDescuento(forced, subtotal, subtotalCarrito, item);
        if (descuentoForced > 0) {
          return { descuento: descuentoForced, promo: forced, detalle: { subtotal } };
        }
      }
    }
  }

  // Evaluar todas las promociones aplicables para encontrar la mejor
  // NOTA CRÍTICA: Las promociones NO verifican talla (id_talla). Aplican a cualquier talla del producto.
  console.log(`\n========== EVALUANDO ${pAplicables.length} PROMOCIONES APLICABLES ==========`);
  console.log(`[INFO] Talla del item evaluado: ${item.id_talla || 'Sin talla'} - NO afecta la evaluación de promociones`);
  for (const p of pAplicables) {
    console.log(`\n[PROMOCIÓN ${p.id_promocion}] ${p.nombre}`);
    console.log(`  Tipo: ${p.tipo_promocion}, Valor: ${p.valor}`);
    console.log(`  Producto ID: ${p.id_producto || 'Ninguno'}, Categoría ID: ${p.id_categoria || 'Ninguna'}`);
    console.log(`  Item - Producto ID: ${item.id_producto}, Talla: ${item.id_talla || 'Sin talla'}, Categoría: ${prodCat}`);
    console.log(`  ⚠️ IMPORTANTE: Esta promoción NO verifica talla - aplica a cualquier talla (XS, S, M, L, XL, XXL, etc.)`);
    
    // Verificar si la promoción aplica por producto
    if (p.id_producto) {
      const promoProdId = Number(p.id_producto);
      const itemProdId = Number(item.id_producto);
      if (promoProdId !== itemProdId) {
        console.log(`  ❌ NO APLICA: Producto diferente (promo: ${promoProdId}, item: ${itemProdId})`);
        continue;
      }
      console.log(`  ✓ Producto coincide`);
    }
    
    // Verificar si la promoción aplica por categoría
    if (p.id_categoria) {
      const promoCat = Number(p.id_categoria);
      const itemCat = prodCat ? Number(prodCat) : null;
      
      if (!itemCat) {
        console.log(`  ❌ NO APLICA: Item no tiene categoría`);
        continue;
      }
      if (promoCat !== itemCat) {
        console.log(`  ❌ NO APLICA: Categoría diferente (promo: ${promoCat}, item: ${itemCat})`);
        continue;
      }
      console.log(`  ✓ Categoría coincide (${promoCat})`);
    } else {
      console.log(`  ✓ Promoción global (aplica a todos)`);
    }
    
    // Verificar mínimo de compra
    const minimo = Number(p.minimo_compra || 0);
    if (minimo > 0) {
      const scope = (p.id_producto || p.id_categoria) ? subtotal : subtotalCarrito;
      if (scope < minimo) {
        console.log(`  ❌ NO APLICA: Mínimo compra ${minimo}, scope es ${scope}`);
        continue;
      }
      console.log(`  ✓ Mínimo compra cumplido (${scope} >= ${minimo})`);
    }
    
    // Calcular descuento de esta promoción
    const descuento = calcularDescuento(p, subtotal, subtotalCarrito, item);
    console.log(`  💰 DESCUENTO CALCULADO: $${descuento.toFixed(2)}`);
    
    // Si este descuento es mayor que el mejor encontrado, actualizar
    if (descuento > mejor.descuento) {
      mejor = { descuento, promo: p, detalle: { subtotal } };
      console.log(`  ✅ NUEVA MEJOR PROMOCIÓN: ${p.nombre} con descuento $${descuento.toFixed(2)}`);
    } else {
      console.log(`  - Descuento menor que el mejor actual ($${mejor.descuento.toFixed(2)})`);
    }
  }
  
  console.log(`\n========== RESULTADO FINAL ==========`);
  console.log(`Descuento: $${mejor.descuento.toFixed(2)}`);
  console.log(`Promoción: ${mejor.promo ? mejor.promo.nombre : 'NINGUNA'}`);
  console.log(`=====================================\n`);
  
  return mejor;
}

// Función auxiliar para calcular descuento según tipo de promoción
function calcularDescuento(promocion, subtotal, subtotalCarrito, item) {
  const tipo = promocion.tipo_promocion;
  let descuento = 0;
  
  console.log(`    [CALCULAR] Tipo: ${tipo}, Valor: ${promocion.valor}, Subtotal: ${subtotal.toFixed(2)}`);
  
  if (tipo === 'DESCUENTO_PORCENTAJE') {
    const porcentaje = Number(promocion.valor || 0);
    descuento = subtotal * (porcentaje / 100);
    console.log(`    → Porcentaje: ${porcentaje}% de ${subtotal.toFixed(2)} = $${descuento.toFixed(2)}`);
  }
  else if (tipo === 'DESCUENTO_FIJO') {
    const valor = Number(promocion.valor || 0);
    // Si es promoción específica de producto o categoría, aplicar por cantidad
    if (promocion.id_producto || promocion.id_categoria) {
      descuento = item.cantidad * valor;
      console.log(`    → Fijo por cantidad: ${item.cantidad} x $${valor} = $${descuento.toFixed(2)}`);
    }
    // Si es promoción global, aplicar proporcional al subtotal
    else {
      descuento = subtotalCarrito > 0 ? (subtotal / subtotalCarrito) * valor : 0;
      console.log(`    → Fijo global: (${subtotal.toFixed(2)}/${subtotalCarrito.toFixed(2)}) x $${valor} = $${descuento.toFixed(2)}`);
    }
  }
  else if (tipo === 'COMPRA_X_LLEVA_Y') {
    const x = Number(promocion.param_x || 0);
    const y = Number(promocion.param_y || 0);
    if (x > 0 && y >= 0) {
      const bloque = x + y;
      const completos = Math.floor(item.cantidad / bloque);
      const gratis = completos * y;
      descuento = gratis * item.precio_unitario;
      console.log(`    → X=Y: Bloque ${bloque}, Completos ${completos}, Gratis ${gratis}, Descuento: $${descuento.toFixed(2)}`);
    }
  }
  
  const descFinal = Math.max(0, descuento);
  console.log(`    → RESULTADO: $${descFinal.toFixed(2)}`);
  return descFinal;
}

function renderCart() {
  const cont = document.getElementById('ventaDetalle');
  if (cajaCart.length === 0) {
    if (cont) cont.innerHTML = '<div class="item">Carrito vacío. Agrega productos para la venta.</div>';
    if (typeof syncPosTicketUI === 'function') syncPosTicketUI(0, 0, 0, 0);
    return;
  }
  if (!cont) {
    // Solo UI Valery: calcular y sincronizar ticket
    let total = 0, totalDescuentos = 0, total_bs = 0, totalDescuentos_bs = 0;
    cajaCart.forEach(it => {
      const calc = aplicarMejorPromocion(it);
      const descuento = Number(calc.descuento || 0);
      const tasa = Number(tasaState.price || 0);
      const lt = lineTotalsItem(it, descuento);
      total += lt.lineUsd;
      totalDescuentos += descuento;
      total_bs += lt.lineBs;
      totalDescuentos_bs += descuento * tasa;
    });
    if (typeof syncPosTicketUI === 'function') syncPosTicketUI(total, totalDescuentos, total_bs, totalDescuentos_bs);
    return;
  }
  
  console.log('=== Renderizando carrito ===');
  console.log('Promociones en cache:', promocionesCache.length);
  console.log('Items en carrito:', cajaCart.length);
  
  let html = '';
  let total = 0; let totalDescuentos = 0;
  let total_bs = 0; let totalDescuentos_bs = 0;
  cajaCart.forEach((it, idx) => {
    console.log(`\n--- Evaluando item ${idx} ---`);
    const calc = aplicarMejorPromocion(it);
  const descuento = Number(calc.descuento || 0); // en USD
  const tasa = Number(tasaState.price || 0);
  const descuento_bs = descuento * (tasa || 0);
  const lt = lineTotalsItem(it, descuento);
  const subtotal_usd = lt.lineUsd + descuento;
  const subtotal_bs = lt.lineBs + descuento_bs;
  const lineaTotal_usd = lt.lineUsd;
  const lineaTotal_bs = lt.lineBs;
  total += lineaTotal_usd; totalDescuentos += descuento;
  total_bs += lineaTotal_bs; totalDescuentos_bs += descuento_bs;
    
  console.log(`Item ${idx}: Subtotal $${subtotal_usd.toFixed(2)} (~Bs ${subtotal_bs.toFixed(2)}), Descuento $${descuento.toFixed(2)} (~Bs ${descuento_bs.toFixed(2)}), Total línea $${lineaTotal_usd.toFixed(2)} (~Bs ${lineaTotal_bs.toFixed(2)})`);
    // Controles: checkbox para aplicar/ignorar promo y select para forzar promoción
    const promoOptions = promocionesCache.filter(p => {
      try {
        const now = new Date();
        if (p.id_producto && Number(p.id_producto) !== Number(it.id_producto)) return false;
        if (p.fecha_inicio && new Date(p.fecha_inicio) > now) return false;
        if (p.fecha_fin && new Date(p.fecha_fin) < now) return false;
        return true;
      } catch (e) { return false; }
    });
    const promoSelectHtml = promoOptions.length > 0 ? `
      <select onchange="window._caja.setForcedPromo(${idx}, this.value)">
        <option value="">Auto</option>
        ${promoOptions.map(pp => `<option value="${pp.id_promocion}" ${it.force_promotion_id && Number(it.force_promotion_id)===Number(pp.id_promocion)?'selected':''}>Forzar: ${pp.nombre}</option>`).join('')}
      </select>` : '';
    const promoControls = CAJA_MAYOR_MODE
      ? '<span style="font-size:0.85em;color:#64748b;">Precio manual de Caja Mayor · promociones desactivadas</span>'
      : `<label style="font-size:0.9em;display:flex;align-items:center;gap:6px;">
          <input type="checkbox" ${it.no_aplicar_promocion? 'checked' : ''} onchange="window._caja.toggleNoPromo(${idx}, this.checked)"> Ignorar promo
        </label>
        ${promoSelectHtml}`;

    // Usar clases CSS en lugar de estilos inline para mejor rendimiento
    const itemClass = descuento > 0 ? 'item-con-descuento' : 'item-sin-descuento';
    const totalLineaClass = descuento > 0 ? 'total-linea-descuento' : 'total-linea-sin-descuento';
    
    const descuentoText = descuento > 0 
      ? `<div class="descuento-info">
          <span class="descuento-monto">✨ Descuento: -$${descuento.toFixed(2)} (~Bs ${fmtBs(descuento_bs)}) ✨</span>
          <span class="promocion-nombre">📌 Promoción: ${calc.promo ? calc.promo.nombre : 'Promoción'}</span>
        </div>` 
      : `<div style="color:#999;font-size:0.85em;padding:4px;">${CAJA_MAYOR_MODE ? 'Precio manual; no se aplican promociones' : 'Sin descuento aplicado'}</div>`;
    
    html += `<div class="item ${itemClass}" data-idx="${idx}" data-has-discount="${descuento > 0 ? 'true' : 'false'}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <strong style="font-size:1.15em;color:#37474f;">${it.nombre || ('#'+it.id_producto)}</strong> 
        <button class="btn btn-small secondary" onclick="removeCartItem(${idx})" style="padding:6px 12px;">Eliminar</button>
      </div>
      <div style="font-size:0.95em;color:#333;margin-top:8px;">
        <div style="margin-bottom:8px;padding:8px;background:#fafafa;border-radius:4px;">
          <span style="color:#666;">Subtotal: </span>
            <strong style="font-size:1.05em;">${CAJA_MAYOR_MODE ? `Bs ${fmtBs(subtotal_bs)}` : `$${subtotal_usd.toFixed(2)} (~Bs ${fmtBs(subtotal_bs)})`}</strong>
        </div>
        ${descuentoText}
        ${calc.promo ? `<div style="margin-top:8px;"><button class="btn-promo-details" onclick="window._caja.showPromoDetails(${idx})">📋 Ver detalles de promoción</button></div>` : ''}
      </div>
      <div style="margin-top:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        ${promoControls}
        <div style="margin-left:auto;font-weight:700;" class="${totalLineaClass}">
          Total línea: ${CAJA_MAYOR_MODE ? `Bs ${fmtBs(lineaTotal_bs)}` : `$${lineaTotal_usd.toFixed(2)} (~Bs ${fmtBs(lineaTotal_bs)})`}
        </div>
      </div>
    </div>`;
  });
  // Footer con totales usando clases CSS
  const totalClass = totalDescuentos > 0 ? 'total-con-descuento' : '';
  html += `<div class="item ${totalClass}">
    <div style="display:flex;justify-content:space-between;align-items:center;font-size:1.1em;">
      ${totalDescuentos > 0 ? `
      <div>
        <span style="color:#666;font-size:0.95em;">Total descuentos: </span>
        <span class="total-descuentos">-$${totalDescuentos.toFixed(2)} (~Bs ${fmtBs(totalDescuentos_bs)})</span>
      </div>
      ` : ''}
      <div style="text-align:right;margin-left:auto;">
        <div style="margin-bottom:4px;">
          <span style="color:#666;font-size:0.95em;">Subtotal: </span>
          <span style="font-weight:600;">${CAJA_MAYOR_MODE ? `Bs ${fmtBs(total_bs + totalDescuentos_bs)}` : `$${(total + totalDescuentos).toFixed(2)} (~Bs ${fmtBs(total_bs + totalDescuentos_bs)})`}</span>
        </div>
        <div style="border-top:2px solid #4caf50;padding-top:8px;margin-top:8px;">
          <span style="color:#666;font-size:0.95em;">Total a pagar: </span>
          <span class="total-final">${CAJA_MAYOR_MODE ? `Bs ${fmtBs(total_bs)}` : `$${total.toFixed(2)} (~Bs ${fmtBs(total_bs)})`}</span>
        </div>
      </div>
    </div>
  </div>`;
  cont.innerHTML = html;
  
  console.log(`[RENDER CART] Total: $${total.toFixed(2)}, Descuentos: $${totalDescuentos.toFixed(2)}`);
  if (typeof syncPosTicketUI === 'function') {
    syncPosTicketUI(total, totalDescuentos, total_bs, totalDescuentos_bs);
  }
}

window.removeCartItem = function(idx) { cajaCart.splice(idx,1); renderCart(); };

const FORMAS_PAGO_POS = [
  { id: 'efectivo', label: 'Efectivo', shortcut: 'F1', color: '#059669', moneda: 'bs' },
  { id: 'punto', label: 'Punto de venta', shortcut: 'F2', color: '#2563eb', moneda: 'bs' },
  { id: 'pago_movil', label: 'Pago móvil', shortcut: 'F3', color: '#7c3aed', moneda: 'bs' },
  { id: 'transferencia', label: 'Transferencia', shortcut: 'F4', color: '#0891b2', moneda: 'bs' },
  { id: 'efectivo_usd', label: 'Efectivo $', shortcut: 'F5', color: '#d97706', moneda: 'usd' },
  { id: 'cashea', label: 'Cashea', shortcut: 'F6', color: '#db2777', moneda: 'bs' },
  { id: 'biopago', label: 'Biopago', shortcut: 'F7', color: '#4f46e5', moneda: 'bs' }
];

let pagoState = {
  abierto: false,
  totalUsd: 0,
  totalBs: 0,
  tasa: 0,
  cliente: null,
  cartSnapshot: null,
  lineas: [],
  selectedIdx: null,
  pendingForma: null,
  pendingMoneda: 'bs',
  cambioTotalUsd: 0,
  cambioTotalBs: 0
};

function fmtVe(n, dec = 2) {
  return Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function formaMeta(label) {
  return FORMAS_PAGO_POS.find((f) => f.label === label) || { moneda: 'bs', label };
}

function isUsdForma(label) {
  return formaMeta(label).moneda === 'usd';
}

function pagoRestanteBs() {
  const pagado = pagoState.lineas.reduce((s, l) => s + Number(l.monto_bs || 0), 0);
  return Math.max(0, Number(pagoState.totalBs || 0) - pagado);
}

function pagoRestanteUsd() {
  const pagado = pagoState.lineas.reduce((s, l) => s + Number(l.monto_usd || 0), 0);
  return Math.max(0, Number(pagoState.totalUsd || 0) - pagado);
}

function pagoPagadoBs() {
  return pagoState.lineas.reduce((s, l) => s + Number(l.monto_bs || 0), 0);
}

function pagoPagadoUsd() {
  return pagoState.lineas.reduce((s, l) => s + Number(l.monto_usd || 0), 0);
}

function pagoCambioTotals() {
  return pagoState.lineas.reduce((acc, l) => {
    acc.bs += Number(l.cambio_bs || 0);
    acc.usd += Number(l.cambio_usd || 0);
    return acc;
  }, { bs: 0, usd: 0 });
}

function renderPagoMethods() {
  const grid = document.getElementById('posPagoMethodGrid');
  if (!grid) return;
  const icons = {
    efectivo: '<svg class="pos-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
    punto: '<svg class="pos-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M2 10h20" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    pago_movil: '<svg class="pos-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2" width="10" height="20" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M11 18h2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    transferencia: '<svg class="pos-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h13M14 3l4 4-4 4M20 17H7M10 13l-4 4 4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    efectivo_usd: '<svg class="pos-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v10M15 9.5c0-1.1-1.3-2-3-2s-3 .9-3 2 1.3 2 3 2 3 .9 3 2-1.3 2-3 2-3-.9-3-2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    cashea: '<svg class="pos-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16v10H4V8z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 8V6a4 4 0 0 1 8 0v2" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    biopago: '<svg class="pos-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c4 4 6 7 6 10a6 6 0 1 1-12 0c0-3 2-6 6-10z" fill="none" stroke="currentColor" stroke-width="2"/></svg>'
  };
  grid.innerHTML = FORMAS_PAGO_POS.map((f) => `
    <button type="button" class="pos-pago-method" data-forma="${f.label}" style="--pm:${f.color}">
      <span class="pm-icon">${icons[f.id] || icons.efectivo}</span>
      <span class="pm-copy">
        <span class="pm-short">${f.shortcut}</span>
        <span class="pm-label">${f.label}${f.moneda === 'usd' ? ' <small>($)</small>' : ''}</span>
      </span>
    </button>
  `).join('');
  grid.querySelectorAll('.pos-pago-method').forEach((btn) => {
    btn.addEventListener('click', () => beginAddPago(btn.getAttribute('data-forma')));
  });
}

function renderPagoLines() {
  const tbody = document.getElementById('posPagoLines');
  const restBsEl = document.getElementById('posPagoRestanteBs');
  const restUsdEl = document.getElementById('posPagoRestanteUsd');
  const pagadoEl = document.getElementById('posPagoPagado');
  const pagadoUsdEl = document.getElementById('posPagoPagadoUsd');
  const confirmBtn = document.getElementById('posPagoConfirm');
  const restBox = document.getElementById('posPagoRestanteBox');
  const cambioBox = document.getElementById('posPagoCambioBox');
  const cambioTxt = document.getElementById('posPagoCambioTxt');
  if (!tbody) return;
  if (!pagoState.lineas.length) {
    tbody.innerHTML = '<tr class="empty"><td colspan="3">Selecciona una forma de pago a la izquierda</td></tr>';
  } else {
    tbody.innerHTML = pagoState.lineas.map((l, idx) => {
      const extra = (Number(l.cambio_usd || 0) > 0.001 || Number(l.cambio_bs || 0) > 0.01)
        ? `<div class="pos-pago-line-cambio">Recibido ${l.moneda === 'usd' ? '$' + fmtVe(l.recibido_usd) : fmtBs(l.recibido_bs) + ' Bs'} · Cambio ${l.moneda === 'usd' ? '$' + fmtVe(l.cambio_usd) : fmtBs(l.cambio_bs) + ' Bs'}</div>`
        : '';
      return `<tr class="pos-pago-line ${pagoState.selectedIdx === idx ? 'selected' : ''}" data-idx="${idx}">
        <td>${l.forma_pago}${extra}</td>
        <td class="r">${fmtBs(l.monto_bs)}</td>
        <td class="r">$${fmtVe(l.monto_usd)}</td>
      </tr>`;
    }).join('');
    tbody.querySelectorAll('.pos-pago-line').forEach((tr) => {
      tr.addEventListener('click', () => {
        pagoState.selectedIdx = Number(tr.dataset.idx);
        renderPagoLines();
      });
    });
  }
  const restanteBs = pagoRestanteBs();
  const restanteUsd = pagoRestanteUsd();
  const pagadoBs = pagoPagadoBs();
  const pagadoUsd = pagoPagadoUsd();
  const cambio = pagoCambioTotals();
  if (restBsEl) restBsEl.textContent = fmtBs(restanteBs);
  if (restUsdEl) restUsdEl.textContent = fmtVe(restanteUsd);
  if (pagadoEl) pagadoEl.textContent = fmtBs(pagadoBs) + ' Bs';
  if (pagadoUsdEl) pagadoUsdEl.textContent = '· $' + fmtVe(pagadoUsd);
  if (restBox) restBox.classList.toggle('done', restanteUsd <= 0.01 && restanteBs <= 0.05);
  if (confirmBtn) confirmBtn.disabled = !(restanteUsd <= 0.01 && pagoState.lineas.length > 0);
  if (cambioBox && cambioTxt) {
    if (cambio.usd > 0.001 || cambio.bs > 0.01) {
      cambioBox.style.display = 'block';
      cambioTxt.textContent = `$${fmtVe(cambio.usd)}  ·  ${fmtBs(cambio.bs)} Bs`;
    } else {
      cambioBox.style.display = 'none';
    }
  }
}

function beginAddPago(formaLabel) {
  pagoState.pendingForma = formaLabel;
  const usd = isUsdForma(formaLabel);
  pagoState.pendingMoneda = usd ? 'usd' : 'bs';
  const box = document.getElementById('posPagoAmountBox');
  const input = document.getElementById('posPagoAmountInput');
  const label = document.getElementById('posPagoAmountLabel');
  const hint = document.getElementById('posPagoAmountHint');
  const restante = usd ? pagoRestanteUsd() : pagoRestanteBs();
  if ((usd && restante <= 0.01) || (!usd && restante <= 0.05)) {
    showNotification('Ya está cubierto el total', 'info', 2000);
    return;
  }
  if (label) label.textContent = usd
    ? `Monto en dólares ($) · ${formaLabel}`
    : `Monto en bolívares (Bs) · ${formaLabel}`;
  if (hint) hint.textContent = usd
    ? 'Ingresa cuántos $ recibió. Si da de más, verás el cambio a devolver.'
    : 'Ingresa cuántos Bs recibió. Si da de más, verás el cambio a devolver.';
  if (box) box.style.display = 'block';
  if (input) {
    input.value = usd ? restante.toFixed(2) : String(roundBsPos(restante));
    input.step = usd ? '0.01' : '1';
    setTimeout(() => { try { input.focus(); input.select(); } catch (_) {} }, 30);
  }
}

function commitAddPago() {
  const forma = pagoState.pendingForma;
  const input = document.getElementById('posPagoAmountInput');
  if (!forma) return;
  let recibido = parseFloat((input && input.value) || '0');
  if (!(recibido > 0)) {
    alert('Ingresa un monto válido');
    return;
  }
  const tasa = Number(pagoState.tasa || 0);
  const redondearBs = CAJA_MAYOR_MODE ? roundBsPos : roundBsEntero;
  const toleranciaBs = 0.5;
  const moneda = pagoState.pendingMoneda || (isUsdForma(forma) ? 'usd' : 'bs');
  let aplicadoUsd = 0;
  let aplicadoBs = 0;
  let recibidoUsd = 0;
  let recibidoBs = 0;
  let cambioUsd = 0;
  let cambioBs = 0;

  if (moneda === 'usd') {
    const restUsd = pagoRestanteUsd();
    recibidoUsd = recibido;
    recibidoBs = tasa > 0 ? redondearBs(recibidoUsd * tasa) : 0;
    aplicadoUsd = Math.min(recibidoUsd, restUsd);
    // tolerancia de redondeo
    if (recibidoUsd + 0.001 >= restUsd) aplicadoUsd = restUsd;
    aplicadoBs = tasa > 0 ? redondearBs(aplicadoUsd * tasa) : 0;
    cambioUsd = Math.max(0, Number((recibidoUsd - aplicadoUsd).toFixed(4)));
    cambioBs = tasa > 0 ? redondearBs(cambioUsd * tasa) : 0;
  } else {
    const restBs = pagoRestanteBs();
    const restUsd = pagoRestanteUsd();
    recibidoBs = redondearBs(recibido);
    recibidoUsd = tasa > 0 ? recibidoBs / tasa : 0;
    aplicadoBs = Math.min(recibidoBs, restBs);
    if (recibidoBs + toleranciaBs >= restBs) {
      aplicadoBs = restBs;
      aplicadoUsd = restUsd;
    } else {
      aplicadoUsd = tasa > 0 ? aplicadoBs / tasa : 0;
    }
    cambioBs = Math.max(0, redondearBs(recibidoBs - aplicadoBs));
    cambioUsd = tasa > 0 ? Number((cambioBs / tasa).toFixed(4)) : 0;
  }

  if (!(aplicadoUsd > 0) && !(aplicadoBs > 0)) {
    alert('El monto no cubre nada del restante');
    return;
  }

  pagoState.lineas.push({
    forma_pago: forma,
    moneda,
    monto_bs: redondearBs(aplicadoBs),
    monto_usd: Number(aplicadoUsd.toFixed(4)),
    recibido_bs: redondearBs(recibidoBs),
    recibido_usd: Number(recibidoUsd.toFixed(4)),
    cambio_bs: redondearBs(cambioBs),
    cambio_usd: Number(cambioUsd.toFixed(4))
  });
  pagoState.pendingForma = null;
  pagoState.pendingMoneda = 'bs';
  pagoState.selectedIdx = pagoState.lineas.length - 1;
  const box = document.getElementById('posPagoAmountBox');
  if (box) box.style.display = 'none';
  renderPagoLines();
  if (cambioUsd > 0.001 || cambioBs > 0.01) {
    const msg = moneda === 'usd'
      ? `Cambio a devolver: $${fmtVe(cambioUsd)} (${fmtBs(cambioBs)} Bs)`
      : `Cambio a devolver: ${fmtBs(cambioBs)} Bs ($${fmtVe(cambioUsd)})`;
    showNotification(msg, 'ok', 4500);
  }
}

function deleteSelectedPagoLine() {
  if (pagoState.selectedIdx == null || !pagoState.lineas[pagoState.selectedIdx]) {
    alert('Selecciona una forma de pago en la tabla');
    return;
  }
  pagoState.lineas.splice(pagoState.selectedIdx, 1);
  pagoState.selectedIdx = null;
  renderPagoLines();
}

function cerrarPagoModal() {
  pagoState.abierto = false;
  const modal = document.getElementById('posPagoModal');
  if (modal) modal.style.display = 'none';
  document.removeEventListener('keydown', onPagoKeydown);
}

function onPagoKeydown(e) {
  if (!pagoState.abierto) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    cerrarPagoModal();
    return;
  }
  if (e.key === 'F9') {
    e.preventDefault();
    const btn = document.getElementById('posPagoConfirm');
    if (btn && !btn.disabled) confirmarPagoYRegistrar();
    return;
  }
  if (e.key === 'Enter' && document.getElementById('posPagoAmountBox')?.style.display !== 'none') {
    e.preventDefault();
    commitAddPago();
    return;
  }
  const map = { F1: 0, F2: 1, F3: 2, F4: 3, F5: 4, F6: 5, F7: 6 };
  if (map[e.key] != null && FORMAS_PAGO_POS[map[e.key]]) {
    e.preventDefault();
    beginAddPago(FORMAS_PAGO_POS[map[e.key]].label);
  }
}

/** Cliente opcional: se puede vender con o sin datos de cliente. */
function limpiarValidacionClienteCaja() {
  ['ventaClienteCedula', 'ventaClienteNombre', 'ventaClienteTelefono', 'ventaClienteDireccion', 'ventaClienteEmail']
    .forEach((id) => {
      const wrap = document.getElementById(id)?.closest('.pos-field');
      if (wrap) wrap.classList.remove('is-invalid');
    });
}

function abrirDesglosePago() {
  if (cajaCart.length === 0) { alert('Carrito vacío'); return; }
  limpiarValidacionClienteCaja();
  if (!(tasaState.price > 0)) {
    avisosTasaAdmin('No hay tasa del dólar. El administrador debe fijarla en Impuestos / IVA.');
    return;
  }
  // Refrescar IVA por si el admin lo cambió
  loadIvaConfigCaja().finally(() => abrirDesglosePagoInner());
}

function abrirDesglosePagoInner() {
  const cliente = {
    cedula: (document.getElementById('ventaClienteCedula').value || '').trim() || null,
    nombre: (document.getElementById('ventaClienteNombre').value || '').trim() || null,
    telefono: (document.getElementById('ventaClienteTelefono').value || '').trim() || null,
    direccion: ((document.getElementById('ventaClienteDireccion') || {}).value || '').trim() || null,
    email: (document.getElementById('ventaClienteEmail').value || '').trim() || null
  };
  const cartSnapshot = cajaCart.map((it) => {
    const calc = typeof aplicarMejorPromocion === 'function' ? aplicarMejorPromocion(it) : { descuento: 0 };
    const p = productosCache.find((x) => Number(x.id_producto) === Number(it.id_producto));
    const talla = p && (p.tallas || []).find((tt) => Number(tt.id_talla) === Number(it.id_talla));
    const desc = Number(calc.descuento || 0);
    const lt = lineTotalsItem(it, desc);
    return {
      id_producto: it.id_producto,
      id_talla: it.id_talla,
      cantidad: it.cantidad,
      precio_unitario: it.precio_unitario,
      precio_unitario_bs: lt.unitBs || it.precio_unitario_bs || 0,
      descuento: desc,
      nombre: `${p ? (p.nombre || '') : 'Producto'}${talla ? ' / ' + talla.nombre : ''}${it.fraccion_label ? ' (' + it.fraccion_label + ')' : ''}`.trim(),
      unidad_medida: it.unidad_medida || (p && p.unidad_medida) || 'UNIDAD',
      fraccion_label: it.fraccion_label || null,
      monto_bs_venta: it.monto_bs_venta != null ? it.monto_bs_venta : null,
      line_bs: lt.lineBs
    };
  });
  const money = computeCartMoneyTotals(cartSnapshot);
  const tasa = money.tasa;
  const ivaCalc = money.ivaCalc;
  const totalUsd = money.totalUsd;
  const totalBs = money.totalBs;
  const subtotalUsd = money.subtotalUsd;
  const descuentosUsd = money.descuentosUsd;

  pagoState = {
    abierto: true,
    totalUsd,
    totalBs,
    tasa,
    cliente,
    cartSnapshot,
    subtotalUsd,
    descuentosUsd,
    baseNetoUsd: ivaCalc.neto,
    montoIvaUsd: ivaCalc.iva,
    montoIvaBs: money.ivaBs,
    baseNetaBs: money.baseBs,
    subtotalBs: money.totalBsLineas,
    ivaPorcentaje: ivaCalc.pct,
    ivaActivo: ivaCalc.activo,
    lineas: [],
    selectedIdx: null,
    pendingForma: null,
    pendingMoneda: 'bs',
    cambioTotalUsd: 0,
    cambioTotalBs: 0
  };

  const meta = document.getElementById('posPagoClienteMeta');
  if (meta) {
    meta.textContent = [
      cliente.nombre || 'Cliente general',
      cliente.cedula ? `CI ${cliente.cedula}` : null,
      ivaCalc.activo ? 'IVA agregado' : null
    ].filter(Boolean).join(' · ');
  }
  const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setTxt('posPagoBaseUsd', fmtVe(ivaCalc.neto));
  setTxt('posPagoIvaUsd', fmtVe(ivaCalc.iva));
  setTxt('posPagoTotalUsd', fmtVe(totalUsd));
  setTxt('posPagoTotalBs', fmtBs(totalBs));
  const ivaWrap = document.getElementById('posPagoIvaWrap');
  const ivaLabel = document.getElementById('posPagoIvaLabel');
  if (ivaWrap) ivaWrap.style.display = ivaCalc.activo ? '' : 'none';
  if (ivaLabel) ivaLabel.textContent = ivaCalc.activo ? 'I.V.A.' : 'IVA';

  renderPagoMethods();
  renderPagoLines();
  const amountBox = document.getElementById('posPagoAmountBox');
  if (amountBox) amountBox.style.display = 'none';
  const modal = document.getElementById('posPagoModal');
  if (modal) modal.style.display = 'flex';
  document.addEventListener('keydown', onPagoKeydown);
}

async function confirmarPagoYRegistrar() {
  if (pagoRestanteUsd() > 0.01) {
    alert('Aún falta por pagar');
    return;
  }
  if (!pagoState.lineas.length) {
    alert('Agrega al menos una forma de pago');
    return;
  }
  const formas = [...new Set(pagoState.lineas.map((l) => l.forma_pago))];
  const tipo_pago = formas.length === 1 ? formas[0] : ('Mixto: ' + formas.join(' + '));
  const cliente = pagoState.cliente || {};
  const cartSnapshot = pagoState.cartSnapshot || [];
  const subtotalUsd = Number(pagoState.subtotalUsd || 0);
  const descuentosUsd = Number(pagoState.descuentosUsd || 0);
  const tasa = Number(pagoState.tasa || 0);
  const cambioTot = pagoCambioTotals();
  const pagos = pagoState.lineas.map((l) => ({
    forma_pago: l.forma_pago,
    moneda: l.moneda || (isUsdForma(l.forma_pago) ? 'usd' : 'bs'),
    monto_bs: l.monto_bs,
    monto_usd: l.monto_usd,
    recibido_bs: l.recibido_bs,
    recibido_usd: l.recibido_usd,
    cambio_bs: l.cambio_bs,
    cambio_usd: l.cambio_usd
  }));

  const confirmBtn = document.getElementById('posPagoConfirm');
  if (confirmBtn) confirmBtn.disabled = true;

  try {
    const imprimirFactura = await maxConfirm('¿Deseas imprimir la factura de esta venta?', {
      title: 'Imprimir factura',
      okText: 'Sí, imprimir',
      cancelText: 'No imprimir'
    });
    const id_caja = window._posTerminal && window._posTerminal.id_caja
      ? window._posTerminal.id_caja
      : (localStorage.getItem('pos_id_caja') || null);
    const res = await posFetch('/api/caja/venta', {
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id_caja: id_caja ? Number(id_caja) : null,
        items: cajaCart.map((it) => ({
          id_producto: it.id_producto,
          id_talla: it.id_talla,
          cantidad: it.cantidad,
          precio_unitario: it.precio_unitario,
          idCategoria: it.idCategoria || it.id_categoria || null,
          id_categoria: it.id_categoria || it.idCategoria || null,
          no_aplicar_promocion: !!it.no_aplicar_promocion,
          force_promotion_id: it.force_promotion_id
        })),
        cliente_nombre: cliente.nombre,
        cliente_cedula: cliente.cedula,
        cliente_telefono: cliente.telefono,
        cliente_direccion: cliente.direccion,
        cliente_email: cliente.email,
        tipo_pago,
        tasa,
        pagos
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Error servidor' }));
      alert('Error al procesar venta: ' + (err.message || JSON.stringify(err)));
      if (confirmBtn) confirmBtn.disabled = false;
      return;
    }
    const data = await res.json();
    if (!data.ok) {
      alert('Error procesando venta: ' + (data.message || ''));
      if (confirmBtn) confirmBtn.disabled = false;
      return;
    }

    const totalUsd = Number(data.total != null ? data.total : pagoState.totalUsd) || 0;
    const montoIva = Number(data.monto_iva != null ? data.monto_iva : pagoState.montoIvaUsd) || 0;
    const ivaPct = Number(data.iva_porcentaje != null ? data.iva_porcentaje : pagoState.ivaPorcentaje) || 0;
    const baseNeta = Number(data.base_neta != null ? data.base_neta : pagoState.baseNetoUsd) || Math.max(0, totalUsd - montoIva);
    cerrarPagoModal();
    cajaCart = [];
    selectedCartIdx = null;
    renderCart();
    if (Array.isArray(data.stock_updates) && data.stock_updates.length) {
      applyStockUpdates(data.stock_updates);
    }
    const form = document.getElementById('form-venta-caja');
    if (form) form.reset();
    setTicketCliente({});

    const ventaTicket = {
      id_venta: data.id_venta,
      fecha: new Date().toLocaleString('es-VE'),
      cliente_nombre: cliente.nombre,
      cliente_cedula: cliente.cedula,
      cliente_telefono: cliente.telefono,
      cliente_direccion: cliente.direccion,
      tipo_pago,
      pagos,
      tasa,
      items: cartSnapshot,
      total_usd: totalUsd,
      total_bs: Number(pagoState.totalBs != null ? pagoState.totalBs : roundBsPos(tasa > 0 ? totalUsd * tasa : totalUsd)),
      subtotal_usd: subtotalUsd,
      subtotal_bs: Number(pagoState.subtotalBs != null ? pagoState.subtotalBs : roundBsPos(tasa > 0 ? subtotalUsd * tasa : subtotalUsd)),
      base_neta_usd: baseNeta,
      base_neta_bs: Number(pagoState.baseNetaBs != null ? pagoState.baseNetaBs : roundBsPos(tasa > 0 ? baseNeta * tasa : baseNeta)),
      monto_iva_usd: montoIva,
      monto_iva_bs: Number(pagoState.montoIvaBs != null ? pagoState.montoIvaBs : roundBsPos(tasa > 0 ? montoIva * tasa : montoIva)),
      iva_porcentaje: ivaPct,
      iva_activo: montoIva > 0 || !!pagoState.ivaActivo,
      total: totalUsd,
      cambio_usd: Number(cambioTot.usd || 0),
      cambio_bs: Number(cambioTot.bs || 0)
    };

    if (imprimirFactura) {
      let printResult = { ok: false, mensaje: 'No es posible la impresión de la factura' };
      try {
        if (window.MaxImpresora && typeof window.MaxImpresora.imprimirFacturaVenta === 'function') {
          printResult = await window.MaxImpresora.imprimirFacturaVenta(ventaTicket);
        }
      } catch (pe) {
        console.warn('Impresión:', pe);
        printResult = { ok: false, mensaje: 'No es posible la impresión de la factura' };
      }

      if (!printResult.ok) {
        showNotification(printResult.mensaje || 'Venta registrada, pero no se pudo imprimir la factura.', 'error', 5000);
      }
    }
  } catch (e) {
    console.error('Error al pagar venta:', e);
    alert('Error de conexión al servidor');
    if (confirmBtn) confirmBtn.disabled = false;
  }
}

function setupPagoModal() {
  renderPagoMethods();
  const addBtn = document.getElementById('posPagoAmountAdd');
  const delBtn = document.getElementById('posPagoDeleteLine');
  const cancelBtn = document.getElementById('posPagoCancel');
  const confirmBtn = document.getElementById('posPagoConfirm');
  const amountInput = document.getElementById('posPagoAmountInput');
  if (addBtn) addBtn.addEventListener('click', commitAddPago);
  if (delBtn) delBtn.addEventListener('click', deleteSelectedPagoLine);
  if (cancelBtn) cancelBtn.addEventListener('click', cerrarPagoModal);
  if (confirmBtn) confirmBtn.addEventListener('click', confirmarPagoYRegistrar);
  if (amountInput) {
    amountInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commitAddPago(); }
    });
  }
}

async function onPagarVenta() {
  abrirDesglosePago();
}

// Export para tests manuales
if (typeof window !== 'undefined') window._caja = {
  cajaCart,
  renderCart,
  aplicarMejorPromocion,
  // utilidades para pruebas y debugging: exponer el estado mínimo de la tasa y el aplicador
  getTasaState: () => ({ ...tasaState }),
  applyTasaApiResponse,
  getTasa: getTasa,
  toggleNoPromo: (idx, checked) => { if (cajaCart[idx]) { cajaCart[idx].no_aplicar_promocion = !!checked; renderCart(); } },
  setForcedPromo: (idx, promoId) => { if (cajaCart[idx]) { cajaCart[idx].force_promotion_id = promoId ? Number(promoId) : null; renderCart(); } },
  showPromoDetails: (idx) => {
    try {
      const item = cajaCart[idx];
      if (!item) return;
      const calc = aplicarMejorPromocion(item);
      const promo = calc && calc.promo ? calc.promo : null;
      const modal = document.getElementById('promoModal');
      const title = document.getElementById('promoModalTitle');
      const body = document.getElementById('promoModalBody');
      if (!modal || !title || !body) return;
      if (!promo) {
        title.textContent = 'Sin promoción aplicable';
        body.innerHTML = '<p>No hay promociones aplicables para esta línea.</p>';
      } else {
        title.textContent = promo.nombre || 'Promoción';
        body.innerHTML = `
          <p><strong>Tipo:</strong> ${promo.tipo_promocion}</p>
          <p><strong>Descripción:</strong> ${promo.descripcion || '-'} </p>
          <p><strong>Válida desde:</strong> ${promo.fecha_inicio} hasta ${promo.fecha_fin}</p>
          <p><strong>Condiciones:</strong> ${promo.minimo_compra ? 'Mínimo compra: ' + promo.minimo_compra : 'Ninguna'}</p>
          <p><strong>Parámetros:</strong> ${promo.param_x ? 'X=' + promo.param_x : ''} ${promo.param_y ? ' Y=' + promo.param_y : ''}</p>
          <hr>
          <p><strong>Detalle cálculo:</strong></p>
          <pre style="white-space:pre-wrap;">Subtotal línea: $${(item.precio_unitario*item.cantidad).toFixed(2)}\nDescuento estimado: $${(calc.descuento||0).toFixed(2)}</pre>
        `;
      }
      modal.style.display = 'block';
    } catch (e) { console.error('Error mostrando detalles de promo:', e); }
  }
};

// Modal close handler
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    const pm = document.getElementById('promoModal');
    const pmClose = document.getElementById('promoModalClose');
    if (pmClose) pmClose.addEventListener('click', () => { if (pm) pm.style.display = 'none'; });
    // Cerrar click fuera del contenido
    if (pm) pm.addEventListener('click', (ev) => { if (ev.target === pm) pm.style.display = 'none'; });
  });
}

/* ========== POS Valery UI ========== */
let posFilterCategoria = '';
let posSearchQuery = '';
let posSelectedProduct = null;
let posSelectedTalla = null;
let posLastSearchFocusId = 'posBarcode';

function restorePosSearchFocus() {
  const modalOpen = [...document.querySelectorAll('.pos-modal')].some(m => m.style.display === 'flex');
  if (modalOpen) return;
  const input = document.getElementById(posLastSearchFocusId) || document.getElementById('posBarcode');
  if (!input) return;
  const active = document.activeElement;
  if (active && active !== input && active !== document.body && active.matches &&
      active.matches('input, textarea, select') && !(active.closest && active.closest('.pos-modal'))) return;
  try { input.focus({ preventScroll: true }); } catch (_) { input.focus(); }
}

function initPosValeryUI() {
  if (!document.getElementById('posProductGrid')) return;

  // Reloj
  const clock = document.getElementById('posClock');
  const tick = () => {
    if (!clock) return;
    const d = new Date();
    clock.textContent = d.toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'medium' });
  };
  tick();
  setInterval(tick, 1000);

  renderPosDepartments();
  renderPosProductGrid();

  const search = document.getElementById('posSearch');
  if (search) {
    search.addEventListener('focus', () => { posLastSearchFocusId = 'posSearch'; });
    search.addEventListener('input', () => {
      posSearchQuery = search.value.trim().toLowerCase();
      renderPosProductGrid();
    });
    // Enter en búsqueda: si el texto es un código de barras exacto, lo agrega
    search.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const code = search.value.trim();
      if (!code) return;
      if (findProductoByBarcode(code)) {
        e.preventDefault();
        handleBarcodeScan(code);
        search.value = '';
        posSearchQuery = '';
        renderPosProductGrid();
      }
    });
  }

  setupBarcodeScanner();

  document.querySelectorAll('.pos-dept-btn[data-cat=""]').forEach(btn => {
    btn.addEventListener('click', () => {
      posFilterCategoria = '';
      document.querySelectorAll('.pos-dept-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderPosProductGrid();
    });
  });

  const vaciar = document.getElementById('btnVaciarCarrito');
  if (vaciar) vaciar.addEventListener('click', async () => {
    if (cajaCart.length && (await maxConfirm('¿Vaciar el ticket?', { title: 'Vaciar ticket', okText: 'Vaciar' }))) {
      cajaCart = [];
      selectedCartIdx = null;
      renderCart();
    }
  });

  setupPosHerramientas();

  const toggleDev = document.getElementById('btnToggleDevoluciones');
  const wrapDev = document.getElementById('panelDevolucionesWrap');
  const closeDev = document.getElementById('btnCerrarDevoluciones');
  function cerrarDevolucionesPanel() {
    if (!wrapDev) return;
    wrapDev.style.display = 'none';
    const panel = document.getElementById('panelDevoluciones');
    if (panel) panel.style.display = 'none';
    const form = document.getElementById('form-acceso-devoluciones');
    if (form) {
      form.reset();
      form.style.display = '';
    }
    const resultados = document.getElementById('ventasClienteDevolucion');
    if (resultados) resultados.innerHTML = '';
    ['devolucionMsg', 'devolucionLockMsg'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) { el.textContent = ''; el.className = 'dev-msg'; }
    });
  }
  window.cerrarDevolucionesPanel = cerrarDevolucionesPanel;
  if (toggleDev && wrapDev) {
    toggleDev.addEventListener('click', () => {
      const abierto = wrapDev.style.display !== 'none';
      if (abierto) cerrarDevolucionesPanel();
      else wrapDev.style.display = 'flex';
    });
  }
  if (closeDev) closeDev.addEventListener('click', cerrarDevolucionesPanel);
  if (wrapDev) {
    wrapDev.addEventListener('click', (e) => {
      if (e.target === wrapDev) cerrarDevolucionesPanel();
    });
  }

  // Modal talla
  const modal = document.getElementById('posTallaModal');
  const closeBtn = document.getElementById('posTallaClose');
  if (closeBtn) closeBtn.addEventListener('click', () => {
    if (modal) modal.style.display = 'none';
    setTimeout(restorePosSearchFocus, 0);
  });
  if (modal) modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.style.display = 'none';
      setTimeout(restorePosSearchFocus, 0);
    }
  });
  const addBtn = document.getElementById('posTallaAdd');
  if (addBtn) addBtn.addEventListener('click', confirmPosTallaAdd);
  wirePosPesoModal();
  wirePosMayorModal();
  const pesoModal = document.getElementById('posPesoModal');
  if (pesoModal) {
    pesoModal.addEventListener('click', (e) => {
      if (e.target === pesoModal) {
        pesoModal.style.display = 'none';
        posPesoProduct = null;
        setTimeout(restorePosSearchFocus, 0);
      }
    });
  }

  // F1 pago
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F1') {
      if (pagoState && pagoState.abierto) return; // lo maneja el modal de desglose
      e.preventDefault();
      onPagarVenta();
    }
  });

  // Terminal / licencia gate (opcional si no hay sesión de caja)
  setupPosTerminalGate();
  startPosHeartbeat();

  // Impresora térmica
  const btnPrinter = document.getElementById('posConnectPrinter');
  if (btnPrinter) {
    btnPrinter.addEventListener('click', async () => {
      if (!window.MaxImpresora) {
        showNotification('Módulo de impresora no cargado', 'error', 3000);
        return;
      }
      showNotification('Selecciona la impresora en el cuadro del sistema…', 'info', 2500);
      const r = await window.MaxImpresora.conectarImpresora();
      if (r.ok) {
        showNotification('Impresora conectada (' + (r.tipo || '') + ')', 'ok', 3000);
        await window.MaxImpresora.refreshPrinterStatus();
      } else {
        showNotification(r.error || 'No es posible conectar la impresora', 'error', 4500);
        await window.MaxImpresora.refreshPrinterStatus();
      }
    });
  }
  if (window.MaxImpresora) {
    window.MaxImpresora.refreshPrinterStatus().catch(() => {});
  }

  // Dejar listo el campo de escaneo (lectores USB escriben ahí)
  focusBarcodeInput();
}

function renderPosDepartments() {
  const wrap = document.getElementById('posDeptButtons');
  if (!wrap) return;
  wrap.innerHTML = '';
  categoriasCache.forEach(cat => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pos-dept-btn' + (String(posFilterCategoria) === String(cat.id_categoria) ? ' active' : '');
    btn.textContent = cat.nombre;
    btn.dataset.cat = cat.id_categoria;
    btn.addEventListener('click', () => {
      posFilterCategoria = String(cat.id_categoria);
      document.querySelectorAll('.pos-dept-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderPosProductGrid();
    });
    wrap.appendChild(btn);
  });
}

function setScanStatus(mode, text) {
  const el = document.getElementById('posScanStatus');
  if (!el) return;
  el.classList.remove('is-scanning', 'is-error');
  if (mode === 'ok') el.classList.add('is-scanning');
  if (mode === 'error') el.classList.add('is-error');
  if (text) el.textContent = text;
  if (mode === 'ok' || mode === 'error') {
    setTimeout(() => {
      el.classList.remove('is-scanning', 'is-error');
      el.textContent = '▮▮ Escáner listo';
    }, 2200);
  }
}

function beepScan(ok) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.type = 'sine';
    o.frequency.value = ok ? 880 : 220;
    g.gain.value = 0.04;
    o.start();
    setTimeout(() => {
      o.stop();
      ctx.close();
    }, ok ? 90 : 180);
  } catch (_) {}
}

function normalizeBarcode(code) {
  return String(code || '').trim().replace(/\s+/g, '');
}

function nombreMarcaProducto(prod) {
  const nombre = String((prod && prod.nombre) || 'Producto');
  const marca = String((prod && prod.marca) || '').trim();
  const label = marca ? `${nombre} (${marca})` : nombre;
  return label.replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function findProductoByBarcode(code) {
  const needle = normalizeBarcode(code).toLowerCase();
  if (!needle) return null;
  return productosCache.find(p => {
    const bc = normalizeBarcode(p.codigo_barras);
    return bc && bc.toLowerCase() === needle;
  }) || null;
}

function getProductoStockDisponible(prod, idTalla = null) {
  if (!prod) return 0;
  const tallas = Array.isArray(prod.tallas) ? prod.tallas : [];
  if (idTalla != null) {
    const talla = tallas.find(t => String(t.id_talla) === String(idTalla));
    return Number(talla && talla.cantidad) || 0;
  }
  if (tallas.length) {
    return tallas.reduce((total, talla) => total + (Number(talla.cantidad) || 0), 0);
  }
  return Number(prod.inventario) || 0;
}

function focusBarcodeInput() {
  restorePosSearchFocus();
}

function isBarcodeTypingBlocked(target) {
  if (!target || target === document.body) return false;
  if (target.id === 'posBarcode') return false;
  // Mientras escribe en búsqueda o datos de cliente, no interceptar el wedge
  if (target.id === 'posSearch') return true;
  const tag = (target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (target.isContentEditable) return true;
  if (target.closest && target.closest('.pos-modal')) return true;
  return false;
}

async function handleBarcodeScan(rawCode) {
  const code = normalizeBarcode(rawCode);
  const input = document.getElementById('posBarcode');
  if (input) input.value = '';
  if (!code) {
    focusBarcodeInput();
    return false;
  }
  const prod = findProductoByBarcode(code);
  if (!prod) {
    beepScan(false);
    setScanStatus('error', '✖ No encontrado');
    showNotification(`Código no encontrado: ${code}. Regístralo en Inventario → Código de barras.`, 'error', 3500);
    focusBarcodeInput();
    return false;
  }
  if (!(getProductoStockDisponible(prod) > 0)) {
    beepScan(false);
    setScanStatus('error', '✖ Sin existencias');
    showNotification(`No se puede agregar ${nombreMarcaProducto(prod)}: tiene 0 existencias. Registra stock en Inventario.`, 'error', 4500);
    focusBarcodeInput();
    return false;
  }
  beepScan(true);
  setScanStatus('ok', '✓ ' + (prod.nombre || 'OK'));
  showNotification(`Escaneado: ${prod.nombre}`, 'ok', 1800);
  await openPosTallaModal(prod.id_producto);
  setTimeout(focusBarcodeInput, 80);
  return true;
}

function setupBarcodeScanner() {
  const barcodeInput = document.getElementById('posBarcode');
  if (barcodeInput) {
    barcodeInput.addEventListener('focus', () => { posLastSearchFocusId = 'posBarcode'; });
    barcodeInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      handleBarcodeScan(barcodeInput.value);
    });
    barcodeInput.addEventListener('focus', () => setScanStatus('ready', '▮▮ Escáner listo'));
  }

  // Lectores USB tipo teclado: escriben rápido y mandan Enter
  let wedgeBuffer = '';
  let wedgeLastTs = 0;
  const WEDGE_GAP_MS = 80;
  const WEDGE_MIN_LEN = 4;

  document.addEventListener('keydown', (e) => {
    if (isBarcodeTypingBlocked(e.target)) {
      wedgeBuffer = '';
      return;
    }
    if (e.target && e.target.id === 'posBarcode') return;

    const now = Date.now();
    if (e.key === 'Enter') {
      if (wedgeBuffer.length >= WEDGE_MIN_LEN) {
        e.preventDefault();
        const code = wedgeBuffer;
        wedgeBuffer = '';
        handleBarcodeScan(code);
      } else {
        wedgeBuffer = '';
      }
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (now - wedgeLastTs > WEDGE_GAP_MS) wedgeBuffer = '';
      wedgeBuffer += e.key;
      wedgeLastTs = now;
    } else if (e.key === 'Backspace' || e.key === 'Escape') {
      wedgeBuffer = '';
    }
  });

  // Mantener el escáner listo en la caja
  setInterval(() => {
    const modalOpen = [...document.querySelectorAll('.pos-modal')].some(m => m.style.display === 'flex');
    if (!modalOpen) focusBarcodeInput();
  }, 4000);
}

function renderPosProductGrid() {
  const grid = document.getElementById('posProductGrid');
  if (!grid) return;
  let list = productosCache.slice();
  if (posFilterCategoria) {
    list = list.filter(p => String(p.id_categoria) === String(posFilterCategoria));
  }
  if (posSearchQuery) {
    list = list.filter(p => {
      const hay = `${p.nombre || ''} ${p.marca || ''} ${p.codigo_barras || ''}`.toLowerCase();
      return hay.includes(posSearchQuery);
    });
  }
  if (!list.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;padding:24px;color:#64748b;text-align:center;">Sin productos para mostrar</div>';
    return;
  }
  grid.innerHTML = list.map(p => {
    const initial = (p.nombre || '?').charAt(0).toUpperCase();
    const hasBarcode = !!normalizeBarcode(p.codigo_barras);
    const baseUsd = Number(p.precio_venta || 0);
    const pubUsd = roundUpMoney(ivaState.activo ? calcConIva(baseUsd).total : baseUsd);
    const priceLabel = CAJA_MAYOR_MODE ? 'Precio manual en Bs' : `$${pubUsd.toFixed(2)}`;
    const ivaTag = ivaState.activo ? ' <span class="pos-tile-iva">IVA incl.</span>' : '';
    const um = String(p.unidad_medida || 'UNIDAD').toUpperCase();
    const umTag = um === 'KILO' || um === 'KG' ? '/kg'
      : (um === 'LITRO' || um === 'L' ? '/L'
        : (um !== 'UNIDAD' ? '/' + um.toLowerCase() : ''));
    const img = p.ruta_imagen
      ? `<img src="${assetUrl(p.ruta_imagen)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"><div class="pos-tile-ph" style="display:none">${initial}</div>`
      : `<div class="pos-tile-ph">${initial}</div>`;
    return `<button type="button" class="pos-tile" data-id="${p.id_producto}" title="${hasBarcode ? 'Código: ' + normalizeBarcode(p.codigo_barras) : 'Sin código de barras · toca para agregar'}">
      ${hasBarcode ? '<span class="pos-tile-barcode" title="Tiene código de barras">▮▮</span>' : ''}
      ${img}
      <div class="pos-tile-name">${p.nombre || ''}</div>
      <div class="pos-tile-price">${priceLabel}${umTag}${p.unidades_por_empaque ? ' · ' + p.unidades_por_empaque + ' und' : ''}${ivaTag}${isPesoVolumenUnidad(um) ? (CAJA_MAYOR_MODE ? ' · precio manual' : ' · por Bs') : ''}</div>
    </button>`;
  }).join('');
  grid.querySelectorAll('.pos-tile').forEach(tile => {
    tile.addEventListener('click', () => openPosTallaModal(tile.dataset.id));
  });
}

async function openPosTallaModal(idProducto) {
  let prod = productosCache.find(p => String(p.id_producto) === String(idProducto));
  if (!prod) return;
  if (!(getProductoStockDisponible(prod) > 0)) {
    showNotification(`No se puede agregar ${nombreMarcaProducto(prod)}: tiene 0 existencias. Registra stock en Inventario.`, 'error', 4500);
    setTimeout(restorePosSearchFocus, 0);
    return;
  }
  await ensureProductoTieneCategoria(prod);
  prod = productosCache.find(p => String(p.id_producto) === String(idProducto)) || prod;
  posSelectedProduct = prod;
  posSelectedTalla = null;

  if (CAJA_MAYOR_MODE) {
    await openPosMayorModal(prod);
    return;
  }

  // Kilo / litro: vender por bolívares y descontar gramos / ml
  if (isPesoVolumenUnidad(prod.unidad_medida)) {
    await openPosPesoModal(prod);
    return;
  }

  // Solo pide talla si el producto tiene stock por tallas
  const tallasConStock = (prod.tallas || []).filter(t => Number(t.cantidad) > 0);
  if (!tallasConStock.length) {
    const cantidad = 1; // unidades siempre 1 al tocar (no heredar decimal del kilo)
    const usd = roundMoney(Number(prod.precio_venta || 0));
    const tasa = await getTasa().catch(() => tasaState.price || 0);
    const precio_unitario_bs = roundBsEntero(usd * (Number(tasa) || 0));
    const selP = document.getElementById('ventaProducto');
    const selT = document.getElementById('ventaTalla');
    const selC = document.getElementById('ventaCategoria');
    const qty = document.getElementById('ventaCantidad');
    const precioBs = document.getElementById('ventaPrecioUnitarioBs');
    const precioUsd = document.getElementById('ventaPrecioUnitario');
    if (selP) selP.value = String(prod.id_producto);
    if (selT) { selT.innerHTML = ''; }
    if (selC && prod.id_categoria) selC.value = String(prod.id_categoria);
    if (qty) qty.value = '1';
    if (precioBs) precioBs.value = String(precio_unitario_bs);
    if (precioUsd) precioUsd.value = usd.toFixed(2);
    await onAgregarAlCarrito();
    setTimeout(restorePosSearchFocus, 0);
    return;
  }

  const modal = document.getElementById('posTallaModal');
  const img = document.getElementById('posTallaImg');
  const name = document.getElementById('posTallaNombre');
  const price = document.getElementById('posTallaPrecio');
  const opts = document.getElementById('posTallaOptions');
  const cant = document.getElementById('posTallaCantidad');
  const globalCant = document.getElementById('ventaCantidad');
  if (cant) {
    cant.step = '1';
    cant.value = (globalCant && globalCant.value) ? globalCant.value : '1';
  }
  if (name) name.textContent = `${prod.marca || ''} ${prod.nombre || ''}`.trim();
  const tasa = Number(tasaState.price || 0);
  const usd = Number(prod.precio_venta || 0);
  const unidad = prod.unidad_medida || 'UNIDAD';
  if (price) price.textContent = `$${usd.toFixed(2)} / ${unidad}` + (tasa ? `  ·  Bs ${fmtBs(usd * tasa)}` : '');
  if (img) {
    img.src = prod.ruta_imagen ? assetUrl(prod.ruta_imagen) : '';
    img.style.display = prod.ruta_imagen ? 'block' : 'none';
  }
  const tallas = (prod.tallas || []).filter(t => Number(t.cantidad) > 0);
  if (opts) {
    if (!tallas.length) {
      opts.innerHTML = '<p style="color:#991b1b;">Sin stock por talla.</p>';
      posSelectedTalla = null;
    } else {
      opts.innerHTML = tallas.map(t =>
        `<button type="button" class="pos-talla-btn" data-id="${t.id_talla}">${t.nombre}<br><small>${t.cantidad} uds</small></button>`
      ).join('');
      opts.querySelectorAll('.pos-talla-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          opts.querySelectorAll('.pos-talla-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          posSelectedTalla = Number(btn.dataset.id);
        });
      });
      const first = opts.querySelector('.pos-talla-btn');
      if (first) first.click();
    }
  }
  if (modal) modal.style.display = 'flex';
}

function updatePosMayorStockAndPreview() {
  const stockEl = document.getElementById('posMayorStock');
  const previewEl = document.getElementById('posMayorPreview');
  const quantityEl = document.getElementById('posMayorCantidad');
  const priceEl = document.getElementById('posMayorPrecio');
  const errorEl = document.getElementById('posMayorError');
  if (!posMayorProduct) return;

  const stock = getProductoStockDisponible(posMayorProduct, posMayorSelectedTalla);
  const cantidad = Number(quantityEl && quantityEl.value);
  const precio = Number(priceEl && priceEl.value);
  const unidad = String(posMayorProduct.unidad_medida || 'UNIDAD').toLowerCase();
  if (stockEl) {
    stockEl.textContent = `Stock disponible: ${formatStockQty(stock, posMayorProduct.unidad_medida)} ${unidad}`;
  }
  if (previewEl) {
    previewEl.textContent = Number.isFinite(cantidad) && cantidad > 0 && Number.isFinite(precio) && precio > 0
      ? `Subtotal antes de IVA: Bs ${fmtBs(cantidad * roundBsPos(precio))}`
      : '';
  }
  if (errorEl) {
    errorEl.textContent = Number.isFinite(cantidad) && cantidad > stock + 1e-9
      ? 'La cantidad supera el stock disponible.'
      : '';
  }
}

async function openPosMayorModal(prod) {
  posMayorProduct = prod;
  posMayorSelectedTalla = null;
  const modal = document.getElementById('posMayorModal');
  const name = document.getElementById('posMayorNombre');
  const unit = document.getElementById('posMayorUnidad');
  const img = document.getElementById('posMayorImg');
  const price = document.getElementById('posMayorPrecio');
  const quantity = document.getElementById('posMayorCantidad');
  const tallaWrap = document.getElementById('posMayorTallasWrap');
  const tallaOptions = document.getElementById('posMayorTallas');
  const error = document.getElementById('posMayorError');
  const unidad = String(prod.unidad_medida || 'UNIDAD').toUpperCase();
  const unidadLabel = unidad === 'KILO' || unidad === 'KG' ? 'kg'
    : (unidad === 'LITRO' || unidad === 'L' ? 'L' : unidad.toLowerCase());

  if (name) name.textContent = `${prod.marca || ''} ${prod.nombre || ''}`.trim();
  if (unit) unit.textContent = `Precio por ${unidadLabel} · IVA según configuración actual`;
  if (img) {
    img.src = prod.ruta_imagen ? assetUrl(prod.ruta_imagen) : '';
    img.style.display = prod.ruta_imagen ? 'block' : 'none';
  }
  if (price) {
    price.value = '';
  }
  if (quantity) {
    quantity.min = isPesoVolumenUnidad(unidad) ? '0.000001' : '1';
    quantity.step = isPesoVolumenUnidad(unidad) ? '0.000001' : '1';
    quantity.value = '1';
  }
  if (error) error.textContent = '';

  const tallas = (prod.tallas || []).filter((t) => Number(t.cantidad) > 0);
  if (tallaWrap) tallaWrap.style.display = tallas.length ? '' : 'none';
  if (tallaOptions) {
    tallaOptions.replaceChildren();
    tallas.forEach((t) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pos-talla-btn';
      button.dataset.id = String(Number(t.id_talla));
      button.append(document.createTextNode(String(t.nombre || '')));
      button.appendChild(document.createElement('br'));
      const stock = document.createElement('small');
      stock.textContent = `${formatStockQty(t.cantidad, 'UNIDAD')} uds`;
      button.appendChild(stock);
      tallaOptions.appendChild(button);
    });
    tallaOptions.querySelectorAll('.pos-talla-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        tallaOptions.querySelectorAll('.pos-talla-btn').forEach((option) => option.classList.remove('active'));
        btn.classList.add('active');
        posMayorSelectedTalla = Number(btn.dataset.id);
        updatePosMayorStockAndPreview();
      });
    });
    const first = tallaOptions.querySelector('.pos-talla-btn');
    if (first) first.click();
  }
  updatePosMayorStockAndPreview();
  if (modal) {
    modal.style.display = 'flex';
    setTimeout(() => {
      if (price) {
        price.focus();
        price.select();
      }
    }, 0);
  }
}

async function confirmPosMayorAdd() {
  if (!posMayorProduct) return;
  const priceEl = document.getElementById('posMayorPrecio');
  const quantityEl = document.getElementById('posMayorCantidad');
  const errorEl = document.getElementById('posMayorError');
  const rawPriceBs = Number(priceEl && priceEl.value);
  const rawQuantity = Number(quantityEl && quantityEl.value);
  const tieneTallas = (posMayorProduct.tallas || []).some((t) => Number(t.cantidad) > 0);
  const stock = getProductoStockDisponible(posMayorProduct, posMayorSelectedTalla);
  const esPeso = isPesoVolumenUnidad(posMayorProduct.unidad_medida);
  const mostrarError = (message) => {
    if (errorEl) errorEl.textContent = message;
  };

  if (!Number.isFinite(rawPriceBs) || rawPriceBs <= 0) {
    mostrarError('Ingresa un precio válido en bolívares mayor a 0.');
    return;
  }
  if (!Number.isFinite(rawQuantity) || rawQuantity <= 0) {
    mostrarError('Ingresa una cantidad válida mayor a 0.');
    return;
  }
  if (!esPeso && !Number.isInteger(rawQuantity)) {
    mostrarError('Este producto solo se vende en cantidades enteras.');
    return;
  }
  if (tieneTallas && !posMayorSelectedTalla) {
    mostrarError('Selecciona una talla con existencias.');
    return;
  }
  if (rawQuantity > stock + 1e-9) {
    mostrarError('La cantidad supera el stock disponible.');
    return;
  }
  const tasa = await getTasa().catch(() => tasaState.price || 0);
  if (!(Number(tasa) > 0)) {
    mostrarError('No hay una tasa disponible para registrar correctamente la venta en el resumen.');
    return;
  }
  const precioUnitarioBs = roundBsPos(rawPriceBs);
  const price = roundMoney(precioUnitarioBs / Number(tasa));
  if (!(price > 0)) {
    mostrarError('El precio en bolívares es demasiado bajo para registrarlo.');
    return;
  }
  if (roundMoney(price * rawQuantity) <= 0) {
    mostrarError('El total de la línea debe equivaler al menos a $0.01.');
    return;
  }

  const quantity = normalizeCantidadProducto(posMayorProduct, rawQuantity);
  const selP = document.getElementById('ventaProducto');
  const selT = document.getElementById('ventaTalla');
  const selC = document.getElementById('ventaCategoria');
  const qty = document.getElementById('ventaCantidad');
  const precioBs = document.getElementById('ventaPrecioUnitarioBs');
  const precioUsd = document.getElementById('ventaPrecioUnitario');
  if (selP) selP.value = String(posMayorProduct.id_producto);
  if (selT) {
    selT.innerHTML = '';
    if (posMayorSelectedTalla) {
      const option = document.createElement('option');
      option.value = String(posMayorSelectedTalla);
      option.selected = true;
      selT.appendChild(option);
    }
  }
  if (selC) selC.value = posMayorProduct.id_categoria ? String(posMayorProduct.id_categoria) : '';
  if (qty) qty.value = String(quantity);
  if (precioBs) precioBs.value = String(precioUnitarioBs);
  if (precioUsd) precioUsd.value = price.toFixed(2);

  await onAgregarAlCarrito({
    precio_unitario: price,
    precio_unitario_bs: precioUnitarioBs
  });
  const modal = document.getElementById('posMayorModal');
  if (modal) modal.style.display = 'none';
  posMayorProduct = null;
  posMayorSelectedTalla = null;
  setTimeout(restorePosSearchFocus, 0);
}

function wirePosMayorModal() {
  const modal = document.getElementById('posMayorModal');
  const close = document.getElementById('posMayorClose');
  const add = document.getElementById('posMayorAdd');
  const price = document.getElementById('posMayorPrecio');
  const quantity = document.getElementById('posMayorCantidad');
  const closeModal = () => {
    if (modal) modal.style.display = 'none';
    posMayorProduct = null;
    posMayorSelectedTalla = null;
    setTimeout(restorePosSearchFocus, 0);
  };
  if (close) close.addEventListener('click', closeModal);
  if (modal) modal.addEventListener('click', (event) => {
    if (event.target === modal) closeModal();
  });
  if (add) add.addEventListener('click', confirmPosMayorAdd);
  [price, quantity].forEach((input) => {
    if (input) input.addEventListener('input', updatePosMayorStockAndPreview);
  });
}

let posPesoProduct = null;
let posPesoPrecioBsUnit = 0;
let posPesoUsdUnit = 0;

async function openPosPesoModal(prod) {
  posPesoProduct = prod;
  const meta = metaPesoVolumen(prod.unidad_medida);
  const tasa = await getTasa().catch(() => tasaState.price || 0);
  if (!(tasa > 0)) {
    avisosTasaAdmin('No hay tasa del dólar. El administrador debe fijarla en Impuestos / IVA.');
    return;
  }
  const baseUsd = Number(prod.precio_venta || 0);
  const pubUsd = calcConIva(baseUsd).total;
  posPesoUsdUnit = roundUpMoney(pubUsd);
  posPesoPrecioBsUnit = roundBsEntero(posPesoUsdUnit * tasa);

  const modal = document.getElementById('posPesoModal');
  const img = document.getElementById('posPesoImg');
  const name = document.getElementById('posPesoNombre');
  const price = document.getElementById('posPesoPrecio');
  const hint = document.getElementById('posPesoHint');
  const label = document.getElementById('posPesoPrecioLabel');
  const precioBsEl = document.getElementById('posPesoPrecioBs');
  const stockEl = document.getElementById('posPesoStock');
  const input = document.getElementById('posPesoBsInput');
  const err = document.getElementById('posPesoError');

  if (name) name.textContent = `${prod.marca || ''} ${prod.nombre || ''}`.trim();
  if (price) {
    price.textContent = `$${posPesoUsdUnit.toFixed(2)} / ${meta.baseLabel}` +
      (tasa ? `  ·  Bs ${fmtBs(posPesoPrecioBsUnit)}` : '');
  }
  if (hint) {
    hint.textContent = meta.unidad === 'LITRO'
      ? 'Indica cuántos bolívares lleva. Se calcula cuántos ml y se descuenta del stock en litros.'
      : 'Indica cuántos bolívares lleva. Se calcula cuántos gramos y se descuenta del stock en kilos.';
  }
  if (label) label.textContent = meta.precioLabel + ':';
  if (precioBsEl) {
    precioBsEl.textContent = fmtBs(posPesoPrecioBsUnit) +
      ' Bs / ' + meta.baseLabel;
  }
  if (stockEl) {
    const stock = Number(prod.inventario || 0);
    const fraction = String(parseFloat((stock * meta.factor).toFixed(3)));
    stockEl.textContent = `${formatStockQty(stock, meta.unidad)} ${meta.baseLabel} (${fraction} ${meta.fracLabel})`;
  }
  if (img) {
    img.src = prod.ruta_imagen ? assetUrl(prod.ruta_imagen) : '';
    img.style.display = prod.ruta_imagen ? 'block' : 'none';
  }
  if (err) err.textContent = '';
  if (input) {
    input.value = '';
    input.focus();
  }
  updatePosPesoCalc();
  if (modal) modal.style.display = 'flex';
}

function updatePosPesoCalc() {
  const meta = metaPesoVolumen(posPesoProduct && posPesoProduct.unidad_medida);
  const input = document.getElementById('posPesoBsInput');
  const equiv = document.getElementById('posPesoEquiv');
  const err = document.getElementById('posPesoError');
  const bs = roundBsEntero(parseFloat((input && input.value) || '0') || 0);
  if (!(bs > 0) || !(posPesoPrecioBsUnit > 0)) {
    if (equiv) equiv.textContent = '—';
    return;
  }
  const cantidadBase = Number((bs / posPesoPrecioBsUnit).toFixed(6));
  const frac = Number((cantidadBase * meta.factor).toFixed(3));
  if (equiv) {
    equiv.textContent = `${frac} ${meta.fracLabel} (${cantidadBase} ${meta.baseLabel})`;
  }
  const stock = Number((posPesoProduct && posPesoProduct.inventario) || 0);
  if (err) {
    err.textContent = cantidadBase > stock + 1e-9
      ? `Stock insuficiente (disponible ${formatStockQty(stock, meta.unidad)} ${meta.baseLabel})`
      : '';
  }
}

async function confirmPosPesoAdd() {
  if (!posPesoProduct) return;
  const meta = metaPesoVolumen(posPesoProduct.unidad_medida);
  const input = document.getElementById('posPesoBsInput');
  const err = document.getElementById('posPesoError');
  const bs = roundBsEntero(parseFloat((input && input.value) || '0') || 0);
  if (!(bs > 0)) {
    if (err) err.textContent = 'Ingresa un monto en bolívares mayor a 0';
    return;
  }
  if (!(posPesoPrecioBsUnit > 0)) {
    if (err) err.textContent = 'Precio por ' + meta.baseLabel + ' inválido';
    return;
  }
  const cantidadBase = Number((bs / posPesoPrecioBsUnit).toFixed(6));
  if (!(cantidadBase > 0)) {
    if (err) err.textContent = 'El monto es menor que la cantidad mínima que puede registrarse.';
    return;
  }
  const stock = Number(posPesoProduct.inventario || 0);
  if (cantidadBase > stock + 1e-9) {
    if (err) err.textContent = `Stock insuficiente (disponible ${formatStockQty(stock, meta.unidad)} ${meta.baseLabel})`;
    return;
  }
  const tasa = await getTasa().catch(() => tasaState.price || 0);
  // Línea exacta = Bs digitados; precio unitario derivado para stock/kg
  const usdLine = tasa > 0 ? (bs / tasa) : (cantidadBase * posPesoUsdUnit);
  const usdUnit = cantidadBase > 0 ? (usdLine / cantidadBase) : posPesoUsdUnit;
  const bsUnit = cantidadBase > 0 ? (bs / cantidadBase) : posPesoPrecioBsUnit;
  const gramos = Number((cantidadBase * meta.factor).toFixed(3));

  const selP = document.getElementById('ventaProducto');
  const selT = document.getElementById('ventaTalla');
  const selC = document.getElementById('ventaCategoria');
  const qty = document.getElementById('ventaCantidad');
  const precioBs = document.getElementById('ventaPrecioUnitarioBs');
  const precioUsd = document.getElementById('ventaPrecioUnitario');
  if (selP) selP.value = String(posPesoProduct.id_producto);
  if (selT) selT.innerHTML = '';
  if (selC && posPesoProduct.id_categoria) selC.value = String(posPesoProduct.id_categoria);
  if (qty) qty.value = String(cantidadBase);
  if (precioBs) precioBs.value = String(bsUnit);
  if (precioUsd) precioUsd.value = String(usdUnit);

  await onAgregarAlCarrito({
    monto_bs_venta: bs,
    unidad_medida: meta.unidad,
    fraccion_label: `${gramos} ${meta.fracLabel}`,
    precio_unitario: usdUnit,
    precio_unitario_bs: bsUnit
  });

  resetVentaCantidadDefault();
  const modal = document.getElementById('posPesoModal');
  if (modal) modal.style.display = 'none';
  posPesoProduct = null;
  setTimeout(restorePosSearchFocus, 0);
}

async function confirmPosTallaAdd() {
  if (!posSelectedProduct) return;
  if (isPesoVolumenUnidad(posSelectedProduct.unidad_medida)) {
    await openPosPesoModal(posSelectedProduct);
    return;
  }
  const tallas = posSelectedProduct.tallas || [];
  if (tallas.length > 0 && !posSelectedTalla) {
    alert('Selecciona una talla');
    return;
  }
  const cantEl = document.getElementById('posTallaCantidad');
  const cantidad = normalizeCantidadProducto(posSelectedProduct, parseFloat((cantEl && cantEl.value) || '1') || 1);
  const usd = roundMoney(Number(posSelectedProduct.precio_venta || 0));
  const tasa = await getTasa().catch(() => tasaState.price || 0);
  const precio_unitario_bs = roundBsEntero(usd * (Number(tasa) || 0));

  // sync hidden selects for legacy path
  const selP = document.getElementById('ventaProducto');
  const selT = document.getElementById('ventaTalla');
  const selC = document.getElementById('ventaCategoria');
  const qty = document.getElementById('ventaCantidad');
  const precioBs = document.getElementById('ventaPrecioUnitarioBs');
  const precioUsd = document.getElementById('ventaPrecioUnitario');
  if (selP) selP.value = String(posSelectedProduct.id_producto);
  if (selT) {
    selT.innerHTML = '';
    if (posSelectedTalla) {
      const o = document.createElement('option');
      o.value = posSelectedTalla;
      o.selected = true;
      selT.appendChild(o);
    }
  }
  if (selC && posSelectedProduct.id_categoria) selC.value = String(posSelectedProduct.id_categoria);
  if (qty) qty.value = String(cantidad);
  if (precioBs) precioBs.value = String(precio_unitario_bs);
  if (precioUsd) precioUsd.value = usd.toFixed(2);

  await onAgregarAlCarrito();
  const modal = document.getElementById('posTallaModal');
  if (modal) modal.style.display = 'none';
  setTimeout(restorePosSearchFocus, 0);
}

function wirePosPesoModal() {
  const closeBtn = document.getElementById('posPesoClose');
  const addBtn = document.getElementById('posPesoAdd');
  const input = document.getElementById('posPesoBsInput');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      const modal = document.getElementById('posPesoModal');
      if (modal) modal.style.display = 'none';
      posPesoProduct = null;
      setTimeout(restorePosSearchFocus, 0);
    });
  }
  if (addBtn) addBtn.addEventListener('click', () => { confirmPosPesoAdd(); });
  if (input) {
    input.addEventListener('input', updatePosPesoCalc);
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') confirmPosPesoAdd();
    });
  }
}

function syncPosTicketUI(totalUsd, descUsd, totalBs, descBs) {
  const body = document.getElementById('posTicketBody');
  const itemsEl = document.getElementById('posTotalItems');
  const linesEl = document.getElementById('posTotalLineas');
  const headUsd = document.getElementById('posHeaderTotalUsd');
  const headBs = document.getElementById('posHeaderTotalBs');
  const ivaFoot = document.getElementById('posIvaFoot');
  const footBase = document.getElementById('posFootBase');
  const footIva = document.getElementById('posFootIva');

  const netoUsd = Number(totalUsd || 0);
  const ivaCalc = calcConIva(netoUsd);
  const tasa = Number(tasaState.price || 0);
  const totalConIvaUsd = ivaCalc.total;
  const ivaBsHead = tasa > 0 ? roundBsPos(ivaCalc.iva * tasa) : 0;
  const totalConIvaBs = CAJA_MAYOR_MODE
    ? roundBsPos(Number(totalBs || 0) + roundBsPos(Number(totalBs || 0) * (ivaCalc.pct / 100)))
    : roundBsEntero(Number(totalBs || 0) + ivaBsHead);

  if (headUsd) headUsd.textContent = roundUpMoney(totalConIvaUsd).toFixed(2);
  if (headBs) headBs.textContent = fmtBs(totalConIvaBs);
  const usdChip = headUsd && headUsd.closest('.pos-total-chip');
  if (usdChip) usdChip.style.display = CAJA_MAYOR_MODE ? 'none' : '';
  if (itemsEl) itemsEl.textContent = String(cajaCart.reduce((s, it) => s + (Number(it.cantidad) || 0), 0));
  if (linesEl) linesEl.textContent = String(cajaCart.length);

  if (ivaFoot) {
    if (ivaCalc.activo && netoUsd > 0) {
      ivaFoot.style.display = '';
      if (footBase) footBase.textContent = CAJA_MAYOR_MODE ? fmtBs(totalBs) : '$' + ivaCalc.neto.toFixed(2);
      if (footIva) footIva.textContent = CAJA_MAYOR_MODE ? fmtBs(roundBsPos(Number(totalBs || 0) * (ivaCalc.pct / 100))) : '$' + ivaCalc.iva.toFixed(2);
    } else {
      ivaFoot.style.display = 'none';
    }
  }

  if (!body) return;
  if (!cajaCart.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="4">Carrito vacío. Toca un producto a la derecha.</td></tr>';
    return;
  }
  body.innerHTML = cajaCart.map((it, idx) => {
    const calc = aplicarMejorPromocion(it);
    const descuento = Number(calc.descuento || 0);
    const lt = lineTotalsItem(it, descuento);
    const tallaName = (() => {
      const p = productosCache.find(x => Number(x.id_producto) === Number(it.id_producto));
      const t = p && (p.tallas || []).find(tt => Number(tt.id_talla) === Number(it.id_talla));
      return t ? t.nombre : '';
    })();
    const pesoTxt = formatPesoVentaLine(it);
    const promo = calc.promo ? `<div class="line-promo">${calc.promo.nombre} (-$${descuento.toFixed(2)})</div>` : '';
    const cantShow = isPesoVolumenUnidad(it.unidad_medida)
      ? (it.fraccion_label || (formatCantidadTicket(it) + ' g'))
      : String(Math.max(1, Math.round(Number(it.cantidad) || 1)));
    const subBits = [];
    if (pesoTxt) subBits.push(pesoTxt);
    else if (tallaName) subBits.push('Talla ' + tallaName);
    if (!isPesoVolumenUnidad(it.unidad_medida)) {
      subBits.push(CAJA_MAYOR_MODE
        ? 'Bs ' + fmtBs(Number(it.precio_unitario_bs || 0)) + ' c/u'
        : '$' + roundUpMoney(Number(it.precio_unitario)).toFixed(2) + ' c/u');
    }
    return `<tr class="pos-line-row" data-idx="${idx}" onclick="window.selectCartLine && selectCartLine(${idx}, event)">
      <td class="pos-line-cant">${cantShow}</td>
      <td>
        <div class="line-desc">${it.nombre || ('#' + it.id_producto)}</div>
        <div class="line-sub">${subBits.join(' · ')}</div>
        ${promo}
      </td>
      <td>${CAJA_MAYOR_MODE
        ? `<strong>Bs ${fmtBs(lt.lineBs)}</strong>`
        : `<strong>$${lt.lineUsd.toFixed(2)}</strong><div class="line-sub">Bs ${fmtBs(lt.lineBs)}</div>`}</td>
      <td><button type="button" class="pos-rm-btn" onclick="event.stopPropagation(); removeCartItem(${idx})">×</button></td>
    </tr>`;
  }).join('');
}

async function setupPosTerminalGate() {
  const gate = document.getElementById('posTerminalGate');
  if (!gate) return;
  if (CAJA_MAYOR_MODE) {
    document.title = 'MAX POS — Caja Mayor';
    const badge = document.getElementById('posCajaModeBadge');
    const title = document.getElementById('posGateTitle');
    const hint = document.getElementById('posGateHint');
    const label = document.getElementById('posGateClaveLabel');
    const serverLabel = document.getElementById('posServerUrlLabel');
    const serverTip = document.getElementById('posGateServerTip');
    const serverUrlInput = document.getElementById('posServerUrl');
    const expectedPort = window.location.port || '3011';
    if (badge) badge.style.display = '';
    if (title) title.textContent = 'Abrir terminal Caja Mayor';
    if (hint) hint.textContent = 'Ingresa la clave de acceso de la terminal Caja Mayor registrada por el administrador.';
    if (label) label.textContent = 'Clave de Caja Mayor';
    if (serverLabel) serverLabel.textContent = 'Servidor Caja Mayor (solo si esta PC no es el servidor)';
    if (serverTip) serverTip.textContent = `Usa la IP del servidor con el puerto ${expectedPort}. Si ya se conectó antes, deja el campo vacío.`;
    if (serverUrlInput) serverUrlInput.placeholder = `http://192.168.1.124:${expectedPort}`;
  }
  const token = localStorage.getItem('pos_token_sesion');
  const idCaja = localStorage.getItem('pos_id_caja');
  if (token && idCaja) {
    window._posTerminal = { token_sesion: token, id_caja: Number(idCaja), nombre_caja: localStorage.getItem('pos_nombre_caja') || '' };
    // heartbeat check
    try {
      const r = await posFetch('/api/v1/cajas/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token_sesion: token })
      });
      if (r.ok) {
        startPosHeartbeat();
        return; // sesión viva
      }
    } catch (_) {}
    // Sesión caducada o servidor no respondió: pedir abrir de nuevo (mismo token permite reconectar)
  }
  gate.style.display = 'flex';

  const urlInput = document.getElementById('posServerUrl');
  if (urlInput) urlInput.value = localStorage.getItem('serverBaseUrl') || '';

  const openBtn = document.getElementById('posOpenTerminal');
  if (openBtn) {
    openBtn.addEventListener('click', async () => {
      const clave = (document.getElementById('posClaveCaja') || {}).value || '';
      let serverUrl = (document.getElementById('posServerUrl') || {}).value || '';
      const msg = document.getElementById('posGateMsg');
      // Si pegaron "MAX_SERVER_URL=http://..." limpiar
      serverUrl = String(serverUrl).trim().replace(/^MAX_SERVER_URL\s*=\s*/i, '').replace(/\/$/, '');
      if (serverUrl && !/^https?:\/\//i.test(serverUrl)) {
        serverUrl = 'http://' + serverUrl;
      }
      if (!clave.trim()) {
        if (msg) msg.textContent = 'Ingresa la clave de la caja';
        return;
      }
      if (serverUrl && CAJA_MAYOR_MODE) {
        try {
          const parsed = new URL(serverUrl);
          const expectedPort = window.location.port || '3011';
          if (parsed.protocol !== 'http:' || parsed.port !== expectedPort) {
            if (msg) msg.textContent = `Caja Mayor debe conectarse al puerto ${expectedPort}.`;
            return;
          }
          serverUrl = parsed.origin;
        } catch (_) {
          if (msg) msg.textContent = 'Escribe una dirección válida del servidor Caja Mayor.';
          return;
        }
      }
      if (serverUrl) localStorage.setItem('serverBaseUrl', serverUrl);
      else localStorage.removeItem('serverBaseUrl');
      if (msg) msg.textContent = 'Conectando…';
      try {
        const tokenExistente = localStorage.getItem('pos_token_sesion') || '';
        const res = await posFetch('/api/v1/cajas/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clave_caja: clave.trim(),
            token_sesion: tokenExistente || undefined
          })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          if (msg) {
            msg.textContent = data.error || (
              res.status === 0 || res.type === 'opaque'
                ? 'No hay conexión con el servidor. Revisa IP, Wi‑Fi y que MAX esté abierto en el servidor.'
                : ('No se pudo abrir la caja' + (res.status ? ' (' + res.status + ')' : ''))
            );
          }
          return;
        }
        if (CAJA_MAYOR_MODE && String(data.nombre_caja || '').trim().toLowerCase() !== 'caja mayor') {
          await posFetch('/api/v1/cajas/logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token_sesion: data.token_sesion })
          }).catch(() => {});
          if (msg) msg.textContent = 'Este acceso requiere la terminal registrada Caja Mayor.';
          return;
        }
        localStorage.setItem('pos_token_sesion', data.token_sesion);
        localStorage.setItem('pos_id_caja', String(data.id_caja));
        localStorage.setItem('pos_nombre_caja', data.nombre_caja || '');
        window._posTerminal = data;
        gate.style.display = 'none';
        if (msg) msg.textContent = '';
        startPosHeartbeat();
        startStockStream();
        startTasaStream();
        if (typeof loadProductosForCaja === 'function') await loadProductosForCaja();
        if (typeof loadPromociones === 'function') await loadPromociones();
        if (typeof loadCategorias === 'function') await loadCategorias();
        else if (typeof loadCategoriasForCaja === 'function') await loadCategoriasForCaja();
      } catch (e) {
        if (msg) {
          msg.textContent = 'No hay conexión con el servidor. Revisa la URL (ej. http://192.168.1.124:3000), Wi‑Fi y VPN.';
        }
      }
    });
  }

  // No permitir saltar el login de terminal con Escape (rompe productos/APIs)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && gate.style.display !== 'none') {
      e.preventDefault();
    }
  });
}

function startPosHeartbeat() {
  const token = localStorage.getItem('pos_token_sesion');
  if (!token) return;
  if (window._posHeartbeatTimer) clearInterval(window._posHeartbeatTimer);
  window._posHeartbeatTimer = setInterval(async () => {
    try {
      await posFetch('/api/v1/cajas/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token_sesion: token })
      });
    } catch (_) {}
  }, 30000);
}

// Liberar cupo al cerrar pestaña / salir
function liberarSesionCajaBeacon() {
  const token = localStorage.getItem('pos_token_sesion');
  if (!token) return;
  const base = (typeof apiBase === 'function' ? apiBase() : '') || '';
  const url = (base || '') + '/api/v1/cajas/logout';
  const body = JSON.stringify({ token_sesion: token });
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon(url, blob);
    }
  } catch (_) {}
  localStorage.removeItem('pos_token_sesion');
  localStorage.removeItem('pos_id_caja');
  localStorage.removeItem('pos_nombre_caja');
}
window.addEventListener('pagehide', liberarSesionCajaBeacon);

// Liberar cupo al cerrar sesión
const _origLogoutBtn = document.getElementById('logoutBtn');
if (_origLogoutBtn) {
  _origLogoutBtn.addEventListener('click', async () => {
    const token = localStorage.getItem('pos_token_sesion');
    if (token) {
      try {
        await posFetch('/api/v1/cajas/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token_sesion: token })
        });
      } catch (_) {}
      localStorage.removeItem('pos_token_sesion');
      localStorage.removeItem('pos_id_caja');
      localStorage.removeItem('pos_nombre_caja');
    }
  });
}

// ==================== HERRAMIENTAS POS: visor, limpiar, pendientes, cantidad línea ====================

function loadPendientes() {
  try {
    const raw = localStorage.getItem(PENDIENTES_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (_) {
    return [];
  }
}

function savePendientes(list) {
  localStorage.setItem(PENDIENTES_KEY, JSON.stringify(list || []));
  updatePendientesBadge();
}

function updatePendientesBadge() {
  const badge = document.getElementById('posPendientesBadge');
  if (!badge) return;
  const n = loadPendientes().length;
  badge.textContent = String(n);
  badge.style.display = n > 0 ? 'inline-flex' : 'none';
}

function ticketClienteActual() {
  return {
    cedula: (document.getElementById('ventaClienteCedula') || {}).value || '',
    nombre: (document.getElementById('ventaClienteNombre') || {}).value || '',
    telefono: (document.getElementById('ventaClienteTelefono') || {}).value || '',
    direccion: (document.getElementById('ventaClienteDireccion') || {}).value || '',
    email: (document.getElementById('ventaClienteEmail') || {}).value || ''
  };
}

function setTicketCliente(cli) {
  const c = cli || {};
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
  set('ventaClienteCedula', c.cedula);
  set('ventaClienteNombre', c.nombre);
  set('ventaClienteTelefono', c.telefono);
  set('ventaClienteDireccion', c.direccion);
  set('ventaClienteEmail', c.email);
}

function calcCartTotalsSnap() {
  const snap = cajaCart.map((it) => {
    const calc = typeof aplicarMejorPromocion === 'function' ? aplicarMejorPromocion(it) : { descuento: 0 };
    return Object.assign({}, it, { descuento: Number(calc.descuento || 0) });
  });
  const money = computeCartMoneyTotals(snap);
  return {
    total_usd: money.totalUsd,
    total_bs: money.totalBs,
    tasa: money.tasa,
    base_usd: money.ivaCalc.neto,
    iva_usd: money.ivaCalc.iva,
    iva_porcentaje: money.ivaCalc.pct
  };
}

async function limpiarTicketCompleto(askConfirm) {
  if (!cajaCart.length && !(document.getElementById('ventaClienteCedula') || {}).value) {
    showNotification('Ticket ya vacío', 'info', 1500);
    return;
  }
  if (askConfirm !== false && !(await maxConfirm('¿Limpiar todo el ticket (productos y cliente)?', { title: 'Limpiar ticket', okText: 'Limpiar' }))) return;
  cajaCart = [];
  selectedCartIdx = null;
  setTicketCliente({});
  const search = document.getElementById('posSearch');
  const barcode = document.getElementById('posBarcode');
  if (search) search.value = '';
  if (barcode) barcode.value = '';
  renderCart();
  showNotification('Ticket limpio', 'ok', 1800);
}

function guardarPedidoPendiente() {
  if (!cajaCart.length) {
    alert('No hay productos en el ticket para guardar.');
    return;
  }
  const totals = calcCartTotalsSnap();
  const pedido = {
    id: 'P' + Date.now(),
    fecha: new Date().toISOString(),
    cliente: ticketClienteActual(),
    items: JSON.parse(JSON.stringify(cajaCart)),
    total_usd: totals.total_usd,
    total_bs: totals.total_bs
  };
  const list = loadPendientes();
  list.unshift(pedido);
  savePendientes(list);
  cajaCart = [];
  selectedCartIdx = null;
  setTicketCliente({});
  renderCart();
  showNotification('Pedido guardado como pendiente (' + pedido.id + ')', 'ok', 2800);
}

function renderPendientesList() {
  const box = document.getElementById('posPendientesList');
  if (!box) return;
  const list = loadPendientes();
  if (!list.length) {
    box.innerHTML = '<div class="pos-pend-empty">No hay facturas pendientes</div>';
    return;
  }
  box.innerHTML = list.map((p) => {
    const fecha = (() => {
      try { return new Date(p.fecha).toLocaleString('es-VE'); } catch (_) { return p.fecha || ''; }
    })();
    const cli = (p.cliente && (p.cliente.nombre || p.cliente.cedula)) || 'Sin cliente';
    const nItems = (p.items || []).reduce((s, it) => s + (Number(it.cantidad) || 0), 0);
    return `<div class="pos-pend-item">
      <div class="pos-pend-main" data-id="${p.id}">
        <strong>${p.id}</strong>
        <span>${fecha}</span>
        <span>${cli}</span>
        <span>${nItems} und · $${Number(p.total_usd || 0).toFixed(2)}</span>
      </div>
      <div class="pos-pend-actions">
        <button type="button" class="pos-tool-btn" data-recover="${p.id}">Recuperar</button>
        <button type="button" class="pos-tool-btn danger" data-delete="${p.id}">Borrar</button>
      </div>
    </div>`;
  }).join('');

  box.querySelectorAll('[data-recover]').forEach((btn) => {
    btn.addEventListener('click', () => recuperarPendiente(btn.getAttribute('data-recover')));
  });
  box.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-delete');
      if (!(await maxConfirm('¿Eliminar este pedido pendiente?', { title: 'Eliminar pendiente', okText: 'Eliminar' }))) return;
      savePendientes(loadPendientes().filter((p) => p.id !== id));
      renderPendientesList();
    });
  });
}

async function recuperarPendiente(id) {
  const list = loadPendientes();
  const pedido = list.find((p) => p.id === id);
  if (!pedido) return;
  if (cajaCart.length && !(await maxConfirm('Hay productos en el ticket. ¿Reemplazarlos con este pendiente?', { title: 'Recuperar pendiente', okText: 'Reemplazar' }))) return;
  cajaCart = JSON.parse(JSON.stringify(pedido.items || []));
  selectedCartIdx = null;
  setTicketCliente(pedido.cliente || {});
  savePendientes(list.filter((p) => p.id !== id));
  renderCart();
  const modal = document.getElementById('posPendientesModal');
  if (modal) modal.style.display = 'none';
  showNotification('Pedido ' + id + ' recuperado', 'ok', 2200);
}

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'flex';
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

function renderVisorResults(query) {
  const box = document.getElementById('posVisorResults');
  const detail = document.getElementById('posVisorDetail');
  if (!box) return;
  const q = String(query || '').trim().toLowerCase();
  if (!q) {
    box.innerHTML = '<div class="pos-pend-empty">Escribe para buscar…</div>';
    if (detail) detail.style.display = 'none';
    return;
  }
  const hits = (productosCache || []).filter((p) => {
    const name = `${p.marca || ''} ${p.nombre || ''}`.toLowerCase();
    const bc = String(p.codigo_barras || '').toLowerCase();
    return name.includes(q) || bc.includes(q) || String(p.id_producto) === q;
  }).slice(0, 40);
  if (!hits.length) {
    box.innerHTML = '<div class="pos-pend-empty">Sin resultados</div>';
    if (detail) detail.style.display = 'none';
    return;
  }
  box.innerHTML = hits.map((p) => {
    const base = Number(p.precio_venta || 0);
    const stockTxt = formatStockQty(p.inventario, p.unidad_medida);
    return `
    <button type="button" class="pos-visor-row" data-id="${p.id_producto}">
      <span>${(p.marca || '')} ${(p.nombre || '')} · Stock ${stockTxt}</span>
      <strong>$${precioPublicoUsd(base).toFixed(2)}${ivaState.activo ? ' <small>IVA incl.</small>' : ''}</strong>
    </button>`;
  }).join('');
  box.querySelectorAll('.pos-visor-row').forEach((btn) => {
    btn.addEventListener('click', () => showVisorProducto(btn.getAttribute('data-id')));
  });
}

function showVisorProducto(id) {
  visorProductoIdActual = id;
  const p = (productosCache || []).find((x) => String(x.id_producto) === String(id));
  const detail = document.getElementById('posVisorDetail');
  if (!p || !detail) return;
  const tasa = Number(tasaState.price || 0);
  const usdBase = Number(p.precio_venta || 0);
  const ivaCalc = calcConIva(usdBase);
  const usd = ivaCalc.total;
  const bs = usd * tasa;
  const nameEl = document.getElementById('posVisorNombre');
  const usdEl = document.getElementById('posVisorUsd');
  const bsEl = document.getElementById('posVisorBs');
  const metaEl = document.getElementById('posVisorMeta');
  if (nameEl) nameEl.textContent = `${p.marca || ''} ${p.nombre || ''}`.trim();
  if (usdEl) usdEl.textContent = `$${usd.toFixed(2)}${ivaCalc.activo ? ' (IVA incluido)' : ''}`;
  if (bsEl) bsEl.textContent = tasa > 0 ? fmtBs(bs) : '—';
  if (metaEl) {
    metaEl.textContent = [
      ivaCalc.activo ? `Base $${usdBase.toFixed(2)} · IVA $${ivaCalc.iva.toFixed(2)}` : null,
      p.unidad_medida ? `Unidad: ${p.unidad_medida}` : null,
      p.inventario != null ? `Stock: ${formatStockQty(p.inventario, p.unidad_medida)}` : null,
      p.codigo_barras ? `Código: ${p.codigo_barras}` : null
    ].filter(Boolean).join(' · ');
  }
  detail.style.display = 'block';
}

window.selectCartLine = function (idx, ev) {
  if (ev && ev.target && ev.target.closest && ev.target.closest('.pos-rm-btn')) return;
  const i = Number(idx);
  if (!cajaCart[i]) return;
  selectedCartIdx = i;
  document.querySelectorAll('.pos-line-row').forEach((tr) => {
    tr.classList.toggle('selected', Number(tr.dataset.idx) === i);
  });
  openQtyEditor(i);
};

function openQtyEditor(idx) {
  const it = cajaCart[idx];
  if (!it) return;
  selectedCartIdx = idx;
  const name = document.getElementById('posQtyProductName');
  const input = document.getElementById('posQtyValue');
  if (name) name.textContent = it.nombre || ('#' + it.id_producto);
  if (input) {
    input.value = String(it.cantidad || 1);
    const u = (() => {
      const p = productosCache.find((x) => Number(x.id_producto) === Number(it.id_producto));
      const um = (p && p.unidad_medida) || 'UNIDAD';
      return String(um).toUpperCase();
    })();
    input.step = (u === 'UNIDAD' || u === 'CAJA' || u === 'PAQUETE') ? '1' : '0.001';
  }
  openModal('posQtyModal');
  setTimeout(() => { try { input && input.focus(); input && input.select(); } catch (_) {} }, 50);
}

function applyQtyEditor() {
  const idx = selectedCartIdx;
  if (idx == null || !cajaCart[idx]) return;
  const input = document.getElementById('posQtyValue');
  let qty = parseFloat((input && input.value) || '0');
  if (!(qty > 0)) {
    alert('Cantidad inválida');
    return;
  }
  cajaCart[idx].cantidad = qty;
  closeModal('posQtyModal');
  renderCart();
}

function setupPosHerramientas() {
  updatePendientesBadge();
  setupPagoModal();

  const btnVisor = document.getElementById('btnVisorPrecio');
  const btnLimpiar = document.getElementById('btnLimpiarTicket');
  const btnPend = document.getElementById('btnPedidoPendiente');
  const btnVerPend = document.getElementById('btnVerPendientes');

  if (btnVisor) btnVisor.addEventListener('click', () => {
    openModal('posVisorPrecioModal');
    const s = document.getElementById('posVisorSearch');
    if (s) { s.value = ''; setTimeout(() => s.focus(), 40); }
    renderVisorResults('');
  });
  if (btnLimpiar) btnLimpiar.addEventListener('click', () => limpiarTicketCompleto(true));
  if (btnPend) btnPend.addEventListener('click', () => guardarPedidoPendiente());
  if (btnVerPend) btnVerPend.addEventListener('click', () => {
    renderPendientesList();
    openModal('posPendientesModal');
  });

  const visorClose = document.getElementById('posVisorClose');
  const pendClose = document.getElementById('posPendientesClose');
  const qtyClose = document.getElementById('posQtyClose');
  if (visorClose) visorClose.addEventListener('click', () => closeModal('posVisorPrecioModal'));
  if (pendClose) pendClose.addEventListener('click', () => closeModal('posPendientesModal'));
  if (qtyClose) qtyClose.addEventListener('click', () => closeModal('posQtyModal'));

  ['posVisorPrecioModal', 'posPendientesModal', 'posQtyModal'].forEach((id) => {
    const m = document.getElementById(id);
    if (m) m.addEventListener('click', (e) => { if (e.target === m) closeModal(id); });
  });

  const visorSearch = document.getElementById('posVisorSearch');
  if (visorSearch) {
    visorSearch.addEventListener('input', () => renderVisorResults(visorSearch.value));
  }

  const minus = document.getElementById('posQtyMinus');
  const plus = document.getElementById('posQtyPlus');
  const apply = document.getElementById('posQtyApply');
  const remove = document.getElementById('posQtyRemove');
  const qtyInput = document.getElementById('posQtyValue');
  const stepQty = (dir) => {
    if (!qtyInput) return;
    const step = parseFloat(qtyInput.step || '1') || 1;
    let v = parseFloat(qtyInput.value || '0') || 0;
    v = Math.max(step, +(v + dir * step).toFixed(3));
    qtyInput.value = String(v);
  };
  if (minus) minus.addEventListener('click', () => stepQty(-1));
  if (plus) plus.addEventListener('click', () => stepQty(1));
  if (apply) apply.addEventListener('click', applyQtyEditor);
  if (qtyInput) qtyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); applyQtyEditor(); }
  });
  if (remove) remove.addEventListener('click', () => {
    if (selectedCartIdx == null) return;
    removeCartItem(selectedCartIdx);
    selectedCartIdx = null;
    closeModal('posQtyModal');
  });
}
