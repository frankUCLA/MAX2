/**
 * MAX — aplicación de escritorio (Electron)
 * Arranca el servidor Express local o conecta a uno ya en marcha / remoto.
 */
const { app, BrowserWindow, dialog, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os'); 

const isDev = !app.isPackaged;
const projectRoot = isDev
  ? path.join(__dirname, '..')
  : process.resourcesPath;

const appRoot = isDev
  ? projectRoot
  : (process.env.MAX_APP_ROOT || path.dirname(process.execPath));

process.env.MAX_APP_ROOT = appRoot;

// Datos persistentes (imágenes, tasa, etc.): sobreviven desinstalar/reinstalar
const dataRoot = isDev
  ? path.join(projectRoot, 'data')
  : path.join(app.getPath('appData'), 'MAX');
try {
  app.setPath('userData', dataRoot);
} catch (_) {}
try {
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.mkdirSync(path.join(dataRoot, 'uploads', 'images'), { recursive: true });
} catch (_) {}
process.env.MAX_DATA_ROOT = dataRoot;

const logFile = path.join(appRoot, 'max-desktop.log');

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(' ')}\n`;
  try { fs.appendFileSync(logFile, line); } catch (_) {}
  try { console.log(...args); } catch (_) {}
}

function ensureEnvFile() {
  const envPath = path.join(appRoot, '.env');
  const requiredKeys = {
    LICENCIA_KEY_BASICO: 'MAX-KEY-BASICO-7701',
    LICENCIA_MASTER_KEY: 'MAX-KEY-BASICO-7701',
    LICENCIA_KEY_STANDARD: 'MAX-KEY-STANDARD-8802',
    LICENCIA_KEY_PRO: 'MAX-KEY-PRO-9903',
    LICENCIA_KEY_ULTRA: 'MAX-KEY-ULTRA-0014'
  };
  const fallback = [
    'PORT=3000',
    'CAJA_MAYOR_PORT=3011',
    'DB_USER=root',
    'DB_PASSWORD=',
    'DB_HOST=127.0.0.1',
    'DB_PORT=3306',
    'DB_NAME=MAX',
    'LICENCIA_KEY_BASICO=MAX-KEY-BASICO-7701',
    'LICENCIA_MASTER_KEY=MAX-KEY-BASICO-7701',
    'LICENCIA_KEY_STANDARD=MAX-KEY-STANDARD-8802',
    'LICENCIA_KEY_PRO=MAX-KEY-PRO-9903',
    'LICENCIA_KEY_ULTRA=MAX-KEY-ULTRA-0014'
  ].join('\n') + '\n';

  try {
    if (!fs.existsSync(envPath)) {
      const example = path.join(appRoot, '.env.example');
      if (fs.existsSync(example)) fs.copyFileSync(example, envPath);
      else fs.writeFileSync(envPath, fallback, 'utf8');
      log('Creado .env en', envPath);
    } else {
      let txt = fs.readFileSync(envPath, 'utf8');
      const missing = [];
      for (const [k, v] of Object.entries(requiredKeys)) {
        if (!new RegExp('^' + k + '=', 'm').test(txt)) {
          missing.push(k + '=' + v);
        }
      }
      if (missing.length) {
        if (!txt.endsWith('\n')) txt += '\n';
        txt += missing.join('\n') + '\n';
        fs.writeFileSync(envPath, txt, 'utf8');
        log('Se agregaron claves de licencia faltantes al .env');
      }
    }
  } catch (e) {
    log('No se pudo crear/actualizar .env:', e.message);
  }
  return envPath;
}

try {
  const envPath = ensureEnvFile();
  require('dotenv').config({ path: envPath });
} catch (_) {}

let mainWindow = null;
let stopServerFn = null;
let startedLocalServer = false;
let shuttingDown = false;

let PORT = Number(process.env.PORT || 3000);
const remoteUrl = (process.env.MAX_SERVER_URL || '').trim().replace(/\/$/, '');

function loadUpdateConfig() {
  try {
    return require('./update-config');
  } catch (_) {
    return {};
  }
}

function iconPath() {
  const candidates = [
    path.join(appRoot, 'public', 'common', 'assets', 'images.png'),
    path.join(projectRoot, 'public', 'common', 'assets', 'images.png'),
    path.join(__dirname, '..', 'public', 'common', 'assets', 'images.png')
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

function probeUrl(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function waitForUrl(url, timeoutMs = 45000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = async () => {
      const ok = await probeUrl(url, 2000);
      if (ok) return resolve(true);
      if (Date.now() - start > timeoutMs) {
        return reject(new Error('El servidor no respondió a tiempo en ' + url));
      }
      setTimeout(tryOnce, 400);
    };
    tryOnce();
  });
}

async function startLocalServer(port) {
  const servidorPath = isDev
    ? path.join(projectRoot, 'servidor', 'servidor.js')
    : path.join(app.getAppPath(), 'servidor', 'servidor.js');

  log('Cargando servidor desde', servidorPath);
  const { startServer, stopServer } = require(servidorPath);
  stopServerFn = stopServer;
  await startServer({ port, host: process.env.HOST || '0.0.0.0' });
  startedLocalServer = true;
  return `http://127.0.0.1:${port}`;
}

/** Si el puerto está ocupado, reutiliza ese servidor o prueba otros puertos */
async function resolveLocalUrl() {
  const preferred = Number(process.env.PORT || 3000) || 3000;
  const candidates = [preferred, 3001, 3002, 3003, 3010];

  for (const port of candidates) {
    const url = `http://127.0.0.1:${port}`;
    const alive = await probeUrl(url);
    if (alive) {
      PORT = port;
      log('Usando servidor ya activo en', url);
      return url;
    }
  }

  for (const port of candidates) {
    try {
      const url = await startLocalServer(port);
      PORT = port;
      log('Servidor local iniciado en', url);
      return url;
    } catch (e) {
      const msg = (e && e.message) ? e.message : String(e);
      log('No se pudo abrir puerto', port, msg);
      if (/EADDRINUSE|en uso|already/i.test(msg)) continue;
      // Error real (MySQL, etc.) — no seguir ciegamente
      if (!/EADDRINUSE/i.test(msg)) throw e;
    }
  }
  throw new Error('No hay puerto libre (3000–3010) y no hay servidor MAX activo.');
}

function setupSilentPrintIpc() {
  if (setupSilentPrintIpc._done) return;
  setupSilentPrintIpc._done = true;
  ipcMain.handle('print-html-silent', async (_event, html) => {
    const content = String(html || '');
    if (!content.trim()) return { ok: false, error: 'HTML vacío' };
    const tmp = path.join(os.tmpdir(), `max-factura-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
    try {
      fs.writeFileSync(tmp, content, 'utf8');
    } catch (e) {
      return { ok: false, error: e.message || 'No se pudo crear archivo temporal' };
    }
    return await new Promise((resolve) => {
      let settled = false;
      const finish = (ok, error) => {
        if (settled) return;
        settled = true;
        try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
        try { if (printWin && !printWin.isDestroyed()) printWin.destroy(); } catch (_) {}
        resolve({ ok: !!ok, error: error || null });
      };
      let printWin = null;
      try {
        printWin = new BrowserWindow({
          show: false,
          width: 400,
          height: 600,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
          }
        });
        printWin.webContents.once('did-fail-load', (_e, code, desc) => {
          finish(false, desc || ('load fail ' + code));
        });
        printWin.webContents.once('did-finish-load', async () => {
          try {
            await printWin.webContents.executeJavaScript(`(async () => {
              if (document.fonts && document.fonts.ready) await document.fonts.ready;
            })()`);
            await new Promise(resolve => setTimeout(resolve, 300));
            if (!printWin || printWin.isDestroyed()) {
              return finish(false, 'La ventana de impresión se cerró antes de imprimir');
            }
            printWin.webContents.print(
              { silent: true, printBackground: true, deviceName: '' },
              (success, failureReason) => {
                if (!success) {
                  finish(false, failureReason || 'Impresión silenciosa falló');
                  return;
                }
                // Keep the renderer alive briefly while Chromium hands the job
                // off to the Windows print spooler, especially on first print.
                setTimeout(() => finish(true), 750);
              }
            );
          } catch (e) {
            finish(false, e.message || String(e));
          }
        });
        printWin.loadFile(tmp).catch((e) => finish(false, e.message || String(e)));
        setTimeout(() => finish(false, 'Tiempo agotado imprimiendo'), 45000);
      } catch (e) {
        finish(false, e.message || String(e));
      }
    });
  });
}

function createWindow(loadUrl) {
  setupSilentPrintIpc();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: true,
    title: 'MAX',
    icon: iconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  mainWindow.maximize();

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.loadURL(loadUrl).catch((e) => {
    log('loadURL error', e.message);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function getUpdateFeedOptions() {
  const cfg = loadUpdateConfig();
  const fromEnv = (process.env.MAX_UPDATE_URL || '').trim().replace(/\/$/, '');
  if (fromEnv) return { provider: 'generic', url: fromEnv };

  const provider = String(cfg.PROVIDER || 'github').toLowerCase();
  if (provider === 'github') {
    const owner = String(cfg.GITHUB_OWNER || '').trim();
    const repo = String(cfg.GITHUB_REPO || '').trim();
    if (!owner || !repo || /TU_USUARIO/i.test(owner)) return null;
    return { provider: 'github', owner, repo };
  }
  return null;
}

function setupAutoUpdater() {
  if (isDev) return;
  const feed = getUpdateFeedOptions();
  if (!feed) return;

  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (e) {
    log('updater no disponible', e.message);
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  try {
    autoUpdater.setFeedURL(feed);
  } catch (e) {
    log('setFeedURL', e.message);
    return;
  }

  autoUpdater.on('error', (err) => log('updater error', err && err.message));
  autoUpdater.on('update-downloaded', (info) => {
    const ver = (info && info.version) || '';
    log('Actualización descargada', ver || '(versión desconocida)', '- se instalará al cerrar MAX.');
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((e) => log('checkForUpdates', e.message));
  }, 10000);
}

async function boot() {
  log('=== MAX desktop boot ===');
  log('isDev=', isDev, 'appRoot=', appRoot, 'dataRoot=', dataRoot);
  log('execPath=', process.execPath);

  let loadUrl = remoteUrl || null;

  try {
    if (remoteUrl) {
      log('Modo caja remota:', remoteUrl);
      try {
        await waitForUrl(remoteUrl);
      } catch (e) {
        throw new Error(
          'No se pudo conectar al servidor de caja:\n' + remoteUrl +
          '\n\nEn la PC SERVIDOR:\n' +
          '1) MAX debe estar abierto\n' +
          '2) XAMPP → MySQL en verde\n' +
          '3) Misma Wi‑Fi y sin VPN\n' +
          '4) Firewall puerto 3000 (Abrir-firewall-red-MAX.bat)\n\n' +
          'En esta PC caja, revisa el .env:\n' +
          'MAX_SERVER_URL=http://IP-DEL-SERVIDOR:3000\n' +
          '(solo la URL, sin espacios raros)'
        );
      }
      loadUrl = remoteUrl;
    } else {
      loadUrl = await resolveLocalUrl();
      await waitForUrl(loadUrl);
    }
    createWindow(loadUrl);
    setupAutoUpdater();
  } catch (e) {
    const msg = (e && e.message) ? e.message : String(e);
    log('BOOT FAIL', msg);
    const cajaHints = remoteUrl
      ? ''
      : (
        '\n\nRevisa (PC servidor):\n' +
        '1) XAMPP → MySQL en verde\n' +
        '2) Archivo .env junto a MAX.exe\n' +
        '3) Puerto 3000 libre\n'
      );
    dialog.showErrorBox(
      remoteUrl ? 'MAX caja — sin conexión al servidor' : 'MAX no pudo iniciar',
      msg + cajaHints + '\nLog: ' + logFile
    );
    app.quit();
  }
}

app.setAppUserModelId('com.max.erp');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  log('Otra instancia de MAX ya está abierta — enfocando esa');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(boot);

  app.on('window-all-closed', async () => {
    const shouldQuit = process.platform !== 'darwin';
    if (shouldQuit && shuttingDown) return;
    if (shouldQuit) shuttingDown = true;

    const forceExitTimer = shouldQuit
      ? setTimeout(() => {
        log('Tiempo agotado cerrando MAX; finalizando proceso');
        app.exit(0);
      }, 5000)
      : null;
    if (forceExitTimer && typeof forceExitTimer.unref === 'function') {
      forceExitTimer.unref();
    }

    try {
      if (startedLocalServer && stopServerFn) {
        await stopServerFn();
      }
    } catch (e) {
      log('Error al cerrar servidor local:', e && e.message ? e.message : e);
    } finally {
      startedLocalServer = false;
      stopServerFn = null;
      if (shouldQuit) {
        app.quit();
      } else if (forceExitTimer) {
        clearTimeout(forceExitTimer);
      }
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) boot();
  });
}
