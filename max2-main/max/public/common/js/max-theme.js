/**
 * MAX — tema de color global (admin, caja, login)
 * Persistido en localStorage; el selector del avatar de admin aplica a todo el sistema.
 */
(function (global) {
  const THEME_KEY = 'max_theme';
  const LEGACY_KEY = 'max_admin_theme';
  const MIGRATION_KEY = 'max_theme_default_blue';

  const THEMES = {
    ocean: { primary: '#2563eb', primaryDark: '#1d4ed8', primaryLight: '#3b82f6', accent: '#0ea5e9', accentDark: '#0284c7' },
    teal: { primary: '#0d9488', primaryDark: '#0f766e', primaryLight: '#14b8a6', accent: '#2563eb', accentDark: '#1d4ed8' },
    slate: { primary: '#334155', primaryDark: '#1e293b', primaryLight: '#475569', accent: '#64748b', accentDark: '#475569' },
    forest: { primary: '#15803d', primaryDark: '#166534', primaryLight: '#16a34a', accent: '#059669', accentDark: '#047857' },
    wine: { primary: '#9f1239', primaryDark: '#881337', primaryLight: '#be123c', accent: '#e11d48', accentDark: '#be123c' }
  };

  const DEFAULT = 'ocean';

  function resolveName(name) {
    return THEMES[name] ? name : DEFAULT;
  }

  function getStoredTheme() {
    try {
      // Migración: el verde teal era el default; pasar a azul una vez
      if (!localStorage.getItem(MIGRATION_KEY)) {
        const cur = localStorage.getItem(THEME_KEY) || localStorage.getItem(LEGACY_KEY);
        if (!cur || cur === 'teal') {
          localStorage.setItem(THEME_KEY, DEFAULT);
          localStorage.setItem(LEGACY_KEY, DEFAULT);
        }
        localStorage.setItem(MIGRATION_KEY, '1');
      }
      return localStorage.getItem(THEME_KEY) || localStorage.getItem(LEGACY_KEY) || DEFAULT;
    } catch (_) {
      return DEFAULT;
    }
  }

  function applyTheme(name) {
    name = resolveName(name);
    const t = THEMES[name];
    const root = document.documentElement;
    root.style.setProperty('--primary', t.primary);
    root.style.setProperty('--primary-dark', t.primaryDark);
    root.style.setProperty('--primary-light', t.primaryLight);
    root.style.setProperty('--accent', t.accent);
    root.style.setProperty('--accent-dark', t.accentDark);
    root.style.setProperty('--accent-light', t.accent);
    // Alias usados por caja y login
    root.style.setProperty('--pos-teal', t.primary);
    root.style.setProperty('--pos-teal-dark', t.primaryDark);
    root.style.setProperty('--pos-blue', t.primary);
    root.style.setProperty('--max-teal', t.primary);
    root.style.setProperty('--max-teal-dark', t.primaryDark);
    if (document.body) document.body.dataset.theme = name;
    try {
      localStorage.setItem(THEME_KEY, name);
      localStorage.setItem(LEGACY_KEY, name);
    } catch (_) {}
    document.querySelectorAll('.theme-swatch').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.theme === name);
    });
    return name;
  }

  function boot() {
    applyTheme(getStoredTheme());
  }

  boot();
  document.addEventListener('DOMContentLoaded', () => {
    applyTheme(getStoredTheme());
  });

  global.MaxTheme = {
    THEMES,
    DEFAULT,
    applyTheme,
    getStoredTheme
  };
})(window);
