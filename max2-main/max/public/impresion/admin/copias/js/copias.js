(function () {
  document.addEventListener('click', async (event) => {
    const target = event.target;
    const button = target instanceof Element ? target.closest('.lic-hist-print-btn') : null;
    if (!button) return;

    const idVenta = Number(button.dataset.ventaId);
    if (!Number.isSafeInteger(idVenta) || idVenta <= 0) return;
    if (!window.MaxImpresora || typeof window.MaxImpresora.imprimirFacturaHistorial !== 'function') {
      alert('El módulo de impresión no está disponible. Recarga la página e inténtalo de nuevo.');
      return;
    }

    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Cargando…';
    try {
      const res = await fetch(`/api/licencias/ventas/${encodeURIComponent(idVenta)}/factura`, {
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok || !data.factura) {
        throw new Error(data.error || `No se pudo cargar la factura (${res.status})`);
      }
      button.textContent = 'Imprimiendo…';
      const result = await window.MaxImpresora.imprimirFacturaHistorial(data.factura);
      if (!result || !result.ok) {
        throw new Error((result && (result.mensaje || result.error)) || 'La impresora no pudo completar la copia');
      }
    } catch (e) {
      console.error('Error reimprimiendo factura:', e);
      alert(e.message || 'No se pudo reimprimir la factura');
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  });
})();
