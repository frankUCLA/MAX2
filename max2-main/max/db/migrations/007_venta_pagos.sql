-- MAX: desglose de formas de pago por venta
CREATE TABLE IF NOT EXISTS `venta_pagos` (
  `id_pago` INT(11) NOT NULL AUTO_INCREMENT,
  `id_venta` INT(11) NOT NULL,
  `forma_pago` VARCHAR(80) NOT NULL,
  `monto_usd` DECIMAL(14,4) NOT NULL DEFAULT 0,
  `monto_bs` DECIMAL(18,4) NOT NULL DEFAULT 0,
  `tasa` DECIMAL(18,6) DEFAULT NULL,
  `fecha_hora` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_pago`),
  KEY `idx_venta_pagos_venta` (`id_venta`),
  KEY `idx_venta_pagos_forma` (`forma_pago`),
  CONSTRAINT `venta_pagos_ibfk_venta` FOREIGN KEY (`id_venta`) REFERENCES `ventas` (`id_venta`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
