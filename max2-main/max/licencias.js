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
    "SELECT COUNT(*) AS n FROM sesiones_activas WHERE rol_sesion = 'POS_CLIENT'"
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
function registerLicenciasRoutes(app, { pool, requiereRol }) {
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
      const cajasActivas = (cajas || []).filter((c) => String(c.estado || '').toUpperCase() === 'ACTIVA').length;
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
            const port = Number(process.env.PORT || 3000);
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
              server_url: uniq[0] ? `http://${uniq[0]}:${port}` : `http://127.0.0.1:${port}`,
              celular_url: celular.movil_url || celular.url || '',
              celular_status: celular.status || 'off',
              celular_error: celular.error || null
            };
          } catch (_) {
            return {
              port: 3000,
              ips: [],
              caja_url: '',
              server_url: '',
              celular_url: '',
              celular_status: 'off',
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
        devoluciones
      });
    } catch (e) {
      console.error('licencias/cajas/historial:', e.message || e);
      res.status(500).json({ ok: false, error: e.message || 'Error al cargar historial' });
    }
  });

  app.post('/api/licencias/cajas', requiereRol('administrador'), async (req, res) => {
    try {
      const { nombre_caja, clave_caja, direccion_mac, clave_autorizacion } = req.body || {};
      if (!nombre_caja || !clave_caja) {
        return res.status(400).json({ ok: false, error: 'nombre_caja y clave_caja son requeridos' });
      }
      if (!clave_autorizacion || !String(clave_autorizacion).trim()) {
        return res.status(403).json({
          ok: false,
          error: 'Se requiere la clave de autorización del proveedor MAX para registrar una caja nueva'
        });
      }

      await ensureLicenseBaseline(pool);
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
        "SELECT COUNT(*) AS n FROM cajas WHERE estado = 'ACTIVA'"
      );
      const registradas = Number(cntRows[0]?.n || 0);

      const evalKey = evaluarClaveParaNuevaCaja(licencia, registradas, clave_autorizacion);
      if (!evalKey.ok) {
        return res.status(403).json({ ok: false, error: evalKey.error });
      }

      if (evalKey.upgrade) {
        await aplicarUpgradePlan(pool, evalKey.plan);
        licencia = await getActiveLicense(pool);
      }

      const [r] = await pool.query(
        'INSERT INTO cajas (nombre_caja, direccion_mac, clave_caja, estado) VALUES (?, ?, ?, ?)',
        [nombre_caja, direccion_mac || null, clave_caja, 'ACTIVA']
      );

      const usadasAhora = registradas + 1;
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
