-- =============================================================================
-- Modasoft Comercial — Migración 002
-- =============================================================================
-- CÓMO USAR EN phpMyAdmin:
--   1. Selecciona la base de datos: MAX
--   2. Pestaña "SQL" → pega este archivo → Continuar
--   3. Si aparece "Duplicate column" / "already exists", esa parte YA estaba
--      aplicada: no pasa nada, el resto sí se crea.
-- =============================================================================

USE `MAX`;

-- A) Ampliar tablas existentes
ALTER TABLE `productos`
  ADD COLUMN `codigo_barras` VARCHAR(64) NULL DEFAULT NULL AFTER `nombre`,
  ADD COLUMN `precio_costo` DECIMAL(10,2) NULL DEFAULT NULL AFTER `descripcion`,
  ADD COLUMN `stock_minimo` INT(11) NOT NULL DEFAULT 0 AFTER `inventario`,
  ADD COLUMN `ruta_imagen` VARCHAR(255) NULL DEFAULT NULL AFTER `stock_minimo`;

ALTER TABLE `productos`
  ADD UNIQUE KEY `uk_productos_codigo_barras` (`codigo_barras`);

ALTER TABLE `ventas`
  ADD COLUMN `id_caja` INT(11) NULL DEFAULT NULL AFTER `id_usuario`,
  ADD COLUMN `monto_subtotal` DECIMAL(10,2) NULL DEFAULT NULL AFTER `total_venta`,
  ADD COLUMN `monto_descuento` DECIMAL(10,2) NULL DEFAULT NULL AFTER `monto_subtotal`;

ALTER TABLE `proveedores`
  ADD COLUMN `rif_ruc` VARCHAR(40) NULL DEFAULT NULL AFTER `nombre`;

ALTER TABLE `cuentas_por_pagar`
  ADD COLUMN `numero_factura` VARCHAR(80) NULL DEFAULT NULL AFTER `id_compra`,
  ADD COLUMN `fecha_emision` DATE NULL DEFAULT NULL AFTER `numero_factura`;

-- B) Tablas nuevas
CREATE TABLE IF NOT EXISTS `licencias` (
  `id_licencia` INT(11) NOT NULL AUTO_INCREMENT,
  `cliente` VARCHAR(150) NOT NULL,
  `tipo_plan` ENUM('BASICO','ESTANDAR','PRO','ENTERPRISE') NOT NULL DEFAULT 'BASICO',
  `limite_cajas` INT(11) NOT NULL DEFAULT 2,
  `token_licencia` VARCHAR(64) NOT NULL,
  `activa` TINYINT(1) NOT NULL DEFAULT 1,
  `fecha_activacion` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `notas` TEXT NULL,
  PRIMARY KEY (`id_licencia`),
  UNIQUE KEY `uk_licencias_token` (`token_licencia`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `cajas` (
  `id_caja` INT(11) NOT NULL AUTO_INCREMENT,
  `nombre_caja` VARCHAR(100) NOT NULL,
  `direccion_mac` VARCHAR(32) NULL DEFAULT NULL,
  `clave_caja` VARCHAR(100) NOT NULL,
  `estado` ENUM('ACTIVA','INACTIVA','BLOQUEADA') NOT NULL DEFAULT 'ACTIVA',
  `fecha_registro` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_caja`),
  UNIQUE KEY `uk_cajas_clave` (`clave_caja`),
  UNIQUE KEY `uk_cajas_mac` (`direccion_mac`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `sesiones_activas` (
  `id_sesion` INT(11) NOT NULL AUTO_INCREMENT,
  `id_caja` INT(11) NULL DEFAULT NULL,
  `id_usuario` INT(11) NULL DEFAULT NULL,
  `rol_sesion` ENUM('ADMIN_SERVER','POS_CLIENT') NOT NULL DEFAULT 'POS_CLIENT',
  `token_sesion` VARCHAR(64) NOT NULL,
  `fecha_conexion` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ultima_actividad` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_sesion`),
  UNIQUE KEY `uk_sesiones_token` (`token_sesion`),
  KEY `idx_sesiones_caja` (`id_caja`),
  KEY `idx_sesiones_actividad` (`ultima_actividad`),
  CONSTRAINT `fk_sesiones_caja` FOREIGN KEY (`id_caja`) REFERENCES `cajas` (`id_caja`) ON DELETE SET NULL,
  CONSTRAINT `fk_sesiones_usuario` FOREIGN KEY (`id_usuario`) REFERENCES `usuarios` (`id_usuario`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `producto_promocion` (
  `id_relacion` INT(11) NOT NULL AUTO_INCREMENT,
  `id_producto` INT(11) NOT NULL,
  `id_promocion` INT(11) NOT NULL,
  PRIMARY KEY (`id_relacion`),
  UNIQUE KEY `uk_prod_promo` (`id_producto`, `id_promocion`),
  KEY `idx_pp_promocion` (`id_promocion`),
  CONSTRAINT `fk_pp_producto` FOREIGN KEY (`id_producto`) REFERENCES `productos` (`id_producto`) ON DELETE CASCADE,
  CONSTRAINT `fk_pp_promocion` FOREIGN KEY (`id_promocion`) REFERENCES `promociones` (`id_promocion`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

ALTER TABLE `ventas`
  ADD CONSTRAINT `fk_ventas_caja` FOREIGN KEY (`id_caja`) REFERENCES `cajas` (`id_caja`) ON DELETE SET NULL;

-- C) Datos iniciales
INSERT INTO `licencias` (`cliente`, `tipo_plan`, `limite_cajas`, `token_licencia`, `activa`, `notas`)
SELECT 'Cliente MAX', 'BASICO', 2, 'MAX-BASIC-0001', 1, 'Licencia Plan Básico (hasta 2 cajas)'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `licencias` WHERE `token_licencia` IN ('MAX-BASIC-0001', 'MODA-BASIC-DEMO-0001'));

INSERT INTO `cajas` (`nombre_caja`, `direccion_mac`, `clave_caja`, `estado`)
SELECT 'Caja 1', NULL, 'caja1', 'ACTIVA'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `cajas` WHERE `clave_caja` = 'caja1');

INSERT INTO `cajas` (`nombre_caja`, `direccion_mac`, `clave_caja`, `estado`)
SELECT 'Caja 2', NULL, 'caja2', 'ACTIVA'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `cajas` WHERE `clave_caja` = 'caja2');
