/**
 * Etiquetas de precio de venta (estilo anaquel / térmica)
 * Diseño: nombre arriba · precio grande en Bs · "Bs." · IVA incl. (si aplica) · marca
 */
const EMPRESA_ETIQUETA = 'COMERCIALIZADORA LIVIA DUN';
(function () {
  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function nombreProducto(prod) {
    const marca = String(prod.marca || '').trim();
    const nombre = String(prod.nombre || '').trim();
    if (marca && marca !== '-' && nombre) return `${marca} - ${nombre}`;
    return nombre || marca || 'Producto';
  }

  const LS_SETUP = 'max_etiqueta_print_setup';
  const DEFAULT_SETUP = { paperMm: 80, offsetXmm: 0, offsetYmm: 0, marginMm: 1.5 };

  function clampNum(n, min, max, fallback) {
    const x = Number(n);
    if (!Number.isFinite(x)) return fallback;
    return Math.min(max, Math.max(min, x));
  }

  function loadPrintSetup() {
    try {
      const raw = localStorage.getItem(LS_SETUP);
      const s = raw ? JSON.parse(raw) : {};
      return {
        paperMm: Number(s.paperMm) === 58 ? 58 : 80,
        offsetXmm: clampNum(s.offsetXmm, -20, 20, 0),
        offsetYmm: clampNum(s.offsetYmm, -20, 20, 0),
        marginMm: clampNum(s.marginMm, 0, 8, 1.5)
      };
    } catch (_) {
      return { ...DEFAULT_SETUP };
    }
  }

  function savePrintSetup(s) {
    const next = {
      paperMm: Number(s.paperMm) === 58 ? 58 : 80,
      offsetXmm: clampNum(s.offsetXmm, -20, 20, 0),
      offsetYmm: clampNum(s.offsetYmm, -20, 20, 0),
      marginMm: clampNum(s.marginMm, 0, 8, 1.5)
    };
    localStorage.setItem(LS_SETUP, JSON.stringify(next));
    return next;
  }

  function roundBsEntero(n) {
    const x = Number(n);
    if (!Number.isFinite(x) || x <= 0) return 0;
    // 681,20 → 681 · 681,50 → 682
    return Math.round(x);
  }

  function formatBsEntero(n) {
    return roundBsEntero(n).toLocaleString('es-VE', { maximumFractionDigits: 0 });
  }

  async function fetchTasa() {
    try {
      const res = await fetch('/api/tasa-bcv', { credentials: 'include' });
      if (!res.ok) return 0;
      const data = await res.json();
      return Number(data.tasa || data.valor || (data.current && data.current.price) || 0) || 0;
    } catch (_) {
      return 0;
    }
  }

  async function fetchIva() {
    try {
      const res = await fetch('/api/config/iva', { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { activo: false, porcentaje: 16 };
      return {
        activo: !!data.activo,
        porcentaje: Number(data.porcentaje) > 0 ? Number(data.porcentaje) : 16
      };
    } catch (_) {
      return { activo: false, porcentaje: 16 };
    }
  }

  function labelHtml(prod, tasa, iva) {
    const usdBase = Number(prod.precio_venta || 0);
    const factor = (iva && iva.activo) ? (1 + (Number(iva.porcentaje) || 16) / 100) : 1;
    const usdPub = usdBase * factor;
    const bs = usdPub * Number(tasa || 0);
    const ivaLine = (iva && iva.activo)
      ? `<div class="pl-iva">IVA incluido</div>`
      : '';
    return `
      <div class="price-label">
        <div class="pl-name">${escapeHtml(nombreProducto(prod))}</div>
        <div class="pl-price">${formatBsEntero(bs)}</div>
        <div class="pl-bs">Bs.</div>
        ${ivaLine}
        <div class="pl-brand">${escapeHtml(EMPRESA_ETIQUETA)}</div>
      </div>`;
  }

  function printCss(setup) {
    const paper = setup.paperMm === 58 ? 58 : 80;
    const inner = Math.max(40, paper - 4);
    const pad = setup.marginMm;
    const ox = setup.offsetXmm;
    const oy = setup.offsetYmm;
    const pricePt = paper === 58 ? 32 : 40;
    const namePt = paper === 58 ? 11 : 14;
    return `
    @page { size: ${paper}mm auto; margin: 0; }
    html, body {
      width: ${paper}mm;
      margin: 0;
      padding: 0;
      font-family: Arial, Helvetica, sans-serif;
      color: #000;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    * { box-sizing: border-box; }
    .price-label {
      width: ${inner}mm;
      max-width: ${inner}mm;
      margin: ${oy}mm 0 0 ${ox}mm;
      padding: ${pad}mm ${pad}mm;
      text-align: center;
      page-break-after: always;
      break-after: page;
      page-break-inside: avoid;
    }
    .price-label:last-child {
      page-break-after: auto;
      break-after: auto;
    }
    .pl-name, .pl-price, .pl-bs, .pl-iva, .pl-brand {
      color: #000 !important;
      font-weight: 900;
      -webkit-text-stroke: 0.35px #000;
      text-rendering: geometricPrecision;
    }
    .pl-name {
      font-size: ${namePt}pt;
      line-height: 1.15;
      margin-bottom: 4px;
      word-break: break-word;
    }
    .pl-price {
      font-size: ${pricePt}pt;
      line-height: 0.95;
      letter-spacing: -0.5px;
      white-space: nowrap;
    }
    .pl-bs {
      font-size: ${paper === 58 ? 13 : 16}pt;
      margin-top: 2px;
    }
    .pl-iva {
      font-size: ${paper === 58 ? 9 : 11}pt;
      margin-top: 4px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .pl-brand {
      font-size: ${paper === 58 ? 7 : 8.5}pt;
      margin-top: 6px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      line-height: 1.2;
      word-break: break-word;
    }
    `;
  }

  function openPrintWindow(innerHtml) {
    const setup = loadPrintSetup();
    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Etiquetas de precio — ${EMPRESA_ETIQUETA}</title><style>${printCss(setup)}</style></head><body>${innerHtml}</body></html>`;

    // Método fiable: iframe oculto (evita about:blank vacío por bloqueo de popups / noopener)
    let frame = document.getElementById('maxPrintFrame');
    if (frame) frame.remove();
    frame = document.createElement('iframe');
    frame.id = 'maxPrintFrame';
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;';
    document.body.appendChild(frame);

    const doc = frame.contentDocument || (frame.contentWindow && frame.contentWindow.document);
    if (!doc) {
      // Fallback: Blob URL en nueva pestaña
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const win = window.open(url, '_blank');
      if (!win) {
        alert('No se pudo abrir la impresión. Permite ventanas emergentes o prueba de nuevo.');
        URL.revokeObjectURL(url);
        return;
      }
      setTimeout(() => {
        try { win.focus(); win.print(); } catch (_) {}
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }, 400);
      return;
    }

    doc.open();
    doc.write(html);
    doc.close();

    const doPrint = () => {
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
      } catch (e) {
        console.error('Error al imprimir etiquetas:', e);
        alert('No se pudo abrir el diálogo de impresión.');
      }
    };

    setTimeout(doPrint, 300);
  }

  async function ensureTasa() {
    const tasa = await fetchTasa();
    if (!(tasa > 0)) {
      alert('No hay tasa del dólar disponible. Actualiza la tasa (BCV) e intenta de nuevo.');
      return null;
    }
    return tasa;
  }

  function fillSetupForm() {
    const s = loadPrintSetup();
    const paper = document.getElementById('etiqPaperMm');
    const ox = document.getElementById('etiqOffsetX');
    const oy = document.getElementById('etiqOffsetY');
    const mg = document.getElementById('etiqMargin');
    if (paper) paper.value = String(s.paperMm);
    if (ox) ox.value = String(s.offsetXmm);
    if (oy) oy.value = String(s.offsetYmm);
    if (mg) mg.value = String(s.marginMm);
  }

  function bindSetupForm() {
    const btn = document.getElementById('etiqSetupGuardarBtn');
    if (!btn || btn._etiqBound) return;
    btn._etiqBound = true;
    fillSetupForm();
    btn.addEventListener('click', () => {
      const msg = document.getElementById('etiqSetupMsg');
      const next = savePrintSetup({
        paperMm: (document.getElementById('etiqPaperMm') || {}).value,
        offsetXmm: (document.getElementById('etiqOffsetX') || {}).value,
        offsetYmm: (document.getElementById('etiqOffsetY') || {}).value,
        marginMm: (document.getElementById('etiqMargin') || {}).value
      });
      fillSetupForm();
      if (msg) {
        msg.textContent = `Guardado · papel ${next.paperMm} mm · offset ${next.offsetXmm}/${next.offsetYmm} mm`;
        msg.className = 'iva-save-msg ok';
      }
    });
  }

  window.MaxEtiquetasPrecio = {
    loadPrintSetup,
    savePrintSetup,
    async imprimirUno(prod) {
      if (!prod) return;
      const tasa = await ensureTasa();
      if (!tasa) return;
      const iva = await fetchIva();
      openPrintWindow(labelHtml(prod, tasa, iva));
    },
    async imprimirTodos(lista) {
      const prods = (lista || []).filter(p => p && p.id_producto && !(p.nombre === 'Producto eliminado' && p.marca === '-'));
      if (!prods.length) {
        alert('No hay productos para imprimir.');
        return;
      }
      const tasa = await ensureTasa();
      if (!tasa) return;
      const iva = await fetchIva();
      openPrintWindow(prods.map(p => labelHtml(p, tasa, iva)).join(''));
    }
  };

  window.imprimirEtiquetaProducto = function (idProducto) {
    const list = (typeof window.getProductosAdminList === 'function') ? window.getProductosAdminList() : [];
    const prod = list.find(p => Number(p.id_producto) === Number(idProducto));
    if (!prod) {
      alert('Producto no encontrado en el listado.');
      return;
    }
    window.MaxEtiquetasPrecio.imprimirUno(prod);
  };

  window.imprimirTodasEtiquetasProductos = function () {
    const list = (typeof window.getProductosAdminList === 'function') ? window.getProductosAdminList() : [];
    const visible = document.querySelectorAll('#adminProductos .item[data-id]');
    if (visible.length > 0 && visible.length < list.length) {
      const ids = new Set([...visible].map(el => Number(el.dataset.id)));
      window.MaxEtiquetasPrecio.imprimirTodos(list.filter(p => ids.has(Number(p.id_producto))));
      return;
    }
    window.MaxEtiquetasPrecio.imprimirTodos(list);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindSetupForm);
  } else {
    bindSetupForm();
  }
})();
