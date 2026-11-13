/**
 * Actualizaciones MAX vía GitHub Releases (tú = proveedor).
 *
 * 1) Crea un repo PÚBLICO en GitHub solo para instaladores, ej: max-updates
 *    (NO subas tu código ahí; solo Releases con los .exe)
 * 2) Pon abajo tu usuario y el nombre del repo
 * 3) Genera el Setup de nuevo y publícalo como Release
 *
 * Los clientes SOLO descargan el instalador. No envían datos de su negocio.
 */
module.exports = {
  PROVIDER: 'github',

  // ← Cámbialos por los tuyos (ejemplo: owner: 'juanperez', repo: 'max-updates')
  GITHUB_OWNER: 'TU_USUARIO_GITHUB',
  GITHUB_REPO: 'max-updates'
};
