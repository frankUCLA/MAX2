/*
  reportes.js
  Sistema de reportes con exportación a PDF
  MAX ERP
*/

// Importar librería jsPDF para exportar PDFs
const scriptPDF = document.createElement('script');
scriptPDF.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
document.head.appendChild(scriptPDF);

// ==================== REPORTE DE COMPRAS ====================
window.renderReporteCompras = async function renderReporteCompras() {
    const cont = document.getElementById('reporteCompras');
    if (!cont) {
        console.error('❌ Contenedor reporteCompras no encontrado');
        return;
    }
    
    cont.innerHTML = '<div class="item" style="padding:20px;text-align:center;">⏳ Cargando reporte de compras...</div>';
    
    try {
        const res = await fetch('/api/compras', { 
            method: 'GET',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (!res.ok) {
            if (res.status === 401) {
                cont.innerHTML = '<div class="item" style="padding:20px;text-align:center;color:#dc2626;">🔒 No autenticado. Por favor inicie sesión.</div>';
                return;
            }
            throw new Error(`Error HTTP: ${res.status}`);
        }
        
        const data = await res.json();
        
        if (!data || !data.compras || !Array.isArray(data.compras) || data.compras.length === 0) {
            cont.innerHTML = '<div class="item" style="padding:20px;text-align:center;color:#999;">📭 No hay compras registradas.</div>';
            return;
        }

        let totalGeneral = 0;
        let comprasPagadas = 0;
        let comprasPendientes = 0;
        let comprasParciales = 0;
        let totalPagadas = 0;
        let totalPendientes = 0;
        let totalParciales = 0;

        let html = `<div id="tabla-compras-export" style="padding:20px;background:white;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.1);">
            <h3 style="text-align:center;margin-bottom:10px;color:#333;font-size:1.4em;font-weight:bold;">🛒 Reporte de Compras</h3>
            <p style="text-align:center;color:#666;margin-bottom:20px;font-size:0.9em;">Generado: ${new Date().toLocaleDateString('es-VE', {weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'})}</p>
            
            <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
                <thead>
                    <tr style="background:#ef4444;color:white;">
                        <th style="padding:12px;text-align:left;border:1px solid #dc2626;">Compra #</th>
                        <th style="padding:12px;text-align:left;border:1px solid #dc2626;">Fecha</th>
                        <th style="padding:12px;text-align:left;border:1px solid #dc2626;">Proveedor</th>
                        <th style="padding:12px;text-align:right;border:1px solid #dc2626;">Total</th>
                        <th style="padding:12px;text-align:left;border:1px solid #dc2626;">Estado</th>
                        <th style="padding:12px;text-align:center;border:1px solid #dc2626;">Detalles</th>
                    </tr>
                </thead>
                <tbody>`;

        data.compras.forEach((c, idx) => {
            const total = parseFloat(c.total_compra || 0);
            totalGeneral += total;
            
            // Contar por estado
            const estado = (c.estado_pago || '').toLowerCase();
            if (estado.includes('pagada')) {
                comprasPagadas++;
                totalPagadas += total;
            } else if (estado.includes('parcial')) {
                comprasParciales++;
                totalParciales += total;
            } else {
                comprasPendientes++;
                totalPendientes += total;
            }
            
            const bgColor = idx % 2 === 0 ? '#f9fafb' : '#ffffff';
            const fecha = c.fecha_compra ? new Date(c.fecha_compra).toLocaleDateString('es-VE') : 'N/A';
            const estadoColor = estado.includes('pagada') ? '#10b981' : estado.includes('parcial') ? '#f59e0b' : '#dc2626';
            const estadoBg = estado.includes('pagada') ? '#d1fae5' : estado.includes('parcial') ? '#fef3c7' : '#fee2e2';
            
            // Contar productos en detalles
            const numProductos = (c.detalles && Array.isArray(c.detalles)) ? c.detalles.length : 0;
            
            html += `<tr style="background:${bgColor};">
                <td style="padding:12px;border:1px solid #e5e7eb;"><strong>#${c.id_compra || 'N/A'}</strong></td>
                <td style="padding:12px;border:1px solid #e5e7eb;">${fecha}</td>
                <td style="padding:12px;border:1px solid #e5e7eb;">${c.nombre_proveedor || 'Sin proveedor'}</td>
                <td style="padding:12px;text-align:right;border:1px solid #e5e7eb;font-weight:bold;color:#059669;">$${total.toFixed(2)}</td>
                <td style="padding:12px;border:1px solid #e5e7eb;"><span style="padding:4px 8px;border-radius:4px;background:${estadoBg};color:${estadoColor};font-weight:500;">${c.estado_pago || 'Pendiente'}</span></td>
                <td style="padding:12px;text-align:center;border:1px solid #e5e7eb;">${numProductos} producto${numProductos !== 1 ? 's' : ''}</td>
            </tr>`;
        });

        html += `</tbody></table>
            <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:15px;margin-bottom:20px;">
                <div style="background:#fef2f2;padding:15px;border-radius:8px;border-left:4px solid #ef4444;">
                    <div style="font-size:0.85em;color:#666;margin-bottom:5px;">Total General</div>
                    <div style="font-size:1.5em;font-weight:bold;color:#dc2626;">$${totalGeneral.toFixed(2)}</div>
                    <div style="font-size:0.75em;color:#999;margin-top:5px;">${data.compras.length} compras</div>
                </div>
                <div style="background:#f0fdf4;padding:15px;border-radius:8px;border-left:4px solid #10b981;">
                    <div style="font-size:0.85em;color:#666;margin-bottom:5px;">Pagadas</div>
                    <div style="font-size:1.3em;font-weight:bold;color:#059669;">$${totalPagadas.toFixed(2)}</div>
                    <div style="font-size:0.75em;color:#999;margin-top:5px;">${comprasPagadas} compras</div>
                </div>
                <div style="background:#fffbeb;padding:15px;border-radius:8px;border-left:4px solid #f59e0b;">
                    <div style="font-size:0.85em;color:#666;margin-bottom:5px;">Parciales</div>
                    <div style="font-size:1.3em;font-weight:bold;color:#d97706;">$${totalParciales.toFixed(2)}</div>
                    <div style="font-size:0.75em;color:#999;margin-top:5px;">${comprasParciales} compras</div>
                </div>
                <div style="background:#fee2e2;padding:15px;border-radius:8px;border-left:4px solid #dc2626;">
                    <div style="font-size:0.85em;color:#666;margin-bottom:5px;">Pendientes</div>
                    <div style="font-size:1.3em;font-weight:bold;color:#991b1b;">$${totalPendientes.toFixed(2)}</div>
                    <div style="font-size:0.75em;color:#999;margin-top:5px;">${comprasPendientes} compras</div>
                </div>
            </div>
        </div>`;

        cont.innerHTML = html;
        
        // Agregar botones de exportación
        const btnContainer = document.createElement('div');
        btnContainer.style.cssText = 'margin-top:20px;display:flex;gap:10px;justify-content:center;';
        btnContainer.innerHTML = `
            <button onclick="exportarComprasAPDF()" class="btn btn-primary" style="background:#ef4444;color:white;padding:12px 24px;border:none;border-radius:6px;cursor:pointer;font-weight:500;font-size:1em;transition:all 0.3s;">
                📥 Exportar a PDF
            </button>
            <button onclick="exportarComprasACSV()" class="btn btn-secondary" style="background:#6b7280;color:white;padding:12px 24px;border:none;border-radius:6px;cursor:pointer;font-weight:500;font-size:1em;transition:all 0.3s;">
                📊 Exportar a CSV
            </button>
        `;
        cont.appendChild(btnContainer);

    } catch (e) {
        console.error('Error cargando compras:', e);
        cont.innerHTML = `<div class="item" style="padding:20px;text-align:center;color:#dc2626;">
            ❌ Error al cargar compras: ${e.message || 'Error desconocido'}
        </div>`;
    }
}

window.exportarComprasAPDF = function() {
    const element = document.getElementById('tabla-compras-export');
    if (!element) {
        alert('❌ No hay datos para exportar');
        return;
    }
    
    try {
        const opt = {
            margin: 10,
            filename: `reporte_compras_${new Date().toISOString().slice(0,10)}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2 },
            jsPDF: { orientation: 'portrait', unit: 'mm', format: 'a4' }
        };
        
        html2pdf().set(opt).from(element).save();
        console.log('✅ PDF de compras generado correctamente');
    } catch (error) {
        console.error('Error generando PDF:', error);
        alert('❌ Error al generar el PDF: ' + error.message);
    }
};

window.exportarComprasACSV = function() {
    const element = document.getElementById('tabla-compras-export');
    if (!element) {
        alert('❌ No hay datos para exportar');
        return;
    }
    
    try {
        const tabla = element.querySelector('table');
        if (!tabla) {
            alert('❌ No se encontró la tabla de compras');
            return;
        }
        
        let csv = 'Compra #,Fecha,Proveedor,Total,Estado,Productos\n';
        const filas = tabla.querySelectorAll('tbody tr');
        
        filas.forEach(fila => {
            const celdas = fila.querySelectorAll('td');
            const compra = (celdas[0]?.textContent || '').trim();
            const fecha = (celdas[1]?.textContent || '').trim();
            const proveedor = (celdas[2]?.textContent || '').trim();
            const total = (celdas[3]?.textContent || '').trim().replace('$', '');
            const estado = (celdas[4]?.textContent || '').trim();
            const productos = (celdas[5]?.textContent || '').trim();
            
            csv += `"${compra}","${fecha}","${proveedor}","${total}","${estado}","${productos}"\n`;
        });
        
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `reporte_compras_${new Date().toISOString().slice(0,10)}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        console.log('✅ CSV de compras generado correctamente');
    } catch (error) {
        console.error('Error generando CSV:', error);
        alert('❌ Error al generar el CSV: ' + error.message);
    }
};

// ==================== REPORTE DE UTILIDAD ====================
window.cargarReporteUtilidad = async function cargarReporteUtilidad() {
    const cont = document.getElementById('tablaReporteUtilidad');
    if (!cont) {
        console.warn('Contenedor tablaReporteUtilidad no encontrado');
        return;
    }
    
    cont.innerHTML = '<div class="item" style="padding:20px;text-align:center;">⏳ Cargando reporte de utilidad...</div>';
    
    try {
        const res = await fetch('/api/reportes/utilidad-productos', { credentials: 'include' });
        
        if (!res.ok) {
            if (res.status === 401) {
                cont.innerHTML = '<div class="item" style="padding:20px;text-align:center;color:#dc2626;">🔒 No autenticado. Por favor inicie sesión en el sistema.</div>';
                return;
            }
            throw new Error(`Error HTTP: ${res.status}`);
        }
        
        const data = await res.json();
        
        if (!data || !data.utilidad || !Array.isArray(data.utilidad) || data.utilidad.length === 0) {
            cont.innerHTML = '<div class="item" style="padding:20px;text-align:center;color:#999;">📭 No hay datos de utilidad disponibles.</div>';
            return;
        }

        let html = `<div id="tabla-utilidad-export" style="padding:20px;background:white;border-radius:8px;">
            <h3 style="text-align:center;margin-bottom:10px;color:#333;font-size:1.3em;">💵 Reporte de Utilidad por Producto</h3>
            <p style="text-align:center;color:#666;margin-bottom:20px;font-size:0.9em;">Generado: ${new Date().toLocaleDateString('es-VE', {weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'})}</p>
            <table style="width:100%;border-collapse:collapse;margin-bottom:20px;overflow-x:auto;display:block;">
                <thead>
                    <tr style="background:#8b5cf6;color:white;">
                        <th style="padding:12px;text-align:left;border:1px solid #7c3aed;min-width:150px;">Producto</th>
                        <th style="padding:12px;text-align:right;border:1px solid #7c3aed;">Costo</th>
                        <th style="padding:12px;text-align:right;border:1px solid #7c3aed;">Precio Venta</th>
                        <th style="padding:12px;text-align:right;border:1px solid #7c3aed;">Utilidad Unit.</th>
                        <th style="padding:12px;text-align:right;border:1px solid #7c3aed;">Unidades</th>
                        <th style="padding:12px;text-align:right;border:1px solid #7c3aed;">Utilidad Total</th>
                        <th style="padding:12px;text-align:right;border:1px solid #7c3aed;">Margen %</th>
                    </tr>
                </thead>
                <tbody>`;

        let totalUtilidad = 0;
        data.utilidad.forEach((prod, idx) => {
            const utilTotal = parseFloat(prod.utilidad_total || 0);
            totalUtilidad += utilTotal;
            const bgColor = idx % 2 === 0 ? '#faf5ff' : '#ffffff';
            html += `<tr style="background:${bgColor};">
                <td style="padding:12px;border:1px solid #e9d5ff;"><strong>${(prod.nombre || 'N/A').toUpperCase()}</strong></td>
                <td style="padding:12px;text-align:right;border:1px solid #e9d5ff;">$${parseFloat(prod.costo_promedio || 0).toFixed(2)}</td>
                <td style="padding:12px;text-align:right;border:1px solid #e9d5ff;">$${parseFloat(prod.precio_venta || 0).toFixed(2)}</td>
                <td style="padding:12px;text-align:right;border:1px solid #e9d5ff;">$${parseFloat(prod.utilidad_unitaria || 0).toFixed(2)}</td>
                <td style="padding:12px;text-align:right;border:1px solid #e9d5ff;"><strong>${prod.unidades_vendidas || 0}</strong></td>
                <td style="padding:12px;text-align:right;border:1px solid #e9d5ff;font-weight:bold;color:#7c3aed;">$${utilTotal.toFixed(2)}</td>
                <td style="padding:12px;text-align:right;border:1px solid #e9d5ff;font-weight:bold;">${parseFloat(prod.margen_porcentaje || 0).toFixed(1)}%</td>
            </tr>`;
        });

        html += `</tbody></table>
            <div style="border-top:2px solid #e9d5ff;padding-top:15px;text-align:right;">
                <p style="margin:0;color:#666;font-size:0.9em;"><strong>Utilidad Total:</strong> <span style="color:#7c3aed;font-weight:bold;font-size:1.1em;">$${totalUtilidad.toFixed(2)}</span></p>
                <p style="margin:5px 0 0 0;color:#999;font-size:0.8em;">Número de productos: ${data.utilidad.length}</p>
            </div>
        </div>`;

        cont.innerHTML = html;
        
        // Agregar botones de exportación
        const btnContainer = document.createElement('div');
        btnContainer.style.cssText = 'margin-top:20px;display:flex;gap:10px;';
        btnContainer.innerHTML = `
            <button onclick="exportarUtilidadAPDF()" class="btn btn-primary" style="background:#8b5cf6;color:white;padding:12px 24px;border:none;border-radius:6px;cursor:pointer;font-weight:500;font-size:1em;">
                📥 Exportar a PDF
            </button>
            <button onclick="exportarUtilidadACSV()" class="btn btn-secondary" style="background:#6b7280;color:white;padding:12px 24px;border:none;border-radius:6px;cursor:pointer;font-weight:500;font-size:1em;">
                📊 Exportar a CSV
            </button>
        `;
        cont.appendChild(btnContainer);

        // Actualizar tabla en tbody si existe (para compatibilidad)
        const tbody = document.getElementById('tbodyReporteUtilidad');
        if (tbody) {
            tbody.innerHTML = data.utilidad.map(prod => `
                <tr>
                    <td style="padding:12px;">${prod.nombre}</td>
                    <td style="padding:12px;text-align:right;">$${parseFloat(prod.costo_promedio || 0).toFixed(2)}</td>
                    <td style="padding:12px;text-align:right;">$${parseFloat(prod.precio_venta || 0).toFixed(2)}</td>
                    <td style="padding:12px;text-align:right;">$${parseFloat(prod.utilidad_unitaria || 0).toFixed(2)}</td>
                    <td style="padding:12px;text-align:right;">${prod.unidades_vendidas || 0}</td>
                    <td style="padding:12px;text-align:right;">$${parseFloat(prod.utilidad_total || 0).toFixed(2)}</td>
                    <td style="padding:12px;text-align:right;">${parseFloat(prod.margen_porcentaje || 0).toFixed(1)}%</td>
                </tr>
            `).join('');
        }

    } catch (error) {
        console.error('Error cargando reporte de utilidad:', error);
        const cont = document.getElementById('tablaReporteUtilidad') || document.getElementById('reporteUtilidad');
        if (cont) {
            cont.innerHTML = `<div class="item" style="padding:20px;text-align:center;color:#dc2626;">
                ❌ Error al cargar reporte: ${error.message}
            </div>`;
        }
    }
}

window.exportarUtilidadAPDF = function() {
    const element = document.getElementById('tabla-utilidad-export');
    if (!element) {
        alert('❌ No hay datos para exportar');
        return;
    }
    
    try {
        const opt = {
            margin: 10,
            filename: `reporte_utilidad_${new Date().toISOString().slice(0,10)}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2 },
            jsPDF: { orientation: 'landscape', unit: 'mm', format: 'a4' }
        };
        
        html2pdf().set(opt).from(element).save();
        console.log('✅ PDF de utilidad generado correctamente');
    } catch (error) {
        console.error('Error generando PDF:', error);
        alert('❌ Error al generar el PDF: ' + error.message);
    }
};

window.exportarUtilidadACSV = function() {
    const element = document.getElementById('tabla-utilidad-export');
    if (!element) {
        alert('❌ No hay datos para exportar');
        return;
    }
    
    try {
        const tabla = element.querySelector('table');
        if (!tabla) {
            alert('❌ No se encontró la tabla de utilidad');
            return;
        }
        
        let csv = 'Producto,Costo,Precio Venta,Utilidad Unit.,Unidades,Utilidad Total,Margen %\n';
        const filas = tabla.querySelectorAll('tbody tr');
        
        filas.forEach(fila => {
            const celdas = fila.querySelectorAll('td');
            const producto = (celdas[0]?.textContent || '').trim();
            const costo = (celdas[1]?.textContent || '').trim();
            const precio = (celdas[2]?.textContent || '').trim();
            const utilUnit = (celdas[3]?.textContent || '').trim();
            const unidades = (celdas[4]?.textContent || '').trim();
            const utilTotal = (celdas[5]?.textContent || '').trim();
            const margen = (celdas[6]?.textContent || '').trim();
            
            csv += `"${producto}","${costo}","${precio}","${utilUnit}","${unidades}","${utilTotal}","${margen}"\n`;
        });
        
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `reporte_utilidad_${new Date().toISOString().slice(0,10)}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        console.log('✅ CSV de utilidad generado correctamente');
    } catch (error) {
        console.error('Error generando CSV:', error);
        alert('❌ Error al generar el CSV: ' + error.message);
    }
};


function switchReporteTab(tab) {
    // Ocultar todos los reportes
    const reporteSections = document.querySelectorAll('.reporte-section');
    reporteSections.forEach(section => section.style.display = 'none');
    
    // Remover active de todos los botones
    const reporteTabs = document.querySelectorAll('.reporte-tab');
    reporteTabs.forEach(btn => btn.classList.remove('active'));
    
    // Mostrar el reporte seleccionado
    const targetSection = document.getElementById(`reporte-${tab}`);
    const targetTab = document.getElementById(`tab-${tab}`);
    
    if (targetSection) {
        targetSection.style.display = 'block';
    }
    if (targetTab) {
        targetTab.classList.add('active');
    }
    
    // Cargar datos según el tipo de reporte
    setTimeout(() => {
        switch(tab) {
            case 'utilidad':
                if (typeof cargarReporteUtilidad === 'function') cargarReporteUtilidad();
                break;
        }
    }, 100);
}

// ==================== FUNCIONES AUXILIARES ====================
// Función para reportes de inventario
async function renderReporteInventario() {
    const cont = document.getElementById('reporteInventario');
    if (!cont) return;
    cont.innerHTML = '<div class="item">Cargando inventario...</div>';
    try {
        const res = await fetch('/api/reportes/inventario-actual', { credentials: 'include' });
        const data = await res.json();
        if (!data || !data.rows || !Array.isArray(data.rows) || data.rows.length === 0) {
            cont.innerHTML = '<div class="item">No hay datos de inventario.</div>';
            return;
        }
        let html = `<table style="width:100%;border-collapse:collapse;">
            <thead>
              <tr style="background:var(--surface-alt);">
                <th style="padding:8px;text-align:left;border:1px solid #eee;">Marca</th>
                <th style="padding:8px;text-align:left;border:1px solid #eee;">Producto</th>
                <th style="padding:8px;text-align:left;border:1px solid #eee;">Categoría</th>
                <th style="padding:8px;text-align:right;border:1px solid #eee;">Stock Total</th>
                <th style="padding:8px;text-align:left;border:1px solid #eee;">Tallas</th>
              </tr>
            </thead>
            <tbody>`;
        data.rows.forEach(r => {
            const tallas = (r.tallas||[]).map(t => `${t.talla||'-'}: ${t.cantidad}`).join(' · ');
            html += `<tr>
                <td style="padding:8px;border:1px solid #f4f4f4;">${r.marca || ''}</td>
                <td style="padding:8px;border:1px solid #f4f4f4;">${r.nombre}</td>
                <td style="padding:8px;border:1px solid #f4f4f4;">${r.categoria || 'N/A'}</td>
                <td style="padding:8px;text-align:right;border:1px solid #f4f4f4;">${(function(row){const v=Number(row.stock_total);if(!Number.isFinite(v))return row.stock_total||'—';const unit=String(row.unidad_medida||'').toUpperCase();const digits=['KILO','KG','LITRO','L'].includes(unit)?6:3;return Math.abs(v-Math.round(v))<1e-9?String(Math.round(v)):String(parseFloat(v.toFixed(digits)));})(r)}</td>
                <td style="padding:8px;border:1px solid #f4f4f4;">${tallas}</td>
            </tr>`;
        });
        html += `</tbody></table>`;
        cont.innerHTML = html;
    } catch (e) {
        cont.innerHTML = '<div class="item">Error al cargar inventario.</div>';
    }
}

// Función para ventas por temporada (tabla en reportes + gráfica del dashboard)
async function fetchVentasTemporada(periodo) {
    const periodoSel = periodo || document.getElementById('selectTemporadaDashboard')?.value || 'ultimos12';
    const tableCont = document.getElementById('reporteTemporada');
    const wrapId = 'temporadaChartWrap';
    const canvasId = 'temporadaChart';

    try {
        const res = await fetch(`/api/reportes/ventas-temporada?periodo=${encodeURIComponent(periodoSel)}`, {
            credentials: 'include'
        });
        const data = await res.json();
        let rows = (data && data.ok && Array.isArray(data.rows)) ? data.rows.slice() : [];

        // Orden cronológico ascendente para la gráfica
        rows.sort((a, b) => String(a.periodo || '').localeCompare(String(b.periodo || '')));

        if (document.getElementById(wrapId) || document.getElementById(canvasId)) {
            renderTemporadaDashboardChart(rows, periodoSel);
        }

        if (tableCont) {
            if (!rows.length) {
                tableCont.innerHTML = '<div class="item">No hay datos de ventas para este período.</div>';
                return;
            }
            let html = `<table style="width:100%;border-collapse:collapse;">
                <thead>
                  <tr style="background:var(--surface-alt);">
                    <th style="padding:8px;text-align:left;border:1px solid #eee;">Período</th>
                    <th style="padding:8px;text-align:right;border:1px solid #eee;">Unidades</th>
                    <th style="padding:8px;text-align:right;border:1px solid #eee;">Total</th>
                  </tr>
                </thead>
                <tbody>`;
            rows.forEach(r => {
                html += `<tr>
                    <td style="padding:8px;border:1px solid #f4f4f4;">${r.periodo || '—'}</td>
                    <td style="padding:8px;text-align:right;border:1px solid #f4f4f4;">${Number(r.unidades_vendidas || 0)}</td>
                    <td style="padding:8px;text-align:right;border:1px solid #f4f4f4;font-weight:bold;">$${Number(r.ingreso_total || 0).toFixed(2)}</td>
                </tr>`;
            });
            html += `</tbody></table>`;
            tableCont.innerHTML = html;
        }
    } catch (e) {
        console.error('Error ventas temporada:', e);
        if (window.MaxDashCharts) {
            window.MaxDashCharts.showEmpty(wrapId, 'Error al cargar ventas por temporada');
        }
    }
}
window.fetchVentasTemporada = fetchVentasTemporada;

function mesLabelCorto(periodo) {
    const s = String(periodo || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        const d = new Date(s + 'T12:00:00');
        if (!Number.isNaN(d.getTime())) {
            return d.toLocaleDateString('es-VE', { day: 'numeric', month: 'short' });
        }
        return s.slice(8) + '/' + s.slice(5, 7);
    }
    if (/^\d{4}-T\d$/.test(s)) return s;
    if (/^\d{4}-\d{2}$/.test(s)) {
        const [y, m] = s.split('-');
        const nombres = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        return `${nombres[Number(m) - 1] || m} ${String(y).slice(2)}`;
    }
    return s || '—';
}

function renderTemporadaDashboardChart(rows, periodoSel) {
    const wrapId = 'temporadaChartWrap';
    const canvasId = 'temporadaChart';
    const helpers = window.MaxDashCharts;

    if (!rows.length) {
        if (helpers) helpers.showEmpty(wrapId, 'Sin ventas en este período. Prueba «Últimos 12 meses» o «Año actual».');
        window.temporadaDashChart = null;
        return;
    }

    const paint = () => {
        if (typeof Chart === 'undefined') {
            setTimeout(paint, 100);
            return;
        }
        const canvasEl = helpers
            ? helpers.ensureCanvas(wrapId, canvasId)
            : document.getElementById(canvasId);
        if (!canvasEl) return;

        if (helpers) helpers.destroyOn(canvasEl);
        if (window.temporadaDashChart) {
            try { window.temporadaDashChart.destroy(); } catch (_) {}
            window.temporadaDashChart = null;
        }

        const labels = rows.map(r => mesLabelCorto(r.periodo));
        const valores = rows.map(r => Number(r.ingreso_total || 0));
        const hex = (getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#2563eb');
        const color = hex.startsWith('#') ? hex : '#2563eb';
        const ctx = canvasEl.getContext('2d');
        const useBar = rows.length === 1;
        let gradFill = 'rgba(37, 99, 235, 0.15)';
        if (!useBar) {
            try {
                const g = ctx.createLinearGradient(0, 0, 0, 240);
                const r = parseInt(color.slice(1, 3), 16);
                const gC = parseInt(color.slice(3, 5), 16);
                const b = parseInt(color.slice(5, 7), 16);
                g.addColorStop(0, `rgba(${r},${gC},${b},0.28)`);
                g.addColorStop(1, `rgba(${r},${gC},${b},0.02)`);
                gradFill = g;
            } catch (_) {}
        }

        const titleText = periodoSel === 'actual' ? 'Ingresos por día · mes actual'
            : periodoSel === 'anterior' ? 'Ingresos por día · mes anterior'
            : periodoSel === 'ultimos12' || periodoSel === 'ultimos6' ? 'Ingresos mensuales'
            : periodoSel === 'anual' ? 'Ingresos · año actual'
            : periodoSel === 'trimestre' ? 'Ingresos · trimestre'
            : 'Ingresos del período';

        window.temporadaDashChart = new Chart(ctx, {
            type: useBar ? 'bar' : 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Ingresos ($)',
                    data: valores,
                    borderColor: color,
                    backgroundColor: useBar ? color + 'cc' : gradFill,
                    borderWidth: useBar ? 2 : 3,
                    fill: !useBar,
                    tension: 0.35,
                    pointRadius: useBar ? 0 : (rows.length < 3 ? 6 : 4),
                    pointHoverRadius: 7,
                    pointBackgroundColor: '#fff',
                    pointBorderColor: color,
                    pointBorderWidth: 2,
                    spanGaps: true,
                    borderRadius: useBar ? 8 : 0,
                    maxBarThickness: useBar ? 72 : undefined
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 600 },
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    title: {
                        display: true,
                        text: titleText,
                        align: 'start',
                        color: '#334155',
                        font: { size: 13, weight: '600', family: "'DM Sans', sans-serif" },
                        padding: { bottom: 12 }
                    },
                    tooltip: {
                        backgroundColor: '#0f172a',
                        titleFont: { size: 12, weight: '600' },
                        bodyFont: { size: 12 },
                        padding: 10,
                        cornerRadius: 8,
                        callbacks: {
                            label: (ctx) => {
                                const row = rows[ctx.dataIndex] || {};
                                return [
                                    `Ingresos: $${Number(ctx.parsed.y || 0).toFixed(2)}`,
                                    `Unidades: ${Number(row.unidades_vendidas || 0)}`
                                ];
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: {
                            color: '#64748b',
                            font: { size: 11 },
                            maxRotation: rows.length > 10 ? 45 : 0,
                            autoSkip: true,
                            maxTicksLimit: 12
                        }
                    },
                    y: {
                        beginAtZero: true,
                        suggestedMax: Math.max(...valores, 1) * 1.2,
                        grid: { color: 'rgba(148,163,184,0.28)', drawBorder: false },
                        ticks: {
                            color: '#64748b',
                            font: { size: 11 },
                            callback: (v) => '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })
                        }
                    }
                }
            }
        });
        requestAnimationFrame(() => {
            try { window.temporadaDashChart && window.temporadaDashChart.resize(); } catch (_) {}
        });
    };
    paint();
}
window.renderTemporadaDashboardChart = renderTemporadaDashboardChart;

// Función para rotación de inventario
async function cargarRotacionInventario() {
    const cont = document.getElementById('reporteRotacion');
    if (!cont) return;
    cont.innerHTML = '<div class="item">Cargando rotación...</div>';
    try {
        const res = await fetch('/api/reportes/rotacion-inventario?top=100', { credentials: 'include' });
        const data = await res.json();
        if (data && data.rows && data.rows.length > 0) {
            let html = `<table style="width:100%;border-collapse:collapse;">
                <thead>
                    <tr style="background:var(--surface-alt);">
                        <th style="padding:var(--spacing-md);text-align:left;">Producto</th>
                        <th style="padding:var(--spacing-md);text-align:left;">Categoría</th>
                        <th style="padding:var(--spacing-md);text-align:right;">Stock</th>
                        <th style="padding:var(--spacing-md);text-align:right;">Vendidas</th>
                        <th style="padding:var(--spacing-md);text-align:right;">Rotación</th>
                    </tr>
                </thead>
                <tbody>`;
            data.rows.forEach(r => {
                html += `<tr>
                    <td style="padding:var(--spacing-md);">${r.marca || ''} ${r.nombre || ''}</td>
                    <td style="padding:var(--spacing-md);">${r.categoria || 'N/A'}</td>
                    <td style="padding:var(--spacing-md);text-align:right;">${r.stock_actual || 0}</td>
                    <td style="padding:var(--spacing-md);text-align:right;">${r.unidades_vendidas_ultimo_mes || 0}</td>
                    <td style="padding:var(--spacing-md);text-align:right;font-weight:600;">${parseFloat(r.indice_rotacion||0).toFixed(2)}</td>
                </tr>`;
            });
            html += `</tbody></table>`;
            cont.innerHTML = html;
        } else {
            cont.innerHTML = '<div class="item">No hay datos.</div>';
        }
    } catch (e) {
        cont.innerHTML = '<div class="item">Error al cargar.</div>';
    }
}

// ==================== REPORTE DE GANANCIAS ====================
window.cargarReporteGanancias = async function cargarReporteGanancias() {
    const cont = document.getElementById('reporteGanancias');
    if (!cont) {
        console.warn('Contenedor reporteGanancias no encontrado');
        return;
    }
    
    cont.innerHTML = '<div class="item" style="padding:20px;text-align:center;">⏳ Cargando reporte de ganancias...</div>';
    
    try {
        const res = await fetch('/api/reportes/ganancias', { credentials: 'include' });
        
        if (!res.ok) {
            if (res.status === 401) {
                cont.innerHTML = '<div class="item" style="padding:20px;text-align:center;color:#dc2626;">🔒 No autenticado. Por favor inicie sesión en el sistema.</div>';
                return;
            }
            throw new Error(`Error HTTP: ${res.status}`);
        }
        
        const data = await res.json();
        
        if (!data || !data.ok) {
            cont.innerHTML = '<div class="item" style="padding:20px;text-align:center;color:#999;">📭 No hay datos de ganancias disponibles.</div>';
            return;
        }

        const { resumen, desglose_por_dia, periodo } = data;
        const gananciaNeta = parseFloat(resumen.ganancia_neta || 0);
        const colorGanancia = gananciaNeta >= 0 ? '#10b981' : '#dc2626';
        
        let html = `<div id="tabla-ganancias-export" style="padding:20px;background:white;border-radius:8px;">
            <h3 style="text-align:center;margin-bottom:10px;color:#333;font-size:1.3em;">📈 Reporte de Ganancias</h3>
            <p style="text-align:center;color:#666;margin-bottom:20px;font-size:0.9em;">
                Período: ${new Date(periodo.inicio).toLocaleDateString('es-VE')} - ${new Date(periodo.fin).toLocaleDateString('es-VE')}
            </p>
            
            <!-- Resumen -->
            <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:15px;margin-bottom:30px;">
                <div style="background:#f0fdf4;padding:15px;border-radius:8px;border-left:4px solid #10b981;">
                    <div style="font-size:0.85em;color:#666;margin-bottom:5px;">Total Ingresos</div>
                    <div style="font-size:1.5em;font-weight:bold;color:#059669;">$${parseFloat(resumen.total_ingresos || 0).toFixed(2)}</div>
                    <div style="font-size:0.75em;color:#999;margin-top:5px;">${resumen.total_ventas || 0} ventas</div>
                </div>
                <div style="background:#fef2f2;padding:15px;border-radius:8px;border-left:4px solid #dc2626;">
                    <div style="font-size:0.85em;color:#666;margin-bottom:5px;">Total Costos</div>
                    <div style="font-size:1.5em;font-weight:bold;color:#dc2626;">$${parseFloat(resumen.total_costos || 0).toFixed(2)}</div>
                    <div style="font-size:0.75em;color:#999;margin-top:5px;">${resumen.total_compras || 0} compras</div>
                </div>
                <div style="background:${gananciaNeta >= 0 ? '#f0fdf4' : '#fef2f2'};padding:15px;border-radius:8px;border-left:4px solid ${colorGanancia};">
                    <div style="font-size:0.85em;color:#666;margin-bottom:5px;">Ganancia Neta</div>
                    <div style="font-size:1.5em;font-weight:bold;color:${colorGanancia};">$${gananciaNeta.toFixed(2)}</div>
                    <div style="font-size:0.75em;color:#999;margin-top:5px;">Margen: ${parseFloat(resumen.margen_ganancia || 0).toFixed(1)}%</div>
                </div>
            </div>
            
            <!-- Desglose por día -->
            <h4 style="margin:20px 0 10px 0;color:#333;">Desglose por Día</h4>
            <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
                <thead>
                    <tr style="background:#f59e0b;color:white;">
                        <th style="padding:12px;text-align:left;border:1px solid #d97706;">Fecha</th>
                        <th style="padding:12px;text-align:right;border:1px solid #d97706;">Ingresos</th>
                        <th style="padding:12px;text-align:right;border:1px solid #d97706;">Costos</th>
                        <th style="padding:12px;text-align:right;border:1px solid #d97706;">Ganancia</th>
                        <th style="padding:12px;text-align:center;border:1px solid #d97706;">Ventas</th>
                        <th style="padding:12px;text-align:center;border:1px solid #d97706;">Compras</th>
                    </tr>
                </thead>
                <tbody>`;

        desglose_por_dia.forEach((dia, idx) => {
            const ganancia = parseFloat(dia.ganancia || 0);
            const bgColor = idx % 2 === 0 ? '#fffbeb' : '#ffffff';
            const colorGan = ganancia >= 0 ? '#059669' : '#dc2626';
            html += `<tr style="background:${bgColor};">
                <td style="padding:12px;border:1px solid #fde68a;">${new Date(dia.fecha + 'T00:00:00').toLocaleDateString('es-VE')}</td>
                <td style="padding:12px;text-align:right;border:1px solid #fde68a;font-weight:bold;">$${parseFloat(dia.ingresos || 0).toFixed(2)}</td>
                <td style="padding:12px;text-align:right;border:1px solid #fde68a;">$${parseFloat(dia.costos || 0).toFixed(2)}</td>
                <td style="padding:12px;text-align:right;border:1px solid #fde68a;font-weight:bold;color:${colorGan};">$${ganancia.toFixed(2)}</td>
                <td style="padding:12px;text-align:center;border:1px solid #fde68a;">${dia.ventas || 0}</td>
                <td style="padding:12px;text-align:center;border:1px solid #fde68a;">${dia.compras || 0}</td>
            </tr>`;
        });

        html += `</tbody></table>
            <div style="border-top:2px solid #fde68a;padding-top:15px;text-align:right;">
                <p style="margin:0;color:#666;font-size:0.9em;"><strong>Ganancia Total:</strong> <span style="color:${colorGanancia};font-weight:bold;font-size:1.1em;">$${gananciaNeta.toFixed(2)}</span></p>
                <p style="margin:5px 0 0 0;color:#999;font-size:0.8em;">Margen de ganancia: ${parseFloat(resumen.margen_ganancia || 0).toFixed(2)}%</p>
            </div>
        </div>`;

        cont.innerHTML = html;
        
        // Agregar botones de exportación
        const btnContainer = document.createElement('div');
        btnContainer.style.cssText = 'margin-top:20px;display:flex;gap:10px;';
        btnContainer.innerHTML = `
            <button onclick="exportarGananciasAPDF()" class="btn btn-primary" style="background:#f59e0b;color:white;padding:12px 24px;border:none;border-radius:6px;cursor:pointer;font-weight:500;font-size:1em;">
                📥 Exportar a PDF
            </button>
            <button onclick="exportarGananciasACSV()" class="btn btn-secondary" style="background:#6b7280;color:white;padding:12px 24px;border:none;border-radius:6px;cursor:pointer;font-weight:500;font-size:1em;">
                📊 Exportar a CSV
            </button>
        `;
        cont.appendChild(btnContainer);

    } catch (error) {
        console.error('Error cargando reporte de ganancias:', error);
        cont.innerHTML = `<div class="item" style="padding:20px;text-align:center;color:#dc2626;">
            ❌ Error al cargar reporte de ganancias: ${error.message}
        </div>`;
    }
}

window.exportarGananciasAPDF = function() {
    const element = document.getElementById('tabla-ganancias-export');
    if (!element) {
        alert('❌ No hay datos para exportar');
        return;
    }
    
    try {
        const opt = {
            margin: 10,
            filename: `reporte_ganancias_${new Date().toISOString().slice(0,10)}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2 },
            jsPDF: { orientation: 'portrait', unit: 'mm', format: 'a4' }
        };
        
        html2pdf().set(opt).from(element).save();
        console.log('✅ PDF de ganancias generado correctamente');
    } catch (error) {
        console.error('Error generando PDF:', error);
        alert('❌ Error al generar el PDF: ' + error.message);
    }
};

window.exportarGananciasACSV = function() {
    const element = document.getElementById('tabla-ganancias-export');
    if (!element) {
        alert('❌ No hay datos para exportar');
        return;
    }
    
    try {
        const tabla = element.querySelector('table');
        if (!tabla) {
            alert('❌ No se encontró la tabla de ganancias');
            return;
        }
        
        let csv = 'Fecha,Ingresos,Costos,Ganancia,Ventas,Compras\n';
        const filas = tabla.querySelectorAll('tbody tr');
        
        filas.forEach(fila => {
            const celdas = fila.querySelectorAll('td');
            const fecha = (celdas[0]?.textContent || '').trim();
            const ingresos = (celdas[1]?.textContent || '').trim().replace('$', '');
            const costos = (celdas[2]?.textContent || '').trim().replace('$', '');
            const ganancia = (celdas[3]?.textContent || '').trim().replace('$', '');
            const ventas = (celdas[4]?.textContent || '').trim();
            const compras = (celdas[5]?.textContent || '').trim();
            
            csv += `"${fecha}","${ingresos}","${costos}","${ganancia}","${ventas}","${compras}"\n`;
        });
        
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `reporte_ganancias_${new Date().toISOString().slice(0,10)}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        console.log('✅ CSV de ganancias generado correctamente');
    } catch (error) {
        console.error('Error generando CSV:', error);
        alert('❌ Error al generar el CSV: ' + error.message);
    }
};