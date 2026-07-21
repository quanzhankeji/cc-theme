use base64::{engine::general_purpose::STANDARD, Engine as _};
use chrono::{DateTime, Utc};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use semver::Version;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use url::Url;

const OFFICIAL_KEY_ID: &str = "cc-theme-adapter-root-2026-07";
const OFFICIAL_PUBLIC_KEY_BASE64: &str = "B0O8iJ0ugN6p5+nm4wozzH4uW2CdgCxGuMNoFtpqPlY=";
const MANAGER_VERSION: &str = env!("CARGO_PKG_VERSION");
const MAX_CATALOG_BYTES: u64 = 1024 * 1024;
const MAX_SIGNATURE_BYTES: u64 = 4096;
const MAX_POINTER_BYTES: u64 = 64 * 1024;
const CHECK_TTL_SECONDS: i64 = 12 * 60 * 60;
const STABLE_POINTER_URL: &str =
    "https://raw.githubusercontent.com/quanzhankeji/cc-theme/main/app/registry/channels/stable.json";
const STABLE_SIGNATURE_URL: &str =
    "https://raw.githubusercontent.com/quanzhankeji/cc-theme/main/app/registry/channels/stable.json.sig";
static CATALOG_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AdapterChannelPointer {
    kind: String,
    schema_version: u64,
    channel: String,
    sequence: u64,
    issued_at: String,
    expires_at: String,
    key_id: String,
    catalog: CatalogPointer,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CatalogPointer {
    url: String,
    signature_url: String,
    bytes: u64,
    sha256: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AdapterReleaseCatalog {
    kind: String,
    schema_version: u64,
    publication_status: String,
    current_version_policy: String,
    channel: String,
    sequence: u64,
    published_at: String,
    expires_at: String,
    key_id: String,
    revoked_sha256: Vec<String>,
    adapters: Vec<CatalogAdapter>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CatalogAdapter {
    adapter_id: String,
    current: CatalogCurrent,
    releases: Vec<CatalogRelease>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CatalogCurrent {
    adapter_version: String,
    adapter_release_revision: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CatalogRelease {
    adapter_version: String,
    adapter_release_revision: u64,
    asset_identity: String,
    contracts: CatalogContracts,
    packages: Vec<CatalogPackage>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CatalogContracts {
    minimum_manager_version: String,
    capability_version: String,
    unified_theme_schema_version: u64,
    adapter_package_schema_version: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CatalogPackage {
    platform: String,
    architecture: String,
    asset_name: String,
    bytes: u64,
    sha256: String,
    manifest_sha256: String,
    release_tag: String,
    download_url: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AdapterCatalogEntry {
    pub adapter_id: String,
    pub adapter_version: String,
    pub adapter_release_revision: u64,
    pub asset_identity: String,
    pub asset_name: String,
    pub bytes: u64,
    pub sha256: String,
    pub manifest_sha256: String,
    pub release_tag: String,
    pub download_url: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AdapterUpdateState {
    pub adapter_id: String,
    pub status: String,
    pub latest_version: Option<String>,
    pub latest_release_revision: Option<u64>,
    pub source: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterCatalogStatus {
    pub sequence: u64,
    pub source: String,
    pub checked_at: String,
    pub adapters: Vec<AdapterUpdateState>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterDownloadReceipt {
    pub adapter_id: String,
    pub adapter_version: String,
    pub adapter_release_revision: u64,
    pub asset_identity: String,
    pub archive_sha256: String,
    pub replaced_local_adapter: bool,
    pub catalog_sequence: u64,
}

#[derive(Debug, Clone)]
struct VerifiedCatalogSnapshot {
    sequence: u64,
    source: &'static str,
    checked_at: DateTime<Utc>,
    entries: Vec<AdapterCatalogEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AdapterMetadataState {
    kind: String,
    schema_version: u64,
    highest_sequence: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    active_snapshot: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    stable_etag: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    checked_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DetachedSignature {
    kind: String,
    schema_version: u64,
    key_id: String,
    algorithm: String,
    signed_sha256: String,
    signature: String,
}

fn verify_ed25519(
    payload: &[u8],
    public_key_base64: &str,
    signature_base64: &str,
) -> Result<(), &'static str> {
    let public_key: [u8; 32] = STANDARD
        .decode(public_key_base64)
        .map_err(|_| "adapter-metadata-key-invalid")?
        .try_into()
        .map_err(|_| "adapter-metadata-key-invalid")?;
    let signature: [u8; 64] = STANDARD
        .decode(signature_base64)
        .map_err(|_| "adapter-metadata-signature-invalid")?
        .try_into()
        .map_err(|_| "adapter-metadata-signature-invalid")?;
    VerifyingKey::from_bytes(&public_key)
        .map_err(|_| "adapter-metadata-key-invalid")?
        .verify(payload, &Signature::from_bytes(&signature))
        .map_err(|_| "adapter-metadata-signature-invalid")
}

fn verify_signed_json<T: DeserializeOwned>(
    payload: &[u8],
    signature_document: &[u8],
    trusted_key_id: &str,
    public_key_base64: &str,
) -> Result<T, String> {
    let detached: DetachedSignature = serde_json::from_slice(signature_document)
        .map_err(|_| "adapter-metadata-signature-document-invalid".to_string())?;
    if detached.kind != "cc-theme.ed25519-signature"
        || detached.schema_version != 1
        || detached.key_id != trusted_key_id
        || detached.algorithm != "Ed25519"
        || detached.signed_sha256 != format!("{:x}", Sha256::digest(payload))
    {
        return Err("adapter-metadata-signature-document-invalid".to_string());
    }
    verify_ed25519(payload, public_key_base64, &detached.signature).map_err(ToOwned::to_owned)?;
    serde_json::from_slice(payload).map_err(|_| "adapter-metadata-payload-invalid".to_string())
}

fn parse_rfc3339(value: &str) -> Result<DateTime<Utc>, String> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.with_timezone(&Utc))
        .map_err(|_| "adapter-metadata-time-invalid".to_string())
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
}

fn validate_freshness(issued_at: &str, expires_at: &str, now: DateTime<Utc>) -> Result<(), String> {
    let issued = parse_rfc3339(issued_at)?;
    let expires = parse_rfc3339(expires_at)?;
    if issued > now || expires <= now || expires <= issued {
        return Err("adapter-metadata-expired-or-not-yet-valid".to_string());
    }
    Ok(())
}

fn validate_catalog_pointer_url(value: &str, sequence: u64, signature: bool) -> bool {
    let Ok(url) = Url::parse(value) else {
        return false;
    };
    if url.scheme() != "https"
        || url.host_str() != Some("raw.githubusercontent.com")
        || url.username() != ""
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return false;
    }
    let suffix = if signature { ".json.sig" } else { ".json" };
    let expected_tail = format!("/app/registry/catalogs/stable/{sequence:06}{suffix}");
    let Some(prefix) = url.path().strip_suffix(&expected_tail) else {
        return false;
    };
    let Some(commit) = prefix.strip_prefix("/quanzhankeji/cc-theme/") else {
        return false;
    };
    commit.len() == 40
        && commit
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
}

fn validate_channel_pointer(
    pointer: &AdapterChannelPointer,
    now: DateTime<Utc>,
    highest_seen_sequence: u64,
) -> Result<(), String> {
    if pointer.kind != "cc-theme.adapter-channel-pointer"
        || pointer.schema_version != 1
        || pointer.channel != "stable"
        || pointer.sequence == 0
        || pointer.sequence < highest_seen_sequence
        || pointer.key_id != OFFICIAL_KEY_ID
        || pointer.catalog.bytes < 2
        || pointer.catalog.bytes > MAX_CATALOG_BYTES
        || !valid_sha256(&pointer.catalog.sha256)
        || !validate_catalog_pointer_url(&pointer.catalog.url, pointer.sequence, false)
        || !validate_catalog_pointer_url(&pointer.catalog.signature_url, pointer.sequence, true)
        || pointer.catalog.signature_url != format!("{}.sig", pointer.catalog.url)
    {
        return Err("adapter-channel-pointer-invalid".to_string());
    }
    validate_freshness(&pointer.issued_at, &pointer.expires_at, now)
}

fn valid_release_download_url(package: &CatalogPackage) -> bool {
    let Ok(url) = Url::parse(&package.download_url) else {
        return false;
    };
    url.scheme() == "https"
        && url.host_str() == Some("github.com")
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
        && url.path()
            == format!(
                "/quanzhankeji/cc-theme/releases/download/{}/{}",
                package.release_tag, package.asset_name
            )
        && package.release_tag.starts_with("cc-theme-v")
}

fn runtime_architecture() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "unsupported"
    }
}

fn valid_public_semver(value: &str) -> bool {
    value.len() <= 80
        && !value.contains('+')
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-'))
        && Version::parse(value).is_ok()
}

fn validate_catalog(
    catalog: &AdapterReleaseCatalog,
    pointer: &AdapterChannelPointer,
    now: DateTime<Utc>,
) -> Result<Vec<AdapterCatalogEntry>, String> {
    if catalog.kind != "cc-theme.adapter-release-catalog"
        || catalog.schema_version != 1
        || catalog.publication_status != "published"
        || catalog.current_version_policy != "explicit"
        || catalog.channel != "stable"
        || catalog.sequence != pointer.sequence
        || catalog.key_id != OFFICIAL_KEY_ID
        || catalog.expires_at != pointer.expires_at
        || catalog.adapters.is_empty()
        || catalog.adapters.len() > 2
    {
        return Err("adapter-catalog-invalid".to_string());
    }
    validate_freshness(&catalog.published_at, &catalog.expires_at, now)?;
    let published_at = parse_rfc3339(&catalog.published_at)?;
    let pointer_issued_at = parse_rfc3339(&pointer.issued_at)?;
    if published_at > pointer_issued_at {
        return Err("adapter-catalog-invalid".to_string());
    }
    let revoked: BTreeSet<_> = catalog.revoked_sha256.iter().cloned().collect();
    if revoked.len() != catalog.revoked_sha256.len()
        || revoked.iter().any(|digest| !valid_sha256(digest))
    {
        return Err("adapter-catalog-invalid".to_string());
    }
    let manager_version =
        Version::parse(MANAGER_VERSION).map_err(|_| "adapter-catalog-invalid".to_string())?;
    let mut adapter_ids = BTreeSet::new();
    let mut result = Vec::new();
    for adapter in &catalog.adapters {
        if !matches!(adapter.adapter_id.as_str(), "mac-codex" | "mac-workbuddy")
            || !adapter_ids.insert(adapter.adapter_id.as_str())
            || adapter.current.adapter_release_revision == 0
            || !valid_public_semver(&adapter.current.adapter_version)
            || adapter.releases.is_empty()
            || adapter.releases.len() > 100
        {
            return Err("adapter-catalog-invalid".to_string());
        }
        let mut release_ids = BTreeSet::new();
        for release in &adapter.releases {
            if !valid_public_semver(&release.adapter_version)
                || release.adapter_release_revision == 0
                || !release_ids.insert((
                    release.adapter_version.as_str(),
                    release.adapter_release_revision,
                ))
                || !valid_public_semver(&release.contracts.minimum_manager_version)
                || !valid_public_semver(&release.contracts.capability_version)
                || release.contracts.unified_theme_schema_version != 1
                || release.contracts.adapter_package_schema_version != 1
                || release.packages.is_empty()
                || release.packages.len() > 6
            {
                return Err("adapter-catalog-invalid".to_string());
            }
            let mut package_targets = BTreeSet::new();
            for package in &release.packages {
                let expected_identity = format!(
                    "{}-{}-r{}-{}-{}",
                    adapter.adapter_id,
                    release.adapter_version,
                    release.adapter_release_revision,
                    package.platform,
                    package.architecture
                );
                if package.platform != "macos"
                    || package.architecture != "arm64"
                    || !package_targets
                        .insert((package.platform.as_str(), package.architecture.as_str()))
                    || release.asset_identity != expected_identity
                    || package.asset_name != format!("{}.ccadapter", release.asset_identity)
                    || package.bytes == 0
                    || package.bytes > 40 * 1024 * 1024
                    || !valid_sha256(&package.sha256)
                    || !valid_sha256(&package.manifest_sha256)
                    || !valid_release_download_url(package)
                {
                    return Err("adapter-catalog-package-invalid".to_string());
                }
            }
        }
        let release = adapter
            .releases
            .iter()
            .find(|release| {
                release.adapter_version == adapter.current.adapter_version
                    && release.adapter_release_revision == adapter.current.adapter_release_revision
            })
            .ok_or_else(|| "adapter-catalog-current-release-missing".to_string())?;
        let minimum_manager = Version::parse(&release.contracts.minimum_manager_version)
            .map_err(|_| "adapter-catalog-invalid".to_string())?;
        if minimum_manager > manager_version
            || release.adapter_release_revision == 0
            || !valid_public_semver(&release.adapter_version)
            || !valid_public_semver(&release.contracts.capability_version)
            || release.contracts.unified_theme_schema_version != 1
            || release.contracts.adapter_package_schema_version != 1
        {
            return Err("adapter-catalog-manager-incompatible".to_string());
        }
        let package = release
            .packages
            .iter()
            .find(|package| {
                package.platform == "macos" && package.architecture == runtime_architecture()
            })
            .ok_or_else(|| "adapter-catalog-package-unavailable".to_string())?;
        if revoked.contains(&package.sha256) {
            return Err("adapter-catalog-package-invalid".to_string());
        }
        result.push(AdapterCatalogEntry {
            adapter_id: adapter.adapter_id.clone(),
            adapter_version: release.adapter_version.clone(),
            adapter_release_revision: release.adapter_release_revision,
            asset_identity: release.asset_identity.clone(),
            asset_name: package.asset_name.clone(),
            bytes: package.bytes,
            sha256: package.sha256.clone(),
            manifest_sha256: package.manifest_sha256.clone(),
            release_tag: package.release_tag.clone(),
            download_url: package.download_url.clone(),
        });
    }
    result.sort_by(|left, right| left.adapter_id.cmp(&right.adapter_id));
    Ok(result)
}

fn verify_channel_pointer_with_key(
    payload: &[u8],
    signature_document: &[u8],
    public_key_base64: &str,
    now: DateTime<Utc>,
    highest_seen_sequence: u64,
) -> Result<AdapterChannelPointer, String> {
    let pointer: AdapterChannelPointer = verify_signed_json(
        payload,
        signature_document,
        OFFICIAL_KEY_ID,
        public_key_base64,
    )?;
    validate_channel_pointer(&pointer, now, highest_seen_sequence)?;
    Ok(pointer)
}

fn verify_catalog_with_key(
    payload: &[u8],
    signature_document: &[u8],
    pointer: &AdapterChannelPointer,
    public_key_base64: &str,
    now: DateTime<Utc>,
) -> Result<Vec<AdapterCatalogEntry>, String> {
    if payload.len() as u64 != pointer.catalog.bytes
        || format!("{:x}", Sha256::digest(payload)) != pointer.catalog.sha256
    {
        return Err("adapter-catalog-download-mismatch".to_string());
    }
    let catalog: AdapterReleaseCatalog = verify_signed_json(
        payload,
        signature_document,
        OFFICIAL_KEY_ID,
        public_key_base64,
    )?;
    validate_catalog(&catalog, pointer, now)
}

fn verify_official_channel_pointer(
    payload: &[u8],
    signature_document: &[u8],
    now: DateTime<Utc>,
    highest_seen_sequence: u64,
) -> Result<AdapterChannelPointer, String> {
    verify_channel_pointer_with_key(
        payload,
        signature_document,
        OFFICIAL_PUBLIC_KEY_BASE64,
        now,
        highest_seen_sequence,
    )
}

fn verify_official_catalog(
    payload: &[u8],
    signature_document: &[u8],
    pointer: &AdapterChannelPointer,
    now: DateTime<Utc>,
) -> Result<Vec<AdapterCatalogEntry>, String> {
    verify_catalog_with_key(
        payload,
        signature_document,
        pointer,
        OFFICIAL_PUBLIC_KEY_BASE64,
        now,
    )
}

fn metadata_cache_root() -> PathBuf {
    crate::registry::manager_adapter_library_root()
        .parent()
        .unwrap_or_else(|| Path::new("/nonexistent"))
        .join("adapter-metadata")
}

fn read_small_file(path: &Path, maximum: u64) -> Result<Vec<u8>, String> {
    let metadata =
        fs::symlink_metadata(path).map_err(|_| "adapter-metadata-cache-unavailable".to_string())?;
    if !metadata.file_type().is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() < 2
        || metadata.len() > maximum
    {
        return Err("adapter-metadata-cache-invalid".to_string());
    }
    fs::read(path).map_err(|_| "adapter-metadata-cache-unavailable".to_string())
}

fn read_metadata_state(root: &Path) -> AdapterMetadataState {
    let Ok(bytes) = read_small_file(&root.join("state.json"), MAX_POINTER_BYTES) else {
        return AdapterMetadataState::default();
    };
    let Ok(state) = serde_json::from_slice::<AdapterMetadataState>(&bytes) else {
        return AdapterMetadataState::default();
    };
    if state.kind != "cc-theme.adapter-metadata-state" || state.schema_version != 1 {
        return AdapterMetadataState::default();
    }
    state
}

fn cache_is_fresh(state: &AdapterMetadataState, now: DateTime<Utc>) -> bool {
    state
        .checked_at
        .as_deref()
        .and_then(|value| parse_rfc3339(value).ok())
        .is_some_and(|checked| {
            let age = now.signed_duration_since(checked).num_seconds();
            (0..CHECK_TTL_SECONDS).contains(&age)
        })
}

fn ensure_private_directory(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|_| "adapter-metadata-cache-write-failed".to_string())?;
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| "adapter-metadata-cache-write-failed".to_string())?;
    if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
        return Err("adapter-metadata-cache-write-failed".to_string());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|_| "adapter-metadata-cache-write-failed".to_string())?;
    }
    Ok(())
}

fn atomic_write(root: &Path, name: &str, bytes: &[u8]) -> Result<(), String> {
    ensure_private_directory(root)?;
    let temporary = root.join(format!(".{name}.{}.tmp", std::process::id()));
    let final_path = root.join(name);
    let mut output = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(|_| "adapter-metadata-cache-write-failed".to_string())?;
    output
        .write_all(bytes)
        .and_then(|_| output.sync_all())
        .map_err(|_| "adapter-metadata-cache-write-failed".to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600))
            .map_err(|_| "adapter-metadata-cache-write-failed".to_string())?;
    }
    fs::rename(&temporary, &final_path)
        .map_err(|_| "adapter-metadata-cache-write-failed".to_string())?;
    Ok(())
}

struct CachedMetadata<'a> {
    pointer: &'a [u8],
    pointer_signature: &'a [u8],
    catalog: &'a [u8],
    catalog_signature: &'a [u8],
}

fn persist_metadata_cache(
    root: &Path,
    files: CachedMetadata<'_>,
    state: &AdapterMetadataState,
) -> Result<(), String> {
    let snapshot_name = state
        .active_snapshot
        .as_deref()
        .filter(|name| {
            !name.is_empty()
                && name.len() <= 96
                && name
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f' | b'-'))
        })
        .ok_or_else(|| "adapter-metadata-cache-write-failed".to_string())?;
    ensure_private_directory(root)?;
    let snapshots = root.join("snapshots");
    ensure_private_directory(&snapshots)?;
    let snapshot = snapshots.join(snapshot_name);
    ensure_private_directory(&snapshot)?;
    atomic_write(&snapshot, "stable.json", files.pointer)?;
    atomic_write(&snapshot, "stable.json.sig", files.pointer_signature)?;
    atomic_write(&snapshot, "catalog.json", files.catalog)?;
    atomic_write(&snapshot, "catalog.json.sig", files.catalog_signature)?;
    let state =
        serde_json::to_vec(state).map_err(|_| "adapter-metadata-cache-write-failed".to_string())?;
    atomic_write(root, "state.json", &state)
}

fn load_cached_catalog_with_key(
    root: &Path,
    public_key_base64: &str,
    now: DateTime<Utc>,
) -> Result<VerifiedCatalogSnapshot, String> {
    let state = read_metadata_state(root);
    let snapshot_name = state
        .active_snapshot
        .as_deref()
        .filter(|name| {
            !name.is_empty()
                && name.len() <= 96
                && name
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f' | b'-'))
        })
        .ok_or_else(|| "adapter-metadata-cache-invalid".to_string())?;
    let snapshot = root.join("snapshots").join(snapshot_name);
    let snapshot_metadata = fs::symlink_metadata(&snapshot)
        .map_err(|_| "adapter-metadata-cache-unavailable".to_string())?;
    if !snapshot_metadata.file_type().is_dir() || snapshot_metadata.file_type().is_symlink() {
        return Err("adapter-metadata-cache-invalid".to_string());
    }
    let pointer_bytes = read_small_file(&snapshot.join("stable.json"), MAX_POINTER_BYTES)?;
    let pointer_signature =
        read_small_file(&snapshot.join("stable.json.sig"), MAX_SIGNATURE_BYTES)?;
    let pointer = verify_channel_pointer_with_key(
        &pointer_bytes,
        &pointer_signature,
        public_key_base64,
        now,
        state.highest_sequence,
    )?;
    let catalog_bytes = read_small_file(&snapshot.join("catalog.json"), MAX_CATALOG_BYTES)?;
    let catalog_signature =
        read_small_file(&snapshot.join("catalog.json.sig"), MAX_SIGNATURE_BYTES)?;
    let entries = verify_catalog_with_key(
        &catalog_bytes,
        &catalog_signature,
        &pointer,
        public_key_base64,
        now,
    )?;
    Ok(VerifiedCatalogSnapshot {
        sequence: pointer.sequence,
        source: "cache",
        checked_at: state
            .checked_at
            .as_deref()
            .and_then(|value| parse_rfc3339(value).ok())
            .unwrap_or(now),
        entries,
    })
}

enum HttpMetadata {
    NotModified,
    Bytes {
        bytes: Vec<u8>,
        etag: Option<String>,
    },
}

fn metadata_http_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent(format!("CC-Theme/{MANAGER_VERSION}"))
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "adapter-metadata-network-unavailable".to_string())
}

fn fetch_metadata(
    client: &reqwest::blocking::Client,
    url: &str,
    maximum: u64,
    etag: Option<&str>,
) -> Result<HttpMetadata, String> {
    let mut request = client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/json");
    if let Some(etag) = etag.filter(|value| {
        !value.is_empty() && value.len() <= 256 && value.bytes().all(|byte| byte.is_ascii_graphic())
    }) {
        request = request.header(reqwest::header::IF_NONE_MATCH, etag);
    }
    let response = request
        .send()
        .map_err(|_| "adapter-metadata-network-unavailable".to_string())?;
    if response.status() == reqwest::StatusCode::NOT_MODIFIED {
        return Ok(HttpMetadata::NotModified);
    }
    if response.status() != reqwest::StatusCode::OK {
        return Err("adapter-metadata-http-failed".to_string());
    }
    if response.content_length().is_some_and(|size| size > maximum) {
        return Err("adapter-metadata-download-too-large".to_string());
    }
    let response_etag = response
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|value| value.to_str().ok())
        .filter(|value| value.len() <= 256 && value.bytes().all(|byte| byte.is_ascii_graphic()))
        .map(ToOwned::to_owned);
    let mut bytes = Vec::new();
    response
        .take(maximum + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "adapter-metadata-network-unavailable".to_string())?;
    if bytes.len() < 2 || bytes.len() as u64 > maximum {
        return Err("adapter-metadata-download-too-large".to_string());
    }
    Ok(HttpMetadata::Bytes {
        bytes,
        etag: response_etag,
    })
}

fn refresh_official_catalog(
    root: &Path,
    now: DateTime<Utc>,
    force: bool,
) -> Result<VerifiedCatalogSnapshot, String> {
    let _guard = CATALOG_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "adapter-metadata-busy".to_string())?;
    let mut state = read_metadata_state(root);
    if !force && cache_is_fresh(&state, now) {
        if let Ok(snapshot) = load_cached_catalog_with_key(root, OFFICIAL_PUBLIC_KEY_BASE64, now) {
            return Ok(snapshot);
        }
    }

    let online = (|| {
        let client = metadata_http_client()?;
        let pointer_response = fetch_metadata(
            &client,
            STABLE_POINTER_URL,
            MAX_POINTER_BYTES,
            state.stable_etag.as_deref(),
        )?;
        if matches!(pointer_response, HttpMetadata::NotModified) {
            let mut cached = load_cached_catalog_with_key(root, OFFICIAL_PUBLIC_KEY_BASE64, now)?;
            state.checked_at = Some(now.to_rfc3339());
            let state_bytes = serde_json::to_vec(&state)
                .map_err(|_| "adapter-metadata-cache-write-failed".to_string())?;
            atomic_write(root, "state.json", &state_bytes)?;
            cached.checked_at = now;
            return Ok(cached);
        }
        let HttpMetadata::Bytes {
            bytes: pointer_bytes,
            etag,
        } = pointer_response
        else {
            unreachable!();
        };
        let HttpMetadata::Bytes {
            bytes: pointer_signature,
            ..
        } = fetch_metadata(&client, STABLE_SIGNATURE_URL, MAX_SIGNATURE_BYTES, None)?
        else {
            return Err("adapter-metadata-http-failed".to_string());
        };
        let pointer = verify_official_channel_pointer(
            &pointer_bytes,
            &pointer_signature,
            now,
            state.highest_sequence,
        )?;
        let HttpMetadata::Bytes {
            bytes: catalog_bytes,
            ..
        } = fetch_metadata(&client, &pointer.catalog.url, pointer.catalog.bytes, None)?
        else {
            return Err("adapter-metadata-http-failed".to_string());
        };
        let HttpMetadata::Bytes {
            bytes: catalog_signature,
            ..
        } = fetch_metadata(
            &client,
            &pointer.catalog.signature_url,
            MAX_SIGNATURE_BYTES,
            None,
        )?
        else {
            return Err("adapter-metadata-http-failed".to_string());
        };
        let entries = verify_official_catalog(&catalog_bytes, &catalog_signature, &pointer, now)?;
        state.kind = "cc-theme.adapter-metadata-state".to_string();
        state.schema_version = 1;
        state.highest_sequence = state.highest_sequence.max(pointer.sequence);
        state.active_snapshot = Some(format!(
            "{:06}-{:x}",
            pointer.sequence,
            Sha256::digest(&pointer_bytes)
        ));
        state.stable_etag = etag;
        state.checked_at = Some(now.to_rfc3339());
        persist_metadata_cache(
            root,
            CachedMetadata {
                pointer: &pointer_bytes,
                pointer_signature: &pointer_signature,
                catalog: &catalog_bytes,
                catalog_signature: &catalog_signature,
            },
            &state,
        )?;
        Ok(VerifiedCatalogSnapshot {
            sequence: pointer.sequence,
            source: "network",
            checked_at: now,
            entries,
        })
    })();

    online.or_else(|_| {
        let mut cached = load_cached_catalog_with_key(root, OFFICIAL_PUBLIC_KEY_BASE64, now)?;
        let mut fallback_state = read_metadata_state(root);
        fallback_state.checked_at = Some(now.to_rfc3339());
        let state_bytes = serde_json::to_vec(&fallback_state)
            .map_err(|_| "adapter-metadata-cache-write-failed".to_string())?;
        atomic_write(root, "state.json", &state_bytes)?;
        cached.checked_at = now;
        Ok(cached)
    })
}

fn host_supports_adapter(host_version: &str, adapter_version: &str) -> bool {
    matches!(
        (Version::parse(host_version), Version::parse(adapter_version)),
        (Ok(host), Ok(adapter)) if host >= adapter
    )
}

pub fn check_adapter_updates(force: bool) -> Result<AdapterCatalogStatus, String> {
    let snapshot = refresh_official_catalog(&metadata_cache_root(), Utc::now(), force)?;
    let adapters = crate::models::ClientId::ALL
        .into_iter()
        .map(|client_id| {
            let client = crate::discovery::client_state(client_id);
            let entry = snapshot
                .entries
                .iter()
                .find(|entry| entry.adapter_id == client_id.as_str());
            let (status, message) = match entry {
                None => ("catalog-missing", "签名版本清单未发布该 Adapter"),
                Some(_) if !client.discovered => {
                    ("host-not-installed", "安装对应桌面客户端后即可下载")
                }
                Some(entry)
                    if !client.version.as_deref().is_some_and(|host| {
                        host_supports_adapter(host, &entry.adapter_version)
                    }) =>
                {
                    (
                        "host-too-old",
                        "当前桌面客户端版本低于该 Adapter 的目标版本",
                    )
                }
                Some(entry)
                    if client.adapter_ready
                        && client.adapter_version.as_deref()
                            == Some(entry.adapter_version.as_str())
                        && client.adapter_release_revision
                            == Some(entry.adapter_release_revision) =>
                {
                    ("current", "已安装签名清单中的最新 Adapter")
                }
                Some(_) => ("update-available", "可从官方签名清单安全下载"),
            };
            AdapterUpdateState {
                adapter_id: client_id.as_str().to_string(),
                status: status.to_string(),
                latest_version: entry.map(|entry| entry.adapter_version.clone()),
                latest_release_revision: entry.map(|entry| entry.adapter_release_revision),
                source: snapshot.source.to_string(),
                message: message.to_string(),
            }
        })
        .collect();
    Ok(AdapterCatalogStatus {
        sequence: snapshot.sequence,
        source: snapshot.source.to_string(),
        checked_at: snapshot.checked_at.to_rfc3339(),
        adapters,
    })
}

fn package_http_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent(format!("CC-Theme/{MANAGER_VERSION}"))
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 {
                return attempt.error("adapter-package-too-many-redirects");
            }
            let url = attempt.url();
            if url.scheme() == "https"
                && matches!(
                    url.host_str(),
                    Some(
                        "release-assets.githubusercontent.com"
                            | "objects.githubusercontent.com"
                            | "github-releases.githubusercontent.com"
                    )
                )
            {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
        .map_err(|_| "adapter-download-network-unavailable".to_string())
}

fn download_package_to(entry: &AdapterCatalogEntry, destination: &Path) -> Result<(), String> {
    let client = package_http_client()?;
    let mut response = client
        .get(&entry.download_url)
        .header(reqwest::header::ACCEPT, "application/octet-stream")
        .send()
        .map_err(|_| "adapter-download-network-unavailable".to_string())?;
    if response.status() != reqwest::StatusCode::OK {
        return Err("adapter-download-http-failed".to_string());
    }
    if response
        .content_length()
        .is_some_and(|bytes| bytes != entry.bytes)
    {
        return Err("adapter-download-size-mismatch".to_string());
    }
    let mut output = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(destination)
        .map_err(|_| "adapter-download-stage-failed".to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(destination, fs::Permissions::from_mode(0o600))
            .map_err(|_| "adapter-download-stage-failed".to_string())?;
    }
    let mut digest = Sha256::new();
    let mut total = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = response
            .read(&mut buffer)
            .map_err(|_| "adapter-download-network-unavailable".to_string())?;
        if count == 0 {
            break;
        }
        total = total
            .checked_add(count as u64)
            .ok_or_else(|| "adapter-download-size-mismatch".to_string())?;
        if total > entry.bytes {
            return Err("adapter-download-size-mismatch".to_string());
        }
        output
            .write_all(&buffer[..count])
            .map_err(|_| "adapter-download-stage-failed".to_string())?;
        digest.update(&buffer[..count]);
    }
    output
        .sync_all()
        .map_err(|_| "adapter-download-stage-failed".to_string())?;
    if total != entry.bytes || format!("{:x}", digest.finalize()) != entry.sha256 {
        return Err("adapter-download-digest-mismatch".to_string());
    }
    Ok(())
}

pub fn download_and_install_latest_adapter(
    client_id: crate::models::ClientId,
    detected_host_version: Option<&str>,
) -> Result<AdapterDownloadReceipt, String> {
    let host_version = detected_host_version
        .filter(|version| !version.is_empty())
        .ok_or_else(|| "adapter-host-not-installed".to_string())?;
    let snapshot = refresh_official_catalog(&metadata_cache_root(), Utc::now(), false)?;
    let entry = snapshot
        .entries
        .iter()
        .find(|entry| entry.adapter_id == client_id.as_str())
        .ok_or_else(|| "adapter-catalog-package-unavailable".to_string())?;
    if !host_supports_adapter(host_version, &entry.adapter_version) {
        return Err("adapter-host-version-mismatch".to_string());
    }
    let downloads = metadata_cache_root().join("downloads");
    ensure_private_directory(&metadata_cache_root())
        .map_err(|_| "adapter-download-stage-failed".to_string())?;
    fs::create_dir_all(&downloads).map_err(|_| "adapter-download-stage-failed".to_string())?;
    let metadata = fs::symlink_metadata(&downloads)
        .map_err(|_| "adapter-download-stage-failed".to_string())?;
    if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
        return Err("adapter-download-stage-failed".to_string());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&downloads, fs::Permissions::from_mode(0o700))
            .map_err(|_| "adapter-download-stage-failed".to_string())?;
    }
    let transaction = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let staged = downloads.join(format!(
        ".{}-{}-{transaction}.ccadapter",
        client_id.as_str(),
        std::process::id()
    ));
    let result = (|| {
        download_package_to(entry, &staged)?;
        let receipt = crate::adapter_installer::install_catalog_adapter_package(
            &staged,
            client_id.as_str(),
            Some(host_version),
            &entry.adapter_version,
            entry.adapter_release_revision,
            &entry.asset_identity,
            &entry.sha256,
            &entry.manifest_sha256,
        )?;
        if receipt.adapter_id != entry.adapter_id
            || receipt.adapter_version != entry.adapter_version
            || receipt.adapter_release_revision != entry.adapter_release_revision
            || receipt.asset_identity != entry.asset_identity
            || receipt.archive_sha256 != entry.sha256
        {
            return Err("adapter-download-install-mismatch".to_string());
        }
        Ok(AdapterDownloadReceipt {
            adapter_id: receipt.adapter_id,
            adapter_version: receipt.adapter_version,
            adapter_release_revision: receipt.adapter_release_revision,
            asset_identity: receipt.asset_identity,
            archive_sha256: receipt.archive_sha256,
            replaced_local_adapter: receipt.replaced_local_adapter,
            catalog_sequence: snapshot.sequence,
        })
    })();
    let _ = fs::remove_file(&staged);
    result
}

#[cfg(test)]
mod tests {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use ed25519_dalek::{Signer, SigningKey};
    use serde::Deserialize;
    use sha2::{Digest, Sha256};

    const KEY_ID: &str = "cc-theme-adapter-root-2026-07";

    #[derive(Debug, Deserialize, PartialEq, Eq)]
    #[serde(deny_unknown_fields)]
    struct Fixture {
        kind: String,
    }

    fn signed(payload: &[u8], signing_key: &SigningKey) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "kind": "cc-theme.ed25519-signature",
            "schemaVersion": 1,
            "keyId": KEY_ID,
            "algorithm": "Ed25519",
            "signedSha256": format!("{:x}", Sha256::digest(payload)),
            "signature": STANDARD.encode(signing_key.sign(payload).to_bytes()),
        }))
        .unwrap()
    }

    fn pointer_json(sequence: u64, catalog: &[u8]) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "kind": "cc-theme.adapter-channel-pointer",
            "schemaVersion": 1,
            "channel": "stable",
            "sequence": sequence,
            "issuedAt": "2026-07-20T00:00:00Z",
            "expiresAt": "2027-01-16T00:00:00Z",
            "keyId": KEY_ID,
            "catalog": {
                "url": format!("https://raw.githubusercontent.com/quanzhankeji/cc-theme/{}/app/registry/catalogs/stable/{sequence:06}.json", "a".repeat(40)),
                "signatureUrl": format!("https://raw.githubusercontent.com/quanzhankeji/cc-theme/{}/app/registry/catalogs/stable/{sequence:06}.json.sig", "a".repeat(40)),
                "bytes": catalog.len(),
                "sha256": format!("{:x}", Sha256::digest(catalog)),
            }
        }))
        .unwrap()
    }

    fn catalog_json(sequence: u64, revoked: Vec<&str>) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "kind": "cc-theme.adapter-release-catalog",
            "schemaVersion": 1,
            "publicationStatus": "published",
            "currentVersionPolicy": "explicit",
            "channel": "stable",
            "sequence": sequence,
            "publishedAt": "2026-07-20T00:00:00Z",
            "expiresAt": "2027-01-16T00:00:00Z",
            "keyId": KEY_ID,
            "revokedSha256": revoked,
            "adapters": [{
                "adapterId": "mac-workbuddy",
                "current": { "adapterVersion": "5.2.6", "adapterReleaseRevision": 1 },
                "releases": [{
                    "adapterVersion": "5.2.6",
                    "adapterReleaseRevision": 1,
                    "assetIdentity": "mac-workbuddy-5.2.6-r1-macos-arm64",
                    "contracts": {
                        "minimumManagerVersion": "0.2.0",
                        "capabilityVersion": "1.0.0",
                        "unifiedThemeSchemaVersion": 1,
                        "adapterPackageSchemaVersion": 1
                    },
                    "packages": [{
                        "platform": "macos",
                        "architecture": "arm64",
                        "assetName": "mac-workbuddy-5.2.6-r1-macos-arm64.ccadapter",
                        "bytes": 729254,
                        "sha256": "2accd2142ad6e5a868d150972859c0b07cee4e25a01f74d476e2570c65c8d886",
                        "manifestSha256": "c035da2c8615411ec35878b09ef7b47901f708d896c0713e93d2a10187951947",
                        "releaseTag": "cc-theme-v0.2.0",
                        "downloadUrl": "https://github.com/quanzhankeji/cc-theme/releases/download/cc-theme-v0.2.0/mac-workbuddy-5.2.6-r1-macos-arm64.ccadapter"
                    }]
                }]
            }]
        }))
        .unwrap()
    }

    fn now() -> chrono::DateTime<chrono::Utc> {
        "2026-07-21T00:00:00Z".parse().unwrap()
    }

    #[test]
    fn verifies_official_metadata_before_it_is_parsed() {
        let signing_key = SigningKey::from_bytes(&[7_u8; 32]);
        let payload = br#"{"kind":"cc-theme.adapter-channel-pointer"}"#;
        let signature = signing_key.sign(payload);

        assert!(super::verify_ed25519(
            payload,
            &STANDARD.encode(signing_key.verifying_key().as_bytes()),
            &STANDARD.encode(signature.to_bytes()),
        )
        .is_ok());
    }

    #[test]
    fn parses_payload_only_after_detached_signature_and_digest_match() {
        let signing_key = SigningKey::from_bytes(&[11_u8; 32]);
        let payload = br#"{"kind":"cc-theme.adapter-channel-pointer"}"#;
        let signature = signed(payload, &signing_key);

        let result: Fixture = super::verify_signed_json(
            payload,
            &signature,
            KEY_ID,
            &STANDARD.encode(signing_key.verifying_key().as_bytes()),
        )
        .unwrap();
        assert_eq!(
            result,
            Fixture {
                kind: "cc-theme.adapter-channel-pointer".to_string()
            }
        );
    }

    #[test]
    fn rejects_tampering_wrong_keys_and_open_signature_documents() {
        let signing_key = SigningKey::from_bytes(&[13_u8; 32]);
        let payload = br#"{"kind":"cc-theme.adapter-channel-pointer"}"#;
        let signature = signed(payload, &signing_key);
        let public_key = STANDARD.encode(signing_key.verifying_key().as_bytes());

        assert_eq!(
            super::verify_signed_json::<Fixture>(
                br#"{"kind":"tampered"}"#,
                &signature,
                KEY_ID,
                &public_key,
            )
            .unwrap_err(),
            "adapter-metadata-signature-document-invalid"
        );
        assert_eq!(
            super::verify_signed_json::<Fixture>(payload, &signature, "wrong-key", &public_key)
                .unwrap_err(),
            "adapter-metadata-signature-document-invalid"
        );
        let mut open: serde_json::Value = serde_json::from_slice(&signature).unwrap();
        open["unexpected"] = serde_json::json!(true);
        assert_eq!(
            super::verify_signed_json::<Fixture>(
                payload,
                &serde_json::to_vec(&open).unwrap(),
                KEY_ID,
                &public_key,
            )
            .unwrap_err(),
            "adapter-metadata-signature-document-invalid"
        );
    }

    #[test]
    fn signed_pointer_is_closed_fresh_and_rollback_protected() {
        let signing_key = SigningKey::from_bytes(&[17_u8; 32]);
        let catalog = catalog_json(2, vec![]);
        let pointer = pointer_json(2, &catalog);
        let signature = signed(&pointer, &signing_key);
        let public_key = STANDARD.encode(signing_key.verifying_key().as_bytes());

        assert_eq!(
            super::verify_channel_pointer_with_key(&pointer, &signature, &public_key, now(), 2,)
                .unwrap()
                .sequence,
            2
        );
        assert_eq!(
            super::verify_channel_pointer_with_key(&pointer, &signature, &public_key, now(), 3,)
                .unwrap_err(),
            "adapter-channel-pointer-invalid"
        );
        assert_eq!(
            super::verify_channel_pointer_with_key(
                &pointer,
                &signature,
                &public_key,
                "2027-01-17T00:00:00Z".parse().unwrap(),
                0,
            )
            .unwrap_err(),
            "adapter-metadata-expired-or-not-yet-valid"
        );
    }

    #[test]
    fn signed_catalog_selects_only_the_current_macos_arm64_package() {
        let signing_key = SigningKey::from_bytes(&[19_u8; 32]);
        let catalog = catalog_json(1, vec![]);
        let pointer_bytes = pointer_json(1, &catalog);
        let public_key = STANDARD.encode(signing_key.verifying_key().as_bytes());
        let pointer: super::AdapterChannelPointer = serde_json::from_slice(&pointer_bytes).unwrap();

        let entries = super::verify_catalog_with_key(
            &catalog,
            &signed(&catalog, &signing_key),
            &pointer,
            &public_key,
            now(),
        )
        .unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].adapter_id, "mac-workbuddy");
        assert_eq!(entries[0].adapter_version, "5.2.6");
        assert_eq!(entries[0].adapter_release_revision, 1);
    }

    #[test]
    fn catalog_rejects_revoked_assets_and_download_hash_drift() {
        let signing_key = SigningKey::from_bytes(&[23_u8; 32]);
        let digest = "2accd2142ad6e5a868d150972859c0b07cee4e25a01f74d476e2570c65c8d886";
        let catalog = catalog_json(1, vec![digest]);
        let pointer_bytes = pointer_json(1, &catalog);
        let public_key = STANDARD.encode(signing_key.verifying_key().as_bytes());
        let pointer: super::AdapterChannelPointer = serde_json::from_slice(&pointer_bytes).unwrap();
        assert_eq!(
            super::verify_catalog_with_key(
                &catalog,
                &signed(&catalog, &signing_key),
                &pointer,
                &public_key,
                now(),
            )
            .unwrap_err(),
            "adapter-catalog-package-invalid"
        );

        let clean = catalog_json(1, vec![]);
        let mut mismatched: serde_json::Value =
            serde_json::from_slice(&pointer_json(1, &clean)).unwrap();
        mismatched["catalog"]["bytes"] = serde_json::json!(clean.len() + 1);
        let mismatched: super::AdapterChannelPointer = serde_json::from_value(mismatched).unwrap();
        assert_eq!(
            super::verify_catalog_with_key(
                &clean,
                &signed(&clean, &signing_key),
                &mismatched,
                &public_key,
                now(),
            )
            .unwrap_err(),
            "adapter-catalog-download-mismatch"
        );

        let mut unsafe_url: serde_json::Value =
            serde_json::from_slice(&catalog_json(1, vec![])).unwrap();
        unsafe_url["adapters"][0]["releases"][0]["packages"][0]["downloadUrl"] =
            serde_json::json!("https://github.com:444/quanzhankeji/cc-theme/releases/download/cc-theme-v0.2.0/mac-workbuddy-5.2.6-r1-macos-arm64.ccadapter");
        let unsafe_url = serde_json::to_vec(&unsafe_url).unwrap();
        let pointer: super::AdapterChannelPointer =
            serde_json::from_slice(&pointer_json(1, &unsafe_url)).unwrap();
        assert_eq!(
            super::verify_catalog_with_key(
                &unsafe_url,
                &signed(&unsafe_url, &signing_key),
                &pointer,
                &public_key,
                now(),
            )
            .unwrap_err(),
            "adapter-catalog-package-invalid"
        );
    }

    #[test]
    fn last_known_good_cache_is_verified_and_keeps_highest_sequence() {
        let signing_key = SigningKey::from_bytes(&[29_u8; 32]);
        let public_key = STANDARD.encode(signing_key.verifying_key().as_bytes());
        let catalog = catalog_json(4, vec![]);
        let pointer = pointer_json(4, &catalog);
        let root = std::env::temp_dir().join(format!(
            "cc-theme-adapter-metadata-cache-{}-{}",
            std::process::id(),
            4
        ));
        let _ = std::fs::remove_dir_all(&root);
        let state = super::AdapterMetadataState {
            kind: "cc-theme.adapter-metadata-state".to_string(),
            schema_version: 1,
            highest_sequence: 4,
            active_snapshot: Some(format!(
                "000004-{}",
                format!("{:x}", Sha256::digest(&catalog))
            )),
            stable_etag: Some("\"stable-4\"".to_string()),
            checked_at: Some("2026-07-21T00:00:00Z".to_string()),
        };
        super::persist_metadata_cache(
            &root,
            super::CachedMetadata {
                pointer: &pointer,
                pointer_signature: &signed(&pointer, &signing_key),
                catalog: &catalog,
                catalog_signature: &signed(&catalog, &signing_key),
            },
            &state,
        )
        .unwrap();

        let snapshot = super::load_cached_catalog_with_key(&root, &public_key, now()).unwrap();
        assert_eq!(snapshot.sequence, 4);
        assert_eq!(snapshot.source, "cache");
        assert_eq!(snapshot.entries[0].adapter_id, "mac-workbuddy");

        let incomplete = root
            .join("snapshots")
            .join(format!("000005-{}", "f".repeat(64)));
        std::fs::create_dir_all(&incomplete).unwrap();
        std::fs::write(incomplete.join("catalog.json"), b"{}").unwrap();
        assert_eq!(
            super::load_cached_catalog_with_key(&root, &public_key, now())
                .unwrap()
                .sequence,
            4
        );

        let catalog_path = root
            .join("snapshots")
            .join(state.active_snapshot.as_deref().unwrap())
            .join("catalog.json");
        let mut tampered = std::fs::read(&catalog_path).unwrap();
        tampered.push(b' ');
        std::fs::write(catalog_path, tampered).unwrap();
        assert!(super::load_cached_catalog_with_key(&root, &public_key, now()).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[ignore = "requires public GitHub metadata"]
    fn official_online_metadata_and_signatures_are_accepted() {
        let client = super::metadata_http_client().unwrap();
        let super::HttpMetadata::Bytes {
            bytes: pointer_bytes,
            ..
        } = super::fetch_metadata(
            &client,
            super::STABLE_POINTER_URL,
            super::MAX_POINTER_BYTES,
            None,
        )
        .unwrap()
        else {
            panic!("fresh request must return bytes")
        };
        let super::HttpMetadata::Bytes {
            bytes: pointer_signature,
            ..
        } = super::fetch_metadata(
            &client,
            super::STABLE_SIGNATURE_URL,
            super::MAX_SIGNATURE_BYTES,
            None,
        )
        .unwrap()
        else {
            panic!("signature request must return bytes")
        };
        let pointer = super::verify_official_channel_pointer(
            &pointer_bytes,
            &pointer_signature,
            chrono::Utc::now(),
            0,
        )
        .unwrap();
        let super::HttpMetadata::Bytes { bytes: catalog, .. } =
            super::fetch_metadata(&client, &pointer.catalog.url, pointer.catalog.bytes, None)
                .unwrap()
        else {
            panic!("catalog request must return bytes")
        };
        let super::HttpMetadata::Bytes {
            bytes: catalog_signature,
            ..
        } = super::fetch_metadata(
            &client,
            &pointer.catalog.signature_url,
            super::MAX_SIGNATURE_BYTES,
            None,
        )
        .unwrap()
        else {
            panic!("catalog signature request must return bytes")
        };
        let entries = super::verify_official_catalog(
            &catalog,
            &catalog_signature,
            &pointer,
            chrono::Utc::now(),
        )
        .unwrap();
        assert_eq!(
            entries
                .iter()
                .map(|entry| entry.adapter_id.as_str())
                .collect::<Vec<_>>(),
            vec!["mac-codex", "mac-workbuddy"]
        );
    }

    #[test]
    #[ignore = "downloads a public Release asset"]
    fn official_release_asset_redirect_size_and_digest_are_accepted() {
        let client = super::metadata_http_client().unwrap();
        let super::HttpMetadata::Bytes {
            bytes: pointer_bytes,
            ..
        } = super::fetch_metadata(
            &client,
            super::STABLE_POINTER_URL,
            super::MAX_POINTER_BYTES,
            None,
        )
        .unwrap()
        else {
            panic!("pointer request must return bytes")
        };
        let super::HttpMetadata::Bytes {
            bytes: pointer_signature,
            ..
        } = super::fetch_metadata(
            &client,
            super::STABLE_SIGNATURE_URL,
            super::MAX_SIGNATURE_BYTES,
            None,
        )
        .unwrap()
        else {
            panic!("signature request must return bytes")
        };
        let pointer = super::verify_official_channel_pointer(
            &pointer_bytes,
            &pointer_signature,
            chrono::Utc::now(),
            0,
        )
        .unwrap();
        let super::HttpMetadata::Bytes { bytes: catalog, .. } =
            super::fetch_metadata(&client, &pointer.catalog.url, pointer.catalog.bytes, None)
                .unwrap()
        else {
            panic!("catalog request must return bytes")
        };
        let super::HttpMetadata::Bytes {
            bytes: catalog_signature,
            ..
        } = super::fetch_metadata(
            &client,
            &pointer.catalog.signature_url,
            super::MAX_SIGNATURE_BYTES,
            None,
        )
        .unwrap()
        else {
            panic!("catalog signature request must return bytes")
        };
        let entries = super::verify_official_catalog(
            &catalog,
            &catalog_signature,
            &pointer,
            chrono::Utc::now(),
        )
        .unwrap();
        let entry = entries
            .iter()
            .find(|entry| entry.adapter_id == "mac-workbuddy")
            .unwrap();
        let destination = std::env::temp_dir().join(format!(
            "cc-theme-release-download-{}-{}.ccadapter",
            std::process::id(),
            entry.adapter_release_revision
        ));
        let _ = std::fs::remove_file(&destination);
        super::download_package_to(entry, &destination).unwrap();
        assert_eq!(std::fs::metadata(&destination).unwrap().len(), entry.bytes);
        std::fs::remove_file(destination).unwrap();
    }

    #[test]
    #[ignore = "requires public GitHub metadata"]
    fn official_catalog_refresh_persists_an_atomic_last_known_good_snapshot() {
        let root = std::env::temp_dir().join(format!(
            "cc-theme-official-metadata-refresh-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        let online = super::refresh_official_catalog(&root, chrono::Utc::now(), true).unwrap();
        assert_eq!(online.sequence, 1);
        assert_eq!(online.source, "network");
        let cached = super::refresh_official_catalog(&root, chrono::Utc::now(), false).unwrap();
        assert_eq!(cached.sequence, 1);
        assert_eq!(cached.source, "cache");
        let state: serde_json::Value =
            serde_json::from_slice(&std::fs::read(root.join("state.json")).unwrap()).unwrap();
        assert_eq!(state["highestSequence"], 1);
        assert!(root
            .join("snapshots")
            .join(state["activeSnapshot"].as_str().unwrap())
            .join("catalog.json")
            .is_file());
        std::fs::remove_dir_all(root).unwrap();
    }
}
