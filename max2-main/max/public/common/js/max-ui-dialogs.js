/**
 * MAX UI dialogs — evita alert()/confirm() nativos (en Electron dejan el teclado “pegado”).
 * Incluir ANTES de cliente.js / caja-funcionalidades.js / admin-funcionalidades.js
 */
(function (global) {
  'use strict';

  function recoverKeyboardFocus(preferId) {
    try {
      if (typeof global.focus === 'function') global.focus();
      const ae = document.activeElement;
      if (ae && typeof ae.blur === 'function') ae.blur();
      setTimeout(function () {
        const el = (preferId && document.getElementById(preferId))
          || document.querySelector('input:not([type="hidden"]):not([type="file"]), textarea, select, button.btn.primary, [tabindex]:not([tabindex="-1"])');
        if (el && typeof el.focus === 'function') {
          try { el.focus({ preventScroll: true }); } catch (_) { el.focus(); }
        }
      }, 40);
    } catch (_) {}
  }

  function ensureToastEl() {
    let el = document.getElementById('maxUiToast');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'maxUiToast';
    el.setAttribute('role', 'status');
    el.style.cssText = [
      'position:fixed', 'bottom:24px', 'right:24px', 'z-index:2147483000',
      'max-width:min(440px,92vw)', 'padding:14px 18px', 'border-radius:10px',
      'box-shadow:0 10px 28px rgba(15,23,42,.22)',
      'font:500 14px/1.45 "DM Sans",system-ui,sans-serif',
      'color:#fff', 'opacity:0', 'transition:opacity .2s ease',
      'pointer-events:none', 'white-space:pre-wrap', 'display:none'
    ].join(';');
    (document.body || document.documentElement).appendChild(el);
    return el;
  }

  function maxToast(message, kind) {
    const el = ensureToastEl();
    const k = String(kind || 'ok');
    const bg = k === 'error' ? '#b91c1c' : (k === 'warn' ? '#b45309' : '#15803d');
    el.style.background = bg;
    el.textContent = String(message == null ? '' : message);
    el.style.display = 'block';
    el.style.opacity = '1';
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(function () {
      el.style.opacity = '0';
      setTimeout(function () { el.style.display = 'none'; }, 220);
    }, 4800);
    recoverKeyboardFocus();
    return true;
  }

  function ensureConfirmModal() {
    let modal = document.getElementById('maxUiConfirmModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'maxUiConfirmModal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.style.cssText = [
      'display:none', 'position:fixed', 'inset:0', 'z-index:2147482990',
      'background:rgba(15,23,42,.55)', 'align-items:center', 'justify-content:center',
      'padding:20px', 'backdrop-filter:blur(3px)'
    ].join(';');
    modal.innerHTML = [
      '<div style="background:#fff;border-radius:12px;max-width:420px;width:100%;padding:22px 22px 16px;',
      'box-shadow:0 20px 50px rgba(15,23,42,.28);font:500 14px/1.45 \'DM Sans\',system-ui,sans-serif;">',
      '<h3 id="maxUiConfirmTitle" style="margin:0 0 10px;font-size:1.15rem;color:#0f172a;">Confirmar</h3>',
      '<p id="maxUiConfirmMsg" style="margin:0 0 18px;color:#334155;white-space:pre-wrap;"></p>',
      '<div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">',
      '<button type="button" id="maxUiConfirmCancel" class="btn secondary" style="min-width:96px;">Cancelar</button>',
      '<button type="button" id="maxUiConfirmOk" class="btn primary" style="min-width:96px;">Aceptar</button>',
      '</div></div>'
    ].join('');
    (document.body || document.documentElement).appendChild(modal);
    return modal;
  }

  let confirmBusy = null;

  function maxConfirm(message, options) {
    const opts = options || {};
    return new Promise(function (resolve) {
      const modal = ensureConfirmModal();
      const msgEl = document.getElementById('maxUiConfirmMsg');
      const titleEl = document.getElementById('maxUiConfirmTitle');
      const okBtn = document.getElementById('maxUiConfirmOk');
      const cancelBtn = document.getElementById('maxUiConfirmCancel');
      if (titleEl) titleEl.textContent = opts.title || 'Confirmar';
      if (msgEl) msgEl.textContent = String(message == null ? '' : message);
      if (okBtn) okBtn.textContent = opts.okText || 'Aceptar';
      if (cancelBtn) cancelBtn.textContent = opts.cancelText || 'Cancelar';

      function finish(result) {
        modal.style.display = 'none';
        modal.onclick = null;
        if (okBtn) okBtn.onclick = null;
        if (cancelBtn) cancelBtn.onclick = null;
        document.removeEventListener('keydown', onKey);
        confirmBusy = null;
        recoverKeyboardFocus();
        resolve(!!result);
      }

      function onKey(e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          finish(false);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          finish(true);
        }
      }

      if (confirmBusy) {
        // Evitar solapar: cancela el anterior como false
        try { confirmBusy(false); } catch (_) {}
      }
      confirmBusy = finish;

      modal.style.display = 'flex';
      okBtn.onclick = function () { finish(true); };
      cancelBtn.onclick = function () { finish(false); };
      modal.onclick = function (e) { if (e.target === modal) finish(false); };
      document.addEventListener('keydown', onKey);
      setTimeout(function () { try { okBtn.focus(); } catch (_) {} }, 30);
    });
  }

  // alert nativo → toast (sin bloquear teclado en Electron)
  function maxAlert(message) {
    const text = String(message == null ? '' : message);
    const lower = text.toLowerCase();
    let kind = 'ok';
    if (/error|❌|falló|fallo|no se pudo|inválid|invalid|incorrect/.test(lower)) kind = 'error';
    else if (/⚠|atención|advertencia|falt|debe|completa|selecciona|ingresa/.test(lower)) kind = 'warn';
    maxToast(text, kind);
  }

  global.recoverKeyboardFocus = recoverKeyboardFocus;
  global.maxToast = maxToast;
  global.showAdminToast = maxToast;
  global.maxConfirm = maxConfirm;
  global.maxAlert = maxAlert;

  // Parche global: cualquier alert() existente deja de congelar la UI
  global.alert = maxAlert;

  // confirm() nativo también congela Electron. Los flujos usan await maxConfirm.
  // Este fallback evita el diálogo nativo si quedó algún confirm() sin migrar.
  global.__nativeConfirm = global.confirm.bind(global);
  global.confirm = function patchedConfirm(message) {
    console.warn('[MAX] confirm() nativo desactivado (rompe teclado en .exe). Usa await maxConfirm(...).', message);
    maxToast(String(message || 'Acción cancelada: confirma con el diálogo de la app'), 'warn');
    recoverKeyboardFocus();
    return false;
  };
})(typeof window !== 'undefined' ? window : globalThis);
