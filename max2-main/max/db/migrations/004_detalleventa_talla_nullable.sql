-- Permitir ventas sin talla (abastos, supermercado, productos por unidad/kg/L, etc.)
-- id_talla queda opcional: NULL = producto sin talla

ALTER TABLE `detalleventa`
  MODIFY COLUMN `id_talla` INT(11) NULL DEFAULT NULL;
