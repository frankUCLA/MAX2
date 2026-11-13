-- MAX: clave de autorización del proveedor para registrar cajas nuevas
-- El cliente del negocio NO debe conocer esta clave.

INSERT INTO configuracion (clave, valor, descripcion)
SELECT 'clave_autorizacion_licencia', 'MAX-PROVEEDOR-8821', 'Clave del proveedor MAX para autorizar cajas nuevas'
WHERE NOT EXISTS (
  SELECT 1 FROM configuracion WHERE clave = 'clave_autorizacion_licencia'
);
