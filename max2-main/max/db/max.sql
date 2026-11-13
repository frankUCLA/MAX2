-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Servidor: 127.0.0.1
-- Tiempo de generación: 07-09-2026 a las 17:57:43
-- Versión del servidor: 10.4.32-MariaDB
-- Versión de PHP: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Base de datos: `max`
--

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `cajas`
--

CREATE TABLE `cajas` (
  `id_caja` int(11) NOT NULL,
  `nombre_caja` varchar(100) NOT NULL,
  `direccion_mac` varchar(32) DEFAULT NULL,
  `clave_caja` varchar(100) NOT NULL,
  `estado` enum('ACTIVA','INACTIVA','BLOQUEADA') NOT NULL DEFAULT 'ACTIVA',
  `fecha_registro` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `categorias`
--

CREATE TABLE `categorias` (
  `id_categoria` int(11) NOT NULL,
  `nombre` varchar(100) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `categorias`
--

INSERT INTO `categorias` (`id_categoria`, `nombre`) VALUES
(41, 'VIVERES');

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `clientes`
--

CREATE TABLE `clientes` (
  `id_cliente` int(11) NOT NULL,
  `nombre` varchar(150) NOT NULL,
  `cedula` varchar(20) DEFAULT NULL,
  `telefono` varchar(20) DEFAULT NULL,
  `direccion` varchar(255) DEFAULT NULL,
  `email` varchar(100) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `compras`
--

CREATE TABLE `compras` (
  `id_compra` int(11) NOT NULL,
  `id_proveedor` int(11) NOT NULL,
  `fecha_compra` date NOT NULL,
  `total_compra` decimal(10,2) NOT NULL,
  `estado_pago` varchar(50) NOT NULL COMMENT 'Pagada, Pendiente, Parcial',
  `tasa_dolar` decimal(12,4) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `conciliacion_bancaria`
--

CREATE TABLE `conciliacion_bancaria` (
  `id_conciliacion` int(11) NOT NULL,
  `fecha_conciliacion` date NOT NULL,
  `saldo_libro` decimal(10,2) NOT NULL COMMENT 'Saldo seg??n nuestros registros',
  `saldo_banco` decimal(10,2) NOT NULL COMMENT 'Saldo seg??n extracto bancario',
  `diferencia` decimal(10,2) NOT NULL COMMENT 'Diferencia entre saldo_libro y saldo_banco',
  `estado` varchar(50) NOT NULL DEFAULT 'PENDIENTE' COMMENT 'PENDIENTE, CONCILIADA, CON_DIFERENCIAS',
  `notas` text DEFAULT NULL,
  `id_usuario` int(11) NOT NULL COMMENT 'Usuario que realiz?? la conciliaci??n',
  `fecha_registro` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `configuracion`
--

CREATE TABLE `configuracion` (
  `id_config` int(11) NOT NULL,
  `clave` varchar(100) NOT NULL,
  `valor` text DEFAULT NULL,
  `descripcion` varchar(200) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `configuracion`
--

INSERT INTO `configuracion` (`id_config`, `clave`, `valor`, `descripcion`) VALUES
(1, 'devol123', '', 'devoluciones'),
(8, 'clave_devoluciones', 'devol123', 'Clave de acceso para m??dulo de devoluciones'),
(9, 'clave_autorizacion_licencia', 'MAX-PROVEEDOR-8821', 'Clave del proveedor MAX para autorizar cajas nuevas'),
(10, 'iva_activo', '0', '1 = aplicar IVA en ventas, etiquetas y facturas; 0 = sin IVA'),
(11, 'iva_porcentaje', '16', 'Porcentaje de IVA (Venezuela: 16)');

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `cuentas_por_pagar`
--

CREATE TABLE `cuentas_por_pagar` (
  `id_cuenta` int(11) NOT NULL,
  `id_proveedor` int(11) NOT NULL,
  `id_compra` int(11) DEFAULT NULL COMMENT 'Referencia a la compra que gener?? la cuenta',
  `numero_factura` varchar(80) DEFAULT NULL,
  `fecha_emision` date DEFAULT NULL,
  `monto_total` decimal(10,2) NOT NULL,
  `monto_pagado` decimal(10,2) NOT NULL DEFAULT 0.00,
  `monto_pendiente` decimal(10,2) NOT NULL COMMENT 'Calculado: monto_total - monto_pagado',
  `fecha_vencimiento` date NOT NULL,
  `estado` varchar(50) NOT NULL DEFAULT 'PENDIENTE' COMMENT 'PENDIENTE, PARCIAL, PAGADA, VENCIDA',
  `fecha_registro` datetime NOT NULL DEFAULT current_timestamp(),
  `notas` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `detallecompra`
--

CREATE TABLE `detallecompra` (
  `id_detalle` int(11) NOT NULL,
  `id_compra` int(11) NOT NULL,
  `id_producto` int(11) NOT NULL,
  `cantidad` decimal(12,6) NOT NULL,
  `costo_unitario` decimal(10,2) NOT NULL,
  `id_talla` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `detalleventa`
--

CREATE TABLE `detalleventa` (
  `id_detalle` int(11) NOT NULL,
  `id_venta` int(11) NOT NULL,
  `id_producto` int(11) NOT NULL,
  `id_talla` int(11) DEFAULT NULL,
  `cantidad` decimal(12,6) NOT NULL,
  `precio_unitario` decimal(10,2) NOT NULL,
  `id_promocion_aplicada` int(11) DEFAULT NULL,
  `descuento_unitario` decimal(12,2) DEFAULT NULL,
  `descuento_total` decimal(12,2) DEFAULT NULL,
  `producto_nombre` varchar(255) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `devoluciones`
--

CREATE TABLE `devoluciones` (
  `id_devolucion` int(11) NOT NULL,
  `id_detalle` int(11) NOT NULL COMMENT 'El item de la venta original',
  `fecha_hora` datetime NOT NULL,
  `cantidad` decimal(12,6) NOT NULL,
  `monto_reembolsado` decimal(10,2) NOT NULL,
  `tasa_dolar` decimal(10,2) DEFAULT NULL COMMENT 'Tasa del d??lar del d??a en que se realiz?? la devoluci??n'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `inventario`
--

CREATE TABLE `inventario` (
  `id_inventario` int(11) NOT NULL,
  `id_producto` int(11) NOT NULL,
  `id_talla` int(11) NOT NULL,
  `cantidad` decimal(12,6) NOT NULL DEFAULT 0.000000,
  `costo_promedio` decimal(10,2) NOT NULL DEFAULT 0.00 COMMENT 'Costo para c??lculo de utilidad'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Movimientos de consumo, daño y ventas a precio especial
--

CREATE TABLE `fuga_movimientos` (
  `id_fuga` int(11) NOT NULL AUTO_INCREMENT,
  `id_producto` int(11) NOT NULL,
  `producto_nombre` varchar(200) NOT NULL,
  `codigo_barras` varchar(64) DEFAULT NULL,
  `tipo` enum('CONSUMO','DANIO','VENTA_ESPECIAL') NOT NULL,
  `cantidad` decimal(12,6) NOT NULL,
  `id_talla` int(11) DEFAULT NULL,
  `talla_nombre` varchar(64) DEFAULT NULL,
  `precio_unitario` decimal(10,2) NOT NULL DEFAULT 0.00,
  `monto_total` decimal(14,4) NOT NULL DEFAULT 0.0000,
  `id_venta` int(11) DEFAULT NULL,
  `tipo_pago` varchar(50) DEFAULT NULL,
  `motivo` varchar(255) DEFAULT NULL,
  `id_usuario` int(11) NOT NULL,
  `fecha_hora` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id_fuga`),
  KEY `idx_fuga_fecha` (`fecha_hora`),
  KEY `idx_fuga_producto` (`id_producto`),
  KEY `idx_fuga_venta` (`id_venta`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `licencias`
--

CREATE TABLE `licencias` (
  `id_licencia` int(11) NOT NULL,
  `cliente` varchar(150) NOT NULL,
  `tipo_plan` enum('BASICO','ESTANDAR','PRO','ULTRA','ENTERPRISE') NOT NULL DEFAULT 'BASICO',
  `limite_cajas` int(11) NOT NULL DEFAULT 2,
  `token_licencia` varchar(64) NOT NULL,
  `activa` tinyint(1) NOT NULL DEFAULT 1,
  `fecha_activacion` datetime NOT NULL DEFAULT current_timestamp(),
  `notas` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `movimientoscaja`
--

CREATE TABLE `movimientoscaja` (
  `id_movimiento` int(11) NOT NULL,
  `fecha_hora` datetime NOT NULL,
  `tipo_movimiento` varchar(50) NOT NULL COMMENT 'INGRESO_VENTA, EGRESO_COMPRA, EGRESO_GASTO, AJUSTE_DEPOSITO, etc.',
  `monto` decimal(10,2) NOT NULL,
  `descripcion` text DEFAULT NULL,
  `referencia_id` int(11) DEFAULT NULL COMMENT 'ID de la Venta/Compra que gener?? el movimiento',
  `id_usuario` int(11) NOT NULL,
  `id_devolucion` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `movimientos_bancarios`
--

CREATE TABLE `movimientos_bancarios` (
  `id_movimiento_bancario` int(11) NOT NULL,
  `id_conciliacion` int(11) DEFAULT NULL,
  `fecha_movimiento` date NOT NULL,
  `tipo` varchar(50) NOT NULL COMMENT 'DEPOSITO, RETIRO, TRANSFERENCIA, etc.',
  `monto` decimal(10,2) NOT NULL,
  `descripcion` varchar(200) DEFAULT NULL,
  `referencia` varchar(100) DEFAULT NULL,
  `conciliado` tinyint(1) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `pagos_proveedores`
--

CREATE TABLE `pagos_proveedores` (
  `id_pago` int(11) NOT NULL,
  `id_cuenta` int(11) NOT NULL,
  `monto` decimal(10,2) NOT NULL,
  `fecha_pago` datetime NOT NULL DEFAULT current_timestamp(),
  `metodo_pago` varchar(50) NOT NULL COMMENT 'TRANSFERENCIA, CHEQUE, EFECTIVO, etc.',
  `referencia` varchar(100) DEFAULT NULL COMMENT 'N??mero de cheque, referencia de transferencia, etc.',
  `id_usuario` int(11) NOT NULL COMMENT 'Usuario que registr?? el pago',
  `notas` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `productos`
--

CREATE TABLE `productos` (
  `id_producto` int(11) NOT NULL,
  `nombre` varchar(200) NOT NULL,
  `codigo_barras` varchar(64) DEFAULT NULL,
  `marca` varchar(100) NOT NULL,
  `descripcion` text DEFAULT NULL,
  `precio_costo` decimal(10,2) DEFAULT NULL,
  `precio_venta` decimal(10,2) NOT NULL,
  `inventario` decimal(12,6) NOT NULL DEFAULT 0.000000,
  `stock_minimo` decimal(12,6) NOT NULL DEFAULT 0.000000,
  `ruta_imagen` varchar(255) DEFAULT NULL,
  `unidad_medida` varchar(20) NOT NULL DEFAULT 'UNIDAD' COMMENT 'UNIDAD, KILO, LITRO, METRO, GRAMO, CAJA, PAQUETE',
  `unidades_por_empaque` decimal(12,3) DEFAULT NULL COMMENT 'Unidades dentro de 1 caja o 1 paquete',
  `usa_tallas` tinyint(1) NOT NULL DEFAULT 0 COMMENT '1 = producto con tallas (ropa/calzado)',
  `id_categoria` int(11) NOT NULL,
  `id_proveedor` int(11) DEFAULT NULL,
  `imagen_url` varchar(500) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `producto_promocion`
--

CREATE TABLE `producto_promocion` (
  `id_relacion` int(11) NOT NULL,
  `id_producto` int(11) NOT NULL,
  `id_promocion` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `promociones`
--

CREATE TABLE `promociones` (
  `id_promocion` int(11) NOT NULL,
  `nombre` varchar(150) NOT NULL,
  `descripcion` text DEFAULT NULL,
  `tipo_promocion` varchar(50) NOT NULL COMMENT 'DESCUENTO_PORCENTAJE, DESCUENTO_FIJO, COMPRA_X_LLEVA_Y, etc.',
  `valor` decimal(10,2) NOT NULL COMMENT 'Porcentaje o monto fijo seg??n tipo',
  `fecha_inicio` date NOT NULL,
  `fecha_fin` date NOT NULL,
  `activa` tinyint(1) NOT NULL DEFAULT 1,
  `id_categoria` int(11) DEFAULT NULL COMMENT 'Si aplica a una categor??a espec??fica',
  `id_producto` int(11) DEFAULT NULL COMMENT 'Si aplica a un producto espec??fico',
  `minimo_compra` decimal(10,2) DEFAULT 0.00 COMMENT 'Monto m??nimo de compra',
  `param_x` int(11) DEFAULT NULL,
  `param_y` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `proveedores`
--

CREATE TABLE `proveedores` (
  `id_proveedor` int(11) NOT NULL,
  `nombre` varchar(150) NOT NULL,
  `rif_ruc` varchar(40) DEFAULT NULL,
  `contacto` varchar(150) DEFAULT NULL,
  `telefono` varchar(20) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `roles`
--

CREATE TABLE `roles` (
  `id_rol` int(11) NOT NULL,
  `nombre_rol` varchar(50) NOT NULL COMMENT 'Ej: Administrador, Caja/Empleado'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `roles`
--

INSERT INTO `roles` (`id_rol`, `nombre_rol`) VALUES
(1, 'Administrador'),
(2, 'Caja/Empleado');

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `sesiones_activas`
--

CREATE TABLE `sesiones_activas` (
  `id_sesion` int(11) NOT NULL,
  `id_caja` int(11) DEFAULT NULL,
  `id_usuario` int(11) DEFAULT NULL,
  `rol_sesion` enum('ADMIN_SERVER','POS_CLIENT') NOT NULL DEFAULT 'POS_CLIENT',
  `token_sesion` varchar(64) NOT NULL,
  `fecha_conexion` datetime NOT NULL DEFAULT current_timestamp(),
  `ultima_actividad` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `tallas`
--

CREATE TABLE `tallas` (
  `id_talla` int(11) NOT NULL,
  `nombre` varchar(10) NOT NULL,
  `ajuste` varchar(50) DEFAULT NULL,
  `pecho` int(11) DEFAULT NULL,
  `cintura` int(11) DEFAULT NULL,
  `cadera` int(11) DEFAULT NULL,
  `largo` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `tallas`
--

INSERT INTO `tallas` (`id_talla`, `nombre`, `ajuste`, `pecho`, `cintura`, `cadera`, `largo`) VALUES
(2, 'xxl', 'Oversized', NULL, NULL, NULL, NULL),
(3, 's', NULL, NULL, NULL, NULL, NULL),
(4, 'm', NULL, NULL, NULL, NULL, NULL),
(5, 'l | Ajuste', 'Slim', 20, 20, 20, 20),
(12, 'xl', NULL, NULL, NULL, NULL, NULL),
(13, 'xs', NULL, NULL, NULL, NULL, NULL);

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `usuarios`
--

CREATE TABLE `usuarios` (
  `id_usuario` int(11) NOT NULL,
  `nombre` varchar(150) NOT NULL,
  `usuario` varchar(50) NOT NULL,
  `password_hash` varchar(255) NOT NULL COMMENT 'Contrase??a encriptada (debe usarse hashing)',
  `id_rol` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `usuarios`
--

INSERT INTO `usuarios` (`id_usuario`, `nombre`, `usuario`, `password_hash`, `id_rol`) VALUES
(1, 'frank', 'caja', '$2b$10$YBzkCsf/GSkuQTaYXfz2DeIrS8wFTQWoUlLgLTLgihW.nW83uICEK', 2),
(2, 'admin', 'admin', '$2b$10$aGU/oC94QgSZ.1eJ8cgZWuiBp53W.c/3Wi2v7PEhYbCekwfG1u/2a', 1);

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `ventas`
--

CREATE TABLE `ventas` (
  `id_venta` int(11) NOT NULL,
  `fecha_hora` datetime NOT NULL,
  `total_venta` decimal(10,2) NOT NULL,
  `monto_subtotal` decimal(10,2) DEFAULT NULL,
  `monto_descuento` decimal(10,2) DEFAULT NULL,
  `monto_iva` decimal(14,4) NOT NULL DEFAULT 0.0000,
  `iva_porcentaje` decimal(6,2) NOT NULL DEFAULT 0.00,
  `tipo_pago` varchar(50) NOT NULL,
  `id_usuario` int(11) NOT NULL COMMENT 'Usuario de caja que realiz?? la venta',
  `id_caja` int(11) DEFAULT NULL,
  `id_cliente` int(11) DEFAULT NULL COMMENT 'Puede ser NULL para ventas an??nimas',
  `tasa_dolar` decimal(12,4) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `venta_pagos`
--

CREATE TABLE `venta_pagos` (
  `id_pago` int(11) NOT NULL,
  `id_venta` int(11) NOT NULL,
  `forma_pago` varchar(80) NOT NULL,
  `monto_usd` decimal(14,4) NOT NULL DEFAULT 0.0000,
  `monto_bs` decimal(18,4) NOT NULL DEFAULT 0.0000,
  `tasa` decimal(18,6) DEFAULT NULL,
  `fecha_hora` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Estructura Stand-in para la vista `vista_margen_categoria`
-- (Véase abajo para la vista actual)
--
CREATE TABLE `vista_margen_categoria` (
`id_categoria` int(11)
,`categoria` varchar(100)
,`total_productos` bigint(21)
,`precio_promedio` decimal(14,6)
,`costo_promedio` decimal(14,6)
,`utilidad_promedio` decimal(15,6)
,`margen_promedio` decimal(24,10)
,`ventas_totales` decimal(44,5)
,`utilidad_total` decimal(45,5)
);

-- --------------------------------------------------------

--
-- Estructura Stand-in para la vista `vista_rotacion_inventario`
-- (Véase abajo para la vista actual)
--
CREATE TABLE `vista_rotacion_inventario` (
`id_producto` int(11)
,`nombre` varchar(200)
,`marca` varchar(100)
,`categoria` varchar(100)
,`stock_actual` decimal(34,3)
,`unidades_vendidas_ultimo_mes` decimal(34,3)
,`indice_rotacion` decimal(41,7)
);

-- --------------------------------------------------------

--
-- Estructura Stand-in para la vista `vista_utilidad_productos`
-- (Véase abajo para la vista actual)
--
CREATE TABLE `vista_utilidad_productos` (
`id_producto` int(11)
,`nombre` varchar(200)
,`marca` varchar(100)
,`categoria` varchar(100)
,`precio_venta` decimal(10,2)
,`costo_promedio` decimal(14,6)
,`utilidad_unitaria` decimal(15,6)
,`margen_ganancia` decimal(24,10)
,`stock_total` decimal(34,6)
,`unidades_vendidas` decimal(34,6)
,`total_ventas` decimal(44,5)
,`utilidad_total` decimal(49,9)
);

-- --------------------------------------------------------

--
-- Estructura Stand-in para la vista `vista_ventas_temporada`
-- (Véase abajo para la vista actual)
--
CREATE TABLE `vista_ventas_temporada` (
`anio` int(4)
,`mes` int(2)
,`trimestre` int(1)
,`periodo` varchar(7)
,`total_ventas` bigint(21)
,`ingreso_total` decimal(32,2)
,`promedio_venta` decimal(14,6)
,`unidades_vendidas` decimal(34,3)
,`clientes_atendidos` bigint(21)
);

-- --------------------------------------------------------

--
-- Estructura para la vista `vista_margen_categoria`
--
DROP TABLE IF EXISTS `vista_margen_categoria`;

CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`localhost` SQL SECURITY DEFINER VIEW `vista_margen_categoria`  AS SELECT `c`.`id_categoria` AS `id_categoria`, `c`.`nombre` AS `categoria`, count(distinct `p`.`id_producto`) AS `total_productos`, avg(`p`.`precio_venta`) AS `precio_promedio`, avg(coalesce(`i`.`costo_promedio`,0)) AS `costo_promedio`, avg(`p`.`precio_venta` - coalesce(`i`.`costo_promedio`,0)) AS `utilidad_promedio`, avg((`p`.`precio_venta` - coalesce(`i`.`costo_promedio`,0)) / nullif(`p`.`precio_venta`,0) * 100) AS `margen_promedio`, coalesce(sum(`dv`.`cantidad` * `dv`.`precio_unitario`),0) AS `ventas_totales`, coalesce(sum(`dv`.`cantidad` * (`dv`.`precio_unitario` - coalesce(`i`.`costo_promedio`,0))),0) AS `utilidad_total` FROM (((`categorias` `c` left join `productos` `p` on(`c`.`id_categoria` = `p`.`id_categoria`)) left join `inventario` `i` on(`p`.`id_producto` = `i`.`id_producto`)) left join `detalleventa` `dv` on(`p`.`id_producto` = `dv`.`id_producto`)) GROUP BY `c`.`id_categoria`, `c`.`nombre` ;

-- --------------------------------------------------------

--
-- Estructura para la vista `vista_rotacion_inventario`
--
DROP TABLE IF EXISTS `vista_rotacion_inventario`;

CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`localhost` SQL SECURITY DEFINER VIEW `vista_rotacion_inventario`  AS SELECT `p`.`id_producto` AS `id_producto`, `p`.`nombre` AS `nombre`, `p`.`marca` AS `marca`, `c`.`nombre` AS `categoria`, coalesce(sum(`i`.`cantidad`),0) AS `stock_actual`, coalesce(sum(case when `v`.`fecha_hora` >= curdate() - interval 1 month then `dv`.`cantidad` else 0 end),0) AS `unidades_vendidas_ultimo_mes`, CASE WHEN coalesce(sum(`i`.`cantidad`),0) > 0 THEN coalesce(sum(case when `v`.`fecha_hora` >= curdate() - interval 1 month then `dv`.`cantidad` else 0 end),0) / sum(`i`.`cantidad`) ELSE 0 END AS `indice_rotacion` FROM ((((`productos` `p` left join `categorias` `c` on(`p`.`id_categoria` = `c`.`id_categoria`)) left join `inventario` `i` on(`p`.`id_producto` = `i`.`id_producto`)) left join `detalleventa` `dv` on(`p`.`id_producto` = `dv`.`id_producto`)) left join `ventas` `v` on(`dv`.`id_venta` = `v`.`id_venta`)) GROUP BY `p`.`id_producto`, `p`.`nombre`, `p`.`marca`, `c`.`nombre` ;

-- --------------------------------------------------------

--
-- Estructura para la vista `vista_utilidad_productos`
--
DROP TABLE IF EXISTS `vista_utilidad_productos`;

CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`localhost` SQL SECURITY DEFINER VIEW `vista_utilidad_productos`  AS SELECT `p`.`id_producto` AS `id_producto`, `p`.`nombre` AS `nombre`, `p`.`marca` AS `marca`, coalesce(`c`.`nombre`,'Sin categor??a') AS `categoria`, `p`.`precio_venta` AS `precio_venta`, coalesce((select avg(`inventario`.`costo_promedio`) from `inventario` where `inventario`.`id_producto` = `p`.`id_producto` and `inventario`.`costo_promedio` > 0),0) AS `costo_promedio`, `p`.`precio_venta`- coalesce((select avg(`inventario`.`costo_promedio`) from `inventario` where `inventario`.`id_producto` = `p`.`id_producto` and `inventario`.`costo_promedio` > 0),0) AS `utilidad_unitaria`, CASE WHEN `p`.`precio_venta` > 0 THEN (`p`.`precio_venta` - coalesce((select avg(`inventario`.`costo_promedio`) from `inventario` where `inventario`.`id_producto` = `p`.`id_producto` and `inventario`.`costo_promedio` > 0),0)) / `p`.`precio_venta` * 100 ELSE 0 END AS `margen_ganancia`, coalesce((select sum(`inventario`.`cantidad`) from `inventario` where `inventario`.`id_producto` = `p`.`id_producto`),0) AS `stock_total`, coalesce((select sum(`detalleventa`.`cantidad`) from `detalleventa` where `detalleventa`.`id_producto` = `p`.`id_producto`),0) AS `unidades_vendidas`, coalesce((select sum(`detalleventa`.`cantidad` * `detalleventa`.`precio_unitario`) from `detalleventa` where `detalleventa`.`id_producto` = `p`.`id_producto`),0) AS `total_ventas`, coalesce((select sum(`dv2`.`cantidad` * `dv2`.`precio_unitario`) - sum(`dv2`.`cantidad` * coalesce((select avg(`inventario`.`costo_promedio`) from `inventario` where `inventario`.`id_producto` = `p`.`id_producto` and `inventario`.`costo_promedio` > 0),0)) from `detalleventa` `dv2` where `dv2`.`id_producto` = `p`.`id_producto`),0) AS `utilidad_total` FROM (`productos` `p` left join `categorias` `c` on(`p`.`id_categoria` = `c`.`id_categoria`)) ;

-- --------------------------------------------------------

--
-- Estructura para la vista `vista_ventas_temporada`
--
DROP TABLE IF EXISTS `vista_ventas_temporada`;

CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`localhost` SQL SECURITY DEFINER VIEW `vista_ventas_temporada`  AS SELECT year(`v`.`fecha_hora`) AS `anio`, month(`v`.`fecha_hora`) AS `mes`, quarter(`v`.`fecha_hora`) AS `trimestre`, date_format(`v`.`fecha_hora`,'%Y-%m') AS `periodo`, count(distinct `v`.`id_venta`) AS `total_ventas`, sum(`v`.`total_venta`) AS `ingreso_total`, avg(`v`.`total_venta`) AS `promedio_venta`, coalesce(sum(`dv`.`cantidad`),0) AS `unidades_vendidas`, count(distinct `v`.`id_cliente`) AS `clientes_atendidos` FROM (`ventas` `v` left join `detalleventa` `dv` on(`v`.`id_venta` = `dv`.`id_venta`)) GROUP BY year(`v`.`fecha_hora`), month(`v`.`fecha_hora`), quarter(`v`.`fecha_hora`), date_format(`v`.`fecha_hora`,'%Y-%m') ;

--
-- Índices para tablas volcadas
--

--
-- Indices de la tabla `cajas`
--
ALTER TABLE `cajas`
  ADD PRIMARY KEY (`id_caja`),
  ADD UNIQUE KEY `uk_cajas_clave` (`clave_caja`),
  ADD UNIQUE KEY `uk_cajas_mac` (`direccion_mac`);

--
-- Indices de la tabla `categorias`
--
ALTER TABLE `categorias`
  ADD PRIMARY KEY (`id_categoria`),
  ADD UNIQUE KEY `nombre` (`nombre`);

--
-- Indices de la tabla `clientes`
--
ALTER TABLE `clientes`
  ADD PRIMARY KEY (`id_cliente`),
  ADD UNIQUE KEY `cedula` (`cedula`);

--
-- Indices de la tabla `compras`
--
ALTER TABLE `compras`
  ADD PRIMARY KEY (`id_compra`),
  ADD KEY `id_proveedor` (`id_proveedor`);

--
-- Indices de la tabla `conciliacion_bancaria`
--
ALTER TABLE `conciliacion_bancaria`
  ADD PRIMARY KEY (`id_conciliacion`),
  ADD KEY `id_usuario` (`id_usuario`);

--
-- Indices de la tabla `configuracion`
--
ALTER TABLE `configuracion`
  ADD PRIMARY KEY (`id_config`),
  ADD UNIQUE KEY `clave` (`clave`);

--
-- Indices de la tabla `cuentas_por_pagar`
--
ALTER TABLE `cuentas_por_pagar`
  ADD PRIMARY KEY (`id_cuenta`),
  ADD KEY `id_proveedor` (`id_proveedor`),
  ADD KEY `id_compra` (`id_compra`);

--
-- Indices de la tabla `detallecompra`
--
ALTER TABLE `detallecompra`
  ADD PRIMARY KEY (`id_detalle`),
  ADD KEY `id_compra` (`id_compra`),
  ADD KEY `id_producto` (`id_producto`),
  ADD KEY `idx_detallecompra_id_talla` (`id_talla`);

--
-- Indices de la tabla `detalleventa`
--
ALTER TABLE `detalleventa`
  ADD PRIMARY KEY (`id_detalle`),
  ADD KEY `id_venta` (`id_venta`),
  ADD KEY `id_producto` (`id_producto`),
  ADD KEY `id_talla` (`id_talla`),
  ADD KEY `idx_detalleventa_promocion` (`id_promocion_aplicada`);

--
-- Indices de la tabla `devoluciones`
--
ALTER TABLE `devoluciones`
  ADD PRIMARY KEY (`id_devolucion`),
  ADD KEY `id_detalle` (`id_detalle`);

--
-- Indices de la tabla `inventario`
--
ALTER TABLE `inventario`
  ADD PRIMARY KEY (`id_inventario`),
  ADD UNIQUE KEY `uk_inventario` (`id_producto`,`id_talla`),
  ADD KEY `id_talla` (`id_talla`);

--
-- Indices de la tabla `licencias`
--
ALTER TABLE `licencias`
  ADD PRIMARY KEY (`id_licencia`),
  ADD UNIQUE KEY `uk_licencias_token` (`token_licencia`);

--
-- Indices de la tabla `movimientoscaja`
--
ALTER TABLE `movimientoscaja`
  ADD PRIMARY KEY (`id_movimiento`),
  ADD KEY `id_usuario` (`id_usuario`),
  ADD KEY `id_devolucion` (`id_devolucion`);

--
-- Indices de la tabla `movimientos_bancarios`
--
ALTER TABLE `movimientos_bancarios`
  ADD PRIMARY KEY (`id_movimiento_bancario`),
  ADD KEY `id_conciliacion` (`id_conciliacion`);

--
-- Indices de la tabla `pagos_proveedores`
--
ALTER TABLE `pagos_proveedores`
  ADD PRIMARY KEY (`id_pago`),
  ADD KEY `id_cuenta` (`id_cuenta`),
  ADD KEY `id_usuario` (`id_usuario`);

--
-- Indices de la tabla `productos`
--
ALTER TABLE `productos`
  ADD PRIMARY KEY (`id_producto`),
  ADD UNIQUE KEY `uk_productos_codigo_barras` (`codigo_barras`),
  ADD KEY `id_categoria` (`id_categoria`),
  ADD KEY `id_proveedor` (`id_proveedor`);

--
-- Indices de la tabla `producto_promocion`
--
ALTER TABLE `producto_promocion`
  ADD PRIMARY KEY (`id_relacion`),
  ADD UNIQUE KEY `uk_prod_promo` (`id_producto`,`id_promocion`),
  ADD KEY `idx_pp_promocion` (`id_promocion`);

--
-- Indices de la tabla `promociones`
--
ALTER TABLE `promociones`
  ADD PRIMARY KEY (`id_promocion`),
  ADD KEY `id_categoria` (`id_categoria`),
  ADD KEY `id_producto` (`id_producto`),
  ADD KEY `idx_promociones_activa` (`activa`),
  ADD KEY `idx_promociones_fecha` (`fecha_inicio`,`fecha_fin`);

--
-- Indices de la tabla `proveedores`
--
ALTER TABLE `proveedores`
  ADD PRIMARY KEY (`id_proveedor`);

--
-- Indices de la tabla `roles`
--
ALTER TABLE `roles`
  ADD PRIMARY KEY (`id_rol`),
  ADD UNIQUE KEY `nombre_rol` (`nombre_rol`);

--
-- Indices de la tabla `sesiones_activas`
--
ALTER TABLE `sesiones_activas`
  ADD PRIMARY KEY (`id_sesion`),
  ADD UNIQUE KEY `uk_sesiones_token` (`token_sesion`),
  ADD KEY `idx_sesiones_caja` (`id_caja`),
  ADD KEY `idx_sesiones_actividad` (`ultima_actividad`),
  ADD KEY `fk_sesiones_usuario` (`id_usuario`);

--
-- Indices de la tabla `tallas`
--
ALTER TABLE `tallas`
  ADD PRIMARY KEY (`id_talla`),
  ADD UNIQUE KEY `nombre` (`nombre`);

--
-- Indices de la tabla `usuarios`
--
ALTER TABLE `usuarios`
  ADD PRIMARY KEY (`id_usuario`),
  ADD UNIQUE KEY `usuario` (`usuario`),
  ADD KEY `id_rol` (`id_rol`);

--
-- Indices de la tabla `ventas`
--
ALTER TABLE `ventas`
  ADD PRIMARY KEY (`id_venta`),
  ADD KEY `id_usuario` (`id_usuario`),
  ADD KEY `id_cliente` (`id_cliente`),
  ADD KEY `fk_ventas_caja` (`id_caja`);

--
-- Indices de la tabla `venta_pagos`
--
ALTER TABLE `venta_pagos`
  ADD PRIMARY KEY (`id_pago`),
  ADD KEY `idx_venta_pagos_venta` (`id_venta`),
  ADD KEY `idx_venta_pagos_forma` (`forma_pago`);

--
-- AUTO_INCREMENT de las tablas volcadas
--

--
-- AUTO_INCREMENT de la tabla `cajas`
--
ALTER TABLE `cajas`
  MODIFY `id_caja` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;

--
-- AUTO_INCREMENT de la tabla `categorias`
--
ALTER TABLE `categorias`
  MODIFY `id_categoria` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=42;

--
-- AUTO_INCREMENT de la tabla `clientes`
--
ALTER TABLE `clientes`
  MODIFY `id_cliente` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=12;

--
-- AUTO_INCREMENT de la tabla `compras`
--
ALTER TABLE `compras`
  MODIFY `id_compra` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=63;

--
-- AUTO_INCREMENT de la tabla `conciliacion_bancaria`
--
ALTER TABLE `conciliacion_bancaria`
  MODIFY `id_conciliacion` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de la tabla `configuracion`
--
ALTER TABLE `configuracion`
  MODIFY `id_config` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=20;

--
-- AUTO_INCREMENT de la tabla `cuentas_por_pagar`
--
ALTER TABLE `cuentas_por_pagar`
  MODIFY `id_cuenta` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=20;

--
-- AUTO_INCREMENT de la tabla `detallecompra`
--
ALTER TABLE `detallecompra`
  MODIFY `id_detalle` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=69;

--
-- AUTO_INCREMENT de la tabla `detalleventa`
--
ALTER TABLE `detalleventa`
  MODIFY `id_detalle` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=88;

--
-- AUTO_INCREMENT de la tabla `devoluciones`
--
ALTER TABLE `devoluciones`
  MODIFY `id_devolucion` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=9;

--
-- AUTO_INCREMENT de la tabla `inventario`
--
ALTER TABLE `inventario`
  MODIFY `id_inventario` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=128;

--
-- AUTO_INCREMENT de la tabla `licencias`
--
ALTER TABLE `licencias`
  MODIFY `id_licencia` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT de la tabla `movimientoscaja`
--
ALTER TABLE `movimientoscaja`
  MODIFY `id_movimiento` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=29;

--
-- AUTO_INCREMENT de la tabla `movimientos_bancarios`
--
ALTER TABLE `movimientos_bancarios`
  MODIFY `id_movimiento_bancario` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de la tabla `pagos_proveedores`
--
ALTER TABLE `pagos_proveedores`
  MODIFY `id_pago` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=21;

--
-- AUTO_INCREMENT de la tabla `productos`
--
ALTER TABLE `productos`
  MODIFY `id_producto` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=64;

--
-- AUTO_INCREMENT de la tabla `producto_promocion`
--
ALTER TABLE `producto_promocion`
  MODIFY `id_relacion` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de la tabla `promociones`
--
ALTER TABLE `promociones`
  MODIFY `id_promocion` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=27;

--
-- AUTO_INCREMENT de la tabla `proveedores`
--
ALTER TABLE `proveedores`
  MODIFY `id_proveedor` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=11;

--
-- AUTO_INCREMENT de la tabla `roles`
--
ALTER TABLE `roles`
  MODIFY `id_rol` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- AUTO_INCREMENT de la tabla `sesiones_activas`
--
ALTER TABLE `sesiones_activas`
  MODIFY `id_sesion` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=46;

--
-- AUTO_INCREMENT de la tabla `tallas`
--
ALTER TABLE `tallas`
  MODIFY `id_talla` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=16;

--
-- AUTO_INCREMENT de la tabla `usuarios`
--
ALTER TABLE `usuarios`
  MODIFY `id_usuario` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=7;

--
-- AUTO_INCREMENT de la tabla `ventas`
--
ALTER TABLE `ventas`
  MODIFY `id_venta` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=103;

--
-- AUTO_INCREMENT de la tabla `venta_pagos`
--
ALTER TABLE `venta_pagos`
  MODIFY `id_pago` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=18;

--
-- Restricciones para tablas volcadas
--

--
-- Filtros para la tabla `compras`
--
ALTER TABLE `compras`
  ADD CONSTRAINT `compras_ibfk_1` FOREIGN KEY (`id_proveedor`) REFERENCES `proveedores` (`id_proveedor`);

--
-- Filtros para la tabla `conciliacion_bancaria`
--
ALTER TABLE `conciliacion_bancaria`
  ADD CONSTRAINT `conciliacion_bancaria_ibfk_1` FOREIGN KEY (`id_usuario`) REFERENCES `usuarios` (`id_usuario`);

--
-- Filtros para la tabla `cuentas_por_pagar`
--
ALTER TABLE `cuentas_por_pagar`
  ADD CONSTRAINT `cuentas_por_pagar_ibfk_1` FOREIGN KEY (`id_proveedor`) REFERENCES `proveedores` (`id_proveedor`),
  ADD CONSTRAINT `cuentas_por_pagar_ibfk_2` FOREIGN KEY (`id_compra`) REFERENCES `compras` (`id_compra`) ON DELETE SET NULL;

--
-- Filtros para la tabla `detallecompra`
--
ALTER TABLE `detallecompra`
  ADD CONSTRAINT `detallecompra_ibfk_1` FOREIGN KEY (`id_compra`) REFERENCES `compras` (`id_compra`),
  ADD CONSTRAINT `detallecompra_ibfk_2` FOREIGN KEY (`id_producto`) REFERENCES `productos` (`id_producto`);

--
-- Filtros para la tabla `detalleventa`
--
ALTER TABLE `detalleventa`
  ADD CONSTRAINT `detalleventa_ibfk_1` FOREIGN KEY (`id_venta`) REFERENCES `ventas` (`id_venta`),
  ADD CONSTRAINT `detalleventa_ibfk_2` FOREIGN KEY (`id_producto`) REFERENCES `productos` (`id_producto`),
  ADD CONSTRAINT `detalleventa_ibfk_3` FOREIGN KEY (`id_talla`) REFERENCES `tallas` (`id_talla`);

--
-- Filtros para la tabla `devoluciones`
--
ALTER TABLE `devoluciones`
  ADD CONSTRAINT `devoluciones_ibfk_1` FOREIGN KEY (`id_detalle`) REFERENCES `detalleventa` (`id_detalle`);

--
-- Filtros para la tabla `inventario`
--
ALTER TABLE `inventario`
  ADD CONSTRAINT `inventario_ibfk_1` FOREIGN KEY (`id_producto`) REFERENCES `productos` (`id_producto`),
  ADD CONSTRAINT `inventario_ibfk_2` FOREIGN KEY (`id_talla`) REFERENCES `tallas` (`id_talla`);

--
-- Filtros para la tabla `movimientoscaja`
--
ALTER TABLE `movimientoscaja`
  ADD CONSTRAINT `movimientoscaja_ibfk_1` FOREIGN KEY (`id_usuario`) REFERENCES `usuarios` (`id_usuario`),
  ADD CONSTRAINT `movimientoscaja_ibfk_2` FOREIGN KEY (`id_devolucion`) REFERENCES `devoluciones` (`id_devolucion`) ON DELETE SET NULL;

--
-- Filtros para la tabla `movimientos_bancarios`
--
ALTER TABLE `movimientos_bancarios`
  ADD CONSTRAINT `movimientos_bancarios_ibfk_1` FOREIGN KEY (`id_conciliacion`) REFERENCES `conciliacion_bancaria` (`id_conciliacion`) ON DELETE SET NULL;

--
-- Filtros para la tabla `pagos_proveedores`
--
ALTER TABLE `pagos_proveedores`
  ADD CONSTRAINT `pagos_proveedores_ibfk_1` FOREIGN KEY (`id_cuenta`) REFERENCES `cuentas_por_pagar` (`id_cuenta`),
  ADD CONSTRAINT `pagos_proveedores_ibfk_2` FOREIGN KEY (`id_usuario`) REFERENCES `usuarios` (`id_usuario`);

--
-- Filtros para la tabla `productos`
--
ALTER TABLE `productos`
  ADD CONSTRAINT `productos_ibfk_1` FOREIGN KEY (`id_categoria`) REFERENCES `categorias` (`id_categoria`),
  ADD CONSTRAINT `productos_ibfk_2` FOREIGN KEY (`id_proveedor`) REFERENCES `proveedores` (`id_proveedor`);

--
-- Filtros para la tabla `producto_promocion`
--
ALTER TABLE `producto_promocion`
  ADD CONSTRAINT `fk_pp_producto` FOREIGN KEY (`id_producto`) REFERENCES `productos` (`id_producto`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_pp_promocion` FOREIGN KEY (`id_promocion`) REFERENCES `promociones` (`id_promocion`) ON DELETE CASCADE;

--
-- Filtros para la tabla `promociones`
--
ALTER TABLE `promociones`
  ADD CONSTRAINT `promociones_ibfk_1` FOREIGN KEY (`id_categoria`) REFERENCES `categorias` (`id_categoria`) ON DELETE SET NULL,
  ADD CONSTRAINT `promociones_ibfk_2` FOREIGN KEY (`id_producto`) REFERENCES `productos` (`id_producto`) ON DELETE SET NULL;

--
-- Filtros para la tabla `sesiones_activas`
--
ALTER TABLE `sesiones_activas`
  ADD CONSTRAINT `fk_sesiones_caja` FOREIGN KEY (`id_caja`) REFERENCES `cajas` (`id_caja`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_sesiones_usuario` FOREIGN KEY (`id_usuario`) REFERENCES `usuarios` (`id_usuario`) ON DELETE SET NULL;

--
-- Filtros para la tabla `usuarios`
--
ALTER TABLE `usuarios`
  ADD CONSTRAINT `usuarios_ibfk_1` FOREIGN KEY (`id_rol`) REFERENCES `roles` (`id_rol`);

--
-- Filtros para la tabla `ventas`
--
ALTER TABLE `ventas`
  ADD CONSTRAINT `fk_ventas_caja` FOREIGN KEY (`id_caja`) REFERENCES `cajas` (`id_caja`) ON DELETE SET NULL,
  ADD CONSTRAINT `ventas_ibfk_1` FOREIGN KEY (`id_usuario`) REFERENCES `usuarios` (`id_usuario`),
  ADD CONSTRAINT `ventas_ibfk_2` FOREIGN KEY (`id_cliente`) REFERENCES `clientes` (`id_cliente`);

--
-- Filtros para la tabla `venta_pagos`
--
ALTER TABLE `venta_pagos`
  ADD CONSTRAINT `venta_pagos_ibfk_venta` FOREIGN KEY (`id_venta`) REFERENCES `ventas` (`id_venta`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
