/**
 * Puente seguro MAX escritorio ↔ renderer
 * Impresión silenciosa de facturas de venta (impresora predeterminada).
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('maxDesktop', {
  printHtmlSilent(html) {
    return ipcRenderer.invoke('print-html-silent', String(html || ''));
  }
});
