-- MAX: IVA Venezuela (16%) opcional por negocio
-- precio_venta = base sin IVA. Si iva_activo=1, se agrega el % al cobrar.
-- Ejecutar en phpMyAdmin sobre la base MAX (o la BD que uses).

USE `MAX`;

INSERT INTO configuracion (clave, valor, descripcion)
SELECT 'iva_activo', '0', '1 = aplicar IVA en ventas, etiquetas y facturas; 0 = sin IVA'
WHERE NOT EXISTS (SELECT 1 FROM configuracion WHERE clave = 'iva_activo');

INSERT INTO configuracion (clave, valor, descripcion)
SELECT 'iva_porcentaje', '16', 'Porcentaje de IVA (Venezuela: 16)'
WHERE NOT EXISTS (SELECT 1 FROM configuracion WHERE clave = 'iva_porcentaje');

ALTER TABLE `ventas`
  ADD COLUMN IF NOT EXISTS `monto_iva` DECIMAL(14,4) NOT NULL DEFAULT 0 AFTER `monto_descuento`;

ALTER TABLE `ventas`
  ADD COLUMN IF NOT EXISTS `iva_porcentaje` DECIMAL(6,2) NOT NULL DEFAULT 0 AFTER `monto_iva`;
