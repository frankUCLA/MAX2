/**
 * Asistente de consulta MAX — solo lectura.
 * Interpreta preguntas en español y responde con datos reales de MySQL.
 * Opcional: si hay OPENAI_API_KEY o GEMINI_API_KEY, usa IA para entender mejor la pregunta
 * y luego consulta la BD (nunca inventa stock).
 */
const { columnExists, tableExists } = require('./licencias');

function cleanQuery(q) {
  return String(q || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[¿?¡!.,;:()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSearchTerms(text) {
  const stop = new Set([
    'a', 'al', 'de', 'del', 'la', 'las', 'el', 'los', 'un', 'una', 'unos', 'unas',
    'me', 'mi', 'tu', 'su', 'en', 'por', 'para', 'con', 'que', 'como', 'cual',
    'cuanto', 'cuanta', 'cuantos', 'cuantas', 'hay', 'tiene', 'tienen', 'tengo',
    'dime', 'decir', 'diga', 'quiero', 'saber', 'consulta', 'consultar', 'ver',
    'mostrar', 'busca', 'buscar', 'stock', 'inventario', 'existencia', 'existencias',
    'producto', 'productos', 'proveedor', 'proveedores', 'precio', 'precios',
    'disponible', 'disponibles', 'queda', 'quedan', 'quedo', 'hoy', 'ahora',
    'sistema', 'max', 'porfavor', 'favor', 'hola', 'buenas', 'buen', 'dias',
    'tardes', 'noches', 'gracias', 'sobre', 'acerca', 'info', 'informacion',
    'lista', 'listar', 'todos', 'todas', 'algun', 'alguna', 'este', 'esta'
  ]);
  return cleanQuery(text)
    .split(' ')
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !stop.has(w));
}

function detectIntent(raw) {
  const t = cleanQuery(raw);
  if (!t) return { intent: 'empty' };

  if (/(proveedor|proveedores|quien (me )?vende|suministra|contacto del proveedor)/.test(t)) {
    return { intent: 'proveedor' };
  }
  if (/(stock bajo|pocas existencias|por agotar|agotandose|bajo inventario|alerta stock)/.test(t)) {
    return { intent: 'stock_bajo' };
  }
  if (/(precio|vale|cuesta|cuanto cuesta|a como)/.test(t)) {
    return { intent: 'precio' };
  }
  if (/(cuantos|cuantas|cuanto|stock|inventario|existencia|hay de|tiene de|quedan|queda|disponible)/.test(t)
    || /(arroz|producto|marca)/.test(t)) {
    return { intent: 'stock' };
  }
  if (/(hola|buenos|buenas|ayuda|que puedes|que sabes)/.test(t)) {
    return { intent: 'ayuda' };
  }
  return { intent: 'stock' }; // por defecto intenta buscar producto
}

async function searchProductos(pool, terms, limit = 12) {
  if (!terms.length) return [];
  const hasBarcode = await columnExists(pool, 'productos', 'codigo_barras');
  const likeParts = [];
  const params = [];
  // Preferir coincidencia de frase completa si hay varias palabras
  const phrase = terms.join(' ');
  likeParts.push('(nombre LIKE ? OR marca LIKE ?' + (hasBarcode ? ' OR codigo_barras LIKE ?' : '') + ')');
  params.push('%' + phrase + '%', '%' + phrase + '%');
  if (hasBarcode) params.push('%' + phrase + '%');

  // También OR por cada término (más flexible)
  for (const term of terms.slice(0, 5)) {
    likeParts.push('(nombre LIKE ? OR marca LIKE ?' + (hasBarcode ? ' OR codigo_barras LIKE ?' : '') + ')');
    params.push('%' + term + '%', '%' + term + '%');
    if (hasBarcode) params.push('%' + term + '%');
  }

  const sql = `
    SELECT id_producto, nombre, marca, inventario, precio_venta
      ${hasBarcode ? ', codigo_barras' : ''}
    FROM productos
    WHERE NOT (nombre = 'Producto eliminado' AND marca = '-')
      AND (${likeParts.join(' OR ')})
    ORDER BY
      CASE
        WHEN LOWER(nombre) LIKE ? THEN 0
        WHEN LOWER(CONCAT(nombre,' ',IFNULL(marca,''))) LIKE ? THEN 1
        ELSE 2
      END,
      nombre
    LIMIT ${Number(limit) || 12}
  `;
  params.push('%' + phrase + '%', '%' + phrase + '%');
  const [rows] = await pool.query(sql, params);
  return rows || [];
}

async function searchProveedores(pool, terms, limit = 10) {
  const hasContacto = await columnExists(pool, 'proveedores', 'contacto');
  const hasTel = await columnExists(pool, 'proveedores', 'telefono');
  const cols = ['id_proveedor', 'nombre'];
  if (hasContacto) cols.push('contacto');
  if (hasTel) cols.push('telefono');

  if (!terms.length) {
    const [all] = await pool.query(
      `SELECT ${cols.join(', ')} FROM proveedores ORDER BY nombre LIMIT ${Number(limit) || 10}`
    );
    return all || [];
  }

  const phrase = terms.join(' ');
  const [rows] = await pool.query(
    `SELECT ${cols.join(', ')} FROM proveedores
     WHERE nombre LIKE ? ${hasContacto ? 'OR contacto LIKE ?' : ''}
     ORDER BY nombre LIMIT ${Number(limit) || 10}`,
    hasContacto ? ['%' + phrase + '%', '%' + phrase + '%'] : ['%' + phrase + '%']
  );
  return rows || [];
}

async function productosDeProveedor(pool, idProveedor, limit = 15) {
  const [rows] = await pool.query(
    `SELECT id_producto, nombre, marca, inventario, precio_venta
     FROM productos
     WHERE id_proveedor = ?
       AND NOT (nombre = 'Producto eliminado' AND marca = '-')
     ORDER BY nombre
     LIMIT ?`,
    [idProveedor, limit]
  );
  return rows || [];
}

async function stockBajo(pool, limit = 15) {
  const hasMin = await columnExists(pool, 'productos', 'stock_minimo');
  if (hasMin) {
    const [rows] = await pool.query(
      `SELECT id_producto, nombre, marca, inventario, stock_minimo, precio_venta
       FROM productos
       WHERE stock_minimo > 0 AND inventario <= stock_minimo
         AND NOT (nombre = 'Producto eliminado' AND marca = '-')
       ORDER BY inventario ASC
       LIMIT ?`,
      [limit]
    );
    return rows || [];
  }
  const [rows] = await pool.query(
    `SELECT id_producto, nombre, marca, inventario, precio_venta
     FROM productos
     WHERE inventario <= 5
       AND NOT (nombre = 'Producto eliminado' AND marca = '-')
     ORDER BY inventario ASC
     LIMIT ?`,
    [limit]
  );
  return rows || [];
}

function fmtMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return '$' + v.toFixed(2);
}

function fmtStockLine(p) {
  const nom = [p.nombre, p.marca].filter(Boolean).join(' · ');
  const stock = Number(p.inventario);
  const stockTxt = Number.isFinite(stock) ? String(stock) : '—';
  return `• ${nom}: stock ${stockTxt}` + (p.precio_venta != null ? ` · ${fmtMoney(p.precio_venta)}` : '');
}

async function maybeAiRewrite(pregunta, factsText) {
  const openaiKey = (process.env.OPENAI_API_KEY || '').trim();
  const geminiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
  if (!openaiKey && !geminiKey) return null;

  const system =
    'Eres el asistente de consulta de MAX ERP. Solo consulta (nunca inventes datos). ' +
    'Responde en español, breve y claro, usando ÚNICAMENTE los hechos de la base de datos que te pasan. ' +
    'Si no hay datos, dilo. No inventes stock ni precios.';

  const user =
    `Pregunta del usuario: ${pregunta}\n\nHechos de la base de datos:\n${factsText}\n\nRedacta la respuesta final.`;

  try {
    if (openaiKey) {
      const fetch = require('node-fetch');
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + openaiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
          temperature: 0.2,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ]
        })
      });
      const j = await r.json();
      const txt = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      return txt ? String(txt).trim() : null;
    }
    if (geminiKey) {
      const fetch = require('node-fetch');
      const url =
        'https://generativelanguage.googleapis.com/v1beta/models/' +
        (process.env.GEMINI_MODEL || 'gemini-1.5-flash') +
        ':generateContent?key=' +
        encodeURIComponent(geminiKey);
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: system + '\n\n' + user }] }]
        })
      });
      const j = await r.json();
      const txt =
        j &&
        j.candidates &&
        j.candidates[0] &&
        j.candidates[0].content &&
        j.candidates[0].content.parts &&
        j.candidates[0].content.parts[0] &&
        j.candidates[0].content.parts[0].text;
      return txt ? String(txt).trim() : null;
    }
  } catch (e) {
    console.warn('[asistente] IA opcional falló:', e.message || e);
  }
  return null;
}

async function responderConsulta(pool, pregunta) {
  const raw = String(pregunta || '').trim();
  if (!raw) {
    return {
      ok: true,
      respuesta:
        'Pregúntame por ejemplo: “¿cuántos Arroz Mary hay?”, “precio del producto X” o “proveedor de Y”.',
      datos: []
    };
  }

  const { intent } = detectIntent(raw);
  const terms = extractSearchTerms(raw);

  if (intent === 'ayuda' || intent === 'empty') {
    return {
      ok: true,
      respuesta:
        'Soy el asistente de consulta de MAX. Puedo decirte stock, precios, stock bajo y proveedores. Ejemplo: “¿cuántos Arroz Mary hay en inventario?”',
      datos: []
    };
  }

  if (intent === 'stock_bajo') {
    const rows = await stockBajo(pool, 15);
    if (!rows.length) {
      return { ok: true, respuesta: 'No hay productos en alerta de stock bajo ahora mismo.', datos: [] };
    }
    const facts = rows.map(fmtStockLine).join('\n');
    const base =
      `Hay ${rows.length} producto(s) con stock bajo:\n` + facts;
    const ai = await maybeAiRewrite(raw, base);
    return { ok: true, respuesta: ai || base, datos: rows, intent };
  }

  if (intent === 'proveedor') {
    // Si menciona producto, buscar proveedor vía productos
    let provRows = await searchProveedores(pool, terms, 8);
    let extra = '';
    if (terms.length && (await columnExists(pool, 'productos', 'id_proveedor'))) {
      const prods = await searchProductos(pool, terms, 8);
      if (prods.length) {
        const ids = [...new Set(prods.map((p) => p.id_producto))];
        const [linked] = await pool.query(
          `SELECT p.id_producto, p.nombre, p.marca, p.inventario, pr.id_proveedor, pr.nombre AS proveedor
           FROM productos p
           LEFT JOIN proveedores pr ON pr.id_proveedor = p.id_proveedor
           WHERE p.id_producto IN (${ids.map(() => '?').join(',')})`,
          ids
        );
        if (linked && linked.length) {
          extra =
            '\nSegún productos:\n' +
            linked
              .map((r) => {
                const nom = [r.nombre, r.marca].filter(Boolean).join(' · ');
                return `• ${nom} → proveedor: ${r.proveedor || 'sin asignar'} (stock ${r.inventario})`;
              })
              .join('\n');
        }
      }
    }

    if (!provRows.length && !extra) {
      return {
        ok: true,
        respuesta: terms.length
          ? `No encontré proveedores ni productos con “${terms.join(' ')}”.`
          : 'No hay proveedores registrados.',
        datos: []
      };
    }

    const list = provRows
      .map((p) => {
        const bits = [p.nombre];
        if (p.contacto) bits.push('contacto ' + p.contacto);
        if (p.telefono) bits.push('tel ' + p.telefono);
        return '• ' + bits.join(' · ');
      })
      .join('\n');
    const base =
      (provRows.length ? `Proveedores:\n${list}` : 'No hay coincidencia directa de proveedor.') +
      (extra || '');
    const ai = await maybeAiRewrite(raw, base);
    return { ok: true, respuesta: ai || base, datos: provRows, intent };
  }

  // stock / precio
  if (!terms.length) {
    return {
      ok: true,
      respuesta: 'Dime el nombre del producto. Ejemplo: “¿cuántos Arroz Mary hay?”',
      datos: []
    };
  }

  const productos = await searchProductos(pool, terms, 12);
  if (!productos.length) {
    return {
      ok: true,
      respuesta: `No encontré productos que coincidan con “${terms.join(' ')}”. Revisa el nombre o la marca.`,
      datos: []
    };
  }

  let base;
  if (intent === 'precio') {
    base =
      productos.length === 1
        ? `El precio de ${productos[0].nombre}${productos[0].marca ? ' (' + productos[0].marca + ')' : ''} es ${fmtMoney(productos[0].precio_venta)}. Stock actual: ${productos[0].inventario}.`
        : `Encontré ${productos.length} productos:\n` +
          productos.map((p) => `• ${[p.nombre, p.marca].filter(Boolean).join(' · ')}: ${fmtMoney(p.precio_venta)} (stock ${p.inventario})`).join('\n');
  } else if (productos.length === 1) {
    const p = productos[0];
    const nom = [p.nombre, p.marca].filter(Boolean).join(' ');
    base = `En el inventario tienes un stock de ${p.inventario} de ${nom}. Precio de venta: ${fmtMoney(p.precio_venta)}.`;
  } else {
    base =
      `Encontré ${productos.length} coincidencias:\n` +
      productos.map(fmtStockLine).join('\n');
  }

  const ai = await maybeAiRewrite(raw, base);
  return { ok: true, respuesta: ai || base, datos: productos, intent };
}

function registerAsistenteRoutes(app, { pool, requiereRol }) {
  app.post('/api/asistente/consulta', requiereRol('administrador'), async (req, res) => {
    try {
      const pregunta = (req.body && (req.body.pregunta || req.body.q || req.body.mensaje)) || '';
      // Forzar modo solo lectura: no aceptar acciones
      const t = cleanQuery(pregunta);
      if (/(borrar|eliminar|editar|crear|agregar|modificar|actualizar|vender|cobrar|pagar)/.test(t)) {
        return res.json({
          ok: true,
          respuesta:
            'Solo puedo consultar. Para registrar o modificar usa MAX en la PC.',
          datos: []
        });
      }
      if (!(await tableExists(pool, 'productos'))) {
        return res.status(503).json({ ok: false, error: 'Base de productos no disponible' });
      }
      const out = await responderConsulta(pool, pregunta);
      res.json(out);
    } catch (e) {
      console.error('asistente/consulta:', e.message || e);
      res.status(500).json({ ok: false, error: 'No pude consultar ahora' });
    }
  });
}

module.exports = { registerAsistenteRoutes, responderConsulta };
