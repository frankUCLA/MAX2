-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Servidor: 127.0.0.1
-- Tiempo de generación: 12-11-2025 a las 00:23:07
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
-- Base de datos: `modasoft_db`
--

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
(34, 'blusas'),
(36, 'camisa'),
(32, 'franelillas'),
(38, 'monos'),
(31, 'pantalones'),
(37, 'shemin'),
(33, 'shores'),
(35, 'zapato');

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `clientes`
--

CREATE TABLE `clientes` (
  `id_cliente` int(11) NOT NULL,
  `nombre` varchar(150) NOT NULL,
  `cedula` varchar(20) DEFAULT NULL,
  `telefono` varchar(20) DEFAULT NULL,
  `email` varchar(100) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `clientes`
--

INSERT INTO `clientes` (`id_cliente`, `nombre`, `cedula`, `telefono`, `email`) VALUES
(6, 'frankelvs', '30928764', '123456', 'fra@gmail.con'),
(7, 'yoileanys', '31319207', '04143500330', 'agvcsguw@gmail.com');

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `compras`
--

CREATE TABLE `compras` (
  `id_compra` int(11) NOT NULL,
  `id_proveedor` int(11) NOT NULL,
  `fecha_compra` date NOT NULL,
  `total_compra` decimal(10,2) NOT NULL,
  `estado_pago` varchar(50) NOT NULL COMMENT 'Pagada, Pendiente, Parcial'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `compras`
--

INSERT INTO `compras` (`id_compra`, `id_proveedor`, `fecha_compra`, `total_compra`, `estado_pago`) VALUES
(8, 1, '2025-11-05', 80.00, 'Pagada'),
(9, 9, '2025-11-04', 100.00, 'Pagada'),
(10, 9, '2025-11-05', 50.00, 'Pagada'),
(11, 9, '2025-11-05', 23.00, 'Pagada'),
(12, 1, '2025-11-07', 80.00, 'Pagada'),
(13, 1, '2025-11-07', 40.00, 'Pagada'),
(14, 1, '2025-11-07', 16.00, 'Pendiente'),
(15, 1, '2025-11-07', 8.00, 'Parcial'),
(16, 1, '2025-11-07', 16.00, 'PARCIAL'),
(17, 4, '2025-11-07', 50.00, 'Pagada'),
(18, 9, '2025-11-08', 39.00, 'Parcial'),
(19, 1, '2025-11-08', 29.40, 'Pagada');

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `conciliacion_bancaria`
--

CREATE TABLE `conciliacion_bancaria` (
  `id_conciliacion` int(11) NOT NULL,
  `fecha_conciliacion` date NOT NULL,
  `saldo_libro` decimal(10,2) NOT NULL COMMENT 'Saldo según nuestros registros',
  `saldo_banco` decimal(10,2) NOT NULL COMMENT 'Saldo según extracto bancario',
  `diferencia` decimal(10,2) NOT NULL COMMENT 'Diferencia entre saldo_libro y saldo_banco',
  `estado` varchar(50) NOT NULL DEFAULT 'PENDIENTE' COMMENT 'PENDIENTE, CONCILIADA, CON_DIFERENCIAS',
  `notas` text DEFAULT NULL,
  `id_usuario` int(11) NOT NULL COMMENT 'Usuario que realizó la conciliación',
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
(8, 'clave_devoluciones', 'devol123', 'Clave de acceso para módulo de devoluciones');

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `cuentas_por_pagar`
--

CREATE TABLE `cuentas_por_pagar` (
  `id_cuenta` int(11) NOT NULL,
  `id_proveedor` int(11) NOT NULL,
  `id_compra` int(11) DEFAULT NULL COMMENT 'Referencia a la compra que generó la cuenta',
  `monto_total` decimal(10,2) NOT NULL,
  `monto_pagado` decimal(10,2) NOT NULL DEFAULT 0.00,
  `monto_pendiente` decimal(10,2) NOT NULL COMMENT 'Calculado: monto_total - monto_pagado',
  `fecha_vencimiento` date NOT NULL,
  `estado` varchar(50) NOT NULL DEFAULT 'PENDIENTE' COMMENT 'PENDIENTE, PARCIAL, PAGADA, VENCIDA',
  `fecha_registro` datetime NOT NULL DEFAULT current_timestamp(),
  `notas` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `cuentas_por_pagar`
--

INSERT INTO `cuentas_por_pagar` (`id_cuenta`, `id_proveedor`, `id_compra`, `monto_total`, `monto_pagado`, `monto_pendiente`, `fecha_vencimiento`, `estado`, `fecha_registro`, `notas`) VALUES
(1, 1, 16, 16.00, 7.98, 8.02, '2025-12-07', 'PARCIAL', '2025-11-07 15:00:17', NULL);

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `detallecompra`
--

CREATE TABLE `detallecompra` (
  `id_detalle` int(11) NOT NULL,
  `id_compra` int(11) NOT NULL,
  `id_producto` int(11) NOT NULL,
  `cantidad` int(11) NOT NULL,
  `costo_unitario` decimal(10,2) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `detallecompra`
--

INSERT INTO `detallecompra` (`id_detalle`, `id_compra`, `id_producto`, `cantidad`, `costo_unitario`) VALUES
(6, 8, 34, 10, 8.00),
(7, 9, 35, 25, 4.00),
(8, 10, 36, 5, 10.00),
(9, 11, 36, 2, 10.00),
(10, 11, 37, 3, 1.00),
(11, 12, 34, 5, 8.00),
(12, 12, 34, 5, 8.00),
(13, 13, 34, 5, 8.00),
(14, 14, 34, 2, 8.00),
(15, 15, 34, 1, 8.00),
(16, 16, 34, 2, 8.00),
(17, 17, 38, 5, 10.00),
(18, 18, 39, 10, 3.00),
(19, 18, 39, 3, 3.00),
(20, 19, 40, 3, 9.80);

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `detalleventa`
--

CREATE TABLE `detalleventa` (
  `id_detalle` int(11) NOT NULL,
  `id_venta` int(11) NOT NULL,
  `id_producto` int(11) NOT NULL,
  `id_talla` int(11) NOT NULL,
  `cantidad` int(11) NOT NULL,
  `precio_unitario` decimal(10,2) NOT NULL,
  `id_promocion_aplicada` int(11) DEFAULT NULL,
  `descuento_unitario` decimal(12,2) DEFAULT NULL,
  `descuento_total` decimal(12,2) DEFAULT NULL,
  `producto_nombre` varchar(255) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `detalleventa`
--

INSERT INTO `detalleventa` (`id_detalle`, `id_venta`, `id_producto`, `id_talla`, `cantidad`, `precio_unitario`, `id_promocion_aplicada`, `descuento_unitario`, `descuento_total`, `producto_nombre`) VALUES
(19, 49, 34, 5, 1, 10.00, 16, 1.00, 1.00, NULL),
(20, 50, 35, 3, 1, 6.00, NULL, 0.00, 0.00, NULL),
(21, 51, 36, 4, 1, 20.00, NULL, 0.00, 0.00, NULL),
(22, 51, 36, 3, 1, 20.00, NULL, 0.00, 0.00, NULL),
(23, 52, 36, 4, 2, 20.00, 18, 1.00, 2.00, NULL),
(24, 52, 34, 4, 2, 10.00, NULL, 0.00, 0.00, NULL),
(25, 53, 34, 5, 2, 10.00, NULL, 0.00, 0.00, NULL);

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `devoluciones`
--

CREATE TABLE `devoluciones` (
  `id_devolucion` int(11) NOT NULL,
  `id_detalle` int(11) NOT NULL COMMENT 'El item de la venta original',
  `fecha_hora` datetime NOT NULL,
  `cantidad` int(11) NOT NULL,
  `monto_reembolsado` decimal(10,2) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `devoluciones`
--

INSERT INTO `devoluciones` (`id_devolucion`, `id_detalle`, `fecha_hora`, `cantidad`, `monto_reembolsado`) VALUES
(2, 20, '2025-11-05 14:13:29', 1, 6.00);

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `inventario`
--

CREATE TABLE `inventario` (
  `id_inventario` int(11) NOT NULL,
  `id_producto` int(11) NOT NULL,
  `id_talla` int(11) NOT NULL,
  `cantidad` int(11) NOT NULL DEFAULT 0,
  `costo_promedio` decimal(10,2) NOT NULL DEFAULT 0.00 COMMENT 'Costo para cálculo de utilidad'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `inventario`
--

INSERT INTO `inventario` (`id_inventario`, `id_producto`, `id_talla`, `cantidad`, `costo_promedio`) VALUES
(69, 34, 5, 5, 0.00),
(70, 34, 4, 6, 0.00),
(71, 34, 3, 2, 0.00),
(72, 34, 2, 4, 0.00),
(73, 35, 5, 5, 0.00),
(74, 35, 4, 5, 0.00),
(75, 35, 3, 5, 0.00),
(76, 35, 12, 5, 0.00),
(77, 35, 2, 5, 0.00),
(78, 36, 5, 3, 0.00),
(79, 36, 4, 2, 0.00),
(80, 36, 3, 3, 0.00),
(81, 36, 12, 8, 0.00),
(82, 37, 5, 4, 0.00),
(83, 37, 4, 6, 0.00),
(84, 37, 3, 1, 0.00),
(85, 37, 12, 2, 0.00),
(86, 37, 2, 6, 0.00),
(87, 34, 12, 5, 0.00),
(88, 34, 13, 3, 0.00),
(89, 38, 5, 5, 0.00),
(90, 39, 3, 10, 0.00),
(91, 39, 5, 3, 0.00),
(92, 40, 4, 3, 0.00);

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
  `referencia_id` int(11) DEFAULT NULL COMMENT 'ID de la Venta/Compra que generó el movimiento',
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
  `referencia` varchar(100) DEFAULT NULL COMMENT 'Número de cheque, referencia de transferencia, etc.',
  `id_usuario` int(11) NOT NULL COMMENT 'Usuario que registró el pago',
  `notas` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `pagos_proveedores`
--

INSERT INTO `pagos_proveedores` (`id_pago`, `id_cuenta`, `monto`, `fecha_pago`, `metodo_pago`, `referencia`, `id_usuario`, `notas`) VALUES
(1, 1, 7.98, '2025-11-07 15:00:17', 'EFECTIVO', NULL, 2, NULL);

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `productos`
--

CREATE TABLE `productos` (
  `id_producto` int(11) NOT NULL,
  `nombre` varchar(200) NOT NULL,
  `marca` varchar(100) NOT NULL,
  `descripcion` text DEFAULT NULL,
  `precio_venta` decimal(10,2) NOT NULL,
  `inventario` int(11) NOT NULL DEFAULT 0,
  `id_categoria` int(11) NOT NULL,
  `id_proveedor` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `productos`
--

INSERT INTO `productos` (`id_producto`, `nombre`, `marca`, `descripcion`, `precio_venta`, `inventario`, `id_categoria`, `id_proveedor`) VALUES
(34, 'tomy', 'shein', NULL, 10.00, 35, 31, 1),
(35, 'algodon', 'ovejita', NULL, 6.00, 50, 32, 9),
(36, 'navideñas', 'picola', NULL, 20.00, 23, 32, 9),
(37, 'otoño', 'ovejita', NULL, 8.00, 22, 32, 9),
(38, 'cuadro', 'gucci', NULL, 15.00, 5, 33, 4),
(39, 'flores', 'Fast Fashion', NULL, 5.00, 13, 34, 9),
(40, 'air', 'nike', NULL, 10.00, 3, 35, 1);

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `promociones`
--

CREATE TABLE `promociones` (
  `id_promocion` int(11) NOT NULL,
  `nombre` varchar(150) NOT NULL,
  `descripcion` text DEFAULT NULL,
  `tipo_promocion` varchar(50) NOT NULL COMMENT 'DESCUENTO_PORCENTAJE, DESCUENTO_FIJO, COMPRA_X_LLEVA_Y, etc.',
  `valor` decimal(10,2) NOT NULL COMMENT 'Porcentaje o monto fijo según tipo',
  `fecha_inicio` date NOT NULL,
  `fecha_fin` date NOT NULL,
  `activa` tinyint(1) NOT NULL DEFAULT 1,
  `id_categoria` int(11) DEFAULT NULL COMMENT 'Si aplica a una categoría específica',
  `id_producto` int(11) DEFAULT NULL COMMENT 'Si aplica a un producto específico',
  `minimo_compra` decimal(10,2) DEFAULT 0.00 COMMENT 'Monto mínimo de compra',
  `param_x` int(11) DEFAULT NULL,
  `param_y` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `promociones`
--

INSERT INTO `promociones` (`id_promocion`, `nombre`, `descripcion`, `tipo_promocion`, `valor`, `fecha_inicio`, `fecha_fin`, `activa`, `id_categoria`, `id_producto`, `minimo_compra`, `param_x`, `param_y`) VALUES
(18, 'naviidad', NULL, 'DESCUENTO_PORCENTAJE', 5.00, '2025-11-05', '2025-11-10', 1, 32, 36, 2.00, NULL, NULL);

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `proveedores`
--

CREATE TABLE `proveedores` (
  `id_proveedor` int(11) NOT NULL,
  `nombre` varchar(150) NOT NULL,
  `contacto` varchar(150) DEFAULT NULL,
  `telefono` varchar(20) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `proveedores`
--

INSERT INTO `proveedores` (`id_proveedor`, `nombre`, `contacto`, `telefono`) VALUES
(1, 'fran', '123', '123'),
(4, 'yoileannys', 'jfdutrd', '5649846485'),
(9, 'alexandra', 'chugeh', '0763368887');

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
  `password_hash` varchar(255) NOT NULL COMMENT 'Contraseña encriptada (debe usarse hashing)',
  `id_rol` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `usuarios`
--

INSERT INTO `usuarios` (`id_usuario`, `nombre`, `usuario`, `password_hash`, `id_rol`) VALUES
(1, 'frank', 'caja', '$2b$10$YBzkCsf/GSkuQTaYXfz2DeIrS8wFTQWoUlLgLTLgihW.nW83uICEK', 2),
(2, 'admin', 'admin', '$2b$10$YBzkCsf/GSkuQTaYXfz2DeIrS8wFTQWoUlLgLTLgihW.nW83uICEK', 1);

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `ventas`
--

CREATE TABLE `ventas` (
  `id_venta` int(11) NOT NULL,
  `fecha_hora` datetime NOT NULL,
  `total_venta` decimal(10,2) NOT NULL,
  `tipo_pago` varchar(50) NOT NULL,
  `id_usuario` int(11) NOT NULL COMMENT 'Usuario de caja que realizó la venta',
  `id_cliente` int(11) DEFAULT NULL COMMENT 'Puede ser NULL para ventas anónimas'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `ventas`
--

INSERT INTO `ventas` (`id_venta`, `fecha_hora`, `total_venta`, `tipo_pago`, `id_usuario`, `id_cliente`) VALUES
(49, '2025-11-05 13:01:40', 9.00, 'Transferencia', 1, 6),
(50, '2025-11-05 14:12:40', 0.00, 'Punto de venta', 1, 7),
(51, '2025-11-05 15:12:31', 40.00, 'Punto de venta', 1, 7),
(52, '2025-11-05 15:27:03', 58.00, 'Pago Móvil', 1, 7),
(53, '2025-11-07 13:42:48', 20.00, 'Pago Móvil', 1, 7);

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
,`ventas_totales` decimal(42,2)
,`utilidad_total` decimal(43,2)
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
,`stock_actual` decimal(32,0)
,`unidades_vendidas_ultimo_mes` decimal(32,0)
,`indice_rotacion` decimal(36,4)
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
,`stock_total` decimal(32,0)
,`unidades_vendidas` decimal(32,0)
,`total_ventas` decimal(42,2)
,`utilidad_total` decimal(47,6)
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
,`unidades_vendidas` decimal(32,0)
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

CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`localhost` SQL SECURITY DEFINER VIEW `vista_utilidad_productos`  AS SELECT `p`.`id_producto` AS `id_producto`, `p`.`nombre` AS `nombre`, `p`.`marca` AS `marca`, coalesce(`c`.`nombre`,'Sin categoría') AS `categoria`, `p`.`precio_venta` AS `precio_venta`, coalesce((select avg(`inventario`.`costo_promedio`) from `inventario` where `inventario`.`id_producto` = `p`.`id_producto` and `inventario`.`costo_promedio` > 0),0) AS `costo_promedio`, `p`.`precio_venta`- coalesce((select avg(`inventario`.`costo_promedio`) from `inventario` where `inventario`.`id_producto` = `p`.`id_producto` and `inventario`.`costo_promedio` > 0),0) AS `utilidad_unitaria`, CASE WHEN `p`.`precio_venta` > 0 THEN (`p`.`precio_venta` - coalesce((select avg(`inventario`.`costo_promedio`) from `inventario` where `inventario`.`id_producto` = `p`.`id_producto` and `inventario`.`costo_promedio` > 0),0)) / `p`.`precio_venta` * 100 ELSE 0 END AS `margen_ganancia`, coalesce((select sum(`inventario`.`cantidad`) from `inventario` where `inventario`.`id_producto` = `p`.`id_producto`),0) AS `stock_total`, coalesce((select sum(`detalleventa`.`cantidad`) from `detalleventa` where `detalleventa`.`id_producto` = `p`.`id_producto`),0) AS `unidades_vendidas`, coalesce((select sum(`detalleventa`.`cantidad` * `detalleventa`.`precio_unitario`) from `detalleventa` where `detalleventa`.`id_producto` = `p`.`id_producto`),0) AS `total_ventas`, coalesce((select sum(`dv2`.`cantidad` * `dv2`.`precio_unitario`) - sum(`dv2`.`cantidad` * coalesce((select avg(`inventario`.`costo_promedio`) from `inventario` where `inventario`.`id_producto` = `p`.`id_producto` and `inventario`.`costo_promedio` > 0),0)) from `detalleventa` `dv2` where `dv2`.`id_producto` = `p`.`id_producto`),0) AS `utilidad_total` FROM (`productos` `p` left join `categorias` `c` on(`p`.`id_categoria` = `c`.`id_categoria`)) ;

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
  ADD KEY `id_producto` (`id_producto`);

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
  ADD KEY `id_categoria` (`id_categoria`),
  ADD KEY `id_proveedor` (`id_proveedor`);

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
  ADD KEY `id_cliente` (`id_cliente`);

--
-- AUTO_INCREMENT de las tablas volcadas
--

--
-- AUTO_INCREMENT de la tabla `categorias`
--
ALTER TABLE `categorias`
  MODIFY `id_categoria` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=39;

--
-- AUTO_INCREMENT de la tabla `clientes`
--
ALTER TABLE `clientes`
  MODIFY `id_cliente` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=8;

--
-- AUTO_INCREMENT de la tabla `compras`
--
ALTER TABLE `compras`
  MODIFY `id_compra` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=20;

--
-- AUTO_INCREMENT de la tabla `conciliacion_bancaria`
--
ALTER TABLE `conciliacion_bancaria`
  MODIFY `id_conciliacion` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de la tabla `configuracion`
--
ALTER TABLE `configuracion`
  MODIFY `id_config` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=9;

--
-- AUTO_INCREMENT de la tabla `cuentas_por_pagar`
--
ALTER TABLE `cuentas_por_pagar`
  MODIFY `id_cuenta` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT de la tabla `detallecompra`
--
ALTER TABLE `detallecompra`
  MODIFY `id_detalle` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=21;

--
-- AUTO_INCREMENT de la tabla `detalleventa`
--
ALTER TABLE `detalleventa`
  MODIFY `id_detalle` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=26;

--
-- AUTO_INCREMENT de la tabla `devoluciones`
--
ALTER TABLE `devoluciones`
  MODIFY `id_devolucion` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- AUTO_INCREMENT de la tabla `inventario`
--
ALTER TABLE `inventario`
  MODIFY `id_inventario` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=93;

--
-- AUTO_INCREMENT de la tabla `movimientoscaja`
--
ALTER TABLE `movimientoscaja`
  MODIFY `id_movimiento` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de la tabla `movimientos_bancarios`
--
ALTER TABLE `movimientos_bancarios`
  MODIFY `id_movimiento_bancario` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de la tabla `pagos_proveedores`
--
ALTER TABLE `pagos_proveedores`
  MODIFY `id_pago` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT de la tabla `productos`
--
ALTER TABLE `productos`
  MODIFY `id_producto` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=41;

--
-- AUTO_INCREMENT de la tabla `promociones`
--
ALTER TABLE `promociones`
  MODIFY `id_promocion` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=19;

--
-- AUTO_INCREMENT de la tabla `proveedores`
--
ALTER TABLE `proveedores`
  MODIFY `id_proveedor` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=10;

--
-- AUTO_INCREMENT de la tabla `roles`
--
ALTER TABLE `roles`
  MODIFY `id_rol` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- AUTO_INCREMENT de la tabla `tallas`
--
ALTER TABLE `tallas`
  MODIFY `id_talla` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=14;

--
-- AUTO_INCREMENT de la tabla `usuarios`
--
ALTER TABLE `usuarios`
  MODIFY `id_usuario` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- AUTO_INCREMENT de la tabla `ventas`
--
ALTER TABLE `ventas`
  MODIFY `id_venta` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=54;

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
-- Filtros para la tabla `promociones`
--
ALTER TABLE `promociones`
  ADD CONSTRAINT `promociones_ibfk_1` FOREIGN KEY (`id_categoria`) REFERENCES `categorias` (`id_categoria`) ON DELETE SET NULL,
  ADD CONSTRAINT `promociones_ibfk_2` FOREIGN KEY (`id_producto`) REFERENCES `productos` (`id_producto`) ON DELETE SET NULL;

--
-- Filtros para la tabla `usuarios`
--
ALTER TABLE `usuarios`
  ADD CONSTRAINT `usuarios_ibfk_1` FOREIGN KEY (`id_rol`) REFERENCES `roles` (`id_rol`);

--
-- Filtros para la tabla `ventas`
--
ALTER TABLE `ventas`
  ADD CONSTRAINT `ventas_ibfk_1` FOREIGN KEY (`id_usuario`) REFERENCES `usuarios` (`id_usuario`),
  ADD CONSTRAINT `ventas_ibfk_2` FOREIGN KEY (`id_cliente`) REFERENCES `clientes` (`id_cliente`);
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
