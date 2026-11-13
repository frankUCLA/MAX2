// servidor/paths.js — raíz de la app y datos persistentes (desarrollo, pkg o Electron)
const path = require('path');
const fs = require('fs');

const isPkg = typeof process.pkg !== 'undefined';
const isElectron = !!(process.versions && process.versions.electron);

function computeAppRoot() {
  if (process.env.MAX_APP_ROOT && String(process.env.MAX_APP_ROOT).trim()) {
    return path.resolve(String(process.env.MAX_APP_ROOT).trim());
  }
  if (isPkg) {
    return path.dirname(process.execPath);
  }
  // Desarrollo / Electron no empaquetado: carpeta del proyecto
  return path.join(__dirname, '..');
}

/**
 * Datos escribibles que sobreviven desinstalar/reinstalar.
 * Preferencia: MAX_DATA_ROOT → %APPDATA%\MAX (instalado) → <app>/data (dev).
 */
function computeDataRoot() {
  if (process.env.MAX_DATA_ROOT && String(process.env.MAX_DATA_ROOT).trim()) {
    return path.resolve(String(process.env.MAX_DATA_ROOT).trim());
  }
  const root = computeAppRoot();
  const installed = /[\\/]Programs[\\/]MAX|[\\/]Program Files/i.test(root);
  if (process.env.APPDATA && (installed || (isElectron && process.env.MAX_APP_ROOT))) {
    return path.join(process.env.APPDATA, 'MAX');
  }
  return path.join(root, 'data');
}

const appRoot = computeAppRoot();
const dataRoot = computeDataRoot();

function resolveApp(...parts) {
  return path.join(appRoot, ...parts);
}

function resolveData(...parts) {
  return path.join(dataRoot, ...parts);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = {
  isPkg,
  isElectron,
  appRoot,
  dataRoot,
  resolveApp,
  resolveData,
  ensureDir,
  computeAppRoot,
  computeDataRoot
};
