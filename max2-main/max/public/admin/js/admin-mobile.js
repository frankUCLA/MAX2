/**
 * MAX — App teléfono (admin consulta)
 * Shell: top bar + bottom nav + asistente de consulta.
 */
(function () {
  function isPhone() {
    const ua = navigator.userAgent || '';
    const narrow = window.matchMedia && window.matchMedia('(max-width: 900px)').matches;
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua) || (narrow && 'ontouchstart' in window);
  }

  const ALLOWED = new Set([
    'dashboard',
    'contabilidad',
    'cuentas_pagar',
    'reportes',
    'reporte-compras',
    'reporte-utilidad',
    'reporte-ganancias'
  ]);

  const NAV = [
    { tab: 'dashboard', label: 'Inicio', icon: '⌂' },
    { tab: 'contabilidad', label: 'Libros', icon: '▦' },
    { tab: 'reportes', label: 'Reportes', icon: '▤' },
    { tab: 'asistente', label: 'Asistente', icon: '✦', special: true }
  ];

  const TITLES = {
    dashboard: 'Inicio',
    contabilidad: 'Contabilidad',
    cuentas_pagar: 'Cuentas por pagar',
    reportes: 'Reportes',
    'reporte-compras': 'Reporte compras',
    'reporte-utilidad': 'Utilidad',
    'reporte-ganancias': 'Ganancias',
    asistente: 'Asistente'
  };

  function isFeatureTabEnabled(tab) {
    const featureByTab = {
      contabilidad: 'accounting',
      cuentas_pagar: 'accounting',
      caja: 'accounting',
      promociones: 'promotions'
    };
    const feature = featureByTab[tab];
    return !feature || window.maxSetupFeatureEnabled(feature);
  }

  function isAllowedControl(btn) {
    if (!btn) return false;
    const id = btn.id || '';
    const txt = (btn.textContent || '').toLowerCase();
    if (id === 'logoutBtn' || txt.includes('cerrar sesión') || txt.includes('salir')) return true;
    if (btn.classList.contains('theme-swatch') || btn.closest('.user-menu')) return true;
    if (id === 'userAvatar') return true;
    if (id === 'licHistCierreBtn') return true;
    if (id === 'rptHubPdfBtn' || id === 'rptHubCsvBtn' || id === 'rptHubPrintBtn') return true;
    if (id === 'rptFlyoutClose') return true;
    if (btn.classList.contains('rpt-dl-btn') || btn.classList.contains('rpt-menu-item') || btn.classList.contains('rpt-flyout-close')) return true;
    if (btn.closest('.rpt-header-actions') || btn.closest('.rpt-flyout') || btn.closest('#reporteHubGrid')) return true;
    if (btn.closest('#maxAppBottomNav') || btn.closest('#maxAppTopbar') || btn.closest('#maxAiPanel')) return true;
    if (txt.includes('export') || txt.includes('pdf') || txt.includes('csv') || txt.includes('imprimir') || txt.includes('descargar')) return true;
    if (btn.closest('.dash-section') && btn.tagName === 'SELECT') return true;
    const onclick = btn.getAttribute('onclick') || '';
    if (/switchTab|mostrarReporte|renderReporte|fetchVentas/.test(onclick)) return true;
    return false;
  }

  function setActiveNav(tab) {
    const root = tab === 'reporte-compras' || tab === 'reporte-utilidad' || tab === 'reporte-ganancias'
      ? 'reportes'
      : tab;
    document.querySelectorAll('#maxAppBottomNav .max-app-nav-btn').forEach((b) => {
      b.classList.toggle('is-active', b.getAttribute('data-tab') === root);
    });
    const titleEl = document.getElementById('maxAppTitle');
    if (titleEl) titleEl.textContent = TITLES[tab] || TITLES[root] || 'MAX';
  }

  function openAiPanel() {
    const panel = document.getElementById('maxAiPanel');
    if (!panel) return;
    panel.classList.add('is-open');
    document.body.classList.add('max-ai-open');
    setActiveNav('asistente');
    const input = document.getElementById('maxAiInput');
    if (input) setTimeout(() => input.focus(), 200);
  }

  function closeAiPanel() {
    const panel = document.getElementById('maxAiPanel');
    if (!panel) return;
    panel.classList.remove('is-open');
    document.body.classList.remove('max-ai-open');
  }

  function appendMsg(role, text) {
    const box = document.getElementById('maxAiMessages');
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'max-ai-msg max-ai-msg--' + role;
    el.textContent = text;
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
  }

  async function sendAiQuestion(q) {
    const pregunta = String(q || '').trim();
    if (!pregunta) return;
    appendMsg('user', pregunta);
    const input = document.getElementById('maxAiInput');
    if (input) input.value = '';
    appendMsg('bot', 'Consultando…');
    const pending = document.querySelector('#maxAiMessages .max-ai-msg--bot:last-child');
    try {
      const res = await fetch('/api/asistente/consulta', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pregunta })
      });
      const data = await res.json();
      const txt = (data && (data.respuesta || data.error)) || 'No pude responder.';
      if (pending) pending.textContent = txt;
      else appendMsg('bot', txt);
    } catch (_) {
      if (pending) pending.textContent = 'Sin conexión con MAX.';
      else appendMsg('bot', 'Sin conexión con MAX.');
    }
  }

  function buildAiPanel() {
    if (document.getElementById('maxAiPanel')) return;
    const panel = document.createElement('section');
    panel.id = 'maxAiPanel';
    panel.className = 'max-ai-panel';
    panel.innerHTML = `
      <div class="max-ai-head">
        <div>
          <strong>Asistente MAX</strong>
          <span>Solo consulta · inventario y proveedores</span>
        </div>
        <button type="button" class="max-ai-close" id="maxAiClose" aria-label="Cerrar">✕</button>
      </div>
      <div class="max-ai-messages" id="maxAiMessages"></div>
      <div class="max-ai-chips">
        <button type="button" data-q="¿Cuáles productos tienen stock bajo?">Stock bajo</button>
        <button type="button" data-q="Lista de proveedores">Proveedores</button>
      </div>
      <form class="max-ai-form" id="maxAiForm">
        <input id="maxAiInput" type="text" enterkeyhint="send" autocomplete="off" placeholder="Ej: ¿cuántos Arroz Mary hay?" />
        <button type="submit" class="max-ai-send">Enviar</button>
      </form>
    `;
    document.body.appendChild(panel);

    appendMsg('bot', 'Hola. Pregúntame por stock, precios o proveedores. Ejemplo: “¿cuántos Arroz Mary hay?”');

    document.getElementById('maxAiClose').addEventListener('click', () => {
      closeAiPanel();
      setActiveNav('dashboard');
    });
    document.getElementById('maxAiForm').addEventListener('submit', (e) => {
      e.preventDefault();
      sendAiQuestion(document.getElementById('maxAiInput').value);
    });
    panel.querySelectorAll('.max-ai-chips button').forEach((b) => {
      b.addEventListener('click', () => sendAiQuestion(b.getAttribute('data-q')));
    });
  }

  function buildShell() {
    if (document.getElementById('maxAppTopbar')) return;

    const top = document.createElement('header');
    top.id = 'maxAppTopbar';
    top.className = 'max-app-topbar';
    top.innerHTML = `
      <div class="max-app-brand">
        <img src="imagen/images.png" alt="" class="max-app-logo" onerror="this.style.display='none'">
        <div class="max-app-brand-text">
          <strong>MAX</strong>
          <span>Consulta</span>
        </div>
      </div>
      <div class="max-app-top-right">
        <p class="max-app-title" id="maxAppTitle">Inicio</p>
        <button type="button" class="max-app-logout" id="maxAppLogout" title="Cerrar sesión">Salir</button>
      </div>
    `;

    const bottom = document.createElement('nav');
    bottom.id = 'maxAppBottomNav';
    bottom.className = 'max-app-bottom-nav';
    bottom.setAttribute('aria-label', 'Navegación');
    bottom.innerHTML = NAV.filter((n) => isFeatureTabEnabled(n.tab)).map((n) => `
      <button type="button" class="max-app-nav-btn" data-tab="${n.tab}" ${n.special ? 'data-special="1"' : ''}>
        <span class="max-app-nav-icon" aria-hidden="true">${n.icon}</span>
        <span class="max-app-nav-label">${n.label}</span>
      </button>
    `).join('');

    document.body.prepend(top);
    document.body.appendChild(bottom);
    buildAiPanel();

    bottom.querySelectorAll('.max-app-nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        if (btn.getAttribute('data-special') === '1' || tab === 'asistente') {
          openAiPanel();
          return;
        }
        closeAiPanel();
        if (typeof window.switchTab === 'function') window.switchTab(tab);
      });
    });

    document.getElementById('maxAppLogout').addEventListener('click', async () => {
      try {
        await fetch('/api/logout', { method: 'POST', credentials: 'include', cache: 'no-store' });
      } catch (_) {}
      location.href = 'movil.html?logout=' + Date.now();
    });
  }

  function applyMobileReadonly() {
    if (!isPhone()) return;
    document.body.classList.add('max-mobile-view', 'max-app-shell');
    buildShell();

    document.querySelectorAll('.sidebar-menu-link').forEach((a) => {
      const onclick = a.getAttribute('onclick') || '';
      const m = onclick.match(/switchTab\('([^']+)'\)/);
      const tab = m ? m[1] : '';
      if (tab && (!ALLOWED.has(tab) || !isFeatureTabEnabled(tab))) {
        const li = a.closest('.sidebar-menu-item') || a;
        li.style.display = 'none';
      }
    });
    document.querySelectorAll('.sidebar-section').forEach((sec) => {
      const visibles = [...sec.querySelectorAll('.sidebar-menu-link')].filter((el) => {
        const item = el.closest('.sidebar-menu-item') || el;
        return item.style.display !== 'none';
      });
      if (!visibles.length) sec.style.display = 'none';
    });

    document.querySelectorAll('form').forEach((f) => {
      if (f.id === 'maxAiForm') return;
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof maxToast === 'function') maxToast('Solo consulta en el teléfono', 'warn');
        else alert('Desde el teléfono no puedes registrar. Usa una PC.');
      }, true);
    });

    document.querySelectorAll('button, input[type="submit"], .btn').forEach((btn) => {
      if (isAllowedControl(btn)) return;
      btn.classList.add('max-mobile-disabled');
      btn.addEventListener('click', (e) => {
        if (isAllowedControl(btn)) return;
        e.preventDefault();
        e.stopPropagation();
        if (typeof maxToast === 'function') maxToast('Solo consulta y reportes', 'warn');
        else alert('Desde el teléfono solo puedes consultar y descargar reportes.');
      }, true);
    });

    document.querySelectorAll('#dashboardPanel select, #reportesPanel select').forEach((sel) => {
      sel.classList.remove('max-mobile-disabled');
    });

    if (typeof window.switchTab === 'function') {
      const orig = window.switchTab;
      window.switchTab = function (tab) {
        if (!ALLOWED.has(tab) || !isFeatureTabEnabled(tab)) {
          if (typeof maxToast === 'function') maxToast('Esa sección es solo en PC', 'warn');
          setActiveNav('dashboard');
          return orig.call(this, 'dashboard');
        }
        closeAiPanel();
        setActiveNav(tab);
        return orig.apply(this, arguments);
      };
      setTimeout(() => window.switchTab('dashboard'), 120);
    }
  }

  function blockCajaOnPhone() {
    if (!isPhone()) return;
    if (!/caja\.html/i.test(location.pathname + location.href)) return;
    document.body.innerHTML = `
      <div class="max-app-blocked">
        <img src="imagen/images.png" alt="MAX" width="64" height="64">
        <h1>MAX</h1>
        <p>La caja POS no se usa desde el teléfono.</p>
        <p class="muted">Entra como administrador para consultar.</p>
        <a href="movil.html">Volver al login</a>
      </div>`;
  }

  document.addEventListener('DOMContentLoaded', () => {
    blockCajaOnPhone();
    if (/admin\.html/i.test(location.pathname + location.href)) {
      applyMobileReadonly();
    }
  });
})();
