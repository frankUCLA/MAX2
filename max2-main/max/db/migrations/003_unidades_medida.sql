-- =============================================================================
-- Modasoft — Migración 003: Unidades de medida (abastos / supermercado / ropa)
-- =============================================================================
-- phpMyAdmin → base MAX → SQL → pegar → Continuar
-- Si dice Duplicate column, esa parte ya existe (ignórala).
-- =============================================================================

USE `MAX`;

-- Unidad de venta y si usa tallas (ropa)
ALTER TABLE `productos`
  ADD COLUMN `unidad_medida` VARCHAR(20) NOT NULL DEFAULT 'UNIDAD'
    COMMENT 'UNIDAD, KILO, LITRO, METRO, GRAMO, CAJA, PAQUETE'
    AFTER `ruta_imagen`,
  ADD COLUMN `usa_tallas` TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '1 = producto con tallas (ropa/calzado)'
    AFTER `unidad_medida`;

-- Stock y cantidades con decimales (kilos / litros)
ALTER TABLE `productos`
  MODIFY COLUMN `inventario` DECIMAL(12,6) NOT NULL DEFAULT 0,
  MODIFY COLUMN `stock_minimo` DECIMAL(12,6) NOT NULL DEFAULT 0;

ALTER TABLE `inventario`
  MODIFY COLUMN `cantidad` DECIMAL(12,6) NOT NULL DEFAULT 0;

ALTER TABLE `detalleventa`
  MODIFY COLUMN `cantidad` DECIMAL(12,6) NOT NULL;

-- Productos de ropa existentes: activar tallas si ya tienen filas en inventario
UPDATE productos p
SET p.usa_tallas = 1
WHERE EXISTS (SELECT 1 FROM inventario i WHERE i.id_producto = p.id_producto)
  AND p.usa_tallas = 0;

-- Unidades dentro de caja/paquete
ALTER TABLE `productos`
  ADD COLUMN `unidades_por_empaque` DECIMAL(12,3) NULL DEFAULT NULL
    COMMENT 'Cuántas unidades trae 1 caja o 1 paquete'
    AFTER `unidad_medida`;
