/**
 * Impresión de factura térmica POS — detección real vía Web Serial / Web USB
 * y envío ESC/POS. Fallback: impresión del sistema (iframe).
 */
(function (global) {
  const LS_PRINTER = 'max_pos_printer';
  const ESC = '\x1B';
  const GS = '\x1D';

  let _serialPort = null;
  let _usbDevice = null;

  function loadPrinterMeta() {
    try {
      const raw = localStorage.getItem(LS_PRINTER) || localStorage.getItem('modasoft_pos_printer');
      return JSON.parse(raw || 'null') || {};
    } catch (_) {
      return {};
    }
  }

  function savePrinterMeta(meta) {
    try {
      localStorage.setItem(LS_PRINTER, JSON.stringify(meta || {}));
    } catch (_) {}
  }

  const EMPRESA_DEFAULT = {
    nombre: 'COMERCIALIZADORA LIVIA DUN',
    rif: 'J505356658',
    direccion: 'Venezuela',
    telefono: '',
    pie: 'COMERCIALIZADORA LIVIA DUN'
  };

  function empresaFactura() {
    const meta = loadPrinterMeta();
    let nombre = String(meta.empresa_nombre || '').trim();
    let rif = String(meta.empresa_rif || '').trim();
    if (!nombre || /^MAX(\s|$)/i.test(nombre) || /^MAX\s*ERP$/i.test(nombre)) {
      nombre = EMPRESA_DEFAULT.nombre;
    }
    const rifNorm = rif.replace(/[\s-]/g, '');
    if (!rif || rif === 'J-00000000-0' || /^J0+$/i.test(rifNorm)) {
      rif = EMPRESA_DEFAULT.rif;
    }
    let pie = String(meta.empresa_pie || '').trim();
    if (!pie || /MAX\s*POS/i.test(pie) || /^MAX$/i.test(pie)) {
      pie = EMPRESA_DEFAULT.pie;
    }
    return {
      nombre,
      rif,
      direccion: meta.empresa_direccion || EMPRESA_DEFAULT.direccion,
      telefono: meta.empresa_telefono || EMPRESA_DEFAULT.telefono,
      pie
    };
  }

  function roundBsEntero(n) {
    const x = Number(n);
    if (!Number.isFinite(x) || x <= 0) return 0;
    return Math.round(x);
  }

  function money(n) {
    return roundBsEntero(n).toLocaleString('es-VE', { maximumFractionDigits: 0 });
  }

  function moneyUsd(n) {
    const v = Number(n) || 0;
    return v.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function pad(str, len, right) {
    const s = String(str == null ? '' : str);
    if (s.length >= len) return s.slice(0, len);
    const spaces = ' '.repeat(len - s.length);
    return right ? spaces + s : s + spaces;
  }

  function stripAccents(s) {
    return String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7E\n\r\t]/g, '?');
  }

  /** Ancho de papel térmico: 57 mm, 80 mm o más (112 mm). */
  function getPaperMm() {
    const meta = loadPrinterMeta();
    let mm = Number(meta.paper_mm);
    if (!(mm > 0)) mm = 57;
    if (mm <= 58) return 57;
    if (mm <= 90) return 80;
    if (mm <= 120) return 112;
    return Math.round(mm);
  }

  function setPaperMm(mm) {
    const n = Number(mm);
    const paper_mm = !(n > 0) ? 57 : (n <= 58 ? 57 : (n <= 90 ? 80 : (n <= 120 ? 112 : Math.round(n))));
    savePrinterMeta({ ...loadPrinterMeta(), paper_mm });
    return paper_mm;
  }

  function paperLayout() {
    const mm = getPaperMm();
    if (mm <= 57) {
      return {
        mm: 57,
        bodyMm: 52,
        padLeftMm: 1.2,
        padRightMm: 3.8,
        marginMm: 0,
        fontPx: 10,
        titlePx: 12,
        totPx: 12,
        chars: 32,
        colCant: 4,
        colName: 16,
        colVal: 12,
        colLabel: 20
      };
    }
    if (mm <= 80) {
      return {
        mm: 80,
        bodyMm: 72,
        padLeftMm: 4,
        padRightMm: 4,
        marginMm: 0,
        fontPx: 13,
        titlePx: 16,
        totPx: 15,
        chars: 40,
        colCant: 5,
        colName: 21,
        colVal: 14,
        colLabel: 26
      };
    }
    return {
      mm: mm >= 112 ? 112 : mm,
      bodyMm: (mm >= 112 ? 112 : mm) - 10,
      padLeftMm: 5,
      padRightMm: 5,
      marginMm: 0,
      fontPx: 14,
      titlePx: 17,
      totPx: 16,
      chars: 46,
      colCant: 6,
      colName: 26,
      colVal: 14,
      colLabel: 32
    };
  }

  function sepLine(chars) {
    return '-'.repeat(Math.max(16, Math.min(chars || 32, 64))) + '\n';
  }

  /** Sin cliente registrado → solo "CONSUMIDOR" */
  function clienteFactura(venta) {
    const nombre = String(venta && venta.cliente_nombre || '').trim();
    const cedula = String(venta && venta.cliente_cedula || '').trim();
    const registrado = !!(nombre || cedula);
    return {
      registrado,
      nombre: registrado ? (nombre || 'Cliente') : 'CONSUMIDOR',
      cedula: registrado ? cedula : '',
      telefono: registrado ? String(venta.cliente_telefono || '').trim() : '',
      direccion: registrado ? String(venta.cliente_direccion || '').trim() : ''
    };
  }

  function esPesoItem(it) {
    const u = String((it && it.unidad_medida) || '').toUpperCase();
    return u === 'KILO' || u === 'KG' || u === 'LITRO' || u === 'L' || !!(it && it.fraccion_label) || !!(it && it.monto_bs_venta);
  }

  /** Cantidad con unidad en una sola pieza para que no se parta en la impresión. */
  function formatCantidadImpresion(it) {
    if (esPesoItem(it)) {
      const u = String(it.unidad_medida || '').toUpperCase();
      const isLitro = u === 'LITRO' || u === 'L';
      const qty = Math.max(0, Number(it.cantidad) || 0);
      if (qty < 1) {
        const fraction = String(parseFloat((qty * 1000).toFixed(3)));
        return fraction + (isLitro ? 'ml' : 'g');
      }
      const whole = Math.round(qty);
      const amount = Math.abs(qty - whole) < 1e-9 ? String(whole) : qty.toFixed(3);
      return amount + (isLitro ? 'L' : 'k');
    }
    const c = Number(it && it.cantidad);
    if (!Number.isFinite(c) || c <= 0) return '1';
    return String(Math.max(1, Math.round(c)));
  }

  function nombreItemImpresion(it) {
    let name = String((it && it.nombre) || 'Producto');
    if (it && it.fraccion_label) {
      const suffix = ` (${String(it.fraccion_label).trim()})`;
      if (name.endsWith(suffix)) name = name.slice(0, -suffix.length);
    }
    return name;
  }

  function valorLineaBs(it, tasa) {
    if (it && it.line_bs != null && Number.isFinite(Number(it.line_bs))) {
      return roundBsEntero(it.line_bs);
    }
    if (it && it.monto_bs_venta != null && Number(it.monto_bs_venta) > 0) {
      return roundBsEntero(it.monto_bs_venta);
    }
    const unitBs = Number(it.precio_unitario_bs) > 0 ? roundBsEntero(it.precio_unitario_bs) : 0;
    const qty = Number(it.cantidad) || 0;
    const desc = Number(it.descuento) || 0;
    if (unitBs > 0) {
      return Math.max(0, roundBsEntero(unitBs * qty - (desc * (tasa || 0))));
    }
    const unitUsd = Number(it.precio_unitario) || 0;
    const unitFromUsd = tasa > 0 ? roundBsEntero(unitUsd * tasa) : roundBsEntero(unitUsd);
    return Math.max(0, roundBsEntero(unitFromUsd * qty - (desc * (tasa || 0))));
  }

  /** Construye texto de factura estilo ticket térmico (adaptable 57/80/112 mm) */
  function buildFacturaTexto(venta) {
    const layout = paperLayout();
    const emp = empresaFactura();
    const id = venta.id_venta || '—';
    const fecha = venta.fecha || new Date().toLocaleString('es-VE');
    const cli = clienteFactura(venta);
    const cliente = cli.nombre;
    const cedula = cli.cedula;
    const tipoPago = venta.tipo_pago || 'Efectivo';
    const pagos = Array.isArray(venta.pagos) ? venta.pagos : [];
    const tasa = Number(venta.tasa || 0);
    const items = venta.items || [];
    const totalUsd = Number(venta.total_usd != null ? venta.total_usd : venta.total) || 0;
    const totalBs = roundBsEntero(venta.total_bs != null ? venta.total_bs : (tasa > 0 ? totalUsd * tasa : totalUsd));
    const subUsd = Number(venta.subtotal_usd != null ? venta.subtotal_usd : totalUsd) || 0;
    const subBs = roundBsEntero(venta.subtotal_bs != null ? venta.subtotal_bs : (tasa > 0 ? subUsd * tasa : subUsd));
    const ivaActivo = !!(venta.iva_activo || Number(venta.monto_iva_usd || venta.monto_iva || 0) > 0);
    const ivaPct = Number(venta.iva_porcentaje || 0) || 0;
    const baseUsd = Number(venta.base_neta_usd != null ? venta.base_neta_usd : (totalUsd - Number(venta.monto_iva_usd || 0))) || 0;
    const ivaUsd = Number(venta.monto_iva_usd != null ? venta.monto_iva_usd : venta.monto_iva) || 0;
    const ivaBs = roundBsEntero(venta.monto_iva_bs != null ? venta.monto_iva_bs : (tasa > 0 ? ivaUsd * tasa : ivaUsd));
    const baseBs = roundBsEntero(venta.base_neta_bs != null ? venta.base_neta_bs : (tasa > 0 ? baseUsd * tasa : baseUsd));
    const { chars, colCant, colVal, colLabel } = layout;
    const itemCantWidth = Math.max(colCant, ...items.map((it) => formatCantidadImpresion(it).length));
    const itemNameWidth = Math.max(1, chars - itemCantWidth - colVal);

    const lines = [];
    lines.push(ESC + '@'); // init
    lines.push(ESC + 'E' + '\x01'); // enfatizado (letras más oscuras)
    lines.push(ESC + 'G' + '\x01'); // doble golpe
    lines.push(ESC + 'a' + '\x01'); // center
    lines.push(ESC + '!' + (layout.mm <= 57 ? '\x08' : '\x18')); // bold / double
    lines.push(stripAccents(emp.nombre) + '\n');
    lines.push(ESC + '!' + '\x00');
    lines.push(stripAccents(emp.rif) + '\n');
    lines.push(stripAccents(emp.direccion) + '\n');
    if (emp.telefono) lines.push(stripAccents('Tel: ' + emp.telefono) + '\n');
    lines.push(sepLine(chars));
    lines.push(ESC + 'a' + '\x00'); // left
    lines.push(ESC + '!' + '\x08');
    lines.push(stripAccents('Factura Nro: ' + id) + '\n');
    lines.push(ESC + '!' + '\x00');
    if (venta.es_copia) {
      lines.push(ESC + 'a' + '\x01');
      lines.push(ESC + '!' + '\x08');
      lines.push('*** COPIA ***\n');
      lines.push(ESC + '!' + '\x00');
      lines.push(ESC + 'a' + '\x00');
    }
    lines.push(stripAccents('Fecha: ' + fecha) + '\n');
    lines.push(stripAccents('Cliente: ' + cliente) + '\n');
    if (cli.registrado && cedula) lines.push(stripAccents('C.C / RIF: ' + cedula) + '\n');
    if (cli.telefono) lines.push(stripAccents('Tel: ' + cli.telefono) + '\n');
    if (cli.direccion) lines.push(stripAccents('Dir: ' + cli.direccion) + '\n');
    if (ivaActivo) lines.push(stripAccents('IVA agregado') + '\n');
    lines.push(sepLine(chars));
    lines.push(pad('CT', itemCantWidth) + pad('Descripcion', itemNameWidth) + pad('Valor', colVal, true) + '\n');
    lines.push(sepLine(chars));

    items.forEach((it) => {
      const cant = formatCantidadImpresion(it);
      const name = stripAccents(nombreItemImpresion(it));
      const valor = valorLineaBs(it, tasa);
      lines.push(pad(cant, itemCantWidth) + pad(name, itemNameWidth) + pad(money(valor), colVal, true) + '\n');
    });

    let subBsEsc = 0;
    items.forEach((it) => { subBsEsc += Number(valorLineaBs(it, tasa)) || 0; });
    const subBsPrintEsc = subBsEsc > 0 ? subBsEsc : subBs;
    const totalBsPrintEsc = totalBs || (subBsPrintEsc + (ivaActivo ? ivaBs : 0));
    lines.push(sepLine(chars));
    if (ivaActivo) {
      lines.push(pad('Base imponible', colLabel) + pad(money(baseBs > 0 ? baseBs : subBsPrintEsc), colVal, true) + '\n');
      lines.push(pad('I.V.A.', colLabel) + pad(money(ivaBs), colVal, true) + '\n');
    } else {
      lines.push(pad('SUBTOTAL', colLabel) + pad(money(subBsPrintEsc), colVal, true) + '\n');
    }
    lines.push(ESC + '!' + '\x08');
    lines.push(pad('Total', colLabel) + pad(money(totalBsPrintEsc), colVal, true) + '\n');
    lines.push(ESC + '!' + '\x00');
    lines.push(sepLine(chars));
    lines.push(ESC + 'a' + '\x01');
    lines.push('Forma de Pago\n');
    lines.push(ESC + 'a' + '\x00');
    if (pagos.length) {
      pagos.forEach((p) => {
        const esUsd = (p.moneda === 'usd') || /efectivo\s*\$/i.test(String(p.forma_pago || ''));
        const label = stripAccents(p.forma_pago || 'Pago');
        if (esUsd) {
          const usd = p.recibido_usd != null ? p.recibido_usd : p.monto_usd;
          lines.push(pad(label, colLabel) + pad('$' + moneyUsd(usd), colVal, true) + '\n');
          if (Number(p.cambio_usd || 0) > 0.001) {
            lines.push(pad('  (aplicado)', colLabel) + pad('$' + moneyUsd(p.monto_usd), colVal, true) + '\n');
          }
        } else {
          const bs = p.recibido_bs != null ? p.recibido_bs : p.monto_bs;
          lines.push(pad(label, colLabel) + pad(money(bs), colVal, true) + '\n');
        }
      });
    } else {
      lines.push(pad(stripAccents(tipoPago), colLabel) + pad(money(totalBs), colVal, true) + '\n');
    }
    const cambioUsd = Number(venta.cambio_usd || 0);
    const cambioBs = Number(venta.cambio_bs || 0);
    if (cambioUsd > 0.001) {
      lines.push(pad('Cambio $', colLabel) + pad('$' + moneyUsd(cambioUsd), colVal, true) + '\n');
      if (cambioBs > 0.01) lines.push(pad('Cambio Bs', colLabel) + pad(money(cambioBs), colVal, true) + '\n');
    } else if (cambioBs > 0.01) {
      lines.push(pad('Cambio', colLabel) + pad(money(cambioBs), colVal, true) + '\n');
    } else {
      lines.push(pad('Cambio', colLabel) + pad(money(0), colVal, true) + '\n');
    }
    lines.push(sepLine(chars));
    lines.push(ESC + 'a' + '\x01');
    lines.push(stripAccents(emp.pie) + '\n');
    lines.push('Gracias por su compra\n\n\n');
    lines.push(GS + 'V' + '\x00'); // cut partial
    return lines.join('');
  }

  function buildFacturaHtml(venta) {
    const layout = paperLayout();
    const emp = empresaFactura();
    const id = venta.id_venta || '—';
    const fecha = venta.fecha || new Date().toLocaleString('es-VE');
    const cli = clienteFactura(venta);
    const cliente = cli.nombre;
    const cedula = cli.cedula;
    const tipoPago = venta.tipo_pago || 'Efectivo';
    const pagos = Array.isArray(venta.pagos) ? venta.pagos : [];
    const tasa = Number(venta.tasa || 0);
    const items = venta.items || [];
    const totalUsd = Number(venta.total_usd != null ? venta.total_usd : venta.total) || 0;
    const totalBs = roundBsEntero(venta.total_bs != null ? venta.total_bs : (tasa > 0 ? totalUsd * tasa : totalUsd));
    const subUsd = Number(venta.subtotal_usd != null ? venta.subtotal_usd : totalUsd) || 0;
    const subBs = roundBsEntero(venta.subtotal_bs != null ? venta.subtotal_bs : (tasa > 0 ? subUsd * tasa : subUsd));
    const ivaActivo = !!(venta.iva_activo || Number(venta.monto_iva_usd || venta.monto_iva || 0) > 0);
    const ivaPct = Number(venta.iva_porcentaje || 0) || 0;
    const baseUsd = Number(venta.base_neta_usd != null ? venta.base_neta_usd : (totalUsd - Number(venta.monto_iva_usd || 0))) || 0;
    const ivaUsd = Number(venta.monto_iva_usd != null ? venta.monto_iva_usd : venta.monto_iva) || 0;
    const ivaBs = roundBsEntero(venta.monto_iva_bs != null ? venta.monto_iva_bs : (tasa > 0 ? ivaUsd * tasa : ivaUsd));
    const baseBs = roundBsEntero(venta.base_neta_bs != null ? venta.base_neta_bs : (tasa > 0 ? baseUsd * tasa : baseUsd));

    const itemCantWidth = Math.max(layout.colCant, ...items.map((it) => formatCantidadImpresion(it).length));
    const itemCantPercent = Math.ceil((itemCantWidth / layout.chars) * 100);
    const rows = items.map((it) => {
      const cant = formatCantidadImpresion(it);
      const valor = valorLineaBs(it, tasa);
      return `<tr><td class="ct" style="width:${itemCantPercent}%">${escapeHtml(cant)}</td><td>${escapeHtml(nombreItemImpresion(it))}</td><td class="r">${money(valor)}</td></tr>`;
    }).join('');

    // Recalcular subtotal desde líneas (montos exactos en Bs)
    let subBsCalc = 0;
    items.forEach((it) => { subBsCalc += Number(valorLineaBs(it, tasa)) || 0; });
    const subBsPrint = subBsCalc > 0 ? subBsCalc : subBs;
    const totalBsPrint = totalBs || (subBsPrint + (ivaActivo ? ivaBs : 0));

    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Factura POS-${id}</title>
<style>
  @page { size: ${layout.mm}mm auto; margin: 0; }
  html, body {
    width: ${layout.mm}mm;
    max-width: ${layout.mm}mm;
    margin: 0;
    padding: 0;
    color: #000;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  * {
    box-sizing: border-box;
    color: #000 !important;
    -webkit-text-stroke: 0.28px #000;
    text-rendering: geometricPrecision;
  }
  body {
    font-family: "Courier New", Courier, monospace;
    font-size: ${layout.fontPx}px;
    font-weight: 800;
    width: ${layout.mm}mm;
    max-width: ${layout.mm}mm;
    margin: 0;
    padding: 1mm ${layout.padRightMm}mm 2mm ${layout.padLeftMm}mm;
    line-height: 1.2;
  }
  .c { text-align: center; }
  .b { font-weight: 900; }
  .hr { border-top: 2px solid #000; margin: 3px 0; }
  .dash { border-top: 2px dashed #000; margin: 3px 0; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { text-align: left; padding: 1px 2px 1px 0; vertical-align: top; word-wrap: break-word; overflow-wrap: break-word; font-weight: 800; color: #000; }
  th { font-size: ${Math.max(9, layout.fontPx - 1)}px; border-bottom: 2px solid #000; font-weight: 900; }
  td.ct { width: 12%; white-space: nowrap; overflow: visible; word-break: normal; overflow-wrap: normal; }
  .r { text-align: right; white-space: nowrap; overflow: visible; padding-right: 1px; }
  .tot { font-size: ${layout.totPx}px; font-weight: 900; }
  .title { font-size: ${layout.titlePx}px; font-weight: 900; line-height: 1.15; word-break: break-word; }
</style></head><body>
  <div class="c title">${escapeHtml(emp.nombre)}</div>
  <div class="c">${escapeHtml(emp.rif)}</div>
  <div class="c">${escapeHtml(emp.direccion)}</div>
  ${emp.telefono ? `<div class="c">Tel: ${escapeHtml(emp.telefono)}</div>` : ''}
  <div class="hr"></div>
  <div class="b">Factura Nro: ${escapeHtml(String(id))}</div>
  ${venta.es_copia ? '<div class="c b">*** COPIA ***</div>' : ''}
  <div>Fecha: ${escapeHtml(fecha)}</div>
  <div>Cliente: ${escapeHtml(cliente)}</div>
  ${cli.registrado && cedula ? `<div>C.C / RIF: ${escapeHtml(cedula)}</div>` : ''}
  ${cli.telefono ? `<div>Tel: ${escapeHtml(cli.telefono)}</div>` : ''}
  ${cli.direccion ? `<div>Dir: ${escapeHtml(cli.direccion)}</div>` : ''}
  ${ivaActivo ? `<div class="b">IVA agregado</div>` : ''}
  <div class="hr"></div>
  <table>
    <thead><tr><th style="width:${itemCantPercent}%">CT</th><th>Descripción</th><th class="r" style="width:34%">Valor</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="dash"></div>
  <table>
    ${ivaActivo
      ? `<tr><td>Base imponible</td><td class="r">${money(baseBs > 0 ? baseBs : subBsPrint)}</td></tr>
         <tr><td>I.V.A.</td><td class="r">${money(ivaBs)}</td></tr>`
      : `<tr><td>SUBTOTAL</td><td class="r">${money(subBsPrint)}</td></tr>`}
    <tr class="tot"><td>Total</td><td class="r">${money(totalBsPrint)}</td></tr>
  </table>
  <div class="hr"></div>
  <div class="c">Forma de Pago</div>
  <table>
    ${pagos.length
      ? pagos.map((p) => {
          const esUsd = (p.moneda === 'usd') || /efectivo\s*\$/i.test(String(p.forma_pago || ''));
          if (esUsd) {
            const usd = p.recibido_usd != null ? p.recibido_usd : p.monto_usd;
            return `<tr><td>${escapeHtml(p.forma_pago || 'Pago')}</td><td class="r">$${moneyUsd(usd)}</td></tr>`;
          }
          const bs = p.recibido_bs != null ? p.recibido_bs : p.monto_bs;
          return `<tr><td>${escapeHtml(p.forma_pago || 'Pago')}</td><td class="r">${money(bs)}</td></tr>`;
        }).join('')
      : `<tr><td>${escapeHtml(tipoPago)}</td><td class="r">${money(totalBs)}</td></tr>`}
    ${(() => {
      const cUsd = Number(venta.cambio_usd || 0);
      const cBs = Number(venta.cambio_bs || 0);
      if (cUsd > 0.001) {
        return `<tr><td class="b">Cambio a devolver</td><td class="r b">$${moneyUsd(cUsd)}</td></tr>`
          + (cBs > 0.01 ? `<tr><td>Equiv. Bs</td><td class="r">${money(cBs)}</td></tr>` : '');
      }
      if (cBs > 0.01) return `<tr><td class="b">Cambio a devolver</td><td class="r b">${money(cBs)}</td></tr>`;
      return `<tr><td class="b">Cambio</td><td class="r b">0</td></tr>`;
    })()}
  </table>
  <div class="hr"></div>
  <div class="c">${escapeHtml(emp.pie)}</div>
  <div class="c">Gracias por su compra</div>
</body></html>`;
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function textToBytes(text) {
    const arr = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) arr[i] = text.charCodeAt(i) & 0xff;
    return arr;
  }

  async function tryOpenSerialPort(port) {
    await port.open({ baudRate: 9600 });
    // Some printers need 115200; if open works at 9600 it's "connected"
    return true;
  }

  async function writeSerial(port, bytes) {
    const writer = port.writable.getWriter();
    try {
      await writer.write(bytes);
    } finally {
      writer.releaseLock();
    }
  }

  async function findUsbOutEndpoint(device) {
    const iface = device.configuration.interfaces.find((i) =>
      i.alternate.endpoints.some((e) => e.direction === 'out')
    );
    if (!iface) throw new Error('Sin endpoint USB de salida');
    const endpoint = iface.alternate.endpoints.find((e) => e.direction === 'out');
    return { interfaceNumber: iface.interfaceNumber, endpointNumber: endpoint.endpointNumber };
  }

  async function writeUsb(device, bytes) {
    if (!device.opened) await device.open();
    if (!device.configuration) await device.selectConfiguration(1);
    const { interfaceNumber, endpointNumber } = await findUsbOutEndpoint(device);
    try {
      await device.claimInterface(interfaceNumber);
    } catch (_) {
      // ya reclamada
    }
    const chunk = 64;
    for (let i = 0; i < bytes.length; i += chunk) {
      await device.transferOut(endpointNumber, bytes.subarray(i, i + chunk));
    }
  }

  /**
   * Detección REAL:
   * 1) Web Serial / WebUSB autorizados
   * 2) Impresoras Windows del equipo del servidor (WMI) si la caja usa ese mismo PC o modo windows
   * 3) Modo windows activado manualmente en esta caja (impresión por diálogo del navegador local)
   */
  async function detectarImpresoraWindowsApi() {
    try {
      const res = await fetch('/api/caja/impresora/estado', { credentials: 'include' });
      if (!res.ok) return null;
      const j = await res.json();
      if (j && j.conectada) {
        return {
          conectada: true,
          tipo: 'windows',
          detalle: j.detalle || j.predeterminada || 'Impresora Windows',
          impresoras: j.impresoras || []
        };
      }
      return { conectada: false, tipo: 'windows', detalle: j && j.detalle, impresoras: j && j.impresoras };
    } catch (_) {
      return null;
    }
  }

  async function detectarImpresora() {
    const meta = loadPrinterMeta();
    const host = (location.hostname || '').toLowerCase();
    const mismoEquipo = host === 'localhost' || host === '127.0.0.1' || host === '::1';

    async function detectarSerial() {
      if (!navigator.serial || typeof navigator.serial.getPorts !== 'function') return null;
      try {
        const ports = await navigator.serial.getPorts();
        for (const port of ports) {
          try {
            if (!port.readable && !port.writable) await tryOpenSerialPort(port);
            _serialPort = port;
            _usbDevice = null;
            return { conectada: true, tipo: 'serial', detalle: 'Puerto serial listo' };
          } catch (e) {
            try { await port.close(); } catch (_) {}
          }
        }
      } catch (e) {
        console.warn('[impresora] serial getPorts:', e);
      }
      return null;
    }

    async function detectarUsb() {
      if (!navigator.usb || typeof navigator.usb.getDevices !== 'function') return null;
      try {
        const devices = await navigator.usb.getDevices();
        for (const device of devices) {
          try {
            if (!device.opened) await device.open();
            if (!device.configuration) await device.selectConfiguration(1);
            await findUsbOutEndpoint(device);
            _usbDevice = device;
            _serialPort = null;
            return { conectada: true, tipo: 'usb', detalle: device.productName || 'USB' };
          } catch (e) {
            try { if (device.opened) await device.close(); } catch (_) {}
          }
        }
      } catch (e) {
        console.warn('[impresora] usb getDevices:', e);
      }
      return null;
    }

    async function detectarWindows() {
      const win = await detectarImpresoraWindowsApi();
      if (win && win.conectada) {
        savePrinterMeta({ ...meta, tipo: 'windows', connectedAt: Date.now(), nombre: win.detalle });
        _serialPort = null;
        _usbDevice = null;
        return win;
      }
      if (!mismoEquipo && meta.windowsOptIn) {
        _serialPort = null;
        _usbDevice = null;
        return {
          conectada: true,
          tipo: 'windows',
          detalle: meta.nombre || 'Impresora Windows (navegador)'
        };
      }
      _serialPort = null;
      _usbDevice = null;
      return {
        conectada: false,
        tipo: 'windows',
        detalle: win && win.detalle ? win.detalle : 'No hay impresora Windows conectada'
      };
    }

    // Respetar el modo elegido: enviar ESC/POS a un puerto equivocado puede
    // hacer que la impresora imprima los comandos como texto ilegible.
    if (meta.tipo === 'windows') return detectarWindows();
    if (meta.tipo === 'serial' && meta.windowsOptIn === false) {
      const serial = await detectarSerial();
      if (serial) return serial;
      _serialPort = null;
      _usbDevice = null;
      return { conectada: false, tipo: 'serial', detalle: 'No hay un puerto serial autorizado' };
    }
    if (meta.tipo === 'usb' && meta.windowsOptIn === false) {
      const usb = await detectarUsb();
      if (usb) return usb;
      _serialPort = null;
      _usbDevice = null;
      return { conectada: false, tipo: 'usb', detalle: 'No hay una impresora USB autorizada' };
    }

    // En el setup de escritorio, preferir el driver de Windows antes de
    // puertos autorizados automáticamente en versiones anteriores.
    if (global.maxDesktop) {
      const win = await detectarWindows();
      if (win.conectada) return win;
    }

    // 1) Web Serial
    const serial = await detectarSerial();
    if (serial) {
      savePrinterMeta({ ...meta, tipo: 'serial', connectedAt: Date.now() });
      return serial;
    }

    // 2) WebUSB
    const usb = await detectarUsb();
    if (usb) {
      savePrinterMeta({ ...meta, tipo: 'usb', connectedAt: Date.now() });
      return usb;
    }

    // 3) WMI Windows en el servidor (válido si caja y servidor están en el mismo PC)
    if (mismoEquipo && !global.maxDesktop) {
      const win = await detectarWindows();
      if (win.conectada) return win;
    }

    _serialPort = null;
    _usbDevice = null;
    return { conectada: false, detalle: 'No hay impresora térmica autorizada o conectada' };
  }

  /** Pedir al usuario seleccionar impresora (requiere gesto: clic). */
  async function conectarImpresora(modoPreferido) {
    const modo = modoPreferido || (await elegirModoConexion());
    if (!modo) return { ok: false, error: 'Conexión cancelada' };

    if (modo === 'windows') {
      const host = (location.hostname || '').toLowerCase();
      const mismoEquipo = host === 'localhost' || host === '127.0.0.1' || host === '::1';
      if (mismoEquipo) {
        const win = await detectarImpresoraWindowsApi();
        if (!win || !win.conectada) {
          return {
            ok: false,
            error: 'No es posible: no se detectó ninguna impresora Windows conectada/lista en este equipo.'
          };
        }
        savePrinterMeta({
          ...loadPrinterMeta(),
          tipo: 'windows',
          windowsOptIn: true,
          connectedAt: Date.now(),
          nombre: win.predeterminada || win.detalle
        });
        return { ok: true, tipo: 'windows', detalle: win.detalle };
      }
      // Caja remota: el navegador imprimirá en las impresoras de ESTA PC
      savePrinterMeta({
        ...loadPrinterMeta(),
        tipo: 'windows',
        windowsOptIn: true,
        connectedAt: Date.now(),
        nombre: 'Impresora Windows local'
      });
      return { ok: true, tipo: 'windows', detalle: 'Modo Windows activado en esta caja' };
    }

    // Serial
    if (modo === 'serial' && navigator.serial && navigator.serial.requestPort) {
      try {
        const port = await navigator.serial.requestPort();
        await tryOpenSerialPort(port);
        _serialPort = port;
        _usbDevice = null;
        savePrinterMeta({ ...loadPrinterMeta(), tipo: 'serial', windowsOptIn: false, connectedAt: Date.now() });
        return { ok: true, tipo: 'serial' };
      } catch (e) {
        if (e && e.name !== 'NotFoundError') console.warn('[impresora] requestPort:', e);
        return { ok: false, error: e.message || 'No se autorizó el puerto serial' };
      }
    }

    // USB
    if (modo === 'usb' && navigator.usb && navigator.usb.requestDevice) {
      try {
        let device;
        try {
          device = await navigator.usb.requestDevice({
            filters: [
              { classCode: 7 },
              { vendorId: 0x04b8 },
              { vendorId: 0x0519 },
              { vendorId: 0x0fe6 },
              { vendorId: 0x0483 },
              { vendorId: 0x1fc9 }
            ]
          });
        } catch (_) {
          device = await navigator.usb.requestDevice({ filters: [] });
        }
        await device.open();
        if (!device.configuration) await device.selectConfiguration(1);
        await findUsbOutEndpoint(device);
        _usbDevice = device;
        _serialPort = null;
        savePrinterMeta({ ...loadPrinterMeta(), tipo: 'usb', windowsOptIn: false, connectedAt: Date.now() });
        return { ok: true, tipo: 'usb' };
      } catch (e) {
        if (e && e.name !== 'NotFoundError') console.warn('[impresora] requestDevice:', e);
        return { ok: false, error: e.message || 'No se autorizó el dispositivo USB' };
      }
    }

    return {
      ok: false,
      error: 'No se pudo conectar. Use Chrome/Edge y una impresora USB/serial o el modo Windows.'
    };
  }

  function syncPaperSelect() {
    const sel = document.getElementById('posPrinterPaperMm');
    if (!sel) return;
    const mm = String(getPaperMm());
    if ([...sel.options].some((o) => o.value === mm)) sel.value = mm;
    else sel.value = '57';
  }

  function savePaperFromSelect() {
    const sel = document.getElementById('posPrinterPaperMm');
    if (sel) setPaperMm(sel.value);
  }

  function elegirModoConexion() {
    return new Promise(async (resolve) => {
      const modal = document.getElementById('posPrinterModal');
      if (!modal) {
        // fallback prompts (sin confirm nativo: congela teclado en Electron)
        const usarWin = await maxConfirm('¿Usar impresora de Windows (recomendada si ya está instalada)?\n\nAceptar = Windows\nCancelar = USB/Serial Chrome', { title: 'Impresora', okText: 'Windows', cancelText: 'Otra' });
        if (usarWin) return resolve('windows');
        const usarUsb = await maxConfirm('¿Conectar por USB (WebUSB)?\n\nAceptar = USB\nCancelar = Puerto Serial (COM)', { title: 'Impresora', okText: 'USB', cancelText: 'Serial' });
        return resolve(usarUsb ? 'usb' : 'serial');
      }
      syncPaperSelect();
      modal.style.display = 'flex';
      const close = (modo) => {
        savePaperFromSelect();
        modal.style.display = 'none';
        resolve(modo);
      };
      const btnWin = document.getElementById('posPrinterWin');
      const btnSerial = document.getElementById('posPrinterSerial');
      const btnUsb = document.getElementById('posPrinterUsb');
      const btnCancel = document.getElementById('posPrinterCancel');
      const once = (el, modo) => {
        if (!el) return;
        el.onclick = () => close(modo);
      };
      once(btnWin, 'windows');
      once(btnSerial, 'serial');
      once(btnUsb, 'usb');
      once(btnCancel, null);
    });
  }

  async function enviarEscPos(bytes) {
    if (_serialPort && _serialPort.writable) {
      await writeSerial(_serialPort, bytes);
      return { ok: true, tipo: 'serial' };
    }
    if (_usbDevice) {
      await writeUsb(_usbDevice, bytes);
      return { ok: true, tipo: 'usb' };
    }
    const det = await detectarImpresora();
    if (!det.conectada) return { ok: false, error: det.detalle };
    if (det.tipo === 'windows') return { ok: false, error: 'modo-windows', tipo: 'windows' };
    if (_serialPort && _serialPort.writable) {
      await writeSerial(_serialPort, bytes);
      return { ok: true, tipo: 'serial' };
    }
    if (_usbDevice) {
      await writeUsb(_usbDevice, bytes);
      return { ok: true, tipo: 'usb' };
    }
    return { ok: false, error: 'Impresora no disponible para escribir' };
  }

  async function imprimirViaNavegador(html, opts = {}) {
    const silent = !!opts.silent;
    // En MAX escritorio: impresión silenciosa a la impresora predeterminada (sin diálogo)
    if (silent && global.maxDesktop && typeof global.maxDesktop.printHtmlSilent === 'function') {
      try {
        const r = await global.maxDesktop.printHtmlSilent(html);
        if (r && r.ok) return { ok: true, tipo: 'electron-silent' };
        return {
          ok: false,
          tipo: 'electron-silent',
          error: (r && r.error) || 'La impresora predeterminada no pudo completar el trabajo'
        };
      } catch (e) {
        console.error('[impresora] Falló la impresión en MAX escritorio:', e);
        return { ok: false, tipo: 'electron-silent', error: e.message || 'Falló la impresión en MAX escritorio' };
      }
    }

    return new Promise((resolve) => {
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
      iframe.setAttribute('aria-hidden', 'true');
      document.body.appendChild(iframe);
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      doc.open();
      doc.write(html);
      doc.close();

      let done = false;
      const finish = (ok, reason) => {
        if (done) return;
        done = true;
        setTimeout(() => { try { iframe.remove(); } catch (_) {} }, 800);
        resolve({ ok, tipo: 'navegador', error: reason });
      };

      const win = iframe.contentWindow;
      win.onafterprint = () => finish(true);
      setTimeout(() => {
        try {
          win.focus();
          win.print();
          setTimeout(() => finish(true), 1500);
        } catch (e) {
          finish(false, e.message || 'No se pudo abrir la impresión del sistema');
        }
      }, 250);
    });
  }

  function imprimirViaDialogo(html) {
    return new Promise((resolve) => {
      let frame = document.getElementById('maxPrintFrame');
      if (frame) frame.remove();
      frame = document.createElement('iframe');
      frame.id = 'maxPrintFrame';
      frame.setAttribute('aria-hidden', 'true');
      frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;';
      document.body.appendChild(frame);

      const doc = frame.contentDocument || (frame.contentWindow && frame.contentWindow.document);
      if (!doc) {
        frame.remove();
        resolve({ ok: false, error: 'No se pudo preparar la ventana de impresión.' });
        return;
      }

      let settled = false;
      const finish = (ok, error) => {
        if (settled) return;
        settled = true;
        setTimeout(() => { try { frame.remove(); } catch (_) {} }, 800);
        resolve({ ok, tipo: 'dialogo-impresion', error: error || null });
      };

      try {
        doc.open();
        doc.write(String(html || ''));
        doc.close();
        const printWindow = frame.contentWindow;
        printWindow.onafterprint = () => finish(true);
        setTimeout(() => {
          try {
            printWindow.focus();
            printWindow.print();
            setTimeout(() => finish(true), 1500);
          } catch (e) {
            finish(false, e.message || 'No se pudo abrir el diálogo de impresión.');
          }
        }, 300);
      } catch (e) {
        finish(false, e.message || 'No se pudo preparar el diálogo de impresión.');
      }
    });
  }

  async function imprimirFacturaHistorial(venta) {
    try {
      return await imprimirViaDialogo(buildFacturaHtml(venta));
    } catch (e) {
      console.error('[impresora] Error al reimprimir desde historial:', e);
      return { ok: false, error: e.message || 'No se pudo abrir la impresión de la factura.' };
    }
  }

  /**
   * Imprime factura tras una venta.
   * @returns {Promise<{ok:boolean, mensaje:string, tipo?:string}>}
   */
  async function imprimirFacturaVenta(venta) {
    try {
      // Usar siempre el driver de impresión: un puerto USB/serial puede
      // aceptar ESC/POS y aun así imprimir sus bytes como caracteres ilegibles.
      const nav = await imprimirViaNavegador(buildFacturaHtml(venta), { silent: true });
      if (nav.ok) {
        return { ok: true, mensaje: venta && venta.es_copia ? 'Copia impresa' : 'Ya impresa', tipo: nav.tipo || 'windows' };
      }
      return {
        ok: false,
        mensaje: venta && venta.es_copia ? 'No se pudo imprimir la copia de la factura' : 'No es posible la impresión de la factura',
        error: nav.error || 'El controlador de impresión no completó el trabajo'
      };
    } catch (e) {
      console.error('[impresora] Error enviando factura al controlador:', e);
      return {
        ok: false,
        mensaje: venta && venta.es_copia ? 'No se pudo imprimir la copia de la factura' : 'No es posible la impresión de la factura',
        error: e.message || 'El controlador de impresión no completó el trabajo'
      };
    }
  }

  function imprimirTicketHtml(html) {
    return imprimirViaDialogo(String(html || ''));
  }

  function actualizarUiImpresora(estado) {
    const chip = document.getElementById('posPrinterStatus');
    if (!chip) return;
    if (estado && estado.conectada) {
      chip.textContent = 'Impresora OK';
      chip.classList.add('ok');
      chip.classList.remove('off');
      chip.title = estado.detalle || estado.tipo || 'Conectada';
    } else {
      chip.textContent = 'Sin impresora';
      chip.classList.add('off');
      chip.classList.remove('ok');
      chip.title = 'Pulsa Impresora para conectar (Windows / USB / Serial)';
    }
  }

  async function refreshPrinterStatus() {
    const det = await detectarImpresora();
    actualizarUiImpresora(det);
    return det;
  }

  global.MaxImpresora = {
    detectarImpresora,
    conectarImpresora,
    imprimirFacturaVenta,
    imprimirFacturaHistorial,
    imprimirTicketHtml,
    buildFacturaHtml,
    refreshPrinterStatus,
    empresaFactura,
    savePrinterMeta,
    loadPrinterMeta,
    getPaperMm,
    setPaperMm,
    paperLayout
  };
})(typeof window !== 'undefined' ? window : globalThis);
