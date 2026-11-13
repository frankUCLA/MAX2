-- MAX 5.0.4: conserva cantidades fraccionarias de hasta 0.000001 kg/litro.
-- Ejecutar una vez sobre las bases existentes antes de vender cantidades menores a 1 g/ml.
USE `MAX`;

ALTER TABLE `productos`
  MODIFY COLUMN `inventario` DECIMAL(12,6) NOT NULL DEFAULT 0,
  MODIFY COLUMN `stock_minimo` DECIMAL(12,6) NOT NULL DEFAULT 0;

ALTER TABLE `inventario`
  MODIFY COLUMN `cantidad` DECIMAL(12,6) NOT NULL DEFAULT 0;

ALTER TABLE `detalleventa`
  MODIFY COLUMN `cantidad` DECIMAL(12,6) NOT NULL;

ALTER TABLE `detallecompra`
  MODIFY COLUMN `cantidad` DECIMAL(12,6) NOT NULL;

CREATE TABLE IF NOT EXISTS `devoluciones` (
  `id_devolucion` INT(11) NOT NULL AUTO_INCREMENT,
  `id_detalle` INT(11) NOT NULL,
  `fecha_hora` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `cantidad` DECIMAL(12,6) NOT NULL DEFAULT 0,
  `monto_reembolsado` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `tasa_dolar` DECIMAL(12,4) DEFAULT NULL,
  PRIMARY KEY (`id_devolucion`),
  KEY `idx_dev_detalle` (`id_detalle`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE `devoluciones`
  MODIFY COLUMN `cantidad` DECIMAL(12,6) NOT NULL DEFAULT 0;

ALTER TABLE `fuga_movimientos`
  MODIFY COLUMN `cantidad` DECIMAL(12,6) NOT NULL;
