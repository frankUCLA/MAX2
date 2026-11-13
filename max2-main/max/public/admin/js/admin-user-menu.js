/**
 * MAX — menú de cuenta (avatar): nombre, temas, densidad, cerrar sesión
 * El color se aplica a todo el sistema vía max-theme.js (admin, caja, login).
 */
(function () {
  const COMPACT_KEY = 'max_admin_compact';

  function applyCompact(on) {
    document.body.classList.toggle('max-compact', !!on);
    try { localStorage.setItem(COMPACT_KEY, on ? '1' : '0'); } catch (_) {}
  }

  function fillUserFromStatus(data) {
    const name = (data && data.usuario) || 'Usuario';
    const rol = (data && data.rol) || 'ADMIN';
    const menuName = document.getElementById('userMenuName');
    const menuRol = document.getElementById('userMenuRol');
    const legacyName = document.getElementById('userName');
    const legacyRol = document.getElementById('rolLabel');
    const avatar = document.getElementById('userAvatar');
    if (menuName) menuName.textContent = name;
    if (menuRol) menuRol.textContent = String(rol).toUpperCase();
    if (legacyName) legacyName.textContent = name;
    if (legacyRol) legacyRol.textContent = String(rol).toUpperCase().slice(0, 12);
    if (avatar) avatar.textContent = (name.charAt(0) || 'A').toUpperCase();
  }

  function setupMenu() {
    const avatar = document.getElementById('userAvatar');
    const panel = document.getElementById('userMenuPanel');
    const menu = document.getElementById('userMenu');
    if (!avatar || !panel || !menu) return;

    const open = () => {
      panel.hidden = false;
      avatar.setAttribute('aria-expanded', 'true');
    };
    const close = () => {
      panel.hidden = true;
      avatar.setAttribute('aria-expanded', 'false');
    };
    const toggle = () => (panel.hidden ? open() : close());

    avatar.addEventListener('click', (e) => {
      e.stopPropagation();
      const notif = document.getElementById('notifPanel');
      if (notif) notif.style.display = 'none';
      toggle();
    });

    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target)) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });

    document.querySelectorAll('.theme-swatch').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.MaxTheme) window.MaxTheme.applyTheme(btn.dataset.theme);
      });
    });

    const compact = document.getElementById('userMenuCompact');
    if (compact) {
      compact.addEventListener('change', () => applyCompact(compact.checked));
    }
  }

  async function loadUser() {
    try {
      const res = await fetch('/api/status', { credentials: 'include' });
      const data = await res.json();
      if (data && data.usuario) fillUserFromStatus(data);
    } catch (_) {}
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('userMenu')) return;
    let compact = false;
    try {
      compact = localStorage.getItem(COMPACT_KEY) === '1';
    } catch (_) {}
    if (window.MaxTheme) window.MaxTheme.applyTheme(window.MaxTheme.getStoredTheme());
    applyCompact(compact);
    const compactEl = document.getElementById('userMenuCompact');
    if (compactEl) compactEl.checked = compact;
    setupMenu();
    loadUser();
  });
})();
