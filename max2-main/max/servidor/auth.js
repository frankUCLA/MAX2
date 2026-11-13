// servidor/auth.js
const bcrypt = require('bcryptjs');

async function verificarCredenciales(reqUsuario, reqPassword, db) {
  // Consulta simple del usuario en BD
  // Asume tabla Usuarios: id_usuario, usuario, password_hash, id_rol
  try {
    const [rows] = await db.pool.query(
      'SELECT id_usuario, usuario, password_hash, id_rol FROM Usuarios WHERE usuario = ?',
      [reqUsuario]
    );
    if (!rows || rows.length === 0) return null;
    const user = rows[0];
    const match = await bcrypt.compare(reqPassword, user.password_hash);
    if (!match) return null;
    // Retornar usuario (sin password_hash)
    return { id: user.id_usuario, usuario: user.usuario, id_rol: user.id_rol };
  } catch (e) {
    console.error('Auth error:', e);
    return null;
  }
}

module.exports = { verificarCredenciales };