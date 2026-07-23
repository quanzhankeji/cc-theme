export type ClientId = string;
export type ClientRunState = "running" | "stopped" | "unknown";
export type SignatureState = "verified" | "unverified" | "unknown";
export type CompatibilityState = "ready" | "needs-update" | "unavailable";
export type OperationStatus = "success" | "failed";
export type AdapterAvailability = "available" | "contract-only" | "unavailable";

export interface AdapterCapability {
  adapterId: string;
  displayName: string;
  availability: AdapterAvailability;
  runtimeApplyAvailable: boolean;
  runtimeLaunchAvailable?: boolean;
  deepSettingsAvailable?: boolean;
  capabilityVersion?: string;
  catalogVersion?: string;
  reason: string;
}

export type AdapterUpdateStatus =
  | "current"
  | "update-available"
  | "host-not-installed"
  | "host-too-old"
  | "catalog-missing";

export interface AdapterUpdateState {
  adapterId: ClientId;
  status: AdapterUpdateStatus;
  latestVersion: string | null;
  latestReleaseRevision: number | null;
  source: "network" | "cache";
  message: string;
}

export interface AdapterCatalogStatus {
  sequence: number;
  source: "network" | "cache";
  checkedAt: string;
  adapters: AdapterUpdateState[];
}

export interface AdapterInstallDetails {
  adapterId: string;
  adapterVersion: string;
  adapterReleaseRevision: number;
  replacedLocalAdapter: boolean;
}

export interface AdapterDownloadDetails extends AdapterInstallDetails {
  assetIdentity: string;
  archiveSha256: string;
  catalogSequence: number;
}

export interface ClientState {
  id: ClientId;
  name: string;
  bundleId: string;
  discovered: boolean;
  version: string | null;
  signature: {
    status: SignatureState;
    teamId: string | null;
    label: string;
  };
  runState: ClientRunState;
  currentThemeId: string | null;
  currentThemeName: string;
  themePaused: boolean;
  adapterReady: boolean;
  adapterVersion?: string | null;
  adapterReleaseRevision?: number | null;
  adapterSource?: "bundled" | "local";
  adapterStatus?: "ready" | "missing" | "host-version-mismatch" | "compatibility-candidate";
  detail: string;
}

export interface ClientRuntimeState {
  id: ClientId;
  runState: ClientRunState;
}

export interface ThemeCompatibility {
  status: CompatibilityState;
  adapterVersion: string | null;
  note: string;
}

export interface ThemeAppearanceVariants {
  light: [string, string, string];
  dark: [string, string, string];
}

/** Semantic main-content veil stops for the static workbench preview. */
export interface ThemePresentationScrim {
  light: [string, string, string];
  dark: [string, string, string];
}

export interface ThemeFamily {
  id: string;
  name: string;
  author: string;
  description: string;
  defaultLocale?: string;
  localizations?: Record<string, { name: string; description: string }>;
  colors: [string, string, string];
  appearanceVariants?: ThemeAppearanceVariants;
  presentationSurfaceOpacity?: number;
  presentationScrim?: ThemePresentationScrim;
  previewUrl?: string | null;
  hasLocalDraft?: boolean;
  installed: boolean;
  updatedAt: string;
  compatibility: Record<string, ThemeCompatibility>;
}

export interface ActivityItem {
  id: string;
  clientId: ClientId | null;
  title: string;
  message: string;
  status: "running" | "success" | "failed" | "info";
  timestamp: string;
}

export interface DashboardState {
  capabilities: AdapterCapability[];
  clients: ClientState[];
  themes: ThemeFamily[];
  activities: ActivityItem[];
  lastRefreshedAt: string;
}

export interface DiagnosticCheck {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

export interface DiagnosticReport {
  clientId: ClientId | null;
  summary: string;
  generatedAt: string;
  checks: DiagnosticCheck[];
}

export interface OperationResult<TDetails = unknown> {
  status: OperationStatus;
  code: string;
  message: string;
  details?: TDetails;
}

export type ClientOperation = "apply" | "launch" | "pause" | "restore" | "refresh";
