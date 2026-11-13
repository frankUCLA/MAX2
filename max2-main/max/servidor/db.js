// servidor/db.js
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'MAX',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

async function verificarConexiónBD() {
  try {
    const [rows] = await pool.query('SELECT 1');
    return true;
  } catch (e) {
    console.error('Error BD:', e.message); // Comentado para evitar llenar la consola en funcionamiento normal
    return false;
  }
}

// Ejemplo: obtener 10 productos (No usado en servidor.js, pero mantenido)
async function obtenerProductos(limit = 10) {
  const [rows] = await pool.query('SELECT id_producto, nombre, precio_venta FROM productos LIMIT ?', [limit]);
  return rows;
}

// Exporta funciones que necesitarás
module.exports = { pool, verificarConexiónBD, obtenerProductos };