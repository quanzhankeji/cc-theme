use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ClientId {
    #[serde(rename = "mac-codex")]
    Codex,
    #[serde(rename = "mac-doubao")]
    Doubao,
    #[serde(rename = "mac-workbuddy")]
    Workbuddy,
}

impl ClientId {
    pub const ALL: [Self; 3] = [Self::Codex, Self::Doubao, Self::Workbuddy];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Codex => "mac-codex",
            Self::Doubao => "mac-doubao",
            Self::Workbuddy => "mac-workbuddy",
        }
    }

    pub fn from_adapter_id(value: &str) -> Option<Self> {
        match value {
            "mac-codex" => Some(Self::Codex),
            "mac-doubao" => Some(Self::Doubao),
            "mac-workbuddy" => Some(Self::Workbuddy),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ClientOperation {
    Apply,
    Launch,
    Pause,
    Restore,
    Verify,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureInfo {
    pub status: SignatureState,
    pub team_id: Option<String>,
    pub label: String,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SignatureState {
    Verified,
    Unverified,
    Unknown,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ClientRunState {
    Running,
    Stopped,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientRuntimeState {
    pub id: ClientId,
    pub run_state: ClientRunState,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientState {
    pub id: ClientId,
    pub name: String,
    pub bundle_id: String,
    pub discovered: bool,
    pub version: Option<String>,
    pub build: Option<String>,
    pub signature: SignatureInfo,
    pub run_state: ClientRunState,
    pub current_theme_id: Option<String>,
    pub current_theme_name: String,
    pub theme_paused: bool,
    pub adapter_ready: bool,
    pub adapter_version: Option<String>,
    pub adapter_release_revision: Option<u64>,
    pub adapter_source: String,
    pub adapter_status: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeCompatibility {
    pub status: CompatibilityState,
    pub adapter_version: Option<String>,
    pub note: String,
}

/// A compact, display-only projection of a Theme Family's complete Light/Dark
/// semantic palettes. The editor uses this to render an honest preview while
/// the full palette remains inside the imported Theme Package.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeAppearancePreview {
    pub light: [String; 3],
    pub dark: [String; 3],
}

/// The three semantic stops used for the main-content veil in a presentation
/// profile. This is display metadata only: the authoritative values remain in
/// the imported Theme Package and are still resolved by each Adapter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemePresentationScrimPreview {
    pub light: [String; 3],
    pub dark: [String; 3],
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CompatibilityState {
    Ready,
    Unavailable,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeFamily {
    pub id: String,
    pub name: String,
    pub author: String,
    pub description: String,
    pub default_locale: String,
    pub localizations: std::collections::BTreeMap<String, LocalizedThemeDisplay>,
    pub colors: [String; 3],
    pub appearance_variants: Option<ThemeAppearancePreview>,
    /// The current local value of immersive-scene-v1's main content surface
    /// opacity. It is optional because ordinary Theme Families do not expose
    /// that presentation control.
    pub presentation_surface_opacity: Option<f64>,
    /// Semantic main-content veil stops for an honest static workbench
    /// preview. It is present only for the bounded immersive-scene profile.
    pub presentation_scrim: Option<ThemePresentationScrimPreview>,
    pub preview_url: Option<String>,
    /// A Manager-owned editable copy exists locally. The imported Theme
    /// Package remains the resettable baseline.
    pub has_local_draft: bool,
    pub installed: bool,
    pub updated_at: String,
    pub compatibility: std::collections::BTreeMap<String, ThemeCompatibility>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalizedThemeDisplay {
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityItem {
    pub id: String,
    pub client_id: Option<ClientId>,
    pub title: String,
    pub message: String,
    pub status: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardState {
    pub capabilities: Vec<AdapterCapability>,
    pub clients: Vec<ClientState>,
    pub themes: Vec<ThemeFamily>,
    pub activities: Vec<ActivityItem>,
    pub last_refreshed_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CapabilityAvailability {
    Available,
    ContractOnly,
    Unavailable,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterCapability {
    pub adapter_id: String,
    pub display_name: String,
    pub availability: CapabilityAvailability,
    pub runtime_apply_available: bool,
    pub runtime_launch_available: bool,
    pub deep_settings_available: bool,
    pub capability_version: Option<String>,
    pub catalog_id: Option<String>,
    pub catalog_version: Option<String>,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticCheck {
    pub id: String,
    pub label: String,
    pub status: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticReport {
    pub client_id: Option<ClientId>,
    pub summary: String,
    pub generated_at: String,
    pub checks: Vec<DiagnosticCheck>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationResult {
    pub status: OperationStatus,
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

impl OperationResult {
    pub fn success(code: impl Into<String>, message: impl Into<String>, details: Value) -> Self {
        Self {
            status: OperationStatus::Success,
            code: code.into(),
            message: message.into(),
            details: Some(details),
        }
    }

    pub fn failed(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            status: OperationStatus::Failed,
            code: code.into(),
            message: message.into(),
            details: None,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum OperationStatus {
    Success,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationProgress {
    pub operation_id: String,
    pub client_id: ClientId,
    pub operation: ClientOperation,
    pub stage: String,
    pub message: String,
    pub timestamp: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_ids_only_accept_and_write_canonical_identities() {
        assert_eq!(
            serde_json::to_string(&ClientId::Codex).unwrap(),
            "\"mac-codex\""
        );
        assert_eq!(
            serde_json::to_string(&ClientId::Doubao).unwrap(),
            "\"mac-doubao\""
        );
        assert_eq!(
            serde_json::to_string(&ClientId::Workbuddy).unwrap(),
            "\"mac-workbuddy\""
        );
        assert!(serde_json::from_str::<ClientId>("\"mac-retired\"").is_err());
        assert!(serde_json::from_str::<ClientId>("\"mac-codex-skin\"").is_err());
        assert!(serde_json::from_str::<ClientId>("\"mac-workbuddy-skin\"").is_err());
    }
}
