// servidor/planes.js — un solo sistema: el plan crece al agregar cajas (con clave del siguiente nivel)
//
// BASICO   → 2 cajas   (clave básica)
// ESTANDAR → 4 cajas   (al pasar de 2 hace falta clave Standard)
// PRO      → 8 cajas   (al pasar de 4 hace falta clave Pro)
// ULTRA    → 15 cajas  (al pasar de 8 hace falta clave Ultra)

const crypto = require('crypto');

const PLANES_ORDEN = ['BASICO', 'ESTANDAR', 'PRO', 'ULTRA'];

const PLANES = {
  BASICO: {
    codigo: 'BASICO',
    nombre: 'Básico',
    limite_cajas: 2,
    token: 'MAX-BASIC-0001',
    notas: 'Plan Básico — hasta 2 cajas POS',
    envKey: 'LICENCIA_KEY_BASICO',
    defaultKey: 'MAX-KEY-BASICO-7701'
  },
  ESTANDAR: {
    codigo: 'ESTANDAR',
    nombre: 'Standard',
    limite_cajas: 4,
    token: 'MAX-STD-0001',
    notas: 'Plan Standard — hasta 4 cajas POS',
    envKey: 'LICENCIA_KEY_STANDARD',
    defaultKey: 'MAX-KEY-STANDARD-8802'
  },
  PRO: {
    codigo: 'PRO',
    nombre: 'Pro',
    limite_cajas: 8,
    token: 'MAX-PRO-0001',
    notas: 'Plan Pro — hasta 8 cajas POS',
    envKey: 'LICENCIA_KEY_PRO',
    defaultKey: 'MAX-KEY-PRO-9903'
  },
  ULTRA: {
    codigo: 'ULTRA',
    nombre: 'Ultra',
    limite_cajas: 15,
    token: 'MAX-ULTRA-0001',
    notas: 'Plan Ultra — hasta 15 cajas POS',
    envKey: 'LICENCIA_KEY_ULTRA',
    defaultKey: 'MAX-KEY-ULTRA-0014'
  }
};

function normalizePlanCodigo(raw) {
  const k = String(raw || '').trim().toUpperCase();
  if (k === 'STANDARD' || k === 'ESTANDAR') return 'ESTANDAR';
  if (PLANES[k]) return k;
  return 'BASICO';
}

function getPlan(codigo) {
  return PLANES[normalizePlanCodigo(codigo)] || PLANES.BASICO;
}

function getPlanKey(codigo) {
  const plan = getPlan(codigo);
  const fromEnv = process.env[plan.envKey];
  if (fromEnv && String(fromEnv).trim()) return String(fromEnv).trim();
  // Compat: LICENCIA_MASTER_KEY solo vale como clave del Básico
  if (plan.codigo === 'BASICO' && process.env.LICENCIA_MASTER_KEY) {
    return String(process.env.LICENCIA_MASTER_KEY).trim();
  }
  return plan.defaultKey;
}

function keysMatch(ingresada, esperada) {
  const a = String(ingresada || '').trim();
  const b = String(esperada || '').trim();
  if (!a || !b) return false;
  try {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch (_) {
    return a === b;
  }
}

function nextPlanCodigo(codigoActual) {
  const cur = normalizePlanCodigo(codigoActual);
  const i = PLANES_ORDEN.indexOf(cur);
  if (i < 0 || i >= PLANES_ORDEN.length - 1) return null;
  return PLANES_ORDEN[i + 1];
}

/**
 * Decide si la clave permite registrar una caja más.
 * - Si aún hay cupo en el plan actual → pide la clave de ESE plan.
 * - Si el cupo está lleno → pide la clave del SIGUIENTE plan y, si es correcta, sube de plan.
 */
function evaluarClaveParaNuevaCaja(licencia, cajasActivas, claveIngresada) {
  const planActual = getPlan(licencia && licencia.tipo_plan);
  const usadas = Number(cajasActivas) || 0;
  const limite = Number(planActual.limite_cajas) || 2;

  if (usadas < limite) {
    const key = getPlanKey(planActual.codigo);
    if (!keysMatch(claveIngresada, key)) {
      return {
        ok: false,
        error: `Clave incorrecta para el plan ${planActual.nombre}. Cupos POS: ${usadas}/${limite}.`
      };
    }
    return {
      ok: true,
      upgrade: false,
      plan: planActual,
      mensaje: null
    };
  }

  // Cupo lleno → necesita upgrade
  const nextCodigo = nextPlanCodigo(planActual.codigo);
  if (!nextCodigo) {
    return {
      ok: false,
      error: `El plan ${planActual.nombre} ya está al máximo (${limite} cajas). No hay un plan superior.`
    };
  }
  const next = getPlan(nextCodigo);
  const nextKey = getPlanKey(next.codigo);
  if (!keysMatch(claveIngresada, nextKey)) {
    return {
      ok: false,
      error: `Cupos del plan ${planActual.nombre} llenos (${usadas}/${limite}). Para pasar a ${next.nombre} (${next.limite_cajas} cajas) ingresa la clave de autorización ${next.nombre}.`
    };
  }
  return {
    ok: true,
    upgrade: true,
    plan: next,
    mensaje: `Licencia actualizada a ${next.nombre} (${next.limite_cajas} cajas).`
  };
}

async function ensureLicenciasEnum(pool) {
  try {
    await pool.query(
      `ALTER TABLE licencias
       MODIFY COLUMN tipo_plan
       ENUM('BASICO','ESTANDAR','PRO','ULTRA','ENTERPRISE')
       NOT NULL DEFAULT 'BASICO'`
    );
  } catch (_) {}
}

/** Si no hay licencia, crea BASICO (2). No degrada un plan ya superior. */
async function ensureLicenseBaseline(pool) {
  const [tables] = await pool.query(
    `SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'licencias' LIMIT 1`
  );
  if (!tables.length) return null;
  await ensureLicenciasEnum(pool);

  const [active] = await pool.query(
    'SELECT * FROM licencias WHERE activa = 1 ORDER BY id_licencia DESC LIMIT 1'
  );
  if (active.length) return active[0];

  const basico = PLANES.BASICO;
  await pool.query(
    `INSERT INTO licencias (cliente, tipo_plan, limite_cajas, token_licencia, activa, notas)
     VALUES ('Frankelvis Ramos', ?, ?, ?, 1, ?)`,
    [basico.codigo, basico.limite_cajas, basico.token, basico.notas]
  );
  const [rows] = await pool.query(
    'SELECT * FROM licencias WHERE activa = 1 ORDER BY id_licencia DESC LIMIT 1'
  );
  return rows[0] || null;
}

async function aplicarUpgradePlan(pool, plan) {
  await ensureLicenciasEnum(pool);
  const [active] = await pool.query(
    'SELECT id_licencia FROM licencias WHERE activa = 1 ORDER BY id_licencia DESC LIMIT 1'
  );
  if (active.length) {
    await pool.query(
      `UPDATE licencias
       SET tipo_plan = ?, limite_cajas = ?, token_licencia = ?, notas = ?, activa = 1
       WHERE id_licencia = ?`,
      [plan.codigo, plan.limite_cajas, plan.token, plan.notas, active[0].id_licencia]
    );
  } else {
    await pool.query(
      `INSERT INTO licencias (cliente, tipo_plan, limite_cajas, token_licencia, activa, notas)
       VALUES ('Frankelvis Ramos', ?, ?, ?, 1, ?)`,
      [plan.codigo, plan.limite_cajas, plan.token, plan.notas]
    );
  }
}

/** Alias de arranque (ya no fuerza Standard/Pro/Ultra por carpeta). */
async function ensureLicenseFromEnv(pool) {
  return ensureLicenseBaseline(pool);
}

module.exports = {
  PLANES,
  PLANES_ORDEN,
  getPlan,
  getPlanKey,
  keysMatch,
  nextPlanCodigo,
  evaluarClaveParaNuevaCaja,
  ensureLicenseBaseline,
  ensureLicenseFromEnv,
  aplicarUpgradePlan,
  normalizePlanCodigo
};
