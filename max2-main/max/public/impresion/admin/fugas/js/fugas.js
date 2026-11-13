(function () {
    const modal = document.getElementById('fugaModal');
    const form = document.getElementById('formFuga');
    const searchInput = document.getElementById('fugaBuscarProducto');
    const productSelect = document.getElementById('fugaProducto');
    const sizeSelect = document.getElementById('fugaTalla');
    const sizeWrap = document.getElementById('fugaTallaWrap');
    const typeSelect = document.getElementById('fugaTipo');
    const quantityInput = document.getElementById('fugaCantidad');
    const priceInput = document.getElementById('fugaPrecio');
    const priceWrap = document.getElementById('fugaPrecioWrap');
    const paymentWrap = document.getElementById('fugaPagoWrap');
    const feedback = document.getElementById('fugaFeedback');
    const history = document.getElementById('fugaHistorial');
    const stockHint = document.getElementById('fugaStock');
    const submitButton = document.getElementById('btnGuardarFuga');
    const addButton = document.getElementById('btnAgregarFugaLista');
    const queueList = document.getElementById('fugaListaProductos');
    if (!modal || !form || !searchInput || !productSelect) return;

    let searchTimer = null;
    let selectedProduct = null;
    let selectedProductLoad = Promise.resolve();
    let selectedProductRequest = 0;
    let queuedItems = [];
    let historyGroups = [];
    let busy = false;

    function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[char]);
    }

    function formatMoney(value) {
        return '$' + Number(value || 0).toFixed(2);
    }

    function formatQuantity(value) {
        const quantity = Number(value || 0);
        return Number.isInteger(quantity) ? String(quantity) : String(Number(quantity.toFixed(6)));
    }

    function formatDate(value) {
        return String(value || '').replace('T', ' ').slice(0, 16);
    }

    function buildFugaTicketHtml(group) {
        const printer = window.MaxImpresora;
        const layout = printer && typeof printer.paperLayout === 'function'
            ? printer.paperLayout()
            : { mm: 57, fontPx: 10, titlePx: 12, totPx: 12 };
        const company = printer && typeof printer.empresaFactura === 'function'
            ? printer.empresaFactura()
            : { nombre: 'MAX', rif: '', direccion: '', telefono: '' };
        const multi = group.items.length > 1;
        const sale = group.tipo === 'VENTA_ESPECIAL';
        const title = sale ? 'VENTA ESPECIAL' : (group.tipo === 'DANIO' ? 'PRODUCTO DAÑADO' : 'CONSUMO INTERNO');
        const items = group.items.map(item => {
            const name = `${item.producto_nombre || 'Producto'}${item.talla_nombre ? ' · ' + item.talla_nombre : ''}`;
            const line = sale
                ? `<div class="detail">Precio: ${formatMoney(item.precio_unitario)} · Total: ${formatMoney(item.monto_total)}</div>`
                : '';
            return `<div class="item"><strong>${escapeHtml(name)}</strong><div>Cantidad: ${escapeHtml(formatQuantity(item.cantidad))}</div>${line}</div>`;
        }).join('');
        const saleTotal = sale ? `<div class="total"><span>TOTAL</span><strong>${escapeHtml(formatMoney(group.monto_total))}</strong></div>` : '';
        return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Ticket de fuga</title>
<style>
@page{size:${layout.mm}mm auto;margin:0}
*{box-sizing:border-box}
html,body{width:${layout.mm}mm;max-width:${layout.mm}mm;margin:0;padding:0;color:#000!important;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{padding:2mm 3mm;font:900 ${layout.fontPx}px/1.3 "Courier New",monospace;-webkit-text-stroke:.35px #000;text-rendering:geometricPrecision}
.center{text-align:center}.title{font-size:${layout.titlePx}px;font-weight:900;-webkit-text-stroke:.45px #000}.line{border-top:1px solid #000;margin:6px 0}
.item{padding:4px 0;border-bottom:1px solid #000}.item strong,.total strong{font-weight:900;-webkit-text-stroke:.45px #000}.detail{font-size:${Math.max(9, layout.fontPx - 1)}px;font-weight:900}
.total{display:flex;justify-content:space-between;font-size:${layout.totPx}px;font-weight:900;padding-top:5px}
.muted{font-size:${Math.max(9, layout.fontPx - 1)}px}
</style></head><body>
<div class="center title">${escapeHtml(company.nombre || 'MAX')}</div>
${company.rif ? `<div class="center">${escapeHtml(company.rif)}</div>` : ''}
${company.direccion ? `<div class="center">${escapeHtml(company.direccion)}</div>` : ''}
${company.telefono ? `<div class="center">Tel: ${escapeHtml(company.telefono)}</div>` : ''}
<div class="center">COMPROBANTE DE SALIDA</div>
<div class="line"></div><div><strong>${title}</strong></div>
<div>Fecha: ${escapeHtml(formatDate(group.fecha_hora))}</div>
<div>Usuario: ${escapeHtml(group.usuario || '—')}</div>
${group.id_venta ? `<div>Venta: #${escapeHtml(group.id_venta)}</div>` : ''}
${group.motivo ? `<div>Nota: ${escapeHtml(group.motivo)}</div>` : ''}
<div class="line"></div>${multi ? `<div><strong>Varios productos (${group.items.length})</strong></div>` : ''}
${items}<div class="line"></div>
<div><strong>Cantidad total: ${escapeHtml(formatQuantity(group.cantidad))}</strong></div>
${sale ? `<div>Forma de pago: ${escapeHtml(group.tipo_pago || '—')}</div>${saleTotal}` : ''}
<div class="line"></div><div class="center muted">Comprobante interno</div><br><br>
</body></html>`;
    }

    function setFeedback(message, isError) {
        feedback.textContent = message || '';
        feedback.hidden = !message;
        feedback.classList.toggle('is-error', !!isError);
    }

    async function readResponse(response) {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok === false) {
            throw new Error(data.error || data.message || 'No se pudo completar la operación.');
        }
        return data;
    }

    function updateTypeFields() {
        const isSale = typeSelect.value === 'VENTA_ESPECIAL';
        priceWrap.hidden = !isSale;
        paymentWrap.hidden = !isSale;
        priceInput.required = isSale;
        document.getElementById('fugaPago').required = isSale;
        submitButton.textContent = isSale ? 'Registrar todas las ventas' : 'Registrar todas las salidas';
        renderQueue();
    }

    function updateStockHint() {
        if (!selectedProduct) {
            stockHint.textContent = 'El stock disponible aparecerá al seleccionar el producto.';
            return;
        }
        const selectedSize = sizeSelect.value
            ? (selectedProduct.tallas || []).find((size) => Number(size.id_talla) === Number(sizeSelect.value))
            : null;
        const available = selectedSize ? selectedSize.cantidad : selectedProduct.inventario;
        const unit = selectedProduct.unidad_medida || 'UNIDAD';
        stockHint.textContent = `Disponible: ${formatQuantity(available)} ${unit}${selectedSize ? ` · talla ${selectedSize.nombre}` : ''}`;
        quantityInput.max = Number(available || 0);
    }

    function renderProductOptions(products, preferredBarcode) {
        productSelect.replaceChildren(new Option('Selecciona el producto', ''));
        const ordered = products.slice().sort((a, b) => {
            const aExact = preferredBarcode && String(a.codigo_barras || '') === preferredBarcode ? 0 : 1;
            const bExact = preferredBarcode && String(b.codigo_barras || '') === preferredBarcode ? 0 : 1;
            return aExact - bExact || String(a.nombre || '').localeCompare(String(b.nombre || ''));
        });
        for (const product of ordered) {
            const option = new Option(
                `${product.marca ? product.marca + ' · ' : ''}${product.nombre} · Stock: ${formatQuantity(product.inventario)}`,
                product.id_producto
            );
            productSelect.add(option);
        }
        if (preferredBarcode) {
            const exact = ordered.find((product) => String(product.codigo_barras || '') === preferredBarcode);
            if (exact) {
                productSelect.value = String(exact.id_producto);
                selectedProductLoad = loadSelectedProduct();
                return;
            }
        }
        if (ordered.length === 1) {
            productSelect.value = String(ordered[0].id_producto);
            selectedProductLoad = loadSelectedProduct();
        }
    }

    async function searchProducts(term, scanned) {
        const query = String(term || '').trim();
        if (!query) return;
        try {
            const response = await fetch('/api/productos?buscar=' + encodeURIComponent(query), {
                credentials: 'include'
            });
            const data = await readResponse(response);
            const products = Array.isArray(data.productos) ? data.productos : [];
            renderProductOptions(products, scanned ? query : '');
            if (!products.length) setFeedback('No encontramos ese producto. Verifica el código o la búsqueda.', true);
            else setFeedback('', false);
        } catch (error) {
            setFeedback(error.message, true);
        }
    }

    async function loadSelectedProduct() {
        const id = Number(productSelect.value);
        const request = ++selectedProductRequest;
        selectedProduct = null;
        sizeSelect.replaceChildren(new Option('Selecciona una talla', ''));
        sizeWrap.hidden = true;
        quantityInput.removeAttribute('max');
        if (!id) {
            updateStockHint();
            return;
        }
        try {
            const response = await fetch('/api/admin/productos/' + encodeURIComponent(id), {
                credentials: 'include'
            });
            const data = await readResponse(response);
            if (request !== selectedProductRequest || Number(productSelect.value) !== id) return;
            if (!data.producto) throw new Error('Producto no encontrado.');
            selectedProduct = data.producto;
            const sizes = Array.isArray(selectedProduct.tallas) ? selectedProduct.tallas : [];
            if (sizes.length) {
                for (const size of sizes) {
                    sizeSelect.add(new Option(`${size.nombre} · ${formatQuantity(size.cantidad)} disponibles`, size.id_talla));
                }
                sizeWrap.hidden = false;
                sizeSelect.required = true;
            } else {
                sizeSelect.required = false;
            }
            priceInput.value = Number(selectedProduct.precio_venta || 0).toFixed(2);
            updateStockHint();
        } catch (error) {
            if (request === selectedProductRequest) setFeedback(error.message, true);
        }
    }

    function renderQueue() {
        if (!queuedItems.length) {
            queueList.innerHTML = '<div class="fuga-empty">Agrega productos para preparar el registro.</div>';
            return;
        }
        queueList.innerHTML = queuedItems.map((item, index) => {
            const title = `${item.marca ? item.marca + ' · ' : ''}${item.nombre}`;
            const talla = item.talla_nombre ? ` · Talla ${item.talla_nombre}` : '';
            const sale = typeSelect.value === 'VENTA_ESPECIAL'
                ? ` · ${formatMoney(item.precio_unitario)} c/u`
                : '';
            return `<div class="fuga-queue-item">
                <div><strong>${escapeHtml(title)}${escapeHtml(talla)}</strong>
                <small>Cantidad: ${escapeHtml(formatQuantity(item.cantidad))}${escapeHtml(sale)}</small></div>
                <button type="button" class="btn secondary fuga-queue-remove" data-remove-index="${index}">Quitar</button>
            </div>`;
        }).join('');
    }

    function clearSelectedProduct() {
        selectedProduct = null;
        searchInput.value = '';
        productSelect.replaceChildren(new Option('Busca o escanea un producto', ''));
        sizeSelect.replaceChildren(new Option('Selecciona una talla', ''));
        sizeSelect.required = false;
        sizeWrap.hidden = true;
        quantityInput.value = '1';
        quantityInput.removeAttribute('max');
        updateStockHint();
    }

    async function queueSelectedProduct() {
        const productId = Number(productSelect.value);
        if (!productId) {
            setFeedback('Busca y selecciona un producto antes de agregarlo a la lista.', true);
            return;
        }
        if (!selectedProduct || Number(selectedProduct.id_producto) !== productId) {
            await selectedProductLoad;
        }
        if (!selectedProduct || Number(selectedProduct.id_producto) !== productId) {
            setFeedback('Espera a que termine de cargar el producto y vuelve a agregarlo.', true);
            return;
        }
        const quantity = Number(quantityInput.value);
        if (!Number.isFinite(quantity) || quantity <= 0) {
            setFeedback('Indica una cantidad válida mayor que cero.', true);
            return;
        }
        const price = Number(priceInput.value);
        if (typeSelect.value === 'VENTA_ESPECIAL' &&
            (!Number.isFinite(price) || price <= 0 || Math.abs(price * 100 - Math.round(price * 100)) > 0.000001)) {
            setFeedback('Indica un precio especial válido, mayor que cero y con hasta 2 decimales.', true);
            return;
        }
        const selectedSize = sizeSelect.value
            ? (selectedProduct.tallas || []).find(size => Number(size.id_talla) === Number(sizeSelect.value))
            : null;
        if ((selectedProduct.tallas || []).length && !selectedSize) {
            setFeedback('Selecciona una talla para este producto.', true);
            return;
        }
        const available = Number(selectedSize ? selectedSize.cantidad : selectedProduct.inventario) || 0;
        const existing = queuedItems.find(item =>
            Number(item.id_producto) === Number(selectedProduct.id_producto) &&
            Number(item.id_talla || 0) === Number(selectedSize && selectedSize.id_talla || 0) &&
            (typeSelect.value !== 'VENTA_ESPECIAL' || Number(item.precio_unitario) === price)
        );
        const productQueued = queuedItems
            .filter(item => Number(item.id_producto) === Number(selectedProduct.id_producto))
            .reduce((sum, item) => sum + Number(item.cantidad || 0), 0);
        if (productQueued + quantity > Number(selectedProduct.inventario || 0)) {
            setFeedback(`La cantidad total de ${selectedProduct.nombre} supera el stock disponible (${formatQuantity(selectedProduct.inventario)}).`, true);
            return;
        }
        if (quantity + Number(existing && existing.cantidad || 0) > available) {
            setFeedback(`La cantidad total supera las existencias disponibles (${formatQuantity(available)}).`, true);
            return;
        }
        if (existing) {
            existing.cantidad = Number((Number(existing.cantidad) + quantity).toFixed(6));
        } else {
            queuedItems.push({
                id_producto: Number(selectedProduct.id_producto),
                id_talla: selectedSize ? Number(selectedSize.id_talla) : null,
                cantidad: quantity,
                nombre: selectedProduct.nombre,
                marca: selectedProduct.marca || '',
                talla_nombre: selectedSize ? selectedSize.nombre : null,
                precio_unitario: price
            });
        }
        renderQueue();
        clearSelectedProduct();
        setFeedback('Producto agregado a la lista. Puedes seguir agregando o registrar todo al final.', false);
        searchInput.focus();
    }

    async function loadHistory() {
        history.innerHTML = '<div class="fuga-empty">Cargando movimientos…</div>';
        try {
            const response = await fetch('/api/admin/fugas?limit=50', { credentials: 'include' });
            const data = await readResponse(response);
            const rows = Array.isArray(data.movimientos) ? data.movimientos : [];
            if (!rows.length) {
                historyGroups = [];
                history.innerHTML = '<div class="fuga-empty">Todavía no hay movimientos registrados.</div>';
                return;
            }
            const grouped = new Map();
            for (const row of rows) {
                const key = row.id_lote
                    ? `lote:${row.id_lote}`
                    : (row.id_venta ? `venta:${row.id_venta}` : `movimiento:${row.id_fuga}`);
                if (!grouped.has(key)) {
                    grouped.set(key, {
                        tipo: row.tipo,
                        fecha_hora: row.fecha_hora,
                        id_venta: row.id_venta,
                        id_lote: row.id_lote,
                        tipo_pago: row.tipo_pago,
                        motivo: row.motivo,
                        usuario: row.usuario,
                        items: [],
                        cantidad: 0,
                        monto_total: 0
                    });
                }
                const group = grouped.get(key);
                group.items.push(row);
                group.cantidad += Number(row.cantidad) || 0;
                group.monto_total += Number(row.monto_total) || 0;
            }
            historyGroups = [...grouped.values()];
            const body = historyGroups.map((group, index) => {
                const sale = group.tipo === 'VENTA_ESPECIAL';
                const typeLabel = sale ? 'Venta especial' : (group.tipo === 'DANIO' ? 'Dañado' : 'Consumo');
                const singleProduct = group.items.length === 1;
                const item = group.items[0];
                const product = singleProduct
                    ? `${item.producto_nombre || 'Producto'}${item.talla_nombre ? ' · ' + item.talla_nombre : ''}`
                    : 'Varios productos';
                const productNote = singleProduct ? '' : `<br><span class="fuga-help">${group.items.length} productos registrados</span>`;
                const amount = sale ? `Total ${formatMoney(group.monto_total)}` : '—';
                const saleLink = group.id_venta ? ` · Venta #${group.id_venta}` : '';
                const reason = group.motivo ? `<br><span class="fuga-help">${escapeHtml(group.motivo)}</span>` : '';
                return `<tr>
                    <td>${escapeHtml(formatDate(group.fecha_hora))}</td>
                    <td><span class="fuga-type-chip${sale ? ' is-sale' : (group.tipo === 'DANIO' ? ' is-damage' : '')}">${typeLabel}</span></td>
                    <td><strong>${escapeHtml(product)}</strong>${productNote}${reason}</td>
                    <td>${escapeHtml(formatQuantity(group.cantidad))}</td>
                    <td>${escapeHtml(amount)}${sale && group.tipo_pago ? `<br><span class="fuga-help">${escapeHtml(group.tipo_pago)}${escapeHtml(saleLink)}</span>` : ''}</td>
                    <td><div class="fuga-history-user"><span>${escapeHtml(group.usuario || '—')}</span>
                        <button type="button" class="btn secondary fuga-print-btn" data-print-group="${index}">Imprimir ticket</button></div></td>
                </tr>`;
            }).join('');
            history.innerHTML = `<table class="fuga-history-table">
                <thead><tr><th>Fecha</th><th>Tipo</th><th>Producto</th><th>Cant.</th><th>Precio / venta</th><th>Usuario / ticket</th></tr></thead>
                <tbody>${body}</tbody>
            </table>`;
        } catch (error) {
            history.innerHTML = `<div class="fuga-empty">${escapeHtml(error.message)}</div>`;
        }
    }

    function openModal() {
        modal.classList.add('is-open');
        modal.setAttribute('aria-hidden', 'false');
        setFeedback('', false);
        loadHistory();
        window.setTimeout(() => searchInput.focus(), 50);
    }

    function closeModal() {
        modal.classList.remove('is-open');
        modal.setAttribute('aria-hidden', 'true');
    }

    document.getElementById('btnAbrirFuga')?.addEventListener('click', openModal);
    document.getElementById('btnCerrarFuga')?.addEventListener('click', closeModal);
    document.getElementById('btnCancelarFuga')?.addEventListener('click', closeModal);
    document.getElementById('btnActualizarFugas')?.addEventListener('click', loadHistory);
    addButton?.addEventListener('click', queueSelectedProduct);
    history?.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-print-group]');
        if (!button) return;
        const group = historyGroups[Number(button.dataset.printGroup)];
        if (!group) return;
        if (!window.MaxImpresora || typeof window.MaxImpresora.imprimirTicketHtml !== 'function') {
            setFeedback('El módulo de impresión no está disponible. Recarga la página e inténtalo de nuevo.', true);
            return;
        }
        const originalText = button.textContent;
        button.disabled = true;
        button.textContent = 'Imprimiendo…';
        try {
            const result = await window.MaxImpresora.imprimirTicketHtml(buildFugaTicketHtml(group));
            if (!result || !result.ok) throw new Error(result && result.error || 'No se pudo imprimir el ticket.');
            setFeedback('Ticket de fuga enviado a la impresora.', false);
        } catch (error) {
            setFeedback(error.message, true);
        } finally {
            button.disabled = false;
            button.textContent = originalText;
        }
    });
    queueList?.addEventListener('click', (event) => {
        const button = event.target.closest('[data-remove-index]');
        if (!button) return;
        queuedItems.splice(Number(button.dataset.removeIndex), 1);
        renderQueue();
    });
    modal.addEventListener('click', (event) => {
        if (event.target === modal) closeModal();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && modal.classList.contains('is-open')) closeModal();
    });
    typeSelect.addEventListener('change', updateTypeFields);
    productSelect.addEventListener('change', () => {
        selectedProductLoad = loadSelectedProduct();
    });
    sizeSelect.addEventListener('change', updateStockHint);
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => searchProducts(searchInput.value, false), 300);
    });
    searchInput.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        clearTimeout(searchTimer);
        searchProducts(searchInput.value, true);
    });
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (busy) return;
        if (!queuedItems.length) {
            setFeedback('Agrega al menos un producto a la lista antes de registrar.', true);
            return;
        }
        if (typeSelect.value === 'VENTA_ESPECIAL' &&
            (!document.getElementById('fugaPago').value ||
                queuedItems.some(item => !Number.isFinite(Number(item.precio_unitario)) ||
                    Number(item.precio_unitario) <= 0 ||
                    Math.abs(Number(item.precio_unitario) * 100 - Math.round(Number(item.precio_unitario) * 100)) > 0.000001))) {
            setFeedback('Cada producto debe tener un precio válido y una forma de pago seleccionada.', true);
            return;
        }
        busy = true;
        submitButton.disabled = true;
        addButton.disabled = true;
        setFeedback(`Registrando ${queuedItems.length} producto(s)…`, false);
        try {
            const payload = {
                tipo: typeSelect.value,
                items: queuedItems.map(({ id_producto, id_talla, cantidad, precio_unitario }) => ({
                    id_producto, id_talla, cantidad, precio_unitario
                })),
                precio_unitario: Number(priceInput.value),
                tipo_pago: document.getElementById('fugaPago').value,
                motivo: document.getElementById('fugaMotivo').value.trim()
            };
            const response = await fetch('/api/admin/fugas', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await readResponse(response);
            const message = payload.tipo === 'VENTA_ESPECIAL'
                ? `Venta #${data.id_venta} con ${queuedItems.length} producto(s) registrada por ${formatMoney(data.total)}.`
                : `${queuedItems.length} producto(s) registrados y existencias actualizadas.`;
            setFeedback(message, false);
            if (Array.isArray(data.stock_updates) && typeof window.applyAdminStockUpdates === 'function') {
                window.applyAdminStockUpdates(data.stock_updates);
            } else if (typeof window.cargarProductos === 'function') {
                window.cargarProductos();
            }
            if (typeof window.cargarProductosCompra === 'function') window.cargarProductosCompra();
            await loadHistory();
            form.reset();
            queuedItems = [];
            renderQueue();
            clearSelectedProduct();
            updateTypeFields();
        } catch (error) {
            setFeedback(error.message, true);
        } finally {
            busy = false;
            submitButton.disabled = false;
            addButton.disabled = false;
        }
    });
    renderQueue();
    updateTypeFields();
})();
