// servidor/uploads.js — multer config for product images (persistente en AppData)
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { resolveApp, resolveData, ensureDir, dataRoot, appRoot } = require('./paths');

/** Imágenes fuera de Program Files → sin EPERM y sobreviven reinstalar */
const uploadDir = ensureDir(resolveData('uploads', 'images'));

function copyFileIfMissing(src, dest) {
  try {
    if (!fs.existsSync(src) || fs.existsSync(dest)) return false;
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
    return true;
  } catch (e) {
    console.warn('[uploads] No se pudo migrar', src, e.message || e);
    return false;
  }
}

/** Copia imágenes de instalaciones anteriores (public/uploads) hacia AppData */
function migrateLegacyUploads() {
  const legacyCandidates = [
    resolveApp('public', 'uploads', 'images'),
    resolveApp('public', 'uploads'),
    path.join(appRoot, 'public', 'uploads', 'images'),
    path.join(appRoot, 'public', 'uploads')
  ];
  let migrated = 0;
  for (const legacy of legacyCandidates) {
    if (!legacy || !fs.existsSync(legacy)) continue;
    let entries;
    try {
      entries = fs.readdirSync(legacy, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      const src = path.join(legacy, ent.name);
      const dest = path.join(uploadDir, ent.name);
      if (copyFileIfMissing(src, dest)) migrated += 1;
    }
  }
  if (migrated > 0) {
    console.log(`[uploads] Migradas ${migrated} imagen(es) a ${uploadDir}`);
  }
  return migrated;
}

function ensureUploadsReady() {
  ensureDir(uploadDir);
  ensureDir(resolveData('uploads'));
  migrateLegacyUploads();
  return uploadDir;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    try {
      ensureDir(uploadDir);
      cb(null, uploadDir);
    } catch (e) {
      cb(e);
    }
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    const safe = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '.jpg';
    cb(null, `prod-${Date.now()}-${Math.round(Math.random() * 1e6)}${safe}`);
  }
});

function fileFilter(_req, file, cb) {
  if (!file.mimetype || !file.mimetype.startsWith('image/')) {
    return cb(new Error('Solo se permiten archivos de imagen'));
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }
});

/** Public URL path for a stored filename */
function publicImagePath(filename) {
  if (!filename) return null;
  return `/uploads/images/${path.basename(filename)}`;
}

/** Absolute path on disk for a public ruta_imagen or filename */
function absoluteImagePath(rutaOrFilename) {
  if (!rutaOrFilename) return null;
  const base = path.basename(String(rutaOrFilename));
  const primary = path.join(uploadDir, base);
  if (fs.existsSync(primary)) return primary;
  const legacy = path.join(resolveApp('public', 'uploads', 'images'), base);
  if (fs.existsSync(legacy)) return legacy;
  return primary;
}

function hashFileSync(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function safeUnlink(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_) {}
}

/**
 * Busca si el archivo subido es idéntico (mismo contenido) a la imagen de otro producto.
 */
async function findDuplicateImageProduct(uploadedAbsPath, pool, excludeProductId = null) {
  if (!uploadedAbsPath || !fs.existsSync(uploadedAbsPath)) return null;
  let newHash;
  let newSize;
  try {
    newSize = fs.statSync(uploadedAbsPath).size;
    newHash = hashFileSync(uploadedAbsPath);
  } catch (_) {
    return null;
  }

  const [rows] = await pool.query(
    `SELECT id_producto, nombre, marca, ruta_imagen
     FROM productos
     WHERE ruta_imagen IS NOT NULL
       AND TRIM(ruta_imagen) != ''
       AND NOT (nombre = 'Producto eliminado' AND marca = '-')`
  );

  const exclude = excludeProductId != null && excludeProductId !== ''
    ? Number(excludeProductId)
    : null;

  for (const row of rows || []) {
    if (exclude != null && Number(row.id_producto) === exclude) continue;
    const abs = absoluteImagePath(row.ruta_imagen);
    if (!abs || !fs.existsSync(abs)) continue;
    try {
      if (fs.statSync(abs).size !== newSize) continue;
      if (hashFileSync(abs) === newHash) return row;
    } catch (_) {}
  }
  return null;
}

// Preparar carpeta al cargar el módulo
ensureUploadsReady();

module.exports = {
  upload,
  uploadDir,
  dataRoot,
  publicImagePath,
  absoluteImagePath,
  findDuplicateImageProduct,
  safeUnlink,
  hashFileSync,
  ensureUploadsReady,
  migrateLegacyUploads
};
