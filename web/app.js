(function () {
  function boot() {
    if (!window.Pyme360App || typeof window.Pyme360App.init !== "function") {
      throw new Error("No se pudo iniciar Pyme360: app-core.js no está disponible.");
    }
    window.Pyme360App.init();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
    return;
  }

  boot();
})();
