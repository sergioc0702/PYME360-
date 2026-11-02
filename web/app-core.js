window.Pyme360App = (function () {
  "use strict";

  // Este estado del navegador solo se consulta como fuente de migración a SQLite.
  /* Configuración, preferencias y almacenamiento */
  const STORAGE_KEY = "pyme360.demo.v2";
  const THEME_KEY = "pyme360.theme";
  const SIDEBAR_KEY = "pyme360.sidebar.collapsed";
  const PUBLIC_BENCHMARK_CACHE_KEY = "pyme360.public-benchmark.ods-7-3-1.v2";

  const pages = {
    overview: "Inicio",
    sales: "Ventas",
    purchases: "Compras",
    inventory: "Inventario",
    production: "Producción",
    finance: "Finanzas",
    environment: "Impacto ambiental",
    contacts: "Contactos",
    data: "Datos y Excel"
  };

  const now = new Date();
  let currentPeriod = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  let currentPage = "overview";
  let state = seedState();
  let persistedState = seedState();
  let stateRevision = 0;
  let persistenceReady = false;
  let persistencePending = false;
  let persistenceBlocked = false;
  let readOnlyMode = false;
  let deferredRender = false;
  let deferredClose = false;
  let deferredToasts = [];
  let currentTheme = loadTheme();
  let sidebarCollapsed = loadSidebarCollapsed();
  let importSession = null;
  let receiptSession = null;
  let backupSession = null;
  let activeReceiptRead = null;
  let publicBenchmarkState = { status: "idle", data: null, cachedAt: "", error: "" };

  function loadTheme() {
    try {
      return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
    } catch (error) {
      return "light";
    }
  }

  function loadSidebarCollapsed() {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === "true";
    } catch (error) {
      return false;
    }
  }

  function setSidebarCollapsed(collapsed) {
    sidebarCollapsed = Boolean(collapsed);
    document.documentElement.classList.toggle("sidebar-collapsed", sidebarCollapsed);

    var toggle = document.querySelector(".sidebar-toggle");
    if (toggle) {
      var label = sidebarCollapsed ? "Expandir menú" : "Contraer menú";
      toggle.textContent = sidebarCollapsed ? "›" : "‹";
      toggle.setAttribute("aria-label", label);
      toggle.setAttribute("title", label);
      toggle.setAttribute("aria-expanded", String(!sidebarCollapsed));
    }

    document.querySelectorAll(".nav-item").forEach(function (item) {
      var label = item.querySelector(".nav-icon + span");
      if (!label) return;
      var name = label.textContent.trim();
      item.setAttribute("aria-label", name);
      item.setAttribute("title", name);
    });

    var companyButton = document.querySelector(".company-avatar");
    if (companyButton) companyButton.setAttribute("title", "Configurar empresa");
    var profileButton = document.querySelector(".profile-button");
    if (profileButton) profileButton.setAttribute("title", "Mi usuario · Administrador");

    try {
      localStorage.setItem(SIDEBAR_KEY, String(sidebarCollapsed));
    } catch (error) {
      // El menú sigue funcionando aunque el navegador no permita guardar la preferencia.
    }
  }

  function setTheme(theme) {
    currentTheme = theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", currentTheme);
    var toggle = document.getElementById("theme-toggle");
    if (toggle) {
      var dark = currentTheme === "dark";
      toggle.textContent = dark ? "☀" : "☾";
      toggle.setAttribute("aria-label", dark ? "Cambiar a tema claro" : "Cambiar a tema oscuro");
      toggle.setAttribute("title", dark ? "Cambiar a tema claro" : "Cambiar a tema oscuro");
    }
    try {
      localStorage.setItem(THEME_KEY, currentTheme);
    } catch (error) {
      // El tema sigue aplicado a esta sesión aunque el navegador no permita guardarlo.
    }
  }

  function seedState() {
    return {
      company: "",
      companyNit: "",
      city: "",
      activityType: "",
      contacts: [],
      inventory: [],
      sales: [],
      purchases: [],
      production: [],
      environment: [],
      environmentTargets: { energyReductionPct: null, waterReductionPct: null },
      activity: [],
      importExtras: []
    };
  }

  function normalizeState(parsed) {
    try {
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("El estado guardado no tiene un formato válido.");
      parsed = JSON.parse(JSON.stringify(parsed));
      var defaults = seedState();
      Object.keys(defaults).forEach(function (key) {
        if (Array.isArray(defaults[key])) {
          if (!Array.isArray(parsed[key])) parsed[key] = defaults[key];
        } else if (parsed[key] == null) parsed[key] = defaults[key];
      });
      parsed.contacts.forEach(function (contact) {
        if (typeof contact.ordinaryCustomer !== "boolean") contact.ordinaryCustomer = false;
      });
      parsed.sales.forEach(function (sale) {
        if (typeof sale.inventoryApplied !== "boolean") sale.inventoryApplied = String(sale.id || "").indexOf("imp-") !== 0;
        if (!Array.isArray(sale.payments)) sale.payments = [];
        if (["Por revisar", "Registrada por fuera de Pyme360", "No aplica, según revisión del usuario"].indexOf(sale.invoiceFollowUpStatus) < 0) sale.invoiceFollowUpStatus = "Por revisar";
        if (typeof sale.externalInvoiceNumber !== "string") sale.externalInvoiceNumber = "";
        if (typeof sale.externalInvoiceDate !== "string") sale.externalInvoiceDate = "";
        if (!sale.payments.length && sale.status === "Pagada") {
          sale.payments.push({ id: "legacy-" + sale.id, date: sale.paidDate || sale.date || today(), amount: Number(sale.total) || 0, method: sale.method || sale.payment || "Pago registrado", legacy: true });
        }
      });
      parsed.purchases.forEach(function (purchase) {
        if (typeof purchase.inventoryApplied !== "boolean") purchase.inventoryApplied = String(purchase.id || "").indexOf("imp-") !== 0 && purchase.status !== "Por recibir";
      });
      parsed.production.forEach(function (order) {
        if (typeof order.inventoryApplied !== "boolean") order.inventoryApplied = String(order.id || "").indexOf("imp-") !== 0;
      });
      if (!parsed.environmentTargets || typeof parsed.environmentTargets !== "object") parsed.environmentTargets = defaults.environmentTargets;
      ["energyReductionPct", "waterReductionPct"].forEach(function (key) {
        var value = parsed.environmentTargets[key];
        var percentage = Number(value);
        parsed.environmentTargets[key] = value != null && Number.isInteger(percentage) && percentage >= 1 && percentage <= 99 ? percentage : null;
      });
      parsed.environment.forEach(function (record) {
        if (!record.readingSources) record.readingSources = {};
        if (!record.readingSources.energy && record.energySource) record.readingSources.energy = { label: record.energySource, method: record.energyMethod || "manual", confirmedAt: record.energyCapturedAt || "" };
        if (!record.readingSources.water && record.waterSource) record.readingSources.water = { label: record.waterSource, method: record.waterMethod || "manual", confirmedAt: record.waterCapturedAt || "" };
      });
      return parsed;
    } catch (error) {
      throw error;
    }
  }

  function readLegacyState() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      return saved ? normalizeState(JSON.parse(saved)) : null;
    } catch (error) {
      return null;
    }
  }

  function setPersistenceStatus(label, mode) {
    var status = document.getElementById("persistence-status");
    if (!status) return;
    status.className = "sync-status" + (mode ? " " + mode : "");
    status.innerHTML = '<span class="sync-dot"></span>' + esc(label);
  }

  function cloneState(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function setSaveBusyControls(disabled) {
    document.querySelectorAll("#modal-root input, #modal-root select, #modal-root textarea, #modal-root button").forEach(function (control) {
      if (disabled) {
        control.setAttribute("data-was-disabled", control.disabled ? "true" : "false");
        control.disabled = true;
      } else {
        control.disabled = control.getAttribute("data-was-disabled") === "true";
        control.removeAttribute("data-was-disabled");
      }
    });
  }

  function persistSnapshot(snapshot) {
    if (persistencePending) return Promise.reject(new Error("Pyme360 está guardando otro cambio. Espera un momento y vuelve a intentarlo."));
    persistencePending = true;
    setPersistenceStatus("Guardando…", "saving");
    setSaveBusyControls(true);
    var request = !persistenceReady || persistenceBlocked ?
      Promise.reject(new Error(persistenceBlocked ? "Recarga Pyme360 para obtener los datos más recientes." : "El servidor local no está listo. Abre Pyme360 desde el lanzador y vuelve a intentarlo.")) :
      fetch("/api/v1/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: stateRevision, state: snapshot })
      });
    return request.then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (payload) {
        if (!response.ok) {
          var error = new Error(payload.error || "SQLite no confirmó el guardado.");
          error.status = response.status;
          error.payload = payload;
          throw error;
        }
        stateRevision = Number(payload.revision) || stateRevision + 1;
        persistedState = cloneState(snapshot);
        return payload;
      });
    }).then(function (result) {
      persistencePending = false;
      setSaveBusyControls(false);
      setPersistenceStatus("Guardado en este equipo", "saved");
      if (deferredClose) closeModal(true);
      if (deferredRender) render(true);
      deferredClose = false;
      deferredRender = false;
      var messages = deferredToasts.slice();
      deferredToasts = [];
      messages.forEach(function (item) { showToast(item.title, item.detail); });
      return result;
    }).catch(function (error) {
      persistencePending = false;
      setSaveBusyControls(false);
      deferredToasts = [];
      deferredClose = false;
      if (error.status === 409) {
        persistenceBlocked = true;
        setPersistenceStatus("Necesita recargar", "error");
        deferredRender = false;
        openModal("Los datos cambiaron", "Otra pestaña guardó una versión más reciente. Recarga Pyme360 para continuar con esos datos.", '<div class="modal-form"><p>Este cambio no se guardó. Si lo necesitas, anótalo antes de recargar.</p><div class="modal-footer"><button class="button button-primary" data-action="state-reload">Recargar Pyme360</button></div></div>');
      } else {
        state = cloneState(persistedState);
        if (deferredRender) render(true);
        deferredRender = false;
        setPersistenceStatus("No se pudo guardar", "error");
        var explanation = error.status ? error.message : "No se pudo conectar con el servidor local. Deja abierta la ventana del lanzador e inténtalo de nuevo.";
        showToast("No se guardó el cambio", explanation || "Revisa que el servidor local siga abierto e inténtalo de nuevo.");
      }
      throw error;
    });
  }

  function saveState() {
    var snapshot;
    try { snapshot = cloneState(state); }
    catch (error) { showToast("No se guardó el cambio", "No pudimos preparar los datos para SQLite."); return Promise.resolve(false); }
    return persistSnapshot(snapshot).catch(function () { return false; });
  }

  async function initializeLocalState() {
    if (window.location.protocol === "file:") {
      readOnlyMode = true;
      state = readLegacyState() || seedState();
      persistedState = cloneState(state);
      setPersistenceStatus("Abre con el lanzador", "error");
      var localMessage = document.getElementById("local-persistence-message");
      if (localMessage) localMessage.textContent = "Abre Pyme360 con el lanzador de tu computador para guardar en SQLite. Esta pestaña abierta como archivo no permite registrar cambios.";
      render();
      showToast("Falta iniciar el servidor local", "Abre Pyme360 con el lanzador para guardar los cambios en SQLite.");
      return;
    }
    setPersistenceStatus("Conectando…", "saving");
    try {
      var response = await fetch("/api/v1/state", { cache: "no-store" });
      if (!response.ok) throw new Error("El servidor local no respondió correctamente.");
      var payload = await response.json();
      stateRevision = Number(payload.revision) || 0;
      if (payload.state) {
        state = normalizeState(payload.state);
        persistedState = cloneState(state);
        persistenceReady = true;
      } else {
        var legacy = readLegacyState();
        state = legacy || seedState();
        persistedState = seedState();
        persistenceReady = true;
        if (legacy) {
          try {
            var result = await persistSnapshot(cloneState(legacy));
            void result;
            showToast("Datos anteriores migrados", "La copia original del navegador se conservó sin cambios.");
          } catch (migrationError) {
            if (migrationError.status === 409) {
              var latest = await fetch("/api/v1/state", { cache: "no-store" }).then(function (item) { return item.json(); });
              if (latest.state) {
                state = normalizeState(latest.state);
                persistedState = cloneState(state);
                stateRevision = Number(latest.revision) || 0;
                persistenceBlocked = false;
                document.getElementById("modal-root").innerHTML = "";
                persistenceReady = true;
                setPersistenceStatus("Guardado en este equipo", "saved");
                render();
                showToast("Datos anteriores conservados", "Otra pestaña terminó la migración. Cargamos lo que ya estaba en SQLite sin combinar registros.");
                return;
              }
            }
            throw migrationError;
          }
        }
      }
      persistenceReady = true;
      setPersistenceStatus("Guardado en este equipo", "saved");
      render();
    } catch (error) {
      persistenceReady = false;
      if (!persistenceBlocked) {
        readOnlyMode = true;
        state = readLegacyState() || cloneState(persistedState);
        persistedState = cloneState(state);
        setPersistenceStatus("Sin conexión local", "error");
        var localMessage = document.getElementById("local-persistence-message");
        if (localMessage) localMessage.textContent = "No se pudo conectar con SQLite. Deja abierta la ventana del lanzador y recarga esta página.";
        render();
        showToast("No se pudo conectar con SQLite", error instanceof TypeError ? "Deja abierta la ventana del lanzador y recarga Pyme360." : (error.message || "Deja abierta la ventana del servidor y recarga Pyme360."));
      }
    }
  }

  function salePaidAmount(sale) {
    if (Array.isArray(sale.payments) && sale.payments.length) {
      return sale.payments.reduce(function (sum, payment) { return sum + (Number(payment.amount) || 0); }, 0);
    }
    return sale.status === "Pagada" ? Number(sale.total) || 0 : 0;
  }

  function saleOutstanding(sale) {
    return Math.max(0, (Number(sale.total) || 0) - salePaidAmount(sale));
  }

  function refreshSaleStatus(sale) {
    var paid = salePaidAmount(sale);
    var total = Number(sale.total) || 0;
    sale.status = paid >= total && total > 0 ? "Pagada" : paid > 0 ? "Pago parcial" : "Pendiente de pago";
    return sale.status;
  }

  function purchaseLines(purchase) {
    if (Array.isArray(purchase.lines) && purchase.lines.length) {
      var hasLineTotals = purchase.lines.every(function (line) { return Number.isFinite(Number(line.total)); });
      return purchase.lines.map(function (line) {
        return { sku: line.sku, quantity: Number(line.quantity) || 0, total: Number.isFinite(Number(line.total)) ? Number(line.total) : (hasLineTotals ? 0 : (Number(purchase.total) || 0) / purchase.lines.length) };
      });
    }
    return purchase.productSku ? [{ sku: purchase.productSku, quantity: Number(purchase.quantity) || 0, total: Number(purchase.total) || 0 }] : [];
  }

  /* Formato y utilidades compartidas */
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function money(value) {
    return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Number(value) || 0);
  }

  function num(value, digits) {
    return new Intl.NumberFormat("es-CO", { maximumFractionDigits: digits == null ? 0 : digits }).format(Number(value) || 0);
  }

  function today() {
    var local = new Date();
    return local.getFullYear() + "-" + String(local.getMonth() + 1).padStart(2, "0") + "-" + String(local.getDate()).padStart(2, "0");
  }

  function dateLabel(value) {
    var raw = String(value == null ? "" : value);
    var parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (!parts) return esc(raw);
    var date = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])));
    if (
      date.getUTCFullYear() !== Number(parts[1]) ||
      date.getUTCMonth() !== Number(parts[2]) - 1 ||
      date.getUTCDate() !== Number(parts[3])
    )
      return esc(raw);
    return parts[3] + "/" + parts[2] + "/" + parts[1];
  }

  function monthName(period) {
    var parts = String(period).split("-");
    return new Intl.DateTimeFormat("es-CO", { month: "long" }).format(new Date(Number(parts[0]), Number(parts[1]) - 1, 1));
  }

  function currentEnvironment() {
    return state.environment.find(function (item) { return item.period === currentPeriod; }) || {
      period: currentPeriod, electricityKwh: 0, waterM3: 0, fuelL: 0, organicKg: 0,
      recyclableKg: 0, nonRecyclableKg: 0, hazardousKg: 0, recycledKg: 0, productionUnits: 0,
      readingSources: {}
    };
  }

  function upsertEnvironment(record) {
    var index = state.environment.findIndex(function (item) { return item.period === record.period; });
    if (index >= 0) state.environment[index] = record;
    else state.environment.push(record);
  }

  function addActivity(text, detail, icon) {
    state.activity.unshift({ text: text, detail: detail, time: "Ahora", icon: icon || "•" });
    state.activity = state.activity.slice(0, 8);
  }

  function setPage(page) {
    if (!pages[page]) return;
    closeModal();
    currentPage = page;
    document.getElementById("sidebar").classList.remove("open");
    render();
    if (page === "environment") loadPublicBenchmark(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function getPendingSalesCount() {
    return state.sales.filter(function (sale) { return saleOutstanding(sale) > 0; }).length;
  }

  function updateBranding() {
    var companyName = state.company || "Configura tu empresa";
    document.getElementById("page-title").textContent = pages[currentPage];
    document.querySelector(".company-switcher .company-meta strong").textContent = companyName;
    document.querySelector(".breadcrumb > span:first-child").textContent = state.company || "Tu empresa";
  }

  function updateNavigationState() {
    document.querySelectorAll(".nav-item[data-page]").forEach(function (item) {
      var isCurrentPage = item.getAttribute("data-page") === currentPage;
      item.classList.toggle("active", isCurrentPage);
      if (isCurrentPage) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });

    document.getElementById("sales-nav-count").textContent = String(getPendingSalesCount());
  }

  function render() {
    if (persistencePending) { deferredRender = true; return; }
    renderNow();
  }

  function renderNow() {
    updateBranding();
    document.getElementById("page-content").innerHTML = pageRenderer(currentPage)();
    updateNavigationState();
  }

  /* Renderizadores de páginas */
  function pageRenderer(page) {
    return {
      overview: renderOverview, sales: renderSales, purchases: renderPurchases,
      inventory: renderInventory, production: renderProduction, finance: renderFinance,
      environment: renderEnvironment, contacts: renderContacts, data: renderData
    }[page];
  }

  function heading(eyebrow, title, subtitle, actions) {
    return '<div class="page-heading"><div><div class="eyebrow">' + eyebrow + '</div><h1>' + title + '</h1><p>' + subtitle + '</p></div><div class="heading-actions">' + (actions || "") + '</div></div>';
  }

  function metricCard(label, value, note, icon, warn) {
    return '<div class="metric-card"><div class="metric-top"><span>' + label + '</span><span class="metric-icon">' + icon + '</span></div><div class="metric-value">' + value + '</div><div class="metric-foot"><span class="metric-change' + (warn ? " warn" : "") + '">' + (warn ? "≈" : "•") + '</span>' + note + '</div></div>';
  }

  function quickAction(icon, title, detail, action) {
    return '<button class="quick-action" data-action="' + action + '"><span class="quick-icon">' + icon + '</span><span><strong>' + title + '</strong><small>' + detail + '</small></span><span class="quick-arrow">›</span></button>';
  }

  function getStatusStyle(status, forcedStyle) {
    if (forcedStyle) return forcedStyle;
    if (status === "Pagada" || status === "Terminada" || status === "Recibida") return "";
    if (status === "Por recibir" || status === "Pendiente de pago" || status === "Pago parcial" || status.indexOf("Pendiente") === 0) return "pending";
    return "neutral";
  }

  function statusBadge(status, forcedStyle) {
    return '<span class="status ' + getStatusStyle(status, forcedStyle) + '">' + esc(status) + '</span>';
  }

  function renderOverview() {
    var pendingSales = state.sales.filter(function (sale) { return saleOutstanding(sale) > 0; });
    var due = pendingSales.reduce(function (sum, sale) { return sum + saleOutstanding(sale); }, 0);
    var record = currentEnvironment();
    var emissions = estimateEmissions(record);
    var monthSales = state.sales.filter(function (sale) { return sale.date.slice(0, 7) === currentPeriod; }).reduce(function (sum, sale) { return sum + sale.total; }, 0);
    var months = state.environment.slice(-6);
    var maxProduction = Math.max.apply(null, months.map(function (item) { return item.productionUnits || 0; }).concat([1]));
    var maxEnergy = Math.max.apply(null, months.map(function (item) { return item.electricityKwh || 0; }).concat([1]));
    var bars = months.map(function (item) {
      return '<div class="bar-group"><div class="bar" style="height:' + Math.max(5, Math.round((item.productionUnits / maxProduction) * 84)) + '%"></div><div class="bar current" style="height:' + Math.max(5, Math.round((item.electricityKwh / maxEnergy) * 84)) + '%"></div><small>' + esc(item.period.slice(5)) + '</small></div>';
    }).join("");
    var activity = state.activity.slice(0, 3).map(function (item) {
      return '<tr><td><span class="contact-avatar">' + esc(item.icon) + '</span><strong style="display:inline">' + esc(item.text) + '</strong><small>' + esc(item.detail) + '</small></td><td class="table-subtle">' + esc(item.time) + '</td></tr>';
    }).join("");
    var day = new Intl.DateTimeFormat("es-CO", { weekday: "long", day: "numeric" }).format(new Date());
    var onboarding = !state.company || !state.contacts.length || !state.inventory.length ?
      '<section class="panel section-spacer"><div class="panel-header"><div><h2>Tu empresa empieza con tus propios datos</h2><p>Completa estos pasos cuando estés listo. Nada viene precargado.</p></div><span class="status neutral">' + ((state.company ? 1 : 0) + (state.contacts.length ? 1 : 0) + (state.inventory.length ? 1 : 0)) + ' de 3 pasos</span></div><div class="panel-body quick-actions">' +
      quickAction("⌂", state.company ? "Empresa configurada" : "Configura tu empresa", "Nombre, NIT y actividad", "setup") +
      '<button class="quick-action" data-page="contacts"><span class="quick-icon">♙</span><span><strong>' + (state.contacts.length ? "Agrega más contactos" : "Registra tu primer cliente o proveedor") + '</strong><small>Solo aparecen los contactos de tu empresa</small></span><span class="quick-arrow">›</span></button>' +
      quickAction("▦", state.inventory.length ? "Completa tu inventario" : "Agrega tus productos", "Productos, materias primas e insumos", "new-product") +
      '</div></section>' : "";
    return heading(day.toUpperCase() + " · " + monthName(currentPeriod).toUpperCase(), state.company ? 'Resumen de tu negocio <span style="font-size:22px">👋</span>' : '¡Empecemos con lo básico! <span style="font-size:22px">👋</span>', state.company ? "Aquí tienes un resumen claro de cómo va tu negocio." : "Configura la empresa y registra tus propios datos para empezar.", '<span class="date-pill"><span>▣</span> ' + monthName(currentPeriod) + " " + currentPeriod.slice(0, 4) + '</span>') + onboarding +
      '<section class="metric-grid">' +
      metricCard("Ventas del mes", money(monthSales), "Registrado en " + monthName(currentPeriod), "↗", false) +
       metricCard("Por cobrar", money(due), pendingSales.length + " facturas pendientes", "◷", false) +
      metricCard("Órdenes activas", String(state.production.filter(function (order) { return order.status === "En proceso"; }).length).padStart(2, "0"), "Producción en curso", "⚙", false) +
      metricCard("Emisiones estimadas", num(emissions / 1000, 2) + " t", "Estimación demostrativa", "♧", true) + '</section>' +
       '<section class="dashboard-grid"><div class="panel"><div class="panel-header"><div><h2>Tu operación, de un vistazo</h2><p>Un resumen mensual para tomar mejores decisiones.</p></div><span class="status neutral">Últimos meses</span></div><div class="panel-body"><div class="chart-summary"><strong>' + num(record.productionUnits) + '</strong><span>unidades producidas este mes</span><div class="chart-legend"><span><i class="legend-dot"></i>Producción</span><span><i class="legend-dot pale"></i>Energía</span></div></div><div class="chart-wrap"><div class="chart-y"><span>Alto</span><span>Medio</span><span>Bajo</span><span>0</span></div><div class="chart-bars">' + bars + '</div></div><div class="chart-footer"><span>Tendencia relativa por indicador</span><span>Datos registrados</span></div></div></div>' +
      '<div class="panel"><div class="panel-header"><div><h2>¿Qué necesitas hacer?</h2><p>Atajos para las tareas de hoy.</p></div></div><div class="panel-body"><div class="quick-actions">' +
      quickAction("↗", "Registrar una venta", "Crea un registro para tu cliente", "new-sale") +
      quickAction("⚙", "Iniciar producción", "Registra una nueva orden", "new-production") +
      quickAction("♧", "Anotar consumos del mes", "Agua, energía y residuos", "new-environment") +
      '</div><div class="notice"><span class="notice-icon">✦</span><span><strong>Pequeños cambios, gran impacto.</strong><br>Consulta recomendaciones para reducir consumos y desperdicios.</span></div></div></div></section>' +
       renderPendingPanel() + '<section class="panel list-panel"><div class="panel-header"><div><h2>Actividad reciente</h2><p>Lo último que pasó en tu negocio.</p></div><button class="panel-link" data-page="sales">Ver ventas →</button></div><div class="table-wrap"><table><thead><tr><th>ACTIVIDAD</th><th>CUÁNDO</th></tr></thead><tbody>' + (activity || '<tr><td colspan="2"><div class="empty-state"><strong>Aquí verás los movimientos de tu empresa</strong><p>Cuando registres una venta, compra o producción, aparecerá en esta lista.</p></div></td></tr>') + '</tbody></table></div></section>';
  }

  function renderPendingPanel() {
    var lowStock = state.inventory.filter(function (item) { return Number(item.min) > 0 && Number(item.stock) <= Number(item.min); }).length;
    var receiving = state.purchases.filter(function (item) { return item.status === "Por recibir"; }).length;
    var unpaid = state.sales.filter(function (item) { return saleOutstanding(item) > 0; }).length;
    var invoiceReview = state.sales.filter(function (item) { return (item.invoiceFollowUpStatus || "Por revisar") === "Por revisar"; }).length;
    var active = state.production.filter(function (item) { return item.status === "En proceso"; }).length;
    var environmental = state.company && (!state.environment.some(function (item) { return item.period === currentPeriod; }) || !environmentHasReading(currentEnvironment(), "electricityKwh") || !environmentHasReading(currentEnvironment(), "waterM3"));
    var items = [];
    if (lowStock) items.push({ label: lowStock + " productos por reponer", detail: "Revisa las existencias mínimas.", page: "inventory" });
    if (receiving) items.push({ label: receiving + " compras por recibir", detail: "Confirma cuándo llegan los materiales.", page: "purchases" });
    if (unpaid) items.push({ label: unpaid + " ventas con saldo pendiente", detail: "Tienes " + money(state.sales.reduce(function (sum, sale) { return sum + saleOutstanding(sale); }, 0)) + " por cobrar.", page: "finance" });
    if (invoiceReview) items.push({ label: invoiceReview + " ventas por revisar", detail: "Confirma con tu contador si debes registrar un documento externo.", page: "sales" });
    if (active) items.push({ label: active + " órdenes de producción activas", detail: "Actualiza o termina las órdenes en curso.", page: "production" });
    if (environmental) items.push({ label: "Faltan consumos ambientales del mes", detail: "Registra energía y agua desde tus recibos.", page: "environment" });
    var rows = items.length ? items.map(function (item) {
      return '<button class="pending-item" data-page="' + item.page + '"><span class="pending-item-dot">!</span><span><strong>' + esc(item.label) + '</strong><small>' + esc(item.detail) + '</small></span><span class="pending-item-arrow">›</span></button>';
    }).join("") : '<p class="pending-clear">No tienes pendientes importantes. ¡Buen trabajo!</p>';
    return '<section class="panel pending-panel"><div class="panel-header"><div><h2>Pendientes por revisar</h2><p>Pyme360 reúne aquí las tareas que pueden necesitar tu atención.</p></div><span class="status ' + (items.length ? "pending" : "neutral") + '">' + items.length + (items.length === 1 ? " pendiente" : " pendientes") + '</span></div><div class="panel-body pending-list">' + rows + '</div></section>';
  }

  function renderSales() {
    var list = state.sales.slice().sort(function (a, b) { return b.date.localeCompare(a.date); });
    var rows = list.map(function (sale) {
      var tracking = sale.invoiceFollowUpStatus || "Por revisar";
      return '<tr><td><strong>' + esc(sale.number) + '</strong><small>' + dateLabel(sale.date) + '</small></td><td><strong>' + esc(sale.customer) + '</strong><small>' + esc(sale.payment || "Contado") + '</small></td><td>' + (sale.lines || []).reduce(function (sum, line) { return sum + (Number(line.quantity) || 0); }, 0) + ' und.</td><td><strong>' + money(sale.total) + '</strong>' + (saleOutstanding(sale) > 0 ? '<small>Saldo: ' + money(saleOutstanding(sale)) + '</small>' : '') + '</td><td>' + statusBadge(sale.status) + '</td><td>' + statusBadge(tracking, tracking === "Por revisar" ? "pending" : "neutral") + (sale.externalInvoiceNumber ? '<small>' + esc(sale.externalInvoiceNumber) + '</small>' : '') + '</td><td><div class="contact-row-actions"><button class="button-quiet" data-action="sale-detail" data-id="' + esc(sale.id) + '">Ver</button><button class="button-quiet" data-action="sale-edit" data-id="' + esc(sale.id) + '">Editar</button><button class="button-quiet button-quiet-danger" data-action="sale-delete" data-id="' + esc(sale.id) + '">Eliminar</button></div></td></tr>';
    }).join("");
    return heading("TU NEGOCIO", "Ventas", "Registra pedidos, consulta tus facturas y revisa qué te falta por cobrar.", '<button class="button button-primary" data-action="new-sale"><span>＋</span> Registrar venta</button>') +
      '<div class="toolbar"><div class="toolbar-left"><label class="search-field"><span>⌕</span><input type="search" placeholder="Buscar cliente o factura" data-filter="sales"></label><select class="filter-select" id="sales-status"><option value="Todas">Todos los estados</option><option>Pendiente de pago</option><option>Pago parcial</option><option>Pagada</option></select></div><span class="muted-note">' + list.length + ' ventas</span></div>' +
      '<section class="panel list-panel"><div class="table-wrap"><table><thead><tr><th>VENTA</th><th>CLIENTE</th><th>PRODUCTOS</th><th>TOTAL</th><th>ESTADO DE PAGO</th><th>SEGUIMIENTO DE FACTURA</th><th></th></tr></thead><tbody id="sales-rows">' + (rows || '<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">↗</div><strong>Aún no tienes ventas</strong><p>Registra tu primera venta y lleva el control desde aquí.</p><button class="button button-primary" data-action="new-sale">Registrar venta</button></div></td></tr>') + '</tbody></table></div></section>' +
      '<p class="muted-note section-spacer">El seguimiento es manual y no determina obligaciones tributarias. Pyme360 no genera ni transmite facturas a la DIAN.</p>';
  }

  function renderPurchases() {
    var rows = state.purchases.slice().sort(function (a, b) { return b.date.localeCompare(a.date); }).map(function (item) {
      return '<tr><td><strong>' + esc(item.number) + '</strong><small>' + dateLabel(item.date) + '</small></td><td><strong>' + esc(item.supplier) + '</strong><small>' + esc(item.detail) + '</small></td><td><strong>' + money(item.total) + '</strong></td><td>' + statusBadge(item.status) + '</td><td><div class="contact-row-actions"><button class="button-quiet" data-action="purchase-detail" data-id="' + esc(item.id) + '">Ver</button><button class="button-quiet" data-action="purchase-edit" data-id="' + esc(item.id) + '">Editar</button><button class="button-quiet button-quiet-danger" data-action="purchase-delete" data-id="' + esc(item.id) + '">Eliminar</button></div></td></tr>';
    }).join("");
    return heading("TU NEGOCIO", "Compras", "Recibe materiales, registra facturas de proveedor y controla lo que queda por pagar.", '<button class="button button-primary" data-action="new-purchase"><span>＋</span> Registrar compra</button>') +
      '<div class="metric-grid">' + metricCard("Órdenes registradas", String(state.purchases.length), "Compras en el sistema", "↙", false) + metricCard("Por recibir", String(state.purchases.filter(function (item) { return item.status === "Por recibir"; }).length), "Revisa las entregas pendientes", "▦", true) + metricCard("Proveedores", String(state.contacts.filter(function (item) { return item.role.indexOf("Proveedor") >= 0; }).length), "En tu lista de contactos", "♙", false) + metricCard("Compras recibidas", money(state.purchases.filter(function (item) { return item.status === "Recibida" || item.status === "Pagada"; }).reduce(function (sum, item) { return sum + item.total; }, 0)), "Según registros de compra", "$", false) + '</div>' +
      '<section class="panel list-panel"><div class="panel-header"><div><h2>Compras recientes</h2><p>Órdenes y recepciones de tus proveedores.</p></div></div><div class="table-wrap"><table><thead><tr><th>ORDEN</th><th>PROVEEDOR / DETALLE</th><th>VALOR</th><th>ESTADO</th><th></th></tr></thead><tbody>' + (rows || '<tr><td colspan="5"><div class="empty-state"><div class="empty-icon">↙</div><strong>Aún no tienes compras</strong><p>Primero agrega un proveedor y una materia prima o insumo.</p><button class="button button-secondary" data-page="contacts">Agregar proveedor</button> <button class="button button-primary" data-action="new-product">Agregar producto</button></div></td></tr>') + '</tbody></table></div></section>';
  }

  function renderInventory() {
    var rows = state.inventory.map(function (item) {
      var low = Number(item.min) > 0 && Number(item.stock) <= Number(item.min);
      return '<tr><td><strong>' + esc(item.name) + '</strong><small>' + esc(item.sku) + '</small></td><td>' + esc(item.type) + '</td><td><strong>' + num(item.stock, 1) + ' ' + esc(item.unit) + '</strong></td><td>' + num(item.min, 1) + ' ' + esc(item.unit) + '</td><td>' + money(item.cost) + '</td><td>' + (low ? '<span class="status pending">Stock bajo</span>' : '<span class="status">Disponible</span>') + '</td><td><div class="contact-row-actions"><button class="button-quiet" data-action="product-edit" data-id="' + esc(item.id) + '">Editar</button><button class="button-quiet button-quiet-danger" data-action="product-delete" data-id="' + esc(item.id) + '">Eliminar</button></div></td></tr>';
    }).join("");
    var value = state.inventory.reduce(function (sum, item) { return sum + item.stock * item.cost; }, 0);
    return heading("TU NEGOCIO", "Inventario", "Mira qué tienes disponible y qué necesitas volver a pedir.", '<button class="button button-secondary" data-action="inventory-export">↓ Exportar</button>' + (state.inventory.length ? '<button class="button button-secondary" data-action="new-adjustment">Ajustar stock</button>' : '') + '<button class="button button-primary" data-action="new-product"><span>＋</span> Agregar producto</button>') +
      '<div class="metric-grid">' + metricCard("Referencias", String(state.inventory.length), "Productos, materias primas e insumos", "▦", false) + metricCard("Valor aproximado", money(value), "Según el costo registrado", "$", false) + metricCard("Por reponer", String(state.inventory.filter(function (item) { return Number(item.min) > 0 && Number(item.stock) <= Number(item.min); }).length), "Referencias bajo el mínimo", "!", true) + metricCard("Bodegas", "Por configurar", "Se define al iniciar la empresa", "⌂", false) + '</div>' +
      '<div class="toolbar"><div class="toolbar-left"><label class="search-field"><span>⌕</span><input type="search" placeholder="Buscar producto o código" data-filter="inventory"></label><select class="filter-select" id="inventory-type"><option value="Todos">Todos los tipos</option><option>Producto terminado</option><option>Materia prima</option><option>Insumo</option></select></div></div>' +
      '<section class="panel list-panel"><div class="table-wrap"><table><thead><tr><th>PRODUCTO</th><th>TIPO</th><th>EXISTENCIA</th><th>MÍNIMO</th><th>COSTO UNITARIO</th><th>ESTADO</th><th></th></tr></thead><tbody id="inventory-rows">' + (rows || '<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">▦</div><strong>Tu inventario está vacío</strong><p>Agrega materias primas e insumos primero. Después podrás crear productos terminados y registrar producción.</p><button class="button button-primary" data-action="new-product">Agregar primer producto</button></div></td></tr>') + '</tbody></table></div></section>';
  }

  function renderProduction() {
    var rows = state.production.slice().sort(function (a, b) { return b.date.localeCompare(a.date); }).map(function (order) {
      var activeActions = order.status !== "En proceso" ? "" : order.inventoryApplied === false ? ' <button class="button-quiet button-quiet-danger" data-action="production-delete" data-id="' + esc(order.id) + '">Quitar</button>' : ' <button class="button-quiet" data-action="production-edit" data-id="' + esc(order.id) + '">Editar</button> <button class="button-quiet" data-action="production-complete" data-id="' + esc(order.id) + '">Terminar</button><button class="button-quiet button-quiet-danger" data-action="production-delete" data-id="' + esc(order.id) + '">Cancelar</button>';
      return '<tr><td><strong>' + esc(order.number) + '</strong><small>' + dateLabel(order.date) + '</small></td><td><strong>' + esc(order.product) + '</strong></td><td>' + num(order.quantity) + ' und.</td><td>' + (order.wasteKg ? num(order.wasteKg, 1) + ' kg' : "—") + '</td><td>' + statusBadge(order.status) + '</td><td><div class="contact-row-actions"><button class="button-quiet" data-action="production-detail" data-id="' + esc(order.id) + '">Ver</button>' + activeActions + '</div></td></tr>';
    }).join("");
    var active = state.production.filter(function (item) { return item.status === "En proceso"; }).length;
    return heading("TU NEGOCIO", "Producción", "Organiza lo que vas a fabricar y registra lo que realmente usaste.", '<button class="button button-primary" data-action="new-production"><span>＋</span> Nueva orden</button>') +
      '<div class="metric-grid">' + metricCard("Órdenes activas", String(active).padStart(2, "0"), "En proceso", "⚙", false) + metricCard("Terminadas este mes", String(state.production.filter(function (item) { return item.status === "Terminada" && item.date.slice(0, 7) === currentPeriod; }).length), "Listas para entregar", "✓", false) + metricCard("Unidades producidas", num(currentEnvironment().productionUnits), "En el período seleccionado", "▦", false) + metricCard("Desperdicio registrado", num(state.production.filter(function (item) { return item.date.slice(0, 7) === currentPeriod; }).reduce(function (sum, item) { return sum + (item.wasteKg || 0); }, 0), 1) + " kg", "Ayuda a reducir pérdidas", "♧", true) + '</div>' +
      '<section class="panel list-panel"><div class="panel-header"><div><h2>Órdenes de producción</h2><p>Consumos, cantidades terminadas y desperdicio.</p></div><button class="panel-link" data-page="inventory">Ver materiales →</button></div><div class="table-wrap"><table><thead><tr><th>ORDEN</th><th>PRODUCTO</th><th>CANTIDAD</th><th>DESPERDICIO</th><th>ESTADO</th><th></th></tr></thead><tbody>' + (rows || '<tr><td colspan="6"><div class="empty-state"><strong>Todavía no hay órdenes</strong><p>Agrega materias primas y un producto terminado antes de iniciar producción.</p><button class="button button-primary" data-action="new-product">Agregar producto</button></div></td></tr>') + '</tbody></table></div></section>';
  }

  function renderEnvironment() {
    var record = currentEnvironment();
    var periodRecorded = state.environment.some(function (item) { return item.period === currentPeriod; });
    var totalWaste = wasteTotal(record);
    var emissions = estimateEmissions(record);
    var rate = totalWaste ? Math.round(record.recycledKg / totalWaste * 100) : 0;
    var energyTrend = environmentTrend(record, "electricityKwh");
    var waterTrend = environmentTrend(record, "waterM3");
    var periods = state.environment.slice().sort(function (a, b) { return b.period.localeCompare(a.period); });
    if (!periods.some(function (item) { return item.period === currentPeriod; })) periods.unshift({ period: currentPeriod });
    var options = periods.map(function (item) { return '<option value="' + esc(item.period) + '"' + (item.period === currentPeriod ? " selected" : "") + '>' + monthName(item.period) + " " + item.period.slice(0, 4) + '</option>'; }).join("");
    return heading("PRODUCE MEJOR, PASO A PASO", "Impacto ambiental", "Entiende tus consumos y encuentra oportunidades para producir mejor.", '<select class="filter-select" id="environment-period">' + options + '</select><button class="button button-primary" data-action="' + (periodRecorded ? "environment-edit" : "new-environment") + '"><span>' + (periodRecorded ? "✎" : "＋") + '</span> ' + (periodRecorded ? "Actualizar datos" : "Registrar datos") + '</button>') +
      '<div class="env-highlight"><div class="env-leaf">♧</div><div class="env-highlight-main"><div class="eyebrow">RESUMEN DE ' + monthName(currentPeriod).toUpperCase() + '</div><h2>' + (periodRecorded ? "Cada dato cuenta. Revisa tu avance." : "Aún no hay datos ambientales del mes.") + '</h2><p>' + (periodRecorded ? "Compara tus consumos con tu propia producción y mejora período a período." : "Sube la factura de energía o agua, o prueba con un recibo de ejemplo.") + '</p></div><button class="button" data-action="environment-export">↓ Descargar resumen</button></div>' +
      '<div class="env-grid">' + envMetric("Energía", num(record.electricityKwh) + " kWh", "Consumo de la sede", "ϟ") + envMetric("Agua", num(record.waterM3, 1) + " m³", "Agua consumida", "◌") + envMetric("Emisiones estimadas", num(emissions / 1000, 2) + " tCO₂e", "Cálculo demostrativo", "♧") + envMetric("Residuos aprovechados", rate + "%", num(record.recycledKg, 1) + " kg reutilizados o reciclados", "↻") + '</div>' +
      publicBenchmarkPanel() +
      '<div class="env-layout"><div class="panel"><div class="panel-header"><div><h2>Consumo y producción</h2><p>Registra el dato de tu factura y compáralo con lo que produces.</p></div><span class="status neutral">' + (record.electricityKwh && record.waterM3 ? "Datos registrados" : "Datos incompletos") + '</span></div><div class="panel-body"><div class="table-wrap"><table><thead><tr><th>INDICADOR</th><th>VALOR DEL MES</th><th>POR UNIDAD</th><th>COMPARACIÓN</th></tr></thead><tbody>' +
      '<tr><td><strong>Energía</strong><small>Electricidad comprada</small></td><td>' + num(record.electricityKwh) + ' kWh' + sourceLabel(record, "energy") + '</td><td>' + (record.productionUnits ? num(record.electricityKwh / record.productionUnits, 2) : "—") + ' kWh / unidad</td><td>' + trendBadge(energyTrend) + '</td></tr>' +
      '<tr><td><strong>Agua</strong><small>Consumo de la sede</small></td><td>' + num(record.waterM3, 1) + ' m³' + sourceLabel(record, "water") + '</td><td>' + (record.productionUnits ? num(record.waterM3 / record.productionUnits, 3) : "—") + ' m³ / unidad</td><td>' + trendBadge(waterTrend) + '</td></tr>' +
      '<tr><td><strong>Combustibles</strong><small>Uso reportado</small></td><td>' + num(record.fuelL, 1) + ' L</td><td>' + (record.productionUnits ? num(record.fuelL / record.productionUnits, 3) : "—") + ' L / unidad</td><td><span class="status neutral">Dato manual</span></td></tr>' +
      '<tr><td><strong>Residuos</strong><small>Todos los tipos</small></td><td>' + num(totalWaste, 1) + ' kg</td><td>' + (record.productionUnits ? num(totalWaste / record.productionUnits, 3) : "—") + ' kg / unidad</td><td><span class="status">' + num(record.recycledKg, 1) + ' kg aprovechados</span></td></tr></tbody></table></div>' +
      '<section class="env-targets"><div class="env-target-heading"><div><h3>Metas propias de mejora</h3><p>Elige cuánto quieres reducir por unidad producida. Se calcula con tus tres meses anteriores con datos.</p></div><button class="button button-secondary" data-action="environment-set-target">' + (state.environmentTargets.energyReductionPct != null || state.environmentTargets.waterReductionPct != null ? "Ajustar metas" : "Definir metas") + '</button></div><div class="env-target-grid">' + renderEnvironmentTarget("Energía", "energyReductionPct", "electricityKwh", "kWh", 2) + renderEnvironmentTarget("Agua", "waterReductionPct", "waterM3", "m³", 3) + '</div><p class="form-note">Son objetivos elegidos por tu empresa, no límites universales ni requisitos ambientales.</p></section>' +
      '<p class="muted-note section-spacer">Las emisiones son estimaciones ilustrativas. Configura factores oficiales con tu asesor antes de usarlas para reportes formales.</p></div></div>' +
      '<div class="panel"><div class="panel-header"><div><h2>Ideas para este mes</h2><p>Recomendaciones basadas en tus registros.</p></div></div><div class="panel-body">' +
      (energyTrend.change > 10 ? recommendation("ϟ", "Revisa el consumo de energía", "El consumo por unidad subió " + energyTrend.change + "% frente a tu referencia reciente. Revisa horarios de equipos y fugas de aire.", false) : recommendation("ϟ", energyTrend.ready ? "Sigue comparando tu energía" : "Estamos creando tu referencia", energyTrend.ready ? "Tu consumo por unidad se compara con tus propios meses anteriores." : "Registra energía y unidades producidas durante dos meses para ver una comparación propia.", true)) +
      recommendation("↻", "Registra lo que aprovechas", "Anota los kg reutilizados o reciclados y guarda el soporte de entrega al gestor.", true) +
      recommendation("◌", waterTrend.ready ? "Compara el agua por unidad" : "Registra también el agua", waterTrend.ready ? "Revisa si el consumo por unidad cambia frente a tus propios meses anteriores." : "Con dos meses de consumos y producción podremos mostrar una referencia de tu empresa.", true) +
      '<div class="divider"></div><strong style="font-size:9px;color:#52645a">Datos del período</strong><div class="progress-line"><span style="width:' + (record.electricityKwh && record.waterM3 && totalWaste ? "80" : "45") + '%"></span></div><div class="progress-caption"><span>Consumos registrados</span><span>' + (record.electricityKwh && record.waterM3 && totalWaste ? "3 de 4 datos" : "2 de 4 datos") + '</span></div></div></div></div>';
  }

  /* Referencia pública ambiental */
  function readPublicBenchmarkCache() {
    try {
      var cached = JSON.parse(localStorage.getItem(PUBLIC_BENCHMARK_CACHE_KEY) || "null");
      return cached && cached.data && Array.isArray(cached.data.observations) ? cached : null;
    } catch (error) {
      return null;
    }
  }

  function loadPublicBenchmark(force) {
    if (window.location.protocol === "file:") {
      publicBenchmarkState.status = "file";
      if (currentPage === "environment") render();
      return;
    }
    if (publicBenchmarkState.status === "loading") return;
    var cached = readPublicBenchmarkCache();
    if (cached && !publicBenchmarkState.data) {
      publicBenchmarkState.data = cached.data;
      publicBenchmarkState.cachedAt = cached.cachedAt || "";
      publicBenchmarkState.status = cached.data.stale ? "stale" : "ready";
    }
    if (!force && cached && cached.data && !cached.data.stale && cached.cachedAt && Date.now() - new Date(cached.cachedAt).getTime() < 24 * 60 * 60 * 1000) {
      if (currentPage === "environment") render();
      return;
    }
    publicBenchmarkState.status = "loading";
    publicBenchmarkState.error = "";
    if (currentPage === "environment") render();
    fetch("/api/v1/environment/public-benchmark", { method: "GET", headers: { Accept: "application/json" }, cache: "no-store" })
      .then(function (response) {
        return response.json().then(function (payload) {
          if (!response.ok) throw new Error(payload.error || "La referencia no está disponible.");
          return payload;
        });
      })
      .then(function (payload) {
        var observations = (payload.observations || []).filter(function (item) {
          return (String(item.areaCode) === "1" || String(item.areaCode) === "170") && Number.isFinite(Number(item.year)) && Number.isFinite(Number(item.value));
        });
        if (!observations.length) throw new Error("La ONU no publicó datos disponibles para las áreas solicitadas.");
        payload.observations = observations;
        publicBenchmarkState.data = payload;
        publicBenchmarkState.cachedAt = new Date().toISOString();
        publicBenchmarkState.status = payload.stale ? "stale" : "ready";
        try { localStorage.setItem(PUBLIC_BENCHMARK_CACHE_KEY, JSON.stringify({ data: payload, cachedAt: publicBenchmarkState.cachedAt })); } catch (error) { /* La consulta sigue disponible aunque el navegador no guarde la caché. */ }
        if (currentPage === "environment") render();
      })
      .catch(function (error) {
        var lastCache = readPublicBenchmarkCache();
        if (lastCache && lastCache.data) {
          publicBenchmarkState.data = lastCache.data;
          publicBenchmarkState.cachedAt = lastCache.cachedAt || "";
          publicBenchmarkState.status = "stale";
        } else {
          publicBenchmarkState.status = "unavailable";
          publicBenchmarkState.data = null;
        }
        publicBenchmarkState.error = error.message || "No se pudo consultar la referencia pública.";
        if (currentPage === "environment") render();
      });
  }

  function benchmarkAgeLabel(data) {
    var date = data && data.fetchedAt ? new Date(data.fetchedAt) : null;
    if (!date || Number.isNaN(date.getTime())) return "fecha de consulta no disponible";
    return "consulta del " + new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(date);
  }

  function renderBenchmarkChart(observations) {
    var areas = [
      { code: "1", label: "Mundo", color: "#31805a" },
      { code: "170", label: "Colombia", color: "#5287c8" }
    ];
    var series = areas.map(function (area) {
      return { area: area, rows: observations.filter(function (item) { return String(item.areaCode) === area.code; }).sort(function (a, b) { return Number(a.year) - Number(b.year); }).slice(-10) };
    }).filter(function (item) { return item.rows.length; });
    if (!series.length) return '<p class="form-note">Todavía no hay datos publicados para mostrar.</p>';
    var allRows = [].concat.apply([], series.map(function (item) { return item.rows; }));
    var years = allRows.map(function (item) { return Number(item.year); });
    var values = allRows.map(function (item) { return Number(item.value); });
    var minYear = Math.min.apply(null, years); var maxYear = Math.max.apply(null, years);
    var minValue = Math.min.apply(null, values); var maxValue = Math.max.apply(null, values);
    if (minValue === maxValue) { minValue -= 1; maxValue += 1; }
    var pad = (maxValue - minValue) * 0.12; minValue -= pad; maxValue += pad;
    var width = 560; var height = 150; var left = 15; var right = 15; var top = 12; var bottom = 22;
    var paths = series.map(function (item) {
      var points = item.rows.map(function (row) {
        var x = minYear === maxYear ? width / 2 : left + ((Number(row.year) - minYear) / (maxYear - minYear)) * (width - left - right);
        var y = top + ((maxValue - Number(row.value)) / (maxValue - minValue)) * (height - top - bottom);
        return { x: x, y: y };
      });
      return '<polyline fill="none" stroke="' + item.area.color + '" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="' + points.map(function (point) { return point.x.toFixed(1) + "," + point.y.toFixed(1); }).join(" ") + '" aria-label="' + item.area.label + '" />' + points.map(function (point, index) { return '<circle cx="' + point.x.toFixed(1) + '" cy="' + point.y.toFixed(1) + '" r="3" fill="' + item.area.color + '"><title>' + item.area.label + ' · ' + item.rows[index].year + ': ' + num(item.rows[index].value, 3) + '</title></circle>'; }).join("");
    }).join("");
    return '<div class="benchmark-chart"><svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Evolución anual de intensidad energética agregada para las áreas disponibles"><line x1="' + left + '" y1="' + (height - bottom) + '" x2="' + (width - right) + '" y2="' + (height - bottom) + '" class="benchmark-axis" />' + paths + '<text x="' + left + '" y="' + (height - 3) + '" class="benchmark-year">' + minYear + '</text><text x="' + (width - right) + '" y="' + (height - 3) + '" text-anchor="end" class="benchmark-year">' + maxYear + '</text></svg><div class="benchmark-legend">' + series.map(function (item) { return '<span><i style="--series-color:' + item.area.color + '"></i>' + item.area.label + '</span>'; }).join("") + '</div></div>';
  }

  function publicBenchmarkPanel() {
    var status = publicBenchmarkState.status;
    var data = publicBenchmarkState.data;
    if (!data) {
      var message = status === "file" ? "Esta pestaña se abrió como archivo local. Inicia Pyme360 con el lanzador de tu sistema; así se habilitan la consulta ONU y el lector de recibos." : status === "loading" ? "Consultando la serie pública de la ONU…" : status === "unavailable" ? "La referencia no está disponible en este momento. Tus registros de consumo siguen guardados." : "La referencia pública aparecerá aquí cuando se consulte.";
      return '<section class="panel public-benchmark"><div class="panel-header"><div><span class="status neutral">ODS 7.3.1 · ONU</span><h2>Contexto energético global y de Colombia</h2><p>' + message + '</p></div><button class="button button-secondary" data-action="environment-retry-reference"' + (status === "loading" || status === "file" ? ' disabled' : '') + '>Reintentar</button></div>' + (publicBenchmarkState.error ? '<p class="benchmark-error">' + esc(publicBenchmarkState.error) + '</p>' : '') + '<div class="public-benchmark-note">Este indicador anual mide energía primaria por PIB. No es un consumo objetivo para una fábrica ni se compara directamente con kWh por unidad producida.</div></section>';
    }
    var latest = {};
    data.observations.forEach(function (item) {
      var code = String(item.areaCode);
      if ((code === "1" || code === "170") && (!latest[code] || Number(item.year) > Number(latest[code].year))) latest[code] = item;
    });
    var cards = [{ code: "1", label: "Mundo" }, { code: "170", label: "Colombia" }].map(function (area) {
      var item = latest[area.code];
      return '<div class="benchmark-stat"><span>' + area.label + '</span>' + (item ? '<strong>' + num(item.value, 3) + '</strong><small>' + item.year + ' · ' + area.label + '</small>' : '<strong>Sin dato publicado</strong><small>La serie no incluye un valor reciente</small>') + '</div>';
    }).join("");
    var isStale = status === "stale" || data.stale;
    var isLoading = status === "loading";
    return '<section class="panel public-benchmark"><div class="panel-header"><div><span class="status ' + (isStale ? "pending" : "neutral") + '">ODS 7.3.1 · ' + (isLoading ? "Actualizando…" : isStale ? "Referencia guardada" : "Datos públicos") + '</span><h2>Contexto energético global y de Colombia</h2><p>Intensidad energética nacional: energía primaria suministrada por unidad de PIB. Datos anuales agregados.</p></div><button class="button button-secondary" data-action="environment-retry-reference"' + (isLoading ? ' disabled' : '') + '>' + (isLoading ? "Consultando…" : "Actualizar") + '</button></div>' +
      '<div class="benchmark-body"><div class="benchmark-stats">' + cards + '</div>' + renderBenchmarkChart(data.observations) + '</div>' +
      '<div class="public-benchmark-note"><strong>Unidad:</strong> ' + esc(data.unit || "MJ por unidad de PIB en PPA constante, según base publicada") + '. Este contexto no es una meta para tu fábrica ni se compara directamente con kWh por unidad producida. ' + (isStale ? 'Se muestra una respuesta guardada; ' : '') + esc(benchmarkAgeLabel(data)) + '. <strong>Fuente:</strong> ' + esc(data.source || "ONU · Base mundial de indicadores ODS") + '. <a href="' + esc(data.metadataUrl || "https://unstats.un.org/sdgs/metadata/?Goal=7&Target=7.3") + '" target="_blank" rel="noopener noreferrer">Ver metodología ONU</a>. ' + (data.sourceUrl ? '<a href="' + esc(data.sourceUrl) + '" target="_blank" rel="noopener noreferrer">Fuente de datos</a>.' : '') + '</div>' + (publicBenchmarkState.error ? '<p class="benchmark-error">' + esc(publicBenchmarkState.error) + '</p>' : '') + '</section>';
  }

  function environmentTargetBaseline(field) {
    var byPeriod = {};
    state.environment.forEach(function (item) {
      var consumption = Number(item[field]);
      var production = Number(item.productionUnits);
      if (item.period < currentPeriod && production > 0 && environmentHasReading(item, field) && Number.isFinite(consumption) && consumption >= 0) byPeriod[item.period] = consumption / production;
    });
    var periods = Object.keys(byPeriod).sort().slice(-3);
    var values = periods.map(function (period) { return byPeriod[period]; });
    return { periods: periods, average: values.length === 3 ? values.reduce(function (sum, value) { return sum + value; }, 0) / 3 : null };
  }

  function renderEnvironmentTarget(label, goalKey, field, unit, digits) {
    var percent = state.environmentTargets[goalKey];
    var baseline = environmentTargetBaseline(field);
    var target = percent != null && baseline.average != null ? baseline.average * (1 - Number(percent) / 100) : null;
    var hasCurrentRecord = state.environment.some(function (item) { return item.period === currentPeriod; });
    var current = currentEnvironment();
    var hasActual = hasCurrentRecord && Number(current.productionUnits) > 0 && environmentHasReading(current, field) && Number.isFinite(Number(current[field]));
    var actual = hasActual ? Number(current[field]) / Number(current.productionUnits) : null;
    var status = target == null ? "Sin referencia" : !hasActual ? "Falta dato del período" : actual <= target ? "Dentro de tu meta" : "Por encima de tu meta";
    var details = percent == null ? "Elige un porcentaje de mejora para crear una meta propia." : baseline.average == null ? "Necesitas tres meses anteriores con consumo y unidades producidas para calcular la referencia." : "Promedio de " + baseline.periods.map(function (period) { return monthName(period) + " " + period.slice(0, 4); }).join(", ") + ".";
    return '<article class="env-target-card"><div class="env-target-card-top"><strong>' + label + '</strong><span class="status neutral">' + status + '</span></div>' +
      (target == null ? '<p class="env-target-value">Meta pendiente</p>' : '<p class="env-target-value">' + num(target, digits) + ' ' + unit + '<small> por unidad · ' + num(percent) + '% menos que la referencia</small></p>') +
      '<p>' + details + '</p>' + (hasActual && target != null ? '<small class="env-target-actual">Este período: ' + num(actual, digits) + ' ' + unit + ' por unidad.</small>' : '') + '</article>';
  }

  function environmentHasReading(record, field) {
    var key = field === "electricityKwh" ? "energy" : "water";
    var source = record && record.readingSources && record.readingSources[key];
    var legacySource = record && record[(key === "energy" ? "energy" : "water") + "Source"];
    return Boolean(source || legacySource || Number(record && record[field]) > 0);
  }

  function environmentTrend(record, field) {
    var current = Number(record[field]) || 0;
    var currentIntensity = record.productionUnits > 0 ? current / record.productionUnits : 0;
    var history = state.environment.filter(function (item) {
      return item.period < currentPeriod && Number(item.productionUnits) > 0 && Number(item[field]) > 0;
    }).sort(function (a, b) { return a.period.localeCompare(b.period); }).slice(-3);
    var rates = history.map(function (item) { return Number(item[field]) / Number(item.productionUnits); });
    var reference = rates.length ? rates.reduce(function (sum, value) { return sum + value; }, 0) / rates.length : 0;
    var ready = rates.length >= 2 && current > 0 && currentIntensity > 0;
    var change = ready && reference ? Math.round((currentIntensity - reference) / reference * 100) : 0;
    return { ready: ready, change: change, intensity: currentIntensity, reference: reference, months: rates.length };
  }

  function trendBadge(trend) {
    if (!trend.ready) return '<span class="status neutral" title="Se necesitan dos meses anteriores con consumo y producción">Sin referencia suficiente</span>';
    var cls = trend.change > 10 ? "pending" : "";
    var sign = trend.change > 0 ? "+" : "";
    return '<span class="status ' + cls + '" title="Promedio propio: ' + num(trend.reference, 3) + ' por unidad en ' + trend.months + ' períodos anteriores con datos">' + sign + trend.change + '% vs. tus períodos anteriores</span>';
  }

  function sourceLabel(record, key) {
    var flatPrefix = key === "energy" ? "energy" : "water";
    var source = record.readingSources && record.readingSources[key];
    if (!source && record[flatPrefix + "Source"]) source = { label: record[flatPrefix + "Source"] };
    return source ? '<small class="reading-source">' + esc(source.label || "Dato confirmado") + '</small>' : "";
  }

  function envMetric(label, value, foot, icon) {
    return '<div class="env-metric"><div class="env-metric-top"><span>' + label + '</span><span class="env-metric-icon">' + icon + '</span></div><strong>' + value + '</strong><small>' + foot + '</small></div>';
  }

  function recommendation(icon, title, detail, green) {
    return '<div class="recommendation"><span class="recommendation-icon' + (green ? " green" : "") + '">' + icon + '</span><div><strong>' + title + '</strong><p>' + detail + '</p></div></div>';
  }

  /* Finanzas, contactos y datos */
  function renderFinance() {
    var due = state.sales.reduce(function (sum, sale) { return sum + saleOutstanding(sale); }, 0);
    var payable = state.purchases.filter(function (purchase) { return purchase.status === "Por recibir"; }).reduce(function (sum, purchase) { return sum + purchase.total; }, 0);
    var income = state.sales.filter(function (sale) { return sale.date.slice(0, 7) === currentPeriod; }).reduce(function (sum, sale) { return sum + sale.total; }, 0);
    var rows = state.sales.slice(0, 8).map(function (sale) {
      return '<tr><td><strong>' + esc(sale.number) + '</strong><small>' + dateLabel(sale.date) + '</small></td><td>' + esc(sale.customer) + '</td><td><strong>' + money(sale.total) + '</strong><small>Saldo: ' + money(saleOutstanding(sale)) + '</small></td><td>' + statusBadge(sale.status) + '</td></tr>';
    }).join("");
    return heading("TU NEGOCIO", "Finanzas", "Consulta lo que has vendido, lo que falta por cobrar y tus compromisos de compra.", '<button class="button button-secondary" data-action="finance-export">↓ Exportar movimientos</button><button class="button button-primary" data-action="new-payment"><span>＋</span> Registrar pago</button>') +
      '<div class="finance-cards"><div class="finance-card"><span>Ingresos registrados este mes</span><strong>' + money(income) + '</strong><small>Basado en ventas registradas</small></div><div class="finance-card"><span>Por cobrar a clientes</span><strong>' + money(due) + '</strong><small>Facturas pendientes de pago</small></div><div class="finance-card"><span>Compromisos de compra</span><strong>' + money(payable) + '</strong><small>Órdenes pendientes de recibir</small></div></div>' +
      '<section class="panel list-panel"><div class="panel-header"><div><h2>Movimientos recientes</h2><p>Resumen de ventas registradas. El contador puede revisar el detalle contable.</p></div><span class="status neutral">Resumen administrativo</span></div><div class="table-wrap"><table><thead><tr><th>DOCUMENTO</th><th>CONTACTO</th><th>VALOR / SALDO</th><th>ESTADO</th></tr></thead><tbody>' + (rows || '<tr><td colspan="4"><div class="empty-state"><strong>Aún no hay movimientos</strong><p>Cuando registres ventas, aparecerán aquí para facilitar la revisión.</p><button class="button button-primary" data-action="new-sale">Registrar primera venta</button></div></td></tr>') + '</tbody></table></div></section>' +
      '<div class="notice section-spacer"><span class="notice-icon">i</span><span>Este resumen sirve para el control del negocio. No reemplaza los libros ni las declaraciones preparados o revisados por tu contador.</span></div>';
  }

  function renderContacts() {
    var rows = state.contacts.map(function (item) {
      var displayName = item.name || (item.ordinaryCustomer ? "Cliente de mostrador" : "Contacto sin nombre");
      var initials = displayName.split(/\s+/).slice(0, 2).map(function (part) { return part.charAt(0); }).join("").toUpperCase();
      var isCustomer = item.role.indexOf("Cliente") >= 0;
      var isSupplier = item.role.indexOf("Proveedor") >= 0;
      var roleBadges = (isCustomer ? statusBadge(item.ordinaryCustomer ? "Cliente ordinario" : "Cliente", "neutral") : "") + (isSupplier ? statusBadge("Proveedor", "neutral") : "");
      return '<tr><td><div class="contact-cell"><span class="contact-avatar">' + esc(initials) + '</span><span><strong>' + esc(displayName) + '</strong><small>' + esc(item.idNumber || "Identificación pendiente") + '</small></span></div></td><td><div class="contact-role-badges">' + roleBadges + '</div></td><td>' + esc(item.email || "—") + '</td><td>' + esc(item.phone || "—") + '</td><td><div class="contact-row-actions"><button class="button-quiet" data-action="contact-detail" data-id="' + esc(item.id) + '">Ver</button><button class="button-quiet" data-action="contact-edit" data-id="' + esc(item.id) + '">Editar</button><button class="button-quiet button-quiet-danger" data-action="contact-delete" data-id="' + esc(item.id) + '">Eliminar</button></div></td></tr>';
    }).join("");
    return heading("TU NEGOCIO", "Contactos", "Ten a mano los datos de tus clientes y proveedores.", '<button class="button button-primary" data-action="new-contact"><span>＋</span> Nuevo contacto</button>') +
      '<div class="toolbar"><div class="toolbar-left"><label class="search-field"><span>⌕</span><input type="search" placeholder="Buscar por nombre o identificación" data-filter="contacts"></label><select class="filter-select" id="contact-role"><option value="Todos">Todos los contactos</option><option>Cliente</option><option>Proveedor</option></select></div><span class="muted-note">' + state.contacts.length + ' contactos</span></div>' +
      '<section class="panel list-panel"><div class="table-wrap"><table><thead><tr><th>CONTACTO</th><th>TIPO</th><th>CORREO</th><th>TELÉFONO</th><th></th></tr></thead><tbody id="contact-rows">' + (rows || '<tr><td colspan="5"><div class="empty-state"><div class="empty-icon">♙</div><strong>Aún no tienes contactos</strong><p>Agrega tus propios clientes y proveedores. Los datos se guardan en este computador.</p><button class="button button-primary" data-action="new-contact">Agregar primer contacto</button></div></td></tr>') + '</tbody></table></div></section>';
  }

  function renderData() {
    var total = state.contacts.length + state.inventory.length + state.sales.length + state.purchases.length + state.production.length + state.environment.length;
    var writeDisabled = readOnlyMode ? " disabled" : "";
    var storageNotice = readOnlyMode ? (window.location.protocol === "file:" ? "Modo de solo lectura: esta pestaña no puede guardar en SQLite. Si aquí ves datos anteriores, descarga el respaldo y restáuralo después de abrir Pyme360 con el lanzador." : "No hay conexión con SQLite. Puedes descargar los datos visibles, pero podrían no incluir los últimos cambios confirmados en la base local.") : "Los archivos se leen y descargan desde el navegador. Tus registros se guardan en SQLite en este computador; no se sincronizan con otros equipos.";
    var body = '<div class="excel-actions-grid">' +
      '<section class="panel excel-action-card"><div class="excel-action-icon">↓</div><h2>Descargar Excel maestro</h2><p>Un solo archivo con los datos de tu empresa, separados por hojas. Se descarga cuando tú lo pides.</p><button class="button button-primary" data-action="excel-download-master">Descargar Excel maestro</button></section>' +
      '<section class="panel excel-action-card"><div class="excel-action-icon">▤</div><h2>Descargar plantilla vacía</h2><p>Usa los mismos encabezados del Excel maestro para organizar información nueva.</p><button class="button button-secondary" data-action="excel-download-template">Descargar plantilla vacía</button></section>' +
      '<section class="panel excel-action-card"><div class="excel-action-icon">↑</div><h2>Importar Excel de la empresa</h2><p>Selecciona un archivo, relaciona sus columnas y revisa los cambios antes de guardarlos.</p><button class="button button-secondary" data-action="excel-select-file"' + writeDisabled + '>Elegir archivo Excel</button><input class="visually-hidden" type="file" id="excel-import-file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"></section>' +
      '<section class="panel excel-action-card"><div class="excel-action-icon">⌂</div><h2>Respaldo y recuperación</h2><p>Descarga una copia de tus registros. Restaurar reemplaza los datos actuales de Pyme360 en este computador.</p><div class="backup-actions"><button class="button button-secondary" data-action="backup-download">Descargar respaldo</button><button class="button button-quiet" data-action="backup-select-file"' + writeDisabled + '>Restaurar respaldo</button></div><input class="visually-hidden" type="file" id="backup-restore-file" accept=".json,application/json"></section>' +
      '</div><div class="notice section-spacer"><span class="notice-icon">i</span><span>' + esc(storageNotice) + '</span></div>' +
      '<section class="panel section-spacer"><div class="panel-header"><div><h2>Qué incluye el Excel</h2><p>' + total + ' registros principales guardados en esta demostración.</p></div></div><div class="panel-body"><div class="excel-sheet-list"><span>Empresa</span><span>Contactos</span><span>Productos</span><span>Recetas</span><span>Ventas</span><span>Detalle de ventas</span><span>Pagos recibidos</span><span>Compras</span><span>Detalle de compras</span><span>Producción y consumos</span><span>Impacto ambiental</span><span>Datos adicionales</span></div><p class="form-note">La plantilla incluye los encabezados aunque todavía no tengas registros. Los resúmenes y la actividad reciente se calculan dentro de la aplicación y no se exportan como datos fuente.</p></div></section>';
    if (importSession) body += renderImportWizard();
    return heading("TUS DATOS", "Datos y Excel", "Descarga una copia de trabajo o trae los datos que ya tienes en una hoja de cálculo.", "") + body;
  }

  function downloadBackup() {
    var backup = { product: "Pyme360", formatVersion: 1, createdAt: new Date().toISOString(), state: state };
    var blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "pyme360-respaldo-" + today() + ".json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast("Respaldo descargado", "Guárdalo en un lugar seguro. Incluye los datos locales de esta empresa.");
  }

  function normalizeBackupState(rawState) {
    if (!rawState || typeof rawState !== "object" || Array.isArray(rawState)) throw new Error("El respaldo no contiene los datos de una empresa.");
    var next = Object.assign(seedState(), rawState);
    ["contacts", "inventory", "sales", "purchases", "production", "environment", "activity", "importExtras"].forEach(function (key) {
      if (!Array.isArray(next[key])) throw new Error("El respaldo tiene una sección incompleta: " + key + ".");
      if (next[key].some(function (item) { return !item || typeof item !== "object" || Array.isArray(item); })) throw new Error("El respaldo contiene filas inválidas en " + key + ".");
    });
    ["company", "companyNit", "city", "activityType"].forEach(function (key) { if (typeof next[key] !== "string") next[key] = String(next[key] || ""); });
    if (!next.environmentTargets || typeof next.environmentTargets !== "object") next.environmentTargets = { energyReductionPct: null, waterReductionPct: null };
    ["energyReductionPct", "waterReductionPct"].forEach(function (key) {
      var percentage = Number(next.environmentTargets[key]);
      next.environmentTargets[key] = next.environmentTargets[key] != null && Number.isInteger(percentage) && percentage >= 1 && percentage <= 99 ? percentage : null;
    });
    next.contacts.forEach(function (contact) { if (typeof contact.ordinaryCustomer !== "boolean") contact.ordinaryCustomer = false; });
    next.sales.forEach(function (sale) {
      if (!Array.isArray(sale.lines)) sale.lines = [];
      if (!Array.isArray(sale.payments)) sale.payments = [];
      if (!sale.payments.length && sale.status === "Pagada") sale.payments.push({ id: "legacy-" + (sale.id || sale.number), date: sale.paidDate || sale.date || today(), amount: Number(sale.total) || 0, method: sale.method || sale.payment || "Pago registrado", legacy: true });
      if (typeof sale.inventoryApplied !== "boolean") sale.inventoryApplied = String(sale.id || "").indexOf("imp-") !== 0;
    });
    next.purchases.forEach(function (purchase) {
      if (!Array.isArray(purchase.lines)) purchase.lines = [];
      if (typeof purchase.inventoryApplied !== "boolean") purchase.inventoryApplied = String(purchase.id || "").indexOf("imp-") !== 0 && purchase.status !== "Por recibir";
    });
    next.production.forEach(function (order) { if (typeof order.inventoryApplied !== "boolean") order.inventoryApplied = String(order.id || "").indexOf("imp-") !== 0; });
    next.environment.forEach(function (record) {
      if (!record.readingSources) record.readingSources = {};
      if (!record.readingSources.energy && record.energySource) record.readingSources.energy = { label: record.energySource, method: record.energyMethod || "manual", confirmedAt: record.energyCapturedAt || "" };
      if (!record.readingSources.water && record.waterSource) record.readingSources.water = { label: record.waterSource, method: record.waterMethod || "manual", confirmedAt: record.waterCapturedAt || "" };
    });
    return next;
  }

  function startBackupRestore(file) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) return toast("El respaldo es demasiado grande", "El límite de esta demostración es 20 MB.");
    var reader = new FileReader();
    reader.onerror = function () { toast("No se pudo leer el respaldo", "El archivo no se modificó. Intenta seleccionarlo de nuevo."); };
    reader.onload = function (event) {
      try {
        var envelope = JSON.parse(event.target.result);
        if (!envelope || envelope.product !== "Pyme360" || envelope.formatVersion !== 1) throw new Error("El archivo no es un respaldo compatible de Pyme360.");
        backupSession = normalizeBackupState(envelope.state);
        var count = backupSession.contacts.length + backupSession.inventory.length + backupSession.sales.length + backupSession.purchases.length + backupSession.production.length + backupSession.environment.length;
        openModal("Revisar respaldo", "Confirma qué información quieres recuperar.", '<div class="modal-form"><p>El respaldo de <strong>' + esc(backupSession.company || "tu empresa") + '</strong> contiene <strong>' + count + ' registros principales</strong> y fue creado el ' + esc(envelope.createdAt ? new Date(envelope.createdAt).toLocaleString("es-CO") : "fecha desconocida") + '.</p><p class="form-note">Al confirmar, los datos actuales de Pyme360 en este computador serán reemplazados por los del respaldo. Si quieres conservarlos, descarga primero otro respaldo.</p><div class="modal-footer"><button class="button button-secondary" data-action="backup-cancel-restore">Cancelar</button><button class="button button-primary" data-action="backup-confirm-restore">Restaurar datos</button></div></div>');
      } catch (error) {
        backupSession = null;
        toast("No pudimos abrir el respaldo", error.message || "Revisa que sea un JSON de Pyme360.");
      }
    };
    reader.readAsText(file, "UTF-8");
  }

  function confirmBackupRestore() {
    if (!backupSession) return toast("No hay un respaldo listo para restaurar");
    state = backupSession;
    saveState().then(function (saved) { if (saved) backupSession = null; });
    closeModal();
    render();
    toast("Respaldo restaurado", "Los datos de esta empresa quedaron guardados en SQLite en este computador.");
  }

  /* Importación Excel: interfaz de revisión */
  function renderImportWizard() {
    var analysis = buildImportAnalysis();
    var readyCount = analysis.valid.length + analysis.details.filter(function (item) { return item.valid && !item.duplicate; }).length + analysis.extras.length;
    var entityOptions = importEntityOptions();
    var mappingCards = importSession.sheets.map(function (sheet, sheetIndex) {
      var config = sheet.config;
      var rowOptions = sheet.rows.slice(0, Math.min(10, sheet.rows.length)).map(function (row, index) {
        var title = row.slice(0, 4).map(function (cell) { return String(cell == null ? "" : cell).trim(); }).filter(Boolean).join(" · ");
        return '<option value="' + index + '"' + (index === config.headerRow ? " selected" : "") + '>Fila ' + (index + 1) + (title ? ": " + esc(title.slice(0, 70)) : "") + '</option>';
      }).join("");
      var fields = config.entity && config.entity !== "ignore" ? importFields(config.entity) : [];
      var header = sheet.rows[config.headerRow] || [];
      var fieldControls = fields.map(function (field) {
        var selected = config.mapping[field.key] == null ? "" : String(config.mapping[field.key]);
        var columnOptions = '<option value="">No importar</option>' + header.map(function (cell, columnIndex) {
          var label = String(cell == null || cell === "" ? "Columna " + (columnIndex + 1) : cell);
          return '<option value="' + columnIndex + '"' + (selected === String(columnIndex) ? " selected" : "") + '>' + esc(label) + '</option>';
        }).join("");
        return '<label class="excel-map-field"><span>' + esc(field.label) + (field.required ? ' <b>*</b>' : '') + '</span><select data-excel-map-field="' + esc(field.key) + '" data-excel-sheet="' + sheetIndex + '">' + columnOptions + '</select></label>';
      }).join("");
      var sample = sheet.rows.slice(config.headerRow + 1, config.headerRow + 3).map(function (row) {
        return '<tr>' + header.slice(0, 5).map(function (_, col) { return '<td>' + esc(row[col] == null ? "" : row[col]) + '</td>'; }).join("") + '</tr>';
      }).join("");
      return '<details class="excel-sheet-card" ' + (sheetIndex === importSession.openSheet ? "open" : "") + '><summary><strong>' + esc(sheet.name) + '</strong><span>' + (config.entity === "ignore" ? "No se importará" : esc(importEntityLabel(config.entity))) + '</span></summary><div class="excel-sheet-content"><div class="excel-config-row"><label>¿Qué tipo de datos contiene?<select data-excel-entity data-excel-sheet="' + sheetIndex + '">' + entityOptions.replace('value="' + esc(config.entity) + '"', 'value="' + esc(config.entity) + '" selected') + '</select></label><label>Fila de encabezados<select data-excel-header data-excel-sheet="' + sheetIndex + '">' + rowOptions + '</select></label></div>' +
        (fields.length ? '<div class="excel-map-grid">' + fieldControls + '</div>' : '<p class="form-note">Esta hoja no se usará para importar datos de Pyme360.</p>') +
        (sample ? '<div class="table-wrap excel-sample"><table><thead><tr>' + header.slice(0, 5).map(function (cell) { return '<th>' + esc(cell || "Columna") + '</th>'; }).join("") + '</tr></thead><tbody>' + sample + '</tbody></table></div>' : '') + '</div></details>';
    }).join("");
    var issues = analysis.issues.slice(0, 20).map(function (issue) {
      return '<tr><td>' + esc(issue.sheet) + ' · fila ' + issue.row + '</td><td>' + esc(issue.label) + '</td><td>' + esc(issue.reason) + '</td></tr>';
    }).join("");
    var duplicates = analysis.duplicates.slice(0, 10).map(function (candidate) {
      return '<li><strong>' + esc(candidate.label) + '</strong> · ' + esc(candidate.keyLabel) + '</li>';
    }).join("");
    var content = '<section class="panel excel-import-panel"><div class="panel-header"><div><h2>Revisar archivo: ' + esc(importSession.name) + '</h2><p>Relaciona cada hoja y confirma qué columnas corresponden a Pyme360.</p></div><button class="button-quiet" data-action="excel-cancel-import">Cancelar</button></div><div class="panel-body">' + mappingCards +
      '<div class="excel-summary-grid"><div><strong>' + readyCount + '</strong><span>Filas listas</span></div><div><strong>' + analysis.duplicates.length + '</strong><span>Duplicados</span></div><div><strong>' + analysis.issues.length + '</strong><span>Por revisar</span></div></div>' +
      (analysis.duplicates.length ? '<label class="excel-update-option"><input type="checkbox" id="excel-update-duplicates"' + (importSession.updateDuplicates ? " checked" : "") + '> Actualizar duplicados solo con los datos no vacíos del archivo</label><ul class="excel-duplicate-list">' + duplicates + (analysis.duplicates.length > 10 ? '<li>Y ' + (analysis.duplicates.length - 10) + ' más…</li>' : '') + '</ul>' : '') +
      (analysis.issues.length ? '<div class="table-wrap excel-issues"><table><thead><tr><th>UBICACIÓN</th><th>REGISTRO</th><th>QUÉ FALTA O NO COINCIDE</th></tr></thead><tbody>' + issues + '</tbody></table></div>' + (analysis.issues.length > 20 ? '<p class="form-note">Se muestran las primeras 20 filas por revisar. El resto también se conserva sin importar.</p>' : '') : '') +
      '<p class="form-note">Solo se guardarán las filas listas. Las referencias faltantes y los duplicados omitidos no se aplicarán. Los campos vacíos nunca borran información que ya exista.</p><div class="excel-import-footer"><button class="button button-secondary" data-action="excel-cancel-import">Cancelar</button><button class="button button-primary" data-action="excel-confirm-import"' + (!readyCount && !(analysis.duplicates.length && importSession.updateDuplicates) ? ' disabled' : '') + '>Confirmar e importar</button></div></div></section>';
    return content;
  }

  /* Importación Excel: esquema de campos */
  var IMPORT_ENTITIES = {
    ignore: "No importar",
    company: "Empresa",
    contacts: "Contactos",
    products: "Productos",
    recipes: "Recetas",
    sales: "Ventas",
    saleLines: "Detalle de ventas",
    purchases: "Compras",
    purchaseLines: "Detalle de compras",
    salePayments: "Pagos recibidos",
    production: "Producción",
    productionInputs: "Consumos de producción",
    environment: "Impacto ambiental",
    extras: "Datos adicionales"
  };

  var IMPORT_FIELDS = {
    company: [
      fieldDef("company", "Nombre o razón social", true, ["nombre", "empresa", "razon social", "nombre o razon social", "company"]),
      fieldDef("companyNit", "NIT", false, ["nit", "identificacion tributaria"]),
      fieldDef("city", "Ciudad", false, ["ciudad", "municipio"]),
      fieldDef("activityType", "Actividad", false, ["actividad", "sector"])
    ],
    contacts: [
      fieldDef("id", "ID", false, ["id", "identificador"]), fieldDef("name", "Nombre", true, ["nombre", "razon social", "contacto", "cliente", "proveedor"]),
      fieldDef("role", "Tipo", true, ["tipo", "rol", "tipo de contacto", "clase"]), fieldDef("ordinaryCustomer", "Cliente ordinario", false, ["cliente ordinario", "es cliente ordinario", "clasificacion cliente", "clasificacion comercial"]),
      fieldDef("idNumber", "Identificación", false, ["nit", "cedula", "identificacion", "numero de documento"]),
      fieldDef("email", "Correo", false, ["correo", "email", "correo electronico"]), fieldDef("phone", "Teléfono", false, ["telefono", "celular", "telefono de contacto"])
    ],
    products: [
      fieldDef("id", "ID", false, ["id", "identificador"]), fieldDef("sku", "SKU / código", true, ["sku", "codigo", "referencia", "codigo de producto"]),
      fieldDef("name", "Nombre", true, ["nombre", "producto", "material", "descripcion"]), fieldDef("type", "Tipo", true, ["tipo", "tipo de producto", "clase"]),
      fieldDef("unit", "Unidad", true, ["unidad", "unidad de medida", "um"]), fieldDef("stock", "Existencia", false, ["existencia", "stock", "cantidad", "saldo"]),
      fieldDef("min", "Mínimo", false, ["minimo", "stock minimo"]), fieldDef("cost", "Costo unitario COP", false, ["costo", "costo unitario", "costo unitario cop", "valor unitario de compra"]),
      fieldDef("price", "Precio COP", false, ["precio", "precio cop", "precio de venta"]), fieldDef("taxType", "Tipo de IVA", false, ["tipo de iva", "iva", "impuesto"]), fieldDef("taxRate", "Tarifa IVA %", false, ["tarifa iva", "tarifa iva %", "porcentaje iva", "iva porcentaje"])
    ],
    recipes: [fieldDef("productSku", "Producto SKU", true, ["producto sku", "sku producto", "producto", "producto terminado"]), fieldDef("materialSku", "Material SKU", true, ["material sku", "sku material", "insumo sku", "materia prima sku"]), fieldDef("amount", "Cantidad por unidad", true, ["cantidad por unidad", "cantidad", "consumo unitario"])],
    sales: [
      fieldDef("id", "ID", false, ["id", "identificador"]), fieldDef("number", "Número", true, ["numero", "numero de factura", "factura", "documento", "consecutivo"]),
      fieldDef("customer", "Cliente", true, ["cliente", "comprador", "razon social cliente"]), fieldDef("date", "Fecha", true, ["fecha", "fecha de venta", "fecha factura"]),
      fieldDef("total", "Total COP", true, ["total", "valor total", "total cop", "valor"]), fieldDef("discount", "Descuento COP", false, ["descuento", "descuento cop"]), fieldDef("taxRate", "IVA %", false, ["iva", "iva porcentaje", "tarifa iva"]),
      fieldDef("status", "Estado", false, ["estado", "estado de pago"]), fieldDef("payment", "Forma de pago", false, ["forma de pago", "condicion de pago", "pago"]),
      fieldDef("paidDate", "Fecha de pago", false, ["fecha de pago", "fecha pago"]), fieldDef("method", "Medio de pago", false, ["medio de pago", "metodo de pago"]),
      fieldDef("invoiceFollowUpStatus", "Seguimiento de factura", false, ["seguimiento de factura", "estado factura externa", "estado diAN", "seguimiento dian"]),
      fieldDef("externalInvoiceNumber", "Número del documento externo", false, ["numero del documento externo", "numero documento externo", "documento externo"]),
      fieldDef("externalInvoiceDate", "Fecha del documento externo", false, ["fecha del documento externo", "fecha documento externo"])
    ],
    saleLines: [fieldDef("saleNumber", "Número de venta", true, ["numero de venta", "venta", "factura", "numero factura"]), fieldDef("sku", "Producto SKU", true, ["producto sku", "sku", "codigo", "referencia"]), fieldDef("quantity", "Cantidad", true, ["cantidad", "unidades"]), fieldDef("unitPrice", "Precio unitario COP", false, ["precio unitario", "precio unitario cop"]), fieldDef("taxRate", "IVA %", false, ["iva %", "tarifa iva", "porcentaje iva"])],
    purchases: [
      fieldDef("id", "ID", false, ["id", "identificador"]), fieldDef("number", "Número", true, ["numero", "orden", "orden de compra", "factura proveedor", "documento"]),
      fieldDef("supplier", "Proveedor", true, ["proveedor", "vendedor", "razon social proveedor"]), fieldDef("date", "Fecha", true, ["fecha", "fecha de compra", "fecha factura"]),
      fieldDef("total", "Total COP", true, ["total", "valor total", "total cop", "valor"]), fieldDef("status", "Estado", false, ["estado", "estado de compra"]),
      fieldDef("detail", "Detalle", false, ["detalle", "descripcion", "producto"]), fieldDef("productSku", "Producto SKU", false, ["producto sku", "sku", "codigo"]), fieldDef("quantity", "Cantidad", false, ["cantidad", "unidades"])
    ],
    purchaseLines: [fieldDef("purchaseNumber", "Número de compra", true, ["numero de compra", "compra", "numero de orden", "orden", "factura proveedor"]), fieldDef("sku", "Producto SKU", true, ["producto sku", "sku", "codigo", "referencia"]), fieldDef("quantity", "Cantidad", true, ["cantidad", "unidades"]), fieldDef("total", "Costo total COP", true, ["costo total", "costo total cop", "valor de linea", "total cop"])],
    salePayments: [fieldDef("paymentId", "ID de pago", false, ["id de pago", "payment id"]), fieldDef("saleNumber", "Número de venta", true, ["numero de venta", "venta", "factura", "numero factura"]), fieldDef("date", "Fecha", true, ["fecha", "fecha de pago"]), fieldDef("amount", "Valor recibido COP", true, ["valor recibido", "valor recibido cop", "abono", "monto", "valor"]), fieldDef("method", "Medio de pago", false, ["medio de pago", "metodo", "metodo de pago"])],
    production: [
      fieldDef("id", "ID", false, ["id", "identificador"]), fieldDef("number", "Número de orden", true, ["numero de orden", "orden", "orden de produccion", "consecutivo"]),
      fieldDef("productSku", "Producto SKU", false, ["producto sku", "sku", "codigo de producto"]), fieldDef("product", "Producto", false, ["producto", "producto terminado", "nombre del producto"]),
      fieldDef("quantity", "Cantidad", true, ["cantidad", "unidades", "cantidad producida"]), fieldDef("date", "Fecha", true, ["fecha", "fecha de orden", "fecha de produccion"]),
      fieldDef("status", "Estado", false, ["estado", "estado de orden"]), fieldDef("wasteKg", "Desperdicio kg", false, ["desperdicio", "desperdicio kg", "residuo kg"]), fieldDef("completedDate", "Fecha de terminación", false, ["fecha de terminacion", "fecha finalizacion"])
    ],
    productionInputs: [fieldDef("productionNumber", "Número de orden", true, ["numero de orden", "orden", "orden de produccion"]), fieldDef("sku", "Material SKU", true, ["material sku", "sku", "codigo material"]), fieldDef("quantity", "Cantidad consumida", true, ["cantidad consumida", "cantidad", "consumo"])],
    environment: [
      fieldDef("period", "Período", true, ["periodo", "mes", "periodo ambiental"]), fieldDef("electricityKwh", "Energía kWh", false, ["energia kwh", "energia", "electricidad", "kwh"]),
      fieldDef("waterM3", "Agua m³", false, ["agua m3", "agua", "metros cubicos"]), fieldDef("fuelL", "Combustible L", false, ["combustible l", "combustible", "gasolina", "diesel"]),
      fieldDef("organicKg", "Residuos orgánicos kg", false, ["residuos organicos kg", "organicos", "residuos organicos"]), fieldDef("recyclableKg", "Aprovechables kg", false, ["aprovechables kg", "aprovechables", "reciclables"]),
      fieldDef("nonRecyclableKg", "No aprovechables kg", false, ["no aprovechables kg", "no aprovechables", "ordinarios"]), fieldDef("hazardousKg", "Peligrosos kg", false, ["peligrosos kg", "peligrosos", "residuos peligrosos"]),
      fieldDef("recycledKg", "Reciclado kg", false, ["reciclado kg", "reciclado o reutilizado kg", "reciclado o reutilizado", "reutilizado", "reciclado"]), fieldDef("productionUnits", "Producción unidades", false, ["produccion unidades", "unidades producidas", "produccion"]),
      fieldDef("energySource", "Origen energía", false, ["origen energia", "fuente energia"]), fieldDef("energyMethod", "Método energía", false, ["metodo energia"]), fieldDef("energyCapturedAt", "Fecha de confirmación energía", false, ["fecha de confirmacion energia"]),
      fieldDef("waterSource", "Origen agua", false, ["origen agua", "fuente agua"]), fieldDef("waterMethod", "Método agua", false, ["metodo agua"]), fieldDef("waterCapturedAt", "Fecha de confirmación agua", false, ["fecha de confirmacion agua"])
    ],
    extras: [fieldDef("entity", "Entidad", true, ["entidad", "tipo de dato"]), fieldDef("recordKey", "Clave del registro", true, ["clave del registro", "clave", "registro"]), fieldDef("field", "Campo original", true, ["campo original", "campo"]), fieldDef("value", "Valor", false, ["valor", "dato"])]
  };

  function fieldDef(key, label, required, aliases) { return { key: key, label: label, required: required, aliases: aliases }; }
  function importFields(entity) { return IMPORT_FIELDS[entity] || []; }
  function importEntityLabel(entity) { return IMPORT_ENTITIES[entity] || entity; }
  function importEntityOptions() {
    return Object.keys(IMPORT_ENTITIES).map(function (key) { return '<option value="' + key + '">' + esc(IMPORT_ENTITIES[key]) + '</option>'; }).join("");
  }
  /* Importación Excel: detección y lectura de columnas */
  function normalizedText(value) {
    return String(value == null ? "" : value).replace(/³/g, "3").toLocaleLowerCase("es-CO").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  }
  function guessImportEntity(name) {
    var value = normalizedText(name);
    var aliases = { company: ["empresa", "compania"], contacts: ["contactos", "contacto", "clientes", "proveedores"], products: ["productos", "inventario", "items", "articulos"], recipes: ["recetas", "formula", "materiales por producto"], sales: ["ventas", "facturas", "facturas de venta"], saleLines: ["detalle de ventas", "detalle ventas", "lineas de venta"], purchases: ["compras", "ordenes de compra"], purchaseLines: ["detalle de compras", "detalle compras", "lineas de compra"], salePayments: ["pagos recibidos", "pagos de ventas", "abonos"], production: ["produccion", "ordenes de produccion"], productionInputs: ["consumos de produccion", "consumo produccion"], environment: ["impacto ambiental", "ambiental", "medio ambiente"], extras: ["datos adicionales"] };
    return Object.keys(aliases).find(function (key) { return aliases[key].some(function (alias) { return value === normalizedText(alias); }); }) || "ignore";
  }
  function mapImportHeader(header, entity) {
    var value = normalizedText(header);
    if (!value) return "";
    var field = importFields(entity).find(function (item) { return item.aliases.some(function (alias) { return normalizedText(alias) === value; }); });
    return field ? field.key : "";
  }
  function guessHeaderRow(rows, entity) {
    var best = 0, bestScore = -1;
    rows.slice(0, 10).forEach(function (row, index) {
      var seen = {};
      row.forEach(function (cell) { var key = mapImportHeader(cell, entity); if (key) seen[key] = true; });
      var score = Object.keys(seen).length;
      if (score > bestScore) { best = index; bestScore = score; }
    });
    return best;
  }
  function startExcelImport(file) {
    if (!window.Pyme360Excel) return toast("No está listo el Excel", "Recarga la página e inténtalo de nuevo.");
    window.Pyme360Excel.readFile(file).then(function (parsed) {
      importSession = { name: parsed.name, updateDuplicates: false, openSheet: 0, sheets: parsed.sheets.map(function (sheet) {
        var entity = guessImportEntity(sheet.name);
        var headerRow = guessHeaderRow(sheet.rows, entity);
        var mapping = {};
        (sheet.rows[headerRow] || []).forEach(function (cell, index) { var key = mapImportHeader(cell, entity); if (key && mapping[key] == null) mapping[key] = index; });
        return { name: sheet.name, rows: sheet.rows, config: { entity: entity, headerRow: headerRow, mapping: mapping } };
      }) };
      render();
      toast("Archivo leído", "Revisa las hojas y columnas antes de guardar.");
    }).catch(function (error) { toast("No se pudo abrir el Excel", error.message || "Revisa el archivo e inténtalo de nuevo."); });
  }
  function configureImportSheet(sheetIndex, entity, headerRow) {
    var sheet = importSession && importSession.sheets[sheetIndex];
    if (!sheet) return;
    var mapping = {};
    (sheet.rows[headerRow] || []).forEach(function (cell, index) { var key = mapImportHeader(cell, entity); if (key && mapping[key] == null) mapping[key] = index; });
    sheet.config = { entity: entity, headerRow: headerRow, mapping: mapping };
  }

  function importNumber(value) {
    if (value == null || value === "") return "";
    if (typeof value === "number") return Number.isFinite(value) ? value : "";
    var text = String(value).trim().replace(/\s/g, "").replace(/\$/g, "");
    if (!text) return "";
    if (text.indexOf(",") >= 0 && text.indexOf(".") >= 0) text = text.replace(/\./g, "").replace(",", ".");
    else if (text.indexOf(",") >= 0) text = text.replace(",", ".");
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(text)) text = text.replace(/\./g, "");
    var number = Number(text);
    return Number.isFinite(number) ? number : "";
  }
  function importDate(value) {
    if (value == null || value === "") return "";
    if (typeof value === "number" && window.XLSX && window.XLSX.SSF) {
      var parsed = window.XLSX.SSF.parse_date_code(value);
      if (parsed) return String(parsed.y).padStart(4, "0") + "-" + String(parsed.m).padStart(2, "0") + "-" + String(parsed.d).padStart(2, "0");
    }
    var text = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
    var match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (match) return String(match[3].length === 2 ? "20" + match[3] : match[3]).padStart(4, "0") + "-" + String(match[2]).padStart(2, "0") + "-" + String(match[1]).padStart(2, "0");
    return text;
  }
  function validImportDate(value) {
    var match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return false;
    var date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() + 1 === Number(match[2]) && date.getUTCDate() === Number(match[3]);
  }
  function parsedImportRow(sheet, rowIndex) {
    var config = sheet.config;
    var fields = importFields(config.entity);
    var header = sheet.rows[config.headerRow] || [];
    var row = sheet.rows[rowIndex] || [];
    var data = {};
    fields.forEach(function (field) {
      var column = config.mapping[field.key];
      var value = column == null ? "" : row[column];
      if (["date", "paidDate", "completedDate", "externalInvoiceDate"].indexOf(field.key) >= 0) value = importDate(value);
      else if (field.key === "period" && typeof value === "number" && window.XLSX && window.XLSX.SSF) {
        var periodDate = window.XLSX.SSF.parse_date_code(value);
        value = periodDate ? String(periodDate.y).padStart(4, "0") + "-" + String(periodDate.m).padStart(2, "0") : "";
      }
      else if (["stock", "min", "cost", "price", "discount", "taxRate", "unitPrice", "amount", "total", "quantity", "wasteKg", "electricityKwh", "waterM3", "fuelL", "organicKg", "recyclableKg", "nonRecyclableKg", "hazardousKg", "recycledKg", "productionUnits"].indexOf(field.key) >= 0) value = importNumber(value);
      else if (config.entity === "extras" && field.key === "value") value = value == null ? "" : value;
      else value = String(value == null ? "" : value).trim();
      data[field.key] = value;
    });
    return { data: data, header: header, row: row };
  }
  /* Importación Excel: validación y deduplicación */
  function importRecordKey(entity, data) {
    if (entity === "company") return normalizedText(data.companyNit || data.company || "empresa");
    if (entity === "contacts") return normalizedText(data.idNumber || (data.name + "|" + data.role));
    if (entity === "products") return normalizedText(data.sku || (data.name + "|" + data.type));
    if (entity === "sales") return normalizedText(data.number);
    if (entity === "purchases") return normalizedText(data.number + "|" + data.supplier);
    if (entity === "production") return normalizedText(data.number);
    if (entity === "environment") return normalizedText(data.period);
    if (entity === "recipes") return normalizedText(data.productSku + "|" + data.materialSku);
    if (entity === "saleLines") return normalizedText(data.saleNumber + "|" + data.sku);
    if (entity === "purchaseLines") return normalizedText(data.purchaseNumber + "|" + data.sku);
    if (entity === "salePayments") return normalizedText(data.paymentId || (data.saleNumber + "|" + data.date + "|" + data.amount + "|" + data.method));
    if (entity === "productionInputs") return normalizedText(data.productionNumber + "|" + data.sku);
    return "";
  }
  function findImportDuplicate(entity, data) {
    var collection = entity === "contacts" ? state.contacts : entity === "products" ? state.inventory : entity === "sales" ? state.sales : entity === "purchases" ? state.purchases : entity === "production" ? state.production : entity === "environment" ? state.environment : [];
    return collection.find(function (item) {
      if (entity === "company") return (data.companyNit && normalizedText(item.companyNit) === normalizedText(data.companyNit)) || (!!data.company && normalizedText(item.company) === normalizedText(data.company));
      if (entity === "contacts") return (!!data.idNumber && !!item.idNumber && normalizedText(item.idNumber) === normalizedText(data.idNumber)) || ((!data.idNumber || !item.idNumber) && normalizedText(item.name) === normalizedText(data.name) && normalizedText(item.role) === normalizedText(data.role));
      if (entity === "products") return (!!data.sku && !!item.sku && normalizedText(item.sku) === normalizedText(data.sku)) || ((!data.sku || !item.sku) && normalizedText(item.name) === normalizedText(data.name) && normalizedText(item.type) === normalizedText(data.type));
      if (entity === "purchases") return normalizedText(item.number) === normalizedText(data.number) && normalizedText(item.supplier) === normalizedText(data.supplier);
      if (entity === "sales" || entity === "production") return normalizedText(item.number) === normalizedText(data.number);
      if (entity === "environment") return normalizedText(item.period) === normalizedText(data.period);
      return false;
    });
  }
  function importRoleMatches(item, role) {
    return !role || normalizedText(item.role).indexOf(normalizedText(role)) >= 0 || (role === "Cliente" && normalizedText(item.role).indexOf("cliente") >= 0) || (role === "Proveedor" && normalizedText(item.role).indexOf("proveedor") >= 0);
  }
  function lookupParty(reference, role, candidates) {
    var key = normalizedText(reference);
    if (!key) return null;
    var existing = state.contacts.find(function (item) { return importRoleMatches(item, role) && (normalizedText(item.idNumber) === key || normalizedText(item.name) === key); });
    if (existing) return existing;
    var incoming = candidates.find(function (item) { return item.entity === "contacts" && !item.invalid && importRoleMatches(item.data, role) && (normalizedText(item.data.idNumber) === key || normalizedText(item.data.name) === key); });
    return incoming ? incoming.data : null;
  }
  function lookupProduct(reference, candidates) {
    var key = normalizedText(reference);
    if (!key) return null;
    var existing = state.inventory.find(function (item) { return normalizedText(item.sku) === key || normalizedText(item.name) === key; });
    if (existing) return existing;
    var incoming = candidates.find(function (item) { return item.entity === "products" && !item.invalid && (normalizedText(item.data.sku) === key || normalizedText(item.data.name) === key); });
    return incoming ? incoming.data : null;
  }
  function lookupDocument(entity, reference, candidates) {
    var key = normalizedText(reference);
    if (!key) return null;
    var collection = entity === "sales" ? state.sales : entity === "purchases" ? state.purchases : state.production;
    var existing = collection.find(function (item) { return normalizedText(item.number) === key; });
    if (existing) return existing;
    var incoming = candidates.find(function (item) { return item.entity === entity && !item.invalid && normalizedText(item.data.number) === key; });
    return incoming ? incoming.data : null;
  }
  function normalizedEnum(value, allowed) {
    var key = normalizedText(value);
    var match = allowed.find(function (item) { return normalizedText(item) === key; });
    return match || value;
  }
  function sameImportRecord(entity, left, right) {
    if (entity === "contacts") return (!!left.idNumber && !!right.idNumber && normalizedText(left.idNumber) === normalizedText(right.idNumber)) || ((!left.idNumber || !right.idNumber) && normalizedText(left.name) === normalizedText(right.name) && normalizedText(left.role) === normalizedText(right.role));
    if (entity === "products") return (!!left.sku && !!right.sku && normalizedText(left.sku) === normalizedText(right.sku)) || ((!left.sku || !right.sku) && normalizedText(left.name) === normalizedText(right.name) && normalizedText(left.type) === normalizedText(right.type));
    if (entity === "purchases") return normalizedText(left.number) === normalizedText(right.number) && normalizedText(left.supplier) === normalizedText(right.supplier);
    if (entity === "sales" || entity === "production") return normalizedText(left.number) === normalizedText(right.number);
    if (entity === "environment") return normalizedText(left.period) === normalizedText(right.period);
    if (entity === "company") return (!!left.companyNit && !!right.companyNit && normalizedText(left.companyNit) === normalizedText(right.companyNit)) || ((!left.companyNit || !right.companyNit) && normalizedText(left.company) === normalizedText(right.company));
    return false;
  }
  function collectUnknownFields(header, row, mapping) {
    var mapped = {};
    Object.keys(mapping).forEach(function (key) { mapped[mapping[key]] = true; });
    var fields = {};
    header.forEach(function (cell, index) {
      var name = String(cell == null ? "" : cell).trim();
      var value = row[index];
      if (!mapped[index] && name && value != null && String(value).trim() !== "") fields[name] = value;
    });
    return fields;
  }
  function buildImportAnalysis() {
    var candidates = [], details = [], extras = [], issues = [], duplicates = [];
    if (!importSession) return { valid: [], duplicates: [], issues: [], details: [], extras: [] };
    importSession.sheets.forEach(function (sheet, sheetIndex) {
      var entity = sheet.config.entity;
      if (!entity || entity === "ignore") return;
      var header = sheet.rows[sheet.config.headerRow] || [];
      for (var rowIndex = sheet.config.headerRow + 1; rowIndex < sheet.rows.length; rowIndex += 1) {
        var sourceRow = sheet.rows[rowIndex] || [];
        if (!sourceRow.some(function (cell) { return String(cell == null ? "" : cell).trim() !== ""; })) continue;
        var parsed = parsedImportRow(sheet, rowIndex);
        var candidate = { entity: entity, data: parsed.data, sourceSheet: sheet.name, sourceRow: rowIndex + 1, sheetIndex: sheetIndex, raw: sourceRow, header: header };
        if (entity === "extras") {
          var extra = { entity: String(parsed.data.entity || "").trim(), recordKey: String(parsed.data.recordKey || "").trim(), field: String(parsed.data.field || "").trim(), value: parsed.data.value };
          if (!extra.entity || !extra.recordKey || !extra.field) issues.push({ sheet: sheet.name, row: rowIndex + 1, label: "Dato adicional", reason: "Completa entidad, clave del registro y campo original." });
          else extras.push(extra);
          continue;
        }
        if (["recipes", "saleLines", "purchaseLines", "salePayments", "productionInputs"].indexOf(entity) >= 0) { details.push(candidate); continue; }
        if (entity === "company" && !candidate.data.company && !candidate.data.companyNit && !candidate.data.city && !candidate.data.activityType) continue;
        candidate.unknown = collectUnknownFields(header, sourceRow, sheet.config.mapping);
        candidates.push(candidate);
      }
    });

    var candidatePriority = { company: 0, contacts: 1, products: 2, sales: 3, purchases: 4, production: 5, environment: 6 };
    candidates.sort(function (a, b) { return (candidatePriority[a.entity] == null ? 99 : candidatePriority[a.entity]) - (candidatePriority[b.entity] == null ? 99 : candidatePriority[b.entity]); });
    var seen = {}, seenRecords = [];
    candidates.forEach(function (candidate) {
      var data = candidate.data, entity = candidate.entity, errors = [];
      importFields(entity).forEach(function (field) {
        var value = data[field.key];
        if (field.required && (value === "" || value == null)) errors.push("Falta " + field.label.toLocaleLowerCase("es-CO") + ".");
      });
      ["stock", "min", "cost", "price", "discount", "taxRate", "unitPrice", "total", "quantity", "amount", "wasteKg", "electricityKwh", "waterM3", "fuelL", "organicKg", "recyclableKg", "nonRecyclableKg", "hazardousKg", "recycledKg", "productionUnits"].forEach(function (key) {
        if (data[key] !== "" && data[key] != null && (!Number.isFinite(Number(data[key])) || Number(data[key]) < 0)) errors.push(key === "total" ? "El total no puede ser negativo." : "El valor de " + key + " debe ser un número igual o mayor que cero.");
      });
      if (data.taxRate !== "" && Number(data.taxRate) > 100) errors.push("La tarifa de IVA debe estar entre 0 y 100.");
      ["stock", "min", "cost", "price", "discount", "taxRate", "unitPrice", "total", "quantity", "amount", "wasteKg", "electricityKwh", "waterM3", "fuelL", "organicKg", "recyclableKg", "nonRecyclableKg", "hazardousKg", "recycledKg", "productionUnits"].forEach(function (key) {
        if (data[key] === "" && importFields(entity).some(function (field) { return field.key === key && field.required; })) errors.push("El valor de " + key + " debe ser un número.");
      });
      if (["date", "paidDate", "completedDate", "externalInvoiceDate"].some(function (key) { return data[key] && !validImportDate(data[key]); })) errors.push("La fecha debe tener un formato válido.");
      if (entity === "environment" && data.period && (!/^\d{4}-\d{2}$/.test(data.period) || Number(data.period.slice(5, 7)) < 1 || Number(data.period.slice(5, 7)) > 12)) errors.push("El período debe tener el formato AAAA-MM y un mes entre 01 y 12.");
      if (entity === "contacts" && data.role) {
        if (normalizedText(data.role) === "cliente ordinario") {
          data.role = "Cliente";
          data.ordinaryCustomer = true;
        } else data.role = normalizedEnum(data.role, ["Cliente", "Proveedor", "Cliente · Proveedor"]);
        if (["cliente", "proveedor", "cliente proveedor"].indexOf(normalizedText(data.role)) < 0) errors.push("El tipo debe ser Cliente, Proveedor o Cliente · Proveedor.");
        if (data.ordinaryCustomer !== "" && data.ordinaryCustomer != null) {
          var ordinaryValue = normalizedText(data.ordinaryCustomer);
          if (["true", "1", "si", "x", "ordinario", "cliente ordinario"].indexOf(ordinaryValue) >= 0) data.ordinaryCustomer = true;
          else if (["false", "0", "no", "falso"].indexOf(ordinaryValue) >= 0) data.ordinaryCustomer = false;
          else errors.push("Cliente ordinario debe indicar Sí o No.");
        }
        if (data.ordinaryCustomer === true && normalizedText(data.role).indexOf("cliente") < 0) errors.push("La marca Cliente ordinario solo aplica a contactos con tipo Cliente.");
      }
      if (entity === "products" && data.type) {
        data.type = normalizedEnum(data.type, ["Producto terminado", "Materia prima", "Insumo"]);
        if (["producto terminado", "materia prima", "insumo"].indexOf(normalizedText(data.type)) < 0) errors.push("El tipo de producto no coincide con las opciones de Pyme360.");
      }
      if (entity === "sales") {
        var customer = lookupParty(data.customer, "Cliente", candidates);
        if (data.customer && !customer) errors.push("No se encontró el cliente. Regístralo en Contactos o corrige la referencia.");
        else if (customer) data.customer = customer.name;
        if (data.status) {
          data.status = normalizedEnum(data.status, ["Pagada", "Pendiente de pago", "Pago parcial"]);
          if (["pagada", "pendiente de pago", "pago parcial"].indexOf(normalizedText(data.status)) < 0) errors.push("El estado de venta debe ser Pagada, Pago parcial o Pendiente de pago.");
        }
        if (!data.status) data.status = data.payment === "Contado" ? "Pagada" : "Pendiente de pago";
        if (!data.payment) data.payment = data.status === "Pagada" ? "Contado" : "Crédito";
        if (data.invoiceFollowUpStatus) {
          data.invoiceFollowUpStatus = normalizedEnum(data.invoiceFollowUpStatus, ["Por revisar", "Registrada por fuera de Pyme360", "No aplica, según revisión del usuario"]);
          if (["por revisar", "registrada por fuera de pyme360", "no aplica segun revision del usuario"].indexOf(normalizedText(data.invoiceFollowUpStatus)) < 0) errors.push("El seguimiento debe ser Por revisar, Registrada por fuera de Pyme360 o No aplica según revisión del usuario.");
        }
      } else if (entity === "purchases") {
        var supplier = lookupParty(data.supplier, "Proveedor", candidates);
        if (data.supplier && !supplier) errors.push("No se encontró el proveedor. Regístralo en Contactos o corrige la referencia.");
        else if (supplier) data.supplier = supplier.name;
        if (data.productSku && !lookupProduct(data.productSku, candidates)) errors.push("No se encontró el producto de la compra. Revisa el SKU.");
        if (data.status) {
          data.status = normalizedEnum(data.status, ["Recibida", "Por recibir", "Pagada"]);
          if (["recibida", "por recibir", "pagada"].indexOf(normalizedText(data.status)) < 0) errors.push("El estado de compra debe ser Recibida, Por recibir o Pagada.");
        }
        if (!data.status) data.status = "Por recibir";
      } else if (entity === "production") {
        var product = lookupProduct(data.productSku || data.product, candidates);
        if ((data.productSku || data.product) && !product) errors.push("No se encontró el producto de la orden. Revisa su SKU o nombre.");
        else if (product) { data.product = product.name; data.productSku = product.sku; }
        if (!data.product && !data.productSku) errors.push("La orden necesita un producto o un SKU.");
        if (data.status) {
          data.status = normalizedEnum(data.status, ["En proceso", "Terminada"]);
          if (["en proceso", "terminada"].indexOf(normalizedText(data.status)) < 0) errors.push("El estado de producción debe ser En proceso o Terminada.");
        }
        if (!data.status) data.status = "En proceso";
      }
      if (errors.length) {
        errors.forEach(function (reason) { issues.push({ sheet: candidate.sourceSheet, row: candidate.sourceRow, label: importEntityLabel(entity), reason: reason }); });
        candidate.invalid = true;
        return;
      }
      var duplicate = findImportDuplicate(entity, data);
      var key = entity + "|" + importRecordKey(entity, data);
      candidate.label = importEntityLabel(entity);
      candidate.keyLabel = importRecordKey(entity, data);
      if (duplicate) { candidate.duplicate = duplicate; candidate.existing = duplicate; }
      else {
        var prior = seenRecords.find(function (item) { return item.entity === entity && sameImportRecord(entity, item.data, data); });
        if (prior) { candidate.duplicate = prior; candidate.existing = prior.data; }
      }
      if (!candidate.duplicate && entity === "company") {
        var priorCompany = seenRecords.find(function (item) { return item.entity === "company"; });
        if (priorCompany) { candidate.duplicate = priorCompany; candidate.existing = priorCompany.data; }
      }
      if (candidate.duplicate) { /* La fila se mostrará como duplicada para revisión. */ }
      else if (entity === "company" && (state.company || state.companyNit)) { candidate.duplicate = state; candidate.existing = state; }
      if (candidate.duplicate) duplicates.push(candidate);
      else { seen[key] = candidate; seenRecords.push(candidate); }
      candidate.unknownExtras = Object.keys(candidate.unknown).map(function (field) { return { entity: entity, recordKey: importRecordKey(entity, data), field: field, value: candidate.unknown[field] }; });
    });

    details.forEach(function (detail) {
      var data = detail.data, errors = [];
      if (detail.entity === "recipes") {
        if (!lookupProduct(data.productSku, candidates)) errors.push("No se encontró el producto de la receta.");
        if (!lookupProduct(data.materialSku, candidates)) errors.push("No se encontró la materia prima de la receta.");
        if (data.amount === "" || Number(data.amount) <= 0) errors.push("La cantidad de la receta debe ser mayor que cero.");
      } else if (detail.entity === "saleLines") {
        if (!lookupDocument("sales", data.saleNumber, candidates)) errors.push("No se encontró la venta relacionada.");
        var saleItem = lookupProduct(data.sku, candidates);
        if (!saleItem) errors.push("No se encontró el producto de la venta.");
        else if (saleItem.type !== "Producto terminado") errors.push("Las ventas solo pueden incluir productos terminados.");
        if (data.quantity === "" || Number(data.quantity) <= 0) errors.push("La cantidad debe ser mayor que cero.");
        if (data.unitPrice !== "" && Number(data.unitPrice) < 0) errors.push("El precio unitario no puede ser negativo.");
        if (data.taxRate !== "" && (Number(data.taxRate) < 0 || Number(data.taxRate) > 100)) errors.push("El IVA debe estar entre 0 y 100%.");
      } else if (detail.entity === "purchaseLines") {
        if (!lookupDocument("purchases", data.purchaseNumber, candidates)) errors.push("No se encontró la compra relacionada.");
        var purchaseItem = lookupProduct(data.sku, candidates);
        if (!purchaseItem) errors.push("No se encontró el material comprado.");
        else if (purchaseItem.type !== "Materia prima" && purchaseItem.type !== "Insumo") errors.push("Las compras solo pueden incluir materias primas o insumos.");
        if (data.quantity === "" || Number(data.quantity) <= 0 || data.total === "" || Number(data.total) < 0) errors.push("La cantidad debe ser mayor que cero y el costo total no puede ser negativo.");
      } else if (detail.entity === "salePayments") {
        if (!lookupDocument("sales", data.saleNumber, candidates)) errors.push("No se encontró la venta relacionada.");
        if (!validImportDate(data.date)) errors.push("La fecha del pago debe tener un formato válido.");
        if (data.amount === "" || Number(data.amount) <= 0) errors.push("El valor recibido debe ser mayor que cero.");
      } else {
        if (!lookupDocument("production", data.productionNumber, candidates)) errors.push("No se encontró la orden de producción relacionada.");
        if (!lookupProduct(data.sku, candidates)) errors.push("No se encontró el material consumido.");
        if (data.quantity === "" || Number(data.quantity) < 0) errors.push("La cantidad consumida debe ser un número válido.");
      }
      detail.valid = errors.length === 0;
      detail.label = importEntityLabel(detail.entity);
      detail.unknown = collectUnknownFields(detail.header, detail.raw, importSession.sheets[detail.sheetIndex].config.mapping);
      if (errors.length) errors.forEach(function (reason) { issues.push({ sheet: detail.sourceSheet, row: detail.sourceRow, label: importEntityLabel(detail.entity), reason: reason }); });
      if (detail.valid) {
        var detailKey = importRecordKey(detail.entity, data);
        var parentEntity = detail.entity === "recipes" ? "products" : detail.entity === "saleLines" || detail.entity === "salePayments" ? "sales" : detail.entity === "purchaseLines" ? "purchases" : "production";
        var parentRef = detail.entity === "recipes" ? data.productSku : detail.entity === "saleLines" || detail.entity === "salePayments" ? data.saleNumber : detail.entity === "purchaseLines" ? data.purchaseNumber : data.productionNumber;
        var parent = detail.entity === "recipes" ? lookupProduct(parentRef, candidates) : lookupDocument(parentEntity, parentRef, candidates);
        var childRef = detail.entity === "recipes" ? data.materialSku : data.sku;
        if (detail.entity === "recipes") detail.duplicate = !!(parent && parent.inputs && parent.inputs.some(function (line) { return normalizedText(line.sku) === normalizedText(childRef); }));
        else if (detail.entity === "saleLines") detail.duplicate = !!(parent && parent.lines && parent.lines.some(function (line) { return normalizedText(line.sku) === normalizedText(childRef); }));
        else if (detail.entity === "purchaseLines") detail.duplicate = !!(parent && purchaseLines(parent).some(function (line) { return normalizedText(line.sku) === normalizedText(childRef); }));
        else if (detail.entity === "salePayments") detail.duplicate = !!(parent && (parent.payments || []).some(function (payment) { return (data.paymentId && normalizedText(payment.id) === normalizedText(data.paymentId)) || (normalizedText(payment.date) === normalizedText(data.date) && Number(payment.amount) === Number(data.amount) && normalizedText(payment.method) === normalizedText(data.method)); }));
        else detail.duplicate = !!(parent && parent.inputConsumption && parent.inputConsumption.some(function (line) { return normalizedText(line.sku) === normalizedText(childRef); }));
        var seenDetailKey = "detail|" + detail.entity + "|" + detailKey;
        if (seen[seenDetailKey]) detail.duplicate = true;
        seen[seenDetailKey] = true;
        detail.keyLabel = detailKey;
        if (detail.duplicate) duplicates.push(detail);
        detail.unknownExtras = Object.keys(detail.unknown).map(function (field) { return { entity: detail.entity, recordKey: detailKey, field: field, value: detail.unknown[field] }; });
      }
    });
    return { valid: candidates.filter(function (candidate) { return !candidate.invalid && !candidate.duplicate; }), candidates: candidates, duplicates: duplicates, issues: issues, details: details, extras: extras };
  }

  /* Importación Excel: aplicación transaccional */
  function importTarget(collection, entity, data) {
    return collection.find(function (item) {
      if (entity === "contacts") return (!!data.idNumber && !!item.idNumber && normalizedText(item.idNumber) === normalizedText(data.idNumber)) || ((!data.idNumber || !item.idNumber) && normalizedText(item.name) === normalizedText(data.name) && normalizedText(item.role) === normalizedText(data.role));
      if (entity === "products") return (!!data.sku && !!item.sku && normalizedText(item.sku) === normalizedText(data.sku)) || ((!data.sku || !item.sku) && normalizedText(item.name) === normalizedText(data.name) && normalizedText(item.type) === normalizedText(data.type));
      if (entity === "environment") return normalizedText(item.period) === normalizedText(data.period);
      if (entity === "purchases") return normalizedText(item.number) === normalizedText(data.number) && normalizedText(item.supplier) === normalizedText(data.supplier);
      return normalizedText(item.number) === normalizedText(data.number);
    });
  }
  function importStateKey(entity, item) {
    if (entity === "company") return importRecordKey(entity, { companyNit: item.companyNit, company: item.company });
    if (entity === "contacts") return importRecordKey(entity, item);
    if (entity === "products") return importRecordKey(entity, item);
    if (entity === "sales" || entity === "production") return normalizedText(item.number);
    if (entity === "purchases") return normalizedText(item.number + "|" + item.supplier);
    if (entity === "environment") return normalizedText(item.period);
    return "";
  }
  function addImportExtras(target, items, entity, recordKey) {
    (items || []).forEach(function (item) {
      var value = { entity: entity, recordKey: recordKey, field: item.field, value: item.value };
      var existing = target.importExtras.find(function (entry) { return entry.entity === value.entity && entry.recordKey === value.recordKey && entry.field === value.field; });
      if (existing) existing.value = value.value;
      else target.importExtras.push(value);
    });
  }
  function applyImportCandidate(next, candidate, updateDuplicates, stats) {
    var entity = candidate.entity, data = candidate.data, collection, target, prefix;
    if (entity === "company") {
      target = next;
      var companyFields = ["company", "companyNit", "city", "activityType"];
      var wasConfigured = !!(next.company || next.companyNit);
      companyFields.forEach(function (key) { if (data[key] !== "" && data[key] != null) target[key] = data[key]; });
      if (wasConfigured) stats.updated += 1; else stats.added += 1;
      addImportExtras(next, candidate.unknownExtras, entity, importStateKey(entity, target));
      return;
    }
    collection = entity === "contacts" ? next.contacts : entity === "products" ? next.inventory : entity === "sales" ? next.sales : entity === "purchases" ? next.purchases : entity === "production" ? next.production : next.environment;
    target = importTarget(collection, entity, data);
    var isUpdate = !!target;
    if (!target) {
      var importedId = data.id && !["contacts", "inventory", "sales", "purchases", "production"].some(function (name) { return (next[name] || []).some(function (item) { return item.id === data.id; }); }) ? data.id : "imp-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
      target = Object.assign({}, data, { id: importedId });
      if (entity === "contacts") {
        target.email = target.email || ""; target.phone = target.phone || ""; target.idNumber = target.idNumber || ""; target.ordinaryCustomer = target.ordinaryCustomer === true;
      } else if (entity === "products") {
        ["stock", "min", "cost", "price", "taxRate"].forEach(function (key) { if (target[key] === "") target[key] = 0; });
        target.inputs = [];
      } else if (entity === "sales") {
        target.total = Number(target.total) || 0; target.lines = []; target.payments = []; target.demo = true; target.inventoryApplied = false;
        if (!target.invoiceFollowUpStatus) target.invoiceFollowUpStatus = "Por revisar";
      } else if (entity === "purchases") {
        target.total = Number(target.total) || 0; target.detail = target.detail || ""; target.lines = []; target.inventoryApplied = false;
      } else if (entity === "production") {
        target.quantity = Number(target.quantity) || 0; target.wasteKg = Number(target.wasteKg) || 0; target.inputConsumption = []; target.inventoryApplied = false;
        var linkedProduct = next.inventory.find(function (product) { return normalizedText(product.sku) === normalizedText(data.productSku) || normalizedText(product.name) === normalizedText(data.product); });
        if (linkedProduct) target.productId = linkedProduct.id;
      } else if (entity === "environment") {
        ["electricityKwh", "waterM3", "fuelL", "organicKg", "recyclableKg", "nonRecyclableKg", "hazardousKg", "recycledKg", "productionUnits"].forEach(function (key) { if (target[key] === "") target[key] = 0; });
      }
      collection.unshift(target);
      stats.added += 1;
    } else {
      if (updateDuplicates) {
        Object.keys(data).forEach(function (key) {
          if (key === "id" || key === "lines" || key === "inputs" || key === "inputConsumption") return;
          if (data[key] !== "" && data[key] != null) target[key] = data[key];
        });
        if (entity === "sales") {
          if (!Array.isArray(target.payments)) target.payments = [];
          refreshSaleStatus(target);
        } else if (entity === "production") {
          var productRef = next.inventory.find(function (product) { return normalizedText(product.sku) === normalizedText(data.productSku) || normalizedText(product.name) === normalizedText(data.product); });
          if (productRef) target.productId = productRef.id;
        }
        stats.updated += 1;
      } else stats.skipped += 1;
    }
    addImportExtras(next, candidate.unknownExtras, entity, importStateKey(entity, target));
  }
  function commitExcelImport() {
    if (!importSession) return;
    var analysis = buildImportAnalysis();
    var updateDuplicates = !!importSession.updateDuplicates;
    var accepted = analysis.valid.concat(updateDuplicates ? analysis.duplicates.filter(function (item) { return ["recipes", "saleLines", "purchaseLines", "salePayments", "productionInputs"].indexOf(item.entity) < 0; }) : []);
    var stats = { added: 0, updated: 0, skipped: updateDuplicates ? 0 : analysis.duplicates.filter(function (item) { return ["recipes", "saleLines", "purchaseLines", "salePayments", "productionInputs"].indexOf(item.entity) < 0; }).length };
    try {
      var next = JSON.parse(JSON.stringify(state));
      var priority = { company: 0, contacts: 1, products: 2, sales: 3, purchases: 4, production: 5, environment: 6 };
      accepted.sort(function (a, b) { return (priority[a.entity] == null ? 99 : priority[a.entity]) - (priority[b.entity] == null ? 99 : priority[b.entity]); }).forEach(function (candidate) {
        applyImportCandidate(next, candidate, updateDuplicates, stats);
      });

      function parentWasAccepted(detail, parentEntity, reference) {
        var parents = analysis.candidates;
        var matches = parents.filter(function (candidate) {
          if (candidate.entity !== parentEntity) return false;
          return parentEntity === "products" ? normalizedText(candidate.data.sku) === normalizedText(reference) || normalizedText(candidate.data.name) === normalizedText(reference) : normalizedText(candidate.data.number) === normalizedText(reference);
        });
        if (matches.length) {
          if (matches.some(function (parent) { return accepted.indexOf(parent) >= 0; })) return true;
          var existingParent = parentEntity === "products" ? state.inventory.some(function (item) { return normalizedText(item.sku) === normalizedText(reference) || normalizedText(item.name) === normalizedText(reference); }) : (parentEntity === "sales" ? state.sales : parentEntity === "purchases" ? state.purchases : state.production).some(function (item) { return normalizedText(item.number) === normalizedText(reference); });
          return existingParent;
        }
        return true;
      }
      analysis.details.forEach(function (detail) {
        if (!detail.valid || (detail.duplicate && !updateDuplicates)) { stats.skipped += 1; return; }
        var data = detail.data;
        if (detail.entity === "recipes") {
          if (!parentWasAccepted(detail, "products", data.productSku)) { stats.skipped += 1; return; }
          var product = next.inventory.find(function (item) { return normalizedText(item.sku) === normalizedText(data.productSku) || normalizedText(item.name) === normalizedText(data.productSku); });
          var material = next.inventory.find(function (item) { return normalizedText(item.sku) === normalizedText(data.materialSku) || normalizedText(item.name) === normalizedText(data.materialSku); });
          if (!product || !material) { stats.skipped += 1; return; }
          product.inputs = product.inputs || [];
          var recipeLine = product.inputs.find(function (line) { return normalizedText(line.sku) === normalizedText(material.sku); });
          if (recipeLine) { if (updateDuplicates) { recipeLine.amount = Number(data.amount); stats.updated += 1; } else stats.skipped += 1; }
          else { product.inputs.push({ sku: material.sku, amount: Number(data.amount) }); stats.added += 1; }
        } else if (detail.entity === "saleLines") {
          if (!parentWasAccepted(detail, "sales", data.saleNumber)) { stats.skipped += 1; return; }
          var sale = next.sales.find(function (item) { return normalizedText(item.number) === normalizedText(data.saleNumber); });
          var saleProduct = next.inventory.find(function (item) { return normalizedText(item.sku) === normalizedText(data.sku) || normalizedText(item.name) === normalizedText(data.sku); });
          if (!sale || !saleProduct) { stats.skipped += 1; return; }
          sale.lines = sale.lines || [];
          var saleLine = sale.lines.find(function (line) { return normalizedText(line.sku) === normalizedText(saleProduct.sku); });
          if (saleLine) { if (updateDuplicates) { saleLine.quantity = Number(data.quantity); if (data.unitPrice !== "") saleLine.unitPrice = Number(data.unitPrice); if (data.taxRate !== "") saleLine.taxRate = Number(data.taxRate); stats.updated += 1; } else stats.skipped += 1; }
          else { sale.lines.push({ sku: saleProduct.sku, quantity: Number(data.quantity), unitPrice: data.unitPrice === "" ? Number(saleProduct.price) || 0 : Number(data.unitPrice), taxRate: data.taxRate === "" ? (saleProduct.taxType === "Gravado" ? Number(saleProduct.taxRate) || 0 : 0) : Number(data.taxRate) }); stats.added += 1; }
        } else if (detail.entity === "purchaseLines") {
          if (!parentWasAccepted(detail, "purchases", data.purchaseNumber)) { stats.skipped += 1; return; }
          var purchase = next.purchases.find(function (item) { return normalizedText(item.number) === normalizedText(data.purchaseNumber); });
          var purchaseProduct = next.inventory.find(function (item) { return normalizedText(item.sku) === normalizedText(data.sku) || normalizedText(item.name) === normalizedText(data.sku); });
          if (!purchase || !purchaseProduct) { stats.skipped += 1; return; }
          if (!Array.isArray(purchase.lines)) purchase.lines = [];
          var purchaseLine = purchase.lines.find(function (line) { return normalizedText(line.sku) === normalizedText(purchaseProduct.sku); });
          if (purchaseLine) { if (updateDuplicates) { purchaseLine.quantity = Number(data.quantity); purchaseLine.total = Number(data.total); stats.updated += 1; } else stats.skipped += 1; }
          else { purchase.lines.push({ sku: purchaseProduct.sku, quantity: Number(data.quantity), total: Number(data.total) }); stats.added += 1; }
        } else if (detail.entity === "salePayments") {
          if (!parentWasAccepted(detail, "sales", data.saleNumber)) { stats.skipped += 1; return; }
          var paidSale = next.sales.find(function (item) { return normalizedText(item.number) === normalizedText(data.saleNumber); });
          if (!paidSale) { stats.skipped += 1; return; }
          if (!Array.isArray(paidSale.payments)) paidSale.payments = [];
          var paymentMatch = paidSale.payments.find(function (payment) { return (data.paymentId && normalizedText(payment.id) === normalizedText(data.paymentId)) || (normalizedText(payment.date) === normalizedText(data.date) && Number(payment.amount) === Number(data.amount) && normalizedText(payment.method) === normalizedText(data.method)); });
          if (paymentMatch) { if (updateDuplicates) { paymentMatch.date = data.date; paymentMatch.amount = Number(data.amount); paymentMatch.method = data.method || "Otro"; stats.updated += 1; } else stats.skipped += 1; }
          else {
            var paidAlready = paidSale.payments.reduce(function (sum, payment) { return sum + (Number(payment.amount) || 0); }, 0);
            if (paidAlready + Number(data.amount) > Number(paidSale.total)) { stats.skipped += 1; return; }
            paidSale.payments.push({ id: data.paymentId || "imp-pay-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6), date: data.date, amount: Number(data.amount), method: data.method || "Otro" });
            stats.added += 1;
          }
          refreshSaleStatus(paidSale);
        } else {
          if (!parentWasAccepted(detail, "production", data.productionNumber)) { stats.skipped += 1; return; }
          var order = next.production.find(function (item) { return normalizedText(item.number) === normalizedText(data.productionNumber); });
          var inputProduct = next.inventory.find(function (item) { return normalizedText(item.sku) === normalizedText(data.sku) || normalizedText(item.name) === normalizedText(data.sku); });
          if (!order || !inputProduct) { stats.skipped += 1; return; }
          order.inputConsumption = order.inputConsumption || [];
          var consumption = order.inputConsumption.find(function (line) { return normalizedText(line.sku) === normalizedText(inputProduct.sku); });
          if (consumption) { if (updateDuplicates) { consumption.quantity = Number(data.quantity); stats.updated += 1; } else stats.skipped += 1; }
          else { order.inputConsumption.push({ sku: inputProduct.sku, quantity: Number(data.quantity) }); stats.added += 1; }
        }
        addImportExtras(next, detail.unknownExtras, detail.entity, importRecordKey(detail.entity, data));
      });
      analysis.extras.forEach(function (extra) { addImportExtras(next, [extra], String(extra.entity), String(extra.recordKey)); });

      state = next;
      saveState();
      importSession = null;
    } catch (error) {
      toast("No se aplicó ningún cambio", error.message || "No se pudo preparar la importación.");
      return;
    }
    render();
    toast("Importación terminada", stats.added + " registros agregados, " + stats.updated + " actualizados, " + stats.skipped + " omitidos y " + analysis.issues.length + " por revisar.");
  }

  /* Cálculos y construcción de formularios */
  function estimateEmissions(record) {
    // Factor ilustrativo para demostración; reemplazar por factores UPME versionados antes del uso productivo.
    return (Number(record.electricityKwh) || 0) * 0.1 + (Number(record.fuelL) || 0) * 2.5;
  }

  function wasteTotal(record) {
    return (Number(record.organicKg) || 0) + (Number(record.recyclableKg) || 0) + (Number(record.nonRecyclableKg) || 0) + (Number(record.hazardousKg) || 0);
  }

  function openModal(title, description, content) {
    var root = document.getElementById("modal-root");
    root.innerHTML = '<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div class="modal-header"><div><h2>' + esc(title) + '</h2><p>' + esc(description) + '</p></div><button class="modal-close" type="button" data-action="close-modal" aria-label="Cerrar">×</button></div>' + content + '</section></div>';
    root.querySelector(".modal-backdrop").addEventListener("click", function (event) {
      if (event.target.classList.contains("modal-backdrop")) closeModal();
    });
    var first = root.querySelector("input, select, button");
    if (first) first.focus();
  }

  function closeModal() {
    if (persistencePending) { deferredClose = true; return; }
    closeModalNow();
  }

  function closeModalNow() {
    if (activeReceiptRead) {
      activeReceiptRead.cancelled = true;
      var workerToStop = activeReceiptRead.worker;
      var pdfToStop = activeReceiptRead.pdf;
      activeReceiptRead.worker = null;
      activeReceiptRead.pdf = null;
      if (workerToStop) workerToStop.terminate().catch(function () {});
      if (pdfToStop) pdfToStop.destroy().catch(function () {});
      activeReceiptRead = null;
    }
    document.getElementById("modal-root").innerHTML = "";
  }

  function formField(label, name, control, full) {
    return '<div class="field' + (full ? " full" : "") + '"><label for="' + name + '">' + label + '</label>' + control + '</div>';
  }

  function modalForm(id, fields, note, submitText) {
    return '<form class="modal-form" id="' + id + '"><div class="form-grid">' + fields + '</div>' + (note ? '<div class="form-note">' + note + '</div>' : "") + '<div class="modal-footer"><button type="button" class="button button-secondary" data-action="close-modal">Cancelar</button><button type="submit" class="button button-primary">' + submitText + '</button></div></form>';
  }

  function productOptions(types, selectedId) {
    return state.inventory.filter(function (item) { return !types || types.indexOf(item.type) >= 0; }).map(function (item) {
      return '<option value="' + esc(item.id) + '"' + (item.id === selectedId ? " selected" : "") + '>' + esc(item.name) + ' · ' + num(item.stock, 1) + ' ' + esc(item.unit) + '</option>';
    }).join("");
  }

  function recipeLineHtml(existingLine) {
    var materials = state.inventory.filter(function (item) { return item.type === "Materia prima" || item.type === "Insumo"; });
    var options = materials.map(function (item) { return '<option value="' + esc(item.id) + '"' + (existingLine && existingLine.sku === item.sku ? " selected" : "") + '>' + esc(item.name) + ' · ' + num(item.stock, 1) + ' ' + esc(item.unit) + ' disponibles</option>'; }).join("");
    return '<div class="recipe-line"><label class="recipe-material-field"><span>Material</span><select class="recipe-material-select" name="recipeMaterial"><option value="">Elige un material</option>' + options + '</select></label><label class="recipe-amount-field"><span>Cantidad por unidad</span><span class="recipe-amount-control"><input name="recipeAmount" type="number" min="0.001" step="any" value="' + (existingLine ? esc(existingLine.amount) : '') + '" placeholder="Ej. 0,5"><small data-unit-label>unidad</small></span></label><button type="button" class="button-quiet button-quiet-danger recipe-remove-button hidden" data-action="recipe-remove-line" aria-label="Quitar material">Quitar</button></div>';
  }

  function updateRecipeUnit(select) {
    var row = select.closest(".recipe-line");
    var material = state.inventory.find(function (item) { return item.id === select.value; });
    var unit = row && row.querySelector("[data-unit-label]");
    if (unit) unit.textContent = material ? material.unit : "unidad";
  }

  function updateRecipeRemoveButtons() {
    var rows = Array.prototype.slice.call(document.querySelectorAll("#recipe-lines .recipe-line"));
    rows.forEach(function (row) { row.querySelector(".recipe-remove-button").classList.toggle("hidden", rows.length < 2); });
  }

  function addRecipeLine() {
    var container = document.getElementById("recipe-lines");
    if (!container) return;
    if (container.querySelectorAll(".recipe-line").length >= 20) return toast("La receta ya tiene muchos materiales", "Puedes agregar hasta 20 materiales por producto.");
    container.insertAdjacentHTML("beforeend", recipeLineHtml());
    updateRecipeRemoveButtons();
  }

  function removeRecipeLine(button) {
    var row = button.closest(".recipe-line");
    if (!row) return;
    row.remove();
    updateRecipeRemoveButtons();
  }

  function contactOptions(role, selectedId) {
    return state.contacts.filter(function (item) { return !role || item.role.indexOf(role) >= 0; }).map(function (item) {
      return '<option value="' + esc(item.id) + '"' + (item.id === selectedId ? " selected" : "") + '>' + esc(item.name) + '</option>';
    }).join("");
  }

  function openSaleModal(saleId) {
    var editingSale = saleId ? state.sales.find(function (item) { return item.id === saleId; }) : null;
    if (saleId && !editingSale) return toast("No encontramos esa venta", "Actualiza la lista e inténtalo de nuevo.");
    var hasCustomer = state.contacts.some(function (item) { return item.role.indexOf("Cliente") >= 0; });
    var hasProduct = state.inventory.some(function (item) { return item.type === "Producto terminado"; });
    if (!hasCustomer || !hasProduct) {
      var nextSteps = '<div class="modal-form"><p>Para registrar una venta primero necesitas tener un cliente y un producto terminado.</p><div class="modal-footer">' +
        (!hasCustomer ? '<button class="button button-secondary" data-page="contacts">Agregar cliente</button>' : '') +
        (!hasProduct ? '<button class="button button-primary" data-action="new-product">Agregar producto</button>' : '') +
        '<button class="button button-quiet" data-action="close-modal">Cerrar</button></div></div>';
      return openModal("Completa estos datos primero", "Tu empresa comienza con sus propios registros.", nextSteps);
    }
    var existingLines = editingSale ? (editingSale.lines || []) : [];
    if (editingSale && existingLines.some(function (line) { return !state.inventory.some(function (item) { return item.sku === line.sku && item.type === "Producto terminado"; }); })) return toast("No se puede editar esta venta", "Uno de los productos originales ya no está registrado como producto terminado.");
    var existingCustomer = editingSale && state.contacts.find(function (item) { return item.id === editingSale.customerId; });
    if (editingSale && !existingCustomer) existingCustomer = state.contacts.find(function (item) { return item.name === editingSale.customer && item.role.indexOf("Cliente") >= 0; });
    var salePayment = editingSale && editingSale.payment || "Contado";
    var paymentChoices = ["Contado", "15 días", "30 días", "Otro acuerdo"];
    if (paymentChoices.indexOf(salePayment) < 0) paymentChoices.push(salePayment);
    var paymentOptions = paymentChoices.map(function (choice) { return '<option' + (choice === salePayment ? " selected" : "") + '>' + esc(choice) + '</option>'; }).join("");
    var followUpStatus = editingSale && editingSale.invoiceFollowUpStatus || "Por revisar";
    var followUpOptions = ["Por revisar", "Registrada por fuera de Pyme360", "No aplica, según revisión del usuario"].map(function (choice) {
      return '<option value="' + esc(choice) + '"' + (choice === followUpStatus ? " selected" : "") + '>' + esc(choice) + '</option>';
    }).join("");
    var fields = (editingSale ? '<input type="hidden" name="saleId" value="' + esc(editingSale.id) + '">' : "") +
      formField("Cliente", "sale-customer", '<select name="customer" id="sale-customer" required><option value="">Selecciona un cliente</option>' + contactOptions("Cliente", existingCustomer && existingCustomer.id) + '</select>') +
      formField("Fecha", "sale-date", '<input name="date" id="sale-date" type="date" value="' + esc(editingSale && editingSale.date ? editingSale.date : today()) + '" required>') +
      '<div class="field full"><label>Productos de esta venta</label><div class="document-lines" id="sale-lines">' + (existingLines.length ? existingLines.map(function (line) { return saleLineHtml(line); }).join("") : saleLineHtml()) + '</div><button type="button" class="button button-quiet document-add-line" data-action="sale-add-line">＋ Agregar otro producto</button><small class="field-hint">Puedes incluir varios productos en una sola venta.</small></div>' +
      formField("Forma de pago", "sale-payment", '<select name="payment" id="sale-payment">' + paymentOptions + '</select>') +
      formField("Descuento (COP)", "sale-discount", '<input name="discount" id="sale-discount" type="number" min="0" step="1000" value="' + (editingSale ? Number(editingSale.discount) || 0 : 0) + '">') +
      formField("Seguimiento de factura", "invoiceFollowUpStatus", '<select name="invoiceFollowUpStatus" id="sale-follow-up-status">' + followUpOptions + '</select><small class="field-hint">Marca el estado según tu revisión o la de tu contador. Pyme360 no consulta ni envía datos a la DIAN.</small>', true) +
      formField("Número del documento externo (opcional)", "externalInvoiceNumber", '<input name="externalInvoiceNumber" id="sale-external-invoice-number" type="text" maxlength="80" value="' + esc(editingSale && editingSale.externalInvoiceNumber || '') + '" placeholder="Ej. documento emitido por fuera">') +
      formField("Fecha del documento (opcional)", "externalInvoiceDate", '<input name="externalInvoiceDate" id="sale-external-invoice-date" type="date" value="' + esc(editingSale && editingSale.externalInvoiceDate || '') + '">') +
      '<div class="field full"><label>Resumen</label><div class="form-note" id="sale-preview" style="margin:0">Agrega productos para ver el total aproximado.</div></div>';
    openModal(editingSale ? "Editar venta " + editingSale.number : "Registrar una venta", editingSale ? "Ajusta los datos y revisa el total antes de guardar." : "Unos pocos datos para dejar tu venta organizada.", modalForm("sale-form", fields, "Modo de demostración: los cambios actualizan el inventario. El seguimiento de factura es manual; no se emite ni se transmite a la DIAN.", editingSale ? "Guardar cambios" : "Guardar venta"));
    var form = document.getElementById("sale-form");
    form.addEventListener("change", function (event) {
      if (event.target.matches("[data-sale-product]")) updateSaleLineDefaults(event.target.closest(".sale-line"));
      updateSalePreview();
    });
    form.addEventListener("input", updateSalePreview);
    updateSalePreview();
    updateSaleLineRemoveButtons();
  }

  function saleLineHtml(existingLine) {
    var selectedProduct = existingLine && state.inventory.find(function (item) { return item.sku === existingLine.sku; });
    var defaultPrice = existingLine && existingLine.unitPrice != null ? Number(existingLine.unitPrice) : (selectedProduct ? Number(selectedProduct.price) || 0 : 0);
    var defaultTaxRate = existingLine && existingLine.taxRate != null ? Number(existingLine.taxRate) : (selectedProduct && selectedProduct.taxType === "Gravado" ? Number(selectedProduct.taxRate) || 0 : 0);
    var options = state.inventory.filter(function (item) { return item.type === "Producto terminado"; }).map(function (item) {
      return '<option value="' + esc(item.id) + '"' + (existingLine && existingLine.sku === item.sku ? " selected" : "") + '>' + esc(item.name) + ' · ' + num(item.stock, 1) + " " + esc(item.unit) + ' disponibles</option>';
    }).join("");
    return '<div class="document-line sale-line"><label><span>Producto</span><select data-sale-product required><option value="">Elige un producto</option>' + options + '</select></label><label><span>Cantidad</span><input data-sale-quantity type="number" min="0.001" step="any" value="' + (existingLine ? esc(existingLine.quantity) : "1") + '" required></label><label><span>Precio por unidad (COP)</span><input data-sale-unit-price type="number" min="0" step="100" value="' + esc(defaultPrice) + '" required></label><input type="hidden" data-sale-tax-rate value="' + esc(defaultTaxRate) + '"><button type="button" class="button-quiet button-quiet-danger document-remove-line" data-action="sale-remove-line" aria-label="Quitar producto">Quitar</button></div>';
  }

  function updateSaleLineDefaults(row) {
    if (!row) return;
    var selector = row.querySelector("[data-sale-product]");
    var product = selector && state.inventory.find(function (item) { return item.id === selector.value; });
    if (!product) return;
    row.querySelector("[data-sale-unit-price]").value = String(Number(product.price) || 0);
    row.querySelector("[data-sale-tax-rate]").value = product.taxType === "Gravado" ? String(Number(product.taxRate) || 0) : "0";
  }

  function updateSaleLineRemoveButtons() {
    var rows = Array.prototype.slice.call(document.querySelectorAll("#sale-lines .sale-line"));
    rows.forEach(function (row) { var button = row.querySelector(".document-remove-line"); if (button) button.classList.toggle("hidden", rows.length < 2); });
  }

  function addSaleLine() {
    var container = document.getElementById("sale-lines");
    if (!container) return;
    if (container.querySelectorAll(".sale-line").length >= 30) return toast("La venta tiene muchos productos", "Puedes agregar hasta 30 productos en una venta.");
    container.insertAdjacentHTML("beforeend", saleLineHtml());
    updateSaleLineRemoveButtons();
    updateSalePreview();
  }

  function removeSaleLine(button) {
    var row = button.closest(".sale-line");
    if (!row || document.querySelectorAll("#sale-lines .sale-line").length < 2) return;
    row.remove();
    updateSaleLineRemoveButtons();
    updateSalePreview();
  }

  function updateSalePreview() {
    var form = document.getElementById("sale-form");
    if (!form) return;
    var subtotal = 0, taxTotal = 0, quantityTotal = 0, labels = [];
    Array.prototype.slice.call(form.querySelectorAll(".sale-line")).forEach(function (row) {
      var product = state.inventory.find(function (item) { return item.id === row.querySelector("[data-sale-product]").value; });
      var quantity = Number(row.querySelector("[data-sale-quantity]").value) || 0;
      if (!product || quantity <= 0) return;
      var unitPriceInput = row.querySelector("[data-sale-unit-price]");
      var taxRateInput = row.querySelector("[data-sale-tax-rate]");
      var unitPrice = unitPriceInput ? Number(unitPriceInput.value) || 0 : Number(product.price) || 0;
      var taxRate = taxRateInput ? Number(taxRateInput.value) || 0 : (product.taxType === "Gravado" ? Number(product.taxRate) || 0 : 0);
      var lineSubtotal = unitPrice * quantity;
      subtotal += lineSubtotal;
      taxTotal += lineSubtotal * taxRate / 100;
      quantityTotal += quantity;
      labels.push(product.name);
    });
    var discount = Number(form.elements.discount.value) || 0;
    var preview = document.getElementById("sale-preview");
    var net = Math.max(0, subtotal - discount);
    var taxAfterDiscount = subtotal ? taxTotal * (net / subtotal) : 0;
    if (preview) preview.innerHTML = labels.length ? esc(labels.join(", ")) + " · " + num(quantityTotal, 2) + " unidades · Subtotal " + money(subtotal) + " · Descuento " + money(discount) + " · IVA estimado " + money(taxAfterDiscount) + " · Total " + money(Math.round(net + taxAfterDiscount)) : "Agrega productos para ver el total aproximado.";
  }

  function openProductionModal(orderId) {
    var editingOrder = orderId ? state.production.find(function (item) { return item.id === orderId; }) : null;
    if (orderId && (!editingOrder || editingOrder.status !== "En proceso")) return toast("Esta orden ya está cerrada", "Solo puedes cambiar órdenes que siguen en proceso.");
    var finishedGoods = state.inventory.filter(function (item) { return item.type === "Producto terminado"; });
    if (!finishedGoods.length || !finishedGoods.some(function (item) { return item.inputs && item.inputs.length; })) {
      return openModal("Prepara tu inventario", "Para iniciar producción necesitas un producto terminado con una receta.", '<div class="modal-form"><p>Agrega primero las materias primas o insumos. Luego crea el producto terminado y arma la receta con cada material y su cantidad por unidad.</p><div class="modal-footer"><button class="button button-secondary" data-page="inventory">Ver inventario</button><button class="button button-primary" data-action="new-product">Agregar producto</button></div></div>');
    }
    var currentProduct = editingOrder && state.inventory.find(function (item) { return item.id === editingOrder.productId; });
    if (editingOrder && !currentProduct) return toast("No se puede editar esta orden", "No encontramos el producto terminado relacionado.");
    if (editingOrder && !(currentProduct.inputs || []).length) return toast("No se puede editar esta orden", "El producto ya no tiene una receta. Revisa sus materiales antes de cambiarla.");
    var productionOptions = finishedGoods.filter(function (item) { return item.inputs && item.inputs.length; }).map(function (item) {
      return '<option value="' + esc(item.id) + '"' + (currentProduct && currentProduct.id === item.id ? " selected" : "") + '>' + esc(item.name) + ' · ' + num(item.stock, 1) + ' ' + esc(item.unit) + '</option>';
    }).join("");
    var fields = (editingOrder ? '<input type="hidden" name="productionId" value="' + esc(editingOrder.id) + '">' : '') +
      formField("Producto a fabricar", "production-product", '<select name="product" id="production-product" required>' + productionOptions + '</select>', true) +
      formField("Cantidad a producir", "production-quantity", '<input name="quantity" id="production-quantity" type="number" min="1" step="1" value="' + (editingOrder ? Number(editingOrder.quantity) || 1 : 20) + '" required>') +
      formField("Desperdicio aproximado (kg)", "production-waste", '<input name="waste" id="production-waste" type="number" min="0" step="0.1" value="' + (editingOrder ? Number(editingOrder.wasteKg) || 0 : 0) + '">') +
      formField("Sede", "production-site", '<select name="site" id="production-site"><option>Sede principal</option></select>') +
      '<div class="field full"><label>Materiales estimados</label><div class="form-note" id="production-preview" style="margin:0">Elige un producto para revisar los materiales.</div></div>';
    openModal(editingOrder ? "Editar orden " + editingOrder.number : "Crear orden de producción", editingOrder ? "Corrige el producto, la cantidad o el desperdicio estimado." : "Registra lo que vas a fabricar y revisa los materiales necesarios.", modalForm("production-form", fields, "Al guardar, se ajustan las materias primas reservadas. Cuando termine, marca la orden como terminada para ingresar el producto al inventario.", editingOrder ? "Guardar cambios" : "Crear orden"));
    var form = document.getElementById("production-form");
    form.addEventListener("change", updateProductionPreview);
    form.addEventListener("input", updateProductionPreview);
    updateProductionPreview();
  }

  function updateProductionPreview() {
    var form = document.getElementById("production-form");
    if (!form) return;
    var product = state.inventory.find(function (item) { return item.id === form.elements.product.value; });
    var quantity = Number(form.elements.quantity.value) || 0;
    var preview = document.getElementById("production-preview");
    if (!product || !preview) return;
    var lines = (product.inputs || []).map(function (input) {
      var material = state.inventory.find(function (item) { return item.sku === input.sku; });
      return material ? esc(material.name) + ": <strong>" + num(input.amount * quantity, 2) + " " + esc(material.unit) + "</strong> · disponible " + num(material.stock, 1) + " " + esc(material.unit) : "";
    }).filter(Boolean);
    preview.innerHTML = lines.length ? lines.join("<br>") : "Este producto no tiene una receta guardada todavía.";
  }

  function openEnvironmentModal() {
    var existingRecord = state.environment.some(function (item) { return item.period === currentPeriod; });
    openModal(existingRecord ? "Actualiza los datos del mes" : "Registra tu consumo", existingRecord ? "Vuelve a leer un recibo o corrige manualmente el período seleccionado." : "Sube un recibo y revisa los datos que encontramos, o anótalos manualmente.",
      '<div class="modal-form"><div class="receipt-choice-grid">' +
      '<button type="button" class="receipt-choice" data-action="environment-pick-receipt"><span class="receipt-choice-icon">↑</span><strong>Subir un recibo</strong><small>Elige un PDF, JPG o PNG desde tu dispositivo.</small></button>' +
      '<button type="button" class="receipt-choice" data-action="environment-example"><span class="receipt-choice-icon">▤</span><strong>Probar con un ejemplo</strong><small>Usa un recibo ficticio para conocer el flujo.</small></button></div>' +
      '<div class="divider"></div><button type="button" class="button button-secondary" data-action="environment-manual">Ingresar datos manualmente</button>' +
      '<input id="environment-receipt-file" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" class="visually-hidden">' +
      '<p class="form-note">El archivo se procesa en el navegador y no se guarda en Pyme360. Siempre podrás corregir lo leído antes de confirmarlo.</p>' +
      '<div class="modal-footer"><button type="button" class="button button-quiet" data-action="close-modal">Cerrar</button></div></div>');
  }

  function openEnvironmentTargetsModal() {
    var goals = state.environmentTargets || { energyReductionPct: null, waterReductionPct: null };
    var energyValue = goals.energyReductionPct == null ? "10" : esc(goals.energyReductionPct);
    var waterValue = goals.waterReductionPct == null ? "10" : esc(goals.waterReductionPct);
    var fields = formField("Mejora de energía por unidad (%)", "target-energy", '<input name="energy" id="target-energy" type="number" min="1" max="99" step="1" value="' + energyValue + '" required><small class="field-hint">Ejemplo: 10 significa usar 10% menos kWh por unidad.</small>', true) +
      formField("Mejora de agua por unidad (%)", "target-water", '<input name="water" id="target-water" type="number" min="1" max="99" step="1" value="' + waterValue + '" required><small class="field-hint">Ejemplo: 10 significa usar 10% menos m³ por unidad.</small>', true);
    openModal("Define tus metas propias", "Elige un porcentaje de mejora para energía y agua.", modalForm("environment-target-form", fields, "La comparación usa el promedio de tus últimos tres meses anteriores con consumo y producción. No es un mínimo universal ni un requisito ambiental.", "Guardar metas"));
  }

  function submitEnvironmentTargets(form) {
    var energy = Number(form.elements.energy.value);
    var water = Number(form.elements.water.value);
    if (!Number.isInteger(energy) || energy < 1 || energy > 99 || !Number.isInteger(water) || water < 1 || water > 99) {
      return toast("Revisa los porcentajes", "Cada meta debe estar entre 1% y 99%.");
    }
    state.environmentTargets = { energyReductionPct: energy, waterReductionPct: water };
    saveState();
    closeModal();
    render();
    toast("Metas guardadas", "Son objetivos propios de mejora de tu empresa.");
  }

  function openManualEnvironmentModal() {
    var record = currentEnvironment();
    var existingRecord = state.environment.some(function (item) { return item.period === currentPeriod; });
    var fields = formField("Energía de la factura (kWh)", "energy", '<input name="energy" id="energy" type="number" min="0" step="1" value="' + (record.electricityKwh || "") + '" placeholder="Ej. 1.250">') +
      formField("Agua consumida (m³)", "water", '<input name="water" id="water" type="number" min="0" step="0.1" value="' + (record.waterM3 || "") + '" placeholder="Ej. 42">') +
      formField("Combustible (litros)", "fuel", '<input name="fuel" id="fuel" type="number" min="0" step="0.1" value="' + (record.fuelL || "") + '" placeholder="Ej. 35">') +
      formField("Unidades producidas", "units", '<input name="units" id="units" type="number" min="0" step="1" value="' + (record.productionUnits || "") + '" placeholder="Ej. 1.100">') +
      formField("Residuos orgánicos (kg)", "organic", '<input name="organic" id="organic" type="number" min="0" step="0.1" value="' + (record.organicKg || "") + '">') +
      formField("Material aprovechable (kg)", "recyclable", '<input name="recyclable" id="recyclable" type="number" min="0" step="0.1" value="' + (record.recyclableKg || "") + '">') +
      formField("No aprovechables (kg)", "nonrecyclable", '<input name="nonrecyclable" id="nonrecyclable" type="number" min="0" step="0.1" value="' + (record.nonRecyclableKg || "") + '">') +
      formField("Residuos peligrosos (kg)", "hazardous", '<input name="hazardous" id="hazardous" type="number" min="0" step="0.1" value="' + (record.hazardousKg || "") + '">') +
      formField("Reciclado o reutilizado (kg)", "recycled", '<input name="recycled" id="recycled" type="number" min="0" step="0.1" value="' + (record.recycledKg || "") + '">');
    openModal(existingRecord ? "Editar datos del mes" : "Registrar datos del mes", "Puedes encontrarlos en las facturas, medidores o registros de producción.", modalForm("environment-form", fields, "Los valores se guardan para " + monthName(currentPeriod) + ". Las emisiones de esta demostración usan factores ilustrativos.", existingRecord ? "Guardar cambios" : "Guardar datos"));
  }

  function openEnvironmentExample() {
    receiptSession = {
      type: "energy", period: "2026-10", consumption: 1284, unit: "kWh", confidence: 1,
      periodConfidence: 1, method: "ejemplo", sourceLabel: "Ejemplo demostrativo", warnings: [],
      demoImage: "vendor/receipt-reader/sample-energy-receipt.svg",
      textPreview: "RECIBO DE ENERGÍA · Período de consumo: octubre 2026 · Consumo facturado: 1.284 kWh"
    };
    openReceiptReview();
  }

  function openReceiptReview() {
    var receipt = receiptSession;
    if (!receipt) return;
    var warning = receipt.warnings && receipt.warnings.length ? '<div class="receipt-warning"><strong>Revisa antes de guardar</strong><ul>' + receipt.warnings.map(function (item) { return '<li>' + esc(item) + '</li>'; }).join("") + '</ul></div>' : '';
    var quality = receipt.warnings && receipt.warnings.length ? '<span class="status pending">Requiere revisión</span>' : '<span class="status">Texto detectado · ' + esc(receipt.method || "lectura local") + '</span>';
    var note = receipt.method === "ejemplo" ? '<span class="status neutral">Datos de demostración</span>' : quality;
    var demoReceipt = receipt.demoImage ? '<div class="demo-receipt"><img src="' + esc(receipt.demoImage) + '" alt="Recibo ficticio de energía con consumo de 1.284 kWh"><small>Documento ficticio · no es una factura real</small></div>' : "";
    var content = '<form class="modal-form" id="receipt-review-form"><div class="receipt-review-intro">' + note + '<p>Confirma o corrige los campos. Pyme360 guardará solo los valores confirmados, no el archivo.</p></div>' + warning +
      '<div class="form-grid">' +
      formField("Servicio", "receipt-type", '<select name="type" id="receipt-type"><option value="energy"' + (receipt.type === "energy" ? " selected" : "") + '>Energía (kWh)</option><option value="water"' + (receipt.type === "water" ? " selected" : "") + '>Agua (m³)</option></select>', true) +
      formField("Mes del consumo", "receipt-period", '<input name="period" id="receipt-period" type="month" required value="' + esc(receipt.period || currentPeriod) + '">', false) +
      formField("Consumo del recibo", "receipt-consumption", '<input name="consumption" id="receipt-consumption" type="number" min="0" step="any" required value="' + (Number(receipt.consumption) > 0 ? String(receipt.consumption) : "") + '" placeholder="Escribe el valor si no se detectó">', false) +
      formField("Unidad", "receipt-unit", '<input id="receipt-unit" type="text" readonly value="' + (receipt.type === "water" ? "m³" : "kWh") + '">', false) +
      '</div>' +
      demoReceipt +
      '<details class="receipt-preview"><summary>Ver texto leído</summary><p>' + esc((receipt.textPreview || "No se pudo extraer texto del documento.").slice(0, 1400)) + '</p></details>' +
      '<div class="form-note">Origen: ' + esc(receipt.sourceLabel || "Recibo cargado") + ' · Método: ' + esc(receipt.method || "lectura local") + '. La lectura automática puede equivocarse; compárala con tu factura.</div>' +
      '<div class="modal-footer"><button type="button" class="button button-secondary" data-action="close-modal">Cancelar</button><button type="submit" class="button button-primary">Confirmar y guardar</button></div></form>';
    openModal("Revisa los datos del recibo", "Comprobemos lo que encontramos antes de actualizar el mes.", content);
  }

  async function processEnvironmentReceipt(file) {
    if (!file) return;
    var readToken = { cancelled: false, worker: null };
    activeReceiptRead = readToken;
    openModal("Leyendo recibo…", "El archivo se procesa en este dispositivo. Esto puede tardar unos segundos.", '<div class="modal-form"><div class="receipt-progress"><span class="receipt-progress-bar" id="receipt-progress-bar"></span></div><p id="receipt-progress-label">Preparando lectura…</p><div class="modal-footer"><button type="button" class="button button-quiet" data-action="close-modal">Cancelar</button></div></div>');
    try {
      if (!window.Pyme360ReceiptReader) throw new Error("No se cargó el lector de recibos local. Recarga la página e inténtalo de nuevo.");
      var result = await window.Pyme360ReceiptReader.read(file, function (progress) {
        if (readToken.cancelled) return;
        var label = document.getElementById("receipt-progress-label");
        var bar = document.getElementById("receipt-progress-bar");
        if (label) label.textContent = progress.label || "Leyendo documento…";
        if (bar) bar.style.width = Math.max(4, Math.min(100, progress.percent || 4)) + "%";
      }, readToken);
      if (readToken.cancelled || activeReceiptRead !== readToken) return;
      activeReceiptRead = null;
      receiptSession = result;
      openReceiptReview();
    } catch (error) {
      if (readToken.cancelled || activeReceiptRead !== readToken) return;
      activeReceiptRead = null;
      var readerError = error.message || "El archivo no se pudo procesar.";
      if (window.location.protocol === "file:") {
        readerError = "El archivo se eligió correctamente, pero al abrir index.html directamente el navegador puede bloquear el lector automático. No se guardó ningún dato.";
      }
      openModal("No pudimos leer el recibo", readerError,
        '<div class="modal-form"><p>Puedes intentar con una foto más clara o escribir el consumo manualmente. No se guardó ningún dato.</p><div class="modal-footer"><button type="button" class="button button-secondary" data-action="close-modal">Cerrar</button><button type="button" class="button button-primary" data-action="environment-manual">Ingresar manualmente</button></div></div>');
    } finally {
      if (activeReceiptRead === readToken) activeReceiptRead = null;
      file = null;
    }
  }

  function submitReceiptReview(form) {
    var period = form.elements.period.value;
    var rawAmount = form.elements.consumption.value.trim();
    var amount = Number(rawAmount);
    var type = form.elements.type.value;
    if (!/^\d{4}-\d{2}$/.test(period) || !rawAmount || !Number.isFinite(amount) || amount < 0 || ["energy", "water"].indexOf(type) < 0) {
      return toast("Revisa el período y el consumo", "Confirma una fecha válida y una cantidad de cero o más.");
    }
    var nextState;
    try { nextState = JSON.parse(JSON.stringify(state)); }
    catch (error) { return toast("No se pudo preparar el registro", "Cierra otras pestañas e inténtalo de nuevo."); }
    var record = nextState.environment.find(function (item) { return item.period === period; });
    if (!record) {
      record = { period: period, electricityKwh: 0, waterM3: 0, fuelL: 0, organicKg: 0, recyclableKg: 0, nonRecyclableKg: 0, hazardousKg: 0, recycledKg: 0, productionUnits: 0, readingSources: {} };
      nextState.environment.push(record);
    }
    if (!record.readingSources) record.readingSources = {};
    var field = type === "energy" ? "electricityKwh" : "waterM3";
    record[field] = amount;
    var original = receiptSession || {};
    var key = type === "energy" ? "energy" : "water";
    record.readingSources[key] = {
      label: original.sourceLabel || "Recibo confirmado",
      method: original.method || "lectura local",
      confidence: Number(original.confidence) || 0,
      confirmedAt: new Date().toISOString()
    };
    var sourcePrefix = type === "energy" ? "energy" : "water";
    record[sourcePrefix + "Source"] = record.readingSources[key].label;
    record[sourcePrefix + "Method"] = record.readingSources[key].method;
    record[sourcePrefix + "CapturedAt"] = record.readingSources[key].confirmedAt;
    nextState.activity.unshift({ text: "Consumo confirmado desde recibo", detail: monthName(period) + " " + period.slice(0, 4) + " · " + amount + " " + (type === "energy" ? "kWh" : "m³"), time: "Ahora", icon: "♧" });
    nextState.activity = nextState.activity.slice(0, 8);
    state = nextState;
    saveState();
    currentPeriod = period;
    receiptSession = null;
    closeModal();
    render();
    toast("Consumo confirmado", "Guardamos el valor y el origen, sin conservar el recibo.");
  }

  function openPurchaseModal(purchaseId) {
    var editingPurchase = purchaseId ? state.purchases.find(function (item) { return item.id === purchaseId; }) : null;
    if (purchaseId && !editingPurchase) return toast("No encontramos esa compra", "Actualiza la lista e inténtalo de nuevo.");
    var hasSupplier = state.contacts.some(function (item) { return item.role.indexOf("Proveedor") >= 0; });
    var hasMaterial = state.inventory.some(function (item) { return item.type === "Materia prima" || item.type === "Insumo"; });
    if (!hasSupplier || !hasMaterial) {
      return openModal("Completa estos datos primero", "Para registrar una compra necesitas un proveedor y un producto de inventario.", '<div class="modal-form"><div class="modal-footer">' +
        (!hasSupplier ? '<button class="button button-secondary" data-page="contacts">Agregar proveedor</button>' : '') +
        (!hasMaterial ? '<button class="button button-primary" data-action="new-product">Agregar materia prima</button>' : '') +
        '<button class="button button-quiet" data-action="close-modal">Cerrar</button></div></div>');
    }
    var existingSupplier = editingPurchase && state.contacts.find(function (item) { return item.id === editingPurchase.supplierId; });
    if (!existingSupplier && editingPurchase) existingSupplier = state.contacts.find(function (item) { return item.name === editingPurchase.supplier && item.role.indexOf("Proveedor") >= 0; });
    var existingLines = editingPurchase ? purchaseLines(editingPurchase) : [];
    var statuses = ["Recibida", "Por recibir"];
    if (editingPurchase && editingPurchase.status === "Pagada") statuses.push("Pagada");
    var fields = (editingPurchase ? '<input type="hidden" name="purchaseId" value="' + esc(editingPurchase.id) + '">' : '') +
      formField("Proveedor", "purchase-supplier", '<select name="supplier" id="purchase-supplier" required><option value="">Selecciona proveedor</option>' + contactOptions("Proveedor", existingSupplier && existingSupplier.id) + '</select>', true) +
      '<div class="field full"><label>Productos comprados</label><div class="document-lines" id="purchase-lines">' + (existingLines.length ? existingLines.map(function (line) { return purchaseLineHtml(line); }).join("") : purchaseLineHtml()) + '</div><button type="button" class="button button-quiet document-add-line" data-action="purchase-add-line">＋ Agregar otro producto</button><small class="field-hint">Anota la cantidad y el costo total de cada producto.</small><div class="purchase-total-preview" id="purchase-preview">Total de compra: ' + money(editingPurchase ? editingPurchase.total : 100000) + '</div></div>' +
      formField("Fecha", "purchase-date", '<input name="date" id="purchase-date" type="date" value="' + esc(editingPurchase && editingPurchase.date || today()) + '" required>') +
      formField("Estado", "purchase-status", '<select name="status" id="purchase-status">' + statuses.map(function (status) { return '<option' + (editingPurchase ? (editingPurchase.status === status ? " selected" : "") : (status === "Recibida" ? " selected" : "")) + '>' + esc(status) + '</option>'; }).join("") + '</select>');
    openModal(editingPurchase ? "Editar compra " + editingPurchase.number : "Registrar una compra", editingPurchase ? "Corrige los datos y revisa el efecto sobre las existencias." : "Registra lo recibido y actualiza las existencias.", modalForm("purchase-form", fields, "Esta acción crea o actualiza un registro local de compra. Revisa la factura original con tu contador.", editingPurchase ? "Guardar cambios" : "Guardar compra"));
    var form = document.getElementById("purchase-form");
    form.addEventListener("change", updatePurchasePreview);
    form.addEventListener("input", updatePurchasePreview);
    updatePurchaseLineRemoveButtons();
    updatePurchasePreview();
  }

  function purchaseLineHtml(existingLine) {
    var options = state.inventory.filter(function (item) { return item.type === "Materia prima" || item.type === "Insumo"; }).map(function (item) {
      return '<option value="' + esc(item.id) + '"' + (existingLine && existingLine.sku === item.sku ? " selected" : "") + '>' + esc(item.name) + ' · ' + num(item.stock, 1) + " " + esc(item.unit) + '</option>';
    }).join("");
    return '<div class="document-line purchase-line"><label><span>Producto o material</span><select data-purchase-product required><option value="">Elige un material</option>' + options + '</select></label><label><span>Cantidad</span><input data-purchase-quantity type="number" min="0.001" step="any" value="' + (existingLine ? esc(existingLine.quantity) : "10") + '" required></label><label><span>Costo total (COP)</span><input data-purchase-line-total type="number" min="0" step="100" value="' + (existingLine ? esc(existingLine.total) : "100000") + '" required></label><button type="button" class="button-quiet button-quiet-danger document-remove-line" data-action="purchase-remove-line" aria-label="Quitar producto">Quitar</button></div>';
  }

  function updatePurchaseLineRemoveButtons() {
    var rows = Array.prototype.slice.call(document.querySelectorAll("#purchase-lines .purchase-line"));
    rows.forEach(function (row) { var button = row.querySelector(".document-remove-line"); if (button) button.classList.toggle("hidden", rows.length < 2); });
  }

  function addPurchaseLine() {
    var container = document.getElementById("purchase-lines");
    if (!container) return;
    if (container.querySelectorAll(".purchase-line").length >= 30) return toast("La compra tiene muchos productos", "Puedes agregar hasta 30 productos en una compra.");
    container.insertAdjacentHTML("beforeend", purchaseLineHtml({ quantity: 1, total: 0 }));
    updatePurchaseLineRemoveButtons();
    updatePurchasePreview();
  }

  function removePurchaseLine(button) {
    var row = button.closest(".purchase-line");
    if (!row || document.querySelectorAll("#purchase-lines .purchase-line").length < 2) return;
    row.remove();
    updatePurchaseLineRemoveButtons();
    updatePurchasePreview();
  }

  function updatePurchasePreview() {
    var form = document.getElementById("purchase-form");
    var preview = document.getElementById("purchase-preview");
    if (!form || !preview) return;
    var total = Array.prototype.slice.call(form.querySelectorAll("[data-purchase-line-total]")).reduce(function (sum, input) { return sum + (Number(input.value) || 0); }, 0);
    preview.textContent = "Total de compra: " + money(total);
  }

  function syncContactNameRequirement(form) {
    if (!form) return;
    var nameInput = form.elements.name;
    var hint = document.getElementById("contact-name-hint");
    var mayOmitName = form.elements.role.value === "Cliente" && form.elements.ordinaryCustomer.checked;
    nameInput.required = !mayOmitName;
    nameInput.placeholder = mayOmitName ? "Opcional para cliente de mostrador" : "Ej. Distribuciones del Norte";
    if (hint) hint.textContent = mayOmitName ? "Puedes dejarlo vacío para un cliente de mostrador. Si vas a guardar identificación, correo o teléfono, escribe un nombre." : "Escribe el nombre o razón social del contacto.";
  }

  function openContactModal(contactId) {
    var contact = contactId ? state.contacts.find(function (item) { return item.id === contactId; }) : null;
    if (contactId && !contact) return toast("No encontramos ese contacto", "Actualiza la lista e inténtalo de nuevo.");
    var isOrdinary = contact ? contact.ordinaryCustomer === true : true;
    var selectedRole = contact ? (contact.role === "Cliente · Proveedor" ? "Cliente y proveedor" : contact.role) : "Cliente";
    var fields = (contact ? '<input type="hidden" name="contactId" value="' + esc(contact.id) + '">' : "") +
      formField("Nombre o razón social", "contact-name", '<input name="name" id="contact-name"' + (selectedRole === "Cliente" && isOrdinary ? "" : " required") + ' value="' + esc(contact ? contact.name || "" : "") + '" placeholder="' + (selectedRole === "Cliente" && isOrdinary ? "Opcional para cliente de mostrador" : "Ej. Distribuciones del Norte") + '" maxlength="100"><small class="field-hint" id="contact-name-hint">' + (selectedRole === "Cliente" && isOrdinary ? "Puedes dejarlo vacío para un cliente de mostrador. Si vas a guardar identificación, correo o teléfono, escribe un nombre." : "Escribe el nombre o razón social del contacto.") + '</small>', true) +
      formField("Tipo de contacto", "contact-kind", '<select name="role" id="contact-kind"><option' + (selectedRole === "Cliente" ? " selected" : "") + '>Cliente</option><option' + (selectedRole === "Proveedor" ? " selected" : "") + '>Proveedor</option><option' + (selectedRole === "Cliente y proveedor" ? " selected" : "") + '>Cliente y proveedor</option></select>') +
      '<div class="field full' + (selectedRole.indexOf("Cliente") >= 0 ? "" : " hidden") + '" id="contact-ordinary-field" data-customer-visible="' + (selectedRole.indexOf("Cliente") >= 0) + '"><label class="contact-checkbox" for="contact-ordinary"><input name="ordinaryCustomer" id="contact-ordinary" type="checkbox"' + (isOrdinary ? " checked" : "") + '> Identificar como cliente ordinario</label><small class="field-hint">Es una clasificación comercial interna, no define impuestos. Si es cliente de mostrador puedes omitir el nombre.</small></div>' +
      formField("Identificación (NIT o cédula)", "contact-idnumber", '<input name="idNumber" id="contact-idnumber" value="' + esc(contact ? contact.idNumber || "" : "") + '" placeholder="Ej. 900.123.456-7">') +
      formField("Correo electrónico", "contact-email", '<input name="email" id="contact-email" type="email" value="' + esc(contact ? contact.email || "" : "") + '" placeholder="correo@empresa.co">') +
      formField("Teléfono", "contact-phone", '<input name="phone" id="contact-phone" type="tel" value="' + esc(contact ? contact.phone || "" : "") + '" placeholder="300 000 0000">');
    openModal(contact ? "Editar contacto" : "Nuevo contacto", contact ? "Actualiza los datos de este cliente o proveedor." : "Guarda los datos que necesitas para vender o comprar.", modalForm("contact-form", fields, "Los datos tributarios y su tratamiento deben revisarse con tu contador.", contact ? "Guardar cambios" : "Guardar contacto"));
    syncContactNameRequirement(document.getElementById("contact-form"));
  }

  function openSetupModal() {
    var fields = formField("Nombre o razón social", "setup-company", '<input name="company" id="setup-company" value="' + esc(state.company) + '" required maxlength="100">', true) +
      formField("NIT", "setup-nit", '<input name="nit" id="setup-nit" value="' + esc(state.companyNit || "") + '" placeholder="Ej. 900.123.456-7">') +
      formField("Ciudad principal", "setup-city", '<input name="city" id="setup-city" value="' + esc(state.city || "") + '" placeholder="Ej. Bogotá">') +
      formField("Actividad", "setup-activity", '<select name="activity" id="setup-activity"><option>Alimentos y bebidas</option><option>Textiles y confección</option><option>Metalmecánica</option><option>Cosmética y cuidado personal</option><option>Otra manufactura</option></select>') +
      '<div class="field full"><label>Primeros pasos</label><div class="form-note" style="margin:0">1. Datos de empresa · 2. Sede y bodega · 3. Productos e inventario · 4. Impuestos y facturación.</div></div>';
    openModal("Configura tu negocio", "Empecemos con lo básico. Puedes completar el resto después.", modalForm("setup-form", fields, "Los datos se guardan en SQLite en este computador.", "Guardar y continuar"));
  }

  function openAdjustmentModal() {
    if (!state.inventory.length) return openProductModal();
    var fields = formField("Producto", "adjust-product", '<select name="product" id="adjust-product" required>' + productOptions(null) + '</select>', true) +
      formField("Cambio en existencia (+ / −)", "adjust-quantity", '<input name="quantity" id="adjust-quantity" type="number" step="0.1" required placeholder="Ej. 5 o -2">') +
      formField("Motivo", "adjust-reason", '<select name="reason" id="adjust-reason"><option>Conteo de inventario</option><option>Producto dañado</option><option>Corrección de registro</option><option>Otro</option></select>');
    openModal("Ajustar existencias", "Registra una diferencia de inventario con su motivo.", modalForm("adjust-form", fields, "El ajuste quedará registrado en la actividad reciente.", "Guardar ajuste"));
  }

  function openProductModal(productId) {
    var editingProduct = productId ? state.inventory.find(function (item) { return item.id === productId; }) : null;
    if (productId && !editingProduct) return toast("No encontramos ese producto", "Actualiza la lista e inténtalo de nuevo.");
    var hasRecipeMaterials = state.inventory.some(function (item) { return item.type === "Materia prima" || item.type === "Insumo"; });
    var identityFields = editingProduct ? '<input type="hidden" name="productId" value="' + esc(editingProduct.id) + '"><div class="field"><label>Tipo</label><div class="form-note" style="margin:0">' + esc(editingProduct.type) + '</div><small class="field-hint">No se cambia para conservar el historial de inventario.</small></div><div class="field"><label>Unidad</label><div class="form-note" style="margin:0">' + esc(editingProduct.unit) + '</div></div><div class="field full"><div class="form-note" style="margin:0">Existencia actual: <strong>' + num(editingProduct.stock, 1) + ' ' + esc(editingProduct.unit) + '</strong>. Para ajustarla usa “Ajustar stock” en Inventario.</div></div>' :
      formField("Tipo", "product-type", '<select name="type" id="product-type"><option>Materia prima</option><option>Insumo</option><option>Producto terminado</option></select>') +
      formField("Unidad", "product-unit", '<select name="unit" id="product-unit"><option>kg</option><option>unidad</option><option>litro</option><option>m³</option><option>caja</option><option>metro</option></select>') +
      formField("Existencia inicial", "product-stock", '<input name="stock" id="product-stock" type="number" min="0" step="0.1" value="0">');
    var type = editingProduct ? editingProduct.type : "Materia prima";
    var recipeLines = editingProduct && editingProduct.inputs && editingProduct.inputs.length ? editingProduct.inputs.map(function (line) { return recipeLineHtml(line); }).join("") : recipeLineHtml();
    var recipeField = '<section class="field full recipe-builder' + (type === "Producto terminado" ? "" : " hidden") + '" id="recipe-builder"><div class="recipe-builder-heading"><div><label>Receta para fabricar 1 unidad</label><p>Elige cada material y cuánto usas. Ejemplo: 1 camiseta = 0,5 m de tela + 2 botones.</p></div><button type="button" class="button button-secondary recipe-add-button" data-action="recipe-add-line"' + (hasRecipeMaterials ? "" : " disabled") + '>＋ Añadir material</button></div>' + (hasRecipeMaterials ? '<div class="recipe-lines" id="recipe-lines">' + recipeLines + '</div>' : '<p class="recipe-empty-note">Primero agrega materias primas o insumos en <strong>Inventario</strong>. Después podrás seleccionarlos aquí.</p>') + '<small class="field-hint">Usa la unidad de cada material. Si todavía no tienes la receta, puedes guardar el producto y completarla después.</small></section>';
    var fields = (editingProduct ? '<input type="hidden" name="type" value="' + esc(editingProduct.type) + '"><input type="hidden" name="unit" value="' + esc(editingProduct.unit) + '">' : '') +
      formField("Nombre del producto o material", "product-name", '<input name="name" id="product-name" required maxlength="100" value="' + esc(editingProduct ? editingProduct.name : "") + '" placeholder="Ej. Harina de maíz">', true) + identityFields +
      formField("Avisarme al llegar a", "product-min", '<input name="min" id="product-min" type="number" min="0" step="0.1" value="' + (editingProduct ? Number(editingProduct.min) || 0 : 0) + '">') +
      formField("Costo por unidad (COP)", "product-cost", '<input name="cost" id="product-cost" type="number" min="0" step="100" value="' + (editingProduct ? Number(editingProduct.cost) || 0 : 0) + '">') +
      formField("Precio de venta (COP)", "product-price", '<input name="price" id="product-price" type="number" min="0" step="100" value="' + (editingProduct ? Number(editingProduct.price) || 0 : 0) + '">') +
      formField("IVA", "product-tax-type", '<select name="taxType" id="product-tax-type"><option' + (!editingProduct || editingProduct.taxType === "Gravado" ? " selected" : "") + '>Gravado</option><option' + (editingProduct && editingProduct.taxType === "Excluido" ? " selected" : "") + '>Excluido</option><option' + (editingProduct && editingProduct.taxType === "Exento" ? " selected" : "") + '>Exento</option></select>') +
      formField("Tarifa IVA (%)", "product-tax-rate", '<input name="taxRate" id="product-tax-rate" type="number" min="0" max="100" step="1" value="' + (editingProduct ? Number(editingProduct.taxRate) || 0 : 19) + '">') + recipeField;
    openModal(editingProduct ? "Editar producto" : "Agregar producto", editingProduct ? "Actualiza su ficha, impuestos o receta." : "Registra tus productos, materias primas o insumos.", modalForm("product-form", fields, editingProduct ? "El código, tipo, unidad y existencia se conservan. Usa Ajustar stock para cambiar existencias." : "Puedes guardar un producto terminado sin receta y completarla después.", editingProduct ? "Guardar cambios" : "Guardar producto"));
    var form = document.getElementById("product-form");
    form.addEventListener("change", function (event) {
      var recipeBuilder = document.getElementById("recipe-builder");
      if (event.target.id === "product-type" && recipeBuilder) recipeBuilder.classList.toggle("hidden", event.target.value !== "Producto terminado");
      if (event.target.matches(".recipe-material-select")) updateRecipeUnit(event.target);
    });
    Array.prototype.slice.call(form.querySelectorAll(".recipe-material-select")).forEach(function (select) { updateRecipeUnit(select); });
    updateRecipeRemoveButtons();
  }

  function openPaymentModal() {
    var unpaid = state.sales.filter(function (sale) { return saleOutstanding(sale) > 0; });
    if (!unpaid.length) return toast("No tienes saldos pendientes", "Cuando registres una venta a crédito, podrás asociar pagos aquí.");
    var options = unpaid.map(function (sale, index) { return '<option value="' + esc(sale.id) + '"' + (index === 0 ? " selected" : "") + '>' + esc(sale.number) + " · " + esc(sale.customer) + " · Falta " + money(saleOutstanding(sale)) + '</option>'; }).join("");
    var fields = formField("Factura", "payment-sale", '<select name="sale" id="payment-sale">' + options + '</select>', true) +
      formField("Valor recibido (COP)", "payment-amount", '<input name="amount" id="payment-amount" type="number" min="0.01" step="0.01" max="' + saleOutstanding(unpaid[0]) + '" value="' + saleOutstanding(unpaid[0]) + '" required><small class="field-hint" id="payment-balance-hint">Saldo pendiente: ' + money(saleOutstanding(unpaid[0])) + '</small>', true) +
      formField("Fecha de pago", "payment-date", '<input name="date" id="payment-date" type="date" value="' + today() + '">') +
      formField("Medio de pago", "payment-method", '<select name="method" id="payment-method"><option>Transferencia</option><option>Efectivo</option><option>Consignación</option><option>Otro</option></select>');
    openModal("Registrar un pago", "Registra un abono o el pago completo de una factura.", modalForm("payment-form", fields, "Puedes registrar varios abonos. El saldo se actualizará automáticamente.", "Guardar pago"));
  }

  function updatePaymentBalance() {
    var form = document.getElementById("payment-form");
    if (!form) return;
    var sale = state.sales.find(function (item) { return item.id === form.elements.sale.value; });
    if (!sale) return;
    var balance = saleOutstanding(sale);
    var amount = form.elements.amount;
    if (amount) { amount.max = String(balance); amount.value = String(balance); }
    var hint = document.getElementById("payment-balance-hint");
    if (hint) hint.textContent = "Saldo pendiente: " + money(balance);
  }

  /* Guardado de operaciones */
  function submitSale(form) {
    var customer = state.contacts.find(function (item) { return item.id === form.elements.customer.value; });
    var discount = Number(form.elements.discount.value) || 0;
    var invoiceFollowUpStatus = form.elements.invoiceFollowUpStatus.value;
    var externalInvoiceNumber = form.elements.externalInvoiceNumber.value.trim();
    var externalInvoiceDate = form.elements.externalInvoiceDate.value;
    if (!customer) return toast("Elige un cliente", "Selecciona a quién le vendiste.");
    if (["Por revisar", "Registrada por fuera de Pyme360", "No aplica, según revisión del usuario"].indexOf(invoiceFollowUpStatus) < 0) return toast("Revisa el seguimiento de factura", "Elige una de las opciones disponibles.");
    var saleId = form.elements.saleId ? form.elements.saleId.value : "";
    var existing = saleId ? state.sales.find(function (item) { return item.id === saleId; }) : null;
    if (saleId && !existing) return toast("No encontramos esa venta", "Actualiza la lista e inténtalo de nuevo.");
    if (!Number.isFinite(discount) || discount < 0) return toast("Revisa el descuento", "El descuento debe ser cero o mayor.");
    var lines = [], newQuantities = {}, invalidLine = false;
    Array.prototype.slice.call(form.querySelectorAll(".sale-line")).forEach(function (row) {
      var product = state.inventory.find(function (item) { return item.id === row.querySelector("[data-sale-product]").value; });
      var quantity = Number(row.querySelector("[data-sale-quantity]").value);
      if (!product || product.type !== "Producto terminado" || !Number.isFinite(quantity) || quantity <= 0) { invalidLine = true; return; }
      var unitPrice = Number(row.querySelector("[data-sale-unit-price]").value);
      var rate = Number(row.querySelector("[data-sale-tax-rate]").value);
      if (!Number.isFinite(unitPrice) || unitPrice < 0 || !Number.isFinite(rate) || rate < 0 || rate > 100) { invalidLine = true; return; }
      var line = { sku: product.sku, quantity: quantity, unitPrice: unitPrice, taxRate: rate };
      var existingLine = lines.find(function (entry) { return entry.sku === product.sku; });
      if (existingLine && (existingLine.unitPrice !== line.unitPrice || existingLine.taxRate !== line.taxRate)) { invalidLine = true; return; }
      if (existingLine) existingLine.quantity += quantity;
      else lines.push(line);
      newQuantities[product.sku] = (newQuantities[product.sku] || 0) + quantity;
    });
    if (invalidLine || !lines.length) return toast("Revisa los productos", "Cada renglón necesita producto, cantidad y precio válidos. Si repites un producto, usa el mismo precio e IVA.");
    var oldLines = existing ? (existing.lines || []) : [];
    var previousInventoryApplied = !!(existing && existing.inventoryApplied !== false);
    var oldQuantities = {};
    oldLines.forEach(function (line) { oldQuantities[line.sku] = (oldQuantities[line.sku] || 0) + (Number(line.quantity) || 0); });
    if (previousInventoryApplied && Object.keys(oldQuantities).some(function (sku) { return !state.inventory.some(function (item) { return item.sku === sku; }); })) return toast("No se puede actualizar el inventario", "No encontramos uno de los productos originales de esta venta.");
    var shortProduct = Object.keys(newQuantities).map(function (sku) { return state.inventory.find(function (item) { return item.sku === sku; }); }).find(function (product) {
      var available = (Number(product.stock) || 0) + (previousInventoryApplied ? (oldQuantities[product.sku] || 0) : 0);
      return newQuantities[product.sku] > available;
    });
    if (shortProduct) {
      var availableStock = (Number(shortProduct.stock) || 0) + (previousInventoryApplied ? (oldQuantities[shortProduct.sku] || 0) : 0);
      return toast("No hay suficientes existencias", "De " + shortProduct.name + " hay " + num(availableStock, 1) + " " + shortProduct.unit + " disponibles para esta venta.");
    }
    var subtotal = lines.reduce(function (sum, line) { return sum + line.unitPrice * line.quantity; }, 0);
    var taxBeforeDiscount = lines.reduce(function (sum, line) { return sum + line.unitPrice * line.quantity * line.taxRate / 100; }, 0);
    var netSubtotal = Math.max(0, subtotal - discount);
    var taxTotal = subtotal ? taxBeforeDiscount * netSubtotal / subtotal : 0;
    var total = Math.round(netSubtotal + taxTotal);
    var payments = existing && Array.isArray(existing.payments) ? existing.payments.slice() : [];
    if (existing && !payments.length && existing.status === "Pagada") payments.push({ id: "legacy-" + existing.id, date: existing.paidDate || existing.date || today(), amount: Number(existing.total) || 0, method: existing.method || existing.payment || "Pago registrado", legacy: true });
    if (!existing && form.elements.payment.value === "Contado") payments.push({ id: "pay" + Date.now(), date: form.elements.date.value || today(), amount: total, method: "Pago al contado" });
    if (payments.reduce(function (sum, item) { return sum + (Number(item.amount) || 0); }, 0) > total) return toast("El nuevo total es menor que los pagos recibidos", "Ajusta los pagos registrados o conserva un total igual o mayor al valor ya abonado.");
    var maxInvoice = state.sales.reduce(function (max, item) { var value = Number(String(item.number).replace(/\D/g, "")); return Math.max(max, value || 0); }, 0);
    var sale = Object.assign({}, existing || {}, {
      id: existing ? existing.id : "v" + Date.now(),
      number: existing ? existing.number : "FV-" + String(maxInvoice + 1).padStart(4, "0"),
      customer: customer.name, customerId: customer.id, date: form.elements.date.value || today(),
      subtotal: subtotal, total: total, taxRate: subtotal ? taxBeforeDiscount / subtotal * 100 : 0, discount: discount,
      status: "Pendiente de pago", payment: form.elements.payment.value, lines: lines, payments: payments, demo: true, inventoryApplied: true,
      invoiceFollowUpStatus: invoiceFollowUpStatus, externalInvoiceNumber: externalInvoiceNumber, externalInvoiceDate: externalInvoiceDate
    });
    refreshSaleStatus(sale);
    if (previousInventoryApplied) Object.keys(oldQuantities).forEach(function (sku) {
      var previousProduct = state.inventory.find(function (item) { return item.sku === sku; });
      previousProduct.stock += oldQuantities[sku];
    });
    Object.keys(newQuantities).forEach(function (sku) {
      var product = state.inventory.find(function (item) { return item.sku === sku; });
      product.stock -= newQuantities[sku];
    });
    if (existing) {
      var saleIndex = state.sales.findIndex(function (item) { return item.id === existing.id; });
      state.sales[saleIndex] = sale;
    } else state.sales.unshift(sale);
    addActivity(existing ? "Venta actualizada" : "Venta registrada", sale.number + " · " + customer.name, "↗");
    saveState();
    closeModal();
    render();
    toast(existing ? "Venta actualizada" : "Venta guardada", sale.number + " · No se transmitió a la DIAN.");
  }

  function submitProduction(form) {
    var product = state.inventory.find(function (item) { return item.id === form.elements.product.value; });
    var quantity = Number(form.elements.quantity.value);
    var waste = Number(form.elements.waste.value) || 0;
    if (!product) return toast("Elige un producto", "Selecciona qué vas a fabricar.");
    if (!Number.isFinite(quantity) || quantity < 1 || !Number.isFinite(waste) || waste < 0) return toast("Revisa las cantidades", "La cantidad debe ser mayor a cero y el desperdicio no puede ser negativo.");
    var orderId = form.elements.productionId ? form.elements.productionId.value : "";
    var existing = orderId ? state.production.find(function (item) { return item.id === orderId; }) : null;
    if (orderId && (!existing || existing.status !== "En proceso" || existing.inventoryApplied === false)) return toast("No se puede editar esta orden", "Solo puedes cambiar órdenes locales que siguen en proceso.");
    var required = [];
    var invalidRecipe = false;
    (product.inputs || []).forEach(function (input) {
      var material = state.inventory.find(function (item) { return item.sku === input.sku; });
      var amount = (Number(input.amount) || 0) * quantity;
      if (!material || !Number.isFinite(amount) || amount <= 0) { invalidRecipe = true; return; }
      var line = required.find(function (entry) { return entry.item.id === material.id; });
      if (line) line.amount += amount; else required.push({ item: material, amount: amount });
    });
    if (invalidRecipe) return toast("Revisa la receta", "Hay un material faltante o una cantidad inválida en la receta del producto.");
    if (!required.length) return toast("Este producto no tiene receta", "Edita el producto y agrega los materiales antes de crear la orden.");
    var oldConsumption = existing ? (existing.inputConsumption || []) : [];
    var availableFor = function (material) {
      var old = oldConsumption.filter(function (line) { return line.sku === material.sku; }).reduce(function (sum, line) { return sum + (Number(line.quantity) || 0); }, 0);
      return material.stock + old;
    };
    if (oldConsumption.some(function (line) { return !state.inventory.some(function (item) { return item.sku === line.sku; }); })) return toast("No se puede ajustar esta orden", "No encontramos todos los materiales que se habían reservado.");
    var short = required.find(function (entry) { return !entry.item || availableFor(entry.item) < entry.amount; });
    if (short) return toast("Faltan materiales", short.item ? "No alcanza " + short.item.name + " para esta orden." : "Revisa la receta del producto.");
    if (existing) oldConsumption.forEach(function (line) {
      var material = state.inventory.find(function (item) { return item.sku === line.sku; });
      if (material) material.stock += Number(line.quantity) || 0;
    });
    required.forEach(function (entry) { entry.item.stock -= entry.amount; });
    var order = existing || { id: "pr" + Date.now(), number: "OP-" + String(82 + state.production.length).padStart(4, "0"), date: today(), status: "En proceso", inventoryApplied: true };
    order.product = product.name; order.productId = product.id; order.quantity = quantity; order.wasteKg = waste;
    order.inputConsumption = required.map(function (entry) { return { sku: entry.item.sku, quantity: entry.amount }; });
    if (!existing) state.production.unshift(order);
    addActivity(existing ? "Orden de producción actualizada" : "Orden de producción creada", order.number + " · " + quantity + " unidades", "⚙");
    saveState();
    closeModal();
    render();
    toast(existing ? "Orden actualizada" : "Orden creada", order.number + " · Las existencias de materiales quedaron ajustadas.");
  }

  function completeProduction(id) {
    var order = state.production.find(function (item) { return item.id === id; });
    if (!order || order.status !== "En proceso") return;
    if (order.inventoryApplied === false) return toast("Orden importada", "Este registro no reservó materiales en Pyme360. Revísalo en el archivo original antes de cerrar producción.");
    var product = state.inventory.find(function (item) { return item.id === order.productId; }) ||
      state.inventory.find(function (item) { return item.name === order.product; });
    if (!product) return toast("No se encontró el producto terminado");
    product.stock += order.quantity;
    order.status = "Terminada";
    order.completedDate = today();
    var record = currentEnvironment();
    record.productionUnits += order.quantity;
    record.nonRecyclableKg += Number(order.wasteKg) || 0;
    upsertEnvironment(record);
    addActivity("Orden de producción terminada", order.number + " · " + order.quantity + " unidades", "⚙");
    saveState();
    closeModal();
    render();
    toast("Orden terminada", "El producto terminado ya está disponible en inventario.");
  }

  function submitEnvironment(form) {
    var record = currentEnvironment();
    var energy = Number(form.elements.energy.value) || 0;
    var water = Number(form.elements.water.value) || 0;
    if (!record.readingSources) record.readingSources = {};
    if (energy !== Number(record.electricityKwh)) {
      record.readingSources.energy = { label: "Registro manual", method: "manual", confidence: 1, confirmedAt: new Date().toISOString() };
      record.energySource = "Registro manual"; record.energyMethod = "manual"; record.energyCapturedAt = record.readingSources.energy.confirmedAt;
    }
    if (water !== Number(record.waterM3)) {
      record.readingSources.water = { label: "Registro manual", method: "manual", confidence: 1, confirmedAt: new Date().toISOString() };
      record.waterSource = "Registro manual"; record.waterMethod = "manual"; record.waterCapturedAt = record.readingSources.water.confirmedAt;
    }
    record.electricityKwh = energy;
    record.waterM3 = water;
    record.fuelL = Number(form.elements.fuel.value) || 0;
    record.productionUnits = Number(form.elements.units.value) || record.productionUnits || 0;
    record.organicKg = Number(form.elements.organic.value) || 0;
    record.recyclableKg = Number(form.elements.recyclable.value) || 0;
    record.nonRecyclableKg = Number(form.elements.nonrecyclable.value) || 0;
    record.hazardousKg = Number(form.elements.hazardous.value) || 0;
    record.recycledKg = Number(form.elements.recycled.value) || 0;
    upsertEnvironment(record);
    addActivity("Datos ambientales actualizados", monthName(currentPeriod) + " · consumos y residuos", "♧");
    saveState();
    closeModal();
    render();
    toast("Datos ambientales guardados", "Ya puedes revisar el resumen y las recomendaciones del mes.");
  }

  function submitPurchase(form) {
    var supplier = state.contacts.find(function (item) { return item.id === form.elements.supplier.value; });
    if (!supplier) return toast("Elige un proveedor", "Selecciona quién te vendió los materiales.");
    var status = form.elements.status.value;
    var purchaseId = form.elements.purchaseId ? form.elements.purchaseId.value : "";
    var existing = purchaseId ? state.purchases.find(function (item) { return item.id === purchaseId; }) : null;
    if (purchaseId && !existing) return toast("No encontramos esa compra", "Actualiza la lista e inténtalo de nuevo.");
    var lines = [], newQuantities = {}, productsBySku = {};
    var invalidLine = false;
    Array.prototype.slice.call(form.querySelectorAll(".purchase-line")).forEach(function (row) {
      var product = state.inventory.find(function (item) { return item.id === row.querySelector("[data-purchase-product]").value; });
      var quantity = Number(row.querySelector("[data-purchase-quantity]").value);
      var lineTotal = Number(row.querySelector("[data-purchase-line-total]").value);
      if (!product || (product.type !== "Materia prima" && product.type !== "Insumo") || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(lineTotal) || lineTotal < 0) { invalidLine = true; return; }
      productsBySku[product.sku] = product;
      var line = lines.find(function (entry) { return entry.sku === product.sku; });
      if (line) { line.quantity += quantity; line.total += lineTotal; }
      else lines.push({ sku: product.sku, quantity: quantity, total: lineTotal });
      newQuantities[product.sku] = (newQuantities[product.sku] || 0) + quantity;
    });
    if (invalidLine || !lines.length) return toast("Completa los productos", "En cada renglón elige un material, escribe una cantidad y registra su costo total.");
    var oldLines = existing ? purchaseLines(existing) : [];
    var oldQuantities = {};
    oldLines.forEach(function (line) { oldQuantities[line.sku] = (oldQuantities[line.sku] || 0) + (Number(line.quantity) || 0); });
    var previousApplied = !!(existing && existing.inventoryApplied !== false && existing.status !== "Por recibir");
    var statusReceived = status !== "Por recibir";
    var shouldApply = existing ? (previousApplied || (existing.status === "Por recibir" && statusReceived)) : statusReceived;
    var applyNewMovement = shouldApply && statusReceived;
    var oldSkus = Object.keys(oldQuantities).sort(), newSkus = Object.keys(newQuantities).sort();
    var sameMovement = oldSkus.length === newSkus.length && oldSkus.every(function (sku, index) { return sku === newSkus[index] && Number(oldQuantities[sku]) === Number(newQuantities[sku]); });
    var movementChanged = !existing || previousApplied !== applyNewMovement || (previousApplied && applyNewMovement && !sameMovement);
    if (previousApplied && movementChanged) {
      var cannotReverse = oldSkus.find(function (sku) {
        var oldProduct = state.inventory.find(function (item) { return item.sku === sku; });
        return !oldProduct || Number(oldProduct.stock) < Number(oldQuantities[sku]);
      });
      if (cannotReverse) return toast("No se puede corregir esta compra", "Parte de lo recibido de " + cannotReverse + " ya se usó. Revisa los movimientos antes de cambiarla.");
    }
    if (previousApplied && movementChanged) oldSkus.forEach(function (sku) {
      var oldProduct = state.inventory.find(function (item) { return item.sku === sku; });
      oldProduct.stock -= oldQuantities[sku];
    });
    if (applyNewMovement && movementChanged) newSkus.forEach(function (sku) { productsBySku[sku].stock += newQuantities[sku]; });
    var firstLine = lines[0];
    var total = lines.reduce(function (sum, line) { return sum + line.total; }, 0);
    var detail = lines.map(function (line) { var product = state.inventory.find(function (item) { return item.sku === line.sku; }); return (product ? product.name : line.sku) + " · " + num(line.quantity, 2) + " " + (product ? product.unit : ""); }).join(", ");
    var purchase = Object.assign({}, existing || {}, {
      id: existing ? existing.id : "co" + Date.now(),
      number: existing ? existing.number : "OC-" + String(239 + state.purchases.length).padStart(4, "0"),
      supplier: supplier.name, supplierId: supplier.id, date: form.elements.date.value || today(),
      total: total, status: status, detail: detail,
      productSku: firstLine.sku, quantity: firstLine.quantity, lines: lines, inventoryApplied: applyNewMovement
    });
    if (existing) state.purchases[state.purchases.findIndex(function (item) { return item.id === existing.id; })] = purchase;
    else state.purchases.unshift(purchase);
    addActivity(existing ? "Compra actualizada" : (statusReceived ? "Compra recibida" : "Compra registrada"), purchase.number + " · " + detail, "↙");
    saveState();
    closeModal();
    render();
    toast(existing ? "Compra actualizada" : "Compra guardada", statusReceived ? (purchase.inventoryApplied ? "Las existencias quedaron actualizadas." : "El registro se actualizó; por ser importado, no se modificó el inventario.") : "Quedó pendiente de recibir.");
  }

  function submitContact(form) {
    var name = form.elements.name.value.trim();
    var selectedRole = form.elements.role.value;
    var hasCustomerRole = selectedRole.indexOf("Cliente") >= 0;
    var ordinaryCustomer = hasCustomerRole && form.elements.ordinaryCustomer.checked;
    var isWalkIn = selectedRole === "Cliente" && ordinaryCustomer && !name;
    if (!name && !isWalkIn) return toast("Escribe el nombre del contacto", "Solo puedes omitirlo para un cliente ordinario de mostrador.");
    if (isWalkIn && (form.elements.idNumber.value.trim() || form.elements.email.value.trim() || form.elements.phone.value.trim())) return toast("Para cliente de mostrador no guardes datos personales", "Si necesitas guardar identificación o contacto, escribe primero su nombre.");
    if (isWalkIn) name = "Cliente de mostrador";
    var existingId = form.elements.contactId ? form.elements.contactId.value : "";
    var existing = existingId ? state.contacts.find(function (item) { return item.id === existingId; }) : null;
    if (existingId && !existing) return toast("No encontramos ese contacto", "Actualiza la lista e inténtalo de nuevo.");
    var duplicateWalkIn = isWalkIn && state.contacts.find(function (item) { return item.id !== existingId && item.name === "Cliente de mostrador" && item.role === "Cliente" && item.ordinaryCustomer === true; });
    if (duplicateWalkIn) {
      closeModal();
      return toast("Ya tienes un cliente de mostrador", "Usa ese contacto al registrar tus ventas para evitar duplicados.");
    }
    var contactData = {
      id: existing ? existing.id : "c" + Date.now(), name: name,
      role: selectedRole === "Cliente y proveedor" ? "Cliente · Proveedor" : selectedRole,
      ordinaryCustomer: ordinaryCustomer,
      idNumber: form.elements.idNumber.value.trim(), email: form.elements.email.value.trim(), phone: form.elements.phone.value.trim()
    };
    if (existing) {
      var index = state.contacts.findIndex(function (item) { return item.id === existing.id; });
      state.contacts[index] = Object.assign({}, existing, contactData);
    } else state.contacts.unshift(contactData);
    addActivity(existing ? "Contacto actualizado" : "Nuevo contacto", name, "♙");
    saveState();
    closeModal();
    render();
    toast(existing ? "Contacto actualizado" : "Contacto guardado", name + " ya está en tu lista.");
  }

  function submitSetup(form) {
    state.company = form.elements.company.value.trim();
    state.companyNit = form.elements.nit.value.trim();
    state.city = form.elements.city.value.trim();
    state.activityType = form.elements.activity.value;
    saveState();
    closeModal();
    render();
    toast("Datos básicos guardados", "Siguiente paso: revisar sedes, productos e impuestos.");
  }

  function submitProduct(form) {
    var name = form.elements.name.value.trim();
    var type = form.elements.type.value;
    if (!name) return toast("Escribe el nombre del producto");
    var productId = form.elements.productId ? form.elements.productId.value : "";
    var existing = productId ? state.inventory.find(function (item) { return item.id === productId; }) : null;
    if (productId && !existing) return toast("No encontramos ese producto", "Actualiza la lista e inténtalo de nuevo.");
    var recipeInputs = [];
    if (type === "Producto terminado") {
      var recipeRows = Array.prototype.slice.call(form.querySelectorAll(".recipe-line"));
      for (var i = 0; i < recipeRows.length; i += 1) {
        var skuInput = recipeRows[i].querySelector("select");
        var amountInput = recipeRows[i].querySelector("input");
        var materialId = skuInput.value;
        var amount = Number(amountInput.value) || 0;
        if (!materialId && !amount) continue;
        if (!materialId || amount <= 0) return toast("Completa el material y su cantidad", "Cada renglón de la receta necesita ambos datos. También puedes quitarlo.");
        var material = state.inventory.find(function (item) { return item.id === materialId && (item.type === "Materia prima" || item.type === "Insumo"); });
        if (!material) return toast("Elige una materia prima o un insumo", "Los productos terminados no se pueden usar como material de la receta.");
        var existingLine = recipeInputs.find(function (line) { return line.sku === material.sku; });
        if (existingLine) existingLine.amount += amount;
        else recipeInputs.push({ sku: material.sku, amount: amount });
      }
    }
    var product = Object.assign({}, existing || {}, {
      id: existing ? existing.id : "p" + Date.now(), sku: existing ? existing.sku : "REF-" + Date.now().toString().slice(-6), name: name,
      type: existing ? existing.type : type, unit: existing ? existing.unit : form.elements.unit.value,
      stock: existing ? existing.stock : Number(form.elements.stock.value) || 0,
      min: Number(form.elements.min.value) || 0, cost: Number(form.elements.cost.value) || 0,
      price: Number(form.elements.price.value) || 0, taxType: form.elements.taxType.value,
      taxRate: Number(form.elements.taxRate.value) || 0, inputs: recipeInputs
    });
    if (existing) state.inventory[state.inventory.findIndex(function (item) { return item.id === existing.id; })] = product;
    else state.inventory.unshift(product);
    addActivity(existing ? "Producto actualizado" : "Producto agregado", product.name + " · " + product.type, "▦");
    saveState();
    closeModal();
    render();
    toast(existing ? "Producto actualizado" : "Producto guardado", product.name + " ya está en tu inventario.");
  }

  function submitAdjustment(form) {
    var item = state.inventory.find(function (entry) { return entry.id === form.elements.product.value; });
    var quantity = Number(form.elements.quantity.value);
    if (!item || !quantity) return toast("Revisa la cantidad", "Escribe el ajuste que necesitas registrar.");
    if (item.stock + quantity < 0) return toast("El ajuste no puede dejar stock negativo");
    item.stock += quantity;
    addActivity("Existencias ajustadas", item.name + " · " + (quantity > 0 ? "+" : "") + num(quantity, 1) + " " + item.unit + " · " + form.elements.reason.value, "▦");
    saveState();
    closeModal();
    render();
    toast("Existencias actualizadas", "El cambio quedó guardado en este dispositivo.");
  }

  function submitPayment(form) {
    var sale = state.sales.find(function (item) { return item.id === form.elements.sale.value; });
    var amount = Number(form.elements.amount.value);
    var balance = sale ? saleOutstanding(sale) : 0;
    if (!sale) return toast("Elige una factura", "Selecciona la venta a la que corresponde el pago.");
    if (!Number.isFinite(amount) || amount <= 0 || amount > balance) return toast("Revisa el valor recibido", "El pago debe ser mayor que cero y no puede superar el saldo de " + money(balance) + ".");
    if (!Array.isArray(sale.payments)) sale.payments = [];
    sale.payments.push({ id: "pay" + Date.now(), date: form.elements.date.value || today(), amount: amount, method: form.elements.method.value });
    sale.paidDate = form.elements.date.value || today();
    sale.method = form.elements.method.value;
    refreshSaleStatus(sale);
    var remaining = saleOutstanding(sale);
    addActivity(remaining > 0 ? "Abono registrado" : "Factura pagada", sale.number + " · " + money(amount) + (remaining > 0 ? " recibido; saldo " + money(remaining) : " · " + sale.customer), "$");
    saveState();
    closeModal();
    render();
    toast(remaining > 0 ? "Abono guardado" : "Factura pagada", remaining > 0 ? "Queda un saldo de " + money(remaining) + "." : "La factura " + sale.number + " quedó al día.");
  }

  /* Exportación y detalles */
  function exportCsv(filename, rows) {
    var csv = rows.map(function (row) {
      return row.map(function (cell) { return '"' + String(cell == null ? "" : cell).replace(/"/g, '""') + '"'; }).join(",");
    }).join("\r\n");
    var blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    toast("Archivo preparado", "Tu archivo CSV se descargó en el dispositivo.");
  }

  function exportEnvironment() {
    var rows = [["Periodo", "Energia (kWh)", "Agua (m3)", "Combustible (L)", "Produccion (unidades)", "Organicos (kg)", "Aprovechables (kg)", "No aprovechables (kg)", "Peligrosos (kg)", "Reciclado o reutilizado (kg)", "Emisiones estimadas demo (kg CO2e)", "Fuente del factor"]];
    state.environment.slice().sort(function (a, b) { return a.period.localeCompare(b.period); }).forEach(function (record) {
      rows.push([record.period, record.electricityKwh, record.waterM3, record.fuelL, record.productionUnits, record.organicKg, record.recyclableKg, record.nonRecyclableKg, record.hazardousKg, record.recycledKg, Math.round(estimateEmissions(record)), "Factor ilustrativo de demostración; reemplazar por factor oficial"]);
    });
    exportCsv("pyme360-impacto-ambiental.csv", rows);
  }

  function toast(title, detail) {
    if (persistencePending) { deferredToasts.push({ title: title, detail: detail }); return; }
    showToast(title, detail);
  }

  function showToast(title, detail) {
    var region = document.getElementById("toast-region");
    var element = document.createElement("div");
    element.className = "toast";
    element.innerHTML = esc(title) + (detail ? "<small>" + esc(detail) + "</small>" : "");
    region.appendChild(element);
    window.setTimeout(function () { element.remove(); }, 3600);
  }

  function showDetails(action, id) {
    var item;
    var title = "Detalle";
    var body = "";
    if (action === "sale-detail") {
      item = state.sales.find(function (entry) { return entry.id === id; });
      if (!item) return;
      title = "Venta " + item.number;
      var saleLines = (item.lines || []).map(function (line) {
        var product = state.inventory.find(function (entry) { return entry.sku === line.sku; });
        return '<li>' + esc(product ? product.name : line.sku) + ' · ' + num(line.quantity, 2) + ' unidades' + (line.unitPrice != null ? ' · ' + money(line.unitPrice) + ' c/u · IVA ' + num(line.taxRate || 0, 1) + '%' : '') + '</li>';
      }).join("");
      var paymentHistory = (item.payments || []).map(function (payment) { return '<li>' + dateLabel(payment.date) + ' · ' + money(payment.amount) + ' · ' + esc(payment.method || "Otro") + '</li>'; }).join("");
      body = '<p><strong>Cliente:</strong> ' + esc(item.customer) + '</p><p><strong>Fecha:</strong> ' + dateLabel(item.date) + '</p><p><strong>Productos:</strong></p><ul>' + (saleLines || '<li>Sin detalle de productos</li>') + '</ul><p><strong>Total:</strong> ' + money(item.total) + '</p><p><strong>Recibido:</strong> ' + money(salePaidAmount(item)) + '</p><p><strong>Saldo:</strong> ' + money(saleOutstanding(item)) + '</p><p><strong>Estado de pago:</strong> ' + statusBadge(item.status) + '</p><p><strong>Seguimiento de factura:</strong> ' + statusBadge(item.invoiceFollowUpStatus || "Por revisar", (item.invoiceFollowUpStatus || "Por revisar") === "Por revisar" ? "pending" : "neutral") + '</p>' + (item.externalInvoiceNumber ? '<p><strong>Documento externo:</strong> ' + esc(item.externalInvoiceNumber) + (item.externalInvoiceDate ? ' · ' + dateLabel(item.externalInvoiceDate) : '') + '</p>' : '') + '<p><strong>Condición de pago:</strong> ' + esc(item.payment || "Contado") + '</p>' + (paymentHistory ? '<p><strong>Pagos registrados:</strong></p><ul>' + paymentHistory + '</ul>' : '') + '<p class="form-note">Este seguimiento es manual. Pyme360 no ha transmitido documentos a la DIAN.</p>';
    } else if (action === "purchase-detail") {
      item = state.purchases.find(function (entry) { return entry.id === id; });
      if (!item) return;
      title = "Compra " + item.number;
      var purchaseDetails = purchaseLines(item).map(function (line) { var product = state.inventory.find(function (entry) { return entry.sku === line.sku; }); return '<li>' + esc(product ? product.name : line.sku) + ' · ' + num(line.quantity, 2) + ' · ' + money(line.total) + '</li>'; }).join("");
      body = '<p><strong>Proveedor:</strong> ' + esc(item.supplier) + '</p><p><strong>Productos:</strong></p><ul>' + (purchaseDetails || '<li>' + esc(item.detail || "Sin detalle") + '</li>') + '</ul><p><strong>Fecha:</strong> ' + dateLabel(item.date) + '</p><p><strong>Total:</strong> ' + money(item.total) + '</p><p><strong>Estado:</strong> ' + esc(item.status) + '</p>' + (item.inventoryApplied === false ? '<p class="form-note">Registro importado sin movimiento de inventario.</p>' : '');
    } else if (action === "production-detail") {
      item = state.production.find(function (entry) { return entry.id === id; });
      if (!item) return;
      title = "Orden " + item.number;
      body = '<p><strong>Producto:</strong> ' + esc(item.product) + '</p><p><strong>Cantidad planeada:</strong> ' + num(item.quantity) + ' unidades</p><p><strong>Desperdicio informado:</strong> ' + num(item.wasteKg, 1) + ' kg</p><p><strong>Estado:</strong> ' + esc(item.status) + '</p>' + (item.inventoryApplied === false ? '<p class="form-note">Esta orden se importó y no modificó las existencias al cargarse.</p>' : '') + (item.status === "En proceso" && item.inventoryApplied !== false ? '<div class="modal-footer"><button class="button button-primary" data-action="production-complete" data-id="' + esc(item.id) + '">Marcar como terminada</button></div>' : (item.status === "Terminada" ? '<p class="form-note">La orden está cerrada. Sus unidades y residuos ya se reflejan en inventario e impacto ambiental.</p>' : ''));
    } else if (action === "contact-detail") {
      item = state.contacts.find(function (entry) { return entry.id === id; });
      if (!item) return;
      title = item.name || (item.ordinaryCustomer ? "Cliente de mostrador" : "Contacto");
      body = '<p><strong>Tipo:</strong> ' + esc(item.role) + '</p>' + (item.role.indexOf("Cliente") >= 0 ? '<p><strong>Clasificación comercial:</strong> ' + (item.ordinaryCustomer ? "Cliente ordinario" : "Sin marcar como ordinario") + '</p>' : '') + '<p><strong>Identificación:</strong> ' + esc(item.idNumber || "Sin registrar") + '</p><p><strong>Correo:</strong> ' + esc(item.email || "Sin registrar") + '</p><p><strong>Teléfono:</strong> ' + esc(item.phone || "Sin registrar") + '</p>';
    }
    var footer = action === "contact-detail" ? '<div class="modal-footer"><button class="button button-secondary" data-action="close-modal">Cerrar</button><button class="button button-secondary" data-action="contact-edit" data-id="' + esc(item.id) + '">Editar</button><button class="button button-danger" data-action="contact-delete" data-id="' + esc(item.id) + '">Eliminar</button></div>' : action === "sale-detail" ? '<div class="modal-footer"><button class="button button-secondary" data-action="close-modal">Cerrar</button><button class="button button-secondary" data-action="sale-edit" data-id="' + esc(item.id) + '">Editar</button><button class="button button-danger" data-action="sale-delete" data-id="' + esc(item.id) + '">Eliminar</button></div>' : action === "purchase-detail" ? '<div class="modal-footer"><button class="button button-secondary" data-action="close-modal">Cerrar</button><button class="button button-secondary" data-action="purchase-edit" data-id="' + esc(item.id) + '">Editar</button><button class="button button-danger" data-action="purchase-delete" data-id="' + esc(item.id) + '">Eliminar</button></div>' : action === "production-detail" && item.status === "En proceso" ? '<div class="modal-footer"><button class="button button-secondary" data-action="close-modal">Cerrar</button>' + (item.inventoryApplied === false ? '<button class="button button-danger" data-action="production-delete" data-id="' + esc(item.id) + '">Quitar registro</button>' : '<button class="button button-secondary" data-action="production-edit" data-id="' + esc(item.id) + '">Editar</button><button class="button button-danger" data-action="production-delete" data-id="' + esc(item.id) + '">Cancelar orden</button>') + '</div>' : '<div class="modal-footer"><button class="button button-primary" data-action="close-modal">Listo</button></div>';
    openModal(title, "Información de tu empresa en este computador.", '<div class="modal-form">' + body + footer + '</div>');
  }

  function confirmDeleteSale(id) {
    var sale = state.sales.find(function (item) { return item.id === id; });
    if (!sale) return toast("No encontramos esa venta");
    var inventoryEffect = sale.inventoryApplied === false ? "Esta venta se importó sin movimiento de inventario, por eso las existencias no cambiarán." : "Las unidades vendidas volverán al inventario.";
    openModal("Eliminar venta " + sale.number, "Confirma antes de quitar este registro.", '<div class="modal-form"><p>¿Quieres eliminar la venta de <strong>' + esc(sale.customer) + '</strong> por <strong>' + money(sale.total) + '</strong>?</p><p class="form-note">' + inventoryEffect + ' Los totales financieros cambiarán y se quitarán los datos de pago asociados. Esta demostración no transmite documentos a la DIAN.</p><div class="modal-footer"><button class="button button-secondary" data-action="close-modal">Cancelar</button><button class="button button-danger" data-action="sale-delete-confirm" data-id="' + esc(sale.id) + '">Sí, eliminar</button></div></div>');
  }

  function deleteSale(id) {
    var sale = state.sales.find(function (item) { return item.id === id; });
    if (!sale) return toast("No encontramos esa venta");
    if (sale.inventoryApplied !== false) (sale.lines || []).forEach(function (line) {
      var product = state.inventory.find(function (item) { return item.sku === line.sku; });
      if (product) product.stock += Number(line.quantity) || 0;
    });
    state.sales = state.sales.filter(function (item) { return item.id !== id; });
    addActivity("Venta eliminada", sale.number + " · " + sale.customer, "↗");
    saveState();
    closeModal();
    render();
    toast("Venta eliminada", sale.inventoryApplied === false ? "Se actualizaron las finanzas; las existencias no cambiaron." : "Las unidades asociadas volvieron al inventario.");
  }

  function purchaseCanReverse(purchase) {
    if (purchase.inventoryApplied === false || purchase.status === "Por recibir") return true;
    var quantities = {};
    purchaseLines(purchase).forEach(function (line) { quantities[line.sku] = (quantities[line.sku] || 0) + (Number(line.quantity) || 0); });
    return Object.keys(quantities).every(function (sku) {
      var product = state.inventory.find(function (item) { return item.sku === sku; });
      return !!product && Number(product.stock) >= quantities[sku];
    });
  }

  function confirmDeletePurchase(id) {
    var purchase = state.purchases.find(function (item) { return item.id === id; });
    if (!purchase) return toast("No encontramos esa compra");
    if (!purchaseCanReverse(purchase)) return toast("No se puede eliminar esta compra", "Parte de lo recibido ya se usó o el producto ya no existe. Revisa los movimientos antes de quitarla.");
    var effect = purchase.inventoryApplied === false || purchase.status === "Por recibir" ? "No hay existencias asociadas que deban revertirse." : "Se restarán del inventario las unidades registradas en esta recepción.";
    openModal("Eliminar compra " + purchase.number, "Confirma antes de quitar este registro.", '<div class="modal-form"><p>¿Quieres eliminar la compra de <strong>' + esc(purchase.supplier) + '</strong> por <strong>' + money(purchase.total) + '</strong>?</p><p class="form-note">' + effect + ' El registro dejará de aparecer en compras y en los saldos asociados.</p><div class="modal-footer"><button class="button button-secondary" data-action="close-modal">Cancelar</button><button class="button button-danger" data-action="purchase-delete-confirm" data-id="' + esc(purchase.id) + '">Sí, eliminar</button></div></div>');
  }

  function deletePurchase(id) {
    var purchase = state.purchases.find(function (item) { return item.id === id; });
    if (!purchase) return toast("No encontramos esa compra");
    if (!purchaseCanReverse(purchase)) return toast("No se puede eliminar", "Revisa primero el inventario relacionado.");
    if (purchase.inventoryApplied !== false && purchase.status !== "Por recibir") {
      purchaseLines(purchase).forEach(function (line) {
        var product = state.inventory.find(function (item) { return item.sku === line.sku; });
        if (product) product.stock -= Number(line.quantity) || 0;
      });
    }
    state.purchases = state.purchases.filter(function (item) { return item.id !== id; });
    addActivity("Compra eliminada", purchase.number + " · " + purchase.supplier, "↙");
    saveState(); closeModal(); render();
    toast("Compra eliminada", "El inventario relacionado quedó actualizado.");
  }

  function productRemovalBlock(product) {
    if (Number(product.stock) > 0) return "Aún hay existencias de este producto. Ajusta el stock a cero antes de eliminarlo.";
    if (state.sales.some(function (sale) { return (sale.lines || []).some(function (line) { return line.sku === product.sku; }); })) return "Este producto aparece en ventas. Conserva el registro para mantener el historial.";
    if (state.purchases.some(function (purchase) { return purchaseLines(purchase).some(function (line) { return line.sku === product.sku; }); })) return "Este producto aparece en compras. Conserva el registro para mantener el historial.";
    if (state.production.some(function (order) { return order.productId === product.id || (order.inputConsumption || []).some(function (line) { return line.sku === product.sku; }); })) return "Este producto aparece en órdenes de producción. Conserva el registro para mantener el historial.";
    if (state.inventory.some(function (item) { return (item.inputs || []).some(function (line) { return line.sku === product.sku; }); })) return "Este material forma parte de una receta. Actualiza primero la receta del producto terminado.";
    return "";
  }

  function confirmDeleteProduct(id) {
    var product = state.inventory.find(function (item) { return item.id === id; });
    if (!product) return toast("No encontramos ese producto");
    var blocked = productRemovalBlock(product);
    if (blocked) return toast("No se puede eliminar", blocked);
    openModal("Eliminar producto", "Confirma antes de quitarlo del inventario.", '<div class="modal-form"><p>¿Quieres eliminar <strong>' + esc(product.name) + '</strong> (' + esc(product.sku) + ')?</p><p class="form-note">Solo se pueden eliminar referencias sin existencias ni operaciones relacionadas.</p><div class="modal-footer"><button class="button button-secondary" data-action="close-modal">Cancelar</button><button class="button button-danger" data-action="product-delete-confirm" data-id="' + esc(product.id) + '">Sí, eliminar</button></div></div>');
  }

  function deleteProduct(id) {
    var product = state.inventory.find(function (item) { return item.id === id; });
    if (!product) return toast("No encontramos ese producto");
    var blocked = productRemovalBlock(product);
    if (blocked) return toast("No se puede eliminar", blocked);
    state.inventory = state.inventory.filter(function (item) { return item.id !== id; });
    addActivity("Producto eliminado", product.name + " · " + product.sku, "▦");
    saveState(); closeModal(); render(); toast("Producto eliminado", "La referencia se quitó del inventario.");
  }

  function confirmDeleteProduction(id) {
    var order = state.production.find(function (item) { return item.id === id; });
    if (!order || order.status !== "En proceso") return toast("Esta orden ya no se puede cancelar", "Las órdenes terminadas conservan su historial.");
    if (order.inventoryApplied !== false && (order.inputConsumption || []).some(function (line) { return !state.inventory.some(function (item) { return item.sku === line.sku; }); })) return toast("No se puede cancelar esta orden", "No se encontraron todos los materiales que se reservaron.");
    var effect = order.inventoryApplied === false ? "Como se importó sin movimientos, el inventario no cambiará." : "Los materiales reservados volverán a estar disponibles.";
    openModal("Cancelar orden " + order.number, "Solo puedes cancelar órdenes que siguen en proceso.", '<div class="modal-form"><p>¿Quieres cancelar la fabricación de <strong>' + esc(order.product) + '</strong> (' + num(order.quantity) + ' unidades)?</p><p class="form-note">' + effect + ' Las órdenes terminadas no se pueden borrar porque ya afectan inventario e impacto ambiental.</p><div class="modal-footer"><button class="button button-secondary" data-action="close-modal">Seguir con la orden</button><button class="button button-danger" data-action="production-delete-confirm" data-id="' + esc(order.id) + '">Sí, cancelar</button></div></div>');
  }

  function deleteProduction(id) {
    var order = state.production.find(function (item) { return item.id === id; });
    if (!order || order.status !== "En proceso") return toast("Esta orden ya no se puede cancelar");
    if (order.inventoryApplied !== false) (order.inputConsumption || []).forEach(function (line) {
      var material = state.inventory.find(function (item) { return item.sku === line.sku; });
      if (material) material.stock += Number(line.quantity) || 0;
    });
    state.production = state.production.filter(function (item) { return item.id !== id; });
    addActivity("Orden de producción cancelada", order.number + " · " + order.product, "⚙");
    saveState(); closeModal(); render();
    toast("Orden cancelada", order.inventoryApplied === false ? "Se quitó el registro importado; las existencias no cambiaron." : "Los materiales reservados regresaron al inventario.");
  }

  function confirmDeleteContact(id) {
    var contact = state.contacts.find(function (item) { return item.id === id; });
    if (!contact) return toast("No encontramos ese contacto");
    var name = contact.name || (contact.ordinaryCustomer ? "Cliente de mostrador" : "este contacto");
    openModal("Eliminar contacto", "Confirma antes de quitarlo de tu lista.", '<div class="modal-form"><p>¿Quieres eliminar a <strong>' + esc(name) + '</strong>?</p><p class="form-note">El contacto dejará de aparecer en tus listas. Las ventas y compras anteriores conservarán el nombre que tenían al registrarse.</p><div class="modal-footer"><button class="button button-secondary" data-action="close-modal">Cancelar</button><button class="button button-danger" data-action="contact-delete-confirm" data-id="' + esc(contact.id) + '">Sí, eliminar</button></div></div>');
  }

  function deleteContact(id) {
    var contact = state.contacts.find(function (item) { return item.id === id; });
    if (!contact) return toast("No encontramos ese contacto");
    var name = contact.name || (contact.ordinaryCustomer ? "Cliente de mostrador" : "Contacto");
    state.contacts = state.contacts.filter(function (item) { return item.id !== id; });
    addActivity("Contacto eliminado", name, "♙");
    saveState();
    closeModal();
    render();
    toast("Contacto eliminado", "Las operaciones anteriores conservaron su información.");
  }

  /* Eventos globales */
  function readOnlyClickAllowed(target) {
    if (!target) return false;
    if (target.closest("[data-page]") || target.id === "dismiss-banner") return true;
    var actionButton = target.closest("[data-action]");
    if (!actionButton) return false;
    return [
      "state-reload", "theme-toggle", "sidebar-toggle", "help", "notifications", "profile", "close-modal",
      "excel-download-master", "excel-download-template", "backup-download", "environment-export", "inventory-export", "finance-export",
      "sale-detail", "purchase-detail", "production-detail", "contact-detail"
    ].indexOf(actionButton.getAttribute("data-action")) >= 0;
  }

  document.addEventListener("click", function (event) {
    var target = event.target instanceof Element ? event.target : event.target && event.target.parentElement;
    var reloadAction = target && target.closest('[data-action="state-reload"]');
    if (persistencePending || (persistenceBlocked && !reloadAction) || (!persistenceReady && !(readOnlyMode && readOnlyClickAllowed(target)))) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  document.addEventListener("submit", function (event) {
    if (persistencePending || !persistenceReady || persistenceBlocked) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  document.addEventListener("click", function (event) {
    var pageButton = event.target.closest("[data-page]");
    if (pageButton) {
      event.preventDefault();
      setPage(pageButton.getAttribute("data-page"));
      return;
    }
    var button = event.target.closest("[data-action]");
    if (!button) return;
    var action = button.getAttribute("data-action");
    if (action === "new-sale") openSaleModal();
    else if (action === "sale-edit") openSaleModal(button.getAttribute("data-id"));
    else if (action === "sale-delete") confirmDeleteSale(button.getAttribute("data-id"));
    else if (action === "sale-delete-confirm") deleteSale(button.getAttribute("data-id"));
    else if (action === "sale-add-line") addSaleLine();
    else if (action === "sale-remove-line") removeSaleLine(button);
    else if (action === "new-product") openProductModal();
    else if (action === "product-edit") openProductModal(button.getAttribute("data-id"));
    else if (action === "product-delete") confirmDeleteProduct(button.getAttribute("data-id"));
    else if (action === "product-delete-confirm") deleteProduct(button.getAttribute("data-id"));
    else if (action === "new-production") openProductionModal();
    else if (action === "production-edit") openProductionModal(button.getAttribute("data-id"));
    else if (action === "production-delete") confirmDeleteProduction(button.getAttribute("data-id"));
    else if (action === "production-delete-confirm") deleteProduction(button.getAttribute("data-id"));
    else if (action === "new-environment" || action === "environment-edit") openEnvironmentModal();
    else if (action === "environment-set-target") openEnvironmentTargetsModal();
    else if (action === "environment-retry-reference") loadPublicBenchmark(true);
    else if (action === "environment-pick-receipt") {
      var receiptInput = document.getElementById("environment-receipt-file");
      if (receiptInput) receiptInput.click();
    }
    else if (action === "environment-example") openEnvironmentExample();
    else if (action === "environment-manual") openManualEnvironmentModal();
    else if (action === "new-purchase") openPurchaseModal();
    else if (action === "purchase-edit") openPurchaseModal(button.getAttribute("data-id"));
    else if (action === "purchase-delete") confirmDeletePurchase(button.getAttribute("data-id"));
    else if (action === "purchase-delete-confirm") deletePurchase(button.getAttribute("data-id"));
    else if (action === "purchase-add-line") addPurchaseLine();
    else if (action === "purchase-remove-line") removePurchaseLine(button);
    else if (action === "new-contact") openContactModal();
    else if (action === "contact-edit") openContactModal(button.getAttribute("data-id"));
    else if (action === "contact-delete") confirmDeleteContact(button.getAttribute("data-id"));
    else if (action === "contact-delete-confirm") deleteContact(button.getAttribute("data-id"));
    else if (action === "recipe-add-line") addRecipeLine();
    else if (action === "recipe-remove-line") removeRecipeLine(button);
    else if (action === "new-adjustment") openAdjustmentModal();
    else if (action === "new-payment") openPaymentModal();
    else if (action === "setup") openSetupModal();
    else if (action === "theme-toggle") setTheme(currentTheme === "dark" ? "light" : "dark");
    else if (action === "sidebar-toggle") setSidebarCollapsed(!sidebarCollapsed);
    else if (action === "production-complete") completeProduction(button.getAttribute("data-id"));
    else if (action === "close-modal") closeModal();
    else if (action.indexOf("-detail") >= 0) showDetails(action, button.getAttribute("data-id"));
    else if (action === "environment-export") exportEnvironment();
    else if (action === "excel-download-master") {
      try { window.Pyme360Excel.downloadMaster(state); toast("Excel maestro preparado", "El archivo se descargó en este dispositivo."); }
      catch (error) { toast("No se pudo descargar el Excel", error.message || "Recarga la página e inténtalo de nuevo."); }
    }
    else if (action === "excel-download-template") {
      try { window.Pyme360Excel.downloadTemplate(); toast("Plantilla descargada", "Completa las hojas y luego impórtala desde Datos y Excel."); }
      catch (error) { toast("No se pudo descargar la plantilla", error.message || "Recarga la página e inténtalo de nuevo."); }
    }
    else if (action === "excel-select-file") {
      var fileInput = document.getElementById("excel-import-file");
      if (fileInput) fileInput.click();
    }
    else if (action === "excel-cancel-import") { importSession = null; render(); }
    else if (action === "excel-confirm-import") commitExcelImport();
    else if (action === "backup-download") downloadBackup();
    else if (action === "backup-select-file") { var backupInput = document.getElementById("backup-restore-file"); if (backupInput) backupInput.click(); }
    else if (action === "backup-cancel-restore") { backupSession = null; closeModal(); }
    else if (action === "backup-confirm-restore") confirmBackupRestore();
    else if (action === "state-reload") window.location.reload();
    else if (action === "inventory-export") exportCsv("pyme360-inventario.csv", [["SKU", "Producto", "Tipo", "Existencia", "Unidad", "Minimo", "Costo unitario"]].concat(state.inventory.map(function (item) { return [item.sku, item.name, item.type, item.stock, item.unit, item.min, item.cost]; })));
    else if (action === "finance-export") exportCsv("pyme360-movimientos.csv", [["Documento", "Fecha", "Contacto", "Total COP", "Estado"]].concat(state.sales.map(function (sale) { return [sale.number, sale.date, sale.customer, sale.total, sale.status]; })));
    else if (action === "help") openModal("Ayuda Pyme360", "Una guía breve para empezar.", '<div class="modal-form"><p><strong>1. Registra tus contactos.</strong> Así tendrás a mano clientes y proveedores.</p><p><strong>2. Ajusta tus existencias.</strong> Carga productos, materias primas e insumos.</p><p><strong>3. Usa los atajos.</strong> Registra ventas, producción y datos ambientales desde el menú.</p><p class="form-note">' + (readOnlyMode ? "Esta pestaña está en modo de solo lectura. Descarga un respaldo en Datos y Excel y luego ábrelo desde el lanzador para restaurarlo en SQLite." : "Tus datos de negocio quedan en la base SQLite local de este computador. La consulta pública ODS 7.3.1 de la ONU no recibe información de tu empresa.") + '</p><div class="modal-footer"><button class="button button-primary" data-action="close-modal">Entendido</button></div></div>');
    else if (action === "profile") toast("Perfil de administrador", "La gestión de usuarios estará disponible en la versión conectada.");
    else if (action === "notifications") toast("Sin notificaciones nuevas", "Te avisaremos cuando haya algo que revisar.");
  });

  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (!form.id) return;
    event.preventDefault();
    if (form.id === "sale-form") submitSale(form);
    else if (form.id === "production-form") submitProduction(form);
    else if (form.id === "environment-form") submitEnvironment(form);
    else if (form.id === "environment-target-form") submitEnvironmentTargets(form);
    else if (form.id === "receipt-review-form") submitReceiptReview(form);
    else if (form.id === "purchase-form") submitPurchase(form);
    else if (form.id === "contact-form") submitContact(form);
    else if (form.id === "setup-form") submitSetup(form);
    else if (form.id === "adjust-form") submitAdjustment(form);
    else if (form.id === "payment-form") submitPayment(form);
    else if (form.id === "product-form") submitProduct(form);
  });

  document.addEventListener("input", function (event) {
    var filter = event.target.getAttribute("data-filter");
    if (!filter) {
      if (event.target.closest("#sale-form")) updateSalePreview();
      if (event.target.closest("#production-form")) updateProductionPreview();
      return;
    }
    var query = event.target.value.trim().toLocaleLowerCase("es-CO");
    var selector = filter === "sales" ? "#sales-rows tr" : filter === "inventory" ? "#inventory-rows tr" : "#contact-rows tr";
    document.querySelectorAll(selector).forEach(function (row) {
      row.classList.toggle("hidden", query && !row.textContent.toLocaleLowerCase("es-CO").includes(query));
    });
  });

  document.addEventListener("change", function (event) {
    if (event.target.id === "contact-kind") {
      var classificationField = document.getElementById("contact-ordinary-field");
      var ordinaryCheckbox = document.getElementById("contact-ordinary");
      if (classificationField && ordinaryCheckbox) {
        var hasCustomerRole = event.target.value.indexOf("Cliente") >= 0;
        var wasVisible = classificationField.getAttribute("data-customer-visible") === "true";
        classificationField.classList.toggle("hidden", !hasCustomerRole);
        if (!hasCustomerRole) ordinaryCheckbox.checked = false;
        else if (!wasVisible) ordinaryCheckbox.checked = true;
        classificationField.setAttribute("data-customer-visible", String(hasCustomerRole));
        syncContactNameRequirement(document.getElementById("contact-form"));
      }
    } else if (event.target.id === "contact-ordinary") {
      syncContactNameRequirement(document.getElementById("contact-form"));
    } else if (event.target.id === "environment-receipt-file") {
      var receiptFile = event.target.files && event.target.files[0];
      if (receiptFile) processEnvironmentReceipt(receiptFile);
      event.target.value = "";
    } else if (event.target.id === "receipt-type") {
      var unit = document.getElementById("receipt-unit");
      if (unit) unit.value = event.target.value === "water" ? "m³" : "kWh";
      if (receiptSession && receiptSession.type !== event.target.value) {
        receiptSession.type = event.target.value;
        receiptSession.consumption = "";
        receiptSession.confidence = 0;
        receiptSession.sourceLabel = "Recibo revisado manualmente";
        receiptSession.method = "corrección manual";
        receiptSession.warnings = receiptSession.warnings || [];
        if (receiptSession.warnings.indexOf("Cambiaste el tipo de servicio. Escribe y confirma el consumo en la unidad seleccionada.") < 0) receiptSession.warnings.push("Cambiaste el tipo de servicio. Escribe y confirma el consumo en la unidad seleccionada.");
        var amountInput = document.getElementById("receipt-consumption");
        if (amountInput) amountInput.value = "";
      }
    } else if (event.target.id === "excel-import-file") {
      var selectedFile = event.target.files && event.target.files[0];
      if (selectedFile) startExcelImport(selectedFile);
      event.target.value = "";
    } else if (event.target.id === "backup-restore-file") {
      var backupFile = event.target.files && event.target.files[0];
      if (backupFile) startBackupRestore(backupFile);
      event.target.value = "";
    } else if (event.target.id === "payment-sale") {
      updatePaymentBalance();
    } else if (event.target.matches("[data-excel-entity]")) {
      var entitySheet = importSession && importSession.sheets[Number(event.target.getAttribute("data-excel-sheet"))];
      if (entitySheet) {
        importSession.openSheet = Number(event.target.getAttribute("data-excel-sheet"));
        configureImportSheet(importSession.openSheet, event.target.value, entitySheet.config.headerRow);
      }
      render();
    } else if (event.target.matches("[data-excel-header]")) {
      var headerSheetIndex = Number(event.target.getAttribute("data-excel-sheet"));
      var headerSheet = importSession && importSession.sheets[headerSheetIndex];
      if (headerSheet) {
        importSession.openSheet = headerSheetIndex;
        configureImportSheet(headerSheetIndex, headerSheet.config.entity, Number(event.target.value));
      }
      render();
    } else if (event.target.matches("[data-excel-map-field]")) {
      var mapSheetIndex = Number(event.target.getAttribute("data-excel-sheet"));
      var mapSheet = importSession && importSession.sheets[mapSheetIndex];
      if (mapSheet) {
        importSession.openSheet = mapSheetIndex;
        var fieldKey = event.target.getAttribute("data-excel-map-field");
        if (event.target.value === "") delete mapSheet.config.mapping[fieldKey];
        else mapSheet.config.mapping[fieldKey] = Number(event.target.value);
      }
      render();
    } else if (event.target.id === "excel-update-duplicates") {
      if (importSession) importSession.updateDuplicates = event.target.checked;
      render();
    } else if (event.target.id === "sales-status") {
      var status = event.target.value;
      document.querySelectorAll("#sales-rows tr").forEach(function (row) {
        row.classList.toggle("hidden", status !== "Todas" && !row.textContent.includes(status));
      });
    } else if (event.target.id === "inventory-type") {
      var type = event.target.value;
      document.querySelectorAll("#inventory-rows tr").forEach(function (row) {
        row.classList.toggle("hidden", type !== "Todos" && !row.textContent.includes(type));
      });
    } else if (event.target.id === "contact-role") {
      var role = event.target.value;
      document.querySelectorAll("#contact-rows tr").forEach(function (row) {
        row.classList.toggle("hidden", role !== "Todos" && !row.textContent.includes(role));
      });
    } else if (event.target.id === "environment-period") {
      currentPeriod = event.target.value;
      render();
    }
  });

  document.getElementById("mobile-menu").addEventListener("click", function () {
    document.getElementById("sidebar").classList.toggle("open");
  });
  document.getElementById("dismiss-banner").addEventListener("click", function () {
    document.querySelector(".demo-banner").classList.add("hidden");
  });

  return {
    init: function () {
      setTheme(currentTheme);
      setSidebarCollapsed(sidebarCollapsed);
      setPersistenceStatus("Conectando…", "saving");
      render();
      initializeLocalState().then(function () {
        if (persistenceReady && currentPage === "environment") loadPublicBenchmark(false);
      });
    }
  };
})();
