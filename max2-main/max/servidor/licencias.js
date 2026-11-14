// servidor/licencias.js — license plans, POS terminals, active sessions
const crypto = require('crypto');
const {
  evaluarClaveParaNuevaCaja,
  aplicarUpgradePlan,
  ensureLicenseBaseline,
  getPlan
} = require('./planes');

const SESSION_TIMEOUT_MS = 90 * 1000; // 90s sin heartbeat → liberar cupo (antes 15 min = falsos "activos")
const SESSION_ACTIVE_MS = 75 * 1000; // solo mostrar como activa si hubo señal reciente

async function columnExists(pool, table, column) {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function tableExists(pool, table) {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [table]
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function purgeStaleSessions(pool) {
  if (!(await tableExists(pool, 'sesiones_activas'))) return 0;
  const cutoff = new Date(Date.now() - SESSION_TIMEOUT_MS);
  const [r] = await pool.query(
    'DELETE FROM sesiones_activas WHERE ultima_actividad < ? AND rol_sesion = ?',
    [cutoff, 'POS_CLIENT']
  );
  return r.affectedRows || 0;
}

async function listActivePosSessions(pool) {
  if (!(await tableExists(pool, 'sesiones_activas'))) return [];
  await purgeStaleSessions(pool);
  const cutoff = new Date(Date.now() - SESSION_ACTIVE_MS);
  const hasVentaCaja = await columnExists(pool, 'ventas', 'id_caja');
  const ventasHoyExpr = hasVentaCaja
    ? `(SELECT IFNULL(SUM(v.total_venta),0) FROM ventas v
        WHERE DATE(v.fecha_hora) = CURDATE()
          AND (
            (s.id_caja IS NOT NULL AND v.id_caja = s.id_caja)
            OR (s.id_usuario IS NOT NULL AND v.id_usuario = s.id_usuario)
          ))`
    : `(SELECT IFNULL(SUM(v.total_venta),0) FROM ventas v
        WHERE DATE(v.fecha_hora) = CURDATE()
          AND s.id_usuario IS NOT NULL AND v.id_usuario = s.id_usuario)`;
  const ventasHoyNExpr = hasVentaCaja
    ? `(SELECT COUNT(*) FROM ventas v
        WHERE DATE(v.fecha_hora) = CURDATE()
          AND (
            (s.id_caja IS NOT NULL AND v.id_caja = s.id_caja)
            OR (s.id_usuario IS NOT NULL AND v.id_usuario = s.id_usuario)
          ))`
    : `(SELECT COUNT(*) FROM ventas v
        WHERE DATE(v.fecha_hora) = CURDATE()
          AND s.id_usuario IS NOT NULL AND v.id_usuario = s.id_usuario)`;
  const [ses] = await pool.query(
    `SELECT s.id_sesion, s.id_caja, s.id_usuario, s.rol_sesion, s.fecha_conexion, s.ultima_actividad,
            c.nombre_caja, u.usuario,
            ${ventasHoyExpr} AS ventas_hoy,
            ${ventasHoyNExpr} AS ventas_hoy_n
     FROM sesiones_activas s
     LEFT JOIN cajas c ON c.id_caja = s.id_caja
     LEFT JOIN usuarios u ON u.id_usuario = s.id_usuario
     WHERE s.rol_sesion = 'POS_CLIENT'
       AND s.ultima_actividad >= ?
     ORDER BY s.ultima_actividad DESC`,
    [cutoff]
  );
  return ses || [];
}

async function getActiveLicense(pool) {
  if (!(await tableExists(pool, 'licencias'))) return null;
  const [rows] = await pool.query(
    'SELECT * FROM licencias WHERE activa = 1 ORDER BY id_licencia DESC LIMIT 1'
  );
  return rows[0] || null;
}

async function countPosSessions(pool) {
  if (!(await tableExists(pool, 'sesiones_activas'))) return 0;
  await purgeStaleSessions(pool);
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS n
     FROM sesiones_activas s
     LEFT JOIN cajas c ON c.id_caja = s.id_caja
     WHERE s.rol_sesion = 'POS_CLIENT'
       AND LOWER(TRIM(COALESCE(c.nombre_caja, ''))) <> 'caja mayor'`
  );
  return Number(rows[0]?.n || 0);
}

function newToken() {
  return crypto.randomBytes(24).toString('hex');
}

/** @deprecated usar getPlanKey / evaluarClaveParaNuevaCaja en planes.js */
const DEFAULT_MASTER_KEY = 'MAX-KEY-BASICO-7701';

async function getClaveAutorizacionCaja(pool) {
  // Compat: devolver clave del plan activo (o Básico)
  try {
    const lic = await getActiveLicense(pool);
    const plan = getPlan(lic && lic.tipo_plan);
    const { getPlanKey } = require('./planes');
    return getPlanKey(plan.codigo);
  } catch (_) {
    return DEFAULT_MASTER_KEY;
  }
}

async function validarClaveAutorizacionCaja(pool, claveIngresada) {
  // Compat legacy: valida contra la clave del plan actual
  const esperada = await getClaveAutorizacionCaja(pool);
  const { keysMatch } = require('./planes');
  return keysMatch(claveIngresada, esperada);
}

/**
 * Register Express routes for licenses / POS terminals / dashboard resumen.
 */
function registerLicenciasRoutes(app, { pool, requiereRol, isCajaMayorRequest, getServerPorts }) {
  const ports = typeof getServerPorts === 'function'
    ? getServerPorts
    : () => ({ primaryPort: Number(process.env.PORT || 3000), cajaMayorPort: null });
  const isMayorRequest = typeof isCajaMayorRequest === 'function'
    ? isCajaMayorRequest
    : () => false;

  // Admin: license + caja status
  app.get('/api/licencias/estado', requiereRol('administrador'), async (_req, res) => {
    try {
      if (!(await tableExists(pool, 'licencias'))) {
        return res.json({
          ok: false,
          error: 'Ejecuta la migración comercial (002) en phpMyAdmin para activar licencias',
          licencia: null,
          cajas: [],
          sesiones: [],
          cupos: { usados: 0, limite: 0 }
        });
      }
      const licencia = await getActiveLicense(pool);
      const [cajas] = await pool.query(
        'SELECT id_caja, nombre_caja, direccion_mac, clave_caja, estado, fecha_registro FROM cajas ORDER BY id_caja'
      );
      const cajasActivas = (cajas || []).filter((c) =>
        String(c.estado || '').toUpperCase() === 'ACTIVA'
        && String(c.nombre_caja || '').trim().toLowerCase() !== 'caja mayor'
      ).length;
      const sesiones = await listActivePosSessions(pool);
      res.json({
        ok: true,
        licencia,
        cajas,
        sesiones,
        cupos: {
          usados: cajasActivas,
          limite: licencia ? Number(licencia.limite_cajas) : 0
        },
        red: (() => {
          try {
            const os = require('os');
            const serverPorts = ports() || {};
            const port = Number(serverPorts.primaryPort || process.env.PORT || 3000);
            const cajaMayorPort = Number(serverPorts.cajaMayorPort) || null;
            const ips = [];
            const nets = os.networkInterfaces();
            for (const name of Object.keys(nets)) {
              for (const net of nets[name] || []) {
                const fam = net.family;
                if ((fam === 'IPv4' || fam === 4) && !net.internal) ips.push(net.address);
              }
            }
            const score = (ip) => {
              if (/^192\.168\.(56|57)\./.test(ip)) return 8;
              if (/^192\.168\./.test(ip)) return 0;
              if (/^10\.2\./.test(ip)) return 7;
              if (/^10\./.test(ip)) return 2;
              return 5;
            };
            const uniq = [...new Set(ips)].sort((a, b) => score(a) - score(b));
            let celular = { status: 'off', url: null, movil_url: null, error: null };
            try {
              celular = require('./tunel-celular').getTunelCelularState();
            } catch (_) {}
            return {
              port,
              ips: uniq,
              caja_url: uniq[0] ? `http://${uniq[0]}:${port}/caja.html` : `http://127.0.0.1:${port}/caja.html`,
              caja_mayor_port: cajaMayorPort,
              caja_mayor_port_configurado: Number(serverPorts.cajaMayorRequestedPort) || 3011,
              caja_mayor_url: cajaMayorPort
                ? (uniq[0]
                  ? `http://${uniq[0]}:${cajaMayorPort}/caja.html?modo=mayor`
                  : `http://127.0.0.1:${cajaMayorPort}/caja.html?modo=mayor`)
                : '',
              server_url: uniq[0] ? `http://${uniq[0]}:${port}` : `http://127.0.0.1:${port}`,
              celular_url: celular.movil_url || celular.url || '',
              celular_status: celular.status || 'off',
              celular_permanente: !!celular.permanente,
              celular_error: celular.error || null
            };
          } catch (_) {
            return {
              port: 3000,
              ips: [],
              caja_url: '',
              caja_mayor_port: null,
              caja_mayor_port_configurado: 3011,
              caja_mayor_url: '',
              server_url: '',
              celular_url: '',
              celular_status: 'off',
              celular_permanente: false,
              celular_error: null
            };
          }
        })()
      });
    } catch (e) {
      console.error('licencias/estado:', e.message || e);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/licencias/ventas/:id/factura', requiereRol('administrador'), async (req, res) => {
    try {
      const idVenta = Number(req.params.id);
      if (!Number.isSafeInteger(idVenta) || idVenta <= 0) {
        return res.status(400).json({ ok: false, error: 'Número de factura inválido' });
      }

      const hasDireccion = await columnExists(pool, 'clientes', 'direccion');
      const hasEmail = await columnExists(pool, 'clientes', 'email');
      const hasSubtotal = await columnExists(pool, 'ventas', 'monto_subtotal');
      const hasIva = await columnExists(pool, 'ventas', 'monto_iva');
      const hasIvaPct = await columnExists(pool, 'ventas', 'iva_porcentaje');
      const hasTasa = await columnExists(pool, 'ventas', 'tasa_dolar');
      const [ventaRows] = await pool.query(
        `SELECT v.id_venta, v.fecha_hora, v.total_venta, v.tipo_pago,
                ${hasSubtotal ? 'v.monto_subtotal' : 'NULL'} AS monto_subtotal,
                ${hasIva ? 'v.monto_iva' : '0'} AS monto_iva,
                ${hasIvaPct ? 'v.iva_porcentaje' : '0'} AS iva_porcentaje,
                ${hasTasa ? 'v.tasa_dolar' : 'NULL'} AS tasa_dolar,
                c.nombre AS cliente_nombre, c.cedula AS cliente_cedula,
                c.telefono AS cliente_telefono,
                ${hasDireccion ? 'c.direccion' : 'NULL'} AS cliente_direccion,
                ${hasEmail ? 'c.email' : 'NULL'} AS cliente_email
         FROM ventas v
         LEFT JOIN clientes c ON c.id_cliente = v.id_cliente
         WHERE v.id_venta = ? LIMIT 1`,
        [idVenta]
      );
      if (!ventaRows.length) return res.status(404).json({ ok: false, error: 'No se encontró la factura' });
      const ventaRow = ventaRows[0];

      const hasProductSnapshot = await columnExists(pool, 'detalleventa', 'producto_nombre');
      const hasItemDiscount = await columnExists(pool, 'detalleventa', 'descuento_unitario');
      const hasUnit = await columnExists(pool, 'productos', 'unidad_medida');
      const productName = hasProductSnapshot
        ? `COALESCE(NULLIF(dv.producto_nombre, ''), p.nombre)`
        : 'p.nombre';
      const itemDiscount = hasItemDiscount ? 'COALESCE(dv.descuento_unitario, 0)' : '0';
      const [items] = await pool.query(
        `SELECT dv.id_producto, dv.id_talla, dv.cantidad, dv.precio_unitario,
                ${itemDiscount} AS descuento,
                COALESCE(${productName}, 'Producto') AS nombre,
                ${hasUnit ? "COALESCE(p.unidad_medida, 'UNIDAD')" : "'UNIDAD'"} AS unidad_medida,
                t.nombre AS nombre_talla
         FROM detalleventa dv
         LEFT JOIN productos p ON p.id_producto = dv.id_producto
         LEFT JOIN tallas t ON t.id_talla = dv.id_talla
         WHERE dv.id_venta = ?
         ORDER BY dv.id_detalle`,
        [idVenta]
      );

      let pagos = [];
      let tasa = Number(ventaRow.tasa_dolar) || 0;
      if (await tableExists(pool, 'venta_pagos')) {
        const [pagoRows] = await pool.query(
          `SELECT forma_pago, monto_usd, monto_bs, tasa
           FROM venta_pagos WHERE id_venta = ? ORDER BY id_pago`,
          [idVenta]
        );
        pagos = pagoRows.map(p => {
          if (!(tasa > 0)) tasa = Number(p.tasa) || 0;
          const esUsd = /d[oó]lares|usd|\$/i.test(String(p.forma_pago || ''));
          return {
            forma_pago: p.forma_pago,
            monto_usd: Number(p.monto_usd) || 0,
            monto_bs: Number(p.monto_bs) || 0,
            moneda: esUsd ? 'usd' : 'bs'
          };
        });
      }
      if (!pagos.length) {
        const total = Number(ventaRow.total_venta) || 0;
        pagos = [{
          forma_pago: ventaRow.tipo_pago || 'Efectivo',
          monto_usd: total,
          monto_bs: Math.round(tasa > 0 ? total * tasa : total),
          moneda: /d[oó]lares|usd|\$/i.test(String(ventaRow.tipo_pago || '')) ? 'usd' : 'bs'
        }];
      }

      const totalUsd = Number(ventaRow.total_venta) || 0;
      const subtotalUsd = ventaRow.monto_subtotal != null ? Number(ventaRow.monto_subtotal) : NaN;
      const montoIvaUsd = Number(ventaRow.monto_iva) || 0;
      const baseNetaUsd = Math.max(0, totalUsd - montoIvaUsd);
      const totalBsPagado = pagos.reduce((sum, pago) => sum + Number(pago.monto_bs || 0), 0);
      const roundBs = value => Math.round(Number(value) || 0);
      const factura = {
        id_venta: ventaRow.id_venta,
        fecha: new Date(ventaRow.fecha_hora).toLocaleString('es-VE'),
        cliente_nombre: ventaRow.cliente_nombre,
        cliente_cedula: ventaRow.cliente_cedula,
        cliente_telefono: ventaRow.cliente_telefono,
        cliente_direccion: ventaRow.cliente_direccion,
        cliente_email: ventaRow.cliente_email,
        tipo_pago: ventaRow.tipo_pago,
        tasa,
        pagos,
        items: items.map(item => ({
          ...item,
          cantidad: Number(item.cantidad) || 0,
          precio_unitario: Number(item.precio_unitario) || 0,
          descuento: Number(item.descuento) || 0,
          nombre: item.nombre
        })),
        total_usd: totalUsd,
        total_bs: totalBsPagado || roundBs(tasa > 0 ? totalUsd * tasa : totalUsd),
        subtotal_usd: Number.isFinite(subtotalUsd) ? subtotalUsd : baseNetaUsd,
        subtotal_bs: roundBs(tasa > 0 ? (Number.isFinite(subtotalUsd) ? subtotalUsd : baseNetaUsd) * tasa : 0),
        base_neta_usd: baseNetaUsd,
        base_neta_bs: roundBs(tasa > 0 ? baseNetaUsd * tasa : 0),
        monto_iva_usd: montoIvaUsd,
        monto_iva_bs: roundBs(tasa > 0 ? montoIvaUsd * tasa : 0),
        iva_porcentaje: Number(ventaRow.iva_porcentaje) || 0,
        iva_activo: montoIvaUsd > 0,
        cambio_usd: 0,
        cambio_bs: 0,
        es_copia: true
      };
      return res.json({ ok: true, factura });
    } catch (e) {
      console.error('licencias/ventas/factura:', e.message || e);
      return res.status(500).json({ ok: false, error: 'No se pudo cargar la factura para reimprimir' });
    }
  });

  // Admin: historial de actividad por caja (ventas + devoluciones)
  // Solo aplica a cajas registradas (el cupo del plan ya limita cuántas existen).
  app.get('/api/licencias/cajas/:id/historial', requiereRol('administrador'), async (req, res) => {
    try {
      const idCaja = Number(req.params.id);
      if (!Number.isFinite(idCaja) || idCaja <= 0) {
        return res.status(400).json({ ok: false, error: 'id de caja inválido' });
      }
      if (!(await tableExists(pool, 'cajas'))) {
        return res.status(503).json({ ok: false, error: 'Módulo de cajas no instalado' });
      }
      if (!(await columnExists(pool, 'ventas', 'id_caja'))) {
        return res.status(503).json({
          ok: false,
          error: 'Las ventas no tienen id_caja. Ejecuta la migración comercial en la base de datos.'
        });
      }

      const [cajaRows] = await pool.query(
        'SELECT id_caja, nombre_caja, clave_caja, estado, fecha_registro FROM cajas WHERE id_caja = ? LIMIT 1',
        [idCaja]
      );
      if (!cajaRows || !cajaRows.length) {
        return res.status(404).json({ ok: false, error: 'Caja no encontrada' });
      }
      const caja = cajaRows[0];

      const dias = Math.min(365, Math.max(1, Number(req.query.dias) || 30));
      const limite = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
      const desde = req.query.desde ? String(req.query.desde).slice(0, 10) : null;
      const hasta = req.query.hasta ? String(req.query.hasta).slice(0, 10) : null;

      const where = ['v.id_caja = ?'];
      const params = [idCaja];
      if (desde && hasta) {
        where.push('DATE(v.fecha_hora) >= ?');
        where.push('DATE(v.fecha_hora) <= ?');
        params.push(desde, hasta);
      } else {
        where.push('v.fecha_hora >= DATE_SUB(NOW(), INTERVAL ? DAY)');
        params.push(dias);
      }

      const hasDev = await tableExists(pool, 'devoluciones');
      const joinDev = hasDev
        ? `LEFT JOIN (
             SELECT dv.id_venta,
                    COUNT(d.id_devolucion) AS devoluciones_count,
                    IFNULL(SUM(d.monto_reembolsado), 0) AS monto_reembolsado,
                    MAX(d.fecha_hora) AS ultima_devolucion
             FROM devoluciones d
             INNER JOIN detalleventa dv ON dv.id_detalle = d.id_detalle
             GROUP BY dv.id_venta
           ) dev ON dev.id_venta = v.id_venta`
        : '';
      const selectDev = hasDev
        ? `IFNULL(dev.devoluciones_count, 0) AS devoluciones_count,
           IFNULL(dev.monto_reembolsado, 0) AS monto_reembolsado,
           dev.ultima_devolucion`
        : `0 AS devoluciones_count, 0 AS monto_reembolsado, NULL AS ultima_devolucion`;

      params.push(limite);
      const [ventas] = await pool.query(
        `SELECT v.id_venta, v.fecha_hora, v.total_venta, v.tipo_pago,
                c.nombre AS cliente_nombre, c.cedula AS cliente_cedula, c.telefono AS cliente_telefono,
                u.usuario AS cajero,
                ${selectDev}
         FROM ventas v
         LEFT JOIN clientes c ON c.id_cliente = v.id_cliente
         LEFT JOIN usuarios u ON u.id_usuario = v.id_usuario
         ${joinDev}
         WHERE ${where.join(' AND ')}
         ORDER BY v.fecha_hora DESC
         LIMIT ?`,
        params
      );

      let devoluciones = [];
      if (hasDev) {
        const whereDev = ['v.id_caja = ?'];
        const paramsDev = [idCaja];
        if (desde && hasta) {
          whereDev.push('DATE(d.fecha_hora) >= ?');
          whereDev.push('DATE(d.fecha_hora) <= ?');
          paramsDev.push(desde, hasta);
        } else {
          whereDev.push('d.fecha_hora >= DATE_SUB(NOW(), INTERVAL ? DAY)');
          paramsDev.push(dias);
        }
        paramsDev.push(limite);
        const [devRows] = await pool.query(
          `SELECT d.id_devolucion, d.fecha_hora, d.cantidad, d.monto_reembolsado,
                  v.id_venta, c.nombre AS cliente_nombre, c.cedula AS cliente_cedula,
                  COALESCE(NULLIF(TRIM(CONCAT(IFNULL(p.marca,''),' ',IFNULL(p.nombre,''))), ''), 'Producto') AS producto
           FROM devoluciones d
           INNER JOIN detalleventa dv ON dv.id_detalle = d.id_detalle
           INNER JOIN ventas v ON v.id_venta = dv.id_venta
           LEFT JOIN clientes c ON c.id_cliente = v.id_cliente
           LEFT JOIN productos p ON p.id_producto = dv.id_producto
           WHERE ${whereDev.join(' AND ')}
           ORDER BY d.fecha_hora DESC
           LIMIT ?`,
          paramsDev
        );
        devoluciones = devRows || [];
      }

      const totalVentas = (ventas || []).length;
      const montoVentas = (ventas || []).reduce((s, v) => s + Number(v.total_venta || 0), 0);
      const totalDevs = (devoluciones || []).length;
      const montoDevs = (devoluciones || []).reduce((s, d) => s + Number(d.monto_reembolsado || 0), 0);
      const ventasConDev = (ventas || []).filter((v) => Number(v.devoluciones_count || 0) > 0).length;
      let cierre = null;
      if (req.query.cierre === '1' && desde && hasta && desde === hasta) {
        const [ventaTotals] = await pool.query(
          `SELECT COUNT(*) AS ventas, IFNULL(SUM(v.total_venta), 0) AS monto_ventas
           FROM ventas v
           WHERE v.id_caja = ? AND DATE(v.fecha_hora) = ?`,
          [idCaja, desde]
        );
        let pagos = [];
        const tasaLegacy = await columnExists(pool, 'ventas', 'tasa_dolar')
          ? 'COALESCE(v.tasa_dolar, 0)'
          : '0';
        const pagoLegacyUsd = `(LOWER(COALESCE(v.tipo_pago, '')) LIKE '%$%'
          OR LOWER(COALESCE(v.tipo_pago, '')) LIKE '%usd%'
          OR LOWER(COALESCE(v.tipo_pago, '')) LIKE '%dolar%'
          OR LOWER(COALESCE(v.tipo_pago, '')) LIKE '%dólar%')`;
        const consultarPagosLegacy = async (filtro) => {
          const [rows] = await pool.query(
            `SELECT COALESCE(NULLIF(TRIM(v.tipo_pago), ''), 'Sin forma de pago') AS tipo_pago,
                    COUNT(*) AS ventas,
                    IFNULL(SUM(CASE WHEN ${pagoLegacyUsd} THEN v.total_venta ELSE 0 END), 0) AS monto_usd,
                    IFNULL(SUM(CASE WHEN ${pagoLegacyUsd} THEN 0 ELSE v.total_venta * ${tasaLegacy} END), 0) AS monto_bs
             FROM ventas v
             WHERE v.id_caja = ? AND DATE(v.fecha_hora) = ? ${filtro}
             GROUP BY COALESCE(NULLIF(TRIM(v.tipo_pago), ''), 'Sin forma de pago')
             ORDER BY tipo_pago`,
            [idCaja, desde]
          );
          return rows || [];
        };
        if (await tableExists(pool, 'venta_pagos')) {
          const [pagoRows] = await pool.query(
            `SELECT vp.forma_pago AS tipo_pago,
                    COUNT(DISTINCT v.id_venta) AS ventas,
                    IFNULL(SUM(vp.monto_usd), 0) AS monto_usd,
                    IFNULL(SUM(vp.monto_bs), 0) AS monto_bs
             FROM ventas v
             INNER JOIN venta_pagos vp ON vp.id_venta = v.id_venta
             WHERE v.id_caja = ? AND DATE(v.fecha_hora) = ?
             GROUP BY vp.forma_pago
             ORDER BY vp.forma_pago`,
            [idCaja, desde]
          );
          pagos = pagoRows || [];
          pagos = pagos.concat(await consultarPagosLegacy(
            'AND NOT EXISTS (SELECT 1 FROM venta_pagos vp WHERE vp.id_venta = v.id_venta)'
          ));
        } else {
          pagos = await consultarPagosLegacy('');
        }
        let cierreDevoluciones = { devoluciones: 0, monto_devoluciones: 0 };
        if (hasDev) {
          const [devTotals] = await pool.query(
            `SELECT COUNT(DISTINCT d.id_devolucion) AS devoluciones,
                    IFNULL(SUM(d.monto_reembolsado), 0) AS monto_devoluciones
             FROM devoluciones d
             INNER JOIN detalleventa dv ON dv.id_detalle = d.id_detalle
             INNER JOIN ventas v ON v.id_venta = dv.id_venta
             WHERE v.id_caja = ? AND DATE(d.fecha_hora) = ?`,
            [idCaja, desde]
          );
          cierreDevoluciones = devTotals[0] || cierreDevoluciones;
        }
        cierre = {
          fecha: desde,
          pagos,
          ventas: Number(ventaTotals[0].ventas || 0),
          monto_ventas: Number(ventaTotals[0].monto_ventas || 0),
          devoluciones: Number(cierreDevoluciones.devoluciones || 0),
          monto_devoluciones: Number(cierreDevoluciones.monto_devoluciones || 0)
        };
      }

      res.json({
        ok: true,
        caja,
        filtro: { dias, desde, hasta, limit: limite },
        resumen: {
          ventas: totalVentas,
          monto_ventas: montoVentas,
          devoluciones: totalDevs,
          monto_devoluciones: montoDevs,
          ventas_con_devolucion: ventasConDev
        },
        ventas: ventas || [],
        devoluciones,
        ...(cierre ? { cierre } : {})
      });
    } catch (e) {
      console.error('licencias/cajas/historial:', e.message || e);
      res.status(500).json({ ok: false, error: e.message || 'Error al cargar historial' });
    }
  });

  async function registrarCaja(req, res, nombreFijo) {
    try {
      const { nombre_caja, clave_caja, direccion_mac, clave_autorizacion } = req.body || {};
      const nombre = String(nombreFijo || nombre_caja || '').trim();
      const clave = String(clave_caja || '').trim();
      if (!nombre || !clave) {
        return res.status(400).json({ ok: false, error: 'nombre_caja y clave_caja son requeridos' });
      }
      if (!nombreFijo && nombre.toLowerCase() === 'caja mayor') {
        return res.status(400).json({
          ok: false,
          error: 'Registra la terminal Caja Mayor usando el formulario dedicado.'
        });
      }
      if (!clave_autorizacion || !String(clave_autorizacion).trim()) {
        return res.status(403).json({
          ok: false,
          error: 'Se requiere la clave de autorización del proveedor MAX para registrar una caja nueva'
        });
      }

      await ensureLicenseBaseline(pool);
      if (nombreFijo) {
        const [mayorRows] = await pool.query(
          "SELECT id_caja FROM cajas WHERE LOWER(TRIM(nombre_caja)) = 'caja mayor' LIMIT 1"
        );
        if (mayorRows.length) {
          return res.status(409).json({ ok: false, error: 'Ya existe una terminal Caja Mayor registrada.' });
        }
      }

      let licencia = await getActiveLicense(pool);
      if (!licencia) {
        return res.status(500).json({ ok: false, error: 'No hay licencia activa en la base de datos' });
      }

      // Alinear limite_cajas con el catálogo del plan (por si la fila quedó desfasada)
      const planCat = getPlan(licencia.tipo_plan);
      if (Number(licencia.limite_cajas) !== Number(planCat.limite_cajas)) {
        await aplicarUpgradePlan(pool, planCat);
        licencia = await getActiveLicense(pool);
      }

      const [cntRows] = await pool.query(
        `SELECT COUNT(*) AS n FROM cajas
         WHERE estado = 'ACTIVA'
           AND LOWER(TRIM(nombre_caja)) <> 'caja mayor'`
      );
      const registradas = Number(cntRows[0]?.n || 0);

      // Caja Mayor is a dedicated terminal and does not consume a plan POS slot.
      const evalKey = evaluarClaveParaNuevaCaja(
        licencia,
        nombreFijo ? 0 : registradas,
        clave_autorizacion
      );
      if (!evalKey.ok) {
        return res.status(403).json({ ok: false, error: evalKey.error });
      }

      if (evalKey.upgrade) {
        await aplicarUpgradePlan(pool, evalKey.plan);
        licencia = await getActiveLicense(pool);
      }

      const [r] = await pool.query(
        'INSERT INTO cajas (nombre_caja, direccion_mac, clave_caja, estado) VALUES (?, ?, ?, ?)',
        [nombre, direccion_mac || null, clave, 'ACTIVA']
      );

      const usadasAhora = registradas + (nombreFijo ? 0 : 1);
      const limite = Number((licencia && licencia.limite_cajas) || evalKey.plan.limite_cajas);
      res.json({
        ok: true,
        id_caja: r.insertId,
        upgrade: !!evalKey.upgrade,
        message: evalKey.mensaje || 'Caja registrada',
        plan: (licencia && licencia.tipo_plan) || evalKey.plan.codigo,
        cupos: { usados: usadasAhora, limite }
      });
    } catch (e) {
      if (e && e.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ ok: false, error: 'Esa clave de caja ya existe' });
      }
      res.status(500).json({ ok: false, error: e.message });
    }
  }

  app.post('/api/licencias/cajas', requiereRol('administrador'), (req, res) => registrarCaja(req, res, null));
  app.post('/api/licencias/cajas/mayor', requiereRol('administrador'), (req, res) => {
    const serverPorts = ports() || {};
    if (!(Number(serverPorts.cajaMayorPort) > 0)) {
      return res.status(503).json({
        ok: false,
        error: `El puerto dedicado de Caja Mayor (${Number(serverPorts.cajaMayorRequestedPort) || 3011}) no está disponible.`
      });
    }
    return registrarCaja(req, res, 'Caja Mayor');
  });

  // POS terminal handshake (consumes a license slot)
  app.post('/api/v1/cajas/login', async (req, res) => {
    try {
      if (!(await tableExists(pool, 'cajas'))) {
        return res.status(503).json({ ok: false, error: 'Módulo de cajas no instalado. Ejecuta la migración SQL 002.' });
      }
      const { clave_caja, usuario, password, direccion_mac, token_sesion: tokenCliente } = req.body || {};
      if (!clave_caja) return res.status(400).json({ ok: false, error: 'clave_caja requerida' });

      const [cajaRows] = await pool.query(
        'SELECT * FROM cajas WHERE clave_caja = ? AND estado = ? LIMIT 1',
        [clave_caja, 'ACTIVA']
      );
      if (!cajaRows.length) return res.status(401).json({ ok: false, error: 'Caja no encontrada o inactiva' });
      const caja = cajaRows[0];
      const esTerminalCajaMayor = String(caja.nombre_caja || '').trim().toLowerCase() === 'caja mayor';
      if (isMayorRequest(req) !== esTerminalCajaMayor) {
        return res.status(403).json({
          ok: false,
          error: isMayorRequest(req)
            ? 'Este puerto solo acepta la terminal registrada Caja Mayor.'
            : 'La terminal Caja Mayor debe abrirse desde su acceso dedicado.'
        });
      }

      if (direccion_mac && caja.direccion_mac && String(caja.direccion_mac).toLowerCase() !== String(direccion_mac).toLowerCase()) {
        return res.status(403).json({ ok: false, error: 'MAC no autorizada para esta caja' });
      }

      // Credenciales de usuario (opcionales). Si no vienen, reutilizar sesión o usuario de caja por defecto.
      // Nunca dejar id_usuario en null: la tabla ventas lo exige NOT NULL.
      let user = null;
      if (usuario && password) {
        const { verificarCredenciales } = require('./auth');
        user = await verificarCredenciales(usuario, password, { pool });
        if (!user) return res.status(401).json({ ok: false, error: 'Credenciales de usuario inválidas' });
        if (Number(user.id_rol) !== 2) {
          return res.status(403).json({ ok: false, error: 'Solo usuarios de rol Caja pueden abrir terminal POS' });
        }
      } else if (req.session && req.session.user && req.session.user.id && Number(req.session.user.id_rol) === 2) {
        user = {
          id: Number(req.session.user.id),
          usuario: req.session.user.usuario,
          id_rol: 2
        };
      } else {
        const [cajaUsers] = await pool.query(
          'SELECT id_usuario, usuario, id_rol FROM usuarios WHERE id_rol = 2 ORDER BY id_usuario ASC LIMIT 1'
        );
        if (cajaUsers.length) {
          user = { id: cajaUsers[0].id_usuario, usuario: cajaUsers[0].usuario, id_rol: 2 };
        } else {
          const [anyUser] = await pool.query(
            'SELECT id_usuario, usuario, id_rol FROM usuarios ORDER BY id_usuario ASC LIMIT 1'
          );
          if (anyUser.length) {
            user = { id: anyUser[0].id_usuario, usuario: anyUser[0].usuario, id_rol: Number(anyUser[0].id_rol) || 2 };
          }
        }
      }

      if (!user || !user.id) {
        return res.status(400).json({
          ok: false,
          error: 'No hay usuario de caja en el sistema. Crea un usuario con rol Caja antes de vender.'
        });
      }

      const licencia = await getActiveLicense(pool);
      if (!licencia) return res.status(403).json({ ok: false, error: 'No hay licencia activa' });

      await purgeStaleSessions(pool);

      // Una sola sesión activa por caja: solo reconectar si el cliente trae el mismo token
      const [existing] = await pool.query(
        "SELECT * FROM sesiones_activas WHERE id_caja = ? AND rol_sesion = 'POS_CLIENT' LIMIT 1",
        [caja.id_caja]
      );
      let token_sesion;
      let id_sesion;
      if (existing.length) {
        const mismaTerminal = tokenCliente && String(tokenCliente) === String(existing[0].token_sesion);
        if (!mismaTerminal) {
          return res.status(409).json({
            ok: false,
            error: `La ${caja.nombre_caja || 'caja'} ya está abierta en otra terminal. Ciérrala primero o espera a que se libere.`
          });
        }
        token_sesion = existing[0].token_sesion;
        id_sesion = existing[0].id_sesion;
        await pool.query(
          'UPDATE sesiones_activas SET ultima_actividad = NOW(), id_usuario = COALESCE(?, id_usuario) WHERE id_sesion = ?',
          [user.id, id_sesion]
        );
      } else {
        const usados = await countPosSessions(pool);
        if (usados >= Number(licencia.limite_cajas)) {
          return res.status(403).json({
            ok: false,
            error: `Límite de cajas alcanzado (${licencia.limite_cajas}). Plan: ${licencia.tipo_plan}`
          });
        }
        token_sesion = newToken();
        const [ins] = await pool.query(
          `INSERT INTO sesiones_activas (id_caja, id_usuario, rol_sesion, token_sesion, fecha_conexion, ultima_actividad)
           VALUES (?, ?, 'POS_CLIENT', ?, NOW(), NOW())`,
          [caja.id_caja, user.id, token_sesion]
        );
        id_sesion = ins.insertId;
      }

      req.session.user = {
        id: user.id,
        usuario: user.usuario,
        id_rol: 2,
        id_caja: caja.id_caja
      };
      req.session.id_caja = caja.id_caja;
      req.session.token_sesion = token_sesion;

      const usadosNow = await countPosSessions(pool);
      res.json({
        ok: true,
        id_caja: caja.id_caja,
        nombre_caja: caja.nombre_caja,
        id_sesion,
        token_sesion,
        usuario: user,
        cupos: { usados: usadosNow, limite: Number(licencia.limite_cajas) },
        plan: licencia.tipo_plan
      });
    } catch (e) {
      console.error('v1/cajas/login:', e.message || e);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/v1/cajas/heartbeat', async (req, res) => {
    try {
      const token = (req.body && req.body.token_sesion) || (req.session && req.session.token_sesion);
      if (!token) return res.status(400).json({ ok: false, error: 'token_sesion requerido' });
      const [r] = await pool.query(
        'UPDATE sesiones_activas SET ultima_actividad = NOW() WHERE token_sesion = ?',
        [token]
      );
      if (!r.affectedRows) return res.status(404).json({ ok: false, error: 'Sesión no encontrada' });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/v1/cajas/logout', async (req, res) => {
    try {
      const token = (req.body && req.body.token_sesion) || (req.session && req.session.token_sesion);
      if (token) {
        await pool.query('DELETE FROM sesiones_activas WHERE token_sesion = ?', [token]);
      }
      if (req.session) {
        req.session.id_caja = null;
        req.session.token_sesion = null;
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Executive dashboard summary
  app.get('/api/v1/dashboard/resumen', requiereRol('administrador'), async (_req, res) => {
    try {
      const [ventasHoy] = await pool.query(
        'SELECT IFNULL(SUM(total_venta),0) AS total, COUNT(*) AS n FROM ventas WHERE DATE(fecha_hora) = CURDATE()'
      );
      const [egresosHoy] = await pool.query(
        `SELECT IFNULL(SUM(monto),0) AS total FROM pagos_proveedores WHERE DATE(fecha_pago) = CURDATE()`
      ).catch(() => [[{ total: 0 }]]);

      // Sales curve last 7 days
      const [curva] = await pool.query(
        `SELECT DATE(fecha_hora) AS dia, IFNULL(SUM(total_venta),0) AS total
         FROM ventas WHERE fecha_hora >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
         GROUP BY DATE(fecha_hora) ORDER BY dia ASC`
      );

      // Low stock alerts
      let stockAlertas = [];
      const hasStockMin = await columnExists(pool, 'productos', 'stock_minimo');
      if (hasStockMin) {
        const [low] = await pool.query(
          `SELECT id_producto, nombre, marca, inventario, stock_minimo, ruta_imagen
           FROM productos
           WHERE stock_minimo > 0 AND inventario <= stock_minimo
             AND NOT (nombre = 'Producto eliminado' AND marca = '-')
           ORDER BY inventario ASC LIMIT 50`
        );
        stockAlertas = low;
      } else {
        const [low] = await pool.query(
          `SELECT id_producto, nombre, marca, inventario, 5 AS stock_minimo
           FROM productos
           WHERE inventario <= 5
             AND NOT (nombre = 'Producto eliminado' AND marca = '-')
           ORDER BY inventario ASC LIMIT 50`
        );
        stockAlertas = low;
      }

      // CxP pending + vencimientos
      const [cxp] = await pool.query(
        `SELECT IFNULL(SUM(monto_pendiente),0) AS pendiente FROM cuentas_por_pagar WHERE estado IN ('PENDIENTE','PARCIAL')`
      );

      let cxpVencimientos = [];
      try {
        const [venc] = await pool.query(
          `SELECT
             cpp.id_cuenta,
             cpp.id_compra,
             cpp.monto_pendiente,
             cpp.fecha_vencimiento,
             cpp.estado,
             pr.nombre AS nombre_proveedor,
             DATEDIFF(cpp.fecha_vencimiento, CURDATE()) AS dias
           FROM cuentas_por_pagar cpp
           LEFT JOIN proveedores pr ON pr.id_proveedor = cpp.id_proveedor
           WHERE cpp.estado IN ('PENDIENTE','PARCIAL')
             AND cpp.monto_pendiente > 0
             AND cpp.fecha_vencimiento IS NOT NULL
             AND DATEDIFF(cpp.fecha_vencimiento, CURDATE()) <= 7
           ORDER BY cpp.fecha_vencimiento ASC
           LIMIT 40`
        );
        cxpVencimientos = venc || [];
      } catch (_) {
        cxpVencimientos = [];
      }

      let cajasEstado = [];
      if (await tableExists(pool, 'sesiones_activas')) {
        cajasEstado = await listActivePosSessions(pool);
      }

      const licencia = await getActiveLicense(pool);
      const usados = await countPosSessions(pool);

      const ingreso = Number(ventasHoy[0]?.total || 0);
      const egreso = Number(egresosHoy[0]?.total || 0);

      res.json({
        ok: true,
        kpis: {
          ventas_hoy: ingreso,
          ventas_hoy_count: Number(ventasHoy[0]?.n || 0),
          egresos_hoy: egreso,
          margen_estimado: ingreso - egreso,
          cxp_pendiente: Number(cxp[0]?.pendiente || 0)
        },
        curva_7d: curva,
        stock_alertas: stockAlertas,
        cxp_vencimientos: cxpVencimientos,
        cajas_activas: cajasEstado,
        licencia: licencia
          ? { tipo_plan: licencia.tipo_plan, limite_cajas: licencia.limite_cajas, usados }
          : null
      });
    } catch (e) {
      console.error('dashboard/resumen:', e.message || e);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Product search with image + active promos
  app.get('/api/v1/productos', requiereRol('cualquiera'), async (req, res) => {
    try {
      const q = (req.query.buscar || req.query.q || '').trim();
      const hasImg = await columnExists(pool, 'productos', 'ruta_imagen');
      const hasBarcode = await columnExists(pool, 'productos', 'codigo_barras');
      const hasStockMin = await columnExists(pool, 'productos', 'stock_minimo');
      const cols = [
        'id_producto', 'nombre', 'marca', 'descripcion', 'precio_venta', 'inventario', 'id_categoria',
        hasImg ? 'ruta_imagen' : 'NULL AS ruta_imagen',
        hasBarcode ? 'codigo_barras' : 'NULL AS codigo_barras',
        hasStockMin ? 'stock_minimo' : '0 AS stock_minimo'
      ].join(', ');
      let sql = `SELECT ${cols} FROM productos WHERE NOT (nombre = 'Producto eliminado' AND marca = '-')`;
      const params = [];
      if (q) {
        sql += ' AND (nombre LIKE ? OR marca LIKE ?';
        params.push(`%${q}%`, `%${q}%`);
        if (hasBarcode) {
          sql += ' OR codigo_barras LIKE ?';
          params.push(`%${q}%`);
        }
        sql += ')';
      }
      sql += ' ORDER BY nombre LIMIT 200';
      const [rows] = await pool.query(sql, params);

      const [promos] = await pool.query(
        `SELECT * FROM promociones WHERE activa = 1 AND CURDATE() >= DATE(fecha_inicio) AND CURDATE() <= DATE(fecha_fin)`
      );
      let ppMap = {};
      if (await tableExists(pool, 'producto_promocion')) {
        const [pp] = await pool.query('SELECT id_producto, id_promocion FROM producto_promocion');
        pp.forEach(r => {
          if (!ppMap[r.id_producto]) ppMap[r.id_producto] = [];
          ppMap[r.id_producto].push(r.id_promocion);
        });
      }

      for (const prod of rows) {
        const [tallas] = await pool.query(
          `SELECT i.id_talla, t.nombre, i.cantidad
           FROM inventario i JOIN tallas t ON i.id_talla = t.id_talla
           WHERE i.id_producto = ?`,
          [prod.id_producto]
        );
        prod.tallas = tallas;
        prod.promociones = promos.filter(p => {
          if (p.id_producto && Number(p.id_producto) === Number(prod.id_producto)) return true;
          if (p.id_categoria && Number(p.id_categoria) === Number(prod.id_categoria)) return true;
          if (ppMap[prod.id_producto] && ppMap[prod.id_producto].includes(p.id_promocion)) return true;
          if (!p.id_producto && !p.id_categoria) return true;
          return false;
        });
      }
      res.json({ ok: true, productos: rows });
    } catch (e) {
      console.error('v1/productos:', e.message || e);
      res.status(500).json({ ok: false, productos: [] });
    }
  });

  // Aliases comerciales (delegación limpia)
  app.post('/api/v1/ventas', requiereRol('caja'), async (req, res) => {
    // Reutiliza el mismo cuerpo que /api/caja/venta
    req.url = '/api/caja/venta';
    req.method = 'POST';
    app._router.handle(req, res, () => {});
  });
}

module.exports = {
  registerLicenciasRoutes,
  columnExists,
  tableExists,
  purgeStaleSessions,
  getActiveLicense,
  countPosSessions,
  SESSION_TIMEOUT_MS
};
