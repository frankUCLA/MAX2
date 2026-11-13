/**
 * Túnel Cloudflare para celular — se arranca junto con MAX.
 * Descarga cloudflared la primera vez en <appRoot>/tools/
 */
const { spawn } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { resolveApp, ensureDir } = require('./paths');

const CF_URL =
  'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';

let _child = null;
let _url = null; // https://xxx.trycloudflare.com
let _status = 'off'; // off | starting | ready | error
let _error = null;
let _starting = null;
let _permanent = false;

function log(...a) {
  try {
    console.log('[TUNEL-CELULAR]', ...a);
  } catch (_) {}
}

function getState() {
  const base = _url ? String(_url).replace(/\/$/, '') : null;
  return {
    status: _status,
    url: base,
    movil_url: base ? base + '/movil.html' : null,
    permanente: _permanent,
    error: _error
  };
}

function extractUrl(text) {
  const m = String(text).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  return m ? m[0] : null;
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    ensureDir(path.dirname(dest));
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
  const tools = ensureDir(resolveApp('tools'));
  const exe = path.join(tools, 'cloudflared.exe');
  if (fs.existsSync(exe)) return exe;
  log('Descargando cloudflared (solo la primera vez)...');
  await download(CF_URL, exe);
  log('Listo:', exe);
  return exe;
}

function persistUrl(url) {
  try {
    const out = resolveApp('max-celular-url.txt');
    const movil = String(url).replace(/\/$/, '') + '/movil.html';
    fs.writeFileSync(out, movil + '\n', 'utf8');
  } catch (e) {
    log('No se pudo guardar la URL celular:', e.message || e);
  }
}

function getMobileUrl(value) {
  const configuredUrl = String(value || '').trim();
  let url;
  try {
    url = new URL(configuredUrl);
  } catch (_) {
    throw new Error('MAX_MOBILE_URL debe ser una URL HTTPS válida');
  }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
    throw new Error('MAX_MOBILE_URL debe ser una URL HTTPS válida sin usuario ni contraseña');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('MAX_MOBILE_URL debe contener solo el dominio, por ejemplo https://movil.midominio.com');
  }
  return url.origin;
}

function getTunnelConfig() {
  const provider = String(process.env.MAX_TUNNEL_PROVIDER || '').trim().toLowerCase();
  const token = String(process.env.MAX_TUNNEL_TOKEN || '').trim();
  const configuredUrl = String(process.env.MAX_MOBILE_URL || '').trim();

  if (provider && provider !== 'cloudflare' && provider !== 'tailscale-funnel') {
    throw new Error('MAX_TUNNEL_PROVIDER debe ser cloudflare o tailscale-funnel');
  }
  if (provider === 'tailscale-funnel') {
    if (token) {
      throw new Error('No configures MAX_TUNNEL_TOKEN al usar Tailscale Funnel');
    }
    if (!configuredUrl) {
      throw new Error('Configura MAX_MOBILE_URL con el dominio HTTPS de Tailscale Funnel');
    }
    return { provider, url: getMobileUrl(configuredUrl) };
  }
  if (provider === 'cloudflare' && !token && !configuredUrl) {
    throw new Error('Configura MAX_TUNNEL_TOKEN y MAX_MOBILE_URL para usar Cloudflare permanente');
  }

  if (!token && !configuredUrl) return null;
  if (!token || !configuredUrl) {
    throw new Error('Configura MAX_TUNNEL_TOKEN y MAX_MOBILE_URL para usar un enlace celular permanente');
  }

  return {
    provider: 'cloudflare',
    token,
    url: getMobileUrl(configuredUrl)
  };
}

function getTailscaleCli() {
  const configuredPath = String(process.env.TAILSCALE_CLI_PATH || '').trim();
  if (configuredPath) return configuredPath;

  if (process.platform === 'win32') {
    const programFiles = process.env.ProgramW6432 || process.env.ProgramFiles;
    if (programFiles) {
      const installedPath = path.join(programFiles, 'Tailscale', 'tailscale.exe');
      if (fs.existsSync(installedPath)) return installedPath;
    }
    return 'tailscale.exe';
  }
  return 'tailscale';
}

function runTailscale(args, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const cli = getTailscaleCli();
    let child;
    try {
      child = spawn(cli, args, { windowsHide: true });
    } catch (e) {
      reject(new Error('No se pudo iniciar Tailscale: ' + (e.message || e)));
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (err, output) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(output);
    };
    const append = (current, chunk) => (current + chunk.toString()).slice(-65536);
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch (_) {}
      finish(new Error('Tailscale no respondió a tiempo al ejecutar: tailscale ' + args[0]));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = append(stderr, chunk);
    });
    child.on('error', (e) => {
      finish(new Error('No se pudo ejecutar Tailscale (' + cli + '): ' + (e.message || e)));
    });
    child.on('close', (code) => {
      if (code === 0) return finish(null, stdout);
      const detail = (stderr || stdout).trim();
      finish(new Error(
        'Tailscale falló al ejecutar "' + args[0] + '"' +
        (detail ? ': ' + detail : ' (código ' + code + ')')
      ));
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readTailscaleStatus() {
  let lastError = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const status = JSON.parse(await runTailscale(['status', '--json'], 5000));
      if (status && status.Self && status.Self.DNSName) return status;
      lastError = new Error('Tailscale todavía no informó el nombre DNS del equipo');
    } catch (e) {
      lastError = e;
      if (/ENOENT|not found|not recognized|no se reconoce/i.test(e.message || String(e))) break;
    }
    if (attempt < 7) await delay(2000);
  }
  throw lastError || new Error('Tailscale no está disponible');
}

async function startTailscaleFunnel(port, configuredUrl) {
  let status;
  try {
    status = await readTailscaleStatus();
  } catch (e) {
    throw new Error(
      'No se pudo comprobar Tailscale. Instálalo e inicia sesión en la PC servidor. ' +
      (e.message || e)
    );
  }

  const dnsName = String(status && status.Self && status.Self.DNSName || '')
    .replace(/\.$/, '')
    .toLowerCase();
  const configuredHost = new URL(configuredUrl).hostname.toLowerCase();
  if (!dnsName) {
    throw new Error('Tailscale no informó un nombre DNS; inicia sesión y activa MagicDNS en la PC servidor');
  }
  if (configuredHost !== dnsName) {
    throw new Error('MAX_MOBILE_URL no coincide con Tailscale. Usa https://' + dnsName);
  }

  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await runTailscale(['funnel', '--bg', 'http://127.0.0.1:' + port], 10000);
      lastError = null;
      break;
    } catch (e) {
      lastError = e;
      if (attempt < 3) await delay(2000);
    }
  }
  if (lastError) throw lastError;

  _url = configuredUrl;
  _status = 'ready';
  _error = null;
  _permanent = true;
  persistUrl(_url);
  log('Tailscale Funnel listo:', _url + '/movil.html');
}

/**
 * Arranca el túnel apuntando a http://127.0.0.1:port
 * No bloquea el arranque de MAX si falla (queda status=error).
 */
function startTunelCelular(port) {
  if (process.env.MAX_TUNEL_CELULAR === '0') {
    _status = 'off';
    _error = 'Desactivado (MAX_TUNEL_CELULAR=0)';
    return Promise.resolve(getState());
  }
  if (_status === 'ready' && _url && (_child || _permanent)) {
    return Promise.resolve(getState());
  }
  if (_starting) return _starting;

  const p = Number(port || process.env.PORT || 3000);
  _status = 'starting';
  _error = null;

  _starting = (async () => {
    try {
      const tunnelConfig = getTunnelConfig();
      _permanent = !!tunnelConfig;
      if (tunnelConfig && tunnelConfig.provider === 'tailscale-funnel') {
        log('Configurando Tailscale Funnel → http://127.0.0.1:' + p);
        await startTailscaleFunnel(p, tunnelConfig.url);
        return getState();
      }

      const exe = await ensureCloudflared();
      log('Iniciando túnel → http://127.0.0.1:' + p);

      await new Promise((resolve) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          resolve();
        };

        const args = tunnelConfig
          ? ['tunnel', 'run', '--token', tunnelConfig.token]
          : ['tunnel', '--url', 'http://127.0.0.1:' + p];
        const child = spawn(exe, args, {
          windowsHide: true
        });
        _child = child;

        const onChunk = (buf) => {
          const t = buf.toString();
          if (tunnelConfig) {
            if (/Registered tunnel connection/i.test(t)) {
              _url = tunnelConfig.url;
              _status = 'ready';
              _error = null;
              persistUrl(_url);
              log('Túnel permanente listo:', _url + '/movil.html');
              done();
            }
            return;
          }
          if (_url) return;
          const url = extractUrl(t);
          if (!url) return;
          _url = url;
          _status = 'ready';
          _error = null;
          persistUrl(url);
          log('URL celular:', url + '/movil.html');
          done();
        };

        child.stdout.on('data', onChunk);
        child.stderr.on('data', onChunk);
        child.on('spawn', () => {
          if (!tunnelConfig) return;
          log('Proceso del túnel permanente iniciado');
        });
        child.on('error', (err) => {
          _status = 'error';
          _error = err.message || String(err);
          _url = null;
          _child = null;
          log('Error:', _error);
          done();
        });
        child.on('exit', (code) => {
          log('Túnel cerrado, código', code);
          _child = null;
          if (_status === 'ready') {
            _status = 'off';
            _url = null;
          } else if (_status === 'starting') {
            _status = 'error';
            _error = 'Túnel terminó antes de obtener URL (código ' + code + ')';
            _url = null;
          }
          done();
        });

        // No esperar eternamente el primer arranque
        setTimeout(done, 45000);
      });
    } catch (e) {
      _status = 'error';
      _error = e.message || String(e);
      log('Fallo:', _error);
    } finally {
      _starting = null;
    }
    return getState();
  })();

  return _starting;
}

function stopTunelCelular() {
  return new Promise((resolve) => {
    const c = _child;
    _child = null;
    _url = null;
    _status = 'off';
    _error = null;
    _permanent = false;
    _starting = null;
    if (!c) return resolve();
    try {
      c.kill();
    } catch (_) {}
    setTimeout(resolve, 300);
  });
}

module.exports = {
  startTunelCelular,
  stopTunelCelular,
  getTunelCelularState: getState
};
