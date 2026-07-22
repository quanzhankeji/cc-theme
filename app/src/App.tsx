import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import appIconUrl from "../src-tauri/icons/icon.png";
import chatgptIconUrl from "./assets/client-icons/chatgpt.png";
import doubaoIconUrl from "./assets/client-icons/doubao.png";
import workbuddyIconUrl from "./assets/client-icons/workbuddy.png";
import { desktopApi, type DesktopApi } from "./api";
import { adapterPackagePicker, type AdapterPackagePicker } from "./adapter-package-picker";
import { Icon } from "./icons";
import {
  createTranslator,
  detectManagerLocale,
  localizeRuntimeText,
  LOCALE_STORAGE_KEY,
  type ManagerLocale,
  type Translate,
} from "./i18n";
import { managerWindowApi, type ManagerWindowApi } from "./window-api";
import { themePackagePicker, type ThemePackagePicker } from "./theme-package-picker";
import { themePackageDropTarget, type ThemePackageDropTarget } from "./theme-package-drop";
import type {
  AdapterCapability,
  AdapterCatalogStatus,
  AdapterUpdateState,
  ClientId,
  ClientOperation,
  ClientState,
  DashboardState,
  OperationResult,
  ThemeFamily,
} from "./types";
import "./styles.css";

interface PendingOperation {
  clientId: ClientId;
  operation: ClientOperation;
}

type ManagerAppearance = "light" | "dark";

const APPEARANCE_STORAGE_KEY = "cc-theme.appearance";
const LAST_CLIENT_THEMES_STORAGE_KEY = "cc-theme.last-client-themes";

const CLIENT_ICON_URLS: Readonly<Record<string, string>> = Object.freeze({
  "mac-codex": chatgptIconUrl,
  "mac-doubao": doubaoIconUrl,
  "mac-workbuddy": workbuddyIconUrl,
});

function initialAppearance(): ManagerAppearance {
  try {
    const saved = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // The application still follows the system appearance if local storage is unavailable.
  }
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function initialLastClientThemes(): Record<ClientId, string> {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(LAST_CLIENT_THEMES_STORAGE_KEY) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(([clientId, themeId]) =>
        /^[A-Za-z0-9_-]+$/.test(clientId)
        && typeof themeId === "string"
        && /^[A-Za-z0-9_-]+$/.test(themeId)),
    );
  } catch {
    return {};
  }
}

function validLastClientThemes(
  selections: Record<ClientId, string>,
  dashboard: DashboardState,
): Record<ClientId, string> {
  const clientIds = new Set(dashboard.clients.map((client) => client.id));
  const themeIds = new Set(dashboard.themes.map((theme) => theme.id));
  const valid = Object.fromEntries(
    Object.entries(selections).filter(([clientId, themeId]) =>
      clientIds.has(clientId) && themeIds.has(themeId)),
  );
  for (const client of dashboard.clients) {
    if (!valid[client.id] && client.currentThemeId && themeIds.has(client.currentThemeId)) {
      valid[client.id] = client.currentThemeId;
    }
  }
  return valid;
}

function sameClientThemes(left: Record<ClientId, string>, right: Record<ClientId, string>): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  return leftEntries.length === rightEntries.length
    && leftEntries.every(([clientId, themeId]) => right[clientId] === themeId);
}

export interface AppProps {
  api?: DesktopApi;
  windowApi?: ManagerWindowApi;
  packagePicker?: ThemePackagePicker;
  dropTarget?: ThemePackageDropTarget;
  adapterPicker?: AdapterPackagePicker;
}

function statusText(client: ClientState, t: Translate): string {
  if (!client.discovered) return t("status.notFound");
  if (client.runState === "running") return t("status.running");
  if (client.runState === "stopped") return t("status.stopped");
  return t("status.unknown");
}

function shortMark(name: string): string {
  const words = name.match(/[A-Z]?[a-z]+|[A-Z]+(?=[A-Z]|$)|[\p{L}\p{N}]+/gu) ?? [];
  if (words.length > 1) return words.slice(0, 2).map((word) => word[0]).join("");
  const compact = name.replace(/[^\p{L}\p{N}]/gu, "");
  if (compact.length < 2) return compact.toUpperCase();
  return `${compact[0]}${compact.at(-1)?.toLowerCase() ?? ""}`;
}

function markStyle(id: string): React.CSSProperties {
  const hue = [...id].reduce((value, character) => (value * 31 + character.codePointAt(0)!) % 360, 171);
  return { color: `hsl(${hue} 75% 86%)`, background: `hsl(${hue} 35% 25%)` };
}

function AppMark({ capability }: { capability: AdapterCapability }) {
  const iconUrl = CLIENT_ICON_URLS[capability.adapterId];
  if (iconUrl) {
    return (
      <span className="client-mark client-mark--image">
        <img src={iconUrl} alt="" data-testid={`client-icon-${capability.adapterId}`} />
      </span>
    );
  }
  return <span className="client-mark" style={markStyle(capability.adapterId)}>{shortMark(capability.displayName)}</span>;
}

function fallbackCapability(client: ClientState): AdapterCapability {
  return {
    adapterId: client.id,
    displayName: client.name,
    availability: client.adapterReady ? "available" : "unavailable",
    runtimeApplyAvailable: client.adapterReady,
    runtimeLaunchAvailable: client.adapterReady,
    deepSettingsAvailable: false,
    reason: client.detail,
  };
}

interface AdapterEntry {
  capability: AdapterCapability;
  client: ClientState;
}

function adapterEntries(dashboard: DashboardState, t: Translate): AdapterEntry[] {
  const clients = new Map(dashboard.clients.map((client) => [client.id, client]));
  const capabilities = dashboard.capabilities?.length
    ? dashboard.capabilities
    : dashboard.clients.map(fallbackCapability);
  const entries = capabilities.map((capability) => {
    const client = clients.get(capability.adapterId);
    clients.delete(capability.adapterId);
    return {
      capability,
      client: client ?? {
        id: capability.adapterId,
        name: capability.displayName,
        bundleId: "",
        discovered: false,
        version: null,
        signature: { status: "unknown", teamId: null, label: t("client.noRuntimeSignature") },
        runState: "unknown",
        currentThemeId: null,
        currentThemeName: t("client.unavailable"),
        themePaused: false,
        adapterReady: false,
        detail: capability.reason,
      },
    };
  });
  for (const client of clients.values()) entries.push({ capability: fallbackCapability(client), client });
  return entries;
}

function themeDisplay(theme: ThemeFamily, locale: ManagerLocale): { name: string; description: string } {
  return theme.localizations?.[locale]
    ?? theme.localizations?.["en-US"]
    ?? (theme.defaultLocale ? theme.localizations?.[theme.defaultLocale] : undefined)
    ?? { name: theme.name, description: theme.description };
}

function ClientCard({
  client,
  capability,
  theme,
  currentTheme,
  pending,
  blocked,
  locale,
  t,
  onNormalStart,
  onAction,
  installingAdapter,
  checkingAdapterCatalog,
  adapterUpdate,
  onDownloadAdapter,
  onImportAdapter,
}: {
  client: ClientState;
  capability: AdapterCapability;
  theme?: ThemeFamily;
  currentTheme?: ThemeFamily;
  pending: PendingOperation | null;
  blocked: boolean;
  locale: ManagerLocale;
  t: Translate;
  onNormalStart: (client: ClientState) => void;
  onAction: (client: ClientState, operation: Extract<ClientOperation, "apply">) => void;
  installingAdapter: boolean;
  checkingAdapterCatalog: boolean;
  adapterUpdate?: AdapterUpdateState;
  onDownloadAdapter: (client: ClientState) => void;
  onImportAdapter: (client: ClientState) => void;
}) {
  const busy = Boolean(pending) || blocked || installingAdapter;
  const pendingOperation = pending?.clientId === client.id ? pending.operation : null;
  const starting = pendingOperation === "apply" || pendingOperation === "launch" || pendingOperation === "restore";
  const compatibility = theme?.compatibility[client.id];
  const runtimeAvailable = capability.availability === "available" && capability.runtimeApplyAvailable;
  const running = client.runState === "running";
  const launchAvailable = Boolean(capability.runtimeLaunchAvailable) && client.discovered;
  const stopped = client.runState === "stopped";
  const compatibilityCandidate = client.adapterStatus === "compatibility-candidate";
  const canInject = Boolean(theme) && runtimeAvailable && client.discovered && client.adapterReady && !compatibilityCandidate && compatibility?.status === "ready" && stopped;
  const canLaunch = launchAvailable && stopped;
  const diagnosticPreviewOnly = capability.availability === "contract-only" && !capability.runtimeApplyAvailable;
  const onlineUpdateAvailable = adapterUpdate?.status === "update-available";
  const onlineCurrent = adapterUpdate?.status === "current";
  const applyLabel = running
    ? t("client.alreadyRunning")
    : compatibilityCandidate
      ? t("adapter.hostUnverifiedAction")
      : diagnosticPreviewOnly
        ? t("capability.managerApplyUnavailable")
        : !runtimeAvailable || !client.discovered || (theme && compatibility?.status !== "ready")
          ? t("capability.unavailable")
          : theme
            ? t("client.injectLaunch")
            : t("client.chooseThemeShort");

  return (
    <article className={`client-card${!client.discovered ? " client-card--missing" : ""}${capability.availability !== "available" ? " client-card--contract" : ""}${running ? " client-card--running" : ""}${starting ? " client-card--pending" : ""}`} data-testid={`client-${client.id}`} aria-busy={starting || undefined}>
      <div className="client-card__top">
        <div className="client-title">
          <AppMark capability={capability} />
          <div>
            <h3>{client.name}</h3>
            <span className="mono">{client.version ?? (capability.capabilityVersion ? `Capability ${capability.capabilityVersion}` : t("client.notInstalled"))}</span>
          </div>
        </div>
      </div>

      <div className="client-health">
        <span className={`state-dot state-dot--${client.discovered ? client.runState : "missing"}`} />
        <strong>{statusText(client, t)}</strong>
      </div>

      {starting && (
        <div className="client-operation-status" role="status" aria-live="polite">
          <span className="spinner" data-testid="client-operation-spinner" aria-hidden="true" />
          <span>{t(pendingOperation === "apply" ? "client.injectStartingNamed" : "client.normalStartingNamed", { name: client.name })}</span>
        </div>
      )}

      <dl className="client-facts">
        <div>
          <dt>{t("client.currentTheme")}</dt>
          <dd>{currentTheme ? themeDisplay(currentTheme, locale).name : localizeRuntimeText(client.currentThemeName, locale)}{client.themePaused && <span className="paused-tag">{t("client.paused")}</span>}</dd>
        </div>
        <div className="adapter-fact">
          <dt>Adapter</dt>
          <dd>
            {client.adapterVersion
              ? `${client.adapterVersion}${client.adapterReleaseRevision ? ` · r${client.adapterReleaseRevision}` : ""}`
              : t("adapter.notInstalled")}
            {client.adapterSource && client.adapterStatus === "ready" && (
              <span className="adapter-source"> · {t(client.adapterSource === "local" ? "adapter.sourceLocal" : "adapter.sourceBundled")}</span>
            )}
          </dd>
        </div>
      </dl>

      {client.adapterStatus === "host-version-mismatch" && (
        <p className="adapter-status adapter-status--waiting">{t("adapter.waitingForHost", { version: client.version ?? "—" })}</p>
      )}
      {compatibilityCandidate && (
        <p className="adapter-status adapter-status--compatibility" role="status">{t("adapter.hostUnverified")}</p>
      )}
      {client.adapterSource === "local" && running && (
        <p className="adapter-status">{t("adapter.activeNextUse")}</p>
      )}
      <div className="adapter-management">
        {client.adapterReady && (
          <button
            className="adapter-update-button"
            type="button"
            disabled={busy || !client.discovered || checkingAdapterCatalog || !onlineUpdateAvailable}
            onClick={() => onDownloadAdapter(client)}
            aria-label={onlineUpdateAvailable ? t("adapter.downloadUpdateNamed", { name: client.name }) : undefined}
          >
            {checkingAdapterCatalog || installingAdapter ? <span className="spinner" /> : <Icon name={onlineCurrent ? "check" : "download"} />}
            {installingAdapter
              ? t("adapter.installing")
              : checkingAdapterCatalog
                ? t("adapter.checking")
                : onlineCurrent
                  ? t("adapter.current")
                  : onlineUpdateAvailable
                    ? t("adapter.downloadUpdate")
                    : t("adapter.onlineUnavailable")}
          </button>
        )}
        <button className="adapter-update-button" type="button" disabled={busy || !client.discovered} onClick={() => onImportAdapter(client)} aria-label={t("adapter.importLocalNamed", { name: client.name })}>
          <Icon name="download" />{t("adapter.importLocal")}
        </button>
      </div>

      <div className="client-actions">
        <button className="button button--secondary" type="button" disabled={!canLaunch || busy} onClick={() => onNormalStart(client)} aria-label={running ? t("client.alreadyRunningNamed", { name: client.name }) : t("client.normalLaunchNamed", { name: client.name })}>
          <Icon name="launch" />{running ? t("client.alreadyRunning") : t("client.normalLaunch")}
        </button>
        {!client.adapterReady ? (
          <button className="button button--primary" type="button" disabled={busy || !client.discovered || checkingAdapterCatalog} onClick={() => onlineUpdateAvailable ? onDownloadAdapter(client) : onImportAdapter(client)} aria-label={onlineUpdateAvailable ? t("adapter.downloadNamed", { name: client.name }) : t("adapter.installNamed", { name: client.name })}>
            {installingAdapter || checkingAdapterCatalog ? <span className="spinner" /> : <Icon name="download" />}
            {installingAdapter
              ? t("adapter.installing")
              : checkingAdapterCatalog
                ? t("adapter.checking")
                : onlineUpdateAvailable
                  ? t("adapter.download")
                  : t("adapter.install")}
          </button>
        ) : (
          <button className="button button--primary" type="button" disabled={!canInject || busy} onClick={() => onAction(client, "apply")} aria-label={running ? t("client.alreadyRunningNamed", { name: client.name }) : compatibilityCandidate ? t("adapter.hostUnverifiedNamed", { name: client.name }) : t("client.injectLaunchNamed", { name: client.name })}>
            <Icon name="sparkle" />{applyLabel}
          </button>
        )}
      </div>
    </article>
  );
}

function ThemeCard({ theme, selected, locale, disabled, t, onSelect, onDelete }: { theme: ThemeFamily; selected: boolean; locale: ManagerLocale; disabled: boolean; t: Translate; onSelect: () => void; onDelete: () => void }) {
  const display = themeDisplay(theme, locale);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [previewFailed, setPreviewFailed] = useState(false);
  const previewSource = theme.previewUrl && previewAttempt > 0
    ? `${theme.previewUrl}${theme.previewUrl.includes("?") ? "&" : "?"}ccThemePreviewRetry=${previewAttempt}`
    : theme.previewUrl;
  const coverStyle = {
    "--theme-cover-base": theme.colors[0],
    "--theme-cover-accent": theme.colors[1],
    "--theme-cover-text": theme.colors[2],
  } as React.CSSProperties;
  useEffect(() => {
    setPreviewAttempt(0);
    setPreviewFailed(false);
  }, [theme.previewUrl]);

  function handlePreviewError() {
    if (previewAttempt === 0) {
      setPreviewAttempt(1);
      return;
    }
    setPreviewFailed(true);
  }

  return (
    <article className={`theme-card${selected ? " theme-card--selected" : ""}`} data-testid={`theme-${theme.id}`}>
      <button type="button" className="theme-card__select" disabled={disabled} onClick={onSelect} aria-pressed={selected} aria-label={display.name}>
        <span className="visually-hidden">{display.name}</span>
      </button>
      <div className="theme-cover" style={coverStyle} aria-hidden="true">
        {previewSource && !previewFailed
          ? <img key={previewSource} src={previewSource} alt="" loading="lazy" decoding="async" onError={handlePreviewError} />
          : <span className="theme-cover__placeholder"><Icon name="sparkle" /></span>}
      </div>
      <footer className="theme-card__footer">
        <strong>{display.name}</strong>
        <span className="theme-card__controls">
          <button type="button" className="theme-delete" disabled={disabled} onClick={onDelete} aria-label={t("themes.delete")} title={t("themes.delete")}>
            <Icon name="trash" />
          </button>
          <span className={`selected-indicator${selected ? " selected-indicator--selected" : ""}`} aria-hidden="true">
            {selected && <Icon name="check" />}
          </span>
        </span>
      </footer>
    </article>
  );
}

export default function App({ api = desktopApi, windowApi = managerWindowApi, packagePicker = themePackagePicker, dropTarget = themePackageDropTarget, adapterPicker = adapterPackagePicker }: AppProps) {
  const [appearance, setAppearance] = useState<ManagerAppearance>(initialAppearance);
  const [locale, setLocale] = useState<ManagerLocale>(detectManagerLocale);
  const [dashboard, setDashboard] = useState<DashboardState | null>(null);
  const [selectedThemeId, setSelectedThemeId] = useState<string | null>(null);
  const [lastClientThemes, setLastClientThemes] = useState<Record<ClientId, string>>(initialLastClientThemes);
  const [pending, setPending] = useState<PendingOperation | null>(null);
  const [scanning, setScanning] = useState(false);
  const [importingTheme, setImportingTheme] = useState(false);
  const [installingAdapterId, setInstallingAdapterId] = useState<ClientId | null>(null);
  const [adapterCatalog, setAdapterCatalog] = useState<AdapterCatalogStatus | null>(null);
  const [checkingAdapterCatalog, setCheckingAdapterCatalog] = useState(true);
  const [dragActive, setDragActive] = useState(false);
  const [themeToDelete, setThemeToDelete] = useState<ThemeFamily | null>(null);
  const [deletingThemeId, setDeletingThemeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [closePromptOpen, setClosePromptOpen] = useState(false);
  const [closeChoicePending, setCloseChoicePending] = useState<"minimize" | "quit" | null>(null);
  const runtimeRefreshGeneration = useRef(0);
  const operationPending = useRef(false);
  const importPending = useRef(false);
  const adapterInstallPending = useRef(false);
  const droppedPathsHandler = useRef<(paths: string[]) => void>(() => {});
  const closeDialog = useRef<HTMLElement | null>(null);
  const deleteDialog = useRef<HTMLElement | null>(null);
  const closeChoiceBusy = useRef(false);
  const t = useMemo(() => createTranslator(locale), [locale]);
  droppedPathsHandler.current = (paths) => { void importDroppedTheme(paths); };

  const refreshRuntimeStates = useCallback(async (mayCommit: () => boolean = () => true) => {
    const states = await api.getClientRuntimeStates();
    if (!states.length || !mayCommit()) return;
    const byId = new Map(states.map((state) => [state.id, state.runState]));
    setDashboard((current) => {
      if (!current) return current;
      const changed = current.clients.some((client) => byId.has(client.id) && byId.get(client.id) !== client.runState);
      if (!changed) return current;
      return {
        ...current,
        clients: current.clients.map((client) => byId.has(client.id) ? { ...client, runState: byId.get(client.id)! } : client),
        lastRefreshedAt: new Date().toISOString(),
      };
    });
  }, [api]);

  useLayoutEffect(() => {
    operationPending.current = Boolean(pending) || Boolean(deletingThemeId) || Boolean(installingAdapterId);
  }, [pending, deletingThemeId, installingAdapterId]);

  useLayoutEffect(() => {
    closeChoiceBusy.current = Boolean(closeChoicePending);
  }, [closeChoicePending]);

  useLayoutEffect(() => {
    document.documentElement.dataset.appearance = appearance;
  }, [appearance]);

  useLayoutEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    windowApi.setLocale(locale).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  }, [locale, windowApi]);

  useEffect(() => {
    let active = true;
    api.getDashboardState()
      .then((value) => {
        if (!active) return;
        setDashboard(value);
        setSelectedThemeId(null);
      })
      .catch((reason: unknown) => active && setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [api]);

  useEffect(() => {
    let active = true;
    setCheckingAdapterCatalog(true);
    api.checkAdapterUpdates(false)
      .then((result) => {
        if (active && result.status === "success" && result.details) {
          setAdapterCatalog(result.details);
        }
      })
      .catch(() => {
        // A missing network or catalog never blocks bundled/local Adapters or native launch.
      })
      .finally(() => active && setCheckingAdapterCatalog(false));
    return () => { active = false; };
  }, [api]);

  useEffect(() => {
    if (!dashboard) return;
    setLastClientThemes((current) => {
      const valid = validLastClientThemes(current, dashboard);
      return sameClientThemes(current, valid) ? current : valid;
    });
  }, [dashboard]);

  useEffect(() => {
    try {
      window.localStorage.setItem(LAST_CLIENT_THEMES_STORAGE_KEY, JSON.stringify(lastClientThemes));
    } catch {
      // The remembered choices remain active for this session when persistence is unavailable.
    }
  }, [lastClientThemes]);

  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};
    windowApi.onCloseRequested(() => setClosePromptOpen(true))
      .then((stopListening) => {
        if (disposed) stopListening();
        else unlisten = stopListening;
      })
      .catch((reason: unknown) => {
        if (!disposed) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      disposed = true;
      unlisten();
    };
  }, [windowApi]);

  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};
    dropTarget.onThemePackageDrop((event) => {
      if (disposed) return;
      if (event.type === "enter" || event.type === "over") {
        setDragActive(true);
      } else if (event.type === "leave") {
        setDragActive(false);
      } else {
        setDragActive(false);
        droppedPathsHandler.current(event.paths);
      }
    }).then((stopListening) => {
      if (disposed) stopListening();
      else unlisten = stopListening;
    }).catch((reason: unknown) => {
      if (!disposed) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => {
      disposed = true;
      unlisten();
    };
  }, [dropTarget]);

  useEffect(() => {
    if (!closePromptOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = closeDialog.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !closeChoiceBusy.current) {
        event.preventDefault();
        setClosePromptOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [closePromptOpen]);

  useEffect(() => {
    if (!themeToDelete) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = deleteDialog.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !deletingThemeId) {
        event.preventDefault();
        setThemeToDelete(null);
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [themeToDelete, deletingThemeId]);

  useEffect(() => {
    if (loading) return;
    let disposed = false;
    let inFlight = false;
    const refresh = async () => {
      if (disposed || inFlight || operationPending.current || document.visibilityState === "hidden") return;
      inFlight = true;
      const requestGeneration = runtimeRefreshGeneration.current;
      try {
        await refreshRuntimeStates(() => !disposed && requestGeneration === runtimeRefreshGeneration.current && !operationPending.current);
      } catch {
        // Background status checks are best-effort. Manual rescan remains available.
      } finally {
        inFlight = false;
      }
    };
    const onFocus = () => { void refresh(); };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const interval = window.setInterval(() => { void refresh(); }, 2500);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      runtimeRefreshGeneration.current += 1;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loading, refreshRuntimeStates]);

  const selectedTheme = useMemo(() => dashboard?.themes.find((theme) => theme.id === selectedThemeId), [dashboard, selectedThemeId]);
  const adapters = useMemo(() => dashboard ? adapterEntries(dashboard, t) : [], [dashboard, t]);
  const capabilitiesById = useMemo(() => new Map(adapters.map(({ capability }) => [capability.adapterId, capability])), [adapters]);

  function themeForClient(clientId: ClientId): ThemeFamily | undefined {
    if (selectedTheme) return selectedTheme;
    const rememberedThemeId = lastClientThemes[clientId];
    return dashboard?.themes.find((theme) => theme.id === rememberedThemeId);
  }

  function rememberClientTheme(clientId: ClientId, themeId: string) {
    setLastClientThemes((current) => current[clientId] === themeId
      ? current
      : { ...current, [clientId]: themeId });
  }

  function patchClient(clientId: ClientId, patch: Partial<ClientState>) {
    setDashboard((current) => current ? { ...current, clients: current.clients.map((client) => client.id === clientId ? { ...client, ...patch } : client) } : current);
  }

  function chooseTheme(themeId: string) {
    setSelectedThemeId(themeId);
    setError(null);
  }

  function chooseAppearance(next: ManagerAppearance) {
    setAppearance(next);
    try {
      window.localStorage.setItem(APPEARANCE_STORAGE_KEY, next);
    } catch {
      // Appearance changes remain active for this session when persistence is unavailable.
    }
  }

  function chooseLocale(next: ManagerLocale) {
    setLocale(next);
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // Language changes remain active for this session when persistence is unavailable.
    }
  }

  async function perform(client: ClientState, operation: ClientOperation) {
    if (!dashboard || pending || deletingThemeId) return;
    if ((operation === "apply" || operation === "launch") && client.runState === "running") {
      setError(t("operation.clientMessage", { name: client.name, message: t("operation.alreadyRunning") }));
      return;
    }
    const capability = capabilitiesById.get(client.id);
    const runtimeOperation = operation === "apply" || operation === "launch" || operation === "pause" || operation === "restore";
    const runtimeAllowed = operation === "launch"
      ? Boolean(capability?.runtimeLaunchAvailable ?? (capability?.availability === "available" && capability.runtimeApplyAvailable))
      : capability?.availability === "available" && Boolean(capability.runtimeApplyAvailable);
    if (runtimeOperation && !runtimeAllowed) {
      setError(t("operation.clientMessage", { name: client.name, message: capability?.reason ? localizeRuntimeText(capability.reason, locale) : t("capability.runtimeSeamUnavailable") }));
      return;
    }
    setError(null);
    runtimeRefreshGeneration.current += 1;
    operationPending.current = true;
    setPending({ clientId: client.id, operation });
    try {
      let result: OperationResult;
      const clientTheme = themeForClient(client.id);
      if (operation === "apply") {
        if (!clientTheme) throw new Error(t("operation.chooseTheme"));
        result = await api.applyTheme(client.id, clientTheme.id, true);
      } else if (operation === "launch") result = await api.launchClient(client.id);
      else if (operation === "pause") result = await api.pauseTheme(client.id);
      else if (operation === "restore") result = await api.restoreTheme(client.id);
      else result = await api.refreshClient(client.id);
      if (result.status === "failed") {
        const message = localizeRuntimeText(result.message || result.code, locale);
        const showDiagnosticCode = result.code.startsWith("adapter-compile-") || result.code.startsWith("theme-compile-");
        throw new Error(showDiagnosticCode ? `${message}（${result.code}）` : message);
      }

      if (operation === "apply" && clientTheme) {
        rememberClientTheme(client.id, clientTheme.id);
        patchClient(client.id, { currentThemeId: clientTheme.id, currentThemeName: themeDisplay(clientTheme, locale).name, themePaused: false, runState: "running", detail: t("runtime.injected") });
      }
      if (operation === "launch") patchClient(client.id, { runState: "running", detail: t("runtime.nativeLaunch") });
      if (operation === "pause") patchClient(client.id, { themePaused: true, detail: t("runtime.paused") });
      if (operation === "restore") patchClient(client.id, { currentThemeId: null, currentThemeName: t("runtime.nativeAppearance"), themePaused: false, runState: "running", detail: t("runtime.nativeRunning") });
      if (operation === "refresh") {
        const fresh = await api.getDashboardState();
        setDashboard((current) => current ? { ...fresh, activities: current.activities } : fresh);
      }
    } catch (reason: unknown) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(t("operation.clientMessage", { name: client.name, message }));
    } finally {
      operationPending.current = false;
      setPending(null);
    }
  }

  function startNormally(client: ClientState) {
    const capability = capabilitiesById.get(client.id);
    const canRestoreTheme = client.adapterReady && capability?.availability === "available" && capability.runtimeApplyAvailable;
    void perform(client, canRestoreTheme && client.currentThemeId ? "restore" : "launch");
  }

  async function scanAllClients() {
    if (!dashboard || scanning || pending || deletingThemeId) return;
    setScanning(true);
    setError(null);
    try {
      const fresh = await api.getDashboardState();
      setDashboard((current) => ({ ...fresh, activities: current?.activities ?? fresh.activities }));
      if (!fresh.themes.some((theme) => theme.id === selectedThemeId)) setSelectedThemeId(null);
    } catch (reason: unknown) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(t("scan.errorPrefix", { message: localizeRuntimeText(message, locale) }));
    } finally {
      setScanning(false);
    }
  }

  async function importTheme() {
    if (importPending.current || pending || deletingThemeId) return;
    setError(null);
    try {
      const packagePath = await packagePicker.chooseThemePackage();
      if (!packagePath) return;
      await importThemePackageAtPath(packagePath);
    } catch (reason: unknown) {
      const message = reason instanceof Error ? reason.message : t("themes.importFailed");
      setError(message);
    }
  }

  async function importDroppedTheme(paths: string[]) {
    if (importPending.current || pending || deletingThemeId || loading) {
      setError(t("themes.dropBusy"));
      return;
    }
    if (paths.length !== 1) {
      setError(t("themes.dropSingle"));
      return;
    }
    const [packagePath] = paths;
    if (!packagePath.toLowerCase().endsWith(".cctheme")) {
      setError(t("themes.dropInvalid"));
      return;
    }
    await importThemePackageAtPath(packagePath);
  }

  async function importThemePackageAtPath(packagePath: string) {
    if (importPending.current) return;
    importPending.current = true;
    setImportingTheme(true);
    setError(null);
    try {
      const result = await api.importThemePackage(packagePath);
      if (result.status === "failed") throw new Error(t("themes.importFailed"));
      const fresh = await api.getDashboardState();
      setDashboard((current) => ({ ...fresh, activities: current?.activities ?? fresh.activities }));
      const importedThemeId = result.details?.themeId;
      if (importedThemeId && fresh.themes.some((theme) => theme.id === importedThemeId)) {
        setSelectedThemeId(importedThemeId);
      }
    } catch (reason: unknown) {
      const message = reason instanceof Error ? reason.message : t("themes.importFailed");
      setError(message);
    } finally {
      importPending.current = false;
      setImportingTheme(false);
    }
  }

  async function refreshAdapterCatalog(force: boolean, reportFailure: boolean) {
    setCheckingAdapterCatalog(true);
    try {
      const result = await api.checkAdapterUpdates(force);
      if (result.status === "failed" || !result.details) {
        if (reportFailure) throw new Error(t("adapter.checkFailedWithCode", { code: result.code }));
        return;
      }
      setAdapterCatalog(result.details);
    } catch (reason: unknown) {
      if (reportFailure) setError(reason instanceof Error ? reason.message : t("adapter.checkFailed"));
    } finally {
      setCheckingAdapterCatalog(false);
    }
  }

  async function importAdapter(client: ClientState) {
    if (adapterInstallPending.current || installingAdapterId || pending || deletingThemeId) return;
    adapterInstallPending.current = true;
    operationPending.current = true;
    setInstallingAdapterId(client.id);
    setError(null);
    try {
      const packagePath = await adapterPicker.chooseAdapterPackage();
      if (!packagePath) return;
      const result = await api.installLocalAdapter(client.id, packagePath);
      if (result.status === "failed") throw new Error(t("adapter.installFailedWithCode", { code: result.code }));
      const fresh = await api.getDashboardState();
      setDashboard((current) => ({ ...fresh, activities: current?.activities ?? fresh.activities }));
      await refreshAdapterCatalog(false, false);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : t("adapter.installFailed"));
    } finally {
      adapterInstallPending.current = false;
      operationPending.current = false;
      setInstallingAdapterId(null);
    }
  }

  async function downloadAdapter(client: ClientState) {
    if (adapterInstallPending.current || installingAdapterId || pending || deletingThemeId) return;
    adapterInstallPending.current = true;
    operationPending.current = true;
    setInstallingAdapterId(client.id);
    setError(null);
    try {
      const result = await api.downloadLatestAdapter(client.id);
      if (result.status === "failed") throw new Error(t("adapter.downloadFailedWithCode", { code: result.code }));
      const fresh = await api.getDashboardState();
      setDashboard((current) => ({ ...fresh, activities: current?.activities ?? fresh.activities }));
      await refreshAdapterCatalog(false, false);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : t("adapter.downloadFailed"));
    } finally {
      adapterInstallPending.current = false;
      operationPending.current = false;
      setInstallingAdapterId(null);
    }
  }

  async function confirmThemeDeletion() {
    if (!themeToDelete || deletingThemeId || pending || importingTheme) return;
    const theme = themeToDelete;
    setDeletingThemeId(theme.id);
    setError(null);
    operationPending.current = true;
    runtimeRefreshGeneration.current += 1;
    try {
      const result = await api.deleteLocalTheme(theme.id);
      if (result.status === "failed") throw new Error(result.message || t("themes.deleteFailed"));
      const fresh = await api.getDashboardState();
      setDashboard((current) => ({ ...fresh, activities: current?.activities ?? fresh.activities }));
      if (selectedThemeId === theme.id) setSelectedThemeId(null);
      setLastClientThemes((current) => Object.fromEntries(
        Object.entries(current).filter(([, themeId]) => themeId !== theme.id),
      ));
      setThemeToDelete(null);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : t("themes.deleteFailed"));
    } finally {
      operationPending.current = false;
      setDeletingThemeId(null);
    }
  }

  async function resolveCloseChoice(choice: "minimize" | "quit") {
    setCloseChoicePending(choice);
    setError(null);
    try {
      if (choice === "minimize") {
        await windowApi.minimizeToMenuBar();
        setClosePromptOpen(false);
      } else {
        await windowApi.quitManager();
      }
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCloseChoicePending(null);
    }
  }

  if (loading) return <main className="loading-screen"><img className="loading-app-icon" src={appIconUrl} alt="" /><strong>{t("loading.clients")}</strong><span className="loading-bar"><i /></span></main>;

  if (!dashboard) return <main className="fatal-screen"><Icon name="warning" /><h1>{t("fatal.title")}</h1><p>{error ? localizeRuntimeText(error, locale) : t("fatal.noState")}</p><button className="button button--primary" onClick={() => window.location.reload()}>{t("fatal.reload")}</button></main>;

  return (
    <div className="app-shell">
      {dragActive && (
        <div className="theme-drop-overlay" role="status" aria-live="polite">
          <span className="theme-drop-overlay__icon"><Icon name="download" /></span>
          <strong>{t("themes.dropTitle")}</strong>
          <small>{t("themes.dropHint")}</small>
        </div>
      )}
      {error && <div className="error-banner" role="alert"><Icon name="warning" /><span><strong>{t("error.title")}</strong>{localizeRuntimeText(error, locale)}</span><button type="button" aria-label={t("error.dismiss")} onClick={() => setError(null)}>×</button></div>}

      {closePromptOpen && (
        <div className="modal-backdrop">
          <section ref={closeDialog} className="close-dialog" role="dialog" aria-modal="true" aria-labelledby="close-dialog-title">
            <span className="dialog-warning"><Icon name="warning" /></span>
            <h2 id="close-dialog-title">{t("close.title")}</h2>
            <p>{t("close.body")}</p>
            <div className="dialog-actions">
              <button className="button button--secondary" type="button" disabled={Boolean(closeChoicePending)} onClick={() => void resolveCloseChoice("minimize")}>
                {closeChoicePending === "minimize" && <span className="spinner" />}{t("close.minimize")}
              </button>
              <button className="button button--danger" type="button" disabled={Boolean(closeChoicePending)} onClick={() => void resolveCloseChoice("quit")}>
                {closeChoicePending === "quit" && <span className="spinner" />}{t("close.quit")}
              </button>
            </div>
          </section>
        </div>
      )}

      {themeToDelete && (
        <div className="modal-backdrop">
          <section ref={deleteDialog} className="close-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-theme-dialog-title">
            <span className="dialog-warning dialog-warning--danger"><Icon name="trash" /></span>
            <h2 id="delete-theme-dialog-title">{t("themes.deleteTitle", { name: themeDisplay(themeToDelete, locale).name })}</h2>
            <p>{t("themes.deleteBody")}</p>
            <div className="dialog-actions">
              <button className="button button--secondary" type="button" disabled={Boolean(deletingThemeId)} onClick={() => setThemeToDelete(null)}>
                {t("themes.deleteCancel")}
              </button>
              <button className="button button--danger" type="button" disabled={Boolean(deletingThemeId)} onClick={() => void confirmThemeDeletion()}>
                {deletingThemeId && <span className="spinner" />}{deletingThemeId ? t("themes.deleting") : t("themes.deleteConfirm")}
              </button>
            </div>
          </section>
        </div>
      )}

      <div className="workspace">
        <main className="main-content">
          <section className="tool-heading">
            <h1>{t("main.title")}</h1>
            <div className="tool-heading__actions">
              <div className="language-switch" role="group" aria-label={t("language.group")}>
                <button type="button" aria-label={t("language.chinese")} aria-pressed={locale === "zh-CN"} onClick={() => chooseLocale("zh-CN")}>中</button>
                <button type="button" aria-label={t("language.english")} aria-pressed={locale === "en-US"} onClick={() => chooseLocale("en-US")}>EN</button>
              </div>
              <div className="appearance-switch" role="group" aria-label={t("appearance.group")}>
                <button type="button" aria-label="Light" aria-pressed={appearance === "light"} onClick={() => chooseAppearance("light")}><Icon name="sun" /><span>Light</span></button>
                <button type="button" aria-label="Dark" aria-pressed={appearance === "dark"} onClick={() => chooseAppearance("dark")}><Icon name="moon" /><span>Dark</span></button>
              </div>
              <button className="button button--secondary button--small" type="button" disabled={Boolean(pending) || Boolean(deletingThemeId) || scanning} onClick={() => void scanAllClients()}>{scanning ? <span className="spinner" /> : <Icon name="refresh" />}{scanning ? t("scan.running") : t("scan.rescan")}</button>
            </div>
          </section>

          <section className="themes-section">
            <div className="section-heading"><div><span className="eyebrow">{t("themes.eyebrow")}</span><h2>{t("themes.title")}</h2></div><div className="theme-heading-actions"><button className="button button--secondary button--small" type="button" disabled={importingTheme || Boolean(pending) || Boolean(deletingThemeId)} onClick={() => void importTheme()}>{importingTheme ? <span className="spinner" /> : <Icon name="download" />}{importingTheme ? t("themes.importing") : t("themes.import")}</button></div></div>
            <div className="theme-grid">
              {dashboard.themes.length === 0 && <p className="theme-empty">{t("themes.empty")}</p>}
              {dashboard.themes.map((theme) => <ThemeCard key={theme.id} theme={theme} selected={selectedThemeId === theme.id} locale={locale} disabled={Boolean(pending) || Boolean(deletingThemeId)} t={t} onSelect={() => chooseTheme(theme.id)} onDelete={() => setThemeToDelete(theme)} />)}
            </div>
          </section>

          <section className="clients-section">
            <div className="section-heading"><div><span className="eyebrow">{t("clients.eyebrow")}</span><h2>{t("clients.title")}</h2></div></div>
            <div className="client-grid">
              {adapters.map(({ capability, client }) => <ClientCard key={capability.adapterId} capability={capability} client={client} theme={themeForClient(client.id)} currentTheme={dashboard.themes.find((theme) => theme.id === client.currentThemeId)} pending={pending} blocked={Boolean(deletingThemeId) || Boolean(installingAdapterId)} locale={locale} t={t} onNormalStart={startNormally} onAction={(target, operation) => void perform(target, operation)} installingAdapter={installingAdapterId === client.id} checkingAdapterCatalog={checkingAdapterCatalog} adapterUpdate={adapterCatalog?.adapters.find((entry) => entry.adapterId === client.id)} onDownloadAdapter={(target) => void downloadAdapter(target)} onImportAdapter={(target) => void importAdapter(target)} />)}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
