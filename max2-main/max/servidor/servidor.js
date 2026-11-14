// servidor/servidor.js

const fs = require('fs');
const path = require('path');
const { resolveApp, resolveData, ensureDir, isPkg } = require('./paths');
const serveLegacyPublicFiles = require('./public-files');

try {
  require('dotenv').config({ path: resolveApp('.env') });
} catch (_) {}

const express = require('express');
let bcrypt;
if (isPkg) {
  // En el .exe usamos solo bcryptjs (sin binarios nativos)
  bcrypt = require('bcryptjs');
} else {
  try {
    bcrypt = require('bcrypt');
  } catch (e) {
    bcrypt = require('bcryptjs');
  }
}
const { pool, verificarConexiónBD, obtenerProductos } = require('./db'); // db.js con MySQL
const { verificarCredenciales } = require('./auth');
const cookieSession = require('cookie-session');
const { upload, uploadDir, publicImagePath, findDuplicateImageProduct, safeUnlink, ensureUploadsReady } = require('./uploads');
const {
  registerLicenciasRoutes,
  columnExists,
  tableExists
} = require('./licencias');
const { startTunelCelular, stopTunelCelular } = require('./tunel-celular');
const { registerAsistenteRoutes } = require('./asistente-consulta');
const { ensureLicenseFromEnv } = require('./planes');

const DEFAULT_SETUP_EDITION = {
  version: null,
  features: {
    accounting: true,
    accountingReports: true,
    promotions: true,
    cajaMayor: true
  }
};

function loadSetupEdition() {
  const file = resolveApp('setup-edition.json');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return DEFAULT_SETUP_EDITION;
    throw new Error(`No se pudo cargar la configuración de edición (${file}): ${error.message}`);
  }

  if (!manifest || typeof manifest !== 'object' || !manifest.features || typeof manifest.features !== 'object') {
    throw new Error(`Configuración de edición inválida en ${file}`);
  }
  const features = Object.assign({}, DEFAULT_SETUP_EDITION.features);
  for (const key of Object.keys(features)) {
    if (typeof manifest.features[key] !== 'boolean') {
      throw new Error(`La opción "${key}" debe ser booleana en ${file}`);
    }
    features[key] = manifest.features[key];
  }
  return {
    version: typeof manifest.version === 'string' ? manifest.version : null,
    features
  };
}

const setupEdition = loadSetupEdition();

// 1. INICIALIZAR APP DE EXPRESS
const app = express();
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const serverPortState = {
  primaryPort: Number(process.env.PORT || 3000),
  cajaMayorPort: null,
  cajaMayorRequestedPort: Number(process.env.CAJA_MAYOR_PORT || 3011)
};

function isCajaMayorRequest(req) {
  return Number(serverPortState.cajaMayorPort) > 0
    && Number(req.socket && req.socket.localPort) === serverPortState.cajaMayorPort;
}

app.get('/setup-edition.js', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.type('application/javascript').send(
    `window.MAX_SETUP_EDITION = Object.freeze(${JSON.stringify(setupEdition)});` +
    'window.maxSetupFeatureEnabled = function (name) {' +
    'return !window.MAX_SETUP_EDITION || !window.MAX_SETUP_EDITION.features ||' +
    'window.MAX_SETUP_EDITION.features[name] !== false;' +
    '};' +
    'document.addEventListener("DOMContentLoaded", function () {' +
    'document.querySelectorAll("[data-setup-feature]").forEach(function (element) {' +
    'if (!window.maxSetupFeatureEnabled(element.dataset.setupFeature)) {' +
    'element.hidden = true;' +
    'element.style.setProperty("display", "none", "important");' +
    '}' +
    '});' +
    '});'
  );
});

app.use((req, res, next) => {
  if (!setupEdition.features.promotions && /^\/api\/(?:v1\/)?promociones(?:\/|$)/.test(req.path)) {
    return res.status(404).json({ ok: false, error: 'Promociones no disponibles en esta edición.' });
  }
  if (!setupEdition.features.cajaMayor && (
    req.path === '/api/licencias/cajas/mayor' ||
    (req.path.toLowerCase().endsWith('/caja.html') && req.query.modo === 'mayor')
  )) {
    return res.status(404).json({ ok: false, error: 'Caja Mayor no está disponible en esta edición.' });
  }
  next();
});

// Detrás de túnel HTTPS (Cloudflare) para cookies / req.secure
app.set('trust proxy', 1);

// --- Stock en vivo (SSE): todas las cajas abiertas reciben cambios al vender ---
const stockStreamClients = new Set();
const tasaStreamClients = new Set();

function broadcastStockUpdate(updates) {
  if (!Array.isArray(updates) || !updates.length) return;
  const payload = `event: stock\ndata: ${JSON.stringify({ updates })}\n\n`;
  for (const res of stockStreamClients) {
    try {
      res.write(payload);
    } catch (_) {
      stockStreamClients.delete(res);
    }
  }
}

async function fetchStockSnapshot(idProducto) {
  const id = Number(idProducto);
  const [pRows] = await pool.query(
    'SELECT inventario FROM productos WHERE id_producto = ? LIMIT 1',
    [id]
  );
  const inventario = pRows.length ? Number(pRows[0].inventario) : 0;
  let tallas = [];
  try {
    const [tRows] = await pool.query(
      `SELECT inventario.id_talla, tallas.nombre, inventario.cantidad
       FROM inventario
       JOIN tallas ON inventario.id_talla = tallas.id_talla
       WHERE inventario.id_producto = ?`,
      [id]
    );
    tallas = tRows.map((t) => ({
      id_talla: t.id_talla,
      nombre: t.nombre,
      cantidad: Number(t.cantidad)
    }));
  } catch (_) {}
  return { id_producto: id, inventario, tallas };
}

/** Notifica a admin + cajas el stock actual de uno o varios productos */
async function broadcastStockForProducts(ids) {
  try {
    const uniq = [...new Set((ids || []).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0))];
    if (!uniq.length) return [];
    const updates = [];
    for (const id of uniq) {
      updates.push(await fetchStockSnapshot(id));
    }
    broadcastStockUpdate(updates);
    return updates;
  } catch (e) {
    console.warn('broadcastStockForProducts:', e.message || e);
    return [];
  }
}

// 2. MIDDLEWARE DE AUTENTICACIÓN (debe ir antes de las rutas que lo usan)
function isMobileUserAgent(ua) {
  const s = String(ua || '').toLowerCase();
  return /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini|mobile/.test(s);
}

function requiereRol(rol) {
  return (req, res, next) => {
    const u = req.session && req.session.user;
    if (!u) return res.status(401).json({ ok: false, error: 'No autenticado' });
    // Supuestos: id_rol 1 = Administrador, 2 = Caja
    const esAdmin = u.id_rol == 1;
    const esCaja = u.id_rol == 2;

    if (rol === 'administrador' && esAdmin) return next();
    if (rol === 'caja' && esCaja) return next();
    if (rol === 'cualquiera' && (esAdmin || esCaja)) return next(); // Para rutas generales
    
    return res.status(403).json({ ok: false, error: 'Acceso no autorizado' });
  };
}

/** Garantiza un id_usuario válido para INSERT en ventas (NOT NULL). */
async function resolveUserIdForVenta(req) {
  const fromSession = req.session && req.session.user && req.session.user.id;
  if (fromSession) return Number(fromSession);

  const token = (req.session && req.session.token_sesion)
    || (req.body && req.body.token_sesion)
    || null;
  if (token) {
    try {
      const [rows] = await pool.query(
        'SELECT id_usuario FROM sesiones_activas WHERE token_sesion = ? LIMIT 1',
        [token]
      );
      if (rows.length && rows[0].id_usuario) return Number(rows[0].id_usuario);
    } catch (_) {}
  }

  try {
    const [cajaUsers] = await pool.query(
      'SELECT id_usuario FROM usuarios WHERE id_rol = 2 ORDER BY id_usuario ASC LIMIT 1'
    );
    if (cajaUsers.length) return Number(cajaUsers[0].id_usuario);
    const [anyUser] = await pool.query(
      'SELECT id_usuario FROM usuarios ORDER BY id_usuario ASC LIMIT 1'
    );
    if (anyUser.length) return Number(anyUser[0].id_usuario);
  } catch (_) {}

  throw new Error('No hay usuario válido para registrar la venta. Abre la caja de nuevo o crea un usuario de rol Caja.');
}

// 3. MIDDLEWARE GENERAL
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const sessionOptions = {
  keys: ['clave-secreta-unica', 'max-sess-key-v2'],
  maxAge: SESSION_DURATION_MS,
  sameSite: 'lax',
  secure: false, // Electron y LAN usan http:// — evita cookies atrapadas por HTTPS del túnel
  httpOnly: true,
  overwrite: true
};
const retailSession = cookieSession(Object.assign({ name: 'max_sess' }, sessionOptions));
const cajaMayorSession = cookieSession(Object.assign({ name: 'max_sess_mayor' }, sessionOptions));
app.use((req, res, next) => {
  const middleware = isCajaMayorRequest(req) ? cajaMayorSession : retailSession;
  middleware(req, res, next);
});

// Renovar la expiración al usar la API para que la sesión dure 12 horas inactiva.
app.use((req, res, next) => {
  if (req.session && req.session.user && req.path.startsWith('/api/')) {
    req.session.lastActivity = Date.now();
  }
  next();
});

// Limpiar cookie antigua "session" si aún existe (reinstalaciones / Electron AppData)
app.use((req, res, next) => {
  if (req.cookies && req.cookies.session) {
    try { res.clearCookie('session', { path: '/' }); } catch (_) {}
  }
  // cookie-parser no está; leer header
  const raw = req.headers.cookie || '';
  if (/(?:^|;\s*)session=/.test(raw)) {
    try { res.clearCookie('session', { path: '/' }); } catch (_) {}
  }
  next();
});

// En móvil: admin solo lectura (dashboard / contabilidad / reportes)
app.use((req, res, next) => {
  if (!req.session || !req.session.mobile_readonly) return next();
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
  const pathName = (req.path || req.url || '').split('?')[0];
  // Permitir logout, login y heartbeat
  if (/^\/api\/(logout|login|status)/.test(pathName)) return next();
  if (/^\/api\/asistente\/consulta$/.test(pathName)) return next();
  if (/^\/api\/v1\/cajas\/(heartbeat|logout)/.test(pathName)) return next();
  return res.status(403).json({
    ok: false,
    error: 'Desde el teléfono solo puedes consultar. Para registrar usa una PC.'
  });
});

// Servir archivos estáticos (front-end) e imágenes subidas (AppData persistente)
ensureUploadsReady();
app.use((req, res, next) => {
  if (isCajaMayorRequest(req) && req.path.toLowerCase().endsWith('/caja.html') && req.query.modo !== 'mayor') {
    return res.redirect(302, `${req.path}?modo=mayor`);
  }
  next();
});
app.use(serveLegacyPublicFiles(resolveApp));
app.use(express.static(resolveApp('public')));
app.use('/uploads/images', express.static(uploadDir));
app.use('/uploads', express.static(resolveData('uploads')));
// Compatibilidad: instalaciones viejas guardaban en public/uploads
app.use('/uploads', express.static(resolveApp('public', 'uploads')));
// Paquetes de actualización de la app de escritorio (latest.yml + MAX-Setup-*.exe)
app.use('/updates', express.static(resolveApp('updates'), {
  setHeaders(res) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
}));

// Módulo comercial: licencias / cajas / dashboard v1
registerLicenciasRoutes(app, {
  pool,
  requiereRol,
  isCajaMayorRequest,
  getServerPorts: () => Object.assign({}, serverPortState)
});
registerAsistenteRoutes(app, { pool, requiereRol });

// QR del túnel celular (admin)
app.get('/api/celular/qr.png', requiereRol('administrador'), async (req, res) => {
  try {
    const { getTunelCelularState } = require('./tunel-celular');
    const st = getTunelCelularState();
    const target = st.movil_url || st.url;
    if (!target) {
      return res.status(404).json({ ok: false, error: 'Túnel aún no listo' });
    }
    const QRCode = require('qrcode');
    const buf = await QRCode.toBuffer(target, {
      type: 'png',
      width: 280,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#0f172a', light: '#ffffff' }
    });
    res.set('Cache-Control', 'no-store');
    res.type('png').send(buf);
  } catch (e) {
    console.error('celular/qr:', e.message || e);
    res.status(500).json({ ok: false, error: e.message || 'Error QR' });
  }
});

// Revisión segura del esquema al iniciar: detecta si existe `id_talla` en `detallecompra` o FKs
// NO realiza cambios destructivos por defecto. Si de verdad quieres que el servidor ejecute
// las operaciones de eliminación automáticamente, exporta la variable de entorno
// FORCE_SCHEMA_MIGRATE=1 antes de arrancar.
// Mostrar mensajes de revisión de esquema solo si se define la variable de entorno
const SHOW_SCHEMA_WARNINGS = process.env.SHOW_SCHEMA_WARNINGS === '1';

(async function revisarEsquemaDetalleCompra() {
  try {
    // 1) Verificar si la columna existe
    const [cols] = await pool.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'detallecompra' AND COLUMN_NAME = 'id_talla'");
    const hasColumn = Array.isArray(cols) && cols.length > 0;

    // 2) Buscar FKs que referencien la tabla 'tallas'
    const [fks] = await pool.query("SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'detallecompra' AND REFERENCED_TABLE_NAME = 'tallas'");
    const fkNames = Array.isArray(fks) ? fks.map(r => r.CONSTRAINT_NAME) : [];

    if (!hasColumn && fkNames.length === 0) {
      if (SHOW_SCHEMA_WARNINGS) console.log('Esquema: no se detectó columna id_talla ni FKs en detallecompra. No se requieren cambios.');
      return;
    }

    if (SHOW_SCHEMA_WARNINGS) console.log('Esquema: detectado', hasColumn ? 'columna id_talla' : '', fkNames.length ? 'FK(s): ' + fkNames.join(',') : '');

    if (process.env.FORCE_SCHEMA_MIGRATE === '1' || process.env.ALLOW_DESTRUCTIVE_MIGRATIONS === '1') {
      // Ejecutar migración destructiva SOLO si el usuario lo autoriza explícitamente
      try {
        // Eliminar cada FK detectada
        for (const fkName of fkNames) {
          try {
            await pool.query(`ALTER TABLE detallecompra DROP FOREIGN KEY \`${fkName}\``);
            console.log(`Esquema: se eliminó la FK ${fkName} en detallecompra`);
          } catch (e) {
            console.warn(`No se pudo eliminar la FK ${fkName}:`, e.message || e);
          }
        }

        // Eliminar columna si existe
        if (hasColumn) {
          try {
            await pool.query('ALTER TABLE detallecompra DROP COLUMN id_talla');
            console.log('Esquema: columna detallecompra.id_talla eliminada.');
          } catch (e) {
            console.warn('No se pudo eliminar detallecompra.id_talla:', e.message || e);
          }
        }
      } catch (e) {
        console.warn('Error durante migración forzada de esquema:', e.message || e);
      }
      } else {
      // No modificar; informar instrucciones para el usuario solo si el admin lo solicita expresamente
      if (SHOW_SCHEMA_WARNINGS) {
        console.log('\nATENCIÓN: se detectó que el esquema tiene campo o FKs relacionadas con tallas en detallecompra.');
        console.log('Por seguridad no se realizan cambios destructivos automáticamente.');
        if (fkNames.length > 0) console.log('FKs detectadas:', fkNames.join(', '));
        if (hasColumn) console.log('Columna detectada: detallecompra.id_talla');
        console.log('\nSi quieres ejecutar la migración automática en este entorno, arranca el servidor con:');
        console.log('  FORCE_SCHEMA_MIGRATE=1 npm run start');
        console.log('O ejecuta manualmente las siguientes sentencias SQL (reemplaza <FK_NAME> por el nombre real):');
        console.log("  ALTER TABLE detallecompra DROP FOREIGN KEY <FK_NAME>;  -- ejecutar por cada FK detectada");
        console.log('  ALTER TABLE detallecompra DROP COLUMN id_talla;');
        console.log('Si no estás seguro, haz un backup de la base de datos antes de realizar cambios.\n');
      }
    }
  } catch (e) {
    console.warn('Advertencia al revisar esquema detallecompra:', e.message || e);
  }
})();

function errorVenta(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function requireSixDecimalStockSchema(conn, includeFugaMovimientos = false) {
  const fugaCondition = includeFugaMovimientos
    ? " OR (TABLE_NAME = 'fuga_movimientos' AND COLUMN_NAME = 'cantidad')"
    : '';
  const [rows] = await conn.query(
    `SELECT TABLE_NAME, COLUMN_NAME, NUMERIC_SCALE
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND ((TABLE_NAME = 'productos' AND COLUMN_NAME = 'inventario')
         OR (TABLE_NAME = 'detalleventa' AND COLUMN_NAME = 'cantidad')
         OR (TABLE_NAME = 'inventario' AND COLUMN_NAME = 'cantidad')${fugaCondition})`
  );
  const scales = new Map(rows.map((row) => [`${row.TABLE_NAME}.${row.COLUMN_NAME}`, Number(row.NUMERIC_SCALE)]));
  const required = ['productos.inventario', 'detalleventa.cantidad', 'inventario.cantidad'];
  if (includeFugaMovimientos) required.push('fuga_movimientos.cantidad');
  if (required.some((column) => (scales.get(column) || 0) < 6)) {
    throw errorVenta(
      'La base de datos aún no admite cantidades menores a 1 g/ml. Ejecuta db/migrations/011_precision_cantidades.sql antes de continuar.',
      503
    );
  }
}

async function lockAndValidateSaleStock(conn, itemsInput) {
  if (!Array.isArray(itemsInput) || itemsInput.length === 0) {
    throw errorVenta('La venta debe incluir al menos un producto.');
  }

  const items = itemsInput.map((item) => ({
    ...item,
    id_producto: Number(item.id_producto),
    id_talla: item.id_talla == null || item.id_talla === '' ? null : Number(item.id_talla),
    cantidad: Number(item.cantidad),
    precio_unitario: Number(item.precio_unitario) || 0,
    no_aplicar_promocion: !!item.no_aplicar_promocion,
    force_promotion_id: item.force_promotion_id ? Number(item.force_promotion_id) : null,
    preferred_id_categoria: item.idCategoria
      ? Number(item.idCategoria)
      : (item.id_categoria ? Number(item.id_categoria) : null)
  }));
  for (const item of items) {
    if (!Number.isSafeInteger(item.id_producto) || item.id_producto <= 0 ||
        !Number.isFinite(item.cantidad) || item.cantidad <= 0) {
      throw errorVenta('Cada detalle requiere un producto y una cantidad válida.');
    }
    if (item.id_talla != null && (!Number.isSafeInteger(item.id_talla) || item.id_talla <= 0)) {
      throw errorVenta('La talla del producto no es válida.');
    }
  }

  const productIds = [...new Set(items.map((item) => item.id_producto))].sort((a, b) => a - b);
  const [productRows] = await conn.query(
    `SELECT id_producto, nombre, marca, inventario, unidad_medida, precio_venta, id_categoria
     FROM productos
     WHERE id_producto IN (${productIds.map(() => '?').join(',')})
     ORDER BY id_producto
     FOR UPDATE`,
    productIds
  );
  const products = new Map(productRows.map((product) => [Number(product.id_producto), product]));
  for (const productId of productIds) {
    if (!products.has(productId)) throw errorVenta(`Producto no encontrado: ${productId}`);
  }

  const [inventoryRows] = await conn.query(
    `SELECT id_producto, id_talla, cantidad
     FROM inventario
     WHERE id_producto IN (${productIds.map(() => '?').join(',')})
     ORDER BY id_producto, id_talla
     FOR UPDATE`,
    productIds
  );
  const inventoryBySize = new Map(
    inventoryRows.map((row) => [`${Number(row.id_producto)}:${Number(row.id_talla)}`, row])
  );
  const productsWithSizes = new Set(inventoryRows.map((row) => Number(row.id_producto)));
  const quantityByProduct = new Map();
  const quantityBySize = new Map();
  let requiresSixDecimals = false;

  for (const item of items) {
    const product = products.get(item.id_producto);
    const unit = String(product.unidad_medida || 'UNIDAD').trim().toUpperCase();
    const isWeightOrVolume = ['KILO', 'KG', 'LITRO', 'L'].includes(unit);
    if (isWeightOrVolume) {
      const preciseQuantity = Number(item.cantidad.toFixed(6));
      if (Math.abs(preciseQuantity - item.cantidad) > 1e-9 || preciseQuantity <= 0) {
        throw errorVenta('La cantidad de peso o volumen debe tener como máximo seis decimales.');
      }
      item.cantidad = preciseQuantity;
      if (Math.abs(item.cantidad * 1000 - Math.round(item.cantidad * 1000)) > 1e-6) {
        requiresSixDecimals = true;
      }
    } else if (!Number.isInteger(item.cantidad)) {
      throw errorVenta(`La cantidad de ${unit.toLowerCase()} debe ser un número entero.`);
    }

    const productLabel = product.marca ? `${product.nombre} (${product.marca})` : product.nombre;
    if (item.id_talla != null) {
      const inventory = inventoryBySize.get(`${item.id_producto}:${item.id_talla}`);
      if (!inventory) {
        throw errorVenta(`No hay inventario para ${productLabel}, talla ${item.id_talla}.`);
      }
      const key = `${item.id_producto}:${item.id_talla}`;
      quantityBySize.set(key, Number(((quantityBySize.get(key) || 0) + item.cantidad).toFixed(6)));
    } else if (productsWithSizes.has(item.id_producto)) {
      throw errorVenta(`Selecciona una talla para ${productLabel}.`);
    }

    quantityByProduct.set(
      item.id_producto,
      Number(((quantityByProduct.get(item.id_producto) || 0) + item.cantidad).toFixed(6))
    );
  }

  if (requiresSixDecimals) await requireSixDecimalStockSchema(conn);

  for (const [productId, requested] of quantityByProduct) {
    const product = products.get(productId);
    const available = Number(product.inventario) || 0;
    if (available + 1e-9 < requested) {
      const productLabel = product.marca ? `${product.nombre} (${product.marca})` : product.nombre;
      throw errorVenta(`Stock insuficiente para ${productLabel}. Disponible: ${available}`, 409);
    }
  }
  for (const [key, requested] of quantityBySize) {
    const inventory = inventoryBySize.get(key);
    const available = Number(inventory.cantidad) || 0;
    if (available + 1e-9 < requested) {
      const [, tallaId] = key.split(':');
      throw errorVenta(`Stock insuficiente para talla ${tallaId}. Disponible: ${available}`, 409);
    }
  }

  return { items, products, quantityByProduct, quantityBySize };
}

async function decrementSaleStock(conn, stock) {
  for (const [key, quantity] of stock.quantityBySize) {
    const [productId, sizeId] = key.split(':').map(Number);
    const [result] = await conn.query(
      'UPDATE inventario SET cantidad = cantidad - ? WHERE id_producto = ? AND id_talla = ? AND cantidad >= ?',
      [quantity, productId, sizeId, quantity]
    );
    if (result.affectedRows !== 1) {
      throw errorVenta(`El stock de la talla ${sizeId} cambió durante la venta. Intenta de nuevo.`, 409);
    }
  }
  for (const [productId, quantity] of stock.quantityByProduct) {
    const [result] = await conn.query(
      'UPDATE productos SET inventario = inventario - ? WHERE id_producto = ? AND inventario >= ?',
      [quantity, productId, quantity]
    );
    if (result.affectedRows !== 1) {
      throw errorVenta(`El stock del producto ${productId} cambió durante la venta. Intenta de nuevo.`, 409);
    }
  }
}

// Helper: procesar venta (reusable por /api/ventas y /api/caja/venta)
async function procesarVenta(itemsInput, clienteData, tipo_pago, userId, options = {}) {
  await ensureIvaSchema(pool);
  await ensureVentaPagosTable(pool);

  const conn = await pool.getConnection();
  let result;
  try {
    await conn.beginTransaction();
    result = await procesarVentaEnTransaccion(conn, itemsInput, clienteData, tipo_pago, userId, options);
    await conn.commit();
  } catch (e) {
    try {
      await conn.rollback();
    } catch (rollbackError) {
      console.error('No se pudo revertir la transacción de venta:', rollbackError.message || rollbackError);
    }
    throw e;
  } finally {
    conn.release();
  }

  const stock_updates = [];
  for (const productId of result.stock_ids) {
    try {
      stock_updates.push(await fetchStockSnapshot(productId));
    } catch (e) {
      console.warn('No se pudo leer stock post-venta:', e.message || e);
    }
  }
  broadcastStockUpdate(stock_updates);
  delete result.stock_ids;
  return { ...result, stock_updates };
}

async function procesarVentaEnTransaccion(conn, itemsInput, clienteData, tipo_pago, userId, options = {}) {
  const id_caja = options.id_caja != null ? Number(options.id_caja) : null;
  const stock = await lockAndValidateSaleStock(conn, itemsInput);
  const { items } = stock;
  const prodMap = Object.fromEntries(stock.products);

  // 2) Buscar o crear / actualizar cliente
  let id_cliente = null;
  if (clienteData && clienteData.cedula) {
    const hasDir = await columnExists(conn, 'clientes', 'direccion');
    const [cliRows] = await conn.query('SELECT id_cliente FROM clientes WHERE cedula = ? LIMIT 1', [clienteData.cedula]);
    if (cliRows.length > 0) {
      id_cliente = cliRows[0].id_cliente;
      // Actualizar datos de contacto si vienen en la venta
      if (hasDir) {
        await conn.query(
          'UPDATE clientes SET nombre = COALESCE(NULLIF(?, \'\'), nombre), telefono = COALESCE(NULLIF(?, \'\'), telefono), email = COALESCE(NULLIF(?, \'\'), email), direccion = COALESCE(NULLIF(?, \'\'), direccion) WHERE id_cliente = ?',
          [clienteData.nombre || '', clienteData.telefono || '', clienteData.email || '', clienteData.direccion || '', id_cliente]
        );
      } else {
        await conn.query(
          'UPDATE clientes SET nombre = COALESCE(NULLIF(?, \'\'), nombre), telefono = COALESCE(NULLIF(?, \'\'), telefono), email = COALESCE(NULLIF(?, \'\'), email) WHERE id_cliente = ?',
          [clienteData.nombre || '', clienteData.telefono || '', clienteData.email || '', id_cliente]
        );
      }
    } else if (hasDir) {
      const [cliRes] = await conn.query(
        'INSERT INTO clientes (nombre, cedula, telefono, direccion, email) VALUES (?, ?, ?, ?, ?)',
        [clienteData.nombre || '', clienteData.cedula || null, clienteData.telefono || '', clienteData.direccion || '', clienteData.email || '']
      );
      id_cliente = cliRes.insertId;
    } else {
      const [cliRes] = await conn.query(
        'INSERT INTO clientes (nombre, cedula, telefono, email) VALUES (?, ?, ?, ?)',
        [clienteData.nombre || '', clienteData.cedula || null, clienteData.telefono || '', clienteData.email || '']
      );
      id_cliente = cliRes.insertId;
    }
  }

  // 3) Obtener promociones activas
  const todayStr = new Date().toISOString().slice(0,10);
  console.log(`[PROCESAR VENTA] Buscando promociones activas para fecha: ${todayStr}`);
  
  // Cargar promociones activas (activa=1 y fecha actual entre fecha_inicio y fecha_fin)
  // Usar CURDATE() para asegurar compatibilidad
  const promos = setupEdition.features.promotions
    ? (await conn.query(
      `SELECT * FROM promociones
       WHERE activa = 1
       AND CURDATE() >= DATE(fecha_inicio)
       AND CURDATE() <= DATE(fecha_fin)`,
      []
    ))[0]
    : [];
  
  console.log(`[PROCESAR VENTA] Encontradas ${promos.length} promociones activas para procesar`);

  // 4) Obtener info de productos
  // Si el cajero envió una categoría preferida para una línea y el producto no tiene categoría,
  // podemos usar esa preferencia como fallback para la evaluación de promociones.
  // Solo aplicamos el fallback si la categoría existe en la tabla `categorias`.
  try {
    const preferredCats = [...new Set(items.map(it => it.preferred_id_categoria).filter(Boolean))];
    if (preferredCats.length > 0) {
      const [existingCats] = await conn.query(`SELECT id_categoria FROM categorias WHERE id_categoria IN (${preferredCats.map(_=>'?').join(',')})`, preferredCats);
      const existingSet = new Set(existingCats.map(c => Number(c.id_categoria)));
      // Aplicar fallback por producto si no tiene id_categoria
      for (const it of items) {
        if (!prodMap[it.id_producto]) continue;
        if ((!prodMap[it.id_producto].id_categoria || prodMap[it.id_producto].id_categoria === null) && it.preferred_id_categoria && existingSet.has(Number(it.preferred_id_categoria))) {
          // Solo modificar en memoria para uso en matching; no alteramos la base de datos aquí.
          prodMap[it.id_producto].id_categoria = Number(it.preferred_id_categoria);
        }
      }
    }
  } catch (e) {
    // No fatal: si falla esta verificación, seguimos con la lógica normal sin fallback.
    console.warn('No se pudo validar categorías preferidas proporcionadas por la caja:', e.message || e);
  }

  // 5) Calcular descuentos
  const descuentosPorItem = [];
  let subtotalCarrito = 0;
  for (const it of items) {
    const precio = it.precio_unitario || (prodMap[it.id_producto] && prodMap[it.id_producto].precio_venta) || 0;
    const subtotal = precio * it.cantidad;
    subtotalCarrito += subtotal;
  }

  for (const it of items) {
    const precio = it.precio_unitario || (prodMap[it.id_producto] && prodMap[it.id_producto].precio_venta) || 0;
    const subtotal = precio * it.cantidad;
    let mejor = { descuento: 0, id_promocion: null };
    
    // IMPORTANTE: Las promociones son INDEPENDIENTES de la talla (id_talla)
    // Una promoción aplica al producto sin importar la talla (XS, S, M, L, XL, XXL, etc.)
    console.log(`[PROCESAR VENTA] Evaluando promociones para producto ${it.id_producto}, talla: ${it.id_talla || 'Sin talla'} - Las promociones NO dependen de la talla`);
    
    // Si el cajero indicó que no aplique promociones para este item, saltar evaluación
    if (it.no_aplicar_promocion) {
      descuentosPorItem.push({ item: it, descuento: 0, id_promocion: null });
      continue;
    }
    // Si el cajero forzó una promoción, intentar aplicarla únicamente
    if (it.force_promotion_id) {
      const forced = promos.find(pp => Number(pp.id_promocion) === Number(it.force_promotion_id));
      if (forced) {
        let descuentoForced = 0;
        // Validaciones similares a las de abajo
        if (forced.id_producto && Number(forced.id_producto) !== Number(it.id_producto)) {
          // no aplicable
        } else if (forced.id_categoria) {
          // Priorizar la categoría enviada por el frontend (si existe), sino usar la del producto
          const catEnviada = it.preferred_id_categoria || it.idCategoria || it.id_categoria;
          const catProducto = prodMap[it.id_producto] && prodMap[it.id_producto].id_categoria;
          const cat = catEnviada || catProducto;
          if (!cat || Number(cat) !== Number(forced.id_categoria)) {
            // no aplicable
          } else {
            // calcular
            if (forced.tipo_promocion === 'DESCUENTO_PORCENTAJE') descuentoForced = (it.precio_unitario || prodMap[it.id_producto].precio_venta || 0) * it.cantidad * (Number(forced.valor||0)/100);
            else if (forced.tipo_promocion === 'DESCUENTO_FIJO') {
              const val = Number(forced.valor||0);
              descuentoForced = forced.id_producto || forced.id_categoria ? (it.cantidad * val) : (subtotalCarrito > 0 ? ( (it.precio_unitario || prodMap[it.id_producto].precio_venta || 0) * it.cantidad / subtotalCarrito) * val : 0);
            } else if (forced.tipo_promocion === 'COMPRA_X_LLEVA_Y') {
              const px = Number(forced.param_x||0); const py = Number(forced.param_y||0);
              if (px>0 && py>=0) { const bloque = px+py; const completos = Math.floor(it.cantidad / bloque); const gratis = completos * py; descuentoForced = gratis * (it.precio_unitario || prodMap[it.id_producto].precio_venta || 0); }
            }
            descuentosPorItem.push({ item: it, descuento: descuentoForced || 0, id_promocion: forced.id_promocion });
            continue;
          }
        } else {
          // promotion without id_categoria/id_producto (global)
          if (forced.tipo_promocion === 'DESCUENTO_PORCENTAJE') descuentoForced = (it.precio_unitario || prodMap[it.id_producto].precio_venta || 0) * it.cantidad * (Number(forced.valor||0)/100);
          else if (forced.tipo_promocion === 'DESCUENTO_FIJO') { const val = Number(forced.valor||0); descuentoForced = subtotalCarrito>0 ? ((it.precio_unitario || prodMap[it.id_producto].precio_venta || 0) * it.cantidad / subtotalCarrito) * val : 0; }
          else if (forced.tipo_promocion === 'COMPRA_X_LLEVA_Y') { const px = Number(forced.param_x||0); const py = Number(forced.param_y||0); if (px>0 && py>=0) { const bloque = px+py; const completos = Math.floor(it.cantidad / bloque); const gratis = completos * py; descuentoForced = gratis * (it.precio_unitario || prodMap[it.id_producto].precio_venta || 0); } }
          descuentosPorItem.push({ item: it, descuento: descuentoForced || 0, id_promocion: forced.id_promocion });
          continue;
        }
      }
      // Si la promoción forzada no es válida, continuamos con evaluación normal
    }
    for (const p of promos) {
      // Verificar producto (si la promoción es específica de producto)
      if (p.id_producto && Number(p.id_producto) !== Number(it.id_producto)) continue;
      
      // Verificar categoría (si la promoción es específica de categoría)
      if (p.id_categoria) {
        // Priorizar la categoría enviada por el frontend (si existe), sino usar la del producto
        const catEnviada = it.preferred_id_categoria || it.idCategoria || it.id_categoria;
        const catProducto = prodMap[it.id_producto] && prodMap[it.id_producto].id_categoria;
        const cat = catEnviada || catProducto;
        if (!cat || Number(cat) !== Number(p.id_categoria)) continue;
      }
      
      // NOTA: NO verificamos id_talla aquí. Las promociones aplican a CUALQUIER talla del producto.
      // Esto significa que una promoción para un producto o categoría aplica a todas las tallas (XS, S, M, L, XL, XXL, etc.)
      const minimo = Number(p.minimo_compra || 0);
      if (minimo > 0) {
        const scopeSubtotal = (p.id_producto || p.id_categoria) ? subtotal : subtotalCarrito;
        if (scopeSubtotal < minimo) continue;
      }
      let descuento = 0;
      if (p.tipo_promocion === 'DESCUENTO_PORCENTAJE') {
        descuento = subtotal * (Number(p.valor || 0) / 100);
      } else if (p.tipo_promocion === 'DESCUENTO_FIJO') {
        const val = Number(p.valor || 0);
        if (p.id_producto || p.id_categoria) descuento = it.cantidad * val;
        else descuento = subtotalCarrito > 0 ? (subtotal / subtotalCarrito) * val : 0;
      } else if (p.tipo_promocion === 'COMPRA_X_LLEVA_Y') {
        const paramX = Number(p.param_x || 0);
        const paramY = Number(p.param_y || 0);
        if (paramX > 0 && paramY >= 0) {
          const bloque = paramX + paramY;
          const completos = Math.floor(it.cantidad / bloque);
          const gratis = completos * paramY;
          descuento = gratis * precio;
        }
      }
      if (descuento > mejor.descuento) mejor = { descuento, id_promocion: p.id_promocion };
    }
    descuentosPorItem.push({ item: it, descuento: mejor.descuento || 0, id_promocion: mejor.id_promocion || null });
  }

  const totalDescuentos = descuentosPorItem.reduce((s, d) => s + Number(d.descuento || 0), 0);
  const subtotalSuma = items.reduce((s, it) => s + ((it.precio_unitario || (prodMap[it.id_producto] && prodMap[it.id_producto].precio_venta) || 0) * it.cantidad), 0);
  const baseNeto = Math.max(0, subtotalSuma - totalDescuentos);

  // IVA opcional (Venezuela 16%): se aplica sobre la base neta (después de descuentos)
  const ivaCfg = await getIvaConfig(conn, false);
  const ivaPct = ivaCfg.activo ? Number(ivaCfg.porcentaje) : 0;
  const montoIva = ivaCfg.activo ? Number((baseNeto * (ivaPct / 100)).toFixed(4)) : 0;
  const totalFinal = Number((baseNeto + montoIva).toFixed(4));

  // Insert venta (incluye id_caja / subtotal / descuento / IVA si existen columnas)
  const idUsuarioVenta = userId != null && Number(userId) > 0 ? Number(userId) : null;
  if (!idUsuarioVenta) {
    throw new Error('Columna id_usuario no puede ser null: inicia sesión de caja con un usuario válido.');
  }
  const hasIdCaja = await columnExists(conn, 'ventas', 'id_caja');
  const hasSubtotal = await columnExists(conn, 'ventas', 'monto_subtotal');
  const hasIvaCols = await columnExists(conn, 'ventas', 'monto_iva');
  let ventaRes;
  if (hasIdCaja && hasSubtotal && hasIvaCols) {
    [ventaRes] = await conn.query(
      'INSERT INTO ventas (fecha_hora, total_venta, monto_subtotal, monto_descuento, monto_iva, iva_porcentaje, tipo_pago, id_usuario, id_caja, id_cliente) VALUES (NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [totalFinal, subtotalSuma, totalDescuentos, montoIva, ivaPct, tipo_pago || 'Efectivo', idUsuarioVenta, id_caja, id_cliente || null]
    );
  } else if (hasIdCaja && hasSubtotal) {
    [ventaRes] = await conn.query(
      'INSERT INTO ventas (fecha_hora, total_venta, monto_subtotal, monto_descuento, tipo_pago, id_usuario, id_caja, id_cliente) VALUES (NOW(), ?, ?, ?, ?, ?, ?, ?)',
      [totalFinal, subtotalSuma, totalDescuentos, tipo_pago || 'Efectivo', idUsuarioVenta, id_caja, id_cliente || null]
    );
  } else if (hasIdCaja) {
    [ventaRes] = await conn.query(
      'INSERT INTO ventas (fecha_hora, total_venta, tipo_pago, id_usuario, id_caja, id_cliente) VALUES (NOW(), ?, ?, ?, ?, ?)',
      [totalFinal, tipo_pago || 'Efectivo', idUsuarioVenta, id_caja, id_cliente || null]
    );
  } else {
    [ventaRes] = await conn.query(
      'INSERT INTO ventas (fecha_hora, total_venta, tipo_pago, id_usuario, id_cliente) VALUES (NOW(), ?, ?, ?, ?)',
      [totalFinal, tipo_pago || 'Efectivo', idUsuarioVenta, id_cliente || null]
    );
  }
  const id_venta = ventaRes.insertId;
  if (await columnExists(conn, 'ventas', 'tasa_dolar') && Number(options.tasa) > 0) {
    await conn.query('UPDATE ventas SET tasa_dolar = ? WHERE id_venta = ?', [Number(options.tasa), id_venta]);
  }

  // Insert detalle
  const [colsDetalle] = await conn.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'detalleventa'");
  const colNames = colsDetalle.map(c => c.COLUMN_NAME);
  const hasPromoCols = colNames.includes('id_promocion_aplicada') && colNames.includes('descuento_unitario') && colNames.includes('descuento_total');

  for (const dp of descuentosPorItem) {
    const it = dp.item;
    const descuento = Number(dp.descuento || 0);
    const precio = it.precio_unitario || (prodMap[it.id_producto] && prodMap[it.id_producto].precio_venta) || 0;
    const descuentoUnitario = it.cantidad > 0 ? (descuento / it.cantidad) : 0;
    if (hasPromoCols) {
      await conn.query('INSERT INTO detalleventa (id_venta, id_producto, id_talla, cantidad, precio_unitario, id_promocion_aplicada, descuento_unitario, descuento_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [id_venta, it.id_producto, it.id_talla || null, it.cantidad, precio, dp.id_promocion || null, descuentoUnitario, descuento]);
    } else {
      await conn.query('INSERT INTO detalleventa (id_venta, id_producto, id_talla, cantidad, precio_unitario) VALUES (?, ?, ?, ?, ?)', [id_venta, it.id_producto, it.id_talla || null, it.cantidad, precio]);
    }
  }

  await decrementSaleStock(conn, stock);
  const stock_ids = [...stock.quantityByProduct.keys()];

  // Registrar movimiento de caja (ingreso) si la tabla existe
  try {
    if (await tableExists(conn, 'movimientoscaja')) {
      await conn.query(
        `INSERT INTO movimientoscaja (tipo_movimiento, monto, descripcion, fecha_hora, referencia_id, id_usuario)
         VALUES (?, ?, ?, NOW(), ?, ?)`,
        ['INGRESO_VENTA', totalFinal, `Venta #${id_venta} - ${tipo_pago || 'Efectivo'}`, id_venta, idUsuarioVenta]
      );
    }
  } catch (e) {
    console.warn('No se pudo registrar movimiento de caja:', e.message || e);
  }

  // Desglose de formas de pago
  const pagos = Array.isArray(options.pagos) ? options.pagos : [];
  const tasaPago = Number(options.tasa || 0);
  if (!(await tableExists(conn, 'venta_pagos'))) {
    throw new Error('No se pudo guardar la forma de pago: falta la tabla venta_pagos.');
  }
  if (pagos.length) {
    for (const p of pagos) {
      const forma = String(p.forma_pago || p.forma || '').trim();
      let montoUsd = Number(p.monto_usd);
      let montoBs = Number(p.monto_bs);
      if (!(montoUsd > 0) && montoBs > 0 && tasaPago > 0) montoUsd = montoBs / tasaPago;
      if (!(montoBs > 0) && montoUsd > 0 && tasaPago > 0) montoBs = montoUsd * tasaPago;
      if (!forma || (!(montoUsd > 0) && !(montoBs > 0))) {
        throw new Error('No se pudo guardar el desglose: falta la forma de pago o el monto.');
      }
      await conn.query(
        'INSERT INTO venta_pagos (id_venta, forma_pago, monto_usd, monto_bs, tasa) VALUES (?, ?, ?, ?, ?)',
        [id_venta, forma, montoUsd || 0, montoBs || 0, tasaPago || null]
      );
    }
  } else {
    // Compat: una sola forma desde tipo_pago
    await conn.query(
      'INSERT INTO venta_pagos (id_venta, forma_pago, monto_usd, monto_bs, tasa) VALUES (?, ?, ?, ?, ?)',
      [id_venta, tipo_pago || 'Efectivo', totalFinal, tasaPago > 0 ? totalFinal * tasaPago : 0, tasaPago || null]
    );
  }

  return {
    id_venta,
    total: totalFinal,
    descuentos: totalDescuentos,
    subtotal: subtotalSuma,
    base_neta: baseNeto,
    monto_iva: montoIva,
    iva_porcentaje: ivaPct,
    iva_activo: !!ivaCfg.activo,
    stock_ids
  };
}

async function ensureIvaSchema(poolConn) {
  try {
    await poolConn.query(`
      INSERT INTO configuracion (clave, valor, descripcion)
      SELECT 'iva_activo', '0', '1 = aplicar IVA en ventas, etiquetas y facturas; 0 = sin IVA'
      WHERE NOT EXISTS (SELECT 1 FROM configuracion WHERE clave = 'iva_activo')
    `);
    await poolConn.query(`
      INSERT INTO configuracion (clave, valor, descripcion)
      SELECT 'iva_porcentaje', '16', 'Porcentaje de IVA (Venezuela: 16)'
      WHERE NOT EXISTS (SELECT 1 FROM configuracion WHERE clave = 'iva_porcentaje')
    `);
  } catch (_) {}
  try {
    if (!(await columnExists(poolConn, 'ventas', 'monto_iva'))) {
      await poolConn.query('ALTER TABLE ventas ADD COLUMN monto_iva DECIMAL(14,4) NOT NULL DEFAULT 0');
    }
  } catch (_) {}
  try {
    if (!(await columnExists(poolConn, 'ventas', 'iva_porcentaje'))) {
      await poolConn.query('ALTER TABLE ventas ADD COLUMN iva_porcentaje DECIMAL(6,2) NOT NULL DEFAULT 0');
    }
  } catch (_) {}
}

async function getIvaConfig(poolConn, ensureSchema = true) {
  if (ensureSchema) await ensureIvaSchema(poolConn);
  let activo = false;
  let porcentaje = 16;
  try {
    const [rows] = await poolConn.query(
      "SELECT clave, valor FROM configuracion WHERE clave IN ('iva_activo','iva_porcentaje')"
    );
    for (const r of rows || []) {
      if (r.clave === 'iva_activo') {
        const v = String(r.valor || '0').trim().toLowerCase();
        activo = v === '1' || v === 'true' || v === 'si' || v === 'sí';
      }
      if (r.clave === 'iva_porcentaje') {
        const n = Number(r.valor);
        if (Number.isFinite(n) && n >= 0 && n <= 100) porcentaje = n;
      }
    }
  } catch (_) {}
  return { activo, porcentaje };
}

async function setIvaConfig(poolConn, { activo, porcentaje }) {
  await ensureIvaSchema(poolConn);
  const act = activo ? '1' : '0';
  let pct = Number(porcentaje);
  if (!Number.isFinite(pct) || pct < 0) pct = 16;
  if (pct > 100) pct = 100;
  pct = Math.round(pct * 100) / 100;
  await poolConn.query(
    `INSERT INTO configuracion (clave, valor, descripcion) VALUES ('iva_activo', ?, '1 = aplicar IVA…')
     ON DUPLICATE KEY UPDATE valor = VALUES(valor)`,
    [act]
  );
  await poolConn.query(
    `INSERT INTO configuracion (clave, valor, descripcion) VALUES ('iva_porcentaje', ?, 'Porcentaje de IVA')
     ON DUPLICATE KEY UPDATE valor = VALUES(valor)`,
    [String(pct)]
  );
  return { activo: !!activo, porcentaje: pct };
}

async function ensureVentaPagosTable(pool) {
  if (await tableExists(pool, 'venta_pagos')) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS venta_pagos (
      id_pago INT(11) NOT NULL AUTO_INCREMENT,
      id_venta INT(11) NOT NULL,
      forma_pago VARCHAR(80) NOT NULL,
      monto_usd DECIMAL(14,4) NOT NULL DEFAULT 0,
      monto_bs DECIMAL(18,4) NOT NULL DEFAULT 0,
      tasa DECIMAL(18,6) DEFAULT NULL,
      fecha_hora DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id_pago),
      KEY idx_venta_pagos_venta (id_venta),
      KEY idx_venta_pagos_forma (forma_pago)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function ensureFugaMovimientosTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fuga_movimientos (
      id_fuga INT(11) NOT NULL AUTO_INCREMENT,
      id_producto INT(11) NOT NULL,
      producto_nombre VARCHAR(200) NOT NULL,
      codigo_barras VARCHAR(64) DEFAULT NULL,
      tipo ENUM('CONSUMO', 'DANIO', 'VENTA_ESPECIAL') NOT NULL,
      id_lote CHAR(36) DEFAULT NULL,
      cantidad DECIMAL(12,6) NOT NULL,
      id_talla INT(11) DEFAULT NULL,
      talla_nombre VARCHAR(64) DEFAULT NULL,
      precio_unitario DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      monto_total DECIMAL(14,4) NOT NULL DEFAULT 0.0000,
      id_venta INT(11) DEFAULT NULL,
      tipo_pago VARCHAR(50) DEFAULT NULL,
      motivo VARCHAR(255) DEFAULT NULL,
      id_usuario INT(11) NOT NULL,
      fecha_hora DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id_fuga),
      KEY idx_fuga_fecha (fecha_hora),
      KEY idx_fuga_producto (id_producto),
      KEY idx_fuga_venta (id_venta),
      KEY idx_fuga_lote (id_lote)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  if (!(await columnExists(pool, 'fuga_movimientos', 'id_lote'))) {
    await pool.query('ALTER TABLE fuga_movimientos ADD COLUMN id_lote CHAR(36) DEFAULT NULL, ADD KEY idx_fuga_lote (id_lote)');
  }
}
// Revisión segura para 'detalleventa' y columnas necesarias para promociones
(async function revisarEsquemaDetalleVentaYPromos() {
  try {
    // Verificar columnas en detalleventa
    const [cols] = await pool.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'detalleventa'");
    const names = cols.map(c => c.COLUMN_NAME);
    const needCols = [];
    if (!names.includes('id_promocion_aplicada')) needCols.push('id_promocion_aplicada');
    if (!names.includes('descuento_unitario')) needCols.push('descuento_unitario');
    if (!names.includes('descuento_total')) needCols.push('descuento_total');

    // Verificar columnas param_x/param_y en promociones
    const [colsPromo] = await pool.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'promociones'");
    const promoNames = colsPromo.map(c => c.COLUMN_NAME);
    const needPromoCols = [];
    if (!promoNames.includes('param_x')) needPromoCols.push('param_x');
    if (!promoNames.includes('param_y')) needPromoCols.push('param_y');

    if (needCols.length === 0 && needPromoCols.length === 0) {
      if (SHOW_SCHEMA_WARNINGS) console.log('Esquema: detalleventa y promociones ya contienen columnas necesarias para promociones.');
      return;
    }

  // columnas faltantes detectadas (silenciadas para no mostrar advertencias en inicio)

  if (process.env.FORCE_SCHEMA_MIGRATE === '1' || process.env.ALLOW_DESTRUCTIVE_MIGRATIONS === '1') {
      // Ejecutar ALTER TABLE para agregar columnas faltantes (no destructivo)
      try {
        for (const c of needCols) {
          if (c === 'id_promocion_aplicada') {
            await pool.query('ALTER TABLE detalleventa ADD COLUMN id_promocion_aplicada INT NULL');
            console.log('Esquema: columna detalleventa.id_promocion_aplicada creada');
          } else if (c === 'descuento_unitario') {
            await pool.query('ALTER TABLE detalleventa ADD COLUMN descuento_unitario DECIMAL(10,2) NOT NULL DEFAULT 0');
            console.log('Esquema: columna detalleventa.descuento_unitario creada');
          } else if (c === 'descuento_total') {
            await pool.query('ALTER TABLE detalleventa ADD COLUMN descuento_total DECIMAL(12,2) NOT NULL DEFAULT 0');
            console.log('Esquema: columna detalleventa.descuento_total creada');
          }
        }

        for (const c of needPromoCols) {
          if (c === 'param_x') {
            await pool.query('ALTER TABLE promociones ADD COLUMN param_x INT NULL');
            console.log('Esquema: columna promociones.param_x creada');
          } else if (c === 'param_y') {
            await pool.query('ALTER TABLE promociones ADD COLUMN param_y INT NULL');
            console.log('Esquema: columna promociones.param_y creada');
          }
        }
      } catch (e) {
        console.warn('Error aplicando migración de columnas extras:', e.message || e);
      }
      } else {
      // No modificar la base de datos automáticamente. Mostrar mensaje informativo no intrusivo solo si se solicita.
      if (SHOW_SCHEMA_WARNINGS) {
        console.info('Esquema: faltan columnas opcionales para soporte completo de promociones. El servidor funcionará normalmente sin estas columnas.');
        console.info('Si deseas crearlas más tarde, arranca el servidor con: FORCE_SCHEMA_MIGRATE=1 (asegúrate de tener un backup).');
      }
    }
  } catch (e) {
    console.warn('Advertencia al revisar esquema detalleventa/promociones:', e.message || e);
  }
})();

// Permitir id_talla NULL en detalleventa (productos sin talla: abastos, kg, L, unidad, etc.)
(async function revisarEsquemaTallaOpcional() {
  try {
    const [cols] = await pool.query(
      `SELECT IS_NULLABLE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'detalleventa' AND COLUMN_NAME = 'id_talla' LIMIT 1`
    );
    if (!cols.length) return;
    if (String(cols[0].IS_NULLABLE).toUpperCase() === 'YES') {
      if (SHOW_SCHEMA_WARNINGS) console.log('Esquema: detalleventa.id_talla ya acepta NULL');
      return;
    }
    await pool.query('ALTER TABLE detalleventa MODIFY COLUMN id_talla INT(11) NULL DEFAULT NULL');
    console.log('Esquema: detalleventa.id_talla ahora acepta NULL (ventas sin talla)');
  } catch (e) {
    console.warn('No se pudo hacer id_talla nullable (ejecuta db/migrations/004_detalleventa_talla_nullable.sql):', e.message || e);
  }
})();

async function ensureDevolucionesSchema(poolConn) {
  const db = poolConn || pool;
  try {
    if (!(await tableExists(db, 'devoluciones'))) {
      await db.query(`
        CREATE TABLE IF NOT EXISTS devoluciones (
          id_devolucion INT(11) NOT NULL AUTO_INCREMENT,
          id_detalle INT(11) NOT NULL,
          fecha_hora DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          cantidad DECIMAL(12,6) NOT NULL DEFAULT 0,
          monto_reembolsado DECIMAL(12,2) NOT NULL DEFAULT 0,
          tasa_dolar DECIMAL(12,4) DEFAULT NULL,
          PRIMARY KEY (id_devolucion),
          KEY idx_dev_detalle (id_detalle)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    }
  } catch (e) {
    console.warn('No se pudo crear tabla devoluciones:', e.message || e);
  }
  try {
    await db.query('ALTER TABLE devoluciones MODIFY COLUMN cantidad DECIMAL(12,6) NOT NULL DEFAULT 0');
  } catch (_) {}
  try {
    await db.query(`
      INSERT INTO configuracion (clave, valor, descripcion)
      SELECT 'clave_devoluciones', 'devol123', 'Clave de acceso para módulo de devoluciones'
      WHERE NOT EXISTS (SELECT 1 FROM configuracion WHERE clave = 'clave_devoluciones')
    `);
  } catch (_) {}
}
(async function initDevolucionesSchema() {
  try { await ensureDevolucionesSchema(pool); } catch (_) {}
})();

async function getClaveDevoluciones(poolConn) {
  const db = poolConn || pool;
  await ensureDevolucionesSchema(db);
  try {
    const [rows] = await db.query(
      "SELECT clave, valor, descripcion FROM configuracion WHERE clave IN ('clave_devoluciones','devoluciones') OR descripcion LIKE '%devoluc%' LIMIT 10"
    );
    for (const r of rows || []) {
      if (r.clave === 'clave_devoluciones' && String(r.valor || '').trim()) {
        return String(r.valor).trim();
      }
    }
    for (const r of rows || []) {
      const valor = String(r.valor || '').trim();
      const clave = String(r.clave || '').trim();
      if (valor) return valor;
      if (clave && clave !== 'clave_devoluciones' && clave !== 'devoluciones') return clave;
    }
  } catch (_) {}
  return 'devol123';
}

async function detallesVentaParaDevolucion(idVenta) {
  const [cols] = await pool.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'detalleventa'"
  );
  const names = (cols || []).map((c) => c.COLUMN_NAME);
  const hasDesc = names.includes('descuento_unitario');
  const descSql = hasDesc ? ', COALESCE(d.descuento_unitario, 0) AS descuento_unitario' : ', 0 AS descuento_unitario';
  const [det] = await pool.query(
    `SELECT d.id_detalle, d.id_producto, d.id_talla, d.cantidad, d.precio_unitario
            ${descSql},
            COALESCE(t.nombre, '-') AS nombre_talla,
            COALESCE(p.nombre, p.marca, 'Producto') AS nombre_producto,
            COALESCE((SELECT SUM(dev.cantidad) FROM devoluciones dev WHERE dev.id_detalle = d.id_detalle), 0) AS devuelta
     FROM detalleventa d
     LEFT JOIN productos p ON p.id_producto = d.id_producto
     LEFT JOIN tallas t ON t.id_talla = d.id_talla
     WHERE d.id_venta = ?
     ORDER BY d.id_detalle`,
    [idVenta]
  );
  return (det || []).map((d) => {
    const cantidad = Number(d.cantidad || 0);
    const devuelta = Number(d.devuelta || 0);
    const disponible = Math.max(0, cantidad - devuelta);
    const precioUnit = Number(d.precio_unitario || 0);
    const descUnit = Number(d.descuento_unitario || 0);
    const precio_neto = Math.max(0, precioUnit - descUnit);
    return {
      id_detalle: d.id_detalle,
      id_producto: d.id_producto,
      id_talla: d.id_talla,
      nombre_producto: d.nombre_producto,
      nombre_talla: d.nombre_talla,
      cantidad,
      devuelta,
      disponible,
      precio_unitario: precioUnit,
      precio_neto
    };
  });
}

// ---------------- Rutas compartidas: Logout ----------------
app.post('/api/logout', (req, res) => {
  try {
    if (req.session) req.session = null;
  } catch (_) {}
  const sessionCookieName = isCajaMayorRequest(req) ? 'max_sess_mayor' : 'max_sess';
  const cookieOpts = { path: '/', sameSite: 'lax', httpOnly: true, secure: false };
  try { res.clearCookie(sessionCookieName, cookieOpts); } catch (_) {}
  try { res.clearCookie('session', cookieOpts); } catch (_) {}
  // Expirar también con Set-Cookie vacío (Electron a veces ignora clearCookie solo)
  try {
    res.append('Set-Cookie', `${sessionCookieName}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly`);
    res.append('Set-Cookie', 'session=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly');
  } catch (_) {}
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true });
});

// Ruta: estado del servidor y BD
function getLanIps() {
  const os = require('os');
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      const fam = net.family;
      if ((fam === 'IPv4' || fam === 4) && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  // Preferir LAN típica (192.168.x) frente a VPN / VirtualBox
  const score = (ip) => {
    if (/^192\.168\.(56|57)\./.test(ip)) return 8;
    if (/^192\.168\./.test(ip)) return 0;
    if (/^10\.2\./.test(ip)) return 7; // VPN frecuente
    if (/^10\./.test(ip)) return 2;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return 3;
    return 9;
  };
  return [...new Set(ips)].sort((a, b) => score(a) - score(b));
}

app.get('/api/status', async (req, res) => {
  const bdOK = await verificarConexiónBD();
  const user = req.session.user || null;
  const port = serverPortState.primaryPort;
  const cajaMayorPort = serverPortState.cajaMayorPort;
  const ips = getLanIps();
  let rol = 'Invitado';
  if (user) {
    if (user.id_rol == 1) rol = 'Administrador';
    if (user.id_rol == 2) rol = 'Caja';
    // Si el admin abre desde el teléfono, forzar modo solo lectura
    const mobile = isMobileUserAgent(req.headers['user-agent']);
    if (user.id_rol == 1) {
      req.session.mobile_readonly = !!mobile;
    } else if (mobile) {
      // Caja no puede usar el sistema desde el teléfono
      req.session = null;
      return res.json({
        servidor: true,
        bd: bdOK,
        usuario: null,
        rol: 'Invitado',
        mobile_blocked: true,
        error: 'Desde el teléfono solo puede entrar el administrador (solo consulta).',
        red: {
          port,
          ips,
          caja_mayor_port: cajaMayorPort,
          caja_mayor_urls: cajaMayorPort
            ? ips.map((ip) => `http://${ip}:${cajaMayorPort}/caja.html?modo=mayor`)
            : []
        }
      });
    } else {
      req.session.mobile_readonly = false;
    }
  }
  res.json({
    servidor: true,
    bd: bdOK,
    usuario: user ? user.usuario : null,
    rol: rol,
    mobile_readonly: !!(req.session && req.session.mobile_readonly),
    red: {
      port,
      ips,
      caja_urls: ips.map((ip) => `http://${ip}:${port}/caja.html`),
      admin_urls: ips.map((ip) => `http://${ip}:${port}/admin.html`),
      caja_mayor_port: cajaMayorPort,
      caja_mayor_urls: cajaMayorPort
        ? ips.map((ip) => `http://${ip}:${cajaMayorPort}/caja.html?modo=mayor`)
        : []
    }
  });
});

// Ruta de login
app.post('/api/login', async (req, res) => {
  const { usuario, password } = req.body;
  try {
    const user = await verificarCredenciales(usuario, password, { pool });
    if (!user) {
      return res.status(401).json({ ok: false, error: 'Credenciales inválidas' });
    }
    const mobile = isMobileUserAgent(req.headers['user-agent']);
    // Desde teléfono solo administrador
    if (mobile && Number(user.id_rol) !== 1) {
      return res.status(403).json({
        ok: false,
        error: 'Desde el teléfono solo puede entrar el administrador (solo consulta).'
      });
    }
    req.session.user = { id: user.id, usuario: user.usuario, id_rol: user.id_rol };
    req.session.mobile_readonly = !!(mobile && Number(user.id_rol) === 1);
    let rol = user.id_rol == 1 ? 'Administrador' : 'Caja';
    return res.json({
      ok: true,
      usuario: user.usuario,
      rol,
      mobile_readonly: !!req.session.mobile_readonly
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: 'Error del servidor' });
  }
});

// Ejemplo de función para generar hash (solo para la primera vez)
app.get('/api/generar-hash/:password', async (req, res) => {
  try {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(req.params.password, salt);
    res.send({ password: req.params.password, hash: hash, nota: 'Usar este hash en phpMyAdmin para crear el usuario' });
  } catch (e) {
    res.status(500).json({ error: 'Error al generar hash' });
  }
});

// ---------------- Endpoint para tasa BCV con cache y fallback ----------------
const TASA_FILE = (() => {
  try { ensureDir(resolveData()); } catch (_) {}
  return resolveData('tasa_cache.json');
})();
let _cachedTasa = null;
let _cachedTasaTs = 0;
let _cachedTasaFecha = null;
let _cachedTasaSource = null;
let _bcvTasa = null;
let _bcvTasaFecha = null;
let _bcvTasaTs = 0;
/** @type {{ tasa:number, expires_at:number, set_at:number, duration_days:number }|null} */
let _manualLock = null;
const TASA_CACHE_MS = 1000 * 60 * 5; // reconsultar online cada 5 min
try { if (!fs.existsSync(path.dirname(TASA_FILE))) fs.mkdirSync(path.dirname(TASA_FILE), { recursive: true }); } catch (_) {}
try {
  if (fs.existsSync(TASA_FILE)) {
    const j = JSON.parse(fs.readFileSync(TASA_FILE, 'utf8'));
    if (j && Number(j.tasa) > 0) {
      _cachedTasa = Number(j.tasa);
      _cachedTasaTs = Number(j.ts) || Date.now();
      _cachedTasaFecha = j.fecha || null;
      _cachedTasaSource = j.source || 'disk';
    }
    if (j && Number(j.bcv_tasa) > 0) {
      _bcvTasa = Number(j.bcv_tasa);
      _bcvTasaFecha = j.bcv_fecha || null;
      _bcvTasaTs = Number(j.bcv_ts) || 0;
    }
    if (j && j.manual_lock && Number(j.manual_lock.tasa) > 0 && Number(j.manual_lock.expires_at) > Date.now()) {
      _manualLock = {
        tasa: Number(j.manual_lock.tasa),
        expires_at: Number(j.manual_lock.expires_at),
        set_at: Number(j.manual_lock.set_at) || Date.now(),
        duration_days: Number(j.manual_lock.duration_days) || 1
      };
      _cachedTasa = _manualLock.tasa;
      _cachedTasaSource = 'manual';
      _cachedTasaTs = _manualLock.set_at;
    } else if (j && j.manual_lock) {
      _manualLock = null;
    }
  }
} catch (_) {}

function currentTasaPayload() {
  return {
    ok: true,
    tasa: _cachedTasa,
    source: _cachedTasaSource,
    fecha: _cachedTasaFecha,
    cached: true,
    offline: false,
    updatedAt: _cachedTasaTs,
    ...tasaResponseExtras()
  };
}

function broadcastTasaUpdate() {
  if (!_cachedTasa) return;
  const payload = `event: tasa\ndata: ${JSON.stringify(currentTasaPayload())}\n\n`;
  for (const res of tasaStreamClients) {
    try {
      res.write(payload);
    } catch (_) {
      tasaStreamClients.delete(res);
    }
  }
}

function persistTasaCache() {
  try {
    fs.writeFileSync(TASA_FILE, JSON.stringify({
      tasa: _cachedTasa,
      ts: _cachedTasaTs,
      fecha: _cachedTasaFecha,
      source: _cachedTasaSource,
      bcv_tasa: _bcvTasa,
      bcv_fecha: _bcvTasaFecha,
      bcv_ts: _bcvTasaTs,
      manual_lock: _manualLock
    }), 'utf8');
  } catch (e) {
    console.warn('No se pudo guardar tasa en disco:', e.message);
  }
}

function clearExpiredManualLock() {
  if (_manualLock && Number(_manualLock.expires_at) <= Date.now()) {
    _manualLock = null;
    persistTasaCache();
  }
}

function isManualLocked() {
  clearExpiredManualLock();
  return !!( _manualLock && Number(_manualLock.expires_at) > Date.now() && Number(_manualLock.tasa) > 0 );
}

function tasaResponseExtras() {
  clearExpiredManualLock();
  return {
    locked: isManualLocked(),
    lock: _manualLock
      ? {
          tasa: _manualLock.tasa,
          expires_at: _manualLock.expires_at,
          set_at: _manualLock.set_at,
          duration_days: _manualLock.duration_days,
          expires_in_ms: Math.max(0, _manualLock.expires_at - Date.now())
        }
      : null,
    bcv_tasa: _bcvTasa,
    bcv_fecha: _bcvTasaFecha
  };
}

function setCachedTasa(tasa, source, fecha) {
  _cachedTasa = Number(tasa);
  _cachedTasaTs = Date.now();
  _cachedTasaSource = source || 'api';
  _cachedTasaFecha = fecha || new Date().toISOString().slice(0, 10);
  if (source && !/^manual$/i.test(source)) {
    _bcvTasa = _cachedTasa;
    _bcvTasaFecha = _cachedTasaFecha;
    _bcvTasaTs = _cachedTasaTs;
  }
  persistTasaCache();
}

function setManualLock(tasa, durationDays) {
  const days = Math.max(1, Math.min(365, Math.round(Number(durationDays) || 1)));
  const now = Date.now();
  _manualLock = {
    tasa: Number(tasa),
    set_at: now,
    expires_at: now + days * 24 * 60 * 60 * 1000,
    duration_days: days
  };
  _cachedTasa = _manualLock.tasa;
  _cachedTasaTs = now;
  _cachedTasaSource = 'manual';
  _cachedTasaFecha = new Date().toISOString().slice(0, 10);
  persistTasaCache();
  try { broadcastTasaUpdate(); } catch (_) {}
}

function clearManualLock() {
  _manualLock = null;
  persistTasaCache();
}

const fetch = require('node-fetch');

// Fuentes públicas de tasa BCV (oficial). Orden: más confiables primero.
// Se puede forzar una sola con BCV_API_URL.
const TASA_SOURCES = [
  {
    name: 'dolarflow',
    url: 'https://dolarflow.com/api/oficial/',
    parse: (j) => {
      const tasa = parseFloat(j && (j.precio != null ? j.precio : j.promedio));
      const fecha = (j && (j.fechaActualizacion || j.fecha)) ? String(j.fechaActualizacion || j.fecha).slice(0, 10) : null;
      return Number.isFinite(tasa) && tasa > 0 ? { tasa, fecha } : null;
    }
  },
  {
    name: 'dolarapi',
    url: 'https://ve.dolarapi.com/v1/dolares/oficial',
    parse: (j) => {
      const tasa = parseFloat(j && (j.promedio != null ? j.promedio : (j.venta != null ? j.venta : j.compra)));
      const fecha = (j && j.fechaActualizacion) ? String(j.fechaActualizacion).slice(0, 10) : null;
      return Number.isFinite(tasa) && tasa > 0 ? { tasa, fecha } : null;
    }
  },
  {
    name: 'bcv.today',
    url: 'https://bcv.today/api/v1/rate.json',
    parse: (j) => {
      const tasa = parseFloat(j && j.USD);
      const fecha = (j && (j.effective_date || j.date)) ? String(j.effective_date || j.date).slice(0, 10) : null;
      return Number.isFinite(tasa) && tasa > 0 ? { tasa, fecha } : null;
    }
  },
  {
    name: 'dolartoday',
    url: 'https://s3.amazonaws.com/dolartoday/data.json',
    parse: (j) => {
      const usd = j && j.USD;
      const raw = usd && (usd.dolartoday || usd.transferencia || usd.promedio || usd.sicad2);
      const tasa = parseFloat(raw);
      return Number.isFinite(tasa) && tasa > 0 ? { tasa, fecha: null } : null;
    }
  }
];

if (process.env.BCV_API_URL) {
  TASA_SOURCES.unshift({
    name: 'BCV_API_URL',
    url: process.env.BCV_API_URL,
    parse: (j) => {
      if (j && j.current && typeof j.current === 'object' && j.current.usd != null) {
        const tasa = parseFloat(j.current.usd);
        const fecha = j.current.date || j.current.fecha || null;
        if (Number.isFinite(tasa) && tasa > 0) return { tasa, fecha };
      }
      const tasa = parseFloat(j && (j.precio != null ? j.precio : (j.tasa || j.valor || j.promedio || j.USD || (j.data && j.data.USD))));
      return Number.isFinite(tasa) && tasa > 0 ? { tasa, fecha: null } : null;
    }
  });
}

async function fetchTasaFromSources() {
  for (const src of TASA_SOURCES) {
    try {
      const resp = await fetch(src.url, {
        timeout: 8000,
        headers: { Accept: 'application/json', 'User-Agent': 'MaxPOS/1.0' }
      });
      if (!resp.ok) {
        console.warn(`[tasa] ${src.name} HTTP ${resp.status}`);
        continue;
      }
      const json = await resp.json();
      const parsed = src.parse(json);
      if (parsed) {
        return { ...parsed, source: src.name };
      }
      console.warn(`[tasa] ${src.name} respuesta sin tasa válida`);
    } catch (e) {
      console.warn(`[tasa] ${src.name} falló:`, e.message);
    }
  }
  return null;
}

app.get('/api/tasa-bcv', async (req, res) => {
  const now = Date.now();
  const force = req.query.refresh === '1' || req.query.force === '1';
  const extras = () => tasaResponseExtras();

  // Tasa manual vigente: no la pisa el BCV hasta que expire (o el usuario la quite)
  if (isManualLocked()) {
    return res.json({
      ok: true,
      tasa: _manualLock.tasa,
      source: 'manual',
      fecha: _cachedTasaFecha,
      cached: true,
      offline: false,
      updatedAt: _manualLock.set_at,
      ...extras()
    });
  }

  if (!force && _cachedTasa && (now - _cachedTasaTs) < TASA_CACHE_MS) {
    return res.json({
      ok: true,
      tasa: _cachedTasa,
      source: _cachedTasaSource || 'cache',
      fecha: _cachedTasaFecha,
      cached: true,
      updatedAt: _cachedTasaTs,
      ...extras()
    });
  }
  try {
    const online = await fetchTasaFromSources();
    if (online) {
      setCachedTasa(online.tasa, online.source, online.fecha);
      return res.json({
        ok: true,
        tasa: _cachedTasa,
        source: _cachedTasaSource,
        fecha: _cachedTasaFecha,
        cached: false,
        offline: false,
        updatedAt: _cachedTasaTs,
        ...extras()
      });
    }

    // Sin internet / APIs caídas: última tasa buena (memoria/disco). Nunca inventar un número.
    if (_cachedTasa && _cachedTasa > 0) {
      return res.json({
        ok: true,
        tasa: _cachedTasa,
        source: _cachedTasaSource || 'stale-cache',
        fecha: _cachedTasaFecha,
        cached: true,
        offline: true,
        updatedAt: _cachedTasaTs,
        ...extras()
      });
    }
    return res.status(503).json({
      ok: false,
      error: 'No hay tasa disponible. Configúrala en Admin → Impuestos / IVA.',
      tasa: null,
      offline: true,
      ...extras()
    });
  } catch (e) {
    console.error('Error obtener tasa BCV:', e.message);
    if (_cachedTasa && _cachedTasa > 0) {
      return res.json({
        ok: true,
        tasa: _cachedTasa,
        source: _cachedTasaSource || 'stale-cache',
        fecha: _cachedTasaFecha,
        cached: true,
        offline: true,
        updatedAt: _cachedTasaTs,
        ...extras()
      });
    }
    return res.status(503).json({
      ok: false,
      error: 'Sin conexión para obtener la tasa del dólar',
      tasa: null,
      offline: true,
      ...extras()
    });
  }
});

// Guardar tasa manual (dura el tiempo que elija el usuario: días)
app.post('/api/tasa-bcv/manual', requiereRol('administrador'), async (req, res) => {
  const body = req.body || {};
  const tasa = parseFloat(body.tasa || body.precio || body.valor);
  if (!tasa || isNaN(tasa) || tasa <= 0) {
    return res.status(400).json({ ok: false, error: 'Tasa inválida' });
  }
  const durationDays = body.duration_days != null
    ? Number(body.duration_days)
    : (body.dias != null ? Number(body.dias) : 7);
  setManualLock(tasa, durationDays);
  res.json({
    ok: true,
    tasa: _cachedTasa,
    source: 'manual',
    fecha: _cachedTasaFecha,
    updatedAt: _cachedTasaTs,
    ...tasaResponseExtras()
  });
});

// Volver a la tasa BCV (doble clic / botón). Libera el bloqueo manual.
app.post('/api/tasa-bcv/usar-bcv', requiereRol('administrador'), async (req, res) => {
  clearManualLock();
  try {
    const online = await fetchTasaFromSources();
    if (online) {
      setCachedTasa(online.tasa, online.source, online.fecha);
      try { broadcastTasaUpdate(); } catch (_) {}
      return res.json({
        ok: true,
        tasa: _cachedTasa,
        source: _cachedTasaSource,
        fecha: _cachedTasaFecha,
        offline: false,
        updatedAt: _cachedTasaTs,
        ...tasaResponseExtras()
      });
    }
    if (_bcvTasa > 0) {
      setCachedTasa(_bcvTasa, 'bcv-cache', _bcvTasaFecha);
      try { broadcastTasaUpdate(); } catch (_) {}
      return res.json({
        ok: true,
        tasa: _cachedTasa,
        source: 'bcv-cache',
        fecha: _cachedTasaFecha,
        offline: true,
        updatedAt: _cachedTasaTs,
        ...tasaResponseExtras()
      });
    }
    if (_cachedTasa > 0) {
      try { broadcastTasaUpdate(); } catch (_) {}
      return res.json({
        ok: true,
        tasa: _cachedTasa,
        source: _cachedTasaSource || 'cache',
        fecha: _cachedTasaFecha,
        offline: true,
        updatedAt: _cachedTasaTs,
        ...tasaResponseExtras()
      });
    }
    return res.status(503).json({
      ok: false,
      error: 'No se pudo obtener la tasa BCV. Revisa internet o fíjala en Admin.',
      tasa: null,
      ...tasaResponseExtras()
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'Error al restaurar BCV' });
  }
});

// Detección REAL de impresoras instaladas en este equipo (Windows) vía WMI
app.get('/api/caja/impresora/estado', requiereRol('cualquiera'), async (_req, res) => {
  const { execFile } = require('child_process');
  const isWin = process.platform === 'win32';
  if (!isWin) {
    return res.json({ ok: true, conectada: false, plataforma: process.platform, impresoras: [], detalle: 'Detección WMI solo en Windows' });
  }
  const ps = `
    $ErrorActionPreference = 'Stop';
    Get-CimInstance Win32_Printer | Select-Object Name, Default, WorkOffline, PrinterStatus, PortName |
      ConvertTo-Json -Compress
  `;
  execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
    timeout: 10000,
    windowsHide: true,
    maxBuffer: 1024 * 1024
  }, (err, stdout) => {
    if (err) {
      console.warn('[impresora] WMI:', err.message);
      return res.json({ ok: false, conectada: false, impresoras: [], error: err.message });
    }
    let raw = (stdout || '').trim();
    if (!raw) return res.json({ ok: true, conectada: false, impresoras: [] });
    let list;
    try {
      list = JSON.parse(raw);
    } catch (_) {
      return res.json({ ok: false, conectada: false, impresoras: [], error: 'No se pudo leer impresoras' });
    }
    if (!Array.isArray(list)) list = list ? [list] : [];
    // PrinterStatus: 3 Idle, 4 Printing, 5 Warmup — WorkOffline false = lista
    const utiles = list.filter((p) => {
      const offline = p.WorkOffline === true || p.WorkOffline === 'True';
      const status = Number(p.PrinterStatus);
      const name = String(p.Name || '');
      if (offline) return false;
      if (/fax|onenote|pdf|xps|microsoft print to/i.test(name)) return false;
      if (status && ![3, 4, 5, 6].includes(status) && status !== 0) {
        // algunos drivers reportan 0/otros; si no está offline la aceptamos
      }
      return true;
    });
    const def = utiles.find((p) => p.Default === true || p.Default === 'True') || utiles[0] || null;
    return res.json({
      ok: true,
      conectada: utiles.length > 0,
      impresoras: utiles.map((p) => ({
        nombre: p.Name,
        predeterminada: !!(p.Default === true || p.Default === 'True'),
        puerto: p.PortName || null,
        estado: p.PrinterStatus
      })),
      predeterminada: def ? def.Name : null,
      detalle: def ? `Impresora lista: ${def.Name}` : 'No hay impresoras físicas listas'
    });
  });
});

// ==================== DEVOLUCIONES (CAJA) ====================
// Validar acceso al módulo de devoluciones mediante clave en tabla configuracion
app.post('/api/devoluciones/validar-clave', requiereRol('cualquiera'), async (req, res) => {
  try {
    const clave = (req.body && req.body.clave ? String(req.body.clave) : '').trim();
    if (!clave) return res.json({ ok: false, error: 'Escribe la clave' });
    const expected = await getClaveDevoluciones(pool);
    const ok = clave === expected;
    return res.json({ ok, error: ok ? null : 'Clave incorrecta' });
  } catch (e) {
    console.error('[DEVOLUCIONES] validar-clave:', e.message || e);
    return res.json({ ok: false, error: 'No se pudo validar la clave' });
  }
});

// ==================== IVA (configuración fiscal Venezuela) ====================
app.get('/api/config/iva', requiereRol('cualquiera'), async (req, res) => {
  try {
    const cfg = await getIvaConfig(pool);
    res.json({ ok: true, activo: cfg.activo, porcentaje: cfg.porcentaje });
  } catch (e) {
    console.error('Error leyendo IVA:', e);
    res.json({ ok: true, activo: false, porcentaje: 16 });
  }
});

app.get('/api/admin/config/iva', requiereRol('administrador'), async (req, res) => {
  try {
    const cfg = await getIvaConfig(pool);
    res.json({ ok: true, activo: cfg.activo, porcentaje: cfg.porcentaje });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || 'Error' });
  }
});

app.put('/api/admin/config/iva', requiereRol('administrador'), async (req, res) => {
  try {
    const body = req.body || {};
    const activo = !!(body.activo === true || body.activo === 1 || body.activo === '1' || body.activo === 'true');
    const porcentaje = body.porcentaje != null ? Number(body.porcentaje) : 16;
    const cfg = await setIvaConfig(pool, { activo, porcentaje });
    res.json({
      ok: true,
      activo: cfg.activo,
      porcentaje: cfg.porcentaje,
      mensaje: cfg.activo
        ? `IVA ${cfg.porcentaje}% activado: se aplicará a todas las ventas, facturas y etiquetas.`
        : 'IVA desactivado: precios y facturas sin impuesto.'
    });
  } catch (e) {
    console.error('Error guardando IVA:', e);
    res.status(500).json({ ok: false, error: e.message || 'Error al guardar' });
  }
});

// Listar ventas por número de venta, con detalles y cantidades disponibles para devolución (validación 48 horas)
app.get('/api/devoluciones/venta', requiereRol('cualquiera'), async (req, res) => {
  try {
    await ensureDevolucionesSchema(pool);
    const id_venta = req.query.id_venta ? Number(req.query.id_venta) : null;
    if (!id_venta || !Number.isFinite(id_venta) || id_venta <= 0) {
      return res.json({ ok: false, ventas: [], error: 'Número de venta inválido' });
    }

    const [ventasRows] = await pool.query(
      `SELECT id_venta, fecha_hora, total_venta, tipo_pago, id_cliente FROM ventas WHERE id_venta = ? LIMIT 1`,
      [id_venta]
    );
    if (!ventasRows || ventasRows.length === 0) {
      return res.json({ ok: true, ventas: [], error: 'No hay un ticket con ese número' });
    }

    const venta = ventasRows[0];
    const fechaVenta = new Date(venta.fecha_hora);
    const horasTranscurridas = Number.isNaN(fechaVenta.getTime())
      ? 0
      : (Date.now() - fechaVenta.getTime()) / (1000 * 60 * 60);
    const fuera_de_plazo = horasTranscurridas > 48;
    venta.fuera_de_plazo = fuera_de_plazo;
    venta.horas_restantes = Math.max(0, 48 - horasTranscurridas);
    venta.detalles = await detallesVentaParaDevolucion(venta.id_venta);
    return res.json({ ok: true, ventas: [venta], fuera_de_plazo });
  } catch (e) {
    console.error('[DEVOLUCIONES] Error /api/devoluciones/venta:', e.message || e);
    return res.status(500).json({ ok: false, ventas: [], error: 'Error del servidor: ' + (e.message || 'Error desconocido') });
  }
});

// Mantener endpoint anterior por compatibilidad (deprecated)
app.get('/api/devoluciones/ventas-cliente', requiereRol('cualquiera'), async (req, res) => {
  try {
    const cedula = req.query.cedula ? String(req.query.cedula).trim() : '';
    if (!cedula) return res.json({ ok: false, ventas: [] });
    const [cliRows] = await pool.query('SELECT id_cliente, nombre FROM clientes WHERE cedula = ? LIMIT 1', [cedula]);
    if (!cliRows || cliRows.length === 0) return res.json({ ok: true, ventas: [] });
    const id_cliente = cliRows[0].id_cliente;

    // Ventas del cliente
    const [ventas] = await pool.query(
      `SELECT id_venta, fecha_hora, total_venta, tipo_pago FROM ventas WHERE id_cliente = ? ORDER BY fecha_hora DESC LIMIT 200`,
      [id_cliente]
    );

    // Para cada venta, obtener detalle + cantidad devuelta acumulada
    for (const v of ventas) {
      const [det] = await pool.query(
        `SELECT d.id_detalle, d.id_producto, d.id_talla, d.cantidad, d.precio_unitario,
                COALESCE(t.nombre, '-') AS nombre_talla,
                COALESCE(p.nombre, '') AS nombre_producto,
                COALESCE(SUM(dev.cantidad), 0) AS devuelta
         FROM detalleventa d
         LEFT JOIN productos p ON p.id_producto = d.id_producto
         LEFT JOIN tallas t ON t.id_talla = d.id_talla
         LEFT JOIN devoluciones dev ON dev.id_detalle = d.id_detalle
         WHERE d.id_venta = ?
         GROUP BY d.id_detalle, d.id_producto, d.id_talla, d.cantidad, d.precio_unitario, t.nombre, p.nombre
         ORDER BY d.id_detalle`,
        [v.id_venta]
      );
      // Calcular cantidad disponible para devolución y precio neto
      const [cols] = await pool.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'detalleventa'");
      const hasDescUnit = Array.isArray(cols) && cols.some(c => c.COLUMN_NAME === 'descuento_unitario');
      const detConDispon = [];
      for (const d of det) {
        const disponible = Math.max(0, Number(d.cantidad || 0) - Number(d.devuelta || 0));
        let precio_neto = Number(d.precio_unitario || 0);
        if (hasDescUnit) {
          try {
            const [rr] = await pool.query('SELECT descuento_unitario FROM detalleventa WHERE id_detalle = ? LIMIT 1', [d.id_detalle]);
            if (rr && rr[0] && rr[0].descuento_unitario != null) precio_neto = Math.max(0, precio_neto - Number(rr[0].descuento_unitario || 0));
          } catch (_) {}
        }
        detConDispon.push({
          id_detalle: d.id_detalle,
          id_producto: d.id_producto,
          id_talla: d.id_talla,
          nombre_producto: d.nombre_producto,
          nombre_talla: d.nombre_talla,
          cantidad: Number(d.cantidad),
          devuelta: Number(d.devuelta),
          disponible,
          precio_unitario: Number(d.precio_unitario),
          precio_neto
        });
      }
      v.detalles = detConDispon;
    }

    return res.json({ ok: true, ventas });
  } catch (e) {
    console.error('Error /api/devoluciones/ventas-cliente:', e.message || e);
    return res.status(500).json({ ok: false, ventas: [] });
  }
});

// Registrar devolución de una línea de venta (parcial o total)
app.post('/api/devoluciones', requiereRol('cualquiera'), async (req, res) => {
  const { id_detalle, cantidad } = req.body || {};
  const cant = Number(cantidad || 0);
  if (!id_detalle || !Number.isFinite(cant) || cant <= 0 ||
      Math.abs(cant * 1000000 - Math.round(cant * 1000000)) > 0.000001) {
    return res.status(400).json({ ok: false, error: 'Datos inválidos' });
  }
  let conn;
  try {
    await ensureDevolucionesSchema(pool);
    conn = await pool.getConnection();
    await conn.beginTransaction();

    let detalle = null;
    try {
      const [[row]] = await conn.query(
        'SELECT d.id_detalle, d.id_venta, d.id_producto, d.id_talla, d.cantidad, d.precio_unitario, d.descuento_unitario FROM detalleventa d WHERE d.id_detalle = ? LIMIT 1',
        [id_detalle]
      );
      detalle = row;
    } catch (_) {
      const [[row]] = await conn.query(
        'SELECT d.id_detalle, d.id_venta, d.id_producto, d.id_talla, d.cantidad, d.precio_unitario FROM detalleventa d WHERE d.id_detalle = ? LIMIT 1',
        [id_detalle]
      );
      detalle = row;
      if (detalle) detalle.descuento_unitario = 0;
    }
    if (!detalle) { await conn.rollback(); conn.release(); return res.status(404).json({ ok: false, error: 'Producto de la venta no encontrado' }); }

    const [[ventaRow]] = await conn.query('SELECT fecha_hora FROM ventas WHERE id_venta = ? LIMIT 1', [detalle.id_venta]);
    if (ventaRow && ventaRow.fecha_hora) {
      const horas = (Date.now() - new Date(ventaRow.fecha_hora).getTime()) / (1000 * 60 * 60);
      if (Number.isFinite(horas) && horas > 48) {
        await conn.rollback(); conn.release();
        return res.status(400).json({ ok: false, error: 'Esta venta tiene más de 48 horas. Ya no se puede devolver.' });
      }
    }

    const [[acum]] = await conn.query('SELECT COALESCE(SUM(cantidad),0) AS devuelta FROM devoluciones WHERE id_detalle = ?', [id_detalle]);
    const devuelta = Number(acum && acum.devuelta || 0);
    const disponible = Math.max(0, Number(detalle.cantidad || 0) - devuelta);
    if (cant > disponible + 1e-9) {
      await conn.rollback(); conn.release();
      return res.status(400).json({ ok: false, error: `Cantidad supera lo disponible (${disponible})` });
    }

    const precioUnit = Number(detalle.precio_unitario || 0);
    const descUnit = detalle.descuento_unitario != null ? Number(detalle.descuento_unitario || 0) : 0;
    const precioNeto = Math.max(0, precioUnit - descUnit);
    const montoReembolso = Math.round(precioNeto * cant * 100) / 100;

    await conn.query(
      'INSERT INTO devoluciones (id_detalle, fecha_hora, cantidad, monto_reembolsado) VALUES (?, NOW(), ?, ?)',
      [id_detalle, cant, montoReembolso]
    );

    if (detalle.id_talla) {
      const [upd] = await conn.query('UPDATE inventario SET cantidad = cantidad + ? WHERE id_producto = ? AND id_talla = ?', [cant, detalle.id_producto, detalle.id_talla]);
      if (!upd || upd.affectedRows === 0) {
        await conn.query('INSERT INTO inventario (id_producto, id_talla, cantidad) VALUES (?, ?, ?)', [detalle.id_producto, detalle.id_talla, cant]);
      }
    }
    await conn.query('UPDATE productos SET inventario = inventario + ? WHERE id_producto = ?', [cant, detalle.id_producto]);
    await conn.query('UPDATE ventas SET total_venta = GREATEST(0, total_venta - ?) WHERE id_venta = ?', [montoReembolso, detalle.id_venta]);

    await conn.commit();
    conn.release();
    const stock_updates = await broadcastStockForProducts([detalle.id_producto]);
    return res.json({ ok: true, monto_reembolsado: montoReembolso, stock_updates });
  } catch (e) {
    if (conn) { try { await conn.rollback(); conn.release(); } catch (_) {} }
    console.error('Error registrando devolución:', e.message || e);
    return res.status(500).json({ ok: false, error: 'Error del servidor al registrar devolución' });
  }
});


// ==================== COMPRAS (ADMIN) ====================
// POST /api/compras: Registrar una compra (talla opcional)
app.post('/api/compras', requiereRol('administrador'), async (req, res) => {
  const { id_proveedor, fecha_compra, estado_pago, total_compra, items, numero_factura, fecha_emision, monto_pagado: montoPagadoBody } = req.body;
  if (!id_proveedor || !fecha_compra || !estado_pago || !total_compra || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ ok: false, error: 'Datos incompletos para registrar la compra.' });
  }
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const montoTotal = Number(total_compra) || 0;
    const estadoNorm = String(estado_pago || '').toUpperCase();
    let montoPagado = Number(montoPagadoBody);
    if (!Number.isFinite(montoPagado) || montoPagado < 0) montoPagado = 0;

    if (estadoNorm === 'PAGADA') {
      montoPagado = montoTotal;
    } else if (estadoNorm === 'PARCIAL') {
      if (!(montoPagado > 0 && montoPagado < montoTotal)) {
        await conn.rollback();
        conn.release();
        return res.status(400).json({
          ok: false,
          error: 'En estado Parcial el abono debe ser mayor a 0 y menor que el total de la compra.'
        });
      }
    } else {
      // Pendiente u otro: sin abono inicial
      montoPagado = 0;
    }

    const montoPendiente = Math.max(0, montoTotal - montoPagado);
    // Guardar en compras con formato legible (coincide con el select del admin)
    const estadoCompra =
      montoPendiente <= 0 ? 'Pagada' :
      (montoPagado > 0 ? 'Parcial' : 'Pendiente');

    // 1. Insertar compra principal
    const [compraRes] = await conn.query(
      'INSERT INTO compras (id_proveedor, fecha_compra, total_compra, estado_pago) VALUES (?, ?, ?, ?)',
      [id_proveedor, fecha_compra, montoTotal, estadoCompra]
    );
    const id_compra = compraRes.insertId;

    // 2. Insertar items en detallecompra (talla opcional)
    for (const item of items) {
      const { idProducto, idTalla, cantidad, costo } = item;
      if (!idProducto || !cantidad || !costo) {
        await conn.rollback();
        conn.release();
        return res.status(400).json({ ok: false, error: 'Cada item debe tener producto, cantidad y costo.' });
      }

      // Insertar detalle de compra SIN campo id_talla (la tabla detallecompra ya no debe contener id_talla)
      await conn.query(
        'INSERT INTO detallecompra (id_compra, id_producto, cantidad, costo_unitario) VALUES (?, ?, ?, ?)',
        [id_compra, idProducto, cantidad, costo]
      );

      // Actualizar inventario: si el item especifica idTalla actualizamos inventario por talla,
      // si no, actualizamos el inventario total del producto
      if (idTalla) {
        // Si existe registro, sumar; si no, crear
        const [invRows] = await conn.query('SELECT cantidad FROM inventario WHERE id_producto = ? AND id_talla = ? LIMIT 1', [idProducto, idTalla]);
        if (invRows.length > 0) {
          await conn.query('UPDATE inventario SET cantidad = cantidad + ? WHERE id_producto = ? AND id_talla = ?', [cantidad, idProducto, idTalla]);
        } else {
          await conn.query('INSERT INTO inventario (id_producto, id_talla, cantidad) VALUES (?, ?, ?)', [idProducto, idTalla, cantidad]);
        }
        // También ajustar inventario total si existe la columna
        await conn.query('UPDATE productos SET inventario = inventario + ? WHERE id_producto = ?', [cantidad, idProducto]);
      } else {
        // Sumar a inventario total del producto (columna inventario)
        await conn.query('UPDATE productos SET inventario = inventario + ? WHERE id_producto = ?', [cantidad, idProducto]);
      }
    }

    // 3. Cuenta por pagar si la compra queda pendiente o parcial (o pagada con registro CxP opcional)
    // Pendiente/Parcial: siempre CxP. Si viene abono inicial (Parcial), se registra el pago.
    if (['PENDIENTE', 'PARCIAL'].includes(estadoNorm) && await tableExists(pool, 'cuentas_por_pagar')) {
      const estadoCxP =
        montoPendiente <= 0 ? 'PAGADA' :
        (montoPagado > 0 ? 'PARCIAL' : 'PENDIENTE');
      const baseFecha = fecha_emision || fecha_compra;
      const fv = new Date(baseFecha);
      if (!Number.isNaN(fv.getTime())) fv.setDate(fv.getDate() + 30);
      else fv.setTime(Date.now() + 30 * 86400000);
      const fechaVenc = fv.toISOString().slice(0, 10);
      const hasFactura = await columnExists(pool, 'cuentas_por_pagar', 'numero_factura');
      const hasEmision = await columnExists(pool, 'cuentas_por_pagar', 'fecha_emision');
      const cols = ['id_proveedor', 'id_compra', 'monto_total', 'monto_pagado', 'monto_pendiente', 'fecha_vencimiento', 'estado'];
      const vals = [id_proveedor, id_compra, montoTotal, montoPagado, montoPendiente, fechaVenc, estadoCxP];
      if (hasFactura) { cols.push('numero_factura'); vals.push(numero_factura ? String(numero_factura).trim() : null); }
      if (hasEmision) { cols.push('fecha_emision'); vals.push(fecha_emision || fecha_compra); }
      const [cxpRes] = await conn.query(
        `INSERT INTO cuentas_por_pagar (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        vals
      );
      const idCuenta = cxpRes.insertId;

      // Registrar el abono inicial en el historial de pagos al proveedor
      if (montoPagado > 0 && await tableExists(pool, 'pagos_proveedores')) {
        const uid = req.session && req.session.user ? req.session.user.id : null;
        if (uid) {
          await conn.query(
            `INSERT INTO pagos_proveedores
             (id_cuenta, monto, metodo_pago, referencia, id_usuario, notas)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [idCuenta, montoPagado, 'EFECTIVO', null, uid, 'Abono al registrar la compra']
          );
        } else {
          await conn.query(
            `INSERT INTO pagos_proveedores
             (id_cuenta, monto, metodo_pago, referencia, id_usuario, notas)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [idCuenta, montoPagado, 'EFECTIVO', null, 1, 'Abono al registrar la compra']
          );
        }
      }
    }

    await conn.commit();
    conn.release();
    const productIds = (items || []).map((it) => it.idProducto || it.id_producto).filter(Boolean);
    const stock_updates = await broadcastStockForProducts(productIds);
    res.json({
      ok: true,
      id_compra,
      estado_pago: estadoCompra,
      monto_pagado: montoPagado,
      monto_pendiente: montoPendiente,
      stock_updates
    });
  } catch (e) {
    if (conn) { try { await conn.rollback(); conn.release(); } catch (_) {} }
    console.error('Error registrar compra:', e.message || e);
    res.status(500).json({ ok: false, error: 'Error al registrar compra.' });
  }
});

// GET /api/compras: Listar compras con detalles
app.get('/api/compras', requiereRol('administrador'), async (req, res) => {
  try {
    const [compras] = await pool.query(
      `SELECT c.id_compra, c.fecha_compra, c.total_compra, c.estado_pago, p.nombre AS nombre_proveedor,
              IFNULL(cpp.monto_pagado, CASE WHEN UPPER(c.estado_pago) = 'PAGADA' THEN c.total_compra ELSE 0 END) AS monto_pagado,
              IFNULL(cpp.monto_pendiente, CASE WHEN UPPER(c.estado_pago) = 'PAGADA' THEN 0 ELSE c.total_compra END) AS monto_pendiente
       FROM compras c
       LEFT JOIN proveedores p ON c.id_proveedor = p.id_proveedor
       LEFT JOIN cuentas_por_pagar cpp ON cpp.id_compra = c.id_compra
       ORDER BY c.fecha_compra DESC, c.id_compra DESC LIMIT 100`
    );
    
    // Obtener detalles de cada compra
    for (const compra of compras) {
      const [detalles] = await pool.query(
        `SELECT dc.id_detalle, dc.id_producto, dc.cantidad, dc.costo_unitario, 
                pr.nombre AS nombre_producto, pr.marca
         FROM detallecompra dc
         LEFT JOIN productos pr ON dc.id_producto = pr.id_producto
         WHERE dc.id_compra = ?
         ORDER BY dc.id_detalle`,
        [compra.id_compra]
      );
      compra.detalles = detalles;
    }
    
    res.json({ compras });
  } catch (e) {
    console.error('Error listar compras:', e.message || e);
    res.status(500).json({ compras: [] });
  }
});

// Ruta de diagnóstico temporal: devuelve compras SIN autenticación solo si ALLOW_DEBUG=1
app.get('/__debug/compras-noauth', async (req, res) => {
  try {
    if (process.env.ALLOW_DEBUG !== '1') {
      return res.status(403).json({ ok: false, error: 'Debug no habilitado' });
    }
    const [compras] = await pool.query(
      `SELECT c.id_compra, c.fecha_compra, c.total_compra, c.estado_pago, p.nombre AS nombre_proveedor
       FROM compras c
       LEFT JOIN proveedores p ON c.id_proveedor = p.id_proveedor
       ORDER BY c.fecha_compra DESC, c.id_compra DESC LIMIT 100`
    );

    for (const compra of compras) {
      const [detalles] = await pool.query(
        `SELECT dc.id_detalle, dc.id_producto, dc.cantidad, dc.costo_unitario, pr.nombre AS nombre_producto, pr.marca
         FROM detallecompra dc
         LEFT JOIN productos pr ON dc.id_producto = pr.id_producto
         WHERE dc.id_compra = ?
         ORDER BY dc.id_detalle`,
        [compra.id_compra]
      );
      compra.detalles = detalles;
    }

    return res.json({ compras });
  } catch (e) {
    console.error('Error debug compras:', e.message || e);
    return res.status(500).json({ ok: false, compras: [] });
  }
});


// Endpoint para indicadores del dashboard (ventas del mes, serie por día, rotación básica)
app.get('/api/dashboard/indicadores', requiereRol('administrador'), async (req, res) => {
  try {
    const now = new Date();
    const year = Number(req.query.year) || now.getFullYear();
    const month = Number(req.query.month) || (now.getMonth() + 1);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);
    const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2,'0')}-01 00:00:00`;
    const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2,'0')}-01 00:00:00`;

    // Ventas del mes (total en $)
    const [tot] = await pool.query('SELECT IFNULL(SUM(total_venta),0) AS total_mes FROM ventas WHERE fecha_hora >= ? AND fecha_hora < ?', [startStr, endStr]);
    const ventasMes = tot && tot[0] ? Number(tot[0].total_mes) : 0;

    // Serie diaria para gráfico
    const [porDia] = await pool.query(
      `SELECT DATE(fecha_hora) AS dia, IFNULL(SUM(total_venta),0) AS ingreso_total FROM ventas WHERE fecha_hora >= ? AND fecha_hora < ? GROUP BY DATE(fecha_hora) ORDER BY DATE(fecha_hora) ASC`,
      [startStr, endStr]
    );

    // Comparación con mes anterior
    const prevStart = new Date(year, month - 2, 1);
    const prevEnd = new Date(year, month - 1, 1);
    const prevStartStr = `${prevStart.getFullYear()}-${String(prevStart.getMonth() + 1).padStart(2,'0')}-01 00:00:00`;
    const prevEndStr = `${prevEnd.getFullYear()}-${String(prevEnd.getMonth() + 1).padStart(2,'0')}-01 00:00:00`;
    const [prevTot] = await pool.query('SELECT IFNULL(SUM(total_venta),0) AS total_prev FROM ventas WHERE fecha_hora >= ? AND fecha_hora < ?', [prevStartStr, prevEndStr]);
    const totalPrev = prevTot && prevTot[0] ? Number(prevTot[0].total_prev) : 0;
    const ventasCambio = totalPrev > 0 ? ((ventasMes - totalPrev) / totalPrev) * 100 : (ventasMes > 0 ? 100 : 0);

    // Rotación de inventario básica: unidades vendidas / stock total
    const [unidades] = await pool.query(
      `SELECT IFNULL(SUM(d.cantidad),0) AS unidades_vendidas FROM detalleventa d JOIN ventas v ON d.id_venta = v.id_venta WHERE v.fecha_hora >= ? AND v.fecha_hora < ?`,
      [startStr, endStr]
    );
    const unidadesVendidas = unidades && unidades[0] ? Number(unidades[0].unidades_vendidas) : 0;
    const [stock] = await pool.query('SELECT IFNULL(SUM(inventario),0) AS stock_total FROM productos');
    const stockTotal = stock && stock[0] ? Number(stock[0].stock_total) : 0;
    const rotacionInventario = stockTotal > 0 ? unidadesVendidas / stockTotal : 0;
    // Calcular productos con stock bajo (usa stock_minimo si existe)
    try {
      let stockBajo = 0;
      let alertas = [];
      if (await columnExists(pool, 'productos', 'stock_minimo')) {
        const [low] = await pool.query(
          `SELECT COUNT(*) AS bajo FROM productos WHERE stock_minimo > 0 AND inventario <= stock_minimo`
        );
        stockBajo = (low && low[0]) ? Number(low[0].bajo) : 0;
        const [list] = await pool.query(
          `SELECT id_producto, nombre, marca, inventario, stock_minimo FROM productos
           WHERE stock_minimo > 0 AND inventario <= stock_minimo ORDER BY inventario ASC LIMIT 30`
        );
        alertas = list;
      } else {
        const LOW_STOCK_THRESHOLD = Number(process.env.LOW_STOCK_THRESHOLD) || 5;
        const [low] = await pool.query('SELECT COUNT(*) AS bajo FROM productos WHERE inventario <= ?', [LOW_STOCK_THRESHOLD]);
        stockBajo = (low && low[0]) ? Number(low[0].bajo) : 0;
      }
      res.json({ ventasMes, ventasTemporada: porDia, ventasCambio, rotacionInventario, margenGanancia: 0, stockBajo, stockAlertas: alertas || [] });
    } catch (e) {
      console.warn('No se pudo calcular stockBajo:', e.message || e);
      res.json({ ventasMes, ventasTemporada: porDia, ventasCambio, rotacionInventario, margenGanancia: 0, stockBajo: 0, stockAlertas: [] });
    }
  } catch (e) {
    console.error('Error indicadores dashboard:', e.message || e);
    res.status(500).json({ error: 'Error al calcular indicadores' });
  }
});


// ---------------- Administrador (rutas protegidas) ----------------
// Categorías
app.delete('/api/categorias/:id', requiereRol('administrador'), async (req, res) => {
  const id = req.params.id;
  try {
    // Verificar uso en Productos
    const [cnt] = await pool.query('SELECT COUNT(*) as total FROM productos WHERE id_categoria = ?', [id]);
    const total = (Array.isArray(cnt) && cnt[0]) ? cnt[0].total : (cnt.total || 0);
    if (total > 0) {
      return res.status(400).json({ ok: false, success: false, message: `No se puede eliminar: ${total} producto(s) usan esta categoría` });
    }
    const [delRes] = await pool.query('DELETE FROM categorias WHERE id_categoria = ?', [id]);
    if (delRes.affectedRows > 0) return res.json({ ok: true, success: true });
    return res.status(404).json({ ok: false, success: false, message: 'Categoría no encontrada' });
  } catch (e) {
    console.error('Error eliminar categoria:', e.message);
    res.status(500).json({ ok: false, success: false, message: 'Error del servidor al eliminar categoría' });
  }
});
app.get('/api/categorias', requiereRol('cualquiera'), async (req, res) => {
  try {
  const [rows] = await pool.query('SELECT id_categoria, nombre FROM categorias ORDER BY nombre');
    res.json({ categorias: rows });
  } catch (e) {
    res.status(500).json({ categorias: [] });
  }
});
// Editar categoría (PUT)
app.put('/api/categorias/:id', requiereRol('administrador'), async (req, res) => {
  const id = req.params.id;
  const { nombre } = req.body;
  if (!nombre || nombre.trim() === '') return res.status(400).json({ success: false, message: 'Nombre requerido' });
  try {
  const [result] = await pool.query('UPDATE categorias SET nombre = ? WHERE id_categoria = ?', [nombre.trim(), id]);
    if (result.affectedRows > 0) return res.json({ ok: true, success: true }); // Ajustado para devolver {ok: true, success: true}
    return res.status(404).json({ success: false, message: 'Categoría no encontrada' });
  } catch (e) {
    console.error('Error editar categoria:', e.message);
    return res.status(500).json({ success: false, message: 'Error del servidor' });
  }
});
app.post('/api/categorias', requiereRol('administrador'), async (req, res) => {
  const { nombre } = req.body;
  if (!nombre) return res.json({ ok: false });
  try {
  await pool.query('INSERT INTO categorias (nombre) VALUES (?)', [nombre]);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false });
  }
});

// Proveedores
app.delete('/api/proveedores/:id', requiereRol('administrador'), async (req, res) => {
  const id = req.params.id;
  try {
    // Verificar uso en Productos
    const [cnt] = await pool.query('SELECT COUNT(*) as total FROM productos WHERE id_proveedor = ?', [id]);
    const total = (Array.isArray(cnt) && cnt[0]) ? cnt[0].total : (cnt.total || 0);
    if (total > 0) {
      return res.status(400).json({ ok: false, success: false, message: `No se puede eliminar: ${total} producto(s) usan este proveedor` });
    }
    const [delRes] = await pool.query('DELETE FROM proveedores WHERE id_proveedor = ?', [id]);
    if (delRes.affectedRows > 0) return res.json({ ok: true, success: true });
    return res.status(404).json({ ok: false, success: false, message: 'Proveedor no encontrado' });
  } catch (e) {
    console.error('Error eliminar proveedor:', e.message);
    res.status(500).json({ ok: false, success: false, message: 'Error del servidor al eliminar proveedor' });
  }
});
app.get('/api/proveedores', requiereRol('administrador'), async (req, res) => {
  try {
  const [rows] = await pool.query('SELECT id_proveedor, nombre FROM proveedores ORDER BY nombre');
    res.json({ proveedores: rows });
  } catch (e) {
    res.status(500).json({ proveedores: [] });
  }
});
// Editar proveedor (PUT)
app.put('/api/proveedores/:id', requiereRol('administrador'), async (req, res) => {
  const id = req.params.id;
  const { nombre, contacto, telefono } = req.body;
  if (!nombre || nombre.trim() === '') return res.status(400).json({ success: false, message: 'Nombre requerido' });
  try {
  const [result] = await pool.query('UPDATE proveedores SET nombre = ?, contacto = ?, telefono = ? WHERE id_proveedor = ?', [nombre.trim(), contacto || null, telefono || null, id]);
    if (result.affectedRows > 0) return res.json({ ok: true, success: true }); // Ajustado para devolver {ok: true, success: true}
    return res.status(404).json({ success: false, message: 'Proveedor no encontrado' });
  } catch (e) {
    console.error('Error editar proveedor:', e.message);
    return res.status(500).json({ success: false, message: 'Error del servidor' });
  }
});
app.post('/api/proveedores', requiereRol('administrador'), async (req, res) => {
  const { nombre, contacto, telefono } = req.body;
  if (!nombre) return res.json({ ok: false });
  try {
  await pool.query('INSERT INTO proveedores (nombre, contacto, telefono) VALUES (?, ?, ?)', [nombre, contacto, telefono]);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false });
  }
});

// ------------------ Promociones: CRUD ------------------
app.get('/api/promociones', requiereRol('administrador'), async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id_promocion, nombre, descripcion, tipo_promocion, valor, fecha_inicio, fecha_fin, activa, id_categoria, id_producto, minimo_compra, param_x, param_y FROM promociones ORDER BY fecha_inicio DESC');
    res.json({ ok: true, promociones: rows });
  } catch (e) {
    console.error('Error listar promociones:', e.message || e);
    res.status(500).json({ ok: false, promociones: [] });
  }
});

// Endpoint público: obtener promociones activas (para uso en Caja, solo lectura)
app.get('/api/promociones/activas', requiereRol('cualquiera'), async (req, res) => {
  try {
    const today = new Date();
    const todayStr = today.toISOString().slice(0,10);
    console.log(`[API PROMOCIONES ACTIVAS] Buscando promociones activas para fecha: ${todayStr}`);
    
    // Obtener promociones activas donde la fecha actual esté entre fecha_inicio y fecha_fin
    // Usar CURDATE() para asegurar compatibilidad con MySQL
    const [rows] = await pool.query(
      `SELECT id_promocion, nombre, descripcion, tipo_promocion, valor, fecha_inicio, fecha_fin, activa, id_categoria, id_producto, minimo_compra, param_x, param_y 
       FROM promociones 
       WHERE activa = 1 
       AND CURDATE() >= DATE(fecha_inicio) 
       AND CURDATE() <= DATE(fecha_fin) 
       ORDER BY fecha_inicio DESC`, 
      []
    );
    
    console.log(`[API PROMOCIONES ACTIVAS] Encontradas ${rows.length} promociones activas`);
    if (rows.length > 0) {
      console.log('[API PROMOCIONES ACTIVAS] Detalle:', rows.map(r => ({
        id: r.id_promocion,
        nombre: r.nombre,
        tipo: r.tipo_promocion,
        valor: r.valor,
        categoria: r.id_categoria,
        producto: r.id_producto
      })));
    }
    
    res.json({ ok: true, promociones: rows });
  } catch (e) {
    console.error('[API PROMOCIONES ACTIVAS] Error:', e.message || e);
    res.status(500).json({ ok: false, promociones: [] });
  }
});

app.post('/api/promociones', requiereRol('administrador'), async (req, res) => {
  try {
    const { nombre, descripcion, tipo_promocion, valor, fecha_inicio, fecha_fin, activa, id_categoria, id_producto, minimo_compra, param_x, param_y } = req.body;
    if (!nombre || !tipo_promocion || valor === undefined || !fecha_inicio || !fecha_fin) return res.status(400).json({ ok: false, message: 'Campos requeridos faltantes' });
    await pool.query('INSERT INTO promociones (nombre, descripcion, tipo_promocion, valor, fecha_inicio, fecha_fin, activa, id_categoria, id_producto, minimo_compra, param_x, param_y) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [nombre, descripcion || null, tipo_promocion, valor, fecha_inicio, fecha_fin, activa ? 1 : 0, id_categoria || null, id_producto || null, minimo_compra || 0, param_x || null, param_y || null]);
    res.json({ ok: true });
  } catch (e) {
    console.error('Error crear promocion:', e.message || e);
    res.status(500).json({ ok: false, message: 'Error al crear promoción' });
  }
});

app.put('/api/promociones/:id', requiereRol('administrador'), async (req, res) => {
  try {
    const id = req.params.id;
    const { nombre, descripcion, tipo_promocion, valor, fecha_inicio, fecha_fin, activa, id_categoria, id_producto, minimo_compra, param_x, param_y } = req.body;
    const [result] = await pool.query('UPDATE promociones SET nombre = ?, descripcion = ?, tipo_promocion = ?, valor = ?, fecha_inicio = ?, fecha_fin = ?, activa = ?, id_categoria = ?, id_producto = ?, minimo_compra = ?, param_x = ?, param_y = ? WHERE id_promocion = ?', [nombre, descripcion || null, tipo_promocion, valor, fecha_inicio, fecha_fin, activa ? 1 : 0, id_categoria || null, id_producto || null, minimo_compra || 0, param_x || null, param_y || null, id]);
    if (result.affectedRows > 0) return res.json({ ok: true });
    return res.status(404).json({ ok: false, message: 'Promoción no encontrada' });
  } catch (e) {
    console.error('Error actualizar promocion:', e.message || e);
    res.status(500).json({ ok: false, message: 'Error al actualizar promoción' });
  }
});

app.delete('/api/promociones/:id', requiereRol('administrador'), async (req, res) => {
  try {
    const id = req.params.id;
    const [result] = await pool.query('DELETE FROM promociones WHERE id_promocion = ?', [id]);
    if (result.affectedRows > 0) return res.json({ ok: true });
    return res.status(404).json({ ok: false, message: 'Promoción no encontrada' });
  } catch (e) {
    console.error('Error eliminar promocion:', e.message || e);
    res.status(500).json({ ok: false, message: 'Error al eliminar promoción' });
  }
});

// Tallas
app.get('/api/tallas', requiereRol('administrador'), async (req, res) => {
  try {
  const [rows] = await pool.query('SELECT id_talla, nombre FROM tallas ORDER BY nombre');
    res.json({ tallas: rows });
  } catch (e) {
    res.status(500).json({ tallas: [] });
  }
});
app.post('/api/tallas', requiereRol('administrador'), async (req, res) => {
  const { nombre } = req.body;
  if (!nombre) return res.json({ ok: false });
  try {
  await pool.query('INSERT INTO tallas (nombre) VALUES (?)', [nombre]);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false });
  }
});
// Editar talla (PUT)
app.put('/api/tallas/:id', requiereRol('administrador'), async (req, res) => {
  const id = req.params.id;
  const { nombre, ajuste, pecho, cintura, cadera, largo } = req.body;
  if (!nombre || !ajuste) return res.status(400).json({ success: false, message: 'Nombre y ajuste requeridos' });
  try {
  const [result] = await pool.query('UPDATE tallas SET nombre = ?, ajuste = ?, pecho = ?, cintura = ?, cadera = ?, largo = ? WHERE id_talla = ?', [nombre, ajuste, pecho || null, cintura || null, cadera || null, largo || null, id]);
    if (result.affectedRows > 0) return res.json({ ok: true, success: true }); // Ajustado para devolver {ok: true, success: true}
    return res.status(404).json({ success: false, message: 'Talla no encontrada' });
  } catch (e) {
    console.error('Error editar talla:', e.message);
    return res.status(500).json({ success: false, message: 'Error del servidor' });
  }
});
app.delete('/api/tallas/:id', requiereRol('administrador'), async (req, res) => {
  const id = req.params.id;
  try {
    // Verificar uso en inventario
    const [cnt] = await pool.query('SELECT COUNT(*) as total FROM inventario WHERE id_talla = ?', [id]);
    const total = (Array.isArray(cnt) && cnt[0]) ? cnt[0].total : (cnt.total || 0);
    if (total > 0) {
      return res.status(400).json({ ok: false, success: false, message: `No se puede eliminar: ${total} registro(s) en inventario usan esta talla` });
    }
    const [delRes] = await pool.query('DELETE FROM tallas WHERE id_talla = ?', [id]);
    if (delRes.affectedRows > 0) return res.json({ ok: true, success: true });
    return res.status(404).json({ ok: false, success: false, message: 'Talla no encontrada' });
  } catch (e) {
    console.error('Error eliminar talla:', e.message);
    res.status(500).json({ ok: false, success: false, message: 'Error del servidor al eliminar talla' });
  }
});

// Endpoint genérico para validar eliminación (usado por el front-end)
app.get('/api/:tipo/validar-eliminacion/:id', requiereRol('administrador'), async (req, res) => {
  const tipo = req.params.tipo;
  const id = req.params.id;
  try {
    let query;
    switch (tipo) {
      case 'categorias':
        query = 'SELECT COUNT(*) as total FROM productos WHERE id_categoria = ?';
        break;
      case 'tallas':
        query = 'SELECT COUNT(*) as total FROM inventario WHERE id_talla = ?';
        break;
      case 'proveedores':
        query = 'SELECT COUNT(*) as total FROM productos WHERE id_proveedor = ?';
        break;
      default:
        return res.status(400).json({ puedeEliminar: false, message: 'Tipo no válido' });
    }
    const [cnt] = await pool.query(query, [id]);
    const total = (Array.isArray(cnt) && cnt[0]) ? cnt[0].total : (cnt.total || 0);
    if (total > 0) {
      return res.json({ puedeEliminar: false, message: `No se puede eliminar: ${total} producto(s) usan este elemento`, total });
    }
    return res.json({ puedeEliminar: true, message: 'El elemento no está en uso', total: 0 });
  } catch (e) {
    console.error('Error validar-eliminacion:', e.message);
    return res.status(500).json({ puedeEliminar: false, message: 'Error del servidor al validar eliminación' });
  }
});

// Comprobar si una imagen ya está asignada a otro producto (antes de guardar)
function multerImageError(err) {
  if (!err) return 'Error al subir imagen';
  const code = err.code || '';
  if (code === 'EPERM' || code === 'EACCES' || /EPERM|EACCES|permission/i.test(String(err.message || ''))) {
    return 'No se pudo guardar la imagen (permiso denegado). Reinicia MAX; las fotos se guardan en AppData\\MAX\\uploads.';
  }
  return err.message || 'Error al subir imagen';
}

app.post('/api/productos/check-imagen', requiereRol('administrador'), (req, res, next) => {
  upload.single('imagen')(req, res, (err) => {
    if (err) return res.status(400).json({ ok: false, error: multerImageError(err) });
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'No se recibió imagen' });
    }
    const excludeId = req.body && (req.body.exclude_id || req.body.id_producto);
    const dup = await findDuplicateImageProduct(req.file.path, pool, excludeId || null);
    safeUnlink(req.file.path);
    if (dup) {
      const label = `${dup.marca ? dup.marca + ' - ' : ''}${dup.nombre}`.trim();
      return res.json({
        ok: true,
        duplicada: true,
        id_producto: dup.id_producto,
        nombre: dup.nombre,
        marca: dup.marca,
        mensaje: `Esa imagen ya está en el producto "${label}" (ID ${dup.id_producto})`
      });
    }
    return res.json({ ok: true, duplicada: false });
  } catch (e) {
    if (req.file) safeUnlink(req.file.path);
    console.error('[CHECK IMAGEN]', e);
    return res.status(500).json({ ok: false, error: 'No se pudo verificar la imagen' });
  }
});

// Registro de productos: si ya existe (mismo nombre+marca+categoría),
// suma stock, actualiza precio base y no exige imagen.
app.post('/api/productos', requiereRol('administrador'), (req, res, next) => {
  upload.single('imagen')(req, res, (err) => {
    if (err) return res.status(400).json({ ok: false, error: multerImageError(err) });
    next();
  });
}, async (req, res) => {
  // Soporta JSON y multipart/form-data
  let body = req.body || {};
  if (typeof body.cantidades === 'string') {
    try { body.cantidades = JSON.parse(body.cantidades); } catch (_) { body.cantidades = []; }
  }
  const marca = (body.marca && String(body.marca).trim()) || 'Genérico';
  const categoria = body.categoria || body.id_categoria;
  const proveedor = body.proveedor || body.id_proveedor;
  const nombre = body.nombre != null ? String(body.nombre).trim() : '';
  const precio = body.precio != null ? body.precio : body.precio_venta;
  const inventario = body.inventario;
  const cantidades = body.cantidades;
  const codigo_barras = (body.codigo_barras && String(body.codigo_barras).trim()) || null;
  const stock_minimo = Number(body.stock_minimo) || 0;
  const precio_costo = body.precio_costo != null && body.precio_costo !== '' ? Number(body.precio_costo) : null;
  const ruta_imagen = req.file ? publicImagePath(req.file.filename) : (body.ruta_imagen || null);
  const unidad_medida = (body.unidad_medida || 'UNIDAD').toUpperCase();
  const unidades_por_empaque = (unidad_medida === 'CAJA' || unidad_medida === 'PAQUETE')
    ? (body.unidades_por_empaque != null && body.unidades_por_empaque !== '' ? Number(body.unidades_por_empaque) : null)
    : null;
  // tallas opcionales: solo si el front envía cantidades por talla
  const usa_tallas = Array.isArray(cantidades) && cantidades.some(t => Number(t.cantidad) > 0) ? 1 : 0;

  try {
    if (!nombre || !categoria || precio == null || precio === '' || Number.isNaN(Number(precio))) {
      if (req.file) safeUnlink(req.file.path);
      return res.status(400).json({ ok: false, error: 'Completa nombre, categoría y precio', message: 'Completa nombre, categoría y precio' });
    }

    const hasImgCol = await columnExists(pool, 'productos', 'ruta_imagen');
    const hasBarcode = await columnExists(pool, 'productos', 'codigo_barras');
    const hasStockMin = await columnExists(pool, 'productos', 'stock_minimo');
    const hasCosto = await columnExists(pool, 'productos', 'precio_costo');
    const hasUnidad = await columnExists(pool, 'productos', 'unidad_medida');
    const hasUsaTallas = await columnExists(pool, 'productos', 'usa_tallas');
    const hasEmpaque = await columnExists(pool, 'productos', 'unidades_por_empaque');

    if ((unidad_medida === 'CAJA' || unidad_medida === 'PAQUETE') && !(unidades_por_empaque > 0)) {
      if (req.file) safeUnlink(req.file.path);
      return res.status(400).json({
        ok: false,
        error: unidad_medida === 'PAQUETE'
          ? 'Debes indicar cuántas unidades trae cada paquete'
          : 'Debes indicar cuántas unidades trae cada caja'
      });
    }

    const totalInventario = Number(inventario) || 0;
    let sumaTallas = 0;
    if (Array.isArray(cantidades)) {
      for (const t of cantidades) {
        sumaTallas += Number(t.cantidad) || 0;
      }
    }

    // ¿Ya existe el mismo producto? (nombre + marca + categoría)
    const [productosExistentes] = await pool.query(
      `SELECT id_producto, inventario
       FROM productos
       WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(?))
         AND LOWER(TRIM(COALESCE(marca, ''))) = LOWER(TRIM(?))
         AND id_categoria = ?
         AND NOT (nombre = 'Producto eliminado' AND marca = '-')
       LIMIT 1`,
      [nombre, marca, categoria]
    );

    // Imagen duplicada (mismo archivo que otro producto)
    if (req.file) {
      const excludeId = productosExistentes.length > 0 ? productosExistentes[0].id_producto : null;
      const dup = await findDuplicateImageProduct(req.file.path, pool, excludeId);
      if (dup) {
        safeUnlink(req.file.path);
        const label = `${dup.marca ? dup.marca + ' - ' : ''}${dup.nombre}`.trim();
        return res.status(409).json({
          ok: false,
          error: `Esa imagen ya está en el producto "${label}" (ID ${dup.id_producto})`,
          message: `Esa imagen ya está en el producto "${label}" (ID ${dup.id_producto})`,
          imagen_duplicada: true,
          id_producto_existente: dup.id_producto
        });
      }
    }

    if (productosExistentes.length > 0) {
      const id_producto = productosExistentes[0].id_producto;
      const sets = ['inventario = inventario + ?', 'precio_venta = ?'];
      const vals = [totalInventario, Number(precio)];

      if (proveedor !== undefined && proveedor !== '') {
        sets.push('id_proveedor = ?');
        vals.push(proveedor);
      }
      if (ruta_imagen && hasImgCol) {
        sets.push('ruta_imagen = ?');
        vals.push(ruta_imagen);
      }
      if (hasBarcode && codigo_barras) {
        sets.push('codigo_barras = ?');
        vals.push(codigo_barras);
      }
      if (hasStockMin) {
        sets.push('stock_minimo = ?');
        vals.push(stock_minimo);
      }
      if (hasCosto && precio_costo != null && !Number.isNaN(precio_costo)) {
        sets.push('precio_costo = ?');
        vals.push(precio_costo);
      }
      if (hasUnidad) {
        sets.push('unidad_medida = ?');
        vals.push(unidad_medida);
      }
      if (hasEmpaque) {
        sets.push('unidades_por_empaque = ?');
        vals.push(unidades_por_empaque);
      }
      if (hasUsaTallas && usa_tallas) {
        sets.push('usa_tallas = ?');
        vals.push(1);
      }

      vals.push(id_producto);
      await pool.query(`UPDATE productos SET ${sets.join(', ')} WHERE id_producto = ?`, vals);

      if (Array.isArray(cantidades) && usa_tallas) {
        for (const t of cantidades) {
          const id_talla = Number(t.id_talla);
          const cantidad = Number(t.cantidad) || 0;
          if (cantidad > 0) {
            const [invExistente] = await pool.query(
              'SELECT cantidad FROM inventario WHERE id_producto = ? AND id_talla = ? LIMIT 1',
              [id_producto, id_talla]
            );
            if (invExistente.length > 0) {
              await pool.query(
                'UPDATE inventario SET cantidad = cantidad + ? WHERE id_producto = ? AND id_talla = ?',
                [cantidad, id_producto, id_talla]
              );
            } else {
              await pool.query(
                'INSERT INTO inventario (id_producto, id_talla, cantidad) VALUES (?, ?, ?)',
                [id_producto, id_talla, cantidad]
              );
            }
          }
        }
      }

      const stock_updates = await broadcastStockForProducts([id_producto]);
      return res.json({
        ok: true,
        id_producto,
        actualizado: true,
        message: 'Producto ya existía: se sumó el stock y se actualizó el precio base',
        ruta_imagen: ruta_imagen || null,
        stock_updates
      });
    }

    // Producto nuevo → imagen obligatoria
    if (hasImgCol && !ruta_imagen) {
      return res.status(400).json({
        ok: false,
        error: 'La imagen del producto es obligatoria',
        message: 'Debes subir una imagen del producto (solo en productos nuevos)'
      });
    }

    if (usa_tallas && sumaTallas > totalInventario && totalInventario > 0) {
      return res.status(400).json({ ok: false, message: `La suma de las cantidades por talla (${sumaTallas}) excede el inventario total (${totalInventario}). Ajusta los valores.` });
    }

    // INSERT dinámico según columnas disponibles
    const fields = ['nombre', 'marca', 'precio_venta', 'inventario', 'id_categoria', 'id_proveedor'];
    const values = [nombre, marca || 'Genérico', precio, inventario, categoria, proveedor || null];
    if (hasBarcode) { fields.push('codigo_barras'); values.push(codigo_barras); }
    if (hasCosto) { fields.push('precio_costo'); values.push(precio_costo); }
    if (hasStockMin) { fields.push('stock_minimo'); values.push(stock_minimo); }
    if (hasImgCol) { fields.push('ruta_imagen'); values.push(ruta_imagen); }
    if (hasUnidad) { fields.push('unidad_medida'); values.push(unidad_medida); }
    if (hasEmpaque) { fields.push('unidades_por_empaque'); values.push(unidades_por_empaque); }
    if (hasUsaTallas) { fields.push('usa_tallas'); values.push(usa_tallas); }

    const placeholders = fields.map(() => '?').join(', ');
    const [prodResult] = await pool.query(
      `INSERT INTO productos (${fields.join(', ')}) VALUES (${placeholders})`,
      values
    );
    const id_producto = prodResult.insertId;

    if (Array.isArray(cantidades) && usa_tallas) {
      for (const t of cantidades) {
        const id_talla = Number(t.id_talla);
        const cantidad = Number(t.cantidad) || 0;
        if (cantidad > 0) {
          await pool.query(
            'INSERT INTO inventario (id_producto, id_talla, cantidad) VALUES (?, ?, ?)',
            [id_producto, id_talla, cantidad]
          );
        }
      }
    }

    const stock_updates = await broadcastStockForProducts([id_producto]);
    res.json({ ok: true, id_producto, actualizado: false, message: 'Producto nuevo creado correctamente', ruta_imagen, unidad_medida, unidades_por_empaque, stock_updates });
  } catch (e) {
    if (req.file) safeUnlink(req.file.path);
    console.error('[REGISTRO PRODUCTO] Error:', e);
    if (e && (e.code === 'ER_DUP_ENTRY' || /Duplicate entry/i.test(String(e.message || '')))) {
      return res.status(409).json({
        ok: false,
        error: 'Ese código de barras ya está registrado en otro producto',
        message: 'Ese código de barras ya está registrado en otro producto'
      });
    }
    res.status(500).json({ ok: false, error: 'Error al registrar producto', message: e.message });
  }
});

// Listar productos (GET)
// Obtener producto por ID (GET) - Incluye tallas con cantidades
app.get('/api/admin/productos/:id', requiereRol('administrador'), async (req, res) => {
  const id = req.params.id;
  try {
    // Obtener información del producto (columnas comerciales si existen)
    const hasImg = await columnExists(pool, 'productos', 'ruta_imagen');
    const hasBarcode = await columnExists(pool, 'productos', 'codigo_barras');
    const hasStockMin = await columnExists(pool, 'productos', 'stock_minimo');
    const hasCosto = await columnExists(pool, 'productos', 'precio_costo');
    const hasUnidad = await columnExists(pool, 'productos', 'unidad_medida');
    const hasUsaTallas = await columnExists(pool, 'productos', 'usa_tallas');
    const extra = [
      hasImg ? 'ruta_imagen' : null,
      hasBarcode ? 'codigo_barras' : null,
      hasStockMin ? 'stock_minimo' : null,
      hasCosto ? 'precio_costo' : null,
      hasUnidad ? 'unidad_medida' : null,
      hasUsaTallas ? 'usa_tallas' : null,
      (await columnExists(pool, 'productos', 'unidades_por_empaque')) ? 'unidades_por_empaque' : null
    ].filter(Boolean).map(c => `, ${c}`).join('');
    const [rows] = await pool.query(
      `SELECT id_producto, nombre, marca, inventario, precio_venta, id_categoria, id_proveedor${extra} FROM productos WHERE id_producto = ?`,
      [id]
    );
    
    if (rows.length === 0) {
      return res.json({ producto: null });
    }
    
    const producto = rows[0];
    
    // Obtener tallas con cantidades del inventario
    const [inventarioRows] = await pool.query(
      'SELECT i.id_talla, t.nombre as nombre_talla, i.cantidad FROM inventario i INNER JOIN tallas t ON i.id_talla = t.id_talla WHERE i.id_producto = ? ORDER BY t.nombre',
      [id]
    );
    
    // Agregar tallas al producto
    producto.tallas = inventarioRows.map(row => ({
      id_talla: row.id_talla,
      nombre: row.nombre_talla,
      cantidad: row.cantidad
    }));
    
    res.json({ producto });
  } catch (e) {
    console.error('[GET PRODUCTO] Error:', e);
    res.json({ producto: null });
  }
});
// Editar producto (PUT) - Actualiza producto y maneja tallas sumando cantidades
app.put('/api/admin/productos/:id', requiereRol('administrador'), (req, res, next) => {
  upload.single('imagen')(req, res, (err) => {
    if (err) return res.status(400).json({ ok: false, message: multerImageError(err) });
    next();
  });
}, async (req, res) => {
  const id = req.params.id;
  let body = req.body || {};
  if (typeof body.cantidades === 'string') {
    try { body.cantidades = JSON.parse(body.cantidades); } catch (_) { body.cantidades = []; }
  }
  const { marca, nombre, inventario_adicional, precio, id_categoria, id_proveedor, cantidades, codigo_barras, stock_minimo, precio_costo, unidad_medida, unidades_por_empaque } = body;
  let conn;
  
  try {
    console.log(`[EDITAR PRODUCTO] Iniciando edición del producto ${id}`);
    
    conn = await pool.getConnection();
    await conn.beginTransaction();
    
    // 1. Actualizar datos básicos del producto
    await conn.query(
      'UPDATE productos SET marca = ?, nombre = ?, precio_venta = ?, id_categoria = ?, id_proveedor = ? WHERE id_producto = ?',
      [marca, nombre, precio, id_categoria, id_proveedor, id]
    );

    if (await columnExists(pool, 'productos', 'codigo_barras') && codigo_barras !== undefined) {
      const bc = (codigo_barras && String(codigo_barras).trim()) || null;
      await conn.query('UPDATE productos SET codigo_barras = ? WHERE id_producto = ?', [bc, id]);
    }
    if (await columnExists(pool, 'productos', 'stock_minimo') && stock_minimo !== undefined) {
      await conn.query('UPDATE productos SET stock_minimo = ? WHERE id_producto = ?', [Number(stock_minimo) || 0, id]);
    }
    if (await columnExists(pool, 'productos', 'precio_costo') && precio_costo !== undefined && precio_costo !== '') {
      await conn.query('UPDATE productos SET precio_costo = ? WHERE id_producto = ?', [Number(precio_costo), id]);
    }
    if (req.file && await columnExists(pool, 'productos', 'ruta_imagen')) {
      const dup = await findDuplicateImageProduct(req.file.path, pool, id);
      if (dup) {
        safeUnlink(req.file.path);
        await conn.rollback();
        conn.release();
        const label = `${dup.marca ? dup.marca + ' - ' : ''}${dup.nombre}`.trim();
        return res.status(409).json({
          ok: false,
          message: `Esa imagen ya está en el producto "${label}" (ID ${dup.id_producto})`,
          error: `Esa imagen ya está en el producto "${label}" (ID ${dup.id_producto})`,
          imagen_duplicada: true
        });
      }
      await conn.query('UPDATE productos SET ruta_imagen = ? WHERE id_producto = ?', [publicImagePath(req.file.filename), id]);
    }
    if (await columnExists(pool, 'productos', 'unidad_medida') && unidad_medida) {
      const u = String(unidad_medida).toUpperCase();
      await conn.query('UPDATE productos SET unidad_medida = ? WHERE id_producto = ?', [u, id]);
      if (await columnExists(pool, 'productos', 'unidades_por_empaque')) {
        let emp = null;
        if (u === 'CAJA' || u === 'PAQUETE') {
          emp = unidades_por_empaque != null && unidades_por_empaque !== '' ? Number(unidades_por_empaque) : null;
          if (!(emp > 0)) {
            await conn.rollback();
            conn.release();
            return res.status(400).json({ ok: false, message: u === 'PAQUETE' ? 'Indica unidades por paquete' : 'Indica unidades por caja' });
          }
        }
        await conn.query('UPDATE productos SET unidades_por_empaque = ? WHERE id_producto = ?', [emp, id]);
      }
    }
    console.log(`[EDITAR PRODUCTO] Datos básicos actualizados`);
    
    // 2. Si se envió inventario_adicional, SUMAR al inventario total (no reemplazar)
    // Aceptar cualquier valor mayor o igual a 0, pero solo sumar si es > 0
    let inventarioAdd = 0;
    if (inventario_adicional !== undefined && inventario_adicional !== null) {
      inventarioAdd = Number(inventario_adicional) || 0;
    }
    
    console.log(`[EDITAR PRODUCTO] Inventario adicional recibido: ${inventario_adicional} (convertido a: ${inventarioAdd})`);
    
    if (inventarioAdd > 0) {
      const [currentInv] = await conn.query('SELECT inventario FROM productos WHERE id_producto = ?', [id]);
      const inventarioActual = Number(currentInv[0].inventario) || 0;
      
      await conn.query(
        'UPDATE productos SET inventario = inventario + ? WHERE id_producto = ?',
        [inventarioAdd, id]
      );
      console.log(`[EDITAR PRODUCTO] ✓ Sumando ${inventarioAdd} unidades al inventario total (${inventarioActual} → ${inventarioActual + inventarioAdd})`);
    } else {
      console.log(`[EDITAR PRODUCTO] ⚠ No se agregó inventario adicional (valor recibido: ${inventario_adicional}, convertido: ${inventarioAdd})`);
    }
    
    // 3. Manejar cantidades por talla: SUMAR si existe, crear si no
    let sumaTotalTallas = 0;
    if (Array.isArray(cantidades) && cantidades.length > 0) {
      console.log(`[EDITAR PRODUCTO] Procesando ${cantidades.length} tallas`);
      
      for (const t of cantidades) {
        const id_talla = Number(t.id_talla);
        const cantidad_adicional = Number(t.cantidad) || 0;
        
        if (cantidad_adicional > 0) {
          sumaTotalTallas += cantidad_adicional;
          
          // Verificar si ya existe registro de inventario para esta talla
          const [invExistente] = await conn.query(
            'SELECT cantidad FROM inventario WHERE id_producto = ? AND id_talla = ? LIMIT 1',
            [id, id_talla]
          );

          if (invExistente.length > 0) {
            // Talla existe: SUMAR cantidad (no reemplazar)
            const cantidadActual = Number(invExistente[0].cantidad) || 0;
            await conn.query(
              'UPDATE inventario SET cantidad = cantidad + ? WHERE id_producto = ? AND id_talla = ?',
              [cantidad_adicional, id, id_talla]
            );
            console.log(`[EDITAR PRODUCTO] ✓ Talla ${id_talla}: sumando ${cantidad_adicional} unidades (${cantidadActual} → ${cantidadActual + cantidad_adicional})`);
          } else {
            // Talla nueva: crear registro
            await conn.query(
              'INSERT INTO inventario (id_producto, id_talla, cantidad) VALUES (?, ?, ?)',
              [id, id_talla, cantidad_adicional]
            );
            console.log(`[EDITAR PRODUCTO] ✓ Nueva talla ${id_talla}: creando con ${cantidad_adicional} unidades`);
          }
        } else {
          console.log(`[EDITAR PRODUCTO] - Talla ${id_talla}: cantidad 0, omitida`);
        }
      }
      
      // Actualizar inventario total sumando todas las cantidades agregadas por tallas
      if (sumaTotalTallas > 0) {
        const [currentInvBefore] = await conn.query('SELECT inventario FROM productos WHERE id_producto = ?', [id]);
        const inventarioAntes = Number(currentInvBefore[0].inventario) || 0;
        
        await conn.query(
          'UPDATE productos SET inventario = inventario + ? WHERE id_producto = ?',
          [sumaTotalTallas, id]
        );
        console.log(`[EDITAR PRODUCTO] ✓ Inventario total actualizado: sumando ${sumaTotalTallas} unidades de tallas (${inventarioAntes} → ${inventarioAntes + sumaTotalTallas})`);
      }
    } else {
      console.log(`[EDITAR PRODUCTO] No se enviaron cantidades por talla o el array está vacío`);
    }
    
    await conn.commit();
    conn.release();
    
    console.log(`[EDITAR PRODUCTO] ✓ Producto ${id} actualizado correctamente`);
    const stock_updates = await broadcastStockForProducts([id]);
    res.json({ ok: true, message: 'Producto actualizado correctamente', inventario_agregado: inventarioAdd, tallas_agregadas: sumaTotalTallas, stock_updates });
  } catch (e) {
    if (req.file) safeUnlink(req.file.path);
    if (conn) {
      try { 
        await conn.rollback(); 
        conn.release(); 
        console.log(`[EDITAR PRODUCTO] ✗ Transacción revertida por error`);
      } catch (_) {}
    }
    console.error('[EDITAR PRODUCTO] ✗ Error:', e);
    if (e && (e.code === 'ER_DUP_ENTRY' || /Duplicate entry/i.test(String(e.message || '')))) {
      return res.status(409).json({
        ok: false,
        message: 'Ese código de barras ya está registrado en otro producto',
        error: 'Ese código de barras ya está registrado en otro producto'
      });
    }
    res.status(500).json({ ok: false, message: 'Error al editar producto', error: e.message });
  }
});
// Eliminar producto (DELETE) - Ajustado para devolver {ok: true, success: true}
app.delete('/api/admin/productos/:id', requiereRol('administrador'), async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ ok: false, success: false, message: 'ID inválido' });
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [prodRows] = await conn.query('SELECT id_producto, nombre, marca FROM productos WHERE id_producto = ? LIMIT 1', [id]);
    if (!prodRows.length) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ ok: false, success: false, message: 'Producto no encontrado' });
    }

    // Placeholder del sistema: guarda el historial de ventas/compras de productos ya borrados
    const esPlaceholder =
      String(prodRows[0].nombre || '') === 'Producto eliminado' &&
      String(prodRows[0].marca || '') === '-';
    if (esPlaceholder) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({
        ok: false,
        success: false,
        message: 'No se puede eliminar este producto: es el registro del sistema "Producto eliminado" que conserva el historial de ventas y compras. Déjalo en la base de datos.'
      });
    }

    // Asegurar producto placeholder para preservar historial
    let placeholderId = null;
    {
      const [ph] = await conn.query("SELECT id_producto FROM productos WHERE nombre = 'Producto eliminado' AND marca = '-' LIMIT 1");
      if (ph && ph.length > 0) {
        placeholderId = Number(ph[0].id_producto);
      } else {
        let catId = 1;
        try {
          const [cats] = await conn.query('SELECT id_categoria FROM categorias ORDER BY id_categoria LIMIT 1');
          if (cats && cats.length > 0) catId = cats[0].id_categoria;
        } catch (_) {}
        const [ins] = await conn.query(
          'INSERT INTO productos (nombre, marca, precio_venta, inventario, id_categoria, id_proveedor) VALUES (?, ?, ?, ?, ?, ?)',
          ['Producto eliminado', '-', 0, 0, catId, null]
        );
        placeholderId = Number(ins.insertId);
      }
    }

    if (placeholderId === id) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({
        ok: false,
        success: false,
        message: 'No se puede eliminar el producto placeholder del sistema.'
      });
    }

    // 1) Reasignar historial de ventas/compras al placeholder
    await conn.query('UPDATE detalleventa SET id_producto = ? WHERE id_producto = ?', [placeholderId, id]);
    await conn.query('UPDATE detallecompra SET id_producto = ? WHERE id_producto = ?', [placeholderId, id]);

    // 2) Liberar tallas referenciadas por ventas históricas, luego borrar inventario y tallas
    const [tallasRows] = await conn.query('SELECT id_talla FROM tallas WHERE id_producto = ?', [id]).catch(() => [[]]);
    const tallaIds = (tallasRows || []).map(t => t.id_talla).filter(Boolean);
    if (tallaIds.length) {
      await conn.query(
        `UPDATE detalleventa SET id_talla = NULL WHERE id_talla IN (${tallaIds.map(() => '?').join(',')})`,
        tallaIds
      );
    }
    await conn.query('DELETE FROM inventario WHERE id_producto = ?', [id]);
    await conn.query('DELETE FROM tallas WHERE id_producto = ?', [id]).catch(() => {});

    // 3) Otras referencias opcionales
    try { await conn.query('UPDATE promociones SET id_producto = NULL WHERE id_producto = ?', [id]); } catch (_) {}
    try { await conn.query('DELETE FROM producto_promocion WHERE id_producto = ?', [id]); } catch (_) {}

    // 4) Eliminar el producto
    const [delRes] = await conn.query('DELETE FROM productos WHERE id_producto = ?', [id]);
    if (delRes.affectedRows === 0) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ ok: false, success: false, message: 'Producto no encontrado' });
    }

    await conn.commit();
    conn.release();
    return res.json({ ok: true, success: true, message: 'Producto eliminado. El historial de ventas/compras se conservó.' });
  } catch (e) {
    if (conn) {
      try { await conn.rollback(); conn.release(); } catch (_) {}
    }
    console.error('Error eliminar producto admin (transaction):', e.message || e);
    return res.status(500).json({
      ok: false,
      success: false,
      message: 'No se pudo eliminar: tiene movimientos ligados. Detalle: ' + (e.message || 'error de base de datos')
    });
  }
});
app.get('/api/admin/productos', requiereRol('administrador'), async (req, res) => {
  const { q } = req.query;
  try {
  const hasImg = await columnExists(pool, 'productos', 'ruta_imagen');
  const hasBarcode = await columnExists(pool, 'productos', 'codigo_barras');
  const hasStockMin = await columnExists(pool, 'productos', 'stock_minimo');
  const hasUnidad = await columnExists(pool, 'productos', 'unidad_medida');
  const hasUsaTallas = await columnExists(pool, 'productos', 'usa_tallas');
  const hasEmpaque = await columnExists(pool, 'productos', 'unidades_por_empaque');
  const extra = [
    hasImg ? ', p.ruta_imagen' : '',
    hasBarcode ? ', p.codigo_barras' : '',
    hasStockMin ? ', p.stock_minimo' : '',
    hasUnidad ? ', p.unidad_medida' : '',
    hasEmpaque ? ', p.unidades_por_empaque' : '',
    hasUsaTallas ? ', p.usa_tallas' : ''
  ].join('');
  let query = `SELECT p.id_producto, p.nombre, p.marca, p.inventario, p.precio_venta, p.id_categoria${extra},
    COALESCE((SELECT AVG(dc.costo_unitario) FROM detallecompra dc WHERE dc.id_producto = p.id_producto), 0) AS costo_promedio
    FROM productos p
    WHERE NOT (p.nombre = 'Producto eliminado' AND p.marca = '-')`;
    let params = [];
    if (q) {
      query += ' AND (p.nombre LIKE ? OR p.marca LIKE ?)';
      params.push(`%${q}%`, `%${q}%`);
    }
    query += ' ORDER BY p.nombre LIMIT 5000';
    const [rows] = await pool.query(query, params);

    // Obtener cantidades por talla para cada producto
    const tallasPorProducto = new Map();
    if (rows.length > 0) {
      const ids = rows.map(prod => prod.id_producto);
      const [tallasRows] = await pool.query(
        `SELECT inventario.id_producto, tallas.nombre AS talla, inventario.cantidad
         FROM inventario
         JOIN tallas ON inventario.id_talla = tallas.id_talla
         WHERE inventario.id_producto IN (${ids.map(() => '?').join(',')})`,
        ids
      );
      for (const talla of tallasRows) {
        if (!tallasPorProducto.has(talla.id_producto)) tallasPorProducto.set(talla.id_producto, []);
        tallasPorProducto.get(talla.id_producto).push(`${talla.talla}=${talla.cantidad}`);
      }
    }
    for (const prod of rows) {
      prod.tallas = (tallasPorProducto.get(prod.id_producto) || []).join(' ');
      const precio = Number(prod.precio_venta || 0);
      const costo = Number(prod.costo_promedio || 0);
      prod.utilidad_unitaria = precio - costo;
      prod.margen_porcentaje = precio > 0 ? ((precio - costo) / precio) * 100 : 0;
    }
    res.json({ productos: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al consultar productos' });
  }
});

// Crear producto (POST)
app.post('/api/admin/productos', requiereRol('administrador'), async (req, res) => {
  const { nombre, descripcion, precio_venta, id_categoria } = req.body;
  // Usamos id_categoria: 1 como valor por defecto/ejemplo
  const final_id_categoria = id_categoria || 1; 
  try {
    const [result] = await pool.query(
      'INSERT INTO productos (nombre, descripcion, precio_venta, id_categoria) VALUES (?, ?, ?, ?)',
      [nombre, descripcion || '', precio_venta, final_id_categoria]
    );
    res.json({ ok: true, id_producto: result.insertId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al crear producto' });
  }
});

app.get('/api/admin/fugas', requiereRol('administrador'), async (req, res) => {
  try {
    await ensureFugaMovimientosTable(pool);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
    const [rows] = await pool.query(
      `SELECT f.id_fuga, f.id_lote, f.tipo, f.producto_nombre, f.codigo_barras, f.cantidad,
              f.talla_nombre, f.precio_unitario, f.monto_total, f.id_venta,
              f.tipo_pago, f.motivo, f.fecha_hora, u.usuario
       FROM fuga_movimientos f
       LEFT JOIN usuarios u ON u.id_usuario = f.id_usuario
       ORDER BY f.fecha_hora DESC, f.id_fuga DESC
       LIMIT ?`,
      [limit]
    );
    const loteIds = [...new Set(rows.map(row => row.id_lote).filter(Boolean))];
    if (loteIds.length) {
      const [loteRows] = await pool.query(
        `SELECT f.id_fuga, f.id_lote, f.tipo, f.producto_nombre, f.codigo_barras, f.cantidad,
                f.talla_nombre, f.precio_unitario, f.monto_total, f.id_venta,
                f.tipo_pago, f.motivo, f.fecha_hora, u.usuario
         FROM fuga_movimientos f
         LEFT JOIN usuarios u ON u.id_usuario = f.id_usuario
         WHERE f.id_lote IN (${loteIds.map(() => '?').join(',')})
         ORDER BY f.fecha_hora DESC, f.id_fuga DESC`,
        loteIds
      );
      const byId = new Map(rows.map(row => [Number(row.id_fuga), row]));
      for (const row of loteRows) byId.set(Number(row.id_fuga), row);
      rows.splice(0, rows.length, ...byId.values());
    }
    res.json({ ok: true, movimientos: rows });
  } catch (e) {
    console.error('Error al consultar movimientos de fuga:', e.message || e);
    res.status(500).json({ ok: false, error: 'No se pudieron cargar los movimientos.' });
  }
});

app.post('/api/admin/fugas', requiereRol('administrador'), async (req, res) => {
  const tipo = String(req.body.tipo || '').trim().toUpperCase();
  const tiposValidos = new Set(['CONSUMO', 'DANIO', 'VENTA_ESPECIAL']);
  if (Array.isArray(req.body.items)) {
    const items = req.body.items.map(item => {
      const value = item && typeof item === 'object' ? item : {};
      return {
        id_producto: Number(value.id_producto),
        id_talla: value.id_talla ? Number(value.id_talla) : null,
        cantidad: Number(value.cantidad),
        precio_unitario: Number(value.precio_unitario ?? req.body.precio_unitario)
      };
    });
    const tipoPago = String(req.body.tipo_pago || '').trim();
    const motivo = String(req.body.motivo || '').trim();
    if (!tiposValidos.has(tipo) || !items.length || items.length > 100) {
      return res.status(400).json({ ok: false, error: 'Agrega entre 1 y 100 productos válidos a la lista.' });
    }
    if (items.some(item =>
      !Number.isInteger(item.id_producto) || item.id_producto <= 0 ||
      (item.id_talla !== null && (!Number.isInteger(item.id_talla) || item.id_talla <= 0)) ||
      !Number.isFinite(item.cantidad) || item.cantidad <= 0 ||
      Math.abs(item.cantidad * 1000000 - Math.round(item.cantidad * 1000000)) > 0.000001
    )) {
      return res.status(400).json({ ok: false, error: 'La lista contiene productos, tallas o cantidades inválidas.' });
    }
    if (motivo.length > 255) {
      return res.status(400).json({ ok: false, error: 'La nota no puede superar 255 caracteres.' });
    }
    if (tipo === 'VENTA_ESPECIAL' && (
      items.some(item => !Number.isFinite(item.precio_unitario) || item.precio_unitario <= 0 ||
        Math.abs(item.precio_unitario * 100 - Math.round(item.precio_unitario * 100)) > 0.000001) ||
      !tipoPago || tipoPago.length > 50
    )) {
      return res.status(400).json({ ok: false, error: 'Indica un precio válido para cada producto y una forma de pago válida.' });
    }

    let batchConn;
    try {
      await ensureFugaMovimientosTable(pool);
      if (items.some(item => Math.abs(item.cantidad * 1000 - Math.round(item.cantidad * 1000)) > 1e-6)) {
        await requireSixDecimalStockSchema(pool, true);
      }
      const idLote = require('crypto').randomUUID();
      const userId = await resolveUserIdForVenta(req);
      const productIds = [...new Set(items.map(item => item.id_producto))];
      const hasBarcode = await columnExists(pool, 'productos', 'codigo_barras');
      const hasUnit = await columnExists(pool, 'productos', 'unidad_medida');
      const barcodeColumn = hasBarcode ? 'codigo_barras' : 'NULL AS codigo_barras';
      const unitColumn = hasUnit ? 'unidad_medida' : "'UNIDAD' AS unidad_medida";

      if (tipo === 'VENTA_ESPECIAL') {
        const [products] = await pool.query(
          `SELECT id_producto, nombre, marca, inventario, ${barcodeColumn}, ${unitColumn}
           FROM productos WHERE id_producto IN (${productIds.map(() => '?').join(',')})`,
          productIds
        );
        const productMap = new Map(products.map(product => [Number(product.id_producto), product]));
        if (productMap.size !== productIds.length) {
          return res.status(404).json({ ok: false, error: 'Uno o más productos de la lista ya no existen.' });
        }
        const [sizes] = await pool.query(
          `SELECT i.id_producto, i.id_talla, t.nombre AS talla_nombre, i.cantidad
           FROM inventario i INNER JOIN tallas t ON t.id_talla = i.id_talla
           WHERE i.id_producto IN (${productIds.map(() => '?').join(',')})`,
          productIds
        );
        const sizesByProduct = new Map();
        for (const size of sizes) {
          const id = Number(size.id_producto);
          if (!sizesByProduct.has(id)) sizesByProduct.set(id, []);
          sizesByProduct.get(id).push(size);
        }
        const productTotals = new Map();
        const sizeTotals = new Map();
        const grouped = new Map();
        for (const item of items) {
          const product = productMap.get(item.id_producto);
          const productSizes = sizesByProduct.get(item.id_producto) || [];
          if (productSizes.length && !item.id_talla) {
            return res.status(400).json({ ok: false, error: `Selecciona una talla para ${product.nombre}.` });
          }
          const selectedSize = item.id_talla
            ? productSizes.find(size => Number(size.id_talla) === item.id_talla)
            : null;
          if (item.id_talla && !selectedSize) {
            return res.status(400).json({ ok: false, error: `La talla no corresponde a ${product.nombre}.` });
          }
          productTotals.set(item.id_producto, (productTotals.get(item.id_producto) || 0) + item.cantidad);
          const sizeKey = `${item.id_producto}:${item.id_talla || 0}`;
          sizeTotals.set(sizeKey, (sizeTotals.get(sizeKey) || 0) + item.cantidad);
          const key = `${sizeKey}:${item.precio_unitario.toFixed(2)}`;
          if (!grouped.has(key)) grouped.set(key, {
            id_producto: item.id_producto,
            id_talla: item.id_talla,
            precio_unitario: item.precio_unitario,
            cantidad: 0
          });
          grouped.get(key).cantidad += item.cantidad;
        }
        for (const [id, quantity] of productTotals) {
          if (Number(productMap.get(id).inventario) < quantity) {
            return res.status(409).json({ ok: false, error: `Existencias insuficientes para ${productMap.get(id).nombre}. Disponible: ${productMap.get(id).inventario}.` });
          }
        }
        for (const [key, quantity] of sizeTotals) {
          const [id, idSize] = key.split(':').map(Number);
          if (!idSize) continue;
          const size = (sizesByProduct.get(id) || []).find(row => Number(row.id_talla) === idSize);
          if (!size || Number(size.cantidad) < quantity) {
            const product = productMap.get(id);
            return res.status(409).json({ ok: false, error: `Existencias insuficientes para ${product.nombre}, talla ${size ? size.talla_nombre : idSize}. Disponible: ${size ? size.cantidad : 0}.` });
          }
        }
        const sale = await procesarVenta(
          [...grouped.values()].map(item => ({
            ...item,
            no_aplicar_promocion: true
          })),
          null,
          tipoPago,
          userId,
          { id_caja: (req.session && req.session.id_caja) || null }
        );
        const totalBase = items.reduce((sum, item) => sum + item.cantidad * item.precio_unitario, 0);
        const idFugas = [];
        for (const item of items) {
          const product = productMap.get(item.id_producto);
          const selectedSize = item.id_talla
            ? (sizesByProduct.get(item.id_producto) || []).find(size => Number(size.id_talla) === item.id_talla)
            : null;
          const [movement] = await pool.query(
            `INSERT INTO fuga_movimientos
              (id_producto, producto_nombre, codigo_barras, tipo, id_lote, cantidad, id_talla,
               talla_nombre, precio_unitario, monto_total, id_venta, tipo_pago, motivo, id_usuario)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              item.id_producto, product.nombre, product.codigo_barras || null, tipo, idLote, item.cantidad,
              item.id_talla, selectedSize ? selectedSize.talla_nombre : null,
              item.precio_unitario, sale.total * item.cantidad * item.precio_unitario / totalBase,
              sale.id_venta, tipoPago, motivo || null, userId
            ]
          );
          idFugas.push(movement.insertId);
        }
        return res.json({
          ok: true,
          id_fugas: idFugas,
          id_lote: idLote,
          id_venta: sale.id_venta,
          total: sale.total,
          stock_updates: sale.stock_updates
        });
      }

      batchConn = await pool.getConnection();
      await batchConn.beginTransaction();
      const idFugas = [];
      for (const item of items) {
        const [products] = await batchConn.query(
          `SELECT id_producto, nombre, inventario, ${barcodeColumn}
           FROM productos WHERE id_producto = ? LIMIT 1 FOR UPDATE`,
          [item.id_producto]
        );
        if (!products.length) throw new Error('Uno o más productos de la lista ya no existen.');
        const product = products[0];
        const [sizes] = await batchConn.query(
          `SELECT i.id_talla, t.nombre AS talla_nombre, i.cantidad
           FROM inventario i INNER JOIN tallas t ON t.id_talla = i.id_talla
           WHERE i.id_producto = ? ORDER BY t.nombre FOR UPDATE`,
          [item.id_producto]
        );
        if (sizes.length && !item.id_talla) throw new Error(`Selecciona una talla para ${product.nombre}.`);
        const selectedSize = item.id_talla
          ? sizes.find(size => Number(size.id_talla) === item.id_talla)
          : null;
        if (item.id_talla && !selectedSize) throw new Error(`La talla no corresponde a ${product.nombre}.`);
        const available = selectedSize ? Number(selectedSize.cantidad) : Number(product.inventario);
        if (!Number.isFinite(available) || available < item.cantidad) {
          throw new Error(`Existencias insuficientes para ${product.nombre}${selectedSize ? `, talla ${selectedSize.talla_nombre}` : ''}. Disponibles: ${Number.isFinite(available) ? available : 0}.`);
        }
        if (item.id_talla) {
          const [sizeUpdate] = await batchConn.query(
            'UPDATE inventario SET cantidad = cantidad - ? WHERE id_producto = ? AND id_talla = ? AND cantidad >= ?',
            [item.cantidad, item.id_producto, item.id_talla, item.cantidad]
          );
          if (!sizeUpdate.affectedRows) throw new Error(`No se pudo descontar la talla de ${product.nombre}.`);
        }
        const [stockUpdate] = await batchConn.query(
          'UPDATE productos SET inventario = inventario - ? WHERE id_producto = ? AND inventario >= ?',
          [item.cantidad, item.id_producto, item.cantidad]
        );
        if (!stockUpdate.affectedRows) throw new Error(`No se pudo descontar el inventario de ${product.nombre}.`);
        const [movement] = await batchConn.query(
          `INSERT INTO fuga_movimientos
            (id_producto, producto_nombre, codigo_barras, tipo, id_lote, cantidad, id_talla,
             talla_nombre, precio_unitario, monto_total, motivo, id_usuario)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
          [
            item.id_producto, product.nombre, product.codigo_barras || null, tipo, idLote, item.cantidad,
            item.id_talla, selectedSize ? selectedSize.talla_nombre : null, motivo || null, userId
          ]
        );
        idFugas.push(movement.insertId);
      }
      await batchConn.commit();
      batchConn.release();
      batchConn = null;
      const stock_updates = await broadcastStockForProducts(productIds);
      return res.json({ ok: true, id_fugas: idFugas, stock_updates });
    } catch (e) {
      if (batchConn) {
        try { await batchConn.rollback(); batchConn.release(); } catch (_) {}
      }
      const status = e.statusCode || (/insuficientes|no existen|selecciona una talla|no corresponde|no se pudo descontar/i.test(e.message || '')
        ? 409
        : 500);
      console.error('Error al registrar lista de fugas:', e.message || e);
      return res.status(status).json({ ok: false, error: e.message || 'No se pudo registrar la lista.' });
    }
  }

  const idProducto = Number(req.body.id_producto);
  const idTalla = req.body.id_talla ? Number(req.body.id_talla) : null;
  const cantidad = Number(req.body.cantidad);
  const precioUnitario = Number(req.body.precio_unitario);
  const tipoPago = String(req.body.tipo_pago || '').trim();
  const motivo = String(req.body.motivo || '').trim();

  if (!tiposValidos.has(tipo) || !Number.isInteger(idProducto) || idProducto <= 0) {
    return res.status(400).json({ ok: false, error: 'Selecciona un tipo de salida y un producto válidos.' });
  }
  if (!Number.isFinite(cantidad) || cantidad <= 0 || Math.abs(cantidad * 1000000 - Math.round(cantidad * 1000000)) > 0.000001) {
    return res.status(400).json({ ok: false, error: 'La cantidad debe ser mayor que cero y usar hasta 6 decimales.' });
  }
  if (idTalla !== null && (!Number.isInteger(idTalla) || idTalla <= 0)) {
    return res.status(400).json({ ok: false, error: 'La talla seleccionada no es válida.' });
  }
  if (motivo.length > 255) {
    return res.status(400).json({ ok: false, error: 'La nota no puede superar 255 caracteres.' });
  }
  if (tipo === 'VENTA_ESPECIAL') {
    if (!Number.isFinite(precioUnitario) || precioUnitario <= 0
      || Math.abs(precioUnitario * 100 - Math.round(precioUnitario * 100)) > 0.000001) {
      return res.status(400).json({ ok: false, error: 'Indica un precio especial mayor que cero, con hasta 2 decimales.' });
    }
    if (!tipoPago || tipoPago.length > 50) {
      return res.status(400).json({ ok: false, error: 'Selecciona una forma de pago válida.' });
    }
  }

  let conn;
  try {
    await ensureFugaMovimientosTable(pool);
    if (Math.abs(cantidad * 1000 - Math.round(cantidad * 1000)) > 1e-6) {
      await requireSixDecimalStockSchema(pool, true);
    }
    const userId = await resolveUserIdForVenta(req);
    const hasBarcode = await columnExists(pool, 'productos', 'codigo_barras');
    const hasUnidad = await columnExists(pool, 'productos', 'unidad_medida');
    const barcodeColumn = hasBarcode ? 'codigo_barras' : 'NULL AS codigo_barras';
    const unitColumn = hasUnidad ? 'unidad_medida' : "'UNIDAD' AS unidad_medida";

    if (tipo === 'VENTA_ESPECIAL') {
      const [products] = await pool.query(
        `SELECT id_producto, nombre, marca, inventario, precio_venta, ${barcodeColumn}, ${unitColumn}
         FROM productos WHERE id_producto = ? LIMIT 1`,
        [idProducto]
      );
      if (!products.length) {
        return res.status(404).json({ ok: false, error: 'Producto no encontrado.' });
      }
      const product = products[0];
      const [sizes] = await pool.query(
        `SELECT i.id_talla, t.nombre AS talla_nombre, i.cantidad
         FROM inventario i
         INNER JOIN tallas t ON t.id_talla = i.id_talla
         WHERE i.id_producto = ? ORDER BY t.nombre`,
        [idProducto]
      );
      if (sizes.length && !idTalla) {
        return res.status(400).json({ ok: false, error: 'Selecciona una talla para este producto.' });
      }
      const selectedSize = idTalla ? sizes.find((size) => Number(size.id_talla) === idTalla) : null;
      if (idTalla && !selectedSize) {
        return res.status(400).json({ ok: false, error: 'La talla no corresponde al producto seleccionado.' });
      }

      const sale = await procesarVenta(
        [{
          id_producto: idProducto,
          id_talla: idTalla,
          cantidad,
          precio_unitario: precioUnitario,
          no_aplicar_promocion: true
        }],
        null,
        tipoPago,
        userId,
        { id_caja: (req.session && req.session.id_caja) || null }
      );
      const [movement] = await pool.query(
        `INSERT INTO fuga_movimientos
          (id_producto, producto_nombre, codigo_barras, tipo, cantidad, id_talla,
           talla_nombre, precio_unitario, monto_total, id_venta, tipo_pago, motivo, id_usuario)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          idProducto, product.nombre, product.codigo_barras || null, tipo, cantidad,
          idTalla, selectedSize ? selectedSize.talla_nombre : null,
          precioUnitario, sale.total, sale.id_venta, tipoPago, motivo || null, userId
        ]
      );
      return res.json({
        ok: true,
        id_fuga: movement.insertId,
        id_venta: sale.id_venta,
        total: sale.total,
        stock_updates: sale.stock_updates
      });
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [products] = await conn.query(
      `SELECT id_producto, nombre, inventario, ${barcodeColumn}, ${unitColumn}
       FROM productos WHERE id_producto = ? LIMIT 1 FOR UPDATE`,
      [idProducto]
    );
    if (!products.length) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ ok: false, error: 'Producto no encontrado.' });
    }
    const product = products[0];
    const [sizes] = await conn.query(
      `SELECT i.id_talla, t.nombre AS talla_nombre, i.cantidad
       FROM inventario i
       INNER JOIN tallas t ON t.id_talla = i.id_talla
       WHERE i.id_producto = ? ORDER BY t.nombre FOR UPDATE`,
      [idProducto]
    );
    if (sizes.length && !idTalla) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ ok: false, error: 'Selecciona una talla para este producto.' });
    }
    const selectedSize = idTalla ? sizes.find((size) => Number(size.id_talla) === idTalla) : null;
    if (idTalla && !selectedSize) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ ok: false, error: 'La talla no corresponde al producto seleccionado.' });
    }
    const available = selectedSize ? Number(selectedSize.cantidad) : Number(product.inventario);
    if (!Number.isFinite(available) || available < cantidad) {
      await conn.rollback();
      conn.release();
      return res.status(409).json({ ok: false, error: `Existencias insuficientes. Disponibles: ${Number.isFinite(available) ? available : 0}.` });
    }
    if (idTalla) {
      const [sizeUpdate] = await conn.query(
        'UPDATE inventario SET cantidad = cantidad - ? WHERE id_producto = ? AND id_talla = ? AND cantidad >= ?',
        [cantidad, idProducto, idTalla, cantidad]
      );
      if (!sizeUpdate.affectedRows) throw new Error('No se pudo descontar la cantidad de la talla seleccionada.');
    }
    const [stockUpdate] = await conn.query(
      'UPDATE productos SET inventario = inventario - ? WHERE id_producto = ? AND inventario >= ?',
      [cantidad, idProducto, cantidad]
    );
    if (!stockUpdate.affectedRows) throw new Error('No se pudo descontar el inventario del producto.');
    const [movement] = await conn.query(
      `INSERT INTO fuga_movimientos
        (id_producto, producto_nombre, codigo_barras, tipo, cantidad, id_talla,
         talla_nombre, precio_unitario, monto_total, motivo, id_usuario)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
      [
        idProducto, product.nombre, product.codigo_barras || null, tipo, cantidad,
        idTalla, selectedSize ? selectedSize.talla_nombre : null, motivo || null, userId
      ]
    );
    await conn.commit();
    conn.release();
    const stock_updates = await broadcastStockForProducts([idProducto]);
    return res.json({ ok: true, id_fuga: movement.insertId, stock_updates });
  } catch (e) {
    if (conn) {
      try { await conn.rollback(); conn.release(); } catch (_) {}
    }
    console.error('Error al registrar movimiento de fuga:', e.message || e);
    return res.status(e.statusCode || 500).json({ ok: false, error: e.message || 'No se pudo registrar la salida.' });
  }
});

// Endpoint administrativo: listar ventas por mes (con detalle y totales diarios)
app.get('/api/admin/ventas', requiereRol('administrador'), async (req, res) => {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();
    const month = Number(req.query.month) || (new Date().getMonth() + 1); // 1-12

    // Rango inicio/fin para el mes
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1); // inicio del siguiente mes

    const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01 00:00:00`;
    const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-01 00:00:00`;

    // Preparar posible filtro por cédula de cliente (req.query.cliente)
    const clienteCedula = req.query.cliente ? String(req.query.cliente).trim() : null;

    // 1) Obtener ventas en el rango (con opcional filtro por cédula)
    let baseWhere = 'v.fecha_hora >= ? AND v.fecha_hora < ?';
    const ventasParams = [startStr, endStr];
    if (clienteCedula) {
      baseWhere += ' AND c.cedula = ?';
      ventasParams.push(clienteCedula);
    }

    const [ventasRows] = await pool.query(
      `SELECT v.id_venta, v.fecha_hora, v.total_venta, v.tipo_pago, u.usuario AS usuario, c.nombre AS cliente, c.cedula AS cliente_cedula
       FROM ventas v
       LEFT JOIN usuarios u ON v.id_usuario = u.id_usuario
       LEFT JOIN clientes c ON v.id_cliente = c.id_cliente
       WHERE ${baseWhere}
       ORDER BY v.fecha_hora DESC
      `,
      ventasParams
    );

    // 2) Obtener detalle para cada venta (optimizable, pero suficiente para volúmenes moderados)
    for (const v of ventasRows) {
      // Evitar referenciar columnas que pueden no existir en esquemas distintos.
      const [det] = await pool.query(
        `SELECT d.id_producto, p.marca, p.nombre AS producto, d.id_talla, t.nombre AS talla, d.cantidad, d.precio_unitario
         FROM detalleventa d
         LEFT JOIN productos p ON d.id_producto = p.id_producto
         LEFT JOIN tallas t ON d.id_talla = t.id_talla
         WHERE d.id_venta = ?`,
        [v.id_venta]
      );
      v.detalle = det;
    }

    // 3) Totales del mes
    // 3) Totales del mes (aplicar mismo filtro por cliente si existe)
    let totQuery = 'SELECT IFNULL(SUM(total_venta),0) AS total_mes, COUNT(*) AS ventas_count FROM ventas v';
    let totParams = [startStr, endStr];
    if (clienteCedula) {
      totQuery += ' LEFT JOIN clientes c ON v.id_cliente = c.id_cliente WHERE v.fecha_hora >= ? AND v.fecha_hora < ? AND c.cedula = ?';
      totParams.push(clienteCedula);
    } else {
      totQuery += ' WHERE v.fecha_hora >= ? AND v.fecha_hora < ?';
    }
    const [tot] = await pool.query(totQuery, totParams);
    const total_mes = (Array.isArray(tot) && tot[0]) ? tot[0].total_mes : (tot.total_mes || 0);

    // 4) Totales por día (para gráficas)
    // 4) Totales por día (aplicar filtro por cliente si existe)
    let porDiaQuery = `SELECT DATE(v.fecha_hora) AS dia, SUM(v.total_venta) AS total, COUNT(*) AS ventas
       FROM ventas v`;
    const porDiaParams = [startStr, endStr];
    if (clienteCedula) {
      porDiaQuery += ' LEFT JOIN clientes c ON v.id_cliente = c.id_cliente WHERE v.fecha_hora >= ? AND v.fecha_hora < ? AND c.cedula = ?';
      porDiaParams.push(clienteCedula);
    } else {
      porDiaQuery += ' WHERE v.fecha_hora >= ? AND v.fecha_hora < ?';
    }
    porDiaQuery += ' GROUP BY DATE(v.fecha_hora) ORDER BY DATE(v.fecha_hora) ASC';
    const [porDia] = await pool.query(porDiaQuery, porDiaParams);

    res.json({ ok: true, ventas: ventasRows, totales: { total_mes: Number(total_mes), count: tot[0] ? tot[0].ventas_count : 0 }, por_dia: porDia, year, month });
  } catch (e) {
    console.error('Error listar ventas admin:', e.message || e);
    res.status(500).json({ ok: false, ventas: [], message: 'Error al consultar ventas' });
  }
});

// Obtener detalle de una venta por ID (administrador)
app.get('/api/admin/ventas/:id', requiereRol('administrador'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, message: 'ID inválido' });
    const [ventasRows] = await pool.query(
      `SELECT v.id_venta, v.fecha_hora, v.total_venta, v.tipo_pago, u.usuario AS usuario, c.nombre AS cliente, c.cedula AS cliente_cedula
       FROM ventas v
       LEFT JOIN usuarios u ON v.id_usuario = u.id_usuario
       LEFT JOIN clientes c ON v.id_cliente = c.id_cliente
       WHERE v.id_venta = ? LIMIT 1`,
      [id]
    );
    if (!ventasRows || ventasRows.length === 0) return res.status(404).json({ ok: false, message: 'Venta no encontrada' });
    const venta = ventasRows[0];
    const [det] = await pool.query(
      `SELECT d.id_detalle, d.id_producto, p.marca, p.nombre AS producto, d.id_talla, t.nombre AS talla, d.cantidad, d.precio_unitario, d.descuento_unitario, d.descuento_total, d.id_promocion_aplicada
       FROM detalleventa d
       LEFT JOIN productos p ON d.id_producto = p.id_producto
       LEFT JOIN tallas t ON d.id_talla = t.id_talla
       WHERE d.id_venta = ?`,
      [id]
    );
    venta.detalle = det || [];
    return res.json({ ok: true, venta });
  } catch (e) {
    console.error('Error obtener venta por id:', e.message || e);
    return res.status(500).json({ ok: false, message: 'Error del servidor' });
  }
});

// Eliminar venta (DELETE) - Reversa inventario y borra detalleventa + venta en transacción
app.delete('/api/admin/ventas/:id', requiereRol('administrador'), async (req, res) => {
  const id = req.params.id;
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    // Verificar existencia de la venta
    const [ventaRows] = await conn.query('SELECT id_venta FROM ventas WHERE id_venta = ?', [id]);
    if (!ventaRows || ventaRows.length === 0) {
      await conn.release();
      return res.status(404).json({ ok: false, message: 'Venta no encontrada' });
    }

    // Obtener detalle de la venta para revertir inventario
    const [detalles] = await conn.query('SELECT id_detalle, id_producto, id_talla, cantidad, precio_unitario, descuento_unitario FROM detalleventa WHERE id_venta = ?', [id]);

    // Borrar devoluciones que referencian a los detalles de esta venta (evita error por FK)
    if (detalles.length > 0) {
      const ids = detalles.map(d => d.id_detalle);
      const placeholders = ids.map(_ => '?').join(',');
      await conn.query(`DELETE FROM devoluciones WHERE id_detalle IN (${placeholders})`, ids);
    }

    for (const d of detalles) {
      const cantidad = Number(d.cantidad || 0);
      if (cantidad <= 0) continue;

      // Si la línea tiene talla, intentar actualizar inventario por talla; si no existe registro, insertarlo
      if (d.id_talla) {
        const [upd] = await conn.query('UPDATE inventario SET cantidad = cantidad + ? WHERE id_producto = ? AND id_talla = ?', [cantidad, d.id_producto, d.id_talla]);
        // Si no se actualizó (no existía), insertamos el registro
        if (!upd || upd.affectedRows === 0) {
          await conn.query('INSERT INTO inventario (id_producto, id_talla, cantidad) VALUES (?, ?, ?)', [d.id_producto, d.id_talla, cantidad]);
        }
      }

      // También revertir inventario total del producto
      await conn.query('UPDATE productos SET inventario = inventario + ? WHERE id_producto = ?', [cantidad, d.id_producto]);
    }

    // Borrar detalle y venta
    await conn.query('DELETE FROM detalleventa WHERE id_venta = ?', [id]);
    const [delRes] = await conn.query('DELETE FROM ventas WHERE id_venta = ?', [id]);
    if (delRes.affectedRows === 0) {
      await conn.rollback();
      await conn.release();
      return res.status(404).json({ ok: false, message: 'Venta no encontrada (al borrar)' });
    }

    await conn.commit();
    await conn.release();
    const pids = (detalles || []).map((d) => d.id_producto).filter(Boolean);
    const stock_updates = await broadcastStockForProducts(pids);
    return res.json({ ok: true, message: 'Venta eliminada y stock revertido', stock_updates });
  } catch (e) {
    if (conn) {
      try { await conn.rollback(); await conn.release(); } catch (_) {}
    }
    console.error('Error eliminar venta admin:', e.message || e);
    return res.status(500).json({ ok: false, message: 'Error del servidor al eliminar venta' });
  }
});

// Endpoint optimizado: listar clientes con resumen de compras (count, total)
app.get('/api/admin/clientes/resumen', requiereRol('administrador'), async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const per_page = Math.max(1, Math.min(500, Number(req.query.per_page) || 100));
    const offset = (page - 1) * per_page;

    // Obtener clientes que tengan al menos una venta, con conteo y total gastado
    const [rows] = await pool.query(
      `SELECT c.id_cliente, c.nombre, c.cedula, c.telefono, c.email,
              COUNT(v.id_venta) AS compras_count, IFNULL(SUM(v.total_venta),0) AS total_gastado, MAX(v.fecha_hora) AS ultima_compra
       FROM clientes c
       JOIN ventas v ON v.id_cliente = c.id_cliente
       GROUP BY c.id_cliente
       HAVING compras_count > 0
       ORDER BY total_gastado DESC
       LIMIT ? OFFSET ?`,
      [per_page, offset]
    );

    // Opcional: contar total de clientes con compras (para paginación)
    const [cntRows] = await pool.query(
      `SELECT COUNT(DISTINCT c.id_cliente) AS total_clients_with_purchases FROM clientes c JOIN ventas v ON v.id_cliente = c.id_cliente`
    );
    const total_clients = (Array.isArray(cntRows) && cntRows[0]) ? Number(cntRows[0].total_clients_with_purchases) : 0;

    res.json({ ok: true, clientes: rows, page, per_page, total_clients });
  } catch (e) {
    console.error('Error listar clientes resumen admin:', e.message || e);
    res.status(500).json({ ok: false, clientes: [], page: 1, per_page: 0, total_clients: 0, message: 'Error del servidor' });
  }
});

// Endpoint administrativo: listar todos los clientes
app.get('/api/admin/clientes', requiereRol('administrador'), async (req, res) => {
  try {
    const busqueda = req.query.busqueda ? String(req.query.busqueda).trim() : null;
    
    let query = `SELECT 
      c.id_cliente,
      c.nombre,
      c.cedula,
      c.telefono,
      c.email,
      COUNT(DISTINCT v.id_venta) AS total_ventas,
      COALESCE(SUM(v.total_venta), 0) AS total_compras
    FROM clientes c
    LEFT JOIN ventas v ON c.id_cliente = v.id_cliente
    WHERE 1=1`;
    
    const params = [];
    if (busqueda) {
      query += ` AND (c.nombre LIKE ? OR c.cedula LIKE ? OR c.email LIKE ?)`;
      const busquedaPattern = `%${busqueda}%`;
      params.push(busquedaPattern, busquedaPattern, busquedaPattern);
    }
    
    query += ` GROUP BY c.id_cliente, c.nombre, c.cedula, c.telefono, c.email
               ORDER BY c.nombre ASC
               LIMIT 500`;
    
    const [clientes] = await pool.query(query, params);
    
    const clientesData = clientes.map(c => ({
      id_cliente: c.id_cliente,
      nombre: c.nombre || 'Sin nombre',
      cedula: c.cedula || 'N/A',
      telefono: c.telefono || 'N/A',
      email: c.email || 'N/A',
      total_ventas: Number(c.total_ventas || 0),
      total_compras: Number(c.total_compras || 0)
    }));
    
    res.json({ ok: true, clientes: clientesData });
  } catch (e) {
    console.error('Error listar clientes admin:', e.message || e);
    res.status(500).json({ ok: false, clientes: [], error: 'Error del servidor' });
  }
});

// Crear cliente (administrador)
app.post('/api/admin/clientes', requiereRol('administrador'), async (req, res) => {
  try {
    const { nombre, cedula, telefono, email } = req.body || {};
    if (!nombre || nombre.trim() === '') return res.status(400).json({ ok: false, message: 'Nombre requerido' });

    // Si se envía cédula y ya existe, devolver ese cliente
    if (cedula) {
      const [exists] = await pool.query('SELECT id_cliente FROM clientes WHERE cedula = ? LIMIT 1', [cedula]);
      if (exists && exists.length > 0) {
        return res.json({ ok: true, id_cliente: exists[0].id_cliente, message: 'Cliente ya existe' });
      }
    }

    const [ins] = await pool.query('INSERT INTO clientes (nombre, cedula, telefono, email) VALUES (?, ?, ?, ?)', [nombre, cedula || null, telefono || null, email || null]);
    return res.json({ ok: true, id_cliente: ins.insertId });
  } catch (e) {
    console.error('Error crear cliente admin:', e.message || e);
    return res.status(500).json({ ok: false, message: 'Error del servidor al crear cliente' });
  }
});

// Endpoint administrativo: obtener ventas (historial) completas de un cliente por cédula
app.get('/api/admin/clientes/ventas', requiereRol('administrador'), async (req, res) => {
  try {
    const cedula = req.query.cedula ? String(req.query.cedula).trim() : null;
    if (!cedula) return res.json({ ok: false, ventas: [], total: 0, count: 0, message: 'Cédula requerida' });

    const [ventasRows] = await pool.query(
      `SELECT v.id_venta, v.fecha_hora, v.total_venta, v.tipo_pago, u.usuario AS usuario
       FROM ventas v
       LEFT JOIN usuarios u ON v.id_usuario = u.id_usuario
       LEFT JOIN clientes c ON v.id_cliente = c.id_cliente
       WHERE c.cedula = ?
       ORDER BY v.fecha_hora DESC`,
      [cedula]
    );

    // Agregar detalle de cada venta
    for (const v of ventasRows) {
      const [det] = await pool.query(
        `SELECT d.id_producto, p.marca, p.nombre AS producto, d.id_talla, t.nombre AS talla, d.cantidad, d.precio_unitario
         FROM detalleventa d
         LEFT JOIN productos p ON d.id_producto = p.id_producto
         LEFT JOIN tallas t ON d.id_talla = t.id_talla
         WHERE d.id_venta = ?`,
        [v.id_venta]
      );
      v.detalle = det;
    }

    const total = ventasRows.reduce((s, v) => s + (Number(v.total_venta) || 0), 0);
    const count = ventasRows.length;
    return res.json({ ok: true, ventas: ventasRows, total, count });
  } catch (e) {
    console.error('Error historial cliente admin:', e.message || e);
    return res.status(500).json({ ok: false, ventas: [], total: 0, count: 0, message: 'Error del servidor' });
  }
});


// ---------------- Caja (rutas protegidas) ----------------
// Buscar cliente por cédula
app.get('/api/clientes/buscar', requiereRol('caja'), async (req, res) => {
  const cedula = req.query.cedula;
  if (!cedula) return res.json({ cliente: null });
  try {
    const hasDir = await columnExists(pool, 'clientes', 'direccion');
    const cols = hasDir
      ? 'id_cliente, nombre, cedula, telefono, direccion, email'
      : 'id_cliente, nombre, cedula, telefono, email';
    const [rows] = await pool.query(`SELECT ${cols} FROM clientes WHERE cedula = ? LIMIT 1`, [cedula]);
    if (rows.length > 0) {
      res.json({ cliente: rows[0] });
    } else {
      res.json({ cliente: null });
    }
  } catch (e) {
    res.json({ cliente: null });
  }
});

// ==================== GESTIÓN DE CLIENTES ====================
// Rol: Administrador
app.get('/api/clientes', requiereRol('administrador'), async (req, res) => {
  try {
    // La tabla `clientes` en la base de datos contiene: id_cliente, nombre, cedula, telefono, email
    // Evitar columnas inexistentes como `apellido` o `direccion` que causan ER_BAD_FIELD_ERROR.
    const [rows] = await pool.query(
      'SELECT id_cliente, nombre, cedula, telefono, email FROM clientes ORDER BY id_cliente DESC'
    );
    res.json({ ok: true, clientes: rows });
  } catch (e) {
    console.error('Error cargando clientes:', e);
    res.status(500).json({ ok: false, error: 'Error interno del servidor.' });
  }
});

app.post('/api/clientes', requiereRol('administrador'), async (req, res) => {
  // Alinear con la estructura real de la tabla `clientes` en la BD.
  const { nombre, cedula, telefono, email } = req.body || {};
  if (!nombre) {
    return res.status(400).json({ ok: false, error: 'Nombre requerido' });
  }
  try {
    const [result] = await pool.query(
      'INSERT INTO clientes (nombre, cedula, telefono, email) VALUES (?, ?, ?, ?)',
      [nombre, cedula || null, telefono || null, email || null]
    );
    res.json({ ok: true, id_cliente: result.insertId });
  } catch (e) {
    console.error('Error creando cliente:', e);
    res.status(500).json({ ok: false, error: 'Error al crear cliente.' });
  }
});

// Implementar PUT y DELETE de forma similar si es necesario.

// Registro de venta simple (AJUSTADO para coincidir con la llamada simple del front-end)
app.post('/api/caja/venta', requiereRol('caja'), async (req, res) => {
  // Si el front envía un arreglo de items, procesamos la venta completa (con promociones)
  if (Array.isArray(req.body.items) && req.body.items.length > 0) {
    try {
      const esCajaMayor = isCajaMayorRequest(req);
      if (esCajaMayor && !(Number(req.session && req.session.id_caja) > 0)) {
        return res.status(403).json({ ok: false, message: 'La sesión no pertenece a una terminal Caja Mayor.' });
      }
      if (esCajaMayor && req.body.items.some((item) => {
        const price = Number(item && item.precio_unitario);
        const quantity = Number(item && item.cantidad);
        const lineTotal = price * quantity;
        return !Number.isFinite(price) || price <= 0
          || Math.abs(price * 100 - Math.round(price * 100)) > 0.000001
          || !Number.isFinite(quantity) || quantity <= 0
          || Math.round(lineTotal * 100) < 1;
      })) {
        return res.status(400).json({
          ok: false,
          message: 'Caja Mayor requiere un precio manual válido y un total de línea equivalente al menos a $0.01 para cada producto.'
        });
      }
      const clienteData = {
        nombre: req.body.cliente_nombre || null,
        cedula: req.body.cliente_cedula || null,
        telefono: req.body.cliente_telefono || null,
        email: req.body.cliente_email || null,
        direccion: req.body.cliente_direccion || null
      };
      const tipo_pago = req.body.tipo_pago || 'Efectivo';
      const id_caja = esCajaMayor
        ? Number(req.session.id_caja)
        : (req.body.id_caja || (req.session && req.session.id_caja) || null);
      const pagos = Array.isArray(req.body.pagos) ? req.body.pagos : [];
      const tasa = Number(req.body.tasa || 0) || null;
      const userId = await resolveUserIdForVenta(req);
      if (req.session && req.session.user) req.session.user.id = userId;
      const items = esCajaMayor
        ? req.body.items.map((item) => Object.assign({}, item, {
            no_aplicar_promocion: true,
            force_promotion_id: null
          }))
        : req.body.items;
      const result = await procesarVenta(items, clienteData, tipo_pago, userId, {
        id_caja,
        pagos,
        tasa
      });
      return res.json(Object.assign({ ok: true }, result));
    } catch (e) {
      console.error('Error procesando venta en caja (items):', e.message || e);
      return res.status(e.statusCode || 500).json({ ok: false, message: e.message || 'Error al procesar venta' });
    }
  }

  return res.status(400).json({ ok: false, message: 'La venta debe incluir al menos un producto.' });
});


// ---------------- Ventas: validar stock y actualizar inventario ----------------
// Ajustar para aceptar id_producto e id_talla (requerido) y decrementar inventario
// (Esta ruta reemplaza la primera ruta fallida /api/ventas que estaba mezclada con la lógica antigua)
app.post('/api/ventas', requiereRol('caja'), async (req, res) => {
  const {
    cliente_nombre, cliente_cedula, cliente_telefono, cliente_email,
    id_producto, id_talla, cantidad, precio_unitario, tipo_pago
  } = req.body;

  // Normalizar items
  let items = Array.isArray(req.body.items) ? req.body.items : [];
  if (items.length === 0 && id_producto) items = [{ id_producto, id_talla, cantidad, precio_unitario }];

  const clienteData = { nombre: cliente_nombre || null, cedula: cliente_cedula || null, telefono: cliente_telefono || null, email: cliente_email || null };
  try {
    const id_caja = req.body.id_caja || (req.session && req.session.id_caja) || null;
    const userId = await resolveUserIdForVenta(req);
    if (req.session && req.session.user) req.session.user.id = userId;
    const result = await procesarVenta(items, clienteData, tipo_pago || 'Efectivo', userId, { id_caja });
    res.json(Object.assign({ ok: true }, result));
  } catch (e) {
    console.error('Error al registrar venta (with promos):', e.message || e);
    res.status(e.statusCode || 500).json({ ok: false, message: e.message || 'Error al registrar venta' });
  }
});

// Registro de venta: endpoint directo para integraciones o llamadas administrativas
// Rol: cualquiera (Admin o Caja)
app.post('/api/ventas/registrar', requiereRol('cualquiera'), async (req, res) => {
  const { id_cliente, id_usuario, total, detalles, tipo_pago } = req.body || {};

  if (!Number.isSafeInteger(Number(id_usuario)) || Number(id_usuario) <= 0 ||
      !Number.isFinite(Number(total)) || Number(total) <= 0 ||
      !Array.isArray(detalles) || detalles.length === 0) {
    return res.status(400).json({ ok: false, error: 'Datos de venta incompletos. Se requieren id_usuario, total y detalles.' });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const items = detalles.map((item) => ({
      id_producto: Number(item.id_producto || item.id_producto_id || item.producto),
      id_talla: item.id_talla == null || item.id_talla === '' ? null : Number(item.id_talla),
      cantidad: Number(item.cantidad),
      precio_unitario: Number(item.precio_unitario || item.precio || 0)
    }));
    const stock = await lockAndValidateSaleStock(conn, items);

    // Insertar venta (usar fecha_hora consistente con el esquema existente)
    const [ventaResult] = await conn.query(
      'INSERT INTO ventas (id_cliente, id_usuario, fecha_hora, total_venta, tipo_pago) VALUES (?, ?, NOW(), ?, ?)',
      [id_cliente || null, id_usuario, total, tipo_pago || 'Efectivo']
    );
    const id_venta = ventaResult.insertId;

    for (const item of stock.items) {
      await conn.query(
        'INSERT INTO detalleventa (id_venta, id_producto, id_talla, cantidad, precio_unitario) VALUES (?, ?, ?, ?, ?)',
        [id_venta, item.id_producto, item.id_talla || null, item.cantidad, Number(item.precio_unitario || item.precio || 0)]
      );
    }

    await decrementSaleStock(conn, stock);
    await conn.commit();
    conn.release();
    conn = null;
    return res.json({ ok: true, message: 'Venta registrada exitosamente', id_venta });
  } catch (e) {
    if (conn) {
      try {
        await conn.rollback();
      } catch (rollbackError) {
        console.error('No se pudo revertir la venta directa:', rollbackError.message || rollbackError);
      } finally {
        conn.release();
      }
    }
    console.error('Error registrando venta /api/ventas/registrar:', e.message || e);
    return res.status(e.statusCode || 500).json({ ok: false, error: e.message || 'Error al registrar la venta.' });
  }
});


// ---------------- Rutas públicas para Productos (CAJA y front) ----------------
// Listado de productos (para Caja) -> incluye tallas y cantidades
app.get('/api/productos', requiereRol('cualquiera'), async (req, res) => {
  try {
    const hasImg = await columnExists(pool, 'productos', 'ruta_imagen');
    const hasBarcode = await columnExists(pool, 'productos', 'codigo_barras');
    const hasStockMin = await columnExists(pool, 'productos', 'stock_minimo');
    const hasUnidad = await columnExists(pool, 'productos', 'unidad_medida');
    const hasUsaTallas = await columnExists(pool, 'productos', 'usa_tallas');
    const hasEmpaque = await columnExists(pool, 'productos', 'unidades_por_empaque');
    const extra = [
      hasImg ? ', ruta_imagen' : '',
      hasBarcode ? ', codigo_barras' : '',
      hasStockMin ? ', stock_minimo' : '',
      hasUnidad ? ', unidad_medida' : '',
      hasEmpaque ? ', unidades_por_empaque' : '',
      hasUsaTallas ? ', usa_tallas' : ''
    ].join('');
    const q = (req.query.buscar || req.query.q || '').trim();
    let sql = `SELECT id_producto, nombre, marca, inventario, precio_venta, id_categoria${extra} FROM productos WHERE NOT (nombre = 'Producto eliminado' AND marca = '-')`;
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
    sql += ' LIMIT 5000';
    const [rows] = await pool.query(sql, params);
    // Obtener tallas por producto
    const tallasPorProducto = new Map();
    if (rows.length > 0) {
      const ids = rows.map(prod => prod.id_producto);
      const [tallasRows] = await pool.query(
        `SELECT inventario.id_producto, inventario.id_talla, tallas.nombre, inventario.cantidad
         FROM inventario
         JOIN tallas ON inventario.id_talla = tallas.id_talla
         WHERE inventario.id_producto IN (${ids.map(() => '?').join(',')})`,
        ids
      );
      for (const talla of tallasRows) {
        if (!tallasPorProducto.has(talla.id_producto)) tallasPorProducto.set(talla.id_producto, []);
        tallasPorProducto.get(talla.id_producto).push({
          id_talla: talla.id_talla,
          nombre: talla.nombre,
          cantidad: talla.cantidad
        });
      }
    }
    for (const prod of rows) {
      prod.tallas = tallasPorProducto.get(prod.id_producto) || [];
      if (!prod.ruta_imagen) prod.ruta_imagen = null;
    }
    res.json({ productos: rows });
  } catch (e) {
    console.error('Error listar productos publico:', e.message);
    res.status(500).json({ productos: [] });
  }
});

// Obtener producto por id (para Caja)
app.get('/api/productos/:id', requiereRol('cualquiera'), async (req, res) => {
  const id = req.params.id;
  try {
    // Incluir id_categoria para que la caja/cliente puedan conocer la categoría del producto
    const [rows] = await pool.query('SELECT id_producto, nombre, marca, inventario, precio_venta, id_categoria FROM productos WHERE id_producto = ? LIMIT 1', [id]);
    if (rows.length === 0) return res.json({ producto: null });
    const prod = rows[0];
    const [tallas] = await pool.query(
      'SELECT inventario.id_talla, tallas.nombre, inventario.cantidad FROM inventario JOIN tallas ON inventario.id_talla = tallas.id_talla WHERE inventario.id_producto = ?',
      [prod.id_producto]
    );
    prod.tallas = tallas.map(t => ({ id_talla: t.id_talla, nombre: t.nombre, cantidad: t.cantidad }));
    res.json({ producto: prod });
  } catch (e) {
    console.error('Error obtener producto publico:', e.message);
    res.status(500).json({ producto: null });
  }
});


// Stream SSE: stock en vivo para cajas / visor de precio
app.get('/api/stock/stream', requiereRol('cualquiera'), (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  res.write(': connected\n\n');
  stockStreamClients.add(res);
  const keepAlive = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch (_) {
      clearInterval(keepAlive);
      stockStreamClients.delete(res);
    }
  }, 25000);
  req.on('close', () => {
    clearInterval(keepAlive);
    stockStreamClients.delete(res);
  });
});

app.get('/api/tasa-bcv/stream', requiereRol('cualquiera'), (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  res.write(': connected\n\n');
  if (_cachedTasa) {
    try { res.write(`event: tasa\ndata: ${JSON.stringify(currentTasaPayload())}\n\n`); } catch (_) {}
  }
  tasaStreamClients.add(res);
  const keepAlive = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch (_) {
      clearInterval(keepAlive);
      tasaStreamClients.delete(res);
    }
  }, 25000);
  req.on('close', () => {
    clearInterval(keepAlive);
    tasaStreamClients.delete(res);
  });
});

// Arranque diferido: Electron usa startServer(); CLI usa require.main (al final del archivo)
let _httpServer = null;
let _cajaMayorHttpServer = null;

function startCajaMayorServer(port, host) {
  return new Promise((resolve) => {
    let settled = false;
    const server = app.listen(port, host);
    server.on('error', (err) => {
      if (!settled) {
        settled = true;
        serverPortState.cajaMayorPort = null;
        console.warn(`[CAJA MAYOR] No se pudo abrir el puerto ${port}: ${err.message || err}`);
        resolve(null);
      } else {
        console.error('[CAJA MAYOR] Error del servidor:', err.message || err);
      }
    });
    server.once('listening', () => {
      settled = true;
      _cajaMayorHttpServer = server;
      serverPortState.cajaMayorPort = port;
      server.on('close', () => {
        if (_cajaMayorHttpServer === server) _cajaMayorHttpServer = null;
        if (serverPortState.cajaMayorPort === port) serverPortState.cajaMayorPort = null;
      });
      resolve(server);
    });
  });
}

function startServer(options = {}) {
  const PORT = Number(options.port || process.env.PORT || 3000);
  const HOST = options.host || process.env.HOST || '0.0.0.0';
  if (_httpServer) {
    return Promise.resolve({
      port: serverPortState.primaryPort,
      host: HOST,
      server: _httpServer,
      cajaMayorPort: serverPortState.cajaMayorPort
    });
  }
  serverPortState.primaryPort = PORT;
  serverPortState.cajaMayorRequestedPort = Number(options.cajaMayorPort || process.env.CAJA_MAYOR_PORT || 3011);
  return (async () => {
    try {
      await ensureLicenseFromEnv(pool);
    } catch (e) {
      console.warn('[LICENCIA] No se pudo sincronizar plan:', e.message || e);
    }
    return new Promise((resolve, reject) => {
      try {
        _httpServer = app.listen(PORT, HOST, async () => {
          const os = require('os');
          const nets = os.networkInterfaces();
          const ips = [];
          for (const name of Object.keys(nets)) {
            for (const net of nets[name] || []) {
              if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
            }
          }
          console.log(`MAX ERP escuchando en http://localhost:${PORT}`);
          if (ips.length) {
            console.log('En la misma Wi‑Fi / red, abre desde otro equipo:');
            ips.forEach((ip) => console.log(`  → http://${ip}:${PORT}`));
          }
          if (setupEdition.features.cajaMayor) {
            const cajaMayorPort = serverPortState.cajaMayorRequestedPort;
            if (!Number.isSafeInteger(cajaMayorPort) || cajaMayorPort < 1 || cajaMayorPort > 65535) {
              console.warn(`[CAJA MAYOR] Puerto inválido: ${cajaMayorPort}`);
            } else if (cajaMayorPort === PORT) {
              console.warn('[CAJA MAYOR] El puerto debe ser distinto al puerto principal; Caja Mayor no se inició.');
            } else {
              await startCajaMayorServer(cajaMayorPort, HOST);
              if (serverPortState.cajaMayorPort) {
                console.log(`Caja Mayor escuchando en http://localhost:${serverPortState.cajaMayorPort}/caja.html?modo=mayor`);
                ips.forEach((ip) => console.log(`  → http://${ip}:${serverPortState.cajaMayorPort}/caja.html?modo=mayor`));
              }
            }
          }
          // Túnel celular en segundo plano (no bloquea la ventana)
          startTunelCelular(PORT).then((st) => {
            if (st && st.movil_url) {
              console.log('Celular (internet):', st.movil_url);
            } else if (st && st.error) {
              console.warn('[TUNEL-CELULAR]', st.error);
            }
          }).catch((e) => console.warn('[TUNEL-CELULAR]', e.message || e));
          resolve({
            port: PORT,
            host: HOST,
            server: _httpServer,
            ips,
            cajaMayorPort: serverPortState.cajaMayorPort
          });
        });
        _httpServer.on('error', (err) => {
          _httpServer = null;
          reject(err);
        });
      } catch (e) {
        reject(e);
      }
    });
  })();
}

function stopServer() {
  return new Promise((resolve) => {
    const finish = () => {
      const servers = [_httpServer, _cajaMayorHttpServer].filter(Boolean);
      _httpServer = null;
      _cajaMayorHttpServer = null;
      serverPortState.cajaMayorPort = null;
      if (!servers.length) return resolve();
      let remaining = servers.length;
      servers.forEach((server) => server.close(() => {
        remaining -= 1;
        if (!remaining) resolve();
      }));
    };
    stopTunelCelular().then(finish).catch(finish);
  });
}

// ---------------- Reportes: Ventas por Temporada y Rotación de Inventario ----------------
// Estas rutas usan las vistas definidas en la base de datos: vista_ventas_temporada y vista_rotacion_inventario
app.get('/api/reportes/ventas-temporada', requiereRol('administrador'), async (req, res) => {
  try {
    // periodo puede ser: actual, anterior, trimestre, anual, todos
    const periodo = req.query.periodo || 'actual';
    const now = new Date();
    let start, end;
    
    // Calcular rango de fechas según periodo
    switch(periodo) {
      case 'actual':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        break;
      case 'anterior':
        start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        end = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'trimestre':
        const trimestre = Math.floor(now.getMonth() / 3);
        start = new Date(now.getFullYear(), trimestre * 3, 1);
        end = new Date(now.getFullYear(), (trimestre + 1) * 3, 1);
        break;
      case 'anual':
        start = new Date(now.getFullYear(), 0, 1);
        end = new Date(now.getFullYear() + 1, 0, 1);
        break;
      case 'ultimos6':
        start = new Date(now.getFullYear(), now.getMonth() - 5, 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        break;
      case 'ultimos12':
        start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        break;
      default:
        start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    }

    const startStr = start.toISOString().slice(0, 19).replace('T', ' ');
    const endStr = end.toISOString().slice(0, 19).replace('T', ' ');

    // Mes actual / anterior: desglose DIARIO para que la gráfica tenga línea real
    if (periodo === 'actual' || periodo === 'anterior') {
      const [diarios] = await pool.query(
        `SELECT
           DATE_FORMAT(v.fecha_hora, '%Y-%m-%d') AS periodo,
           SUM(v.total_venta) AS ingreso_total,
           COALESCE(SUM((
             SELECT SUM(dv.cantidad) FROM detalleventa dv WHERE dv.id_venta = v.id_venta
           )), 0) AS unidades_vendidas
         FROM ventas v
         WHERE v.fecha_hora >= ? AND v.fecha_hora < ?
         GROUP BY DATE_FORMAT(v.fecha_hora, '%Y-%m-%d')
         ORDER BY periodo ASC`,
        [startStr, endStr]
      );
      const rows = (diarios || []).map((v) => ({
        periodo: v.periodo || '',
        ingreso_total: Number(v.ingreso_total || 0),
        unidades_vendidas: Number(v.unidades_vendidas || 0)
      }));
      return res.json({ ok: true, periodo, granularidad: 'dia', rows });
    }

    // Intentar usar la vista si existe, sino calcular manualmente
    try {
      // Algunas vistas no exponen la columna fecha_hora; la vista_ventas_temporada
      // sí ofrece campos como anio, mes y periodo (ej. '2025-11').
      // Filtramos por el campo `periodo` para evitar errores de columna desconocida.
      const startPeriod = startStr.slice(0,7); // 'YYYY-MM'
      const endPeriod = endStr.slice(0,7);
      let query = `SELECT anio, mes, trimestre, periodo, ingreso_total, unidades_vendidas 
                   FROM vista_ventas_temporada 
                   WHERE periodo >= ? AND periodo < ?
                   ORDER BY anio DESC, mes DESC LIMIT 48`;
      const [rows] = await pool.query(query, [startPeriod, endPeriod]);

      if (rows.length > 0) {
        // Si se pidió trimestre, agrupar
    if (periodo === 'trimestre') {
          const grouped = {};
          for (const r of rows) {
            const key = `${r.anio}-T${r.trimestre}`;
            if (!grouped[key]) grouped[key] = { periodo: key, ingreso_total: 0, unidades_vendidas: 0 };
            grouped[key].ingreso_total += Number(r.ingreso_total || 0);
            grouped[key].unidades_vendidas += Number(r.unidades_vendidas || 0);
          }
          return res.json({ ok: true, periodo: 'trimestre', rows: Object.values(grouped) });
        }
        return res.json({ ok: true, periodo, rows });
      }
    } catch (viewError) {
      console.log('Vista no disponible, calculando manualmente:', viewError.message);
    }

    // Fallback: calcular manualmente desde ventas
    const [ventas] = await pool.query(
      `SELECT 
        DATE_FORMAT(v.fecha_hora, '%Y') AS anio,
        DATE_FORMAT(v.fecha_hora, '%m') AS mes,
        QUARTER(v.fecha_hora) AS trimestre,
        DATE_FORMAT(v.fecha_hora, '%Y-%m') AS periodo,
        SUM(v.total_venta) AS ingreso_total,
        SUM((SELECT SUM(dv.cantidad) FROM detalleventa dv WHERE dv.id_venta = v.id_venta)) AS unidades_vendidas
      FROM ventas v
      WHERE v.fecha_hora >= ? AND v.fecha_hora < ?
      GROUP BY anio, mes, trimestre, periodo
      ORDER BY anio DESC, mes DESC`,
      [startStr, endStr]
    );

    const rows = ventas.map(v => ({
      anio: Number(v.anio || 0),
      mes: Number(v.mes || 0),
      trimestre: Number(v.trimestre || 0),
      periodo: v.periodo || '',
      ingreso_total: Number(v.ingreso_total || 0),
      unidades_vendidas: Number(v.unidades_vendidas || 0)
    }));

    if (periodo === 'trimestre') {
      const grouped = {};
      for (const r of rows) {
        const key = `${r.anio}-T${r.trimestre}`;
        if (!grouped[key]) grouped[key] = { periodo: key, ingreso_total: 0, unidades_vendidas: 0 };
        grouped[key].ingreso_total += Number(r.ingreso_total || 0);
        grouped[key].unidades_vendidas += Number(r.unidades_vendidas || 0);
      }
      return res.json({ ok: true, periodo: 'trimestre', rows: Object.values(grouped) });
    }

    return res.json({ ok: true, periodo, rows });
  } catch (e) {
    console.error('Error reportes ventas-temporada:', e.message || e);
    res.status(500).json({ ok: false, rows: [], message: 'Error al obtener ventas por temporada' });
  }
});

// ==================== CONTABILIDAD ====================
// Endpoint para ingresos por ventas
app.get('/api/contabilidad/ingresos', requiereRol('administrador'), async (req, res) => {
  try {
    const periodo = req.query.periodo || 'mes';
    const now = new Date();
    let start, end;
    
    switch(periodo) {
      case 'mes':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        break;
      case 'trimestre':
        const trimestre = Math.floor(now.getMonth() / 3);
        start = new Date(now.getFullYear(), trimestre * 3, 1);
        end = new Date(now.getFullYear(), (trimestre + 1) * 3, 1);
        break;
      case 'anual':
        start = new Date(now.getFullYear(), 0, 1);
        end = new Date(now.getFullYear() + 1, 0, 1);
        break;
      default:
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    }
    
    const startStr = start.toISOString().slice(0, 19).replace('T', ' ');
    const endStr = end.toISOString().slice(0, 19).replace('T', ' ');
    
    const [ingresos] = await pool.query(
      `SELECT fecha_hora, total_venta, tipo_pago 
       FROM ventas 
       WHERE fecha_hora >= ? AND fecha_hora < ? 
       ORDER BY fecha_hora DESC`,
      [startStr, endStr]
    );
    
    res.json({ ok: true, ingresos });
  } catch (e) {
    console.error('Error /api/contabilidad/ingresos:', e.message || e);
    res.status(500).json({ ok: false, ingresos: [], error: 'Error del servidor' });
  }
});

// Libro de pagos a proveedores (historial para hub Contabilidad)
app.get('/api/contabilidad/pagos-proveedores', requiereRol('administrador'), async (req, res) => {
  try {
    const hasFactura = await columnExists(pool, 'cuentas_por_pagar', 'numero_factura');
    const facturaCol = hasFactura ? 'cpp.numero_factura' : 'NULL AS numero_factura';
    const [pagos] = await pool.query(
      `SELECT
        pp.id_pago,
        pp.fecha_pago,
        pp.monto,
        pp.metodo_pago,
        pp.referencia,
        pp.notas,
        pr.nombre AS nombre_proveedor,
        cpp.id_compra,
        ${facturaCol}
      FROM pagos_proveedores pp
      LEFT JOIN cuentas_por_pagar cpp ON pp.id_cuenta = cpp.id_cuenta
      LEFT JOIN proveedores pr ON cpp.id_proveedor = pr.id_proveedor
      ORDER BY pp.fecha_pago DESC
      LIMIT 200`
    );
    res.json({ ok: true, pagos });
  } catch (e) {
    console.error('Error /api/contabilidad/pagos-proveedores:', e.message || e);
    res.status(500).json({ ok: false, pagos: [], error: 'Error del servidor' });
  }
});

// Libro / cuenta corriente por proveedor (Debe = compras, Haber = pagos)
app.get('/api/contabilidad/libro-proveedor/:id', requiereRol('administrador'), async (req, res) => {
  try {
    const idProveedor = Number(req.params.id);
    if (!idProveedor) return res.status(400).json({ ok: false, error: 'Proveedor inválido' });

    const [provRows] = await pool.query(
      'SELECT id_proveedor, nombre FROM proveedores WHERE id_proveedor = ? LIMIT 1',
      [idProveedor]
    );
    if (!provRows.length) return res.status(404).json({ ok: false, error: 'Proveedor no encontrado' });

    const hasFactura = await columnExists(pool, 'cuentas_por_pagar', 'numero_factura');

    const [compras] = await pool.query(
      `SELECT
        c.id_compra,
        c.fecha_compra,
        c.total_compra,
        c.estado_pago,
        cpp.monto_total,
        cpp.monto_pagado,
        cpp.monto_pendiente,
        ${hasFactura ? 'cpp.numero_factura' : 'NULL AS numero_factura'}
      FROM compras c
      LEFT JOIN cuentas_por_pagar cpp ON cpp.id_compra = c.id_compra
      WHERE c.id_proveedor = ?
      ORDER BY c.fecha_compra ASC, c.id_compra ASC`,
      [idProveedor]
    );

    const [pagos] = await pool.query(
      `SELECT
        pp.id_pago,
        pp.fecha_pago,
        pp.monto,
        pp.metodo_pago,
        pp.referencia,
        cpp.id_compra,
        ${hasFactura ? 'cpp.numero_factura' : 'NULL AS numero_factura'}
      FROM pagos_proveedores pp
      INNER JOIN cuentas_por_pagar cpp ON cpp.id_cuenta = pp.id_cuenta
      WHERE cpp.id_proveedor = ?
         OR cpp.id_compra IN (SELECT id_compra FROM compras WHERE id_proveedor = ?)
      ORDER BY pp.fecha_pago ASC, pp.id_pago ASC`,
      [idProveedor, idProveedor]
    );

    const eventos = [];

    for (const c of compras) {
      const monto = Number(c.monto_total != null ? c.monto_total : c.total_compra) || 0;
      const pagado = Number(c.monto_pagado || 0);
      const pendiente = c.monto_pendiente != null
        ? Number(c.monto_pendiente)
        : Math.max(0, monto - pagado);
      const estado = String(c.estado_pago || '').toUpperCase();
      const puedePagar = pendiente > 0.009 && !['PAGADA', 'PAGADO'].includes(estado);
      const factura = c.numero_factura ? ` Factura ${c.numero_factura}` : '';
      eventos.push({
        fecha: c.fecha_compra,
        orden: 0,
        concepto: `Compra #${c.id_compra}${factura}`,
        debe: monto,
        haber: 0,
        tipo: 'compra',
        id_compra: c.id_compra,
        puede_pagar: puedePagar,
        monto_pendiente: pendiente,
        monto_total: monto
      });
    }

    for (const p of pagos) {
      const ref = p.referencia ? ` · Ref. ${p.referencia}` : '';
      const compra = p.id_compra ? ` (Compra #${p.id_compra})` : '';
      eventos.push({
        fecha: p.fecha_pago,
        orden: 1,
        concepto: `Pago ${p.metodo_pago || ''}${compra}${ref}`.trim(),
        debe: 0,
        haber: Number(p.monto) || 0,
        tipo: 'pago',
        id_compra: p.id_compra || null,
        puede_pagar: false,
        monto_pendiente: 0,
        monto_total: 0
      });
    }

    eventos.sort((a, b) => {
      const ta = new Date(a.fecha).getTime() || 0;
      const tb = new Date(b.fecha).getTime() || 0;
      if (ta !== tb) return ta - tb;
      return a.orden - b.orden;
    });

    let saldo = 0;
    let totalDebe = 0;
    let totalHaber = 0;
    const movimientos = eventos.map(ev => {
      totalDebe += ev.debe;
      totalHaber += ev.haber;
      saldo += ev.debe - ev.haber;
      return {
        fecha: ev.fecha,
        concepto: ev.concepto,
        debe: ev.debe,
        haber: ev.haber,
        saldo,
        tipo: ev.tipo,
        id_compra: ev.id_compra,
        puede_pagar: ev.puede_pagar,
        monto_pendiente: ev.monto_pendiente,
        monto_total: ev.monto_total
      };
    });

    res.json({
      ok: true,
      proveedor: provRows[0],
      resumen: {
        total_debe: totalDebe,
        total_haber: totalHaber,
        saldo
      },
      movimientos
    });
  } catch (e) {
    console.error('Error /api/contabilidad/libro-proveedor:', e.message || e);
    res.status(500).json({ ok: false, movimientos: [], error: 'Error del servidor' });
  }
});

/** Costo unitario por producto según capas de compra (FIFO) para las unidades vendidas. */
async function buildFifoUnitCostFn(pool) {
  const [compras] = await pool.query(
    `SELECT id_producto, cantidad, costo_unitario
     FROM detallecompra
     WHERE costo_unitario > 0
     ORDER BY id_producto ASC, id_detalle ASC`
  );
  const [invRows] = await pool.query(
    `SELECT id_producto,
            SUM(cantidad * costo_promedio) / NULLIF(SUM(cantidad), 0) AS costo
     FROM inventario
     WHERE costo_promedio > 0
     GROUP BY id_producto`
  );
  const layers = new Map();
  for (const c of compras) {
    const id = Number(c.id_producto);
    if (!layers.has(id)) layers.set(id, []);
    layers.get(id).push({ qty: Number(c.cantidad) || 0, cost: Number(c.costo_unitario) || 0 });
  }
  const invMap = new Map();
  for (const r of invRows) invMap.set(Number(r.id_producto), Number(r.costo) || 0);

  return function unitCostFifo(idProducto, unidadesVendidas) {
    const id = Number(idProducto);
    const sold = Number(unidadesVendidas) || 0;
    const L = layers.get(id);
    if (!L || !L.length) return invMap.get(id) || 0;
    if (sold <= 0) {
      let tq = 0;
      let tc = 0;
      for (const x of L) {
        tq += x.qty;
        tc += x.qty * x.cost;
      }
      return tq > 0 ? tc / tq : (invMap.get(id) || 0);
    }
    let left = sold;
    let cogs = 0;
    let lastCost = L[L.length - 1].cost;
    for (const x of L) {
      if (left <= 0) break;
      const take = Math.min(left, x.qty);
      cogs += take * x.cost;
      lastCost = x.cost;
      left -= take;
    }
    if (left > 0) cogs += left * lastCost;
    return cogs / sold;
  };
}

// Endpoint para reporte de utilidad por productos
app.get('/api/reportes/utilidad-productos', requiereRol('administrador'), async (req, res) => {
  try {
    const unitCostFifo = await buildFifoUnitCostFn(pool);
    const [rows] = await pool.query(
      `SELECT 
        p.id_producto,
        p.nombre,
        p.marca,
        p.precio_venta,
        COALESCE(ventas.unidades_vendidas, 0) AS unidades_vendidas,
        COALESCE(ventas.total_ventas, 0) AS total_ventas
      FROM productos p
      LEFT JOIN (
        SELECT id_producto,
               SUM(cantidad) AS unidades_vendidas,
               SUM(cantidad * precio_unitario) AS total_ventas
        FROM detalleventa
        GROUP BY id_producto
      ) ventas ON ventas.id_producto = p.id_producto
      WHERE COALESCE(ventas.unidades_vendidas, 0) > 0
        AND NOT (p.nombre = 'Producto eliminado' AND p.marca = '-')
      ORDER BY ventas.total_ventas DESC`
    );

    const utilidad = rows.map(r => {
      const unidades = Number(r.unidades_vendidas || 0);
      const totalVentas = Number(r.total_ventas || 0);
      const precio = Number(r.precio_venta || 0);
      const costo = unitCostFifo(r.id_producto, unidades);
      const utilidadTotal = totalVentas - (unidades * costo);
      const utilidadUnitaria = precio - costo;
      const margen = precio > 0 ? (utilidadUnitaria / precio) * 100 : 0;
      return {
        nombre: `${r.marca || ''} ${r.nombre || ''}`.trim(),
        costo_promedio: Number(costo.toFixed(4)),
        precio_venta: precio,
        utilidad_unitaria: Number(utilidadUnitaria.toFixed(4)),
        unidades_vendidas: unidades,
        total_ventas: totalVentas,
        utilidad_total: Number(utilidadTotal.toFixed(2)),
        margen_porcentaje: Number(margen.toFixed(2))
      };
    }).sort((a, b) => b.utilidad_total - a.utilidad_total);

    res.json({ ok: true, utilidad });
  } catch (e) {
    console.error('Error /api/reportes/utilidad-productos:', e.message || e);
    res.status(500).json({ ok: false, utilidad: [], error: 'Error del servidor' });
  }
});

app.get('/api/reportes/rotacion-inventario', requiereRol('administrador'), async (req, res) => {
  try {
    const top = Math.max(1, Math.min(500, Number(req.query.top) || 100));
    // Intentar usar la vista si existe, sino calcular manualmente
    try {
    const [rows] = await pool.query(`SELECT id_producto, nombre, marca, categoria, stock_actual, unidades_vendidas_ultimo_mes, indice_rotacion FROM vista_rotacion_inventario ORDER BY indice_rotacion DESC LIMIT ?`, [top]);
    return res.json({ ok: true, rows });
    } catch (viewError) {
      // Si la vista no existe, calcular manualmente
      const now = new Date();
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const startStr = lastMonth.toISOString().slice(0, 19).replace('T', ' ');
      const endStr = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 19).replace('T', ' ');
      
      const [rows] = await pool.query(
        `SELECT 
          p.id_producto,
          p.nombre,
          p.marca,
          c.nombre AS categoria,
          p.inventario AS stock_actual,
          COALESCE(SUM(dv.cantidad), 0) AS unidades_vendidas_ultimo_mes,
          CASE 
            WHEN p.inventario > 0 THEN COALESCE(SUM(dv.cantidad), 0) / p.inventario
            ELSE 0
          END AS indice_rotacion
        FROM productos p
        LEFT JOIN categorias c ON p.id_categoria = c.id_categoria
        LEFT JOIN detalleventa dv ON p.id_producto = dv.id_producto
        LEFT JOIN ventas v ON dv.id_venta = v.id_venta
        WHERE v.fecha_hora >= ? AND v.fecha_hora < ?
        GROUP BY p.id_producto, p.nombre, p.marca, c.nombre, p.inventario
        ORDER BY indice_rotacion DESC
        LIMIT ?`,
        [startStr, endStr, top]
      );
      return res.json({ ok: true, rows });
    }
  } catch (e) {
    console.error('Error reportes rotacion-inventario:', e.message || e);
    res.status(500).json({ ok: false, rows: [], message: 'Error al obtener rotación de inventario' });
  }
});

// Endpoint para reporte de inventario actual
app.get('/api/reportes/inventario-actual', requiereRol('administrador'), async (req, res) => {
  try {
    const [productos] = await pool.query(
      `SELECT p.id_producto, p.nombre, p.marca, p.inventario AS stock_total, p.unidad_medida, c.nombre AS categoria
       FROM productos p
       LEFT JOIN categorias c ON p.id_categoria = c.id_categoria
       ORDER BY p.marca, p.nombre`
    );
    
    // Para cada producto, obtener tallas con cantidades
    for (const prod of productos) {
      const [tallas] = await pool.query(
        `SELECT t.nombre AS talla, i.cantidad
         FROM inventario i
         LEFT JOIN tallas t ON i.id_talla = t.id_talla
         WHERE i.id_producto = ?
         ORDER BY t.nombre`,
        [prod.id_producto]
      );
      prod.tallas = tallas;
    }
    
    res.json({ ok: true, rows: productos });
  } catch (e) {
    console.error('Error /api/reportes/inventario-actual:', e.message || e);
    res.status(500).json({ ok: false, rows: [], error: 'Error del servidor' });
  }
});

// Endpoint para reporte de compras por periodo
app.get('/api/reportes/compras-periodo', requiereRol('administrador'), async (req, res) => {
  try {
    const start = req.query.start || null;
    const end = req.query.end || null;
    
    let query = `
      SELECT 
        c.id_compra,
        c.fecha_compra,
        c.total_compra,
        pr.nombre AS proveedor,
        dc.id_producto,
        p.marca,
        p.nombre AS producto,
        dc.cantidad,
        dc.costo_unitario,
        (dc.cantidad * dc.costo_unitario) AS total_linea
       FROM compras c
      LEFT JOIN proveedores pr ON c.id_proveedor = pr.id_proveedor
      LEFT JOIN detallecompra dc ON c.id_compra = dc.id_compra
      LEFT JOIN productos p ON dc.id_producto = p.id_producto
      WHERE 1=1
    `;
    const params = [];
    
    if (start) {
      query += ' AND DATE(c.fecha_compra) >= ?';
      params.push(start);
    }
    if (end) {
      query += ' AND DATE(c.fecha_compra) <= ?';
      params.push(end);
    }
    
    query += ' ORDER BY c.fecha_compra DESC, c.id_compra, dc.id_producto';
    
    const [rows] = await pool.query(query, params);

    // Agrupar por proveedor > compra > líneas
    const grupos = {};
    let totalGeneral = 0;
    let comprasCount = 0;
    
    rows.forEach(row => {
      const prov = row.proveedor || 'Sin proveedor';
      const compraId = row.id_compra;
      
      if (!grupos[prov]) {
        grupos[prov] = { proveedor: prov, compras: [] };
      }
      
      // Buscar si la compra ya existe en este proveedor
      let compra = grupos[prov].compras.find(c => c.id_compra === compraId);
      if (!compra) {
        compra = {
          id_compra: compraId,
          fecha_compra: row.fecha_compra,
          total_compra: row.total_compra,
          lineas: []
        };
        grupos[prov].compras.push(compra);
        comprasCount++;
      }
      
      // Agregar línea si existe (product existe)
      if (row.id_producto) {
        compra.lineas.push({
          id_producto: row.id_producto,
          marca: row.marca,
          producto: row.producto,
          cantidad: row.cantidad,
          costo_unitario: row.costo_unitario,
          total_linea: row.total_linea
        });
        totalGeneral += Number(row.total_linea || 0);
      }
    });
    
    res.json({ 
      ok: true, 
      grupos: Object.values(grupos), 
      total_general: totalGeneral,
      compras_count: comprasCount
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      grupos: [],
      error: 'Error del servidor: ' + e.message,
      compras_count: 0
    });
  }
});

// Endpoint: Top Clientes (por gasto total)
app.get('/api/reportes/top-clientes', requiereRol('administrador'), async (req, res) => {
  try {
    const top = Number(req.query.top) || 10;
    const [rows] = await pool.query(
      `SELECT c.id_cliente, c.nombre, c.cedula, c.telefono, c.email,
              COUNT(v.id_venta) AS ventas_count, COALESCE(SUM(v.total_venta),0) AS total_gastado,
              MAX(v.fecha_hora) AS ultima_compra
       FROM clientes c
       LEFT JOIN ventas v ON c.id_cliente = v.id_cliente
       GROUP BY c.id_cliente, c.nombre, c.cedula, c.telefono, c.email
       ORDER BY total_gastado DESC
       LIMIT ?`,
      [top]
    );

    // Normalizar tipos
    const clientes = rows.map(r => ({
      id_cliente: r.id_cliente,
      nombre: r.nombre,
      cedula: r.cedula,
      telefono: r.telefono,
      email: r.email,
      ventas_count: Number(r.ventas_count) || 0,
      total_gastado: Number(r.total_gastado) || 0,
      ultima_compra: r.ultima_compra
    }));

    return res.json({ clientes });
  } catch (e) {
    console.error('Error top clientes:', e.message || e);
    return res.status(500).json({ clientes: [] });
  }
});

// ==================== CUENTAS POR PAGAR ====================
// Endpoint para obtener cuentas por pagar desde compras
app.get('/api/cuentas-pagar', requiereRol('administrador'), async (req, res) => {
  try {
    // Obtener tasa de cambio actual
    let tasaDolar = 0;
    try {
      // Intentar obtener desde la API de tasa BCV del mismo servidor
      const fetch = require('node-fetch');
      const tasaRes = await fetch('http://localhost:' + serverPortState.primaryPort + '/api/tasa-bcv', { timeout: 2000 }).catch(() => null);
      if (tasaRes && tasaRes.ok) {
        const tasaData = await tasaRes.json();
        tasaDolar = Number(tasaData.tasa || 0);
      }
    } catch (e) {
      console.log('No se pudo obtener tasa:', e.message);
    }
    if (!(tasaDolar > 0) && _cachedTasa > 0) tasaDolar = Number(_cachedTasa);

    const hasFactura = await columnExists(pool, 'cuentas_por_pagar', 'numero_factura');
    const hasEmision = await columnExists(pool, 'cuentas_por_pagar', 'fecha_emision');
    const facturaCols = [
      hasFactura ? 'cpp.numero_factura' : 'NULL AS numero_factura',
      hasEmision ? 'cpp.fecha_emision' : 'NULL AS fecha_emision'
    ].join(', ');

    // Obtener compras con estado pendiente o parcial
    const [compras] = await pool.query(
      `SELECT 
        c.id_compra,
        c.fecha_compra,
        c.total_compra,
        c.estado_pago,
        pr.nombre AS nombre_proveedor,
        pr.id_proveedor,
        cpp.id_cuenta,
        cpp.monto_total,
        cpp.monto_pagado,
        cpp.monto_pendiente,
        cpp.fecha_vencimiento,
        cpp.estado AS estado_cuenta,
        ${facturaCols}
      FROM compras c
      LEFT JOIN proveedores pr ON c.id_proveedor = pr.id_proveedor
      LEFT JOIN cuentas_por_pagar cpp ON c.id_compra = cpp.id_compra
      WHERE UPPER(TRIM(c.estado_pago)) IN ('PENDIENTE', 'PARCIAL')
      ORDER BY c.fecha_compra DESC`
    );

    const cuentas = compras.map(compra => {
      // Obtener monto total desde la compra o desde cuentas_por_pagar
      const montoTotal = Number(compra.monto_total || compra.total_compra || 0);
      const montoPagado = Number(compra.monto_pagado || 0);
      const montoPendiente = montoTotal - montoPagado;
      const porcentajePendiente = montoTotal > 0 ? ((montoPendiente / montoTotal) * 100).toFixed(2) : '100.00';
      
      // Calcular fecha de vencimiento (30 días después de la compra)
      const fechaCompra = new Date(compra.fecha_compra);
      const fechaVencimiento = new Date(fechaCompra);
      fechaVencimiento.setDate(fechaVencimiento.getDate() + 30);
      
      return {
        id_cuenta: compra.id_cuenta || compra.id_compra,
        id_compra: compra.id_compra,
        nombre_proveedor: compra.nombre_proveedor || 'Sin proveedor',
        numero_factura: compra.numero_factura || null,
        fecha_emision: compra.fecha_emision || compra.fecha_compra,
        monto_total: montoTotal,
        monto_pagado: montoPagado,
        monto_pendiente: montoPendiente,
        porcentaje_pendiente: porcentajePendiente,
        fecha_compra: compra.fecha_compra,
        fecha_vencimiento: compra.fecha_vencimiento || fechaVencimiento.toISOString().split('T')[0],
        estado: compra.estado_pago,
        monto_total_usd: montoTotal,
        monto_total_bs: (montoTotal * tasaDolar).toFixed(2),
        monto_pendiente_usd: montoPendiente,
        monto_pendiente_bs: (montoPendiente * tasaDolar).toFixed(2),
        tasa_dolar: tasaDolar
      };
    });

    res.json({ ok: true, cuentas });
  } catch (e) {
    console.error('Error /api/cuentas-pagar:', e.message || e);
    res.status(500).json({ ok: false, cuentas: [], error: 'Error del servidor' });
  }
});

// Alias comercial CxP
app.post('/api/v1/contabilidad/cxp/pago', requiereRol('administrador'), async (req, res) => {
  // Reutiliza el handler existente vía redirect interno de URL
  req.url = '/api/cuentas-pagar/pagar';
  app._router.handle(req, res, () => {});
});

app.post('/api/v1/promociones', requiereRol('administrador'), async (req, res) => {
  req.url = '/api/promociones';
  app._router.handle(req, res, () => {});
});

// Endpoint para registrar pago de cuenta por pagar
app.post('/api/cuentas-pagar/pagar', requiereRol('administrador'), async (req, res) => {
  let conn;
  try {
    const { id_compra, monto_pagado, estado_pago, metodo_pago, referencia, notas } = req.body;
    conn = await pool.getConnection();
    await conn.beginTransaction();

    // Actualizar o crear cuenta por pagar
    const [cuentaExist] = await conn.query(
      'SELECT id_cuenta, monto_total, monto_pagado FROM cuentas_por_pagar WHERE id_compra = ?',
      [id_compra]
    );

    // Obtener monto total desde la compra si no existe en cuentas_por_pagar
    let montoTotal = 0;
    if (cuentaExist.length > 0) {
      montoTotal = Number(cuentaExist[0].monto_total || 0);
    } else {
      const [compra] = await conn.query('SELECT total_compra FROM compras WHERE id_compra = ?', [id_compra]);
      montoTotal = compra.length > 0 ? Number(compra[0].total_compra || 0) : Number(req.body.monto_total || 0);
    }
    
    const abono = Number(monto_pagado || 0);
    if (!(abono > 0)) {
      return res.status(400).json({ ok: false, error: 'Indica un monto de abono mayor a 0.' });
    }

    const montoPagadoAnterior = cuentaExist.length > 0 ? Number(cuentaExist[0].monto_pagado || 0) : 0;
    let nuevoMontoPagado = montoPagadoAnterior + abono;
    if (nuevoMontoPagado > montoTotal + 0.009) {
      return res.status(400).json({
        ok: false,
        error: `El abono excede lo pendiente. Máximo: $${Math.max(0, montoTotal - montoPagadoAnterior).toFixed(2)}`
      });
    }
    if (nuevoMontoPagado > montoTotal) nuevoMontoPagado = montoTotal;
    const nuevoMontoPendiente = Math.max(0, montoTotal - nuevoMontoPagado);

    // CxP usa mayúsculas; compras usa título legible
    let nuevoEstadoCxP = 'PENDIENTE';
    let nuevoEstadoCompra = 'Pendiente';
    if (nuevoMontoPendiente <= 0.009) {
      nuevoEstadoCxP = 'PAGADA';
      nuevoEstadoCompra = 'Pagada';
      nuevoMontoPagado = montoTotal;
    } else if (nuevoMontoPagado > 0) {
      nuevoEstadoCxP = 'PARCIAL';
      nuevoEstadoCompra = 'Parcial';
    }

    // Obtener id_cuenta (crear si no existe)
    let idCuenta = cuentaExist.length > 0 ? cuentaExist[0].id_cuenta : null;
    
    if (!idCuenta) {
      // Crear cuenta si no existe
      const fechaCompra = new Date();
      const fechaVencimiento = new Date(fechaCompra);
      fechaVencimiento.setDate(fechaVencimiento.getDate() + 30);
      
      const [compra] = await conn.query('SELECT id_proveedor, total_compra FROM compras WHERE id_compra = ?', [id_compra]);
      const idProveedor = compra.length > 0 ? compra[0].id_proveedor : null;
      const montoTotalCompra = compra.length > 0 ? Number(compra[0].total_compra || 0) : montoTotal;

      const [result] = await conn.query(
        `INSERT INTO cuentas_por_pagar 
         (id_proveedor, id_compra, monto_total, monto_pagado, monto_pendiente, fecha_vencimiento, estado)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [idProveedor, id_compra, montoTotalCompra, nuevoMontoPagado, nuevoMontoPendiente, fechaVencimiento.toISOString().split('T')[0], nuevoEstadoCxP]
      );
      idCuenta = result.insertId;
    } else {
      // Actualizar cuenta existente
      await conn.query(
        `UPDATE cuentas_por_pagar 
         SET monto_pagado = ?, monto_pendiente = ?, estado = ?
         WHERE id_cuenta = ?`,
        [nuevoMontoPagado, nuevoMontoPendiente, nuevoEstadoCxP, idCuenta]
      );
    }

    // Registrar pago en tabla pagos_proveedores
    await conn.query(
      `INSERT INTO pagos_proveedores 
       (id_cuenta, monto, metodo_pago, referencia, id_usuario, notas)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [idCuenta, abono, metodo_pago || 'EFECTIVO', referencia || null, req.session.user.id, notas || null]
    );

    // Actualizar estado de la compra
    await conn.query(
      'UPDATE compras SET estado_pago = ? WHERE id_compra = ?',
      [nuevoEstadoCompra, id_compra]
    );

    await conn.commit();
    res.json({ ok: true, message: 'Pago registrado correctamente' });
  } catch (e) {
    if (conn) await conn.rollback();
    console.error('Error /api/cuentas-pagar/pagar:', e.message || e);
    res.status(500).json({ ok: false, error: 'Error del servidor' });
  } finally {
    if (conn) conn.release();
  }
});

// ==================== CONTROL DE CAJA ====================
// Endpoint para obtener movimientos de caja
app.get('/api/caja/movimientos', requiereRol('administrador'), async (req, res) => {
  try {
    const [movimientos] = await pool.query(
      `SELECT 
        mc.id_movimiento,
        mc.tipo_movimiento AS tipo,
        mc.monto,
        mc.descripcion,
        mc.fecha_hora,
        u.usuario AS nombre_usuario,
        mc.referencia_id AS referencia
      FROM movimientoscaja mc
      LEFT JOIN usuarios u ON mc.id_usuario = u.id_usuario
      ORDER BY mc.fecha_hora DESC
      LIMIT 500`
    );

    res.json({ ok: true, movimientos });
  } catch (e) {
    console.error('Error /api/caja/movimientos:', e.message || e);
    res.status(500).json({ ok: false, movimientos: [], error: 'Error del servidor' });
  }
});

// ==================== CONCILIACIÓN BANCARIA ====================
// Endpoint para obtener conciliaciones
app.get('/api/conciliaciones', requiereRol('administrador'), async (req, res) => {
  try {
    const [conciliaciones] = await pool.query(
      `SELECT 
        id_conciliacion,
        fecha_conciliacion,
        saldo_libro,
        saldo_banco,
        diferencia,
        estado,
        notas,
        fecha_registro
      FROM conciliacion_bancaria
      ORDER BY fecha_conciliacion DESC
      LIMIT 100`
    );

    res.json({ ok: true, conciliaciones });
  } catch (e) {
    console.error('Error /api/conciliaciones:', e.message || e);
    res.status(500).json({ ok: false, conciliaciones: [], error: 'Error del servidor' });
  }
});

// Endpoint para crear conciliación
app.post('/api/conciliaciones', requiereRol('administrador'), async (req, res) => {
  try {
    const { fecha_conciliacion, saldo_libro, saldo_banco, notas } = req.body;
    const diferencia = Number(saldo_libro) - Number(saldo_banco);
    const estado = Math.abs(diferencia) < 0.01 ? 'CONCILIADA' : 'CON_DIFERENCIAS';

    const [result] = await pool.query(
      `INSERT INTO conciliacion_bancaria 
       (fecha_conciliacion, saldo_libro, saldo_banco, diferencia, estado, notas, id_usuario)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [fecha_conciliacion, saldo_libro, saldo_banco, diferencia, estado, notas || null, req.session.user.id]
    );

    res.json({ ok: true, id_conciliacion: result.insertId });
  } catch (e) {
    console.error('Error /api/conciliaciones POST:', e.message || e);
    res.status(500).json({ ok: false, error: 'Error del servidor' });
  }
});

// ==================== REPORTES MEJORADOS ====================
// Reporte de ventas con totales por tipo de pago
app.get('/api/reportes/ventas-detalle', requiereRol('administrador'), async (req, res) => {
  try {
    const now = new Date();
    const year = Number(req.query.year) || now.getFullYear();
    const month = Number(req.query.month) || (now.getMonth() + 1);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);
    const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2,'0')}-01 00:00:00`;
    const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2,'0')}-01 00:00:00`;

    const [ventas] = await pool.query(
      `SELECT 
        v.id_venta,
        v.fecha_hora,
        v.total_venta,
        v.tipo_pago,
        c.nombre AS cliente,
        u.usuario AS vendedor
      FROM ventas v
      LEFT JOIN clientes c ON v.id_cliente = c.id_cliente
      LEFT JOIN usuarios u ON v.id_usuario = u.id_usuario
      WHERE v.fecha_hora >= ? AND v.fecha_hora < ?
      ORDER BY v.fecha_hora DESC`,
      [startStr, endStr]
    );

    // Calcular totales por tipo de pago
    const totales = {
      efectivo: 0,
      pago_movil: 0,
      transferencia: 0,
      tarjeta: 0,
      total: 0
    };

    ventas.forEach(v => {
      const monto = Number(v.total_venta || 0);
      totales.total += monto;
      const tipo = (v.tipo_pago || '').toLowerCase();
      if (tipo.includes('efectivo')) totales.efectivo += monto;
      else if (tipo.includes('movil') || tipo.includes('pago móvil')) totales.pago_movil += monto;
      else if (tipo.includes('transferencia')) totales.transferencia += monto;
      else if (tipo.includes('tarjeta')) totales.tarjeta += monto;
      else totales.efectivo += monto; // Por defecto
    });

    res.json({ ok: true, ventas, totales });
  } catch (e) {
    console.error('Error /api/reportes/ventas-detalle:', e.message || e);
    res.status(500).json({ ok: false, ventas: [], totales: {}, error: 'Error del servidor' });
  }
});

// Reporte de margen de ganancia por categoría
app.get('/api/reportes/margen-categoria', requiereRol('administrador'), async (req, res) => {
  try {
    const unitCostFifo = await buildFifoUnitCostFn(pool);
    const [rows] = await pool.query(
      `SELECT
        c.id_categoria,
        c.nombre AS categoria,
        p.id_producto,
        p.precio_venta,
        COALESCE(ventas.unidades_vendidas, 0) AS unidades_vendidas,
        COALESCE(ventas.total_ventas, 0) AS total_ventas
      FROM categorias c
      LEFT JOIN productos p ON p.id_categoria = c.id_categoria
      LEFT JOIN (
        SELECT id_producto,
               SUM(cantidad) AS unidades_vendidas,
               SUM(cantidad * precio_unitario) AS total_ventas
        FROM detalleventa
        GROUP BY id_producto
      ) ventas ON ventas.id_producto = p.id_producto
      ORDER BY c.nombre, p.id_producto`
    );

    const byCat = new Map();
    for (const r of rows) {
      const key = r.id_categoria;
      if (!byCat.has(key)) {
        byCat.set(key, {
          categoria: r.categoria || 'Sin categoría',
          productos: new Set(),
          total_ventas: 0,
          total_costos: 0,
          precioSum: 0,
          costoSum: 0,
          nPrecio: 0
        });
      }
      const cat = byCat.get(key);
      if (r.id_producto) {
        cat.productos.add(r.id_producto);
        const unidades = Number(r.unidades_vendidas || 0);
        const ventas = Number(r.total_ventas || 0);
        const costoU = unitCostFifo(r.id_producto, unidades > 0 ? unidades : 0);
        cat.total_ventas += ventas;
        cat.total_costos += unidades * costoU;
        const precio = Number(r.precio_venta || 0);
        if (precio > 0) {
          cat.precioSum += precio;
          cat.costoSum += (unidades > 0 ? costoU : unitCostFifo(r.id_producto, 0));
          cat.nPrecio += 1;
        }
      }
    }

    const categorias = [...byCat.values()].map(cat => {
      const utilidad = cat.total_ventas - cat.total_costos;
      let margen = 0;
      // Preferir margen real sobre ventas; si no hay ventas, usar precio vs costo de lista
      if (cat.total_ventas > 0) {
        margen = (utilidad / cat.total_ventas) * 100;
      } else if (cat.nPrecio > 0) {
        const precioAvg = cat.precioSum / cat.nPrecio;
        const costoAvg = cat.costoSum / cat.nPrecio;
        if (precioAvg > 0 && costoAvg > 0) {
          margen = ((precioAvg - costoAvg) / precioAvg) * 100;
        } else if (precioAvg > 0 && !(costoAvg > 0)) {
          margen = 0; // sin costo conocido: no inventar %
        }
      }
      // Evitar valores absurdos por datos mal cargados
      if (!Number.isFinite(margen)) margen = 0;
      if (margen > 1000) margen = 1000;
      if (margen < -1000) margen = -1000;
      return {
        categoria: cat.categoria,
        total_productos: cat.productos.size,
        precio_promedio: cat.nPrecio ? cat.precioSum / cat.nPrecio : 0,
        costo_promedio: cat.nPrecio ? cat.costoSum / cat.nPrecio : 0,
        total_ventas: Number(cat.total_ventas.toFixed(2)),
        total_costos: Number(cat.total_costos.toFixed(2)),
        utilidad_total: Number(utilidad.toFixed(2)),
        margen_promedio: Number(margen.toFixed(2))
      };
    })
      .filter((c) => c.total_productos > 0)
      .sort((a, b) => b.margen_promedio - a.margen_promedio);

    res.json({ ok: true, categorias });
  } catch (e) {
    console.error('Error /api/reportes/margen-categoria:', e.message || e);
    res.status(500).json({ ok: false, categorias: [], error: 'Error del servidor' });
  }
});

// Reporte top 10 utilidad por producto
app.get('/api/reportes/utilidad-top10', requiereRol('administrador'), async (req, res) => {
  try {
    const unitCostFifo = await buildFifoUnitCostFn(pool);
    const [rows] = await pool.query(
      `SELECT 
        p.id_producto,
        p.nombre,
        p.marca,
        p.precio_venta,
        COALESCE(ventas.unidades_vendidas, 0) AS unidades_vendidas,
        COALESCE(ventas.total_ventas, 0) AS total_ventas
      FROM productos p
      LEFT JOIN (
        SELECT id_producto,
               SUM(cantidad) AS unidades_vendidas,
               SUM(cantidad * precio_unitario) AS total_ventas
        FROM detalleventa
        GROUP BY id_producto
      ) ventas ON ventas.id_producto = p.id_producto
      WHERE COALESCE(ventas.unidades_vendidas, 0) > 0
        AND NOT (p.nombre = 'Producto eliminado' AND p.marca = '-')`
    );

    const productos = rows.map(r => {
      const unidades = Number(r.unidades_vendidas || 0);
      const totalVentas = Number(r.total_ventas || 0);
      const precio = Number(r.precio_venta || 0);
      const costo = unitCostFifo(r.id_producto, unidades);
      const utilidadTotal = totalVentas - (unidades * costo);
      const utilidadUnitaria = precio - costo;
      const margen = precio > 0 ? (utilidadUnitaria / precio) * 100 : 0;
      return {
        nombre: `${r.marca || ''} ${r.nombre || ''}`.trim(),
        costo_promedio: Number(costo.toFixed(4)),
        precio_venta: precio,
        utilidad_unitaria: Number(utilidadUnitaria.toFixed(4)),
        unidades_vendidas: unidades,
        total_ventas: Number(totalVentas.toFixed(2)),
        utilidad_total: Number(utilidadTotal.toFixed(2)),
        margen_porcentaje: Number(margen.toFixed(2))
      };
    }).sort((a, b) => b.utilidad_total - a.utilidad_total).slice(0, 10);

    res.json({ ok: true, productos });
  } catch (e) {
    console.error('Error /api/reportes/utilidad-top10:', e.message || e);
    res.status(500).json({ ok: false, productos: [], error: 'Error del servidor' });
  }
});

// ---------------- NUEVOS REPORTES ----------------
// Todos requieren rol de administrador

// Reporte de Ventas (Totales mensuales)
app.get('/api/reportes/ventas/mensual', requiereRol('administrador'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        DATE_FORMAT(fecha_hora, '%Y-%m') AS mes,
        SUM(total_venta) AS total_ventas,
        COUNT(id_venta) AS num_ventas
      FROM ventas
      WHERE fecha_hora >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
      GROUP BY mes
      ORDER BY mes ASC
    `);
    res.json({ ok: true, data: rows });
  } catch (e) {
    console.error('Error Reporte Ventas Mensuales:', e.message || e);
    res.status(500).json({ ok: false, error: 'Error al generar reporte de ventas.' });
  }
});

// Reporte de Compras (Totales mensuales)
app.get('/api/reportes/compras/mensual', requiereRol('administrador'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        DATE_FORMAT(fecha_compra, '%Y-%m') AS mes,
        SUM(total_compra) AS total_compras,
        COUNT(id_compra) AS num_compras
      FROM compras
      WHERE fecha_compra >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
      GROUP BY mes
      ORDER BY mes ASC
    `);
    res.json({ ok: true, data: rows });
  } catch (e) {
    console.error('Error Reporte Compras Mensuales:', e.message || e);
    res.status(500).json({ ok: false, error: 'Error al generar reporte de compras.' });
  }
});

// Reporte de Clientes (Top 10 por gasto)
app.get('/api/reportes/clientes/top', requiereRol('administrador'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        c.id_cliente,
        c.nombre,
        c.cedula,
        COALESCE(SUM(v.total_venta),0) AS gasto_total,
        COUNT(v.id_venta) AS total_compras
      FROM clientes c
      JOIN ventas v ON c.id_cliente = v.id_cliente
      GROUP BY c.id_cliente, c.nombre, c.cedula
      ORDER BY gasto_total DESC
      LIMIT 10
    `);
    res.json({ ok: true, data: rows });
  } catch (e) {
    console.error('Error Reporte Top Clientes:', e.message || e);
    res.status(500).json({ ok: false, error: 'Error al generar reporte de clientes.' });
  }
});

// Reporte de Temporada/Tendencias (Ventas agrupadas por Categoría en el último año)
app.get('/api/reportes/tendencias/categorias', requiereRol('administrador'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        cat.nombre AS categoria,
        SUM(dv.cantidad) AS unidades_vendidas,
        SUM(dv.cantidad * dv.precio_unitario) AS ingresos_categoria
      FROM detalleventa dv
      JOIN productos p ON dv.id_producto = p.id_producto
      JOIN categorias cat ON p.id_categoria = cat.id_categoria
      JOIN ventas v ON dv.id_venta = v.id_venta
      WHERE v.fecha_hora >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
      GROUP BY cat.nombre
      ORDER BY ingresos_categoria DESC
    `);
    res.json({ ok: true, data: rows });
  } catch (e) {
    console.error('Error Reporte Tendencias:', e.message || e);
    res.status(500).json({ ok: false, error: 'Error al generar reporte de tendencias.' });
  }
});

// Reporte Adicional: Rotación de Inventario Lenta (Productos sin venta en 90 días)
app.get('/api/reportes/inventario/lento', requiereRol('administrador'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        p.id_producto,
        p.nombre,
        p.precio_venta,
        MAX(v.fecha_hora) AS ultima_venta
      FROM productos p
      LEFT JOIN detalleventa dv ON p.id_producto = dv.id_producto
      LEFT JOIN ventas v ON dv.id_venta = v.id_venta
      GROUP BY p.id_producto
      HAVING ultima_venta IS NULL OR ultima_venta <= DATE_SUB(NOW(), INTERVAL 90 DAY)
      ORDER BY ultima_venta ASC
    `);
    res.json({ ok: true, data: rows });
  } catch (e) {
    console.error('Error Reporte Inventario Lento:', e.message || e);
    res.status(500).json({ ok: false, error: 'Error al generar reporte de inventario lento.' });
  }
});

app.get('/api/reportes/tipos-pago', requiereRol('administrador'), async (req, res) => {
  try {
    await ensureVentaPagosTable(pool);
    const start = req.query.start || null;
    const end = req.query.end || null;
    let where = '1=1';
    const params = [];
    if (start && end) {
      where = 'DATE(v.fecha_hora) >= ? AND DATE(v.fecha_hora) < ?';
      params.push(start, end);
    } else {
      // Mes actual por defecto
      where = 'v.fecha_hora >= DATE_FORMAT(CURDATE(), \'%Y-%m-01\')';
    }
    const tasaGuardada = await columnExists(pool, 'ventas', 'tasa_dolar');
    const montoBsFallback = tasaGuardada
      ? 'v.total_venta * COALESCE(v.tasa_dolar, 0)'
      : '0';
    const [rows] = await pool.query(
      `SELECT
         COALESCE(vp.forma_pago, COALESCE(NULLIF(TRIM(v.tipo_pago), ''), 'Efectivo')) AS forma_pago,
         COUNT(*) AS operaciones,
         COUNT(DISTINCT v.id_venta) AS ventas,
         COALESCE(SUM(COALESCE(vp.monto_usd, v.total_venta)), 0) AS total_usd,
         COALESCE(SUM(COALESCE(vp.monto_bs, ${montoBsFallback})), 0) AS total_bs
       FROM ventas v
       LEFT JOIN venta_pagos vp ON vp.id_venta = v.id_venta
       WHERE ${where}
       GROUP BY forma_pago
       ORDER BY total_usd DESC`,
      params
    );
    const [detalle] = await pool.query(
      `SELECT vp.id_pago, v.id_venta,
              COALESCE(vp.forma_pago, COALESCE(NULLIF(TRIM(v.tipo_pago), ''), 'Efectivo')) AS forma_pago,
              COALESCE(vp.monto_usd, v.total_venta) AS monto_usd,
              COALESCE(vp.monto_bs, ${montoBsFallback}) AS monto_bs,
              COALESCE(vp.tasa, ${tasaGuardada ? 'v.tasa_dolar' : 'NULL'}) AS tasa,
              v.fecha_hora, v.total_venta
       FROM ventas v
       LEFT JOIN venta_pagos vp ON vp.id_venta = v.id_venta
       WHERE ${where}
       ORDER BY v.fecha_hora DESC
       LIMIT 200`,
      params
    );
    const totalUsd = rows.reduce((s, r) => s + Number(r.total_usd || 0), 0);
    const totalBs = rows.reduce((s, r) => s + Number(r.total_bs || 0), 0);
    res.json({
      ok: true,
      resumen: rows,
      detalle,
      totales: { total_usd: totalUsd, total_bs: totalBs }
    });
  } catch (e) {
    console.error('Error /api/reportes/tipos-pago:', e.message || e);
    res.status(500).json({ ok: false, error: 'Error al generar reporte de tipos de pago' });
  }
});

// ==================== REPORTE DE GANANCIAS ====================
// Reporte de Ganancias: Ingresos totales - Costos totales en un período
app.get('/api/reportes/ganancias', requiereRol('administrador'), async (req, res) => {
  try {
    // Obtener parámetros de fecha (opcional)
    const startDate = req.query.start || null;
    const endDate = req.query.end || null;
    
    // Si no se proporcionan fechas, usar el mes actual
    let fechaInicio, fechaFin;
    if (startDate && endDate) {
      fechaInicio = startDate;
      fechaFin = endDate;
    } else {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      fechaInicio = `${year}-${String(month).padStart(2, '0')}-01`;
      const nextMonth = new Date(year, month, 1);
      fechaFin = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`;
    }
    
    // Calcular ingresos totales (ventas)
    const [ingresosRows] = await pool.query(
      `SELECT 
        COALESCE(SUM(total_venta), 0) AS total_ingresos,
        COUNT(*) AS total_ventas
      FROM ventas
      WHERE DATE(fecha_hora) >= ? AND DATE(fecha_hora) < ?`,
      [fechaInicio, fechaFin]
    );
    const totalIngresos = Number(ingresosRows[0]?.total_ingresos || 0);
    const totalVentas = Number(ingresosRows[0]?.total_ventas || 0);
    
    // Calcular costos totales (compras)
    const [costosRows] = await pool.query(
      `SELECT 
        COALESCE(SUM(total_compra), 0) AS total_costos,
        COUNT(*) AS total_compras
      FROM compras
      WHERE DATE(fecha_compra) >= ? AND DATE(fecha_compra) < ?`,
      [fechaInicio, fechaFin]
    );
    const totalCostos = Number(costosRows[0]?.total_costos || 0);
    const totalCompras = Number(costosRows[0]?.total_compras || 0);
    
    // Calcular ganancia neta
    const gananciaNeta = totalIngresos - totalCostos;
    const margenGanancia = totalIngresos > 0 ? ((gananciaNeta / totalIngresos) * 100) : 0;
    
    // Obtener desglose por día
    const [ingresosPorDia] = await pool.query(
      `SELECT 
        DATE(fecha_hora) AS fecha,
        COALESCE(SUM(total_venta), 0) AS ingresos_dia,
        COUNT(*) AS ventas_dia
      FROM ventas
      WHERE DATE(fecha_hora) >= ? AND DATE(fecha_hora) < ?
      GROUP BY DATE(fecha_hora)
      ORDER BY DATE(fecha_hora) ASC`,
      [fechaInicio, fechaFin]
    );
    
    const [costosPorDia] = await pool.query(
      `SELECT 
        DATE(fecha_compra) AS fecha,
        COALESCE(SUM(total_compra), 0) AS costos_dia,
        COUNT(*) AS compras_dia
      FROM compras
      WHERE DATE(fecha_compra) >= ? AND DATE(fecha_compra) < ?
      GROUP BY DATE(fecha_compra)
      ORDER BY DATE(fecha_compra) ASC`,
      [fechaInicio, fechaFin]
    );
    
    // Combinar ingresos y costos por día
    const diasMap = {};
    ingresosPorDia.forEach(row => {
      // Manejar diferentes formatos de fecha (Date object o string)
      let fechaStr;
      if (row.fecha instanceof Date) {
        fechaStr = row.fecha.toISOString().split('T')[0];
      } else if (typeof row.fecha === 'string') {
        fechaStr = row.fecha.split('T')[0];
      } else {
        fechaStr = String(row.fecha);
      }
      
      diasMap[fechaStr] = {
        fecha: fechaStr,
        ingresos: Number(row.ingresos_dia || 0),
        costos: 0,
        ganancia: 0,
        ventas: Number(row.ventas_dia || 0),
        compras: 0
      };
    });
    
    costosPorDia.forEach(row => {
      // Manejar diferentes formatos de fecha (Date object o string)
      let fechaStr;
      if (row.fecha instanceof Date) {
        fechaStr = row.fecha.toISOString().split('T')[0];
      } else if (typeof row.fecha === 'string') {
        fechaStr = row.fecha.split('T')[0];
      } else {
        fechaStr = String(row.fecha);
      }
      
      if (!diasMap[fechaStr]) {
        diasMap[fechaStr] = {
          fecha: fechaStr,
          ingresos: 0,
          costos: 0,
          ganancia: 0,
          ventas: 0,
          compras: 0
        };
      }
      diasMap[fechaStr].costos = Number(row.costos_dia || 0);
      diasMap[fechaStr].compras = Number(row.compras_dia || 0);
      diasMap[fechaStr].ganancia = diasMap[fechaStr].ingresos - diasMap[fechaStr].costos;
    });
    
    // Convertir a array y calcular ganancias
    const desglosePorDia = Object.values(diasMap).map(dia => ({
      ...dia,
      ganancia: dia.ingresos - dia.costos
    })).sort((a, b) => a.fecha.localeCompare(b.fecha));
    
    res.json({
      ok: true,
      periodo: {
        inicio: fechaInicio,
        fin: fechaFin
      },
      resumen: {
        total_ingresos: totalIngresos,
        total_costos: totalCostos,
        ganancia_neta: gananciaNeta,
        margen_ganancia: margenGanancia,
        total_ventas: totalVentas,
        total_compras: totalCompras
      },
      desglose_por_dia: desglosePorDia
    });
  } catch (e) {
    console.error('Error /api/reportes/ganancias:', e.message || e);
    res.status(500).json({ ok: false, error: 'Error al generar reporte de ganancias' });
  }
});

module.exports = { app, startServer, stopServer, pool };

if (require.main === module) {
  startServer().catch((e) => {
    console.error('No se pudo iniciar MAX:', e.message || e);
    process.exit(1);
  });
}
