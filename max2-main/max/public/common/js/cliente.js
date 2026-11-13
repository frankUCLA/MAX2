document.addEventListener('DOMContentLoaded', () => {
    // --- Mostrar tallas dinámicas en registro de producto ---
    const tallasDinamicasDiv = document.getElementById('tallas-dinamicas');
    window.mostrarTallasDinamicas = async function mostrarTallasDinamicas() {
        if (!tallasDinamicasDiv) return;
        try {
            const res = await fetch('/api/tallas');
            const data = await res.json();
            tallasDinamicasDiv.innerHTML = '';
            data.tallas.forEach(talla => {
                const label = document.createElement('label');
                label.style.marginRight = '10px';
                label.innerHTML = `<b>${talla.nombre}</b> <input type='number' min='0' value='0' style='width:60px;' name='cantidad_talla_${talla.id_talla}' data-id-talla='${talla.id_talla}'>`;
                tallasDinamicasDiv.appendChild(label);
            });
        } catch {}
    }
    mostrarTallasDinamicas();
    // --- ADMINISTRADOR: Gestión de Tallas ---
    const formTalla = document.getElementById('form-talla');
    const catalogoTallas = document.getElementById('catalogoTallas');
    let todasLasTallas = [];
    
    window.cargarTallas = async function cargarTallas() {
        try {
            const res = await fetch('/api/tallas');
            const data = await res.json();
            todasLasTallas = data.tallas || [];
            if (catalogoTallas) {
                renderTallas(todasLasTallas);
            }
        } catch { 
            if (catalogoTallas) {
                catalogoTallas.innerHTML = '<div class="item">Error al cargar tallas.</div>';
            }
        }
    }
    
    function renderTallas(tallas) {
        if (!catalogoTallas) return;
        catalogoTallas.innerHTML = '';
        if (tallas.length === 0) {
            catalogoTallas.innerHTML = '<div class="item">No hay tallas registradas.</div>';
            return;
        }
        tallas.forEach(talla => {
            const div = document.createElement('div');
            div.className = 'item';
            div.dataset.id = talla.id_talla;
            div.dataset.ajuste = talla.ajuste || '';
            div.dataset.pecho = talla.pecho || '';
            div.dataset.cintura = talla.cintura || '';
            div.dataset.cadera = talla.cadera || '';
            div.dataset.largo = talla.largo || '';
            div.innerHTML = `
                <span><b>${talla.nombre}</b> | Ajuste: ${talla.ajuste || '-'} | Pecho: ${talla.pecho || '-'} | Cintura: ${talla.cintura || '-'} | Cadera: ${talla.cadera || '-'} | Largo: ${talla.largo || '-'}</span>
                <div class="actions">
                    <button class='btn btn-small' onclick='editarTalla(${talla.id_talla}, ${JSON.stringify(talla)})'>Editar</button>
                    <button class='btn btn-small secondary' onclick='mostrarConfirmacion(${talla.id_talla}, "tallas", "${talla.nombre}")'>Eliminar</button>
                </div>`;
            catalogoTallas.appendChild(div);
        });
    }
    
    // Búsqueda de tallas
    const buscarTalla = document.getElementById('buscarTalla');
    if (buscarTalla) {
        buscarTalla.addEventListener('input', function() {
            const busqueda = this.value.toLowerCase().trim();
            if (busqueda === '') {
                renderTallas(todasLasTallas);
            } else {
                const filtradas = todasLasTallas.filter(talla => 
                    (talla.nombre && talla.nombre.toLowerCase().includes(busqueda)) ||
                    (talla.ajuste && talla.ajuste.toLowerCase().includes(busqueda))
                );
                renderTallas(filtradas);
            }
        });
    }
    if (formTalla) {
        formTalla.addEventListener('submit', async (e) => {
            e.preventDefault();
            const nombre = document.getElementById('tallaNombre').value.trim();
            const ajuste = document.getElementById('tallaAjuste').value;
            const pecho = parseInt(document.getElementById('tallaPecho').value) || null;
            const cintura = parseInt(document.getElementById('tallaCintura').value) || null;
            const cadera = parseInt(document.getElementById('tallaCadera').value) || null;
            const largo = parseInt(document.getElementById('tallaLargo').value) || null;
            if (!nombre || !ajuste) return;
            try {
                const res = await fetch('/api/tallas', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nombre, ajuste, pecho, cintura, cadera, largo })
                });
                const data = await res.json();
                if (data.ok) {
                    formTalla.reset();
                    cargarTallas();
                } else {
                    alert('Error al crear talla');
                }
            } catch (err) { alert('Error de conexión'); }
        });
        cargarTallas();
    }
    window.eliminarTalla = async function(id) {
        if (!(await maxConfirm('¿Seguro que deseas eliminar esta talla?', { title: 'Eliminar talla', okText: 'Eliminar' }))) return;
        try {
            const res = await fetch(`/api/tallas/${id}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.ok) {
                cargarTallas();
            } else {
                alert('Error al eliminar talla');
            }
        } catch { alert('Error de conexión'); }
    };
    // Funciones para cargar opciones en el modal de edición
    async function cargarOpcionesEdicionCategoria(selectedId) {
        const select = document.getElementById('editCategoria');
        if (!select) return;
        try {
            const res = await fetch('/api/categorias');
            const data = await res.json();
            select.innerHTML = '';
            data.categorias.forEach(cat => {
                const opt = document.createElement('option');
                opt.value = cat.id_categoria;
                opt.textContent = cat.nombre;
                if (cat.id_categoria == selectedId) opt.selected = true;
                select.appendChild(opt);
            });
        } catch {}
    }
    async function cargarOpcionesEdicionProveedor(selectedId) {
        const select = document.getElementById('editProveedor');
        if (!select) return;
        try {
            const res = await fetch('/api/proveedores');
            const data = await res.json();
            select.innerHTML = '';
            data.proveedores.forEach(prov => {
                const opt = document.createElement('option');
                opt.value = prov.id_proveedor;
                opt.textContent = prov.nombre;
                if (prov.id_proveedor == selectedId) opt.selected = true;
                select.appendChild(opt);
            });
        } catch {}
    }
    // --- Modal de edición de producto ---
    const modalEditar = document.getElementById('modalEditarProducto');
    const formEditar = document.getElementById('formEditarProducto');
    const btnCerrarModal = document.getElementById('btnCerrarModal');
    async function mostrarModalEditar(prod) {
        document.getElementById('editIdProducto').value = prod.id_producto;
        document.getElementById('editMarca').value = prod.marca || '';
        document.getElementById('editNombre').value = prod.nombre;
        // Inicializar en 0 para que el usuario ingrese la cantidad adicional que quiere sumar
        document.getElementById('editInventario').value = '';
        document.getElementById('editInventario').placeholder = '0'; // Cantidad adicional a sumar
        document.getElementById('editPrecio').value = prod.precio_venta;
        if (window.MaxIva && typeof window.MaxIva.updatePrecioPublicoPreview === 'function') {
            window.MaxIva.updatePrecioPublicoPreview();
        }
        const editCodigo = document.getElementById('editCodigoBarras');
        if (editCodigo) editCodigo.value = prod.codigo_barras || '';
        const editStockMin = document.getElementById('editStockMinimo');
        if (editStockMin) editStockMin.value = prod.stock_minimo != null ? prod.stock_minimo : 0;
        const editUnidad = document.getElementById('editUnidad');
        if (editUnidad) {
            editUnidad.value = prod.unidad_medida || 'UNIDAD';
            editUnidad.dispatchEvent(new Event('change'));
        }
        const editEmpaque = document.getElementById('editUnidadesEmpaque');
        if (editEmpaque) editEmpaque.value = prod.unidades_por_empaque != null ? prod.unidades_por_empaque : '';
        const editImgActual = document.getElementById('editImagenActual');
        if (editImgActual) {
            editImgActual.innerHTML = prod.ruta_imagen
                ? `<img src="${prod.ruta_imagen}" alt="" style="max-width:100px;max-height:100px;object-fit:cover;border-radius:6px;">`
                : '<span style="color:#999;">Sin imagen</span>';
        }
        
        // Mostrar el inventario actual como referencia
        const inventarioActual = prod.inventario || 0;
        const editInventarioLabel = document.querySelector('label[for="editInventario"]') || 
                                     document.querySelector('label:has(input#editInventario)');
        if (editInventarioLabel) {
            editInventarioLabel.innerHTML = `Cantidad adicional (sumar al total): <span style="color:#666;font-size:0.9em;">(Stock actual: ${inventarioActual})</span><input type="number" id="editInventario" class="input" min="0" value="" placeholder="0">`;
        }
        
        await cargarOpcionesEdicionCategoria(prod.id_categoria);
        await cargarOpcionesEdicionProveedor(prod.id_proveedor);
        
        // Cargar tallas del producto para edición
        await cargarTallasParaEdicion(prod.tallas || []);
        
        modalEditar.style.display = 'flex';
    }
    
    // Función para cargar tallas en el modal de edición
    async function cargarTallasParaEdicion(tallasProducto) {
        const editTallasDiv = document.getElementById('editTallasDinamicas');
        if (!editTallasDiv) return;
        
        try {
            // Obtener todas las tallas disponibles
            const res = await fetch('/api/tallas');
            const data = await res.json();
            const todasLasTallas = data.tallas || [];
            
            editTallasDiv.innerHTML = '';
            
            todasLasTallas.forEach(talla => {
                // Buscar si esta talla ya tiene cantidad en el producto
                const tallaProducto = tallasProducto.find(tp => Number(tp.id_talla) === Number(talla.id_talla));
                const cantidadActual = tallaProducto ? Number(tallaProducto.cantidad) : 0;
                
                const label = document.createElement('label');
                label.style.display = 'block';
                label.style.marginBottom = '10px';
                label.style.padding = '8px';
                label.style.background = cantidadActual > 0 ? '#e8f5e9' : '#f5f5f5';
                label.style.borderRadius = '4px';
                label.innerHTML = `
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <div>
                            <strong>${talla.nombre}</strong>
                            ${cantidadActual > 0 ? `<span style="color:#666;font-size:0.9em;"> (Actual: ${cantidadActual})</span>` : '<span style="color:#999;font-size:0.9em;"> (Sin stock)</span>'}
                        </div>
                        <input 
                            type="number" 
                            min="0" 
                            value="0" 
                            placeholder="0" 
                            style="width:80px;padding:6px;" 
                            name="edit_cantidad_talla_${talla.id_talla}" 
                            data-id-talla="${talla.id_talla}"
                            title="Cantidad a AGREGAR (se sumará a ${cantidadActual})">
                    </div>
                `;
                editTallasDiv.appendChild(label);
            });
        } catch (e) {
            console.error('Error cargando tallas para edición:', e);
            editTallasDiv.innerHTML = '<p style="color:red;">Error al cargar tallas</p>';
        }
    }
    if (btnCerrarModal) {
        btnCerrarModal.onclick = () => { modalEditar.style.display = 'none'; };
    }
    if (formEditar) {
        const editBc = document.getElementById('editCodigoBarras');
        const editBcClear = document.getElementById('editCodigoBarrasClear');
        if (editBc) {
            editBc.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    editBc.blur();
                    editBc.focus();
                }
            });
        }
        if (editBcClear && editBc) {
            editBcClear.addEventListener('click', () => {
                editBc.value = '';
                editBc.focus();
            });
        }
        formEditar.onsubmit = async (e) => {
            e.preventDefault();
            const id = document.getElementById('editIdProducto').value;
            const marca = document.getElementById('editMarca').value.trim();
            const nombre = document.getElementById('editNombre').value.trim();
            const inventario_adicional = parseInt(document.getElementById('editInventario').value) || 0;
            const precio = parseFloat(document.getElementById('editPrecio').value);
            const id_categoria = document.getElementById('editCategoria').value;
            const id_proveedor = document.getElementById('editProveedor').value;
            
            if (!marca || !nombre || isNaN(precio) || !id_categoria || !id_proveedor) {
                alert('Completa todos los campos requeridos.'); 
                return;
            }
            
            // Obtener cantidades de tallas del formulario
            const editTallasDiv = document.getElementById('editTallasDinamicas');
            const cantidades = [];
            if (editTallasDiv) {
                const inputs = editTallasDiv.querySelectorAll('input[type="number"]');
                inputs.forEach(input => {
                    const id_talla = input.getAttribute('data-id-talla');
                    const cantidad = parseInt(input.value) || 0;
                    if (cantidad > 0) {
                        cantidades.push({ id_talla, cantidad });
                    }
                });
            }
            
            // Preparar FormData (soporta imagen)
            const fd = new FormData();
            fd.append('marca', marca);
            fd.append('nombre', nombre);
            fd.append('inventario_adicional', String(inventario_adicional));
            fd.append('precio', String(precio));
            fd.append('id_categoria', id_categoria);
            fd.append('id_proveedor', id_proveedor);
            fd.append('cantidades', JSON.stringify(cantidades));
            const codigoEl = document.getElementById('editCodigoBarras');
            const stockMinEl = document.getElementById('editStockMinimo');
            const imgEl = document.getElementById('editImagen');
            if (codigoEl) fd.append('codigo_barras', codigoEl.value.trim());
            if (stockMinEl) fd.append('stock_minimo', String(stockMinEl.value || 0));
            const unidadEl = document.getElementById('editUnidad');
            const empaqueEl = document.getElementById('editUnidadesEmpaque');
            if (unidadEl) fd.append('unidad_medida', unidadEl.value);
            if (empaqueEl && (unidadEl.value === 'CAJA' || unidadEl.value === 'PAQUETE')) {
                if (!(parseFloat(empaqueEl.value) > 0)) {
                    alert('Indica cuántas unidades trae cada ' + (unidadEl.value === 'PAQUETE' ? 'paquete' : 'caja'));
                    return;
                }
                fd.append('unidades_por_empaque', empaqueEl.value);
            } else {
                fd.append('unidades_por_empaque', '');
            }
            if (imgEl && imgEl.files && imgEl.files[0]) fd.append('imagen', imgEl.files[0]);
            
            try {
                const res = await fetch(`/api/admin/productos/${id}`, {
                    method: 'PUT',
                    credentials: 'include',
                    body: fd
                });
                
                const data = await res.json();
                console.log('[EDITAR PRODUCTO] Respuesta del servidor:', data);
                
                if (data.ok) {
                    const mensaje = `Producto actualizado. Inventario agregado: ${data.inventario_agregado || 0}. Tallas: ${data.tallas_agregadas || 0}.`;
                    if (typeof showAdminToast === 'function') showAdminToast(mensaje, 'ok');
                    else alert(mensaje);
                    modalEditar.style.display = 'none';
                    cargarProductos();
                    if (typeof window.cargarProductosCompra === 'function') window.cargarProductosCompra();
                    if (typeof window.cargarOpcionesPromocionForm === 'function') window.cargarOpcionesPromocionForm();
                    if (typeof recoverKeyboardFocus === 'function') recoverKeyboardFocus('prodNombre');
                } else {
                    const err = data.message || data.error || '';
                    if (typeof showAdminToast === 'function') showAdminToast('Error al editar: ' + err, data.imagen_duplicada ? 'warn' : 'error');
                    else alert('❌ Error al editar producto: ' + err);
                    if (typeof recoverKeyboardFocus === 'function') recoverKeyboardFocus();
                }
            } catch (e) {
                console.error('Error al editar producto:', e);
                if (typeof showAdminToast === 'function') showAdminToast('Error de conexión al editar producto', 'error');
                else alert('❌ Error de conexión al editar producto');
                if (typeof recoverKeyboardFocus === 'function') recoverKeyboardFocus();
            }
        };
    }
    window.editarProducto = async function(id) {
        try {
            const res = await fetch(`/api/admin/productos/${id}`);
            const data = await res.json();
            if (data.producto) {
                mostrarModalEditar(data.producto);
            } else {
                alert('No se encontró el producto');
            }
        } catch { alert('Error al cargar producto'); }
    };
    // --- ADMINISTRADOR: Listado, edición y eliminación de productos ---
    const adminProductos = document.getElementById('adminProductos');
    let todosLosProductos = []; // Almacenar todos los productos para búsqueda
    window.getProductosAdminList = function () { return todosLosProductos.slice(); };
    window.refrescarListadoProductosAdmin = function () {
        return cargarProductos();
    };

    async function ensureIvaAdminLoaded() {
        if (window.MaxIva && (window.MaxIva._loaded || window.MaxIva.activo)) return;
        try {
            const res = await fetch('/api/admin/config/iva', { credentials: 'include' });
            const data = await res.json().catch(() => ({}));
            if (res.ok && data && window.MaxIva) {
                window.MaxIva.applyState(!!data.activo, Number(data.porcentaje || 16));
                window.MaxIva._loaded = true;
            }
        } catch (_) {}
    }
    
    async function cargarProductos() {
        try {
            await ensureIvaAdminLoaded();
            const res = await fetch('/api/admin/productos', { credentials: 'include' });
            const data = await res.json();
            if (adminProductos) {
                todosLosProductos = data.productos || [];
                window._adminProductosCache = todosLosProductos;
                // Asegurar que cada producto tenga el nombre de su categoría para mostrar en la lista
                try {
                    const cRes = await fetch('/api/categorias', { credentials: 'include' });
                    const cData = await cRes.json();
                    const cats = (cData && cData.categorias) ? cData.categorias : [];
                    const catMap = {};
                    cats.forEach(c => { catMap[c.id_categoria] = c.nombre; });
                    todosLosProductos = todosLosProductos.map(p => (Object.assign({}, p, { categoria: p.id_categoria ? (catMap[p.id_categoria] || null) : null })));
                    window._adminProductosCache = todosLosProductos;
                } catch (e) {
                    // si falla obtener categorías, seguimos mostrando sin nombre de categoría
                    console.warn('No se pudo cargar nombres de categorías para productos:', e);
                }
                renderProductos(todosLosProductos);
            }
        } catch { 
            if (adminProductos) {
                adminProductos.innerHTML = '<div class="item">Error al cargar productos.</div>';
            }
        }
    }
    window.cargarProductos = cargarProductos;

    function applyAdminStockUpdates(updates) {
        if (!Array.isArray(updates) || !updates.length) return false;
        if (!todosLosProductos.length) return false;
        let changed = false;
        let missing = false;
        for (const u of updates) {
            const p = todosLosProductos.find((x) => Number(x.id_producto) === Number(u.id_producto));
            if (!p) {
                missing = true;
                continue;
            }
            if (u.inventario != null) p.inventario = u.inventario;
            if (Array.isArray(u.tallas)) p.tallas = u.tallas;
            changed = true;
        }
        if (missing) return false;
        if (changed) {
            window._adminProductosCache = todosLosProductos;
            const panel = document.getElementById('inventarioPanel');
            const visible = panel && panel.style.display !== 'none';
            if (visible || adminProductos) renderProductos(todosLosProductos);
        }
        return changed;
    }
    window.applyAdminStockUpdates = applyAdminStockUpdates;

    function startAdminStockStream() {
        if (typeof EventSource === 'undefined') return;
        try {
            if (window._adminStockEs) {
                try { window._adminStockEs.close(); } catch (_) {}
                window._adminStockEs = null;
            }
            const es = new EventSource('/api/stock/stream', { withCredentials: true });
            es.addEventListener('stock', (ev) => {
                try {
                    const data = JSON.parse(ev.data || '{}');
                    const updates = data.updates || [];
                    if (!applyAdminStockUpdates(updates)) {
                        // Producto nuevo o lista vacía → recargar completo
                        cargarProductos();
                    }
                    if (typeof window.cargarProductosCompra === 'function') {
                        window.cargarProductosCompra();
                    }
                } catch (_) {}
            });
            es.onerror = () => {};
            window._adminStockEs = es;
        } catch (e) {
            console.warn('Admin stock stream:', e && e.message);
        }
    }
    startAdminStockStream();

    // Al volver a la pestaña del navegador, refrescar inventario
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            const panel = document.getElementById('inventarioPanel');
            if (panel && panel.style.display !== 'none') cargarProductos();
        }
    });
    
    function formatStockQty(n, unidad) {
        const v = Number(n);
        if (!Number.isFinite(v)) return '0';
        const u = String(unidad || 'UNIDAD').toUpperCase();
        const discrete = (u === 'UNIDAD' || u === 'CAJA' || u === 'PAQUETE');
        if (u === 'KILO' || u === 'KG' || u === 'LITRO' || u === 'L') {
            return String(parseFloat(v.toFixed(6)));
        }
        if (discrete) {
            return Number.isInteger(v) || Math.abs(v - Math.round(v)) < 1e-9
                ? String(Math.round(v))
                : String(parseFloat(v.toFixed(3)));
        }
        return String(parseFloat(v.toFixed(3)));
    }

    function margenBadgeHtml(prod) {
        const costo = Number(prod.costo_promedio || 0);
        const precio = Number(prod.precio_venta || 0);
        const util = Number(prod.utilidad_unitaria != null ? prod.utilidad_unitaria : (precio - costo));
        const pct = Number(prod.margen_porcentaje != null ? prod.margen_porcentaje : (precio > 0 ? (util / precio) * 100 : 0));
        if (!(costo > 0)) {
            return '<span class="prod-margen na" title="Registra una compra para calcular margen">Sin costo</span>';
        }
        const cls = pct >= 25 ? 'ok' : (pct >= 10 ? 'mid' : 'low');
        const sign = util >= 0 ? '+' : '';
        return `<span class="prod-margen ${cls}" title="Precio base $${precio.toFixed(2)} − costo $${costo.toFixed(2)}">Margen ${pct.toFixed(0)}% · ${sign}$${util.toFixed(2)}/und</span>`;
    }

    function precioAdminHtml(prod) {
        const base = Number(prod.precio_venta || 0);
        const iva = window.MaxIva;
        if (iva && iva.activo) {
            const pub = iva.precioPublico(base);
            const monto = iva.montoIva(base);
            return `<span class="prod-precio-pub" title="Lo que paga el cliente / sale en etiqueta">Al público: <strong>$${pub.toFixed(2)}</strong></span>
                    <span class="prod-precio-base">Base $${base.toFixed(2)} + IVA $${monto.toFixed(2)}</span>`;
        }
        return `<span>Precio: <strong>$${base.toFixed(2)}</strong></span>`;
    }

    function renderProductos(productos) {
        if (!adminProductos) return;
        adminProductos.innerHTML = '';
        if (productos.length === 0) {
            adminProductos.innerHTML = '<div class="item">No hay productos registrados.</div>';
            return;
        }
        productos.forEach(prod => {
            const div = document.createElement('div');
            div.className = 'item';
            div.dataset.id = prod.id_producto;
            const unidad = prod.unidad_medida || 'UNIDAD';
            const stockTxt = formatStockQty(prod.inventario, unidad);
            const minTxt = prod.stock_minimo != null ? formatStockQty(prod.stock_minimo, unidad) : null;
            const thumb = prod.ruta_imagen
                ? `<img class="prod-thumb" src="${prod.ruta_imagen}" alt="">`
                : `<div class="prod-thumb-ph">${(prod.nombre || '?').charAt(0)}</div>`;
            const empaque = prod.unidades_por_empaque ? ` ×${prod.unidades_por_empaque} und` : '';
            div.innerHTML = `
                <div class="producto-info">
                    ${thumb}
                    <div class="prod-meta">
                        <strong>${prod.marca || ''} - ${prod.nombre}</strong>
                        <div>Categoría: <span id="prod-cat-${prod.id_producto}">${prod.categoria || (prod.id_categoria ? 'Cargando...' : 'Sin categoría')}</span></div>
                        <div class="prod-meta-line">
                            ${precioAdminHtml(prod)}
                            <span>Stock: ${stockTxt}</span>
                            <span class="unit-badge">${unidad}${empaque}</span>
                            ${minTxt != null ? `<span>Mín: ${minTxt}</span>` : ''}
                            ${prod.codigo_barras
                              ? `<span class="prod-barcode-chip" title="Código de barras">▮ ${String(prod.codigo_barras)}</span>`
                              : `<span class="prod-barcode-chip" style="background:#f1f5f9;color:#64748b;border-color:#e2e8f0;">Sin código</span>`}
                        </div>
                    </div>
                </div>
                <div class="actions">
                    <button class="btn btn-small btn-print-price" onclick="imprimirEtiquetaProducto(${prod.id_producto})" title="Imprimir precio al público">Imprimir precio</button>
                    <button class="btn btn-small" onclick="editarProducto(${prod.id_producto})">Editar</button>
                    <button class="btn btn-small secondary" onclick="eliminarProducto(${prod.id_producto})">Eliminar</button>
                </div>`;
            adminProductos.appendChild(div);
            // Si tenemos id_categoria pero no nombre resuelto, intentar obtenerlo en segundo plano
            if (!prod.categoria && prod.id_categoria) {
                (async () => {
                    try {
                        const res = await fetch('/api/categorias');
                        if (!res.ok) return;
                        const data = await res.json();
                        const cats = data.categorias || [];
                        const found = cats.find(c => Number(c.id_categoria) === Number(prod.id_categoria));
                        const span = document.getElementById(`prod-cat-${prod.id_producto}`);
                        if (span) span.textContent = found ? found.nombre : 'Sin categoría';
                    } catch (e) {
                        const span = document.getElementById(`prod-cat-${prod.id_producto}`);
                        if (span) span.textContent = 'Sin categoría';
                    }
                })();
            }
        });
    }
    
    // Función de búsqueda de productos (búsqueda local)
    const prodBuscar = document.getElementById('prodBuscar');
    if (prodBuscar) {
        prodBuscar.addEventListener('input', function() {
            const busqueda = this.value.toLowerCase().trim();
            if (busqueda === '') {
                renderProductos(todosLosProductos);
            } else {
                const filtrados = todosLosProductos.filter(prod => 
                    (prod.nombre && prod.nombre.toLowerCase().includes(busqueda)) ||
                    (prod.marca && prod.marca.toLowerCase().includes(busqueda)) ||
                    (prod.categoria && prod.categoria.toLowerCase().includes(busqueda))
                );
                renderProductos(filtrados);
            }
        });
    }
    
    // Cargar productos al iniciar si estamos en admin.html
    if (window.location.pathname.includes('admin.html')) {
        cargarProductos();
    }
    // (Ya está definida la versión funcional de window.editarProducto más arriba)
    window.eliminarProducto = async function(id) {
        if (!(await maxConfirm('¿Está seguro de que desea eliminar este producto?\n\nEsta acción no se puede deshacer.', { title: 'Eliminar producto', okText: 'Eliminar' }))) return;
        try {
            const res = await fetch(`/api/admin/productos/${id}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.ok || data.success) {
                alert('Producto eliminado correctamente');
                cargarProductos();
                if (typeof window.cargarProductosCompra === 'function') window.cargarProductosCompra();
                if (typeof window.cargarOpcionesPromocionForm === 'function') window.cargarOpcionesPromocionForm();
            } else {
                const mensaje = data.message || 'Error al eliminar producto';
                alert('❌ ' + mensaje);
            }
        } catch (e) {
            console.error('Error al eliminar producto:', e);
            alert('❌ Error de conexión al eliminar producto');
        }
    };
    // --- ADMINISTRADOR: Registro de Categorías ---
    const formCategoria = document.getElementById('form-categoria');
    const catalogoCategorias = document.getElementById('catalogoCategorias');
    const prodCategoria = document.getElementById('prodCategoria');
    let todasLasCategorias = [];
    
    window.cargarCategorias = async function cargarCategorias() {
        try {
            const res = await fetch('/api/categorias');
            const data = await res.json();
            todasLasCategorias = data.categorias || [];
            if (catalogoCategorias) {
                renderCategorias(todasLasCategorias);
            }
            if (prodCategoria) {
                prodCategoria.innerHTML = '<option value="">Selecciona Categoría</option>';
                todasLasCategorias.forEach(cat => {
                    const opt = document.createElement('option');
                    opt.value = cat.id_categoria;
                    opt.textContent = cat.nombre; 
                    prodCategoria.appendChild(opt);
                });
            }
        } catch {}
    }
    
    function renderCategorias(categorias) {
        if (!catalogoCategorias) return;
        catalogoCategorias.innerHTML = '';
        if (categorias.length === 0) {
            catalogoCategorias.innerHTML = '<div class="item">No hay categorías registradas.</div>';
            return;
        }
        categorias.forEach(cat => {
            const div = document.createElement('div');
            div.className = 'item';
            div.dataset.id = cat.id_categoria;
            div.innerHTML = `
                <span>${cat.nombre}</span>
                <div class="actions">
                    <button class='btn btn-small' onclick='editarCategoria(${cat.id_categoria}, "${cat.nombre}")'>Editar</button>
                    <button class='btn btn-small secondary' onclick='mostrarConfirmacion(${cat.id_categoria}, "categorias", "${cat.nombre}")'>Eliminar</button>
                </div>`;
            catalogoCategorias.appendChild(div);
        });
    }
    
    // Búsqueda de categorías
    const buscarCategoria = document.getElementById('buscarCategoria');
    if (buscarCategoria) {
        buscarCategoria.addEventListener('input', function() {
            const busqueda = this.value.toLowerCase().trim();
            if (busqueda === '') {
                renderCategorias(todasLasCategorias);
            } else {
                const filtradas = todasLasCategorias.filter(cat => 
                    cat.nombre && cat.nombre.toLowerCase().includes(busqueda)
                );
                renderCategorias(filtradas);
            }
        });
    }
    if (formCategoria) {
        formCategoria.addEventListener('submit', async (e) => {
            e.preventDefault();
            const nombre = document.getElementById('catNombre').value.trim();
            if (!nombre) return;
            try {
                const res = await fetch('/api/categorias', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nombre })
                });
                const data = await res.json();
                if (data.ok) {
                    formCategoria.reset();
                    // Recargar categorías en el catálogo
                    await cargarCategorias();
                    // Además actualizar otros componentes que dependen de categorías
                    // (productos, formularios de compra y opciones de promoción)
                    try {
                        if (typeof cargarProductos === 'function') cargarProductos();
                    } catch (e) { /* ignore */ }
                    try {
                        if (typeof cargarProductosCompra === 'function') cargarProductosCompra();
                    } catch (e) { /* ignore */ }
                    try {
                        if (typeof cargarOpcionesPromocionForm === 'function') cargarOpcionesPromocionForm();
                    } catch (e) { /* ignore */ }
                    try {
                        if (typeof cargarProductosCaja === 'function') cargarProductosCaja();
                    } catch (e) { /* ignore */ }
                } else {
                    alert('Error al crear categoría');
                }
            } catch { alert('Error de conexión'); }
        });
        cargarCategorias();
    }

    // --- ADMINISTRADOR: Registro de Proveedores ---
    const formProveedor = document.getElementById('form-proveedor');
    const catalogoProveedores = document.getElementById('catalogoProveedores');
    const prodProveedor = document.getElementById('prodProveedor');
    let todosLosProveedores = [];
    
    window.cargarProveedores = async function cargarProveedores() {
        try {
            const res = await fetch('/api/proveedores');
            const data = await res.json();
            todosLosProveedores = data.proveedores || [];
            if (catalogoProveedores) {
                renderProveedores(todosLosProveedores);
            }
            if (prodProveedor) {
                prodProveedor.innerHTML = '<option value="">Selecciona Proveedor</option>';
                todosLosProveedores.forEach(prov => {
                    const opt = document.createElement('option');
                    opt.value = prov.id_proveedor;
                    opt.textContent = prov.nombre;
                    prodProveedor.appendChild(opt);
                });
            }
        } catch {}
    }
    
    function renderProveedores(proveedores) {
        if (!catalogoProveedores) return;
        catalogoProveedores.innerHTML = '';
        if (proveedores.length === 0) {
            catalogoProveedores.innerHTML = '<div class="item">No hay proveedores registrados.</div>';
            return;
        }
        proveedores.forEach(prov => {
            const div = document.createElement('div');
            div.className = 'item';
            div.dataset.id = prov.id_proveedor;
            div.dataset.contacto = prov.contacto || '';
            div.dataset.telefono = prov.telefono || '';
            div.innerHTML = `
                <span><b>${prov.nombre}</b>${prov.contacto ? ` | Contacto: ${prov.contacto}` : ''}${prov.telefono ? ` | Tel: ${prov.telefono}` : ''}</span>
                <div class="actions">
                    <button class='btn btn-small' onclick='editarProveedor(${prov.id_proveedor}, ${JSON.stringify({nombre: prov.nombre, contacto: prov.contacto, telefono: prov.telefono})})'>Editar</button>
                    <button class='btn btn-small secondary' onclick='mostrarConfirmacion(${prov.id_proveedor}, "proveedores", "${prov.nombre}")'>Eliminar</button>
                </div>`;
            catalogoProveedores.appendChild(div);
        });
    }
    
    // Búsqueda de proveedores
    const buscarProveedor = document.getElementById('buscarProveedor');
    if (buscarProveedor) {
        buscarProveedor.addEventListener('input', function() {
            const busqueda = this.value.toLowerCase().trim();
            if (busqueda === '') {
                renderProveedores(todosLosProveedores);
            } else {
                const filtrados = todosLosProveedores.filter(prov => 
                    (prov.nombre && prov.nombre.toLowerCase().includes(busqueda)) ||
                    (prov.contacto && prov.contacto.toLowerCase().includes(busqueda)) ||
                    (prov.telefono && prov.telefono.includes(busqueda))
                );
                renderProveedores(filtrados);
            }
        });
    }
    if (formProveedor) {
        formProveedor.addEventListener('submit', async (e) => {
            e.preventDefault();
            const nombre = document.getElementById('provNombre').value.trim();
            const contacto = document.getElementById('provContacto').value.trim();
            const telefono = document.getElementById('provTelefono').value.trim();
            if (!nombre) return;
            try {
                const res = await fetch('/api/proveedores', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nombre, contacto, telefono })
                });
                const data = await res.json();
                if (data.ok) {
                    formProveedor.reset();
                    cargarProveedores();
                } else {
                    alert('Error al crear proveedor');
                }
            } catch { alert('Error de conexión'); }
        });
        cargarProveedores();
    }
    // --- ADMINISTRADOR: Registro de Productos ---
    const formProductoAdmin = document.getElementById('form-producto-admin');
    const prodImagenInput = document.getElementById('prodImagen');

    /** En Electron, alert()/confirm() dejan la ventana sin teclado hasta hacer clic en el chrome. */
    function recoverKeyboardFocus(preferId) {
        try {
            if (typeof window.focus === 'function') window.focus();
            const ae = document.activeElement;
            if (ae && typeof ae.blur === 'function') ae.blur();
            setTimeout(() => {
                const el = (preferId && document.getElementById(preferId))
                    || document.getElementById('prodNombre')
                    || document.querySelector('#form-producto-admin input:not([type="file"]):not([type="hidden"])');
                if (el && typeof el.focus === 'function') {
                    try { el.focus({ preventScroll: true }); } catch (_) { el.focus(); }
                }
            }, 40);
        } catch (_) {}
    }
    window.recoverKeyboardFocus = recoverKeyboardFocus;

    function showAdminToast(message, kind) {
        let el = document.getElementById('adminToastMsg');
        if (!el) {
            el = document.createElement('div');
            el.id = 'adminToastMsg';
            el.setAttribute('role', 'status');
            el.style.cssText = [
                'position:fixed', 'bottom:24px', 'right:24px', 'z-index:99999',
                'max-width:440px', 'padding:14px 18px', 'border-radius:10px',
                'box-shadow:0 10px 28px rgba(15,23,42,.22)',
                'font:500 14px/1.45 "DM Sans",system-ui,sans-serif',
                'color:#fff', 'opacity:0', 'transition:opacity .2s ease',
                'pointer-events:none', 'white-space:pre-wrap'
            ].join(';');
            document.body.appendChild(el);
        }
        const bg = kind === 'error' ? '#b91c1c' : (kind === 'warn' ? '#b45309' : '#15803d');
        el.style.background = bg;
        el.textContent = String(message || '');
        el.style.opacity = '1';
        clearTimeout(el._hideTimer);
        el._hideTimer = setTimeout(() => { el.style.opacity = '0'; }, 4800);
    }
    window.showAdminToast = showAdminToast;

    function clearProdImagenPreview() {
        const wrap = document.getElementById('prodImagenPreview');
        const img = document.getElementById('prodImagenPreviewImg');
        if (img && img.src && String(img.src).startsWith('blob:')) {
            try { URL.revokeObjectURL(img.src); } catch (_) {}
            img.removeAttribute('src');
        }
        if (wrap) wrap.style.display = 'none';
        if (prodImagenInput) prodImagenInput.value = '';
    }

    function normProdKey(s) {
        return String(s || '').trim().toLowerCase();
    }
    function findProductoExistenteLocal(nombre, marca, categoriaId) {
        const list = (Array.isArray(todosLosProductos) && todosLosProductos.length)
            ? todosLosProductos
            : (Array.isArray(window._adminProductosCache) ? window._adminProductosCache : []);
        const n = normProdKey(nombre);
        const m = normProdKey(marca || 'Genérico');
        const c = String(categoriaId || '');
        return list.find((p) =>
            normProdKey(p.nombre) === n &&
            normProdKey(p.marca || 'Genérico') === m &&
            String(p.id_categoria) === c
        ) || null;
    }
    function refreshProdExistenteHint() {
        const nombre = (document.getElementById('prodNombre') || {}).value || '';
        const marca = (document.getElementById('prodMarca') || {}).value || 'Genérico';
        const categoria = (document.getElementById('prodCategoria') || {}).value || '';
        const hint = document.getElementById('prodExistenteHint');
        const reqMark = document.getElementById('prodImagenReqMark');
        const imgInput = document.getElementById('prodImagen');
        if (!nombre.trim() || !categoria) {
            if (hint) { hint.style.display = 'none'; hint.textContent = ''; }
            if (reqMark) reqMark.style.display = '';
            if (imgInput) imgInput.required = false;
            return null;
        }
        const exist = findProductoExistenteLocal(nombre, marca, categoria);
        if (exist) {
            if (hint) {
                hint.style.display = 'block';
                hint.innerHTML = `Ya existe <b>${exist.nombre}</b> (ID ${exist.id_producto}). Al guardar: <b>se suma el stock</b>, se actualiza el <b>precio base</b> y <b>no hace falta imagen</b>.`;
            }
            if (reqMark) reqMark.style.display = 'none';
            if (imgInput) imgInput.required = false;
            return exist;
        }
        if (hint) { hint.style.display = 'none'; hint.textContent = ''; }
        if (reqMark) reqMark.style.display = '';
        if (imgInput) imgInput.required = false;
        return null;
    }
    ['prodNombre', 'prodMarca', 'prodCategoria'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', refreshProdExistenteHint);
            el.addEventListener('change', refreshProdExistenteHint);
        }
    });

    if (prodImagenInput) {
        prodImagenInput.addEventListener('change', async () => {
            const file = prodImagenInput.files && prodImagenInput.files[0];
            const wrap = document.getElementById('prodImagenPreview');
            const img = document.getElementById('prodImagenPreviewImg');
            const dupHint = document.getElementById('prodImagenDupHint');
            if (dupHint) { dupHint.style.display = 'none'; dupHint.textContent = ''; }
            if (file && wrap && img) {
                if (img.src && String(img.src).startsWith('blob:')) {
                    try { URL.revokeObjectURL(img.src); } catch (_) {}
                }
                img.src = URL.createObjectURL(file);
                wrap.style.display = 'block';
                // Advertencia temprana: misma imagen que otro producto
                try {
                    const fd = new FormData();
                    fd.append('imagen', file);
                    const existente = refreshProdExistenteHint();
                    if (existente && existente.id_producto) {
                        fd.append('exclude_id', String(existente.id_producto));
                    }
                    const res = await fetch('/api/productos/check-imagen', {
                        method: 'POST',
                        credentials: 'include',
                        body: fd
                    });
                    const data = await res.json().catch(() => ({}));
                    if (data && data.duplicada) {
                        const msg = data.mensaje || 'Esa imagen ya está en otro producto';
                        if (dupHint) {
                            dupHint.style.display = 'block';
                            dupHint.textContent = msg;
                        }
                        showAdminToast(msg, 'warn');
                        recoverKeyboardFocus('prodNombre');
                    }
                } catch (_) {}
            } else if (wrap) {
                wrap.style.display = 'none';
            }
        });
    }
    if (formProductoAdmin) {
        const prodBc = document.getElementById('prodCodigoBarras');
        const prodBcClear = document.getElementById('prodCodigoBarrasClear');
        if (prodBc) {
            prodBc.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    prodBc.blur();
                    prodBc.focus();
                }
            });
        }
        if (prodBcClear && prodBc) {
            prodBcClear.addEventListener('click', () => {
                prodBc.value = '';
                prodBc.focus();
            });
        }
        formProductoAdmin.addEventListener('submit', async (e) => {
            e.preventDefault();
            const marca = (document.getElementById('prodMarca').value.trim() || 'Genérico');
            const categoria = document.getElementById('prodCategoria').value;
            const proveedor = document.getElementById('prodProveedor').value || '';
            const nombre = document.getElementById('prodNombre').value.trim();
            const precio = parseFloat(document.getElementById('prodPrecio').value);
            const codigo_barras = (document.getElementById('prodCodigoBarras') || {}).value || '';
            const stock_minimo = (document.getElementById('prodStockMinimo') || {}).value || '0';
            const inventario = parseFloat((document.getElementById('prodStock') || {}).value || '0') || 0;
            const unidad_medida = (document.getElementById('prodUnidad') || {}).value || 'UNIDAD';
            const unidades_por_empaque = (document.getElementById('prodUnidadesEmpaque') || {}).value || '';
            const imagenFile = prodImagenInput && prodImagenInput.files && prodImagenInput.files[0];
            const cantidades = [];
            if (!categoria || !nombre || isNaN(precio)) {
                showAdminToast('Completa nombre, categoría y precio.', 'error');
                recoverKeyboardFocus('prodNombre');
                return;
            }
            if ((unidad_medida === 'CAJA' || unidad_medida === 'PAQUETE') && !(parseFloat(unidades_por_empaque) > 0)) {
                showAdminToast(unidad_medida === 'PAQUETE'
                  ? 'Indica cuántas unidades trae cada paquete.'
                  : 'Indica cuántas unidades trae cada caja.', 'error');
                recoverKeyboardFocus('prodUnidadesEmpaque');
                return;
            }
            const existente = refreshProdExistenteHint();
            // Si parece nuevo y no hay imagen, igual enviamos: el servidor decide.
            // Solo avisamos en cliente cuando sabemos que es nuevo.
            if (!existente && !imagenFile) {
                // no bloquear si el listado aún no cargó; el API valida
            }
            const btnCrear = document.getElementById('btnCrearProd');
            if (btnCrear) btnCrear.disabled = true;
            try {
                const fd = new FormData();
                fd.append('marca', marca);
                fd.append('categoria', categoria);
                fd.append('proveedor', proveedor);
                fd.append('nombre', nombre);
                fd.append('precio', String(precio));
                fd.append('inventario', String(inventario));
                fd.append('cantidades', JSON.stringify(cantidades));
                fd.append('codigo_barras', codigo_barras.trim());
                fd.append('stock_minimo', String(stock_minimo));
                fd.append('unidad_medida', unidad_medida);
                if (unidades_por_empaque) fd.append('unidades_por_empaque', String(unidades_por_empaque));
                if (imagenFile) fd.append('imagen', imagenFile);
                const res = await fetch('/api/productos', {
                    method: 'POST',
                    credentials: 'include',
                    body: fd
                });
                const data = await res.json();
                if (data.ok) {
                    if (data.actualizado) {
                        showAdminToast(`Producto existente actualizado (ID ${data.id_producto}). Se sumó el stock y se guardó el nuevo precio base.`, 'ok');
                    } else {
                        showAdminToast(`Producto nuevo guardado (ID ${data.id_producto}). Unidad: ${unidad_medida}`, 'ok');
                    }
                    formProductoAdmin.reset();
                    clearProdImagenPreview();
                    const hint = document.getElementById('prodExistenteHint');
                    if (hint) { hint.style.display = 'none'; hint.textContent = ''; }
                    const dupHint = document.getElementById('prodImagenDupHint');
                    if (dupHint) { dupHint.style.display = 'none'; dupHint.textContent = ''; }
                    if (typeof cargarProductos === 'function') cargarProductos();
                    if (typeof window.cargarAdminProductos === 'function') window.cargarAdminProductos();
                    if (typeof window.cargarProductosCompra === 'function') window.cargarProductosCompra();
                    if (typeof window.cargarOpcionesPromocionForm === 'function') window.cargarOpcionesPromocionForm();
                    recoverKeyboardFocus('prodNombre');
                } else {
                    const errMsg = data.error || data.message || 'No se pudo guardar';
                    showAdminToast(errMsg, data.imagen_duplicada ? 'warn' : 'error');
                    if (data.imagen_duplicada) clearProdImagenPreview();
                    recoverKeyboardFocus(data.imagen_duplicada ? 'prodImagen' : 'prodNombre');
                }
            } catch (err) {
                showAdminToast('Error de conexión al guardar producto.', 'error');
                recoverKeyboardFocus('prodNombre');
            } finally {
                if (btnCrear) btnCrear.disabled = false;
            }
        });
    }

    // --- CAJA: Registro de Ventas ---
    
    // 1. Elementos del DOM y variables de estado para CAJA
    const loginSection = document.getElementById('loginSection');
    const loginBtn = document.getElementById('loginBtn');
    const usuarioEl = document.getElementById('usuario');
    const passwordEl = document.getElementById('password');
    const loginMsg = document.getElementById('loginMsg');
    const statusDisplay = document.getElementById('statusDisplay');
    const logoutBtn = document.getElementById('logoutBtn'); 
    
    // Elementos del formulario de Venta
    const formVentaCaja = document.getElementById('form-venta-caja');
    const inputCedula = document.getElementById('ventaClienteCedula');
    const inputNombre = document.getElementById('ventaClienteNombre');
    const inputTelefono = document.getElementById('ventaClienteTelefono');
    const inputEmail = document.getElementById('ventaClienteEmail');
    const selectProducto = document.getElementById('ventaProducto');
    const selectCategoria = document.getElementById('ventaCategoria');
    const selectTalla = document.getElementById('ventaTalla');
    const inputCantidad = document.getElementById('ventaCantidad');
    const inputPrecioUnitario = document.getElementById('ventaPrecioUnitario');
    const inputTotalDolar = document.getElementById('ventaTotalDolar');
    const inputTotalBs = document.getElementById('ventaTotalBs');
    const btnAgregarProducto = document.getElementById('btnAgregarProducto');
    const ventaDetalle = document.getElementById('ventaDetalle');
    const btnPagarVenta = document.getElementById('btnPagarVenta');
    const selectTipoPago = document.getElementById('ventaTipoPago'); // CORRECCIÓN 1: Referencia a elemento DOM
    
    let carrito = [];
    let productosDisponibles = []; // CORRECCIÓN 2: Declaración de la variable
    let categoriasDisponibles = [];
    let categoriaMap = {};

    const LOGIN_FORM_HTML = `
        <h2>Acceso al sistema</h2>
        <p class="login-sub">Administración y puntos de venta</p>
        <form id="loginForm" autocomplete="on">
          <div class="field">
            <label for="usuario">Usuario</label>
            <input type="text" id="usuario" name="usuario" placeholder="Usuario" autocomplete="username" required>
          </div>
          <div class="field">
            <label for="password">Contraseña</label>
            <input type="password" id="password" name="password" placeholder="Contraseña" autocomplete="current-password" required>
          </div>
          <button type="submit" id="loginBtn" class="btn primary">Entrar</button>
          <div id="loginMsg" class="msg"></div>
        </form>
    `;

    function isMobileUa() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || '');
    }

    function normalizeRol(rol) {
        return String(rol || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    function bindLoginForm() {
        const form = document.getElementById('loginForm');
        const btn = document.getElementById('loginBtn');
        const u = document.getElementById('usuario');
        const p = document.getElementById('password');
        if (form) {
            form.addEventListener('submit', doLogin);
        } else if (btn) {
            btn.addEventListener('click', doLogin);
            [u, p].forEach((el) => {
                if (el) el.addEventListener('keydown', (ev) => {
                    if (ev.key === 'Enter') {
                        ev.preventDefault();
                        doLogin(ev);
                    }
                });
            });
        }
        if (u) setTimeout(() => u.focus(), 50);
    }

    function restoreLoginForm(msgText, msgColor) {
        if (!loginSection) return;
        loginSection.style.display = 'block';
        loginSection.innerHTML = LOGIN_FORM_HTML;
        bindLoginForm();
        const msg = document.getElementById('loginMsg');
        if (msg && msgText) {
            msg.textContent = msgText;
            msg.style.color = msgColor || '#3b82f6';
        }
    }

    function goToPanelForRol(rolRaw) {
        const rol = normalizeRol(rolRaw);
        if (rol === 'administrador' || rol === 'admin') {
            window.location.href = 'admin.html';
            return;
        }
        if (rol === 'caja') {
            if (isMobileUa()) {
                alert('Desde el teléfono la caja no está disponible. Usa Admin (consulta) o entra desde la PC.');
                return;
            }
            window.location.href = 'caja.html';
            return;
        }
        alert('Tu rol no tiene un panel de destino definido.');
    }

    /**
     * Cierra sesión de verdad y vuelve al formulario (sin quedarse atrapado).
     */
    async function handleLogout() {
        const msgEl = document.getElementById('loginMsg');
        if (msgEl) {
            msgEl.textContent = 'Cerrando sesión...';
            msgEl.style.color = '#64748b';
        }
        try {
            await fetch('/api/logout', {
                method: 'POST',
                credentials: 'include',
                cache: 'no-store',
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (e) {
            console.error('Error al intentar cerrar sesión:', e);
        }
        try {
            // Limpieza local (por si quedan restos de PWA / storage)
            localStorage.removeItem('pos_token_sesion');
            localStorage.removeItem('pos_id_caja');
            localStorage.removeItem('pos_nombre_caja');
            sessionStorage.clear();
        } catch (_) {}
        // Recarga forzada: evita quedar con la pantalla "Sesión activa"
        window.location.replace('index.html?logout=' + Date.now());
    }

    /**
     * Función que chequea el estado del servidor y la sesión.
     * @param {boolean} shouldRedirect - Si es true, redirige al usuario según su rol si está autenticado.
     */
    async function checkStatus(shouldRedirect = false) {
        if (!statusDisplay || !loginSection) return;

        statusDisplay.textContent = 'Cargando estado...';
        statusDisplay.style.color = 'gray';
        const msgEl = document.getElementById('loginMsg');
        if (msgEl) msgEl.textContent = '';
        
        try {
            const res = await fetch('/api/status', { credentials: 'include', cache: 'no-store' });
            const data = await res.json();
            
            const servidorStatus = data.servidor ? 'Servidor: ✅ OK' : 'Servidor: ❌ FAIL';
            const bdStatus = data.bd ? 'BD: ✅ OK' : 'BD: ❌ FAIL';
            statusDisplay.textContent = `${servidorStatus} | ${bdStatus}`;
            statusDisplay.style.color = (data.servidor && data.bd) ? '#10b981' : '#ef4444'; 
            
            if (data.servidor && data.bd && data.usuario) {
                const rol = normalizeRol(data.rol);
                
                if (shouldRedirect) {
                    if (data.mobile_blocked) {
                        const m = document.getElementById('loginMsg');
                        if (m) {
                            m.textContent = data.error || 'Desde el teléfono solo el administrador.';
                            m.style.color = '#ef4444';
                        }
                        return;
                    }
                    if (rol === 'administrador' || rol === 'admin') {
                        window.location.href = 'admin.html';
                    } else if (rol === 'caja') {
                        if (isMobileUa()) {
                            const m = document.getElementById('loginMsg');
                            if (m) {
                                m.textContent = 'Desde el teléfono solo puede entrar el administrador (solo consulta).';
                                m.style.color = '#ef4444';
                            }
                            return;
                        }
                        window.location.href = 'caja.html';
                    } else {
                        displayActiveSession(data, rol);
                    }
                } else {
                    displayActiveSession(data, rol);
                }
            } else {
                // Sin sesión: asegurar formulario de login visible
                if (!document.getElementById('loginForm')) {
                    restoreLoginForm('Introduce tus credenciales para continuar.', '#3b82f6');
                } else {
                    loginSection.style.display = 'block';
                    const m = document.getElementById('loginMsg');
                    if (m && !m.textContent) {
                        m.textContent = 'Introduce tus credenciales para continuar.';
                        m.style.color = '#3b82f6';
                    }
                }
            }
        } catch (e) {
            statusDisplay.textContent = 'Servidor: ❌ OFFLINE | BD: ❌ DESCONOCIDA';
            statusDisplay.style.color = '#ef4444';
            const m = document.getElementById('loginMsg');
            if (m) {
                m.textContent = 'Error: No se pudo conectar con el servidor. Revise Node.js.';
                m.style.color = '#ef4444';
            }
            console.error('Fallo grave de conexión:', e);
        }
    }

    function displayActiveSession(data, rol) {
        if (!loginSection) return;
        const rolNorm = normalizeRol(rol || data.rol);
        const esAdmin = rolNorm === 'administrador' || rolNorm === 'admin';
        const esCaja = rolNorm === 'caja';
        const panelLabel = esCaja ? 'Continuar a Caja' : (esAdmin ? 'Continuar a Admin' : 'Continuar sesión');

        loginSection.style.display = 'block';
        loginSection.innerHTML = `
            <h2 style="color:#2563eb;margin:0 0 8px;">Sesión activa</h2>
            <p style="padding:14px 16px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;margin:0 0 14px;line-height:1.45;color:#0f172a;">
              Ya hay una sesión en esta computadora:<br>
              <strong>${data.usuario || 'Usuario'}</strong>
              <span style="color:#64748b;"> · ${data.rol || rol || 'Usuario'}</span>
            </p>
            <button type="button" id="goToPanelBtn" class="btn primary" style="width:100%;margin-top:4px;">${panelLabel}</button>
            <button type="button" id="logoutDummyBtn" class="btn secondary" style="width:100%;margin-top:10px;background:#f1f5f9;color:#0f172a;border:1px solid #cbd5e1;">Cerrar sesión completa</button>
            <p style="margin:12px 0 0;font-size:0.85rem;color:#64748b;line-height:1.4;">
              Para entrar a <strong>Caja</strong> con otro usuario, cierra la sesión y vuelve a iniciar con el usuario de caja.
            </p>
            <div id="loginMsg" class="msg" style="margin-top:10px;"></div>
        `;

        const logoutDummyBtn = document.getElementById('logoutDummyBtn');
        const goToPanelBtn = document.getElementById('goToPanelBtn');
        if (logoutDummyBtn) logoutDummyBtn.addEventListener('click', handleLogout);
        if (goToPanelBtn) {
            goToPanelBtn.addEventListener('click', () => goToPanelForRol(data.rol || rol));
        }
    }

    async function doLogin(e) {
        if (e) e.preventDefault();
        const usuarioEl2 = document.getElementById('usuario');
        const passwordEl2 = document.getElementById('password');
        const loginMsg2 = document.getElementById('loginMsg');
        if (!usuarioEl2 || !passwordEl2) return;
        const usuario = usuarioEl2.value.trim();
        const password = passwordEl2.value.trim();
        if (loginMsg2) loginMsg2.textContent = '';

        if (!usuario || !password) {
            if (loginMsg2) {
                loginMsg2.textContent = 'Ingresa usuario y contraseña';
                loginMsg2.style.color = '#ef4444';
            }
            return;
        }

        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                cache: 'no-store',
                body: JSON.stringify({ usuario, password }),
            });
            const data = await res.json();
            if (data.ok) {
                if (loginMsg2) {
                    loginMsg2.textContent = 'Login exitoso, redirigiendo...';
                    loginMsg2.style.color = '#10b981';
                }
                await checkStatus(true);
            } else {
                if (loginMsg2) {
                    loginMsg2.textContent = data.error || 'Error de login. Credenciales inválidas.';
                    loginMsg2.style.color = '#ef4444';
                }
                passwordEl2.value = '';
                passwordEl2.focus();
            }
        } catch (err) {
            if (loginMsg2) {
                loginMsg2.textContent = 'Error de conexión con el servidor.';
                loginMsg2.style.color = '#ef4444';
            }
        }
    }

    // 4. Eventos de login inicial
    bindLoginForm();

    // 5. Inicialización
    (async function bootLogin() {
        const params = new URLSearchParams(location.search || '');
        if (params.has('logout') || params.has('forceLogout')) {
            try {
                await fetch('/api/logout', {
                    method: 'POST',
                    credentials: 'include',
                    cache: 'no-store',
                    headers: { 'Content-Type': 'application/json' }
                });
            } catch (_) {}
            try {
                history.replaceState({}, '', 'index.html');
            } catch (_) {}
            restoreLoginForm('Sesión cerrada. Entra con el usuario de caja o admin.', '#10b981');
            // Verificar que ya no haya sesión; si quedó, forzar formulario igual
            try {
                const res = await fetch('/api/status', { credentials: 'include', cache: 'no-store' });
                const data = await res.json();
                if (data && data.usuario) {
                    // Cookie vieja aún viva: mostrar formulario de todos modos y avisar
                    restoreLoginForm('Cierra MAX, borra la sesión y vuelve a abrir. O entra aquí si ya limpió.', '#b45309');
                }
            } catch (_) {}
            return;
        }
        checkStatus(false);
    })();
    
    // 6. Logout en admin/caja
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }
    
    // --- CAJA: Lógica de Ventas ---
    if (formVentaCaja) {
        // Si existe el módulo avanzado de caja, delegar toda la lógica de carrito/render a él
        // para evitar que este archivo sobrescriba el DOM del carrito y oculte promociones.
        if (typeof window !== 'undefined' && window._caja && typeof window._caja.renderCart === 'function') {
            console.log('[cliente.js] Delegando lógica de carrito a caja-funcionalidades.js');
            // Aún así, mantener autocompletar de cliente y botones de logout fuera del flujo del carrito
            // y no registrar los listeners de carrito/venta aquí.
            return;
        }
        // Autocompletar datos del cliente al ingresar la cédula
        inputCedula.addEventListener('blur', async () => {
            const cedula = inputCedula.value.trim();
            if (!cedula) return;
            try {
                // Incluir credenciales (cookies de sesión) para rutas protegidas
                const res = await fetch(`/api/clientes/buscar?cedula=${encodeURIComponent(cedula)}`, { credentials: 'include' });
                if (!res.ok) {
                    // Si no está autenticado o hay error, no sobreescribir campos
                    console.warn('No se pudo buscar cliente (estado:', res.status, ')');
                    return;
                }
                const data = await res.json();
                if (data && data.cliente) {
                    inputNombre.value = data.cliente.nombre || '';
                    if (inputTelefono) inputTelefono.value = data.cliente.telefono || '';
                    if (inputEmail) inputEmail.value = data.cliente.email || '';
                } else {
                    // No existe: dejar los campos para que el cajero los complete
                    inputNombre.value = '';
                    if (inputTelefono) inputTelefono.value = '';
                    if (inputEmail) inputEmail.value = '';
                }
            } catch (err) {
                console.error('Error buscando cliente por cédula:', err);
            }
        });
        // Actualizar totales automáticamente
        const precioUnitario = document.getElementById('ventaPrecioUnitario');
        const cantidad = document.getElementById('ventaCantidad');
        const totalDolar = document.getElementById('ventaTotalDolar');
        const totalBs = document.getElementById('ventaTotalBs');

        async function actualizarTotales() {
            const precio = parseFloat(precioUnitario.value) || 0;
            const cant = parseInt(cantidad.value) || 0;
            const total = precio * cant;
            totalDolar.value = total.toFixed(2);
            let tasa = 0;
            try {
                const res = await fetch('/api/tasa-bcv');
                const data = await res.json();
                if (data.tasa) tasa = parseFloat(data.tasa);
            } catch {}
            if (!(tasa > 0)) {
                totalBs.value = '';
                if (document.getElementById('ventaPrecioUnitarioBs')) {
                    document.getElementById('ventaPrecioUnitarioBs').value = '';
                }
                return;
            }
            const precioUnitBs = precio * tasa;
            if (document.getElementById('ventaPrecioUnitarioBs')) {
                document.getElementById('ventaPrecioUnitarioBs').value = precioUnitBs.toFixed(2);
            }
            totalBs.value = (total * tasa).toFixed(2);
        }
        precioUnitario.addEventListener('input', actualizarTotales);
        cantidad.addEventListener('input', actualizarTotales);

        // Cargar productos disponibles en el select (CAJA) -> usar endpoint público /api/productos
        async function cargarProductosCaja() {
            try {
                const [res, cRes] = await Promise.all([fetch('/api/productos'), fetch('/api/categorias')]);
                const data = await res.json();
                const cData = await cRes.json();
                const cats = (cData && cData.categorias) ? cData.categorias : [];
                categoriasDisponibles = cats;
                categoriaMap = {};
                cats.forEach(c => { categoriaMap[c.id_categoria] = c.nombre; });
                productosDisponibles = data.productos || [];
                selectProducto.innerHTML = '<option value="">Selecciona producto</option>';
                // Llenar select de categorías global para el cajero
                if (selectCategoria) {
                    selectCategoria.innerHTML = '<option value="">Selecciona categoría</option>';
                    cats.forEach(c => {
                        selectCategoria.innerHTML += `<option value="${c.id_categoria}">${c.nombre}</option>`;
                    });
                }
                productosDisponibles.forEach(prod => {
                    const catName = prod.id_categoria ? (categoriaMap[prod.id_categoria] || '') : '';
                    const label = `${prod.marca || ''} - ${prod.nombre}${catName ? ' | ' + catName : ''}`;
                    // incluir data-cat para facilitar preselección
                    selectProducto.innerHTML += `<option value="${prod.id_producto}" data-precio="${prod.precio_venta}" data-nombre="${prod.nombre}" data-marca="${prod.marca}" data-cat="${prod.id_categoria || ''}">${label}</option>`;
                });
            } catch {}
        }
        cargarProductosCaja();

        // Al cambiar el producto, obtener su información completa (precio, tallas, categoría)
        selectProducto.addEventListener('change', async () => {
            const option = selectProducto.selectedOptions[0];
            if (option) {
                const idProd = option.value;
                // cargarTallasPorProducto devuelve el objeto producto si es exitoso
                const prod = await cargarTallasPorProducto(idProd);
                if (prod) {
                    inputPrecioUnitario.value = prod.precio_venta || option.getAttribute('data-precio') || '';
                    if (selectCategoria) selectCategoria.value = prod.id_categoria || '';
                } else {
                    // fallback a datos embebidos en la opción
                    const precio = option.getAttribute('data-precio');
                    inputPrecioUnitario.value = precio || '';
                    if (selectCategoria) {
                        const prodCat = option.getAttribute('data-cat');
                        selectCategoria.value = prodCat || '';
                    }
                }
                await actualizarTotales();
            } else {
                inputPrecioUnitario.value = '';
                document.getElementById('ventaPrecioUnitarioBs').value = '';
                selectTalla.innerHTML = '<option value="">Selecciona talla</option>';
                if (selectCategoria) selectCategoria.value = '';
            }
        });

        // Cargar tallas disponibles para el producto seleccionado usando GET /api/productos/:id (público para caja)
        // Devuelve el objeto producto (o null) para que el llamador pueda usar id_categoria/precio_venta
        async function cargarTallasPorProducto(idProducto) {
            if (!idProducto) {
                selectTalla.innerHTML = '<option value="">Selecciona talla</option>';
                return null;
            }
            try {
                const res = await fetch(`/api/productos/${encodeURIComponent(idProducto)}`);
                const data = await res.json();
                const prod = data.producto || null;
                const tallas = prod ? prod.tallas : [];
                selectTalla.innerHTML = '<option value="">Selecciona talla</option>';
                tallas.forEach(talla => {
                    selectTalla.innerHTML += `<option value="${talla.id_talla}" data-cantidad="${talla.cantidad}">${talla.nombre} (${talla.cantidad} disponibles)</option>`;
                });
                return prod;
            } catch (e) {
                selectTalla.innerHTML = '<option value="">Error al cargar tallas</option>';
                return null;
            }
        }

        btnAgregarProducto.addEventListener('click', async () => {
            const idProd = selectProducto.value;
            const idTalla = selectTalla.value;
            const optTalla = selectTalla.selectedOptions[0];
            const optProd = selectProducto.selectedOptions[0];
            const nombreProd = optProd ? optProd.getAttribute('data-nombre') : '';
            const marcaProd = optProd ? optProd.getAttribute('data-marca') : '';
            let idCategoriaSeleccionada = selectCategoria ? (selectCategoria.value || null) : null;
            const nombreTalla = optTalla ? optTalla.textContent.replace(/\s*\(\d+\s+disponibles\)/, '').trim() : '';
            const cantidadVal = parseInt(inputCantidad.value) || 0;
            const maxCant = optTalla ? parseInt(optTalla.getAttribute('data-cantidad')) : 0;
            const precio = parseFloat(inputPrecioUnitario.value) || 0;
            
            if (!idProd || !idTalla) {
                alert('Selecciona producto y talla.');
                return;
            }
            if (cantidadVal < 1) {
                alert('Ingresa una cantidad válida.');
                return;
            }
            if (cantidadVal > maxCant) {
                alert(`Cantidad solicitada (${cantidadVal}) supera el stock disponible (${maxCant}).`);
                return;
            }
            // Si no se seleccionó categoría, intentar obtenerla desde el producto servidor
            if (!idCategoriaSeleccionada) {
                try {
                    const prod = await cargarTallasPorProducto(idProd);
                    if (prod && prod.id_categoria) idCategoriaSeleccionada = prod.id_categoria;
                } catch (e) {}
            }
            // Requerir categoría: según tu regla, sin categoría no puede haber precio ni talla
            if (!idCategoriaSeleccionada) {
                alert('Este producto no tiene categoría. Selecciona la categoría antes de agregar al carrito.');
                return;
            }

            // Incluir idProd, idTalla e idCategoria en el carrito
            carrito.push({ idProd, nombreProd, marcaProd, idTalla, nombreTalla, cantidad: cantidadVal, precio, idCategoria: idCategoriaSeleccionada });
            renderCarrito();
            // Limpiar campos
            selectProducto.value = '';
            selectTalla.innerHTML = '<option value="">Selecciona talla</option>';
            if (selectCategoria) selectCategoria.value = '';
            inputCantidad.value = '';
            inputPrecioUnitario.value = '';
            if (document.getElementById('ventaPrecioUnitarioBs')) document.getElementById('ventaPrecioUnitarioBs').value = '';
            inputTotalDolar.value = '';
            inputTotalBs.value = '';
        });

        function renderCarrito() {
            ventaDetalle.innerHTML = '';
            let subtotal = 0;
            if (carrito.length === 0) {
                ventaDetalle.innerHTML = '<div class="item">Carrito vacío. Agrega productos para la venta.</div>';
                return;
            }
            carrito.forEach((item, idx) => {
                const totalItem = item.precio * item.cantidad;
                subtotal += totalItem;
                const catName = item.idCategoria ? (categoriaMap[item.idCategoria] || '') : '';
                const catLabel = catName ? ` | Categoria: ${catName}` : '';
                ventaDetalle.innerHTML += `<div class="item">${item.marcaProd} - ${item.nombreProd}${catLabel} - ${item.nombreTalla} x${item.cantidad} ($${totalItem.toFixed(2)}) <button class='btn danger' style='background:#ef4444;color:#fff;margin-left:10px;' onclick='eliminarDelCarrito(${idx})'>Eliminar</button></div>`;
            });
            ventaDetalle.innerHTML += `<div class="item" style="border-top: 1px solid #ccc; margin-top: 10px; padding-top: 10px;"><b>Total Carrito: $${subtotal.toFixed(2)}</b></div>`;
        }

        window.eliminarDelCarrito = function(index) {
            carrito.splice(index, 1);
            renderCarrito();
        };

        btnPagarVenta.addEventListener('click', async () => {
            // Obtener datos del cliente (Uso seguro de referencias)
            const cliente_nombre = inputNombre.value.trim();
            const cliente_cedula = inputCedula.value.trim();
            const cliente_telefono = inputTelefono ? inputTelefono.value.trim() : '';
            const cliente_email = inputEmail ? inputEmail.value.trim() : '';
            const tipo_pago = selectTipoPago ? selectTipoPago.value : '';
            
            if (!cliente_nombre || !cliente_cedula || carrito.length === 0 || !tipo_pago) {
                alert('Completa todos los campos del cliente, agrega productos al carrito y selecciona el tipo de pago.');
                return;
            }
            // 1) Validar stock actual PARA TODO EL CARRITO antes de enviar cualquier venta.
            try {
                for (const item of carrito) {
                    // Obtener estado actual del producto (incluye tallas)
                    const resCheck = await fetch(`/api/productos/${encodeURIComponent(item.idProd)}`);
                    if (!resCheck.ok) {
                        alert('Error al verificar stock de productos. Intenta de nuevo.');
                        return;
                    }
                    const dataCheck = await resCheck.json();
                    const tallas = dataCheck.producto ? dataCheck.producto.tallas : [];
                    const t = tallas.find(tt => String(tt.id_talla) === String(item.idTalla) || tt.id_talla == item.idTalla);
                    const disponible = t ? Number(t.cantidad) : 0;
                    if (disponible === 0) {
                        alert(`No hay unidades disponibles para ${item.marcaProd} - ${item.nombreProd} (${item.nombreTalla}). La venta fue cancelada.`);
                        return;
                    }
                    if (disponible < item.cantidad) {
                        alert(`Stock insuficiente para ${item.marcaProd} - ${item.nombreProd} (${item.nombreTalla}). Disponible: ${disponible}. Ajusta la cantidad.`);
                        return;
                    }
                }
            } catch (e) {
                console.error('Error al validar stock antes de venta:', e);
                alert('Error de conexión al verificar stock. Intenta de nuevo.');
                return;
            }

            // 2) Si todas las líneas pasan la validación, proceder a registrar cada venta individualmente.
            let ok = true;
            for (const item of carrito) {
                const body = {
                    cliente_nombre,
                    cliente_cedula,
                    cliente_telefono,
                    cliente_email,
                    id_producto: item.idProd,
                    id_talla: item.idTalla,
                    cantidad: item.cantidad,
                    precio_unitario: item.precio,
                    idCategoria: item.idCategoria || null,
                    tipo_pago
                };
                try {
                    const res = await fetch('/api/ventas', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body),
                        credentials: 'include'
                    });
                    const data = await res.json();
                    if (!data.ok) {
                        ok = false;
                        console.error('Error al registrar venta de producto:', item.nombreProd, data.message || data.error);
                        alert('Error en venta: ' + (data.message || data.error || 'Revise la consola.'));
                        // No continuar con más envíos si uno falla
                        break;
                    } else {
                        // Si el servidor indica que la talla quedó agotada, informarlo al usuario
                        if (data.agotado) {
                            alert(`Atención: La talla ${item.nombreTalla} del producto ${item.marcaProd} - ${item.nombreProd} se ha agotado.`);
                        }
                    }
                } catch (e) { 
                    ok = false; 
                    console.error('Error de conexión al registrar venta:', e);
                    alert('Error de conexión al registrar venta. Intenta de nuevo.');
                    break;
                }
            }
            if (ok) {
                alert('Venta registrada correctamente.');
                carrito = [];
                renderCarrito();
                formVentaCaja.reset();
                inputTotalDolar.value = '';
                inputTotalBs.value = '';
                cargarProductosCaja(); 
            } else {
                // Si hubo un fallo parcial, actualizar catálogo y dejar el carrito para que el usuario lo corrija.
                alert('Ocurrió un error al registrar una o más ventas. Revise la consola para detalles.');
                cargarProductosCaja();
            }
        });
    }
});