/** Registra PWA / service worker — comportamiento de app en el teléfono */
(function () {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      try {
        if (reg && reg.update) reg.update();
      } catch (_) {}
    }).catch(() => {});
  });
})();
