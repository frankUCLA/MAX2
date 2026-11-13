/**
 * MAX — túnel público para celular (Cloudflare quick tunnel).
 * Requiere: MAX corriendo en localhost:PORT (por defecto 3000).
 * Descarga cloudflared.exe la primera vez en tools/
 */
const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.PORT || 3000);
const ROOT = path.join(__dirname, '..');
const TOOLS = path.join(ROOT, 'tools');
const CF_EXE = path.join(TOOLS, 'cloudflared.exe');
const CF_URL =
  'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';

function log(...a) {
  console.log(...a);
}

function waitLocal(port, tries = 40) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const tick = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1500 }, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => {
        n += 1;
        if (n >= tries) reject(new Error('MAX no responde en http://127.0.0.1:' + port));
        else setTimeout(tick, 500);
      });
      req.on('timeout', () => {
        req.destroy();
        n += 1;
        if (n >= tries) reject(new Error('MAX no responde en http://127.0.0.1:' + port));
        else setTimeout(tick, 500);
      });
    };
    tick();
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const file = fs.createWriteStream(dest);
    const get = (u, hops = 0) => {
      https
        .get(u, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            if (hops > 8) return reject(new Error('Demasiados redirects'));
            return get(res.headers.location, hops + 1);
          }
          if (res.statusCode !== 200) {
            reject(new Error('HTTP ' + res.statusCode + ' al descargar cloudflared'));
            res.resume();
            return;
          }
          res.pipe(file);
          file.on('finish', () => file.close(() => resolve(dest)));
        })
        .on('error', reject);
    };
    get(url);
  });
}

async function ensureCloudflared() {
  if (fs.existsSync(CF_EXE)) return CF_EXE;
  log('Descargando cloudflared (solo la primera vez)...');
  await download(CF_URL, CF_EXE);
  log('Listo:', CF_EXE);
  return CF_EXE;
}

function extractUrl(text) {
  const m = String(text).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  return m ? m[0] : null;
}

async function main() {
  log('');
  log('========================================');
  log('  MAX — Abrir en el celular (internet)');
  log('========================================');
  log('');
  log('1) Deja MAX abierto en esta PC (puerto ' + PORT + ')');
  log('2) Se creará un enlace https temporal');
  log('3) Ábrelo en el teléfono → /movil.html');
  log('');

  try {
    await waitLocal(PORT);
    log('OK: MAX responde en http://127.0.0.1:' + PORT);
  } catch (e) {
    log('ERROR:', e.message);
    log('Abre MAX.exe primero y vuelve a ejecutar este script.');
    process.exit(1);
  }

  const exe = await ensureCloudflared();
  log('Iniciando túnel... (deja esta ventana abierta)');
  log('');

  const child = spawn(exe, ['tunnel', '--url', 'http://127.0.0.1:' + PORT], {
    windowsHide: true
  });

  let shown = false;
  const onChunk = (buf) => {
    const t = buf.toString();
    process.stderr.write(t);
    if (shown) return;
    const url = extractUrl(t);
    if (!url) return;
    shown = true;
    const movil = url.replace(/\/$/, '') + '/movil.html';
    log('');
    log('----------------------------------------');
    log('  URL PARA EL CELULAR:');
    log('  ' + movil);
    log('----------------------------------------');
    log('');
    log('También puedes entrar a: ' + url + '/index.html');
    log('No cierres esta ventana mientras uses el teléfono.');
    log('');
    try {
      const out = path.join(ROOT, 'max-celular-url.txt');
      fs.writeFileSync(out, movil + '\n', 'utf8');
      log('Guardado en: ' + out);
    } catch (_) {}
    // Abrir en el navegador de la PC para copiar fácil
    try {
      if (process.platform === 'win32') {
        spawn('cmd.exe', ['/c', 'start', '', movil], { windowsHide: true });
      } else {
        spawn('xdg-open', [movil], { windowsHide: true });
      }
    } catch (_) {}
  };

  child.stdout.on('data', onChunk);
  child.stderr.on('data', onChunk);
  child.on('exit', (code) => {
    log('Túnel cerrado (código ' + code + ')');
    process.exit(code || 0);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
