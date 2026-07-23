use std::{
    cmp::Ordering,
    collections::BTreeSet,
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use zip::{CompressionMethod, ZipArchive};

const MAX_ARCHIVE_BYTES: u64 = 40 * 1024 * 1024;
const MAX_MANIFEST_BYTES: u64 = 2 * 1024 * 1024;
const MAX_FILE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_PAYLOAD_BYTES: u64 = 32 * 1024 * 1024;
const MAX_FILES: usize = 256;
static INSTALL_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AdapterPackageManifest {
    kind: String,
    schema_version: u64,
    adapter_id: String,
    adapter_version: String,
    adapter_release_revision: u64,
    asset_identity: String,
    platform: String,
    architecture: String,
    contracts: AdapterPackageContracts,
    files: Vec<AdapterPackageFile>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AdapterPackageContracts {
    minimum_manager_version: String,
    capability_version: String,
    unified_theme_schema_version: u64,
    adapter_package_schema_version: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct AdapterPackageFile {
    path: String,
    bytes: u64,
    sha256: String,
    mode: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ActiveAdapterPointer {
    kind: String,
    schema_version: u64,
    adapter_id: String,
    adapter_version: String,
    adapter_release_revision: u64,
    asset_identity: String,
    archive_sha256: String,
    manifest_sha256: String,
    store_relative_path: String,
    activated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterInstallReceipt {
    pub adapter_id: String,
    pub adapter_version: String,
    pub adapter_release_revision: u64,
    pub asset_identity: String,
    pub archive_sha256: String,
    pub replaced_local_adapter: bool,
}

#[derive(Debug, Clone)]
pub struct InstalledAdapterInfo {
    pub version: Option<String>,
    pub release_revision: Option<u64>,
    pub source: &'static str,
    pub status: &'static str,
}

struct CatalogPackageExpectation<'a> {
    adapter_version: &'a str,
    adapter_release_revision: u64,
    asset_identity: &'a str,
    archive_sha256: &'a str,
    manifest_sha256: &'a str,
}

pub fn installed_adapter_info(
    definition: &crate::registry::ClientDefinition,
    detected_host_version: Option<&str>,
) -> InstalledAdapterInfo {
    let local_root = active_adapter_root(definition.id.as_str());
    let effective_root = crate::registry::adapter_root(definition);
    let source = if local_root.as_ref() == Some(&effective_root) {
        "local"
    } else {
        "bundled"
    };
    let release = read_small_json(&effective_root.join("contracts/adapter-release-manifest.json"));
    let Some(release) = release.ok() else {
        return InstalledAdapterInfo {
            version: None,
            release_revision: None,
            source,
            status: "missing",
        };
    };
    let version = release
        .get("adapterVersion")
        .and_then(Value::as_str)
        .filter(|value| valid_semver(value))
        .map(ToOwned::to_owned);
    let release_revision = release
        .get("adapterReleaseRevision")
        .and_then(Value::as_u64)
        .filter(|value| *value > 0);
    let identity_matches = release.get("adapterId").and_then(Value::as_str)
        == Some(definition.id.as_str())
        && version.is_some()
        && release_revision.is_some();
    let status = if !identity_matches {
        "missing"
    } else if detected_host_version == version.as_deref() {
        "ready"
    } else if matches!(
        detected_host_version.zip(version.as_deref()),
        Some((host, adapter)) if host_version_relation(host, adapter) == Some(Ordering::Greater)
    ) {
        "compatibility-candidate"
    } else {
        "host-version-mismatch"
    };
    InstalledAdapterInfo {
        version,
        release_revision,
        source,
        status,
    }
}

pub fn active_adapter_root(adapter_id: &str) -> Option<PathBuf> {
    active_adapter_root_from(&crate::registry::manager_adapter_library_root(), adapter_id)
}

/// A locally installed Engine normally takes precedence over the bundled
/// fallback.  A freshly installed Manager may, however, contain a newer
/// verified Engine than an older local pointer left by a previous build.  In
/// that case prefer the signed bundle without mutating the local store; the
/// older local package remains available as a rollback source.
pub fn active_adapter_is_not_older_than(adapter_id: &str, bundled_root: &Path) -> bool {
    let Some(active_root) = active_adapter_root(adapter_id) else {
        return false;
    };
    let Some(active) = release_identity_from(&active_root) else {
        return false;
    };
    let Some(bundled) = release_identity_from(bundled_root) else {
        return false;
    };
    release_identity_at_least(&active, &bundled)
}

fn release_identity_from(root: &Path) -> Option<(semver::Version, u64)> {
    let release = read_small_json(&root.join("contracts/adapter-release-manifest.json")).ok()?;
    let version = release.get("adapterVersion")?.as_str()?;
    let revision = release.get("adapterReleaseRevision")?.as_u64()?;
    if !valid_semver(version) || revision == 0 {
        return None;
    }
    semver::Version::parse(version)
        .ok()
        .map(|version| (version, revision))
}

fn release_identity_at_least(
    active: &(semver::Version, u64),
    bundled: &(semver::Version, u64),
) -> bool {
    active.0 > bundled.0 || (active.0 == bundled.0 && active.1 >= bundled.1)
}

fn active_adapter_root_from(library_root: &Path, adapter_id: &str) -> Option<PathBuf> {
    if !matches!(adapter_id, "mac-codex" | "mac-doubao" | "mac-workbuddy") {
        return None;
    }
    let library_root = canonical_directory(library_root)?;
    resolve_pointer_root(&library_root, "active", adapter_id)
        .or_else(|| resolve_pointer_root(&library_root, "previous", adapter_id))
}

fn installed_active_adapter_root_from(library_root: &Path, adapter_id: &str) -> Option<PathBuf> {
    let library_root = canonical_directory(library_root)?;
    resolve_pointer_root(&library_root, "active", adapter_id)
}

fn resolve_pointer_root(
    library_root: &Path,
    pointer_directory: &str,
    adapter_id: &str,
) -> Option<PathBuf> {
    let pointer_root = canonical_direct_child_directory(library_root, pointer_directory)?;
    let pointer_path = pointer_root.join(format!("{adapter_id}.json"));
    let pointer_metadata = fs::symlink_metadata(&pointer_path).ok()?;
    if !pointer_metadata.file_type().is_file()
        || pointer_metadata.file_type().is_symlink()
        || pointer_metadata.len() < 2
        || pointer_metadata.len() > MAX_MANIFEST_BYTES
    {
        return None;
    }
    let pointer: ActiveAdapterPointer =
        serde_json::from_slice(&fs::read(&pointer_path).ok()?).ok()?;
    if pointer.kind != "cc-theme.active-adapter"
        || pointer.schema_version != 1
        || pointer.adapter_id != adapter_id
        || pointer.adapter_release_revision == 0
        || !valid_semver(&pointer.adapter_version)
        || !valid_sha256(&pointer.archive_sha256)
        || !valid_sha256(&pointer.manifest_sha256)
        || pointer.store_relative_path != format!("store/{}/payload", pointer.archive_sha256)
    {
        return None;
    }

    let store_root = canonical_direct_child_directory(library_root, "store")?;
    let store_entry = canonical_direct_child_directory(&store_root, &pointer.archive_sha256)?;
    let payload_root = canonical_direct_child_directory(&store_entry, "payload")?;
    let manifest_path = store_entry.join("adapter.json");
    let manifest_metadata = fs::symlink_metadata(&manifest_path).ok()?;
    if !manifest_metadata.file_type().is_file()
        || manifest_metadata.file_type().is_symlink()
        || manifest_metadata.len() < 2
        || manifest_metadata.len() > MAX_MANIFEST_BYTES
    {
        return None;
    }
    let manifest_bytes = fs::read(&manifest_path).ok()?;
    if format!("{:x}", Sha256::digest(&manifest_bytes)) != pointer.manifest_sha256 {
        return None;
    }
    let manifest: AdapterPackageManifest = serde_json::from_slice(&manifest_bytes).ok()?;
    if manifest.adapter_id != pointer.adapter_id
        || manifest.adapter_version != pointer.adapter_version
        || manifest.adapter_release_revision != pointer.adapter_release_revision
        || manifest.asset_identity != pointer.asset_identity
        || validate_manifest(&manifest, adapter_id, Some(&pointer.adapter_version)).is_err()
        || validate_installed_payload(&payload_root, &manifest).is_err()
        || validate_staged_engine(&payload_root, &manifest).is_err()
    {
        return None;
    }
    Some(payload_root)
}

fn canonical_directory(path: &Path) -> Option<PathBuf> {
    let metadata = fs::symlink_metadata(path).ok()?;
    if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
        return None;
    }
    path.canonicalize().ok()
}

fn canonical_direct_child_directory(parent: &Path, name: &str) -> Option<PathBuf> {
    if name.is_empty()
        || Path::new(name)
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return None;
    }
    let child = parent.join(name);
    let child = canonical_directory(&child)?;
    (child.parent() == Some(parent)).then_some(child)
}

fn validate_installed_payload(
    payload_root: &Path,
    manifest: &AdapterPackageManifest,
) -> Result<(), String> {
    for record in &manifest.files {
        let relative = record
            .path
            .strip_prefix("payload/")
            .ok_or_else(|| "adapter-active-invalid".to_string())?;
        let path = payload_root.join(relative);
        let metadata =
            fs::symlink_metadata(&path).map_err(|_| "adapter-active-invalid".to_string())?;
        if !metadata.file_type().is_file()
            || metadata.file_type().is_symlink()
            || metadata.len() != record.bytes
        {
            return Err("adapter-active-invalid".to_string());
        }
        let bytes = fs::read(&path).map_err(|_| "adapter-active-invalid".to_string())?;
        if format!("{:x}", Sha256::digest(&bytes)) != record.sha256 {
            return Err("adapter-active-invalid".to_string());
        }
    }
    Ok(())
}

pub fn install_adapter_package(
    package: &Path,
    expected_adapter_id: &str,
    detected_host_version: Option<&str>,
) -> Result<AdapterInstallReceipt, String> {
    let _guard = INSTALL_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "adapter-install-busy".to_string())?;
    install_adapter_package_to_with_expectation(
        package,
        &crate::registry::manager_adapter_library_root(),
        expected_adapter_id,
        detected_host_version,
        None,
    )
}

pub fn install_catalog_adapter_package(
    package: &Path,
    expected_adapter_id: &str,
    detected_host_version: Option<&str>,
    expected_adapter_version: &str,
    expected_adapter_release_revision: u64,
    expected_asset_identity: &str,
    expected_archive_sha256: &str,
    expected_manifest_sha256: &str,
) -> Result<AdapterInstallReceipt, String> {
    let _guard = INSTALL_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "adapter-install-busy".to_string())?;
    install_adapter_package_to_with_expectation(
        package,
        &crate::registry::manager_adapter_library_root(),
        expected_adapter_id,
        detected_host_version,
        Some(CatalogPackageExpectation {
            adapter_version: expected_adapter_version,
            adapter_release_revision: expected_adapter_release_revision,
            asset_identity: expected_asset_identity,
            archive_sha256: expected_archive_sha256,
            manifest_sha256: expected_manifest_sha256,
        }),
    )
}

#[cfg(test)]
fn install_adapter_package_to(
    package: &Path,
    library_root: &Path,
    expected_adapter_id: &str,
    detected_host_version: Option<&str>,
) -> Result<AdapterInstallReceipt, String> {
    install_adapter_package_to_with_expectation(
        package,
        library_root,
        expected_adapter_id,
        detected_host_version,
        None,
    )
}

fn install_adapter_package_to_with_expectation(
    package: &Path,
    library_root: &Path,
    expected_adapter_id: &str,
    detected_host_version: Option<&str>,
    catalog: Option<CatalogPackageExpectation<'_>>,
) -> Result<AdapterInstallReceipt, String> {
    let (archive_bytes, archive_sha256) = read_archive(package)?;
    let mut archive = ZipArchive::new(std::io::Cursor::new(&archive_bytes))
        .map_err(|_| "adapter-package-invalid".to_string())?;
    let (manifest, manifest_bytes) = read_manifest(&mut archive)?;
    validate_manifest(&manifest, expected_adapter_id, detected_host_version)?;
    let manifest_sha256 = format!("{:x}", Sha256::digest(&manifest_bytes));
    if catalog.as_ref().is_some_and(|expected| {
        archive_sha256 != expected.archive_sha256
            || manifest_sha256 != expected.manifest_sha256
            || manifest.adapter_version != expected.adapter_version
            || manifest.adapter_release_revision != expected.adapter_release_revision
            || manifest.asset_identity != expected.asset_identity
    }) {
        return Err("adapter-catalog-package-mismatch".to_string());
    }
    prepare_library_root(library_root)?;
    let transaction_id = format!(
        "{}-{}-{}",
        expected_adapter_id,
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    let transaction_root = library_root.join("transactions").join(transaction_id);
    let stage = transaction_root.join("stage");
    fs::create_dir_all(stage.join("payload")).map_err(|_| "adapter-stage-failed".to_string())?;
    set_directory_permissions(&transaction_root)?;
    set_directory_permissions(&stage)?;
    set_directory_permissions(&stage.join("payload"))?;

    let result = (|| {
        extract_verified_payload(&mut archive, &manifest, &stage)?;
        fs::write(stage.join("adapter.json"), &manifest_bytes)
            .map_err(|_| "adapter-stage-failed".to_string())?;
        set_file_permissions(&stage.join("adapter.json"), 0o600)?;
        validate_staged_engine(&stage.join("payload"), &manifest)?;

        let store_root = library_root.join("store");
        let store_entry = store_root.join(&archive_sha256);
        if !store_entry.exists() {
            fs::rename(&stage, &store_entry).map_err(|_| "adapter-stage-failed".to_string())?;
            sync_directory(&store_root)?;
        } else {
            let stored_manifest = fs::read(store_entry.join("adapter.json"))
                .map_err(|_| "adapter-stage-failed".to_string())?;
            if stored_manifest != manifest_bytes
                || validate_installed_payload(&store_entry.join("payload"), &manifest).is_err()
                || validate_staged_engine(&store_entry.join("payload"), &manifest).is_err()
            {
                return Err("adapter-store-collision".to_string());
            }
        }
        let pointer = ActiveAdapterPointer {
            kind: "cc-theme.active-adapter".to_string(),
            schema_version: 1,
            adapter_id: manifest.adapter_id.clone(),
            adapter_version: manifest.adapter_version.clone(),
            adapter_release_revision: manifest.adapter_release_revision,
            asset_identity: manifest.asset_identity.clone(),
            archive_sha256: archive_sha256.clone(),
            manifest_sha256: manifest_sha256.clone(),
            store_relative_path: format!("store/{archive_sha256}/payload"),
            activated_at: chrono::Utc::now().to_rfc3339(),
        };
        let active_file = library_root
            .join("active")
            .join(format!("{}.json", manifest.adapter_id));
        let previous_file = library_root
            .join("previous")
            .join(format!("{}.json", manifest.adapter_id));
        let replaced_local_adapter =
            installed_active_adapter_root_from(library_root, &manifest.adapter_id).is_some();
        if replaced_local_adapter {
            atomic_copy_pointer(&active_file, &previous_file)?;
        } else if active_file.symlink_metadata().is_ok() {
            let quarantine = library_root.join("quarantine").join(format!(
                "{}-{}.json",
                manifest.adapter_id,
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos()
            ));
            fs::rename(&active_file, quarantine).map_err(|_| "adapter-stage-failed".to_string())?;
        }
        atomic_write_json(&active_file, &pointer)?;
        Ok(AdapterInstallReceipt {
            adapter_id: manifest.adapter_id,
            adapter_version: manifest.adapter_version,
            adapter_release_revision: manifest.adapter_release_revision,
            asset_identity: manifest.asset_identity,
            archive_sha256,
            replaced_local_adapter,
        })
    })();
    let _ = fs::remove_dir_all(&transaction_root);
    result
}

fn read_archive(package: &Path) -> Result<(Vec<u8>, String), String> {
    if package.extension().and_then(|value| value.to_str()) != Some("ccadapter") {
        return Err("adapter-package-extension-invalid".to_string());
    }
    let metadata =
        fs::symlink_metadata(package).map_err(|_| "adapter-package-unavailable".to_string())?;
    if !metadata.file_type().is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() < 22
        || metadata.len() > MAX_ARCHIVE_BYTES
    {
        return Err("adapter-package-invalid".to_string());
    }
    let bytes = fs::read(package).map_err(|_| "adapter-package-unavailable".to_string())?;
    let digest = format!("{:x}", Sha256::digest(&bytes));
    Ok((bytes, digest))
}

fn read_manifest<R: Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
) -> Result<(AdapterPackageManifest, Vec<u8>), String> {
    if archive.len() < 2 || archive.len() > MAX_FILES + 1 {
        return Err("adapter-package-invalid".to_string());
    }
    let mut entry = archive
        .by_index(0)
        .map_err(|_| "adapter-package-invalid".to_string())?;
    if entry.name() != "adapter.json"
        || entry.is_dir()
        || entry.compression() != CompressionMethod::Stored
        || entry.size() < 2
        || entry.size() > MAX_MANIFEST_BYTES
    {
        return Err("adapter-package-invalid".to_string());
    }
    let mut bytes = Vec::with_capacity(entry.size() as usize);
    entry
        .read_to_end(&mut bytes)
        .map_err(|_| "adapter-package-invalid".to_string())?;
    let manifest =
        serde_json::from_slice(&bytes).map_err(|_| "adapter-package-invalid".to_string())?;
    Ok((manifest, bytes))
}

fn validate_manifest(
    manifest: &AdapterPackageManifest,
    expected_adapter_id: &str,
    detected_host_version: Option<&str>,
) -> Result<(), String> {
    if manifest.kind != "cc-theme.adapter-package"
        || manifest.schema_version != 1
        || manifest.adapter_id != expected_adapter_id
        || !matches!(
            expected_adapter_id,
            "mac-codex" | "mac-doubao" | "mac-workbuddy"
        )
        || manifest.platform != "macos"
        || manifest.architecture != runtime_architecture()
        || manifest.adapter_release_revision == 0
        || manifest.contracts.adapter_package_schema_version != 1
        || manifest.contracts.unified_theme_schema_version != 1
        || !manager_supports(&manifest.contracts.minimum_manager_version)
        || !valid_semver(&manifest.adapter_version)
        || !valid_semver(&manifest.contracts.capability_version)
        || manifest.files.is_empty()
        || manifest.files.len() > MAX_FILES
    {
        return Err("adapter-incompatible".to_string());
    }
    if !matches!(
        detected_host_version.map(|host| host_version_relation(host, &manifest.adapter_version)),
        Some(Some(Ordering::Equal | Ordering::Greater))
    ) {
        return Err("adapter-host-version-mismatch".to_string());
    }
    let expected_identity = format!(
        "{}-{}-r{}-{}-{}",
        manifest.adapter_id,
        manifest.adapter_version,
        manifest.adapter_release_revision,
        manifest.platform,
        manifest.architecture
    );
    if manifest.asset_identity != expected_identity {
        return Err("adapter-package-identity-invalid".to_string());
    }
    let mut paths = BTreeSet::new();
    let mut total = 0_u64;
    for file in &manifest.files {
        if !valid_payload_path(&file.path)
            || !paths.insert(file.path.clone())
            || file.bytes == 0
            || file.bytes > MAX_FILE_BYTES
            || !valid_sha256(&file.sha256)
            || !matches!(file.mode, 0o644 | 0o755)
        {
            return Err("adapter-package-manifest-invalid".to_string());
        }
        total = total
            .checked_add(file.bytes)
            .ok_or_else(|| "adapter-package-manifest-invalid".to_string())?;
        if total > MAX_PAYLOAD_BYTES {
            return Err("adapter-package-manifest-invalid".to_string());
        }
    }
    Ok(())
}

fn extract_verified_payload<R: Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
    manifest: &AdapterPackageManifest,
    stage: &Path,
) -> Result<(), String> {
    if archive.len() != manifest.files.len() + 1 {
        return Err("adapter-package-invalid".to_string());
    }
    for (index, record) in manifest.files.iter().enumerate() {
        let mut entry = archive
            .by_index(index + 1)
            .map_err(|_| "adapter-package-invalid".to_string())?;
        if entry.name() != record.path
            || entry.is_dir()
            || entry.compression() != CompressionMethod::Stored
            || entry.size() != record.bytes
            || entry
                .unix_mode()
                .is_some_and(|mode| mode & 0o777 != record.mode)
        {
            return Err("adapter-package-invalid".to_string());
        }
        let mut bytes = Vec::with_capacity(record.bytes as usize);
        entry
            .read_to_end(&mut bytes)
            .map_err(|_| "adapter-package-invalid".to_string())?;
        if format!("{:x}", Sha256::digest(&bytes)) != record.sha256
            || forbidden_file_magic(&bytes)
            || contains_retired_adapter_id(&bytes)
        {
            return Err("adapter-package-invalid".to_string());
        }
        let relative = record
            .path
            .strip_prefix("payload/")
            .ok_or_else(|| "adapter-package-invalid".to_string())?;
        let destination = stage.join("payload").join(relative);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|_| "adapter-stage-failed".to_string())?;
            set_directory_permissions(parent)?;
        }
        let mut output = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&destination)
            .map_err(|_| "adapter-stage-failed".to_string())?;
        output
            .write_all(&bytes)
            .and_then(|_| output.sync_all())
            .map_err(|_| "adapter-stage-failed".to_string())?;
        set_file_permissions(&destination, record.mode)?;
    }
    Ok(())
}

fn validate_staged_engine(root: &Path, manifest: &AdapterPackageManifest) -> Result<(), String> {
    let capability = read_small_json(&root.join("contracts/adapter-capability.json"))?;
    if capability.get("adapterId").and_then(Value::as_str) != Some(manifest.adapter_id.as_str())
        || normalized_capability_version(capability.get("capabilityVersion"))
            != Some(manifest.contracts.capability_version.clone())
    {
        return Err("adapter-health-check-failed".to_string());
    }
    validate_release_qualification(root, manifest, &capability)?;
    let release = read_small_json(&root.join("contracts/adapter-release-manifest.json"))?;
    let expected_release_kind = match manifest.adapter_id.as_str() {
        "mac-codex" => "mac-codex-adapter.release-manifest",
        "mac-doubao" => "mac-doubao-adapter.release-manifest",
        "mac-workbuddy" => "workbuddy-adapter.release-manifest",
        _ => return Err("adapter-health-check-failed".to_string()),
    };
    if release.get("adapterId").and_then(Value::as_str) != Some(manifest.adapter_id.as_str())
        || release.get("kind").and_then(Value::as_str) != Some(expected_release_kind)
        || release.get("adapterVersion").and_then(Value::as_str)
            != Some(manifest.adapter_version.as_str())
        || release
            .get("adapterReleaseRevision")
            .and_then(Value::as_u64)
            != Some(manifest.adapter_release_revision)
        || release.get("assetIdentity").and_then(Value::as_str)
            != Some(manifest.asset_identity.as_str())
        || release
            .get("platform")
            .or_else(|| release.get("os"))
            .and_then(Value::as_str)
            != Some(manifest.platform.as_str())
        || release
            .get("architecture")
            .or_else(|| release.get("arch"))
            .and_then(Value::as_str)
            != Some(manifest.architecture.as_str())
    {
        return Err("adapter-health-check-failed".to_string());
    }
    let required = [
        "scripts/switch-theme-macos.sh",
        "scripts/start-skin-macos.sh",
        "scripts/pause-skin-macos.sh",
        "scripts/restore-skin-macos.sh",
        "scripts/verify-skin-macos.sh",
        "scripts/doctor-macos.sh",
        "scripts/skin-theme.mjs",
    ];
    for relative in required {
        let path = root.join(relative);
        let metadata =
            fs::symlink_metadata(path).map_err(|_| "adapter-health-check-failed".to_string())?;
        if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
            return Err("adapter-health-check-failed".to_string());
        }
    }
    let projector = match manifest.adapter_id.as_str() {
        "mac-codex" => "scripts/adapter-capability.mjs",
        "mac-doubao" => "scripts/adapter-capability.mjs",
        "mac-workbuddy" => "scripts/workbuddy-theme-projection.mjs",
        _ => return Err("adapter-health-check-failed".to_string()),
    };
    if !root.join(projector).is_file() {
        return Err("adapter-health-check-failed".to_string());
    }
    Ok(())
}

fn validate_release_qualification(
    root: &Path,
    manifest: &AdapterPackageManifest,
    capability: &Value,
) -> Result<(), String> {
    let unqualified = || "adapter-release-unqualified".to_string();
    if capability
        .get("runtimeApplyAvailable")
        .and_then(Value::as_bool)
        != Some(true)
        || capability
            .get("availability")
            .is_some_and(|value| value.as_str() != Some("available"))
        || capability
            .get("available")
            .is_some_and(|value| value.as_bool() != Some(true))
    {
        return Err(unqualified());
    }

    let compatibility = capability
        .get("compatibility")
        .and_then(Value::as_object)
        .ok_or_else(unqualified)?;
    let verified_gate = compatibility
        .get("verifiedClientVersions")
        .and_then(Value::as_array)
        .is_some_and(|versions| {
            versions
                .iter()
                .any(|version| version.as_str() == Some(manifest.adapter_version.as_str()))
        });
    let current_evidence = compatibility
        .get("currentEvidence")
        .and_then(Value::as_object);
    let requires_current_surface_gate = manifest.adapter_id == "mac-codex"
        || compatibility
            .get("surfaceEvidenceIsGate")
            .and_then(Value::as_bool)
            == Some(true)
        || current_evidence
            .and_then(|evidence| evidence.get("clientVersion"))
            .is_some();
    let current_gate = current_evidence
        .and_then(|evidence| evidence.get("clientVersion"))
        .and_then(Value::as_str)
        .is_some_and(|version| version == manifest.adapter_version);
    if requires_current_surface_gate && !current_gate {
        return Err(unqualified());
    }
    if !requires_current_surface_gate && !verified_gate {
        return Err(unqualified());
    }
    let project_path = root.join("PROJECT_MANIFEST.json");
    if !requires_current_surface_gate && !project_path.is_file() {
        return Ok(());
    }
    let project = read_small_json(&project_path).map_err(|_| unqualified())?;
    let evidence_path = project
        .pointer("/contracts/uiEvidenceCatalog")
        .or_else(|| project.pointer("/host/compatibilityEvidence/uiSurfaceCatalog"))
        .and_then(Value::as_str);
    if !requires_current_surface_gate && evidence_path.is_none() {
        return Ok(());
    }
    let evidence_path = evidence_path.ok_or_else(unqualified)?;
    if !valid_payload_path(&format!("payload/{evidence_path}")) {
        return Err(unqualified());
    }
    if manifest.adapter_id == "mac-codex"
        && evidence_path
            != format!(
                "compatibility/chatgpt-macos/{}/ui-surface-catalog.json",
                manifest.adapter_version
            )
    {
        return Err(unqualified());
    }
    let surface = read_small_json(&root.join(evidence_path)).map_err(|_| unqualified())?;
    let has_admission = surface.get("admission").is_some();
    if (requires_current_surface_gate || has_admission)
        && (surface.pointer("/admission/status").and_then(Value::as_str) != Some("verified")
            || surface
                .pointer("/admission/failClosed")
                .and_then(Value::as_bool)
                != Some(true))
    {
        return Err(unqualified());
    }
    if !requires_current_surface_gate {
        return Ok(());
    }
    let evidence = current_evidence.ok_or_else(unqualified)?;
    let expected_catalog_id = if manifest.adapter_id == "mac-codex" {
        format!("chatgpt-macos-{}", manifest.adapter_version)
    } else {
        evidence
            .get("surfaceCatalogId")
            .and_then(Value::as_str)
            .ok_or_else(unqualified)?
            .to_string()
    };
    if evidence.get("surfaceCatalogId").and_then(Value::as_str)
        != Some(expected_catalog_id.as_str())
        || surface.get("catalogId").and_then(Value::as_str) != Some(expected_catalog_id.as_str())
        || surface.pointer("/client/version").and_then(Value::as_str)
            != Some(manifest.adapter_version.as_str())
    {
        return Err(unqualified());
    }
    let expected_build = evidence
        .get("clientBuild")
        .and_then(Value::as_str)
        .ok_or_else(unqualified)?;
    if surface.pointer("/client/build").and_then(Value::as_str) != Some(expected_build) {
        return Err(unqualified());
    }
    let expected_version = evidence
        .get("surfaceCatalogVersion")
        .and_then(Value::as_u64)
        .ok_or_else(unqualified)?;
    let actual_version = surface
        .get("catalogVersion")
        .and_then(Value::as_u64)
        .or_else(|| {
            surface
                .get("schemaVersion")
                .and_then(Value::as_str)
                .filter(|value| valid_semver(value))
                .and_then(|value| value.split('.').next())
                .and_then(|value| value.parse::<u64>().ok())
        })
        .ok_or_else(unqualified)?;
    if expected_version != actual_version {
        return Err(unqualified());
    }
    Ok(())
}

fn normalized_capability_version(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(version) if valid_semver(version) => Some(version.clone()),
        Value::Number(version) => version.as_u64().map(|major| format!("{major}.0.0")),
        _ => None,
    }
}

fn prepare_library_root(root: &Path) -> Result<(), String> {
    if root.symlink_metadata().is_ok() {
        let metadata =
            fs::symlink_metadata(root).map_err(|_| "adapter-stage-failed".to_string())?;
        if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
            return Err("adapter-stage-failed".to_string());
        }
    } else {
        fs::create_dir_all(root).map_err(|_| "adapter-stage-failed".to_string())?;
    }
    for directory in ["store", "active", "previous", "transactions", "quarantine"] {
        let path = root.join(directory);
        fs::create_dir_all(&path).map_err(|_| "adapter-stage-failed".to_string())?;
        set_directory_permissions(&path)?;
    }
    set_directory_permissions(root)
}

fn atomic_copy_pointer(source: &Path, destination: &Path) -> Result<(), String> {
    let bytes = fs::read(source).map_err(|_| "adapter-stage-failed".to_string())?;
    atomic_write_bytes(destination, &bytes)
}

fn atomic_write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|_| "adapter-stage-failed".to_string())?;
    atomic_write_bytes(path, &bytes)
}

fn atomic_write_bytes(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "adapter-stage-failed".to_string())?;
    let temporary = parent.join(format!(
        ".{}-{}-{}.tmp",
        path.file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("pointer"),
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    let mut output = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(|_| "adapter-stage-failed".to_string())?;
    output
        .write_all(bytes)
        .and_then(|_| output.sync_all())
        .map_err(|_| "adapter-stage-failed".to_string())?;
    set_file_permissions(&temporary, 0o600)?;
    fs::rename(&temporary, path).map_err(|_| "adapter-stage-failed".to_string())?;
    sync_directory(parent)
}

fn sync_directory(path: &Path) -> Result<(), String> {
    OpenOptions::new()
        .read(true)
        .open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| "adapter-stage-failed".to_string())
}

fn read_small_json(path: &Path) -> Result<Value, String> {
    let metadata =
        fs::symlink_metadata(path).map_err(|_| "adapter-health-check-failed".to_string())?;
    if !metadata.file_type().is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() < 2
        || metadata.len() > MAX_MANIFEST_BYTES
    {
        return Err("adapter-health-check-failed".to_string());
    }
    serde_json::from_slice(&fs::read(path).map_err(|_| "adapter-health-check-failed".to_string())?)
        .map_err(|_| "adapter-health-check-failed".to_string())
}

fn valid_payload_path(value: &str) -> bool {
    let Some(relative) = value.strip_prefix("payload/") else {
        return false;
    };
    if value.len() > 512
        || relative.is_empty()
        || value.contains(['\\', ':'])
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'.' | b'_' | b'-'))
        || Path::new(relative)
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return false;
    }
    let lower = relative.to_ascii_lowercase();
    let forbidden_segments = [
        "tests", "test", "fixtures", "fixture", "themes", "presets", "staging", "release",
    ];
    if lower
        .split('/')
        .any(|segment| forbidden_segments.contains(&segment))
    {
        return false;
    }
    let forbidden_extensions = [
        "ccadapter",
        "cctheme",
        "zip",
        "tar",
        "gz",
        "png",
        "jpg",
        "jpeg",
        "webp",
        "gif",
        "mp4",
        "mov",
        "webm",
        "mp3",
        "wav",
    ];
    !Path::new(&lower)
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| forbidden_extensions.contains(&extension))
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn valid_semver(value: &str) -> bool {
    let core = value.split_once('-').map_or(value, |(core, _)| core);
    let mut parts = core.split('.');
    let valid = (0..3).all(|_| {
        parts
            .next()
            .is_some_and(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
    });
    valid && parts.next().is_none() && value.len() <= 80
}

fn host_version_relation(host: &str, adapter: &str) -> Option<Ordering> {
    fn numeric(value: &str) -> Option<(u64, u64, u64)> {
        if !valid_semver(value) || value.contains('-') {
            return None;
        }
        let mut parts = value.split('.');
        let result = (
            parts.next()?.parse().ok()?,
            parts.next()?.parse().ok()?,
            parts.next()?.parse().ok()?,
        );
        parts.next().is_none().then_some(result)
    }
    Some(numeric(host)?.cmp(&numeric(adapter)?))
}

fn manager_supports(minimum: &str) -> bool {
    fn numeric(value: &str) -> Option<(u64, u64, u64)> {
        let core = value.split_once('-').map_or(value, |(core, _)| core);
        let mut parts = core.split('.');
        let result = (
            parts.next()?.parse().ok()?,
            parts.next()?.parse().ok()?,
            parts.next()?.parse().ok()?,
        );
        parts.next().is_none().then_some(result)
    }
    matches!((numeric(env!("CARGO_PKG_VERSION")), numeric(minimum)), (Some(current), Some(required)) if current >= required)
}

fn runtime_architecture() -> &'static str {
    match std::env::consts::ARCH {
        "aarch64" => "arm64",
        "x86_64" => "x86_64",
        _ => "unsupported",
    }
}

fn contains_retired_adapter_id(bytes: &[u8]) -> bool {
    let text = String::from_utf8_lossy(bytes).to_ascii_lowercase();
    ["mac-codex-skin", "mac-workbuddy-skin"]
        .iter()
        .any(|value| text.contains(value))
}

fn forbidden_file_magic(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a])
        || bytes.starts_with(&[0xff, 0xd8, 0xff])
        || (bytes.len() >= 12 && &bytes[4..8] == b"ftyp")
        || bytes.starts_with(b"PK\x03\x04")
}

#[cfg(unix)]
fn set_directory_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|_| "adapter-stage-failed".to_string())
}

#[cfg(not(unix))]
fn set_directory_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(unix)]
fn set_file_permissions(path: &Path, mode: u32) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
        .map_err(|_| "adapter-stage-failed".to_string())
}

#[cfg(not(unix))]
fn set_file_permissions(_path: &Path, _mode: u32) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    fn scratch(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "cc-theme-adapter-installer-{name}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    fn package(path: &Path, adapter_id: &str, version: &str) {
        package_with_options(path, adapter_id, version, "default", adapter_id);
    }

    fn package_identity(path: &Path) -> (String, AdapterPackageManifest) {
        let archive_bytes = fs::read(path).unwrap();
        let mut archive = ZipArchive::new(Cursor::new(&archive_bytes)).unwrap();
        let (manifest, manifest_bytes) = read_manifest(&mut archive).unwrap();
        (format!("{:x}", Sha256::digest(&manifest_bytes)), manifest)
    }

    fn package_with_options(
        path: &Path,
        adapter_id: &str,
        version: &str,
        marker: &str,
        capability_adapter_id: &str,
    ) {
        package_with_qualification(
            path,
            adapter_id,
            version,
            marker,
            capability_adapter_id,
            None,
            true,
            None,
            None,
            None,
        );
    }

    fn package_with_qualification(
        path: &Path,
        adapter_id: &str,
        version: &str,
        marker: &str,
        capability_adapter_id: &str,
        surface_admission: Option<&str>,
        runtime_apply_available: bool,
        surface_catalog_id_override: Option<&str>,
        surface_client_build_override: Option<&str>,
        surface_evidence_path_override: Option<&str>,
    ) {
        let revision = 1_u64;
        let asset_identity = format!(
            "{adapter_id}-{version}-r{revision}-macos-{}",
            runtime_architecture()
        );
        let release = serde_json::to_vec(&serde_json::json!({
            "kind": if adapter_id == "mac-codex" {
                "mac-codex-adapter.release-manifest"
            } else {
                "workbuddy-adapter.release-manifest"
            },
            "revision": 1,
            "adapterId": capability_adapter_id,
            "adapterVersion": version,
            "adapterReleaseRevision": revision,
            "platform": "macos",
            "architecture": runtime_architecture(),
            "assetIdentity": asset_identity,
            "entries": []
        }))
        .unwrap();
        let mut capability = serde_json::json!({
            "adapterId": adapter_id,
            "capabilityVersion": "1.0.0",
            "availability": "available",
            "runtimeApplyAvailable": runtime_apply_available,
            "compatibility": { "verifiedClientVersions": [version] }
        });
        if surface_admission.is_some() && adapter_id == "mac-codex" {
            let surface_catalog_id = surface_catalog_id_override
                .map(str::to_string)
                .unwrap_or_else(|| format!("chatgpt-macos-{version}"));
            capability["compatibility"] = serde_json::json!({
                "currentEvidence": {
                    "clientVersion": version,
                    "clientBuild": "9999",
                    "surfaceCatalogId": surface_catalog_id,
                    "surfaceCatalogVersion": 1
                }
            });
        }
        let capability = serde_json::to_vec(&capability).unwrap();
        let mut files = vec![
            ("contracts/adapter-capability.json", capability, 0o644),
            ("contracts/adapter-release-manifest.json", release, 0o644),
            (
                "scripts/switch-theme-macos.sh",
                b"#!/bin/bash\nexit 0\n".to_vec(),
                0o755,
            ),
            (
                "scripts/start-skin-macos.sh",
                b"#!/bin/bash\nexit 0\n".to_vec(),
                0o755,
            ),
            (
                "scripts/pause-skin-macos.sh",
                b"#!/bin/bash\nexit 0\n".to_vec(),
                0o755,
            ),
            (
                "scripts/restore-skin-macos.sh",
                b"#!/bin/bash\nexit 0\n".to_vec(),
                0o755,
            ),
            (
                "scripts/verify-skin-macos.sh",
                b"#!/bin/bash\nexit 0\n".to_vec(),
                0o755,
            ),
            (
                "scripts/doctor-macos.sh",
                b"#!/bin/bash\nexit 0\n".to_vec(),
                0o755,
            ),
            (
                "scripts/skin-theme.mjs",
                format!("// {marker}\nexport const normalizeSkinTheme = value => value;\n")
                    .into_bytes(),
                0o644,
            ),
            (
                if adapter_id == "mac-codex" {
                    "scripts/adapter-capability.mjs"
                } else {
                    "scripts/workbuddy-theme-projection.mjs"
                },
                b"export const projectThemeFamilyAdapter = value => value;\n".to_vec(),
                0o644,
            ),
        ];
        if let Some(status) = surface_admission {
            let surface_catalog_id = surface_catalog_id_override
                .map(str::to_string)
                .unwrap_or_else(|| format!("chatgpt-macos-{version}"));
            let evidence_path = surface_evidence_path_override
                .map(str::to_string)
                .unwrap_or_else(|| {
                    format!("compatibility/chatgpt-macos/{version}/ui-surface-catalog.json")
                });
            let surface_client_build = surface_client_build_override.unwrap_or("9999");
            files.push((
                "PROJECT_MANIFEST.json",
                serde_json::to_vec(&serde_json::json!({
                    "contracts": { "uiEvidenceCatalog": evidence_path }
                }))
                .unwrap(),
                0o644,
            ));
            files.push((
                Box::leak(evidence_path.into_boxed_str()),
                serde_json::to_vec(&serde_json::json!({
                    "schemaVersion": "1.0.0",
                    "catalogId": surface_catalog_id,
                    "catalogVersion": 1,
                    "client": { "version": version, "build": surface_client_build },
                    "admission": { "status": status, "failClosed": true }
                }))
                .unwrap(),
                0o644,
            ));
        }
        let records = files
            .iter()
            .map(|(relative, bytes, mode)| {
                serde_json::json!({
                    "path": format!("payload/{relative}"),
                    "bytes": bytes.len(),
                    "sha256": format!("{:x}", Sha256::digest(bytes)),
                    "mode": mode
                })
            })
            .collect::<Vec<_>>();
        let manifest = serde_json::to_vec(&serde_json::json!({
            "kind": "cc-theme.adapter-package",
            "schemaVersion": 1,
            "adapterId": adapter_id,
            "adapterVersion": version,
            "adapterReleaseRevision": revision,
            "assetIdentity": asset_identity,
            "platform": "macos",
            "architecture": runtime_architecture(),
            "contracts": {
                "minimumManagerVersion": "0.1.0",
                "capabilityVersion": "1.0.0",
                "unifiedThemeSchemaVersion": 1,
                "adapterPackageSchemaVersion": 1
            },
            "files": records
        }))
        .unwrap();
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        writer
            .start_file(
                "adapter.json",
                SimpleFileOptions::default()
                    .compression_method(CompressionMethod::Stored)
                    .unix_permissions(0o644),
            )
            .unwrap();
        writer.write_all(&manifest).unwrap();
        for (relative, bytes, mode) in files {
            writer
                .start_file(
                    format!("payload/{relative}"),
                    SimpleFileOptions::default()
                        .compression_method(CompressionMethod::Stored)
                        .unix_permissions(mode),
                )
                .unwrap();
            writer.write_all(&bytes).unwrap();
        }
        fs::write(path, writer.finish().unwrap().into_inner()).unwrap();
    }

    #[test]
    fn an_experimental_surface_candidate_never_enters_the_active_store() {
        let root = scratch("experimental-surface");
        fs::create_dir_all(&root).unwrap();
        let archive = root.join("codex-candidate.ccadapter");
        let library = root.join("library");
        package_with_qualification(
            &archive,
            "mac-codex",
            "26.715.99999",
            "candidate",
            "mac-codex",
            Some("experimental"),
            true,
            None,
            None,
            None,
        );

        assert_eq!(
            install_adapter_package_to(&archive, &library, "mac-codex", Some("26.715.99999"))
                .unwrap_err(),
            "adapter-release-unqualified",
        );
        assert!(!library.join("active/mac-codex.json").exists());
    }

    #[test]
    fn verified_surface_evidence_can_enter_the_active_store() {
        let root = scratch("verified-surface");
        fs::create_dir_all(&root).unwrap();
        let archive = root.join("codex-verified.ccadapter");
        let library = root.join("library");
        package_with_qualification(
            &archive,
            "mac-codex",
            "26.715.99999",
            "verified",
            "mac-codex",
            Some("verified"),
            true,
            None,
            None,
            None,
        );

        let receipt =
            install_adapter_package_to(&archive, &library, "mac-codex", Some("26.715.99999"))
                .unwrap();
        assert_eq!(receipt.adapter_id, "mac-codex");
        assert!(library.join("active/mac-codex.json").is_file());
    }

    #[test]
    fn codex_cannot_downgrade_current_surface_qualification_to_a_version_allowlist() {
        let root = scratch("surface-policy-downgrade");
        fs::create_dir_all(&root).unwrap();
        let archive = root.join("codex-downgraded.ccadapter");
        let library = root.join("library");
        package_with_qualification(
            &archive,
            "mac-codex",
            "26.715.99999",
            "downgraded",
            "mac-codex",
            None,
            true,
            None,
            None,
            None,
        );

        assert_eq!(
            install_adapter_package_to(&archive, &library, "mac-codex", Some("26.715.99999"))
                .unwrap_err(),
            "adapter-release-unqualified",
        );
        assert!(!library.join("active/mac-codex.json").exists());
    }

    #[test]
    fn codex_rejects_a_forged_catalog_identity_even_when_both_documents_agree() {
        let root = scratch("surface-catalog-forgery");
        fs::create_dir_all(&root).unwrap();
        let archive = root.join("codex-forged.ccadapter");
        let library = root.join("library");
        package_with_qualification(
            &archive,
            "mac-codex",
            "26.715.99999",
            "forged",
            "mac-codex",
            Some("verified"),
            true,
            Some("attacker-controlled-catalog"),
            None,
            None,
        );

        assert_eq!(
            install_adapter_package_to(&archive, &library, "mac-codex", Some("26.715.99999"))
                .unwrap_err(),
            "adapter-release-unqualified",
        );
        assert!(!library.join("active/mac-codex.json").exists());
    }

    #[test]
    fn codex_rejects_a_surface_build_that_differs_from_capability_evidence() {
        let root = scratch("surface-build-mismatch");
        fs::create_dir_all(&root).unwrap();
        let archive = root.join("codex-build-mismatch.ccadapter");
        let library = root.join("library");
        package_with_qualification(
            &archive,
            "mac-codex",
            "26.715.99999",
            "build-mismatch",
            "mac-codex",
            Some("verified"),
            true,
            None,
            Some("9998"),
            None,
        );

        assert_eq!(
            install_adapter_package_to(&archive, &library, "mac-codex", Some("26.715.99999"))
                .unwrap_err(),
            "adapter-release-unqualified",
        );
        assert!(!library.join("active/mac-codex.json").exists());
    }

    #[test]
    fn codex_rejects_a_noncanonical_surface_evidence_path() {
        let root = scratch("noncanonical-surface-path");
        fs::create_dir_all(&root).unwrap();
        let archive = root.join("codex-noncanonical-surface.ccadapter");
        let library = root.join("library");
        package_with_qualification(
            &archive,
            "mac-codex",
            "26.715.99999",
            "noncanonical-surface",
            "mac-codex",
            Some("verified"),
            true,
            None,
            None,
            Some("compatibility/chatgpt-macos/26.715.99999/alternate-surface-catalog.json"),
        );

        assert_eq!(
            install_adapter_package_to(&archive, &library, "mac-codex", Some("26.715.99999"))
                .unwrap_err(),
            "adapter-release-unqualified",
        );
        assert!(!library.join("active/mac-codex.json").exists());
    }

    #[test]
    fn optional_experimental_surface_evidence_is_not_accepted_by_the_installer() {
        let root = scratch("optional-experimental-surface");
        fs::create_dir_all(&root).unwrap();
        let archive = root.join("workbuddy-experimental.ccadapter");
        let library = root.join("library");
        package_with_qualification(
            &archive,
            "mac-workbuddy",
            "5.2.6",
            "experimental",
            "mac-workbuddy",
            Some("experimental"),
            true,
            None,
            None,
            None,
        );

        assert_eq!(
            install_adapter_package_to(&archive, &library, "mac-workbuddy", Some("5.2.6"))
                .unwrap_err(),
            "adapter-release-unqualified",
        );
        assert!(!library.join("active/mac-workbuddy.json").exists());
    }

    #[test]
    fn a_runtime_unavailable_adapter_never_enters_the_active_store() {
        let root = scratch("runtime-unavailable");
        fs::create_dir_all(&root).unwrap();
        let archive = root.join("runtime-unavailable.ccadapter");
        let library = root.join("library");
        package_with_qualification(
            &archive,
            "mac-workbuddy",
            "5.2.6",
            "runtime-unavailable",
            "mac-workbuddy",
            None,
            false,
            None,
            None,
            None,
        );

        assert_eq!(
            install_adapter_package_to(&archive, &library, "mac-workbuddy", Some("5.2.6"))
                .unwrap_err(),
            "adapter-release-unqualified",
        );
        assert!(!library.join("active/mac-workbuddy.json").exists());
    }

    #[test]
    fn a_valid_local_package_is_content_addressed_and_atomically_activated() {
        let root = scratch("activate");
        fs::create_dir_all(&root).unwrap();
        let archive = root.join("workbuddy.ccadapter");
        let library = root.join("library");
        package(&archive, "mac-workbuddy", "5.2.6");

        let receipt =
            install_adapter_package_to(&archive, &library, "mac-workbuddy", Some("5.2.6")).unwrap();

        assert_eq!(receipt.adapter_id, "mac-workbuddy");
        let active: ActiveAdapterPointer =
            serde_json::from_slice(&fs::read(library.join("active/mac-workbuddy.json")).unwrap())
                .unwrap();
        assert_eq!(active.archive_sha256, receipt.archive_sha256);
        assert!(library
            .join(&active.store_relative_path)
            .join("scripts/workbuddy-theme-projection.mjs")
            .is_file());
        assert!(fs::read_dir(library.join("transactions"))
            .unwrap()
            .next()
            .is_none());
        assert_eq!(
            active_adapter_root_from(&library, "mac-workbuddy").unwrap(),
            library
                .join(active.store_relative_path)
                .canonicalize()
                .unwrap()
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn release_precedence_never_selects_a_stale_local_engine_over_a_newer_bundle() {
        let release =
            |version: &str, revision| (semver::Version::parse(version).unwrap(), revision);
        assert!(!release_identity_at_least(
            &release("26.715.71837", 1),
            &release("26.715.71837", 3),
        ));
        assert!(release_identity_at_least(
            &release("26.715.71837", 3),
            &release("26.715.71837", 3),
        ));
        assert!(release_identity_at_least(
            &release("26.715.71838", 1),
            &release("26.715.71837", 99),
        ));
    }

    #[test]
    fn a_catalog_package_mismatch_is_rejected_before_activation() {
        let root = scratch("catalog-mismatch");
        fs::create_dir_all(&root).unwrap();
        let archive = root.join("workbuddy.ccadapter");
        let library = root.join("library");
        package(&archive, "mac-workbuddy", "5.2.6");
        let (manifest_sha256, manifest) = package_identity(&archive);
        let archive_sha256 = format!("{:x}", Sha256::digest(fs::read(&archive).unwrap()));

        let result = install_adapter_package_to_with_expectation(
            &archive,
            &library,
            "mac-workbuddy",
            Some("5.2.6"),
            Some(CatalogPackageExpectation {
                adapter_version: &manifest.adapter_version,
                adapter_release_revision: manifest.adapter_release_revision,
                asset_identity: &manifest.asset_identity,
                archive_sha256: &archive_sha256,
                manifest_sha256: &format!("0{}", &manifest_sha256[1..]),
            }),
        );

        assert_eq!(result.unwrap_err(), "adapter-catalog-package-mismatch");
        assert!(!library.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn an_active_pointer_cannot_escape_the_content_addressed_store() {
        let root = scratch("pointer-escape");
        fs::create_dir_all(&root).unwrap();
        let archive = root.join("workbuddy.ccadapter");
        let library = root.join("library");
        package(&archive, "mac-workbuddy", "5.2.6");
        install_adapter_package_to(&archive, &library, "mac-workbuddy", Some("5.2.6")).unwrap();
        let pointer_file = library.join("active/mac-workbuddy.json");
        let mut pointer: Value = serde_json::from_slice(&fs::read(&pointer_file).unwrap()).unwrap();
        pointer["storeRelativePath"] = Value::String("../../outside".to_string());
        fs::write(&pointer_file, serde_json::to_vec(&pointer).unwrap()).unwrap();

        assert!(active_adapter_root_from(&library, "mac-workbuddy").is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_host_version_mismatch_never_changes_the_active_adapter() {
        let root = scratch("host-mismatch");
        fs::create_dir_all(&root).unwrap();
        let first = root.join("first.ccadapter");
        let mismatch = root.join("mismatch.ccadapter");
        let library = root.join("library");
        package(&first, "mac-workbuddy", "5.2.6");
        install_adapter_package_to(&first, &library, "mac-workbuddy", Some("5.2.6")).unwrap();
        let active_before = fs::read(library.join("active/mac-workbuddy.json")).unwrap();
        package(&mismatch, "mac-workbuddy", "5.2.7");

        assert_eq!(
            install_adapter_package_to(&mismatch, &library, "mac-workbuddy", Some("5.2.6"))
                .unwrap_err(),
            "adapter-host-version-mismatch"
        );
        assert_eq!(
            fs::read(library.join("active/mac-workbuddy.json")).unwrap(),
            active_before
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn an_older_adapter_can_be_installed_for_an_explicit_newer_host_compatibility_attempt() {
        let root = scratch("older-host-compatibility");
        fs::create_dir_all(&root).unwrap();
        let archive = root.join("codex.ccadapter");
        let library = root.join("library");
        package_with_qualification(
            &archive,
            "mac-codex",
            "26.715.31925",
            "verified-older-adapter",
            "mac-codex",
            Some("verified"),
            true,
            None,
            None,
            None,
        );

        let receipt =
            install_adapter_package_to(&archive, &library, "mac-codex", Some("26.715.52143"))
                .unwrap();

        assert_eq!(receipt.adapter_version, "26.715.31925");
        assert!(active_adapter_root_from(&library, "mac-codex").is_some());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn host_version_relation_only_accepts_strict_numeric_updates() {
        assert_eq!(
            host_version_relation("26.715.52143", "26.715.31925"),
            Some(std::cmp::Ordering::Greater)
        );
        assert_eq!(
            host_version_relation("5.2.6", "5.2.6"),
            Some(std::cmp::Ordering::Equal)
        );
        assert_eq!(
            host_version_relation("5.2.5", "5.2.6"),
            Some(std::cmp::Ordering::Less)
        );
        assert_eq!(host_version_relation("latest", "5.2.6"), None);
    }

    #[test]
    fn a_failed_staged_health_check_preserves_the_previous_adapter() {
        let root = scratch("health-rollback");
        fs::create_dir_all(&root).unwrap();
        let first = root.join("first.ccadapter");
        let invalid = root.join("invalid.ccadapter");
        let library = root.join("library");
        package_with_options(&first, "mac-workbuddy", "5.2.6", "first", "mac-workbuddy");
        install_adapter_package_to(&first, &library, "mac-workbuddy", Some("5.2.6")).unwrap();
        let active_before = fs::read(library.join("active/mac-workbuddy.json")).unwrap();
        package_with_options(
            &invalid,
            "mac-workbuddy",
            "5.2.6",
            "invalid",
            "other-adapter",
        );

        assert_eq!(
            install_adapter_package_to(&invalid, &library, "mac-workbuddy", Some("5.2.6"))
                .unwrap_err(),
            "adapter-health-check-failed"
        );
        assert_eq!(
            fs::read(library.join("active/mac-workbuddy.json")).unwrap(),
            active_before
        );
        assert!(fs::read_dir(library.join("transactions"))
            .unwrap()
            .next()
            .is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_pre_release_update_keeps_the_previous_pointer_for_rollback() {
        let root = scratch("previous-pointer");
        fs::create_dir_all(&root).unwrap();
        let first = root.join("first.ccadapter");
        let second = root.join("second.ccadapter");
        let library = root.join("library");
        package_with_options(&first, "mac-workbuddy", "5.2.6", "first", "mac-workbuddy");
        package_with_options(&second, "mac-workbuddy", "5.2.6", "second", "mac-workbuddy");
        let first_receipt =
            install_adapter_package_to(&first, &library, "mac-workbuddy", Some("5.2.6")).unwrap();
        let second_receipt =
            install_adapter_package_to(&second, &library, "mac-workbuddy", Some("5.2.6")).unwrap();
        let active: ActiveAdapterPointer =
            serde_json::from_slice(&fs::read(library.join("active/mac-workbuddy.json")).unwrap())
                .unwrap();
        let previous: ActiveAdapterPointer =
            serde_json::from_slice(&fs::read(library.join("previous/mac-workbuddy.json")).unwrap())
                .unwrap();

        assert!(second_receipt.replaced_local_adapter);
        assert_eq!(active.archive_sha256, second_receipt.archive_sha256);
        assert_eq!(previous.archive_sha256, first_receipt.archive_sha256);
        assert_ne!(active.archive_sha256, previous.archive_sha256);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn tampered_active_payload_is_rejected_instead_of_executed() {
        let root = scratch("tampered-payload");
        fs::create_dir_all(&root).unwrap();
        let archive = root.join("workbuddy.ccadapter");
        let library = root.join("library");
        package(&archive, "mac-workbuddy", "5.2.6");
        install_adapter_package_to(&archive, &library, "mac-workbuddy", Some("5.2.6")).unwrap();
        let payload = active_adapter_root_from(&library, "mac-workbuddy").unwrap();
        fs::write(payload.join("scripts/start-skin-macos.sh"), b"tampered").unwrap();

        assert!(active_adapter_root_from(&library, "mac-workbuddy").is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn an_invalid_new_activation_falls_back_to_the_last_verified_local_adapter() {
        let root = scratch("runtime-rollback");
        fs::create_dir_all(&root).unwrap();
        let first = root.join("first.ccadapter");
        let second = root.join("second.ccadapter");
        let library = root.join("library");
        package_with_options(&first, "mac-workbuddy", "5.2.6", "first", "mac-workbuddy");
        package_with_options(&second, "mac-workbuddy", "5.2.6", "second", "mac-workbuddy");
        let first_receipt =
            install_adapter_package_to(&first, &library, "mac-workbuddy", Some("5.2.6")).unwrap();
        install_adapter_package_to(&second, &library, "mac-workbuddy", Some("5.2.6")).unwrap();
        let active: ActiveAdapterPointer =
            serde_json::from_slice(&fs::read(library.join("active/mac-workbuddy.json")).unwrap())
                .unwrap();
        fs::write(
            library
                .join(active.store_relative_path)
                .join("scripts/start-skin-macos.sh"),
            b"tampered",
        )
        .unwrap();

        let recovered = active_adapter_root_from(&library, "mac-workbuddy").unwrap();
        assert!(recovered
            .to_string_lossy()
            .contains(&first_receipt.archive_sha256));
        fs::remove_dir_all(root).unwrap();
    }
}
