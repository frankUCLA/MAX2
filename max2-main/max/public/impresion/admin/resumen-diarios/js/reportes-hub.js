/**
 * MAX — Centro de reportes (hub)
 */
(function () {
  const REPORTS = [
    { id: 'ventas-mes', title: 'Ventas del mes', desc: 'Totales mensuales de ventas', icon: '💰', color: '#2563eb', accounting: true },
    { id: 'compras', title: 'Compras a proveedores', desc: 'Historial y estados de pago', icon: '🛒', color: '#dc2626', accounting: true },
    { id: 'compras-mes', title: 'Compras mensuales', desc: 'Totales de compras por mes', icon: '🧾', color: '#ea580c', accounting: true },
    { id: 'utilidad', title: 'Utilidad por producto', desc: 'Margen y utilidad unitaria', icon: '💵', color: '#7c3aed', accounting: true },
    { id: 'ganancias', title: 'Ganancias', desc: 'Ingresos, costos y utilidad neta', icon: '📈', color: '#d97706', accounting: true },
    { id: 'inventario', title: 'Inventario actual', desc: 'Stock disponible por producto', icon: '📦', color: '#2563eb' },
    { id: 'rotacion', title: 'Rotación de inventario', desc: 'Qué se mueve y qué no', icon: '🔄', color: '#0891b2' },
    { id: 'lento', title: 'Inventario lento', desc: 'Sin venta en 90 días o más', icon: '🐢', color: '#64748b' },
    { id: 'clientes', title: 'Top clientes', desc: 'Clientes que más compran', icon: '👥', color: '#db2777' },
    { id: 'categorias', title: 'Margen por categoría', desc: 'Rentabilidad por rubro', icon: '🏷️', color: '#059669', accounting: true },
    { id: 'tendencias', title: 'Tendencias por categoría', desc: 'Ventas por categoría (12 meses)', icon: '📊', color: '#4f46e5', accounting: true },
    { id: 'tipos-pago', title: 'Tipos de pago', desc: 'Desglose mensual por forma de cobro', icon: '💳', color: '#1d4ed8', accounting: true },
    { id: 'tipos-pago-dia', title: 'Resumen diario por forma de pago', desc: 'Cobros de hoy por forma de pago', icon: '🧾', color: '#0f766e', accounting: true }
  ];
  let dailyPaymentReport = null;

  function money(n) {
    return Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /** Cantidades: 34 no 34.000 */
  function qty(n, digits = 3) {
    if (n == null || n === '') return '—';
    const v = Number(String(n).trim().replace(',', '.'));
    if (!Number.isFinite(v)) return String(n);
    if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v));
    return String(parseFloat(v.toFixed(digits)));
  }

  function fmtDate(v) {
    if (!v) return 'Sin ventas';
    try {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return String(v);
      return d.toLocaleDateString('es-VE');
    } catch (_) {
      return String(v);
    }
  }

  function tableHtml(headers, rows) {
    if (!rows.length) return '<div class="rpt-empty">Sin datos para mostrar</div>';
    return `<div class="rpt-table-wrap"><table class="rpt-table"><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  }

  function setReportActions(visible, filename, reportId) {
    const actions = document.getElementById('reporteHubActions');
    if (actions) {
      actions.classList.toggle('is-visible', !!visible);
      actions.style.display = visible ? '' : 'none';
      if (visible) actions.removeAttribute('hidden');
      else actions.setAttribute('hidden', '');
    }
    window._rptHubExportName = filename || 'reporte_max';
    const isDailyPayments = !!visible && reportId === 'tipos-pago-dia';
    document.querySelectorAll('.daily-payment-action').forEach(button => {
      button.hidden = !isDailyPayments;
    });
    document.querySelectorAll('.default-report-action').forEach(button => {
      button.hidden = isDailyPayments;
    });
  }

  function wrapExport(html, title) {
    return `<div id="reporteHubExport" class="rpt-export-root">
      <div class="rpt-export-head">
        <div class="rpt-export-brand">MAX</div>
        <h3 class="rpt-export-title">${title || 'Reporte'}</h3>
        <div class="rpt-export-date">${new Date().toLocaleString('es-VE')}</div>
      </div>
      ${html}
    </div>`;
  }

  function exportHubPdf() {
    const el = document.getElementById('reporteHubExport') || document.getElementById('reporteHubBody');
    if (!el) {
      alert('No hay reporte para exportar');
      return;
    }
    if (typeof html2pdf !== 'function') {
      alert('No está disponible el generador de PDF. Recarga la página.');
      return;
    }
    const name = (window._rptHubExportName || 'reporte_max') + '_' + new Date().toISOString().slice(0, 10) + '.pdf';
    html2pdf().set({
      margin: 10,
      filename: name,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { orientation: 'portrait', unit: 'mm', format: 'a4' }
    }).from(el).save();
  }

  function exportDailyPaymentPdf() {
    const el = document.getElementById('reporteHubExport');
    if (!el || !dailyPaymentReport) {
      alert('No hay resumen diario para exportar');
      return;
    }
    if (typeof html2pdf !== 'function') {
      alert('No está disponible el generador de PDF. Recarga la página.');
      return;
    }
    html2pdf().set({
      margin: 10,
      filename: `resumen_forma_pago_${dailyPaymentReport.date}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { orientation: 'portrait', unit: 'mm', format: 'letter' }
    }).from(el).save();
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[char]);
  }

  function printDailyPaymentThermal(widthMm) {
    if (!dailyPaymentReport) {
      alert('No hay resumen diario para imprimir');
      return;
    }
    const w = window.open('', '_blank', 'width=420,height=700');
    if (!w) {
      alert('Permite ventanas emergentes para imprimir');
      return;
    }
    const { date, rows, totals } = dailyPaymentReport;
    const content = rows.map(row => `
      <section class="payment">
        <strong>${escapeHtml(row.forma_pago || 'Sin forma')}</strong>
        <div>${qty(row.operaciones)} operación(es) · ${qty(row.ventas)} venta(s)</div>
        <div>USD $${money(row.total_usd)} · Bs ${money(row.total_bs)}</div>
      </section>
    `).join('');
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Resumen diario de pagos</title>
      <style>
        @page{size:${widthMm}mm auto;margin:0}
        *{box-sizing:border-box}
        body{width:${widthMm === 57 ? 52 : 74}mm;margin:0 auto;padding:3mm 1mm;color:#111;font:10px/1.35 Arial,sans-serif}
        h1{font-size:14px;text-align:center;margin:0 0 3px}
        .date{text-align:center;margin-bottom:8px}
        .payment{padding:5px 0;border-bottom:1px dashed #888;overflow-wrap:anywhere}
        .payment strong{font-size:11px}
        .total{margin-top:8px;padding-top:6px;border-top:1px solid #111;font-weight:bold}
        .total div{display:flex;justify-content:space-between;gap:4px}
        .empty{text-align:center;padding:12px 0}
        footer{text-align:center;margin-top:8px;font-size:9px}
      </style></head><body>
        <h1>Resumen por forma de pago</h1>
        <div class="date">${escapeHtml(date)}</div>
        ${content || '<div class="empty">Sin pagos registrados</div>'}
        <div class="total">
          <div><span>Total USD</span><span>$${money(totals.total_usd)}</span></div>
          <div><span>Total Bs</span><span>${money(totals.total_bs)}</span></div>
        </div>
        <footer>Generado ${escapeHtml(new Date().toLocaleString('es-VE'))}</footer>
      </body></html>`);
    w.document.close();
    setTimeout(() => {
      try { w.focus(); w.print(); } catch (_) {}
    }, 300);
  }

  function printHub() {
    const el = document.getElementById('reporteHubExport') || document.getElementById('reporteHubBody');
    if (!el) {
      alert('No hay reporte para imprimir');
      return;
    }
    const w = window.open('', '_blank', 'noopener,noreferrer,width=900,height=700');
    if (!w) {
      alert('Permite ventanas emergentes para imprimir');
      return;
    }
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Reporte MAX</title>
      <style>
        body{font-family:Arial,sans-serif;padding:16px;color:#111}
        table{width:100%;border-collapse:collapse;font-size:12px}
        th,td{border:1px solid #ddd;padding:6px 8px;text-align:left}
        th{background:#f3f4f6}
        .r{text-align:right}
        .rpt-kpis{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0}
        .rpt-kpi{border:1px solid #e5e7eb;padding:10px 14px;border-radius:8px;min-width:120px}
        .rpt-export-brand{font-weight:800;letter-spacing:.08em}
        .rpt-export-title{margin:4px 0}
        .rpt-export-date{color:#666;font-size:12px;margin-bottom:12px}
      </style></head><body>${el.innerHTML}</body></html>`);
    w.document.close();
    setTimeout(() => { try { w.focus(); w.print(); } catch (_) {} }, 300);
  }

  function exportHubCsv() {
    const root = document.getElementById('reporteHubExport') || document.getElementById('reporteHubBody');
    if (!root) {
      alert('No hay reporte para exportar');
      return;
    }
    const table = root.querySelector('table');
    if (!table) {
      alert('Este reporte no tiene tabla descargable en CSV');
      return;
    }
    const lines = [];
    table.querySelectorAll('tr').forEach((tr) => {
      const cells = [...tr.querySelectorAll('th,td')].map((td) => {
        const t = String(td.textContent || '').trim().replace(/"/g, '""');
        return `"${t}"`;
      });
      if (cells.length) lines.push(cells.join(','));
    });
    if (!lines.length) {
      alert('No hay filas para exportar');
      return;
    }
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (window._rptHubExportName || 'reporte_max') + '_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function bindHeaderActionsOnce() {
    const pdfBtn = document.getElementById('rptHubPdfBtn');
    const csvBtn = document.getElementById('rptHubCsvBtn');
    const printBtn = document.getElementById('rptHubPrintBtn');
    if (pdfBtn && !pdfBtn.dataset.bound) {
      pdfBtn.dataset.bound = '1';
      pdfBtn.addEventListener('click', exportHubPdf);
    }
    if (csvBtn && !csvBtn.dataset.bound) {
      csvBtn.dataset.bound = '1';
      csvBtn.addEventListener('click', exportHubCsv);
    }
    if (printBtn && !printBtn.dataset.bound) {
      printBtn.dataset.bound = '1';
      printBtn.addEventListener('click', printHub);
    }
    const dailyPdfBtn = document.getElementById('rptHubPaymentPdfBtn');
    if (dailyPdfBtn && !dailyPdfBtn.dataset.bound) {
      dailyPdfBtn.dataset.bound = '1';
      dailyPdfBtn.addEventListener('click', exportDailyPaymentPdf);
    }
    const dailyPrint57Btn = document.getElementById('rptHubPaymentPrint57Btn');
    if (dailyPrint57Btn && !dailyPrint57Btn.dataset.bound) {
      dailyPrint57Btn.dataset.bound = '1';
      dailyPrint57Btn.addEventListener('click', () => printDailyPaymentThermal(57));
    }
    const dailyPrint80Btn = document.getElementById('rptHubPaymentPrint80Btn');
    if (dailyPrint80Btn && !dailyPrint80Btn.dataset.bound) {
      dailyPrint80Btn.dataset.bound = '1';
      dailyPrint80Btn.addEventListener('click', () => printDailyPaymentThermal(80));
    }
  }

  async function getJson(url) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error('Error ' + res.status);
    return res.json();
  }

  function asList(data, ...keys) {
    for (const k of keys) {
      if (Array.isArray(data[k])) return data[k];
    }
    if (Array.isArray(data)) return data;
    return [];
  }

  async function loadReport(id) {
    const body = document.getElementById('reporteHubBody');
    const title = document.getElementById('reporteHubTitle');
    if (!body) return;
    const meta = REPORTS.find(r => r.id === id);
    if (meta && meta.accounting && !window.maxSetupFeatureEnabled('accountingReports')) {
      body.innerHTML = '<div class="rpt-empty">Este reporte no está disponible en esta edición.</div>';
      setReportActions(false);
      return;
    }
    bindHeaderActionsOnce();
    if (title) title.textContent = meta ? meta.title : 'Reporte';
    setReportActions(false);
    body.innerHTML = '<div class="rpt-empty">Cargando…</div>';

    const show = (innerHtml) => {
      body.innerHTML = wrapExport(innerHtml, meta ? meta.title : 'Reporte');
      setReportActions(true, 'reporte_' + (id || 'max').replace(/-/g, '_'), id);
    };

    try {
      if (id === 'compras') {
        body.innerHTML = wrapExport('<div id="reporteCompras" class="list"></div>', meta ? meta.title : 'Compras');
        setReportActions(true, 'reporte_compras');
        if (typeof window.renderReporteCompras === 'function') {
          await window.renderReporteCompras();
        } else {
          body.innerHTML = '<div class="rpt-empty">Módulo de compras no disponible</div>';
          setReportActions(false);
        }
        return;
      }

      if (id === 'utilidad') {
        const data = await getJson('/api/reportes/utilidad-productos');
        const arr = asList(data, 'utilidad', 'productos');
        const rows = arr.slice(0, 150).map(p =>
          `<tr>
            <td>${p.nombre || '—'}</td>
            <td class="r">$${money(p.precio_venta)}</td>
            <td class="r">$${money(p.costo_promedio)}</td>
            <td class="r">$${money(p.utilidad_unitaria)}</td>
            <td class="r">$${money(p.utilidad_total)}</td>
            <td class="r">${money(p.margen_porcentaje || p.margen_ganancia)}%</td>
          </tr>`
        );
        show(tableHtml(['Producto', 'Precio', 'Costo', 'Utilidad und.', 'Utilidad total', 'Margen'], rows));
        return;
      }

      if (id === 'ganancias') {
        const data = await getJson('/api/reportes/ganancias');
        const g = data.resumen || {};
        const periodo = data.periodo || {};
        const dias = asList(data, 'desglose_por_dia');
        const dayRows = dias.map(d =>
          `<tr>
            <td>${d.fecha || '—'}</td>
            <td class="r">$${money(d.ingresos)}</td>
            <td class="r">$${money(d.costos)}</td>
            <td class="r">$${money(d.ganancia)}</td>
            <td class="r">${qty(d.ventas || 0)}</td>
          </tr>`
        );
        show(`
          <p class="rpt-period">Periodo: ${periodo.inicio || '—'} → ${periodo.fin || '—'}</p>
          <div class="rpt-kpis">
            <div class="rpt-kpi"><span>Ingresos</span><strong>$${money(g.total_ingresos)}</strong></div>
            <div class="rpt-kpi"><span>Costos (compras)</span><strong>$${money(g.total_costos)}</strong></div>
            <div class="rpt-kpi"><span>Ganancia neta</span><strong>$${money(g.ganancia_neta)}</strong></div>
            <div class="rpt-kpi"><span>Margen</span><strong>${money(g.margen_ganancia)}%</strong></div>
          </div>
          <h4 class="rpt-subtitle">Desglose diario</h4>
          ${tableHtml(['Fecha', 'Ingresos', 'Costos', 'Ganancia', 'Nº ventas'], dayRows)}`);
        return;
      }

      if (id === 'inventario') {
        const data = await getJson('/api/reportes/inventario-actual');
        const arr = asList(data, 'rows', 'inventario', 'productos');
        let totalStock = 0;
        const rows = arr.map(p => {
          const stock = p.stock_total != null ? p.stock_total : p.inventario;
          totalStock += Number(stock) || 0;
          const unit = String(p.unidad_medida || '').toUpperCase();
          const precision = ['KILO', 'KG', 'LITRO', 'L'].includes(unit) ? 6 : 3;
          return `<tr>
            <td>${p.nombre || '—'}</td>
            <td>${p.marca || '—'}</td>
            <td>${p.categoria || '—'}</td>
            <td class="r">${qty(stock, precision)}</td>
          </tr>`;
        });
        show(`
          <div class="rpt-kpis">
            <div class="rpt-kpi"><span>Productos</span><strong>${qty(arr.length)}</strong></div>
            <div class="rpt-kpi"><span>Inventario total</span><strong>${qty(totalStock)}</strong></div>
          </div>
          ${tableHtml(['Producto', 'Marca', 'Categoría', 'Stock'], rows)}`);
        return;
      }

      if (id === 'rotacion') {
        const data = await getJson('/api/reportes/rotacion-inventario?top=100');
        const arr = asList(data, 'rows', 'rotacion', 'productos');
        const rows = arr.map(p =>
          `<tr>
            <td>${((p.marca || '') + ' ' + (p.nombre || '')).trim() || '—'}</td>
            <td>${p.categoria || '—'}</td>
            <td class="r">${qty(p.stock_actual)}</td>
            <td class="r">${qty(p.unidades_vendidas_ultimo_mes)}</td>
            <td class="r">${Number(p.indice_rotacion || 0).toFixed(2)}</td>
          </tr>`
        );
        show(tableHtml(['Producto', 'Categoría', 'Stock', 'Vendidas (mes)', 'Índice'], rows));
        return;
      }

      if (id === 'lento') {
        const data = await getJson('/api/reportes/inventario/lento');
        const arr = asList(data, 'data', 'productos');
        const rows = arr.map(p =>
          `<tr>
            <td>${p.nombre || '—'}</td>
            <td class="r">$${money(p.precio_venta)}</td>
            <td class="r">${fmtDate(p.ultima_venta)}</td>
          </tr>`
        );
        show(tableHtml(['Producto', 'Precio', 'Última venta'], rows));
        return;
      }

      if (id === 'clientes') {
        const data = await getJson('/api/reportes/clientes/top');
        const arr = asList(data, 'data', 'clientes');
        const rows = arr.map(c =>
          `<tr>
            <td>${c.nombre || '—'}</td>
            <td>${c.cedula || '—'}</td>
            <td class="r">${qty(c.total_compras || c.compras || 0)}</td>
            <td class="r">$${money(c.gasto_total || c.monto || c.total)}</td>
          </tr>`
        );
        show(tableHtml(['Cliente', 'Cédula', 'Compras', 'Gasto total'], rows));
        return;
      }

      if (id === 'categorias') {
        const data = await getJson('/api/reportes/margen-categoria');
        const arr = asList(data, 'categorias');
        const rows = arr.map(c =>
          `<tr>
            <td>${c.categoria || '—'}</td>
            <td class="r">${qty(c.total_productos || 0)}</td>
            <td class="r">$${money(c.total_ventas)}</td>
            <td class="r">$${money(c.utilidad_total)}</td>
            <td class="r">${money(c.margen_promedio)}%</td>
          </tr>`
        );
        show(tableHtml(['Categoría', 'Productos', 'Ventas', 'Utilidad', 'Margen'], rows));
        return;
      }

      if (id === 'tendencias') {
        const data = await getJson('/api/reportes/tendencias/categorias');
        const arr = asList(data, 'data', 'categorias', 'tendencias');
        const rows = arr.map(c =>
          `<tr>
            <td>${c.categoria || c.nombre || '—'}</td>
            <td class="r">${qty(c.unidades_vendidas || c.unidades || c.cantidad || 0)}</td>
            <td class="r">$${money(c.ingresos_categoria || c.total || c.ventas)}</td>
          </tr>`
        );
        show(tableHtml(['Categoría', 'Unidades', 'Ingresos'], rows));
        return;
      }

      if (id === 'tipos-pago') {
        const data = await getJson('/api/reportes/tipos-pago');
        const resumen = asList(data, 'resumen');
        const detalle = asList(data, 'detalle');
        const tot = data.totales || {};
        const rows = resumen.map(r =>
          `<tr>
            <td>${r.forma_pago || '—'}</td>
            <td class="r">${qty(r.ventas || 0)}</td>
            <td class="r">${qty(r.operaciones || 0)}</td>
            <td class="r">$${money(r.total_usd)}</td>
            <td class="r">${money(r.total_bs)}</td>
          </tr>`
        );
        const detRows = detalle.slice(0, 80).map(d =>
          `<tr>
            <td>#${d.id_venta}</td>
            <td>${d.forma_pago || '—'}</td>
            <td>${fmtDate(d.fecha_hora)}</td>
            <td class="r">$${money(d.monto_usd)}</td>
            <td class="r">${money(d.monto_bs)}</td>
          </tr>`
        );
        show(`
          <div class="rpt-kpis">
            <div class="rpt-kpi"><span>Total USD</span><strong>$${money(tot.total_usd)}</strong></div>
            <div class="rpt-kpi"><span>Total Bs</span><strong>${money(tot.total_bs)}</strong></div>
            <div class="rpt-kpi"><span>Formas usadas</span><strong>${qty(resumen.length)}</strong></div>
          </div>
          <h4 class="rpt-subtitle">Resumen por forma de pago (mes actual)</h4>
          ${tableHtml(['Forma de pago', 'Ventas', 'Operaciones', 'Total $', 'Total Bs'], rows)}
          <h4 class="rpt-subtitle">Detalle reciente</h4>
          ${tableHtml(['Venta', 'Forma', 'Fecha', 'Monto $', 'Monto Bs'], detRows)}`);
        return;
      }

      if (id === 'tipos-pago-dia') {
        const now = new Date();
        const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        const toDateParam = date => [
          date.getFullYear(),
          String(date.getMonth() + 1).padStart(2, '0'),
          String(date.getDate()).padStart(2, '0')
        ].join('-');
        const date = toDateParam(dayStart);
        const end = toDateParam(dayEnd);
        const data = await getJson(`/api/reportes/tipos-pago?start=${encodeURIComponent(date)}&end=${encodeURIComponent(end)}`);
        const resumen = asList(data, 'resumen');
        const totales = data.totales || {};
        dailyPaymentReport = { date, rows: resumen, totals: totales };
        const rows = resumen.map(row => `
          <tr>
            <td>${escapeHtml(row.forma_pago || '—')}</td>
            <td class="r">${qty(row.ventas || 0)}</td>
            <td class="r">${qty(row.operaciones || 0)}</td>
            <td class="r">$${money(row.total_usd)}</td>
            <td class="r">${money(row.total_bs)}</td>
          </tr>
        `);
        show(`
          <p class="rpt-period">Fecha: ${escapeHtml(dayStart.toLocaleDateString('es-VE'))}</p>
          <div class="rpt-kpis">
            <div class="rpt-kpi"><span>Total USD</span><strong>$${money(totales.total_usd)}</strong></div>
            <div class="rpt-kpi"><span>Total Bs</span><strong>${money(totales.total_bs)}</strong></div>
            <div class="rpt-kpi"><span>Formas usadas</span><strong>${qty(resumen.length)}</strong></div>
          </div>
          <h4 class="rpt-subtitle">Resumen por forma de pago</h4>
          ${tableHtml(['Forma de pago', 'Ventas', 'Operaciones', 'Total USD', 'Total Bs'], rows)}`);
        return;
      }

      if (id === 'ventas-mes') {
        const data = await getJson('/api/reportes/ventas/mensual');
        const arr = asList(data, 'data', 'ventas', 'meses');
        const rows = arr.map(v =>
          `<tr>
            <td>${v.mes || v.periodo || '—'}</td>
            <td class="r">${qty(v.num_ventas || v.cantidad || 0)}</td>
            <td class="r">$${money(v.total_ventas || v.total)}</td>
          </tr>`
        );
        show(tableHtml(['Mes', 'Nº ventas', 'Total'], rows));
        return;
      }

      if (id === 'compras-mes') {
        const data = await getJson('/api/reportes/compras/mensual');
        const arr = asList(data, 'data');
        const rows = arr.map(v =>
          `<tr>
            <td>${v.mes || '—'}</td>
            <td class="r">${qty(v.num_compras || 0)}</td>
            <td class="r">$${money(v.total_compras)}</td>
          </tr>`
        );
        show(tableHtml(['Mes', 'Nº compras', 'Total'], rows));
        return;
      }

      body.innerHTML = '<div class="rpt-empty">Reporte no disponible</div>';
      setReportActions(false);
    } catch (e) {
      body.innerHTML = `<div class="rpt-empty" style="color:#b91c1c;">No se pudo cargar: ${e.message}</div>`;
      setReportActions(false);
    }
  }

  function setFlyoutOpen(open) {
    const fly = document.getElementById('reporteFlyout');
    const toggle = document.getElementById('rptFlyoutToggle');
    if (!fly) return;
    fly.classList.toggle('is-open', !!open);
    if (toggle) {
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      const chev = toggle.querySelector('.rpt-flyout-chevron');
      if (chev) chev.textContent = open ? '‹' : '›';
    }
  }
  window.setReportesFlyoutOpen = setFlyoutOpen;

  function setupFlyoutOnce() {
    const fly = document.getElementById('reporteFlyout');
    if (!fly || fly.dataset.bound === '1') return;
    fly.dataset.bound = '1';
    const toggle = document.getElementById('rptFlyoutToggle');
    const closeBtn = document.getElementById('rptFlyoutClose');
    if (toggle) {
      toggle.addEventListener('click', () => {
        setFlyoutOpen(!fly.classList.contains('is-open'));
      });
    }
    if (closeBtn) closeBtn.addEventListener('click', () => setFlyoutOpen(false));
  }

  function renderHubGrid() {
    const grid = document.getElementById('reporteHubGrid');
    if (!grid) return;
    setupFlyoutOnce();
    bindHeaderActionsOnce();
    const reports = REPORTS.filter(r => !r.accounting || window.maxSetupFeatureEnabled('accountingReports'));
    grid.innerHTML = reports.map(r => `
      <button type="button" class="rpt-menu-item" data-report="${r.id}" style="--rpt:${r.color}">
        <span class="rpt-menu-icon">${r.icon}</span>
        <span class="rpt-menu-copy">
          <span class="rpt-menu-title">${r.title}</span>
          <span class="rpt-menu-desc">${r.desc}</span>
        </span>
      </button>
    `).join('');
    grid.querySelectorAll('.rpt-menu-item').forEach(btn => {
      btn.addEventListener('click', () => {
        loadReport(btn.dataset.report);
        grid.querySelectorAll('.rpt-menu-item').forEach(b => b.classList.toggle('active', b === btn));
        if (window.matchMedia && window.matchMedia('(max-width: 900px)').matches) {
          setFlyoutOpen(false);
        }
      });
    });
  }

  window.initReportesHub = function () {
    renderHubGrid();
    const body = document.getElementById('reporteHubBody');
    if (body && !body.dataset.ready) {
      body.dataset.ready = '1';
      body.innerHTML = '<div class="rpt-empty">Toca <strong>Elegir reporte</strong> para ver y descargar un análisis</div>';
    }
  };

  window.openReporteHub = function (id) {
    if (typeof switchTab === 'function') switchTab('reportes');
    setTimeout(() => {
      initReportesHub();
      setFlyoutOpen(true);
      const btn = document.querySelector(`.rpt-menu-item[data-report="${id}"]`);
      if (btn) btn.click();
    }, 80);
  };

  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('reporteHubGrid')) renderHubGrid();
  });
})();
