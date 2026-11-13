const LEGACY_PUBLIC_FILES = Object.freeze({
  '/': 'acceso/html/index.html',
  '/index.html': 'acceso/html/index.html',
  '/index.css': 'acceso/css/index.css',
  '/admin.html': 'admin/html/admin.html',
  '/admin.css': 'admin/css/admin.css',
  '/admin-funcionalidades.js': 'admin/js/admin-funcionalidades.js',
  '/admin-iva.js': 'admin/js/admin-iva.js',
  '/admin-mobile.js': 'admin/js/admin-mobile.js',
  '/admin-user-menu.js': 'admin/js/admin-user-menu.js',
  '/comercial-admin.js': 'admin/js/comercial-admin.js',
  '/fugas.js': 'impresion/admin/fugas/js/fugas.js',
  '/tasa-dolar-ui.js': 'admin/js/tasa-dolar-ui.js',
  '/caja.html': 'caja/html/caja.html',
  '/caja.css': 'caja/css/caja.css',
  '/caja-funcionalidades.js': 'caja/js/caja-funcionalidades.js',
  '/caja-impresora.js': 'impresion/caja/js/caja-impresora.js',
  '/devoluciones.js': 'caja/js/devoluciones.js',
  '/movil.html': 'movil/html/movil.html',
  '/reportes.js': 'reportes/js/reportes.js',
  '/reportes-hub.js': 'impresion/admin/resumen-diarios/js/reportes-hub.js',
  '/etiquetas-precio.js': 'impresion/admin/precios/js/etiquetas-precio.js',
  '/copias.js': 'impresion/admin/copias/js/copias.js',
  '/cliente.js': 'common/js/cliente.js',
  '/max-pwa.js': 'common/js/max-pwa.js',
  '/max-theme.js': 'common/js/max-theme.js',
  '/max-ui-dialogs.js': 'common/js/max-ui-dialogs.js',
  '/sw.js': 'common/js/sw.js',
  '/manifest.webmanifest': 'common/assets/manifest.webmanifest',
  '/imagen/images.png': 'common/assets/images.png'
});

function serveLegacyPublicFiles(resolveApp) {
  return (req, res, next) => {
    const file = LEGACY_PUBLIC_FILES[req.path];
    if (!file) return next();
    res.sendFile(resolveApp('public', file), (err) => {
      if (err) next(err);
    });
  };
}

module.exports = serveLegacyPublicFiles;
