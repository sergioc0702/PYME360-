import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  addContact,
  addProduct,
  deleteContact,
  deleteResourceReading,
  saveResourceReading,
  saveEmissionFactor,
  deleteEmissionFactor,
  saveIndicatorTarget,
  deleteIndicatorTarget,
  addEnvironmentalAction,
  completeEnvironmentalAction,
  deleteEnvironmentalAction,
  deleteProduct,
  reconcileInventoryCount,
  addSalePayment,
  addPurchasePayment,
  addFinancialAccount,
  addManualCashMovement,
  confirmLegacyPurchasePayable,
  activateRecipeVersion,
  cancelProductionOrder,
  completeProductionOrder,
  createProductionOrder,
  createPurchase,
  createSale,
  deletePurchase,
  deleteSale,
  saveCompany,
  saveRecipeVersion,
  saveEnvironmentalConfig,
  saveTaxConfiguration,
  prepareElectronicInvoice,
  prepareElectronicAdjustmentNote,
  addSupplierInvoiceDocument,
  outstandingBalance,
  updateContact,
  updateProduct,
  updatePurchase,
  createEmptyState,
} from "../domain/business";
import { DEFAULT_SITE_ID } from "../domain/environmental";
import type {
  AppState,
  Contact,
  ReceiptExtraction,
  ReceiptImport,
  Product,
  Purchase,
  Sale,
  TaxConfiguration,
  SupplierInvoiceDocument,
} from "../domain/types";
import { clearSession, initializeAuth, type AuthUser, type AuthStatus } from "../infrastructure/auth";
import { loadState, parseBackup, saveState, StateConflictError } from "../infrastructure/storage";
import { extractReceipt } from "../features/environment/consumption";
import {
  PAGE_TITLES,
  NAV_GROUPS,
  THEME_STORAGE_KEY,
  applyTheme,
  errorMessage,
  getInitialTheme,
  OverviewPage,
  ContactsPage,
  InventoryPage,
  SalesPage,
  PurchasesPage,
  ProductionPage,
  DataPage,
  FinancePage,
  AuditPage,
  LoginScreen,
  UsersModal,
  NavIcon,
} from "./AppViews";
import { EnvironmentPage } from "./screens/EnvironmentView";
import { ElectronicInvoicingPanel } from "./screens/ElectronicInvoicing";
import { CloudSyncPanel } from "./screens/CloudSyncPanel";
import {
  getCloudSyncStatus,
  synchronizeNow,
  type CloudSyncStatus,
} from "../features/synchronization/sync";
import { BrandLogo } from "../shared/BrandLogo";
import type { Page, Theme, ModalState } from "./AppViews";
import {
  CompanyForm,
  ContactForm,
  ProductForm,
  RecipeForm,
  SaleForm,
  PurchaseForm,
  ProductionForm,
  ResourceReadingForm,
  ReceiptReviewForm,
  EnvironmentalConfigForm,
  IndicatorTargetForm,
  EmissionFactorForm,
  EnvironmentalActionForm,
  PaymentForm,
  StockForm,
  CompleteProductionForm,
  FinancialAccountForm,
  ManualCashMovementForm,
  PurchasePaymentForm,
  LegacyPayableReviewForm,
} from "./AppForms";

function Workspace({
  user,
  onLogout,
  theme,
  onThemeChange,
}: {
  user: AuthUser;
  onLogout: () => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}) {
  const themeOptions: Array<{ value: Theme; label: string }> = [
    { value: "system", label: "Sistema" },
    { value: "light", label: "Claro" },
    { value: "dark", label: "Oscuro" },
  ];
  const isAdmin = user.role === "admin";
  const canEdit = user.role === "admin" || user.role === "operator";
  const [state, setState] = useState<AppState>(createEmptyState);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [legacyReadOnly, setLegacyReadOnly] = useState(false);
  const [syncStatus, setSyncStatus] = useState<CloudSyncStatus | null>(null);
  const [syncPanelOpen, setSyncPanelOpen] = useState(false);
  const [storageStatus, setStorageStatus] = useState<"loading" | "ready" | "saving" | "error">(
    "loading",
  );
  const revision = useRef(0);
  const saveInProgress = useRef(false);
  const [page, setPage] = useState<Page>("overview");
  const [productionSection, setProductionSection] = useState<"orders" | "recipes">("orders");
  const [selectedRecipeProductId, setSelectedRecipeProductId] = useState<string>();
  const [expandedNavGroups, setExpandedNavGroups] = useState<Set<string>>(() => new Set());
  const [salesSection, setSalesSection] = useState<"sales" | "documents">("sales");
  const navCollapsed = true;
  const [isMobileViewport, setIsMobileViewport] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.("(max-width: 760px)").matches === true,
  );
  const [sidebarTooltip, setSidebarTooltip] = useState<{
    label: string;
    top: number;
    left: number;
  } | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const profileTriggerRef = useRef<HTMLButtonElement | null>(null);
  const profilePanelRef = useRef<HTMLElement | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [toast, setToast] = useState<{ message: string; error: boolean }>({
    message: "",
    error: false,
  });

  function notify(message: string, error = false) {
    setToast({ message, error });
    window.setTimeout(() => setToast({ message: "", error: false }), 4200);
  }

  function showSidebarTooltip(target: HTMLElement, label: string) {
    if (!navCollapsed || isMobileViewport) return;
    const bounds = target.getBoundingClientRect();
    setSidebarTooltip({
      label,
      top: bounds.top + bounds.height / 2,
      left: Math.max(8, Math.min(bounds.right + 10, window.innerWidth - 300)),
    });
  }

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mediaQuery = window.matchMedia("(max-width: 760px)");
    const updateViewport = () => setIsMobileViewport(mediaQuery.matches);
    mediaQuery.addEventListener("change", updateViewport);
    return () => mediaQuery.removeEventListener("change", updateViewport);
  }, []);

  async function refreshSyncStatus() {
    try {
      const next = await getCloudSyncStatus();
      setSyncStatus(next);
      return next;
    } catch {
      return null;
    }
  }

  async function refreshPersistedState() {
    if (saveInProgress.current) return;
    try {
      const loaded = await loadState();
      setState(loaded.state);
      revision.current = loaded.revision;
      setLegacyReadOnly(loaded.legacyReadOnly);
      setStorageReady(!loaded.legacyReadOnly);
      setStorageStatus(loaded.legacyReadOnly ? "error" : "ready");
      void refreshSyncStatus();
      if (loaded.warning) notify(loaded.warning, true);
    } catch (error) {
      setStorageStatus("error");
      notify(errorMessage(error), true);
    }
  }

  useEffect(() => {
    let active = true;
    void loadState()
      .then((loaded) => {
        if (!active) return;
        setState(loaded.state);
        revision.current = loaded.revision;
        setDataLoaded(true);
        setLegacyReadOnly(loaded.legacyReadOnly);
        setStorageReady(!loaded.legacyReadOnly);
        setStorageStatus(loaded.legacyReadOnly ? "error" : "ready");
        void refreshSyncStatus();
        if (loaded.warning) notify(loaded.warning, true);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setStorageStatus("error");
        notify(errorMessage(error), true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    function handleReconnect() {
      if (!navigator.onLine) return;
      void getCloudSyncStatus()
        .then((current) => {
          setSyncStatus(current);
          if (
            current.configured &&
            current.connectedForCurrentUser &&
            current.pendingBatches > 0 &&
            canEdit
          ) {
            return synchronizeNow().then(setSyncStatus);
          }
          return undefined;
        })
        .catch(() => undefined);
    }
    window.addEventListener("online", handleReconnect);
    return () => window.removeEventListener("online", handleReconnect);
  }, [canEdit]);

  async function commit(next: AppState, message: string, restore = false): Promise<boolean> {
    if (!canEdit) {
      notify("Esta sesión es de solo consulta.", true);
      return false;
    }
    if (!storageReady) {
      notify(
        legacyReadOnly
          ? "Descarga el respaldo de la copia local y ábrelo desde Pyme360 con el lanzador para restaurarlo en SQLite."
          : "Espera a que Pyme360 se conecte a SQLite para guardar cambios.",
        true,
      );
      return false;
    }
    if (saveInProgress.current) {
      notify("Pyme360 está guardando otro cambio. Espera un momento.", true);
      return false;
    }
    saveInProgress.current = true;
    setStorageStatus("saving");
    try {
      revision.current = await saveState(next, revision.current, restore);
      setState(next);
      setModal(null);
      setStorageStatus("ready");
      const currentSync = await refreshSyncStatus();
      notify(message);
      if (currentSync?.configured && currentSync.connectedForCurrentUser && navigator.onLine) {
        void synchronizeNow()
          .then(setSyncStatus)
          .catch(() => refreshSyncStatus());
      }
      return true;
    } catch (error) {
      if (error instanceof StateConflictError && error.latestState) {
        setState(error.latestState.state);
        revision.current = error.latestState.revision;
        setModal(null);
        setStorageStatus("ready");
        notify(
          "Otra pestaña guardó datos más recientes; cargamos esa versión. Revisa el cambio antes de volver a guardarlo.",
          true,
        );
        return false;
      } else {
        setStorageStatus("error");
        notify(errorMessage(error), true);
        return false;
      }
    } finally {
      saveInProgress.current = false;
    }
  }

  function run(operation: () => AppState, message: string) {
    try {
      commit(operation(), message);
    } catch (error) {
      notify(errorMessage(error), true);
    }
  }

  function removeContact(contact: Contact) {
    if (window.confirm(`¿Eliminar a ${contact.name}?`))
      run(() => deleteContact(state, contact.id), "Contacto eliminado.");
  }
  function removeProduct(product: Product) {
    if (
      window.confirm(
        `¿Eliminar ${product.name}? Debe estar sin existencias y sin operaciones relacionadas.`,
      )
    )
      run(() => deleteProduct(state, product.id), "Producto eliminado.");
  }

  function removeReading(readingId: string) {
    if (window.confirm("¿Eliminar esta lectura ambiental?"))
      run(() => deleteResourceReading(state, readingId), "Lectura ambiental eliminada.");
  }

  function importReceipt(file: File) {
    void extractReceipt(file, (label) => notify(label))
      .then(({ extraction, fileHash }) => {
        setModal({ type: "receipt", extraction, fileName: file.name, fileHash });
      })
      .catch((error: unknown) => notify(errorMessage(error), true));
  }

  function saveReceipt(extraction: ReceiptExtraction, fileName: string, fileHash: string) {
    const resource =
      extraction.resource ??
      (extraction.waterM3 ? "water" : extraction.fuelLiters ? "fuel" : "electricity");
    const quantity =
      extraction.quantity ??
      (resource === "water"
        ? (extraction.waterM3 ?? 0)
        : resource === "fuel"
          ? (extraction.fuelLiters ?? 0)
          : (extraction.electricityKwh ?? 0));
    const unit =
      extraction.unit ?? (resource === "water" ? "m³" : resource === "fuel" ? "L" : "kWh");
    if (!extraction.period || !/^\d{4}-(0[1-9]|1[0-2])$/.test(extraction.period)) {
      notify("No se identificó un período mensual válido en el recibo.", true);
      return;
    }
    if (!Number.isFinite(quantity) || quantity < 0) {
      notify("La cantidad extraída no es válida.", true);
      return;
    }
    const accountNumber = state.environmentalConfig?.accountNumber ?? "";
    const duplicate = state.receiptImports.find(
      (item) =>
        item.fileHash === fileHash ||
        (item.provider.toLowerCase() === extraction.provider.toLowerCase() &&
          (item.accountNumber ?? "") === accountNumber &&
          item.extraction.period === extraction.period &&
          (item.extraction.resource ??
            (item.extraction.waterM3
              ? "water"
              : item.extraction.electricityKwh
                ? "electricity"
                : "fuel")) === resource &&
          (!extraction.invoiceNumber ||
            !item.extraction.invoiceNumber ||
            item.extraction.invoiceNumber === extraction.invoiceNumber)),
    );
    if (
      duplicate &&
      !window.confirm(
        `Ya existe un recibo de ${resource} para ${extraction.provider}, cuenta ${accountNumber || "sin número"} y ${extraction.period}. ¿Reemplazar esa importación?`,
      )
    )
      return;
    const { textPreview: _transientPreview, ...confirmedExtraction } = extraction;
    const now = new Date().toISOString();
    const receiptId = duplicate?.id ?? crypto.randomUUID();
    const receipt: ReceiptImport = {
      id: receiptId,
      fileName,
      fileHash,
      importedAt: now,
      status: extraction.warnings.length || extraction.confidence < 0.75 ? "warning" : "confirmed",
      source: "local_receipt",
      provider: extraction.provider,
      accountNumber,
      extraction: { ...confirmedExtraction, resource, quantity, unit },
    };
    const next = structuredClone(state);
    next.resourceReadings = next.resourceReadings.filter(
      (reading) => reading.receiptImportId !== receiptId,
    );
    next.receiptImports = next.receiptImports.filter((item) => item.id !== receiptId);
    next.receiptImports.unshift(receipt);
    const [year, month] = extraction.period.split("-").map(Number);
    const periodStart = `${extraction.period}-01`;
    const periodEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    const environmental = saveResourceReading(next, {
      resource,
      activity: resource === "water" ? "withdrawal" : "consumption",
      quantity,
      unit,
      periodStart,
      periodEnd,
      siteId: DEFAULT_SITE_ID,
      source: "local_receipt",
      quality:
        extraction.warnings.length || extraction.confidence < 0.75 ? "estimated" : "confirmed",
      sourceLabel: `Recibo ${extraction.provider}`,
      receiptImportId: receipt.id,
      externalReference: extraction.invoiceNumber || undefined,
      capturedAt: now,
    });
    commit(
      environmental,
      "Recibo confirmado; la lectura se agregó sin reemplazar otros recursos del mes.",
    );
  }

  function confirmDeleteSale(sale: Sale) {
    if (window.confirm(`¿Eliminar ${sale.number} y devolver sus productos al inventario?`)) {
      run(() => deleteSale(state, sale.id), "Venta eliminada; existencias devueltas.");
    }
  }

  function confirmDeletePurchase(purchase: Purchase) {
    if (
      window.confirm(`¿Eliminar ${purchase.number}? La compra recibida ajustará las existencias.`)
    ) {
      run(() => deletePurchase(state, purchase.id), "Compra eliminada y existencias recalculadas.");
    }
  }

  function restoreBackup(file: File) {
    void file
      .text()
      .then((content) => {
        const restored = parseBackup(content);
        if (
          window.confirm(
            "Esto reemplazará los datos guardados actualmente en SQLite. ¿Deseas continuar?",
          )
        ) {
          commit(restored, "Respaldo restaurado.", true);
        }
      })
      .catch((error: unknown) => notify(errorMessage(error), true));
  }

  async function exportExcel() {
    try {
      const { downloadExcelWorkbook } = await import("../features/spreadsheets/exportExcel");
      await downloadExcelWorkbook(state);
      notify("El libro Excel se descargó.");
    } catch (error) {
      notify(`No se pudo crear el archivo Excel: ${errorMessage(error)}`, true);
    }
  }

  let content: ReactNode;
  if (page === "overview") {
    content = (
      <OverviewPage
        state={state}
        openPage={navigateToPage}
        openCompany={() => setModal({ type: "company" })}
        openContact={() => setModal({ type: "contact" })}
        openProduct={() => setModal({ type: "product" })}
      />
    );
  } else if (page === "contacts") {
    content = (
      <ContactsPage
        contacts={state.contacts}
        onAdd={() => setModal({ type: "contact" })}
        onEdit={(contact) => setModal({ type: "contact", contact })}
        onDelete={removeContact}
        canEdit={canEdit}
        canDelete={isAdmin}
      />
    );
  } else if (page === "inventory") {
    content = (
      <InventoryPage
        products={state.products}
        recipes={state.recipes}
        movements={state.inventoryMovements}
        onAdd={() => setModal({ type: "product" })}
        onAdjust={(product) => setModal({ type: "stock", product })}
        onPreparePurchase={(productId, quantity) =>
          setModal({ type: "purchase", initialProductId: productId, initialQuantity: quantity, initialStatus: "pending" })
        }
        onPrepareProduction={(productId, quantity) =>
          setModal({ type: "production", initialProductId: productId, initialQuantity: quantity })
        }
        onEdit={(product) => setModal({ type: "product", product })}
        onOpenRecipe={(productId) => {
          navigateToPage("production");
          setProductionSection("recipes");
          setSelectedRecipeProductId(productId);
        }}
        onDelete={removeProduct}
        canEdit={canEdit}
        canDelete={isAdmin}
      />
    );
  } else if (page === "finance") {
    content = (
      <FinancePage
        state={state}
        canEdit={canEdit}
        isAdmin={isAdmin}
        onAddAccount={() => setModal({ type: "financial-account" })}
        onAddMovement={() => setModal({ type: "cash-movement" })}
        onCollectSale={(sale) => setModal({ type: "payment", sale })}
        onPayPurchase={(purchase) => setModal({ type: "purchase-payment", purchase })}
        onReviewPurchase={(purchase) => setModal({ type: "review-payable", purchase })}
      />
    );
  } else if (page === "sales") {
    content = (
      <>
        <div className="module-segmented" role="group" aria-label="Sección de ventas">
          <button
            type="button"
            aria-pressed={salesSection === "sales"}
            className={salesSection === "sales" ? "active" : ""}
            onClick={() => setSalesSection("sales")}
          >
            Ventas
          </button>
          <button
            type="button"
            aria-pressed={salesSection === "documents"}
            className={salesSection === "documents" ? "active" : ""}
            onClick={() => setSalesSection("documents")}
          >
            Facturación y documentos
          </button>
        </div>
        {salesSection === "sales" && (
          <section aria-label="Ventas">
            <SalesPage
              sales={state.sales}
              electronicDocuments={state.electronicDocuments}
              onAdd={() => setModal({ type: "sale" })}
              onPrepareInvoice={(sale) =>
                run(
                  () => prepareElectronicInvoice(state, sale.id, user.displayName || user.username),
                  "Borrador de factura preparado. Revisa las alertas tributarias antes de una futura transmisión.",
                )
              }
              onPayment={(sale) => setModal({ type: "payment", sale })}
              onDelete={confirmDeleteSale}
              canEdit={canEdit}
              canDelete={isAdmin}
            />
          </section>
        )}
        {salesSection === "documents" && (
          <section aria-label="Facturación y documentos">
            <ElectronicInvoicingPanel
              state={state}
              canEdit={canEdit}
              isAdmin={isAdmin}
              onRefreshState={refreshPersistedState}
              onSaveTaxConfiguration={async (config: TaxConfiguration) => {
                try {
                  return await commit(
                    saveTaxConfiguration(state, config),
                    "Configuración tributaria guardada.",
                  );
                } catch (error) {
                  notify(errorMessage(error), true);
                  return false;
                }
              }}
              onSaveSupplierInvoice={async (
                input: Omit<
                  SupplierInvoiceDocument,
                  "id" | "importedAt" | "status" | "supplierContactId"
                > & { supplierContactId?: string },
              ) => {
                try {
                  return await commit(
                    addSupplierInvoiceDocument(state, input),
                    input.purchaseId
                      ? "Factura XML importada y vinculada a la compra."
                      : "Factura XML importada; quedó pendiente de revisión.",
                  );
                } catch (error) {
                  notify(errorMessage(error), true);
                  return false;
                }
              }}
              onSaveAdjustment={async (originalDocumentId, kind, reason, changes) => {
                try {
                  return await commit(
                    prepareElectronicAdjustmentNote(
                      state,
                      originalDocumentId,
                      kind,
                      reason,
                      changes,
                      user.displayName || user.username,
                    ),
                    kind === "credit_note"
                      ? "Borrador de nota crédito guardado."
                      : "Borrador de nota débito guardado.",
                  );
                } catch (error) {
                  notify(errorMessage(error), true);
                  return false;
                }
              }}
            />
          </section>
        )}
      </>
    );
  } else if (page === "purchases") {
    content = (
      <PurchasesPage
        purchases={state.purchases}
        onAdd={() => setModal({ type: "purchase" })}
        onEdit={(purchase) => setModal({ type: "purchase", purchase })}
        onDelete={confirmDeletePurchase}
        canEdit={canEdit}
        canDelete={isAdmin}
      />
    );
  } else if (page === "production") {
    content = (
      <ProductionPage
        orders={state.productionOrders}
        products={state.products}
        recipes={state.recipes}
        section={productionSection}
        selectedRecipeProductId={selectedRecipeProductId}
        onSectionChange={(section) => setProductionSection(section)}
        onAdd={() => setModal({ type: "production" })}
        onCreateRecipe={(productId) => setModal({ type: "recipe", productId })}
        onEditDraft={(recipe, version) => setModal({ type: "recipe", recipe, version })}
        onNewVersion={(recipe) => setModal({ type: "recipe", recipe })}
        onActivateVersion={(recipe, version) =>
          run(
            () => activateRecipeVersion(state, recipe.id, version.id),
            `Receta v${version.versionNumber} activada para ${state.products.find((product) => product.id === recipe.productId)?.name ?? "el producto"}.`,
          )
        }
        onComplete={(order) => setModal({ type: "complete-production", order })}
        onCancel={(order) => {
          if (
            window.confirm("¿Cancelar la orden y devolver al inventario los materiales consumidos?")
          )
            run(
              () => cancelProductionOrder(state, order.id),
              "Orden cancelada; materiales devueltos al inventario.",
            );
        }}
        canEdit={canEdit}
      />
    );
  } else if (page === "environment") {
    content = (
      <EnvironmentPage
        state={state}
        onEditReading={(reading) => setModal({ type: "reading", reading })}
        onDeleteReading={removeReading}
        onImport={importReceipt}
        onConfigure={() => setModal({ type: "environment-config" })}
        onNewTarget={() => setModal({ type: "target" })}
        onEditTarget={(target) => setModal({ type: "target", target })}
        onDeleteTarget={(targetId) => {
          if (window.confirm("¿Eliminar esta meta ambiental?"))
            run(() => deleteIndicatorTarget(state, targetId), "Meta ambiental eliminada.");
        }}
        onNewFactor={() => setModal({ type: "factor" })}
        onEditFactor={(factor) => setModal({ type: "factor", factor })}
        onDeleteFactor={(factorId) => {
          if (window.confirm("¿Eliminar este factor de emisión?"))
            run(() => deleteEmissionFactor(state, factorId), "Factor eliminado.");
        }}
        onNewAction={() => setModal({ type: "environmental-action" })}
        onToggleAction={(actionId) =>
          run(
            () => completeEnvironmentalAction(state, actionId),
            "Estado de la acción actualizado.",
          )
        }
        onDeleteAction={(actionId) => {
          if (window.confirm("¿Eliminar esta acción ambiental?"))
            run(() => deleteEnvironmentalAction(state, actionId), "Acción eliminada.");
        }}
        canEdit={canEdit}
        canDelete={isAdmin}
        isAdmin={isAdmin}
      />
    );
  } else if (page === "audit" && isAdmin) {
    content = <AuditPage />;
  } else {
    content = (
      <DataPage
        state={state}
        onRestore={restoreBackup}
        onExportExcel={exportExcel}
        onImportWorkbook={(next) => commit(next, "Importación Excel guardada en SQLite.")}
        role={user.role}
        readOnly={!canEdit}
        canRestore={isAdmin}
        canImport={canEdit && storageReady}
      />
    );
  }

  const storageLabel = !storageReady
    ? legacyReadOnly
      ? "Copia antigua · solo lectura"
      : storageStatus === "error"
        ? "Sin conexión local"
        : "Conectando a SQLite…"
    : storageStatus === "saving"
      ? "Guardando en SQLite…"
      : storageStatus === "error"
        ? "No se pudo guardar"
        : syncStatus?.conflicts
          ? `${syncStatus.conflicts} conflictos por resolver`
          : syncStatus?.rejectedBatches
            ? `${syncStatus.rejectedBatches} lotes rechazados`
            : syncStatus?.pendingBatches
              ? `Guardado local · ${syncStatus.pendingBatches} lotes pendientes`
              : syncStatus?.configured && syncStatus.connectedForCurrentUser
                ? syncStatus.lastValidation && !syncStatus.lastValidation.matches
                  ? "Sincronización por revisar"
                  : "Sincronizado con la nube"
                : "Guardado en este equipo";
  const displayName = user.displayName || user.username;
  const roleLabel =
    user.role === "admin" ? "Administrador" : user.role === "operator" ? "Operador" : "Consulta";
  const syncActionLabel = syncStatus?.conflicts
    ? `Conflictos (${syncStatus.conflicts})`
    : syncStatus?.pendingBatches
      ? `Pendientes (${syncStatus.pendingBatches})`
      : "Sincronización";

  function navigateToPage(destination: Page) {
    const activeGroup = NAV_GROUPS.find(
      (group) => group.pages.length > 1 && group.pages.includes(destination),
    );
    setExpandedNavGroups(activeGroup ? new Set([activeGroup.title]) : new Set());
    setSidebarTooltip(null);
    setPage(destination);
    setMobileNavOpen(false);
  }

  function toggleNavGroup(title: string) {
    setSidebarTooltip(null);
    setExpandedNavGroups((current) =>
      current.has(title) ? new Set() : new Set([title]),
    );
  }

  useEffect(() => {
    if (!mobileNavOpen) return;
    const returnFocusTo =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sidebarRef.current?.querySelector<HTMLButtonElement>(".workspace-mobile-close")?.focus();

    function manageMobileNavigation(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMobileNavOpen(false);
        return;
      }
      if (event.key !== "Tab" || !sidebarRef.current) return;
      const focusable = Array.from(
        sidebarRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    function closeWhenDesktop() {
      if (!window.matchMedia("(max-width: 760px)").matches) setMobileNavOpen(false);
    }
    window.addEventListener("keydown", manageMobileNavigation);
    window.addEventListener("resize", closeWhenDesktop);
    return () => {
      window.removeEventListener("keydown", manageMobileNavigation);
      window.removeEventListener("resize", closeWhenDesktop);
      returnFocusTo?.focus();
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    if (!profileOpen) return;
    const returnFocusTo = profileTriggerRef.current;
    profilePanelRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();

    function manageProfilePanel(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setProfileOpen(false);
        return;
      }
      if (event.key !== "Tab" || !profilePanelRef.current) return;
      const focusable = Array.from(
        profilePanelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", manageProfilePanel);
    return () => {
      window.removeEventListener("keydown", manageProfilePanel);
      returnFocusTo?.focus();
    };
  }, [profileOpen]);

  return (
    <div className={`workspace-shell${navCollapsed ? " nav-collapsed" : ""}`}>
      {mobileNavOpen && (
        <button
          className="workspace-nav-backdrop"
          aria-label="Cerrar menú de navegación"
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      <aside
        ref={sidebarRef}
        className={`workspace-sidebar${mobileNavOpen ? " is-open" : ""}`}
        id="primary-navigation"
        role={mobileNavOpen ? "dialog" : undefined}
        aria-modal={mobileNavOpen ? true : undefined}
        aria-label="Barra lateral"
      >
        <div className="workspace-sidebar-brand">
          <a
            className="workspace-brand"
            href="#inicio"
            onClick={(event) => {
              event.preventDefault();
              navigateToPage("overview");
            }}
            aria-label="Pyme360 inicio"
            onMouseEnter={(event) => showSidebarTooltip(event.currentTarget, "Resumen")}
            onMouseLeave={() => setSidebarTooltip(null)}
            onFocus={(event) => showSidebarTooltip(event.currentTarget, "Resumen")}
            onBlur={() => setSidebarTooltip(null)}
          >
            <BrandLogo variant="mark" />
          </a>
          <div className="workspace-brand-name" aria-hidden="true">
            <strong>Pyme360</strong>
            <small>Gestión empresarial</small>
          </div>
          <button
            className="workspace-mobile-close"
            type="button"
            aria-label="Cerrar menú"
            onClick={() => setMobileNavOpen(false)}
          >
            ×
          </button>
        </div>
        <section
          className="workspace-company-card"
          aria-label={`Empresa activa: ${state.company?.name || "Configurar empresa"}`}
          onMouseEnter={(event) =>
            showSidebarTooltip(
              event.currentTarget,
              `${state.company?.name || "Configurar empresa"} · ${state.company?.city || "Espacio local"}`,
            )
          }
          onMouseLeave={() => setSidebarTooltip(null)}
        >
          <span className="workspace-company-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M3.5 20.5h17M5.5 20.5v-13l6.5-4 6.5 4v13M9 10h1m4 0h1m-6 4h1m4 0h1m-4 6.5v-4h2v4" />
            </svg>
          </span>
          <span className="workspace-company-copy">
            <strong>{state.company?.name || "Configurar empresa"}</strong>
            <small>{state.company?.city || "Espacio local"} · Empresa activa</small>
          </span>
        </section>
        <nav className="workspace-navigation" aria-label="Navegación principal">
          {NAV_GROUPS.map((group, groupIndex) => {
            const visiblePages = group.pages.filter((key) => key !== "audit" || isAdmin);
            if (visiblePages.length === 0) return null;
            const groupId = `workspace-nav-group-${groupIndex}`;
            const groupExpanded = expandedNavGroups.has(group.title);
            const groupHasActivePage = visiblePages.includes(page);
            const groupVisible = (navCollapsed && !isMobileViewport) || groupExpanded;
            const renderPageButton = (key: Page, inClosedGroup = false) => (
              <button
                key={key}
                type="button"
                disabled={!dataLoaded || (legacyReadOnly && key !== "data")}
                tabIndex={inClosedGroup && !navCollapsed ? -1 : undefined}
                className={`workspace-nav-item${page === key ? " active" : ""}`}
                aria-label={PAGE_TITLES[key]}
                aria-current={page === key ? "page" : undefined}
                onMouseEnter={(event) => showSidebarTooltip(event.currentTarget, PAGE_TITLES[key])}
                onMouseLeave={() => setSidebarTooltip(null)}
                onFocus={(event) => showSidebarTooltip(event.currentTarget, PAGE_TITLES[key])}
                onBlur={() => setSidebarTooltip(null)}
                onClick={() => navigateToPage(key)}
              >
                <NavIcon page={key} />
                <span>{PAGE_TITLES[key]}</span>
              </button>
            );

            if (visiblePages.length === 1) {
              return (
                <section className="workspace-nav-group workspace-nav-group-single" key={group.title}>
                  <div className="workspace-navigation-links">
                    {renderPageButton(visiblePages[0])}
                  </div>
                </section>
              );
            }

            return (
              <section
                className={`workspace-nav-group${groupVisible ? " is-open" : ""}${groupHasActivePage ? " has-active" : ""}`}
                key={group.title}
              >
                <button
                  className="workspace-nav-heading"
                  type="button"
                  aria-expanded={groupVisible}
                  aria-controls={groupId}
                  aria-current={groupHasActivePage ? "true" : undefined}
                  onClick={() => toggleNavGroup(group.title)}
                >
                  <span className="workspace-navigation-label">{group.title}</span>
                  <svg className="workspace-nav-chevron" aria-hidden="true" viewBox="0 0 20 20">
                    <path d="m5 7.5 5 5 5-5" />
                  </svg>
                </button>
                <div
                  className="workspace-nav-accordion"
                  id={groupId}
                  aria-hidden={!groupVisible}
                >
                  <div className="workspace-navigation-links">
                    {visiblePages.map((key) => renderPageButton(key, !groupVisible))}
                  </div>
                </div>
              </section>
            );
          })}
        </nav>
        <div className="workspace-sidebar-footer">
          <button
            ref={profileTriggerRef}
            className="workspace-sidebar-user"
            type="button"
            aria-label={`${displayName} · ${roleLabel}`}
            aria-haspopup="dialog"
            aria-expanded={profileOpen}
            aria-controls="workspace-profile-panel"
            onMouseEnter={(event) =>
              showSidebarTooltip(event.currentTarget, `${displayName} · ${roleLabel}`)
            }
            onMouseLeave={() => setSidebarTooltip(null)}
            onFocus={(event) =>
              showSidebarTooltip(event.currentTarget, `${displayName} · ${roleLabel}`)
            }
            onBlur={() => setSidebarTooltip(null)}
            onClick={() => {
              setSidebarTooltip(null);
              setProfileOpen((open) => !open);
            }}
          >
            <span className="workspace-avatar" aria-hidden="true">
              {displayName.slice(0, 1).toLocaleUpperCase("es-CO")}
            </span>
            <span className="workspace-user-copy">
              <strong>{displayName}</strong>
              <small>{roleLabel}</small>
            </span>
            <svg className="workspace-profile-chevron" aria-hidden="true" viewBox="0 0 20 20">
              <path d="m5 7.5 5 5 5-5" />
            </svg>
          </button>
        </div>
      </aside>
      {sidebarTooltip && (
        <div
          className="workspace-nav-tooltip"
          style={{ top: sidebarTooltip.top, left: sidebarTooltip.left }}
          aria-hidden="true"
        >
          {sidebarTooltip.label}
        </div>
      )}
      {profileOpen && (
        <>
          <button
            className="workspace-profile-backdrop"
            type="button"
            aria-label="Cerrar menú de cuenta"
            onClick={() => setProfileOpen(false)}
          />
          <section
            ref={profilePanelRef}
            className="workspace-profile-panel"
            id="workspace-profile-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="workspace-profile-title"
          >
            <div className="workspace-profile-heading">
              <span className="workspace-avatar" aria-hidden="true">
                {displayName.slice(0, 1).toLocaleUpperCase("es-CO")}
              </span>
              <div>
                <strong id="workspace-profile-title">{displayName}</strong>
                <span>{roleLabel} · {state.company?.name || "Espacio local"}</span>
              </div>
              <button
                type="button"
                className="workspace-profile-close"
                aria-label="Cerrar cuenta"
                onClick={() => setProfileOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="workspace-profile-actions" aria-label="Acciones de cuenta">
              {isAdmin && (
                <>
                  <button
                    type="button"
                    className="workspace-profile-action"
                    disabled={!storageReady}
                    onClick={() => {
                      setProfileOpen(false);
                      setModal({ type: "company" });
                    }}
                  >
                    Configurar empresa
                  </button>
                  <button
                    type="button"
                    className="workspace-profile-action"
                    onClick={() => {
                      setProfileOpen(false);
                      setModal({ type: "users" });
                    }}
                  >
                    Usuarios
                  </button>
                </>
              )}
              <button
                type="button"
                className="workspace-profile-action"
                onClick={() => {
                  setProfileOpen(false);
                  setSyncPanelOpen(true);
                }}
              >
                {syncActionLabel}
              </button>
              <button type="button" className="workspace-profile-action is-danger" onClick={onLogout}>
                Cerrar sesión
              </button>
            </div>
          </section>
        </>
      )}
      <div className="workspace-content-area">
        <header className="workspace-header">
          <div className="workspace-header-main">
            <div className="workspace-header-context">
              <button
                className="workspace-mobile-menu"
                type="button"
                aria-label="Abrir menú de navegación"
                aria-expanded={mobileNavOpen}
                aria-controls="primary-navigation"
                onClick={() => setMobileNavOpen(true)}
              >
                <span aria-hidden="true">☰</span>
              </button>
              <div className="workspace-header-title">
                <span className="workspace-overline">
                  PYME360 · {state.company?.name || "ESPACIO LOCAL"}
                </span>
                <strong>{PAGE_TITLES[page]}</strong>
              </div>
            </div>
            <div className="workspace-controls">
              <div className="workspace-control-preferences">
                <span
                  className={`local-status workspace-storage${storageStatus === "error" ? " error" : ""}`}
                  title={storageLabel}
                >
                  <i /> <span>{storageLabel}</span>
                </span>
                <span className="workspace-account-avatar" aria-hidden="true">
                  {displayName.slice(0, 1).toLocaleUpperCase("es-CO")}
                </span>
                <div className="theme-control">
                  <span className="theme-label">Tema</span>
                  <div className="theme-options" role="group" aria-label="Preferencia de tema">
                    {themeOptions.map((option) => (
                      <button
                        aria-label={`Tema ${option.label.toLocaleLowerCase("es-CO")}`}
                        aria-pressed={theme === option.value}
                        className="theme-option"
                        key={option.value}
                        onClick={() => onThemeChange(option.value)}
                        title={option.label}
                        type="button"
                      >
                        <svg
                          aria-hidden="true"
                          fill="none"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="1.7"
                          viewBox="0 0 24 24"
                        >
                          {option.value === "system" ? (
                            <>
                              <rect x="3.5" y="4" width="17" height="12" rx="2" />
                              <path d="M8 20h8m-4-4v4" />
                            </>
                          ) : option.value === "light" ? (
                            <>
                              <circle cx="12" cy="12" r="3.5" />
                              <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
                            </>
                          ) : (
                            <path d="M20.2 15.2A8.6 8.6 0 0 1 8.8 3.8 8.8 8.8 0 1 0 20.2 15.2Z" />
                          )}
                        </svg>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </header>
        <main className="workspace-main">
          <div className="page-content route-enter" key={page}>
            {page === "overview" && !legacyReadOnly && (
              <section className="overview-intro">
                <div>
                  <span className="overview-kicker">RESUMEN OPERATIVO</span>
                  <h1>Una vista clara de tu negocio.</h1>
                  <p>Ventas, inventario, producción y sostenibilidad en un solo lugar.</p>
                </div>
                <div className="overview-location">
                  <span>SEDE PRINCIPAL</span>
                  <strong>{state.company?.city || "Operación local"}</strong>
                </div>
              </section>
            )}
            {legacyReadOnly ? (
              <DataPage
                state={state}
                onRestore={restoreBackup}
                onExportExcel={exportExcel}
                readOnly
              />
            ) : !dataLoaded ? (
              <section
                className={`storage-message${storageStatus === "error" ? " error" : ""}`}
                role="status"
              >
                <strong>
                  {storageStatus === "error"
                    ? "No se pudo abrir la base de datos local"
                    : "Conectando con el almacenamiento local"}
                </strong>
                <p>
                  {storageStatus === "error"
                    ? "Inicia Pyme360 con el lanzador y vuelve a cargar esta página. Los cambios no se guardarán mientras SQLite no esté disponible."
                    : "Cargando los datos guardados en este equipo…"}
                </p>
              </section>
            ) : (
              content
            )}
          </div>
        </main>
      </div>
      <nav className="mobile-bottom-nav" aria-label="Navegación rápida">
        {(
          [
            ["overview", "Inicio"],
            ["sales", "Ventas"],
            ["inventory", "Inventario"],
          ] as const
        ).map(([destination, label]) => (
          <button
            key={destination}
            type="button"
            className={`mobile-bottom-nav-item${page === destination ? " active" : ""}`}
            aria-current={page === destination ? "page" : undefined}
            disabled={!dataLoaded || legacyReadOnly}
            onClick={() => {
              navigateToPage(destination);
            }}
          >
            <NavIcon page={destination} />
            <span>{label}</span>
          </button>
        ))}
        <button
          type="button"
          className={`mobile-bottom-nav-item${
            mobileNavOpen || !["overview", "sales", "inventory"].includes(page) ? " active" : ""
          }`}
          aria-expanded={mobileNavOpen}
          aria-controls="primary-navigation"
          onClick={() => setMobileNavOpen((open) => !open)}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="5" cy="12" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="19" cy="12" r="1.8" />
          </svg>
          <span>Más</span>
        </button>
      </nav>
      {toast.message && (
        <div className="toast-region" aria-live="polite">
          <div className={`toast${toast.error ? " error" : ""}`}>{toast.message}</div>
        </div>
      )}
      {modal?.type === "company" && (
        <CompanyForm
          company={state.company}
          onClose={() => setModal(null)}
          onSave={(input) => run(() => saveCompany(state, input), "Datos de la empresa guardados.")}
        />
      )}
      {modal?.type === "contact" && (
        <ContactForm
          contact={modal.contact}
          onClose={() => setModal(null)}
          onSave={(input) =>
            run(
              () =>
                modal.contact
                  ? updateContact(state, modal.contact.id, input)
                  : addContact(state, input),
              modal.contact ? "Contacto actualizado." : "Contacto agregado.",
            )
          }
        />
      )}
      {modal?.type === "product" && (
        <ProductForm
          product={modal.product}
          onClose={() => setModal(null)}
          onSave={(input) =>
            run(
              () =>
                modal.product
                  ? updateProduct(state, modal.product.id, input)
                  : addProduct(state, input),
              modal.product ? "Producto actualizado." : "Producto agregado al inventario.",
            )
          }
        />
      )}
      {modal?.type === "sale" && (
        <SaleForm
          state={state}
          onClose={() => setModal(null)}
          onSave={(input) =>
            run(() => createSale(state, input), "Venta registrada y existencias actualizadas.")
          }
        />
      )}
      {modal?.type === "purchase" && (
        <PurchaseForm
          state={state}
          purchase={modal.purchase}
          initialProductId={modal.initialProductId}
          initialQuantity={modal.initialQuantity}
          initialStatus={modal.initialStatus}
          onClose={() => setModal(null)}
          onSave={(input) =>
            run(
              () =>
                modal.purchase
                  ? updatePurchase(state, modal.purchase.id, input)
                  : createPurchase(state, input),
              modal.purchase
                ? "Compra actualizada y existencias recalculadas."
                : "Compra registrada.",
            )
          }
        />
      )}
      {modal?.type === "production" && (
        <ProductionForm
          products={state.products}
          recipes={state.recipes}
          initialProductId={modal.initialProductId}
          initialQuantity={modal.initialQuantity}
          onClose={() => setModal(null)}
          onSave={(productId, quantity, date) =>
            run(
              () => createProductionOrder(state, productId, quantity, date),
              "Orden creada; materiales descontados del inventario.",
            )
          }
        />
      )}
      {modal?.type === "recipe" && (
        <RecipeForm
          products={state.products}
          recipes={state.recipes}
          recipe={modal.recipe}
          version={modal.version}
          productId={modal.productId}
          onClose={() => setModal(null)}
          onSave={(input) =>
            run(
              () => saveRecipeVersion(state, input),
              input.versionId ? "Borrador de receta actualizado." : "Nueva versión guardada como borrador.",
            )
          }
        />
      )}
      {modal?.type === "reading" && (
        <ResourceReadingForm
          reading={modal.reading}
          products={state.products}
          onClose={() => setModal(null)}
          onSave={(input) =>
            run(
              () => saveResourceReading(state, input, modal.reading?.id),
              modal.reading ? "Lectura ambiental actualizada." : "Lectura ambiental guardada.",
            )
          }
        />
      )}
      {modal?.type === "receipt" && (
        <ReceiptReviewForm
          extraction={modal.extraction}
          fileName={modal.fileName}
          onClose={() => setModal(null)}
          onSave={(extraction) => saveReceipt(extraction, modal.fileName, modal.fileHash)}
        />
      )}
      {modal?.type === "environment-config" && (
        <EnvironmentalConfigForm
          config={state.environmentalConfig}
          onClose={() => setModal(null)}
          onSave={(config) =>
            run(() => saveEnvironmentalConfig(state, config), "Configuración ambiental guardada.")
          }
        />
      )}
      {modal?.type === "target" && (
        <IndicatorTargetForm
          target={modal.target}
          onClose={() => setModal(null)}
          onSave={(input) =>
            run(
              () => saveIndicatorTarget(state, input, modal.target?.id),
              modal.target ? "Meta ambiental actualizada." : "Meta ambiental creada.",
            )
          }
        />
      )}
      {modal?.type === "factor" && (
        <EmissionFactorForm
          factor={modal.factor}
          onClose={() => setModal(null)}
          onSave={(input) =>
            run(
              () => saveEmissionFactor(state, input, modal.factor?.id),
              modal.factor ? "Factor de emisión actualizado." : "Factor de emisión agregado.",
            )
          }
        />
      )}
      {modal?.type === "environmental-action" && (
        <EnvironmentalActionForm
          onClose={() => setModal(null)}
          onSave={(input) =>
            run(() => addEnvironmentalAction(state, input), "Acción ambiental registrada.")
          }
        />
      )}
      {modal?.type === "payment" && (
        <PaymentForm
          sale={modal.sale}
          balance={outstandingBalance(modal.sale, state.electronicDocuments)}
          accounts={state.financialAccounts}
          onClose={() => setModal(null)}
          onSave={(amount, date, method, accountId) =>
            run(
              () => addSalePayment(state, modal.sale.id, amount, date, method, accountId),
              "Abono registrado.",
            )
          }
        />
      )}
      {modal?.type === "purchase-payment" && (
        <PurchasePaymentForm
          purchase={modal.purchase}
          accounts={state.financialAccounts}
          balance={Math.max(
            0,
            (modal.purchase.payableAmount ?? modal.purchase.total) -
              modal.purchase.payments.reduce((sum, payment) => sum + payment.amount, 0),
          )}
          onClose={() => setModal(null)}
          onSave={(amount, date, method, accountId) =>
            run(
              () => addPurchasePayment(state, modal.purchase.id, amount, date, method, accountId),
              "Pago de compra registrado.",
            )
          }
        />
      )}
      {modal?.type === "review-payable" && isAdmin && (
        <LegacyPayableReviewForm
          purchase={modal.purchase}
          onClose={() => setModal(null)}
          onSave={(amount, dueDate) =>
            run(
              () => confirmLegacyPurchasePayable(state, modal.purchase.id, amount, dueDate),
              "Saldo histórico confirmado.",
            )
          }
        />
      )}
      {modal?.type === "financial-account" && isAdmin && (
        <FinancialAccountForm
          onClose={() => setModal(null)}
          onSave={(name, type, openingBalance) =>
            run(
              () => addFinancialAccount(state, { name, type, openingBalance }),
              "Cuenta financiera creada.",
            )
          }
        />
      )}
      {modal?.type === "cash-movement" && canEdit && (
        <ManualCashMovementForm
          accounts={state.financialAccounts}
          onClose={() => setModal(null)}
          onSave={(input) =>
            run(() => addManualCashMovement(state, input), "Movimiento de dinero registrado.")
          }
        />
      )}
      {modal?.type === "stock" && (
        <StockForm
          product={modal.product}
          onClose={() => setModal(null)}
          onSave={(countedQuantity, reason) => {
            if (Number(countedQuantity.toFixed(4)) === modal.product.stock) {
              setModal(null);
              notify("El conteo coincide con el saldo del sistema; no se requiere ajuste.");
              return;
            }
            run(
              () => reconcileInventoryCount(state, modal.product.id, countedQuantity, reason),
              "Conteo conciliado; se registró la diferencia en el libro de inventario.",
            );
          }}
        />
      )}
      {modal?.type === "complete-production" && (
        <CompleteProductionForm
          order={modal.order}
          onClose={() => setModal(null)}
          onSave={(wasteQuantity, date) =>
            run(
              () => completeProductionOrder(state, modal.order.id, wasteQuantity, date),
              "Orden completada; producto terminado agregado al inventario.",
            )
          }
        />
      )}
      {modal?.type === "users" && isAdmin && (
        <UsersModal currentUser={user} onClose={() => setModal(null)} />
      )}
      {syncPanelOpen && (
        <CloudSyncPanel
          role={user.role}
          onClose={() => setSyncPanelOpen(false)}
          onStatus={setSyncStatus}
        />
      )}
    </div>
  );
}

export function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [authError, setAuthError] = useState("");
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useLayoutEffect(() => {
    applyTheme(theme, true);
    try {
      if (theme === "system") {
        window.localStorage.removeItem(THEME_STORAGE_KEY);
      } else {
        window.localStorage.setItem(THEME_STORAGE_KEY, theme);
      }
    } catch {
      // El tema sigue activo durante esta sesión aunque no se pueda guardar la preferencia.
    }

    if (theme !== "system") return;
    const systemPreference = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!systemPreference) return;
    const updateSystemTheme = () => applyTheme("system", true);
    systemPreference.addEventListener("change", updateSystemTheme);
    return () => systemPreference.removeEventListener("change", updateSystemTheme);
  }, [theme]);

  useEffect(() => {
    let active = true;
    void initializeAuth()
      .then((status) => {
        if (active) setAuth(status);
      })
      .catch((error: unknown) => {
        if (active) setAuthError(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, []);
  if (!auth)
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="brand auth-brand">
            <BrandLogo variant="full" />
          </div>
          {authError ? (
            <>
              <h1>No se pudo validar la sesión</h1>
              <p>{authError}</p>
              <button
                className="button button-primary"
                onClick={() => {
                  setAuthError("");
                  void initializeAuth()
                    .then(setAuth)
                    .catch((error: unknown) => setAuthError(errorMessage(error)));
                }}
              >
                Reintentar
              </button>
            </>
          ) : (
            <p>Conectando con la autenticación local…</p>
          )}
        </section>
      </main>
    );
  if (!auth.user)
    return (
      <LoginScreen
        setup={auth.setupRequired}
        onAuthenticated={(user) => setAuth({ setupRequired: false, user })}
      />
    );
  return (
    <Workspace
      user={auth.user}
      onLogout={() => {
        void clearSession()
          .then(() => setAuth((current) => (current ? { ...current, user: null } : current)))
          .catch((error: unknown) => setAuthError(errorMessage(error)));
      }}
      theme={theme}
      onThemeChange={setTheme}
    />
  );
}
