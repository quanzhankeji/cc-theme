use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::SystemTime,
};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use zip::ZipArchive;

use crate::{
    capabilities, compiler,
    models::{
        ClientId, CompatibilityState, LocalizedThemeDisplay, ThemeCompatibility, ThemeFamily,
    },
    registry,
};

const MAX_THEME_FILES: usize = 256;
const MAX_THEME_TOTAL_BYTES: u64 = 256 * 1024 * 1024;
const MAX_THEME_FILE_BYTES: u64 = 128 * 1024 * 1024;
const MAX_THEME_DEPTH: usize = 8;
const MAX_THEME_ARCHIVE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_THEME_PREVIEW_BYTES: u64 = 16 * 1024 * 1024;
const COMPILED_THEME_CACHE_FILE: &str = ".cc-theme-compiled.json";
static SEED_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompiledThemeCacheKey {
    pub adapter_id: String,
    pub theme_id: String,
    pub fingerprint: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CompiledThemeCacheRecord {
    kind: String,
    schema_version: u64,
    adapter_id: String,
    theme_id: String,
    fingerprint: String,
}

#[derive(Debug, Clone)]
pub struct ThemeMetadata {
    pub id: String,
    pub name: String,
    pub author: String,
    pub description: String,
    pub default_locale: String,
    pub localizations: BTreeMap<String, LocalizedThemeDisplay>,
    pub colors: [String; 3],
    pub preview_url: Option<String>,
    pub modified: SystemTime,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ThemePackageManifest {
    kind: String,
    schema_version: u64,
    id: String,
    version: String,
    minimum_manager_version: String,
    metadata: ThemePackageMetadata,
    source: ThemePackageFile,
    assets: Vec<ThemePackageAsset>,
    #[serde(default)]
    signatures: Vec<ThemePackageSignature>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ThemePackageMetadata {
    author: String,
    default_locale: String,
    locales: BTreeMap<String, LocalizedThemeDisplay>,
    preview_asset: String,
    license: String,
    asset_license: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ThemePackageFile {
    path: String,
    bytes: u64,
    sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ThemePackageAsset {
    path: String,
    bytes: u64,
    sha256: String,
    content_type: String,
    roles: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ThemePackageSignature {
    algorithm: String,
    key_id: String,
    value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UnifiedThemeSource {
    kind: String,
    schema_version: u64,
    id: String,
    name: String,
    version: String,
    shared_core: SharedCoreSource,
    #[serde(default)]
    presentation: Option<ThemePresentationSource>,
    targets: Vec<String>,
    #[serde(default)]
    target_profiles: BTreeMap<String, Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ThemePresentationSource {
    profile_id: String,
    profile_version: u64,
    strictness: String,
    geometry_policy: String,
    surfaces: Vec<String>,
    parameters: ThemePresentationParameters,
    asset_slots: ThemePresentationAssetSlots,
    fallback_policy: ThemePresentationFallbackPolicy,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ThemePresentationParameters {
    density: String,
    border_treatment: String,
    texture_intensity: f64,
    surface_opacity: f64,
    navigation_treatment: String,
    composer_treatment: String,
    card_treatment: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ThemePresentationAssetSlots {
    #[serde(rename = "scene.backdrop")]
    scene_backdrop: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ThemePresentationFallbackPolicy {
    unsupported_surface: String,
    reduced_motion: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SharedCoreSource {
    tokens: ThemeTokensSource,
    background: ThemeBackgroundSource,
    accessibility: ThemeAccessibilitySource,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ThemeTokensSource {
    colors: BTreeMap<String, String>,
    fonts: ThemeFontsSource,
    appearance: Option<ThemeAppearanceSource>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ThemeFontsSource {
    ui: Option<Vec<String>>,
    display: Option<Vec<String>>,
    code: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ThemeAppearanceSource {
    shell_mode: Option<String>,
    backdrop_blur_px: Option<f64>,
    backdrop_saturation: Option<f64>,
    radius_scale: Option<f64>,
    background_position: Option<ThemePosition>,
    home_hero_position: Option<ThemePosition>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ThemePosition {
    x_percent: f64,
    y_percent: f64,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "mode", rename_all = "lowercase", deny_unknown_fields)]
enum ThemeBackgroundSource {
    Media {
        image: String,
        #[serde(rename = "homeHeroImage")]
        home_hero_image: Option<String>,
        video: Option<String>,
        #[serde(rename = "posterMode")]
        poster_mode: Option<String>,
        #[serde(rename = "scrimOpacity")]
        scrim_opacity: Option<f64>,
        position: Option<ThemePosition>,
    },
    Ripple {
        image: String,
        #[serde(rename = "homeHeroImage")]
        home_hero_image: Option<String>,
        intensity: Option<f64>,
        #[serde(rename = "radiusPx")]
        radius_px: Option<f64>,
        quality: Option<String>,
        #[serde(rename = "scrimOpacity")]
        scrim_opacity: Option<f64>,
        position: Option<ThemePosition>,
    },
    Directional {
        image: String,
        #[serde(rename = "homeHeroImage")]
        home_hero_image: Option<String>,
        atlas: String,
        directions: u64,
        columns: u64,
        rows: u64,
        #[serde(rename = "firstDirectionDegrees")]
        first_direction_degrees: Option<f64>,
        #[serde(rename = "idleFrame")]
        idle_frame: Option<u64>,
        origin: Option<ThemePosition>,
        #[serde(rename = "scrimOpacity")]
        scrim_opacity: Option<f64>,
        position: Option<ThemePosition>,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ThemeAccessibilitySource {
    reduced_motion: String,
    minimum_text_contrast: Option<f64>,
    minimum_large_text_contrast: Option<f64>,
    preserve_system_focus_ring: Option<bool>,
    transparency_fallback: Option<String>,
}

#[derive(Debug, Clone)]
struct FamilyBuilder {
    metadata: ThemeMetadata,
    central_metadata: bool,
    clients: BTreeSet<String>,
    installed: bool,
}

pub fn valid_theme_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

pub fn import_theme_package(package: &Path) -> Result<String, String> {
    import_theme_package_to(package, &registry::manager_theme_library_root())
}

pub fn delete_theme_family(theme_id: &str) -> Result<usize, String> {
    if !valid_theme_id(theme_id) {
        return Err("theme-delete-id-invalid".to_string());
    }
    let home = registry::home_dir();
    let theme_roots = std::iter::once(registry::manager_theme_library_root())
        .chain(
            ClientId::ALL
                .into_iter()
                .map(|client_id| registry::saved_themes_root(&registry::definition(client_id))),
        )
        .collect::<Vec<_>>();
    let codex_root = home.join("Library/Application Support/CCTheme");
    let workbuddy_root = home.join("Library/Application Support/mac-workbuddy");
    let residual_files = vec![
        codex_root
            .join("style-overrides")
            .join(format!("{theme_id}.json")),
        workbuddy_root
            .join("settings")
            .join(format!("{theme_id}.json")),
        workbuddy_root
            .join("transactions")
            .join(format!("{theme_id}.base.json")),
    ];
    let residual_directories = Vec::new();
    let transaction_locks = vec![
        codex_root
            .join("style-overrides")
            .join(format!(".{theme_id}.json.transaction-lock")),
        workbuddy_root
            .join("transactions")
            .join(format!("{theme_id}.lock")),
    ];
    delete_theme_family_from_paths(
        theme_id,
        &theme_roots,
        &residual_files,
        &residual_directories,
        &transaction_locks,
    )
}

fn delete_theme_family_from_paths(
    theme_id: &str,
    theme_roots: &[PathBuf],
    residual_files: &[PathBuf],
    residual_directories: &[PathBuf],
    transaction_locks: &[PathBuf],
) -> Result<usize, String> {
    if !valid_theme_id(theme_id) {
        return Err("theme-delete-id-invalid".to_string());
    }
    for lock in transaction_locks {
        if lock.symlink_metadata().is_ok() {
            return Err("theme-delete-transaction-busy".to_string());
        }
    }
    let mut theme_directories = Vec::new();
    for root in theme_roots {
        let Some(candidate) = validated_delete_candidate(root, theme_id, true)? else {
            continue;
        };
        theme_directories.push(candidate);
    }
    let mut files = Vec::new();
    for path in residual_files {
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            return Err("theme-delete-path-invalid".to_string());
        };
        let parent = path
            .parent()
            .ok_or_else(|| "theme-delete-path-invalid".to_string())?;
        let Some(candidate) = validated_delete_candidate(parent, name, false)? else {
            continue;
        };
        files.push(candidate);
    }
    let mut directories = Vec::new();
    for path in residual_directories {
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            return Err("theme-delete-path-invalid".to_string());
        };
        let parent = path
            .parent()
            .ok_or_else(|| "theme-delete-path-invalid".to_string())?;
        let Some(candidate) = validated_delete_candidate(parent, name, true)? else {
            continue;
        };
        directories.push(candidate);
    }
    let removed = theme_directories.len() + files.len() + directories.len();
    if theme_directories.is_empty() {
        return Err("theme-delete-not-found".to_string());
    }
    for path in files {
        fs::remove_file(path).map_err(|_| "theme-delete-cleanup-failed".to_string())?;
    }
    for path in directories.into_iter().chain(theme_directories) {
        fs::remove_dir_all(path).map_err(|_| "theme-delete-cleanup-failed".to_string())?;
    }
    Ok(removed)
}

fn validated_delete_candidate(
    parent: &Path,
    name: &str,
    expect_directory: bool,
) -> Result<Option<PathBuf>, String> {
    let parent_metadata = match fs::symlink_metadata(parent) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("theme-delete-path-invalid".to_string()),
    };
    if !parent_metadata.file_type().is_dir() || parent_metadata.file_type().is_symlink() {
        return Err("theme-delete-path-invalid".to_string());
    }
    let candidate = parent.join(name);
    let metadata = match fs::symlink_metadata(&candidate) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("theme-delete-path-invalid".to_string()),
    };
    if metadata.file_type().is_symlink()
        || (expect_directory && !metadata.file_type().is_dir())
        || (!expect_directory && !metadata.file_type().is_file())
    {
        return Err("theme-delete-path-invalid".to_string());
    }
    let canonical_parent = parent
        .canonicalize()
        .map_err(|_| "theme-delete-path-invalid".to_string())?;
    let canonical_candidate = candidate
        .canonicalize()
        .map_err(|_| "theme-delete-path-invalid".to_string())?;
    if canonical_candidate.parent() != Some(canonical_parent.as_path()) {
        return Err("theme-delete-path-invalid".to_string());
    }
    Ok(Some(canonical_candidate))
}

fn import_theme_package_to(package: &Path, library_root: &Path) -> Result<String, String> {
    let extension = package
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase);
    if extension.as_deref() != Some("cctheme") {
        return Err("theme-package-extension-invalid".to_string());
    }
    let package_metadata =
        fs::symlink_metadata(package).map_err(|_| "theme-package-file-unavailable".to_string())?;
    if !package_metadata.file_type().is_file()
        || package_metadata.file_type().is_symlink()
        || package_metadata.len() < 22
        || package_metadata.len() > MAX_THEME_ARCHIVE_BYTES
    {
        return Err("theme-package-file-invalid".to_string());
    }
    prepare_saved_root(library_root)?;
    let container = library_root.join(format!(
        ".import-{}-{}",
        std::process::id(),
        SEED_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir(&container).map_err(|_| "theme-package-stage-create-failed".to_string())?;
    set_directory_permissions(&container)?;
    let stage = container.join("package");
    fs::create_dir(&stage).map_err(|_| "theme-package-stage-create-failed".to_string())?;
    set_directory_permissions(&stage)?;
    fs::create_dir(stage.join("assets"))
        .map_err(|_| "theme-package-stage-create-failed".to_string())?;
    set_directory_permissions(&stage.join("assets"))?;

    let result = extract_theme_archive(package, &stage).and_then(|_| {
        let manifest_file = stage.join("family.json");
        let manifest_metadata = fs::symlink_metadata(&manifest_file)
            .map_err(|_| "theme-package-manifest-missing".to_string())?;
        if !manifest_metadata.file_type().is_file()
            || manifest_metadata.file_type().is_symlink()
            || manifest_metadata.len() < 2
            || manifest_metadata.len() > 2 * 1024 * 1024
        {
            return Err("theme-package-manifest-invalid".to_string());
        }
        let manifest: ThemePackageManifest = serde_json::from_slice(
            &fs::read(&manifest_file)
                .map_err(|_| "theme-package-manifest-unreadable".to_string())?,
        )
        .map_err(|_| "theme-package-manifest-invalid".to_string())?;
        validate_package_manifest(&manifest)?;
        let canonical_stage = stage
            .canonicalize()
            .map_err(|_| "theme-package-stage-invalid".to_string())?;
        compiler::verify_family_manifest(&canonical_stage, &manifest.id)
            .map_err(|_| "theme-package-integrity-invalid".to_string())?;
        validate_package_source_and_media(&canonical_stage, &manifest)?;
        if read_package_metadata(&canonical_stage, &manifest.id, &manifest.version).is_none() {
            return Err("theme-package-display-metadata-invalid".to_string());
        }
        let destination = library_root.join(&manifest.id);
        if destination.exists() || destination.symlink_metadata().is_ok() {
            return Err("theme-package-already-installed".to_string());
        }
        fs::rename(&stage, &destination)
            .map_err(|_| "theme-package-atomic-install-failed".to_string())?;
        // Installation has committed atomically; cleanup must not turn a successful
        // import into a false failure that invites a duplicate retry.
        let _ = fs::remove_dir(&container);
        Ok(manifest.id)
    });
    if result.is_err() {
        let _ = fs::remove_dir_all(&container);
    }
    result
}

fn extract_theme_archive(package: &Path, stage: &Path) -> Result<(), String> {
    let file = fs::File::open(package).map_err(|_| "theme-package-file-unreadable".to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|_| "theme-package-zip-invalid".to_string())?;
    if archive.len() < 3 || archive.len() > MAX_THEME_FILES {
        return Err("theme-package-entry-count-invalid".to_string());
    }
    let mut names = BTreeSet::new();
    let mut total_bytes = 0_u64;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|_| "theme-package-entry-invalid".to_string())?;
        let name = entry.name().to_string();
        if name.contains('\\') || entry.is_dir() || entry.enclosed_name().is_none() {
            return Err("theme-package-entry-path-invalid".to_string());
        }
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("theme-package-symlink-forbidden".to_string());
        }
        let allowed = matches!(name.as_str(), "family.json" | "unified-theme.json")
            || name
                .strip_prefix("assets/")
                .is_some_and(safe_asset_basename);
        if !allowed || !names.insert(name.clone()) {
            return Err("theme-package-entry-not-allowlisted".to_string());
        }
        let size = entry.size();
        if size == 0 || size > MAX_THEME_FILE_BYTES {
            return Err("theme-package-entry-size-invalid".to_string());
        }
        total_bytes = total_bytes
            .checked_add(size)
            .ok_or_else(|| "theme-package-size-overflow".to_string())?;
        if total_bytes > MAX_THEME_TOTAL_BYTES {
            return Err("theme-package-uncompressed-size-invalid".to_string());
        }
        let destination = stage.join(&name);
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)
            .map_err(|_| "theme-package-entry-create-failed".to_string())?;
        set_file_permissions(&destination)?;
        let copied = std::io::copy(&mut entry, &mut output)
            .map_err(|_| "theme-package-entry-extract-failed".to_string())?;
        if copied != size {
            return Err("theme-package-entry-size-mismatch".to_string());
        }
        output
            .flush()
            .and_then(|_| output.sync_all())
            .map_err(|_| "theme-package-entry-persist-failed".to_string())?;
    }
    if !names.contains("family.json")
        || !names.contains("unified-theme.json")
        || !names.iter().any(|name| name.starts_with("assets/"))
    {
        return Err("theme-package-required-entry-missing".to_string());
    }
    Ok(())
}

fn validate_package_source_and_media(
    family: &Path,
    manifest: &ThemePackageManifest,
) -> Result<(), String> {
    let source_bytes = fs::read(family.join("unified-theme.json"))
        .map_err(|_| "theme-package-source-unreadable".to_string())?;
    let source_value: Value = serde_json::from_slice(&source_bytes)
        .map_err(|_| "theme-package-source-invalid".to_string())?;
    if let Some(presentation) = source_value.get("presentation") {
        serde_json::from_value::<ThemePresentationSource>(presentation.clone())
            .map_err(|_| "theme-package-presentation-invalid".to_string())?;
    }
    let source: UnifiedThemeSource = serde_json::from_value(source_value)
        .map_err(|_| "theme-package-source-invalid".to_string())?;
    let required_assets = validate_unified_theme_source(&source, manifest)?;
    for asset in &manifest.assets {
        let mut file = fs::File::open(family.join(&asset.path))
            .map_err(|_| "theme-package-asset-unreadable".to_string())?;
        let mut header = [0_u8; 12];
        let count = file
            .read(&mut header)
            .map_err(|_| "theme-package-asset-unreadable".to_string())?;
        if !asset_magic_matches(&header[..count], &asset.content_type) {
            return Err("theme-package-asset-magic-invalid".to_string());
        }
    }
    for (name, role) in required_assets {
        let expected_path = format!("assets/{name}");
        if !manifest.assets.iter().any(|asset| {
            asset.path == expected_path && asset.roles.iter().any(|value| value == role)
        }) {
            return Err("theme-package-source-asset-binding-invalid".to_string());
        }
    }
    Ok(())
}

fn validate_unified_theme_source<'a>(
    source: &'a UnifiedThemeSource,
    manifest: &ThemePackageManifest,
) -> Result<Vec<(&'a str, &'static str)>, String> {
    let canonical_targets = ["mac-codex", "mac-doubao", "mac-workbuddy"];
    if source.kind != "cc-theme.unified-theme"
        || source.schema_version != 1
        || source.id != manifest.id
        || source.version != manifest.version
        || !valid_theme_id(&source.id)
        || source.name.trim().is_empty()
        || source.name.len() > 80
        || !valid_package_version(&source.version)
        || source.targets.is_empty()
        || source.targets.iter().collect::<BTreeSet<_>>().len() != source.targets.len()
        || source
            .targets
            .iter()
            .any(|target| !canonical_targets.contains(&target.as_str()))
        || source.target_profiles.iter().any(|(target, profile)| {
            !canonical_targets.contains(&target.as_str()) || !profile.is_object()
        })
    {
        return Err("theme-package-source-contract-invalid".to_string());
    }

    validate_theme_tokens(&source.shared_core.tokens)?;
    validate_theme_accessibility(&source.shared_core.accessibility)?;
    let assets = validate_theme_background(&source.shared_core.background)?;
    if let Some(presentation) = &source.presentation {
        validate_theme_presentation(presentation, &source.shared_core.background)?;
    }
    Ok(assets)
}

fn validate_theme_presentation(
    value: &ThemePresentationSource,
    background: &ThemeBackgroundSource,
) -> Result<(), String> {
    const SURFACES: [&str; 7] = [
        "shell",
        "navigation",
        "home",
        "conversation",
        "composer",
        "cards",
        "overlays",
    ];
    let parameters = &value.parameters;
    let declared_surfaces = value
        .surfaces
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let expected_surfaces = SURFACES.into_iter().collect::<BTreeSet<_>>();
    let background_image = match background {
        ThemeBackgroundSource::Media { image, .. }
        | ThemeBackgroundSource::Ripple { image, .. }
        | ThemeBackgroundSource::Directional { image, .. } => image,
    };
    if value.profile_id != "immersive-scene-v1"
        || value.profile_version != 1
        || value.strictness != "exact-required"
        || value.geometry_policy != "scene-bounded"
        || value.surfaces.len() != SURFACES.len()
        || declared_surfaces != expected_surfaces
        || parameters.density != "comfortable"
        || parameters.border_treatment != "etched"
        || !parameters.texture_intensity.is_finite()
        || !(0.0..=1.0).contains(&parameters.texture_intensity)
        || !parameters.surface_opacity.is_finite()
        || !(0.4..=0.88).contains(&parameters.surface_opacity)
        || parameters.navigation_treatment != "framed"
        || parameters.composer_treatment != "anchored"
        || parameters.card_treatment != "elevated"
        || !valid_local_asset(
            &value.asset_slots.scene_backdrop,
            &["png", "jpg", "jpeg", "webp"],
        )
        || value.asset_slots.scene_backdrop != *background_image
        || value.fallback_policy.unsupported_surface != "block"
        || value.fallback_policy.reduced_motion != "static"
    {
        return Err("theme-package-presentation-invalid".to_string());
    }
    Ok(())
}

fn validate_theme_tokens(tokens: &ThemeTokensSource) -> Result<(), String> {
    const REQUIRED_COLORS: [&str; 6] = [
        "surfaceBase",
        "text",
        "textMuted",
        "action",
        "actionForeground",
        "focusRing",
    ];
    const ALLOWED_COLORS: [&str; 30] = [
        "surfaceBase",
        "surfaceRaised",
        "surfaceElevated",
        "surfaceCode",
        "text",
        "textStrong",
        "textMuted",
        "placeholder",
        "borderSubtle",
        "borderDefault",
        "borderStrong",
        "action",
        "actionHover",
        "actionPressed",
        "actionForeground",
        "hoverSurface",
        "pressedSurface",
        "selectedSurface",
        "selectedHoverSurface",
        "focusRing",
        "link",
        "danger",
        "success",
        "warning",
        "sidebarSurface",
        "headerSurface",
        "mainScrimStart",
        "mainScrimMid",
        "mainScrimEnd",
        "composerSurface",
    ];
    if tokens.colors.is_empty()
        || REQUIRED_COLORS
            .iter()
            .any(|name| !tokens.colors.contains_key(*name))
        || tokens
            .colors
            .iter()
            .any(|(name, value)| !ALLOWED_COLORS.contains(&name.as_str()) || !valid_color(value))
    {
        return Err("theme-package-source-contract-invalid".to_string());
    }
    let font_lists = [
        tokens.fonts.ui.as_ref(),
        tokens.fonts.display.as_ref(),
        tokens.fonts.code.as_ref(),
    ];
    if font_lists.iter().all(|fonts| fonts.is_none())
        || font_lists.into_iter().flatten().any(|fonts| {
            fonts.is_empty()
                || fonts.len() > 8
                || fonts.iter().collect::<BTreeSet<_>>().len() != fonts.len()
                || fonts.iter().any(|font| {
                    font.is_empty() || font.len() > 80 || font.contains([':', '/', '\\'])
                })
        })
    {
        return Err("theme-package-source-contract-invalid".to_string());
    }
    if let Some(appearance) = &tokens.appearance {
        if appearance
            .shell_mode
            .as_deref()
            .is_some_and(|value| !matches!(value, "auto" | "light" | "dark"))
            || !optional_range(appearance.backdrop_blur_px, 0.0, 48.0)
            || !optional_range(appearance.backdrop_saturation, 0.5, 1.5)
            || !optional_range(appearance.radius_scale, 0.75, 1.5)
            || !optional_position(&appearance.background_position)
            || !optional_position(&appearance.home_hero_position)
        {
            return Err("theme-package-source-contract-invalid".to_string());
        }
    }
    Ok(())
}

fn validate_theme_accessibility(value: &ThemeAccessibilitySource) -> Result<(), String> {
    let _ = value.preserve_system_focus_ring;
    if value.reduced_motion != "static"
        || !optional_range(value.minimum_text_contrast, 4.5, 7.0)
        || !optional_range(value.minimum_large_text_contrast, 3.0, 7.0)
        || value
            .transparency_fallback
            .as_deref()
            .is_some_and(|fallback| !matches!(fallback, "opaque" | "increased-scrim"))
    {
        return Err("theme-package-source-contract-invalid".to_string());
    }
    Ok(())
}

fn validate_theme_background(
    value: &ThemeBackgroundSource,
) -> Result<Vec<(&str, &'static str)>, String> {
    let invalid = || Err("theme-package-source-contract-invalid".to_string());
    match value {
        ThemeBackgroundSource::Media {
            image,
            home_hero_image,
            video,
            poster_mode,
            scrim_opacity,
            position,
        } => {
            if !valid_local_asset(image, &["png", "jpg", "jpeg", "webp"])
                || home_hero_image
                    .as_deref()
                    .is_some_and(|name| !valid_local_asset(name, &["png", "jpg", "jpeg", "webp"]))
                || video
                    .as_deref()
                    .is_some_and(|name| !valid_local_asset(name, &["mp4"]))
                || poster_mode
                    .as_deref()
                    .is_some_and(|mode| !matches!(mode, "none" | "image"))
                || !optional_range(*scrim_opacity, 0.0, 0.8)
                || !optional_position(position)
            {
                return invalid();
            }
            let mut assets = vec![(image.as_str(), "background")];
            if let Some(name) = home_hero_image {
                assets.push((name.as_str(), "home-hero"));
            }
            if let Some(name) = video {
                assets.push((name.as_str(), "video"));
            }
            Ok(assets)
        }
        ThemeBackgroundSource::Ripple {
            image,
            home_hero_image,
            intensity,
            radius_px,
            quality,
            scrim_opacity,
            position,
        } => {
            if !valid_local_asset(image, &["png", "jpg", "jpeg", "webp"])
                || home_hero_image
                    .as_deref()
                    .is_some_and(|name| !valid_local_asset(name, &["png", "jpg", "jpeg", "webp"]))
                || !optional_range(*intensity, 0.0, 1.0)
                || !optional_range(*radius_px, 8.0, 96.0)
                || quality
                    .as_deref()
                    .is_some_and(|value| !matches!(value, "auto" | "low" | "high"))
                || !optional_range(*scrim_opacity, 0.0, 0.8)
                || !optional_position(position)
            {
                return invalid();
            }
            let mut assets = vec![(image.as_str(), "background")];
            if let Some(name) = home_hero_image {
                assets.push((name.as_str(), "home-hero"));
            }
            Ok(assets)
        }
        ThemeBackgroundSource::Directional {
            image,
            home_hero_image,
            atlas,
            directions,
            columns,
            rows,
            first_direction_degrees,
            idle_frame,
            origin,
            scrim_opacity,
            position,
        } => {
            let valid_grid = matches!(
                (*directions, *columns, *rows),
                (8, 1, 8)
                    | (8, 2, 4)
                    | (8, 4, 2)
                    | (8, 8, 1)
                    | (16, 2, 8)
                    | (16, 4, 4)
                    | (16, 8, 2)
                    | (32, 4, 8)
                    | (32, 8, 4)
            );
            if !valid_local_asset(image, &["png", "jpg", "jpeg", "webp"])
                || home_hero_image
                    .as_deref()
                    .is_some_and(|name| !valid_local_asset(name, &["png", "jpg", "jpeg", "webp"]))
                || !valid_local_asset(atlas, &["webp"])
                || !valid_grid
                || !optional_range(*first_direction_degrees, -180.0, 180.0)
                || idle_frame.is_some_and(|value| value > 31)
                || !optional_position(origin)
                || !optional_range(*scrim_opacity, 0.0, 0.8)
                || !optional_position(position)
            {
                return invalid();
            }
            let mut assets = vec![(image.as_str(), "background"), (atlas.as_str(), "atlas")];
            if let Some(name) = home_hero_image {
                assets.push((name.as_str(), "home-hero"));
            }
            Ok(assets)
        }
    }
}

fn valid_color(value: &str) -> bool {
    if value.len() > 48 {
        return false;
    }
    if value.len() == 7 && value.starts_with('#') {
        return value[1..].bytes().all(|byte| byte.is_ascii_hexdigit());
    }
    let inner = value
        .strip_prefix("rgb(")
        .or_else(|| value.strip_prefix("rgba("))
        .and_then(|value| value.strip_suffix(')'));
    inner.is_some_and(|inner| {
        !inner.is_empty()
            && inner
                .bytes()
                .all(|byte| byte.is_ascii_digit() || matches!(byte, b'.' | b',' | b' ' | b'%'))
    })
}

fn valid_local_asset(value: &str, extensions: &[&str]) -> bool {
    safe_asset_basename(value)
        && Path::new(value)
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extensions.contains(&extension.to_ascii_lowercase().as_str()))
}

fn optional_range(value: Option<f64>, minimum: f64, maximum: f64) -> bool {
    value.is_none_or(|value| value.is_finite() && (minimum..=maximum).contains(&value))
}

fn optional_position(value: &Option<ThemePosition>) -> bool {
    value.as_ref().is_none_or(|position| {
        position.x_percent.is_finite()
            && position.y_percent.is_finite()
            && (0.0..=100.0).contains(&position.x_percent)
            && (0.0..=100.0).contains(&position.y_percent)
    })
}

fn asset_magic_matches(bytes: &[u8], content_type: &str) -> bool {
    match content_type {
        "image/png" => bytes.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10]),
        "image/jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "image/webp" => bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
        "video/mp4" => bytes.len() >= 12 && &bytes[4..8] == b"ftyp",
        _ => false,
    }
}

pub fn read_theme_metadata(directory: &Path) -> Option<ThemeMetadata> {
    let directory_metadata = fs::symlink_metadata(directory).ok()?;
    if !directory_metadata.file_type().is_dir() || directory_metadata.file_type().is_symlink() {
        return None;
    }
    let expected_id = directory.file_name()?.to_str()?;
    read_theme_metadata_file(&directory.join("theme.json"), expected_id)
}

fn read_theme_metadata_file(file: &Path, expected_id: &str) -> Option<ThemeMetadata> {
    let metadata = fs::symlink_metadata(&file).ok()?;
    if !metadata.file_type().is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() < 2
        || metadata.len() > 2 * 1024 * 1024
    {
        return None;
    }
    let value: Value = serde_json::from_slice(&fs::read(file).ok()?).ok()?;
    let id = value.get("id")?.as_str()?.to_string();
    if !valid_theme_id(&id) || expected_id != id {
        return None;
    }
    let name = value
        .get("name")
        .and_then(Value::as_str)
        .filter(|name| !name.trim().is_empty())
        .unwrap_or(&id)
        .to_string();
    let author = value
        .get("author")
        .and_then(Value::as_str)
        .unwrap_or("CC Theme")
        .to_string();
    let description = value
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or("统一主题家族，由各客户端适配器映射到对应界面。")
        .to_string();
    let colors = theme_colors(&value);
    Some(ThemeMetadata {
        id,
        name: name.clone(),
        author,
        description: description.clone(),
        default_locale: "en-US".to_string(),
        localizations: BTreeMap::from([(
            "en-US".to_string(),
            LocalizedThemeDisplay { name, description },
        )]),
        colors,
        preview_url: None,
        modified: metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
    })
}

fn read_unified_family_metadata(
    family: &Path,
    expected_id: &str,
) -> Option<(ThemeMetadata, BTreeSet<String>)> {
    let file = family.join("unified-theme.json");
    let metadata = fs::symlink_metadata(&file).ok()?;
    if !metadata.file_type().is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() < 2
        || metadata.len() > 2 * 1024 * 1024
    {
        return None;
    }
    let value: Value = serde_json::from_slice(&fs::read(file).ok()?).ok()?;
    if value.get("kind").and_then(Value::as_str) != Some("cc-theme.unified-theme")
        || value.get("schemaVersion").and_then(Value::as_u64) != Some(1)
    {
        return None;
    }
    let id = value.get("id")?.as_str()?.to_string();
    if !valid_theme_id(&id) || id != expected_id {
        return None;
    }
    let targets = value
        .get("targets")?
        .as_array()?
        .iter()
        .map(Value::as_str)
        .collect::<Option<Vec<_>>>()?;
    if targets.is_empty() || targets.len() > 64 {
        return None;
    }
    let targets: BTreeSet<String> = targets
        .into_iter()
        .filter(|adapter_id| {
            adapter_id.len() <= 80
                && adapter_id
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        })
        .map(str::to_string)
        .collect();
    if targets.is_empty() {
        return None;
    }
    let name = value
        .get("name")
        .and_then(Value::as_str)
        .filter(|name| !name.trim().is_empty())
        .unwrap_or(&id)
        .to_string();
    let package_metadata = read_package_metadata(family, &id, value.get("version")?.as_str()?)
        .unwrap_or_else(|| ThemeMetadata {
            id: id.clone(),
            name: name.clone(),
            author: "CC Theme".to_string(),
            description: "统一主题家族，由各客户端适配器映射到对应界面。".to_string(),
            default_locale: "en-US".to_string(),
            localizations: BTreeMap::new(),
            colors: theme_colors(&value),
            preview_url: None,
            modified: metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
        });
    Some((package_metadata, targets))
}

fn read_package_metadata(
    family: &Path,
    expected_id: &str,
    expected_version: &str,
) -> Option<ThemeMetadata> {
    let manifest_file = family.join("family.json");
    let file_metadata = fs::symlink_metadata(&manifest_file).ok()?;
    if !file_metadata.file_type().is_file()
        || file_metadata.file_type().is_symlink()
        || file_metadata.len() < 2
        || file_metadata.len() > 2 * 1024 * 1024
    {
        return None;
    }
    let manifest: ThemePackageManifest =
        serde_json::from_slice(&fs::read(&manifest_file).ok()?).ok()?;
    validate_package_manifest(&manifest).ok()?;
    if manifest.id != expected_id || manifest.version != expected_version {
        return None;
    }
    let display = manifest
        .metadata
        .locales
        .get(&manifest.metadata.default_locale)
        .or_else(|| manifest.metadata.locales.get("en-US"))
        .or_else(|| manifest.metadata.locales.values().next())?;
    let source: Value =
        serde_json::from_slice(&fs::read(family.join("unified-theme.json")).ok()?).ok()?;
    let preview_url = preview_asset_path(family, &manifest).map(|_| {
        let revision = file_metadata
            .modified()
            .ok()
            .and_then(|value| value.duration_since(SystemTime::UNIX_EPOCH).ok())
            .map_or(0, |value| value.as_millis());
        format!(
            "cc-theme-preview://localhost/{}?revision={revision}",
            manifest.id
        )
    });
    Some(ThemeMetadata {
        id: manifest.id,
        name: display.name.clone(),
        author: manifest.metadata.author,
        description: display.description.clone(),
        default_locale: manifest.metadata.default_locale,
        localizations: manifest.metadata.locales,
        colors: theme_colors(&source),
        preview_url,
        modified: file_metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
    })
}

fn preview_asset_path<'a>(
    family: &Path,
    manifest: &'a ThemePackageManifest,
) -> Option<(&'a ThemePackageAsset, PathBuf)> {
    let preview_path = format!("assets/{}", manifest.metadata.preview_asset);
    let asset = manifest.assets.iter().find(|asset| {
        asset.path == preview_path
            && asset.roles.iter().any(|role| role == "preview")
            && asset.content_type.starts_with("image/")
    })?;
    if asset.bytes == 0 || asset.bytes > MAX_THEME_PREVIEW_BYTES {
        return None;
    }
    let canonical_family = family.canonicalize().ok()?;
    let canonical_assets = validated_direct_directory(
        &canonical_family,
        &canonical_family.join("assets"),
        "theme preview assets",
    )
    .ok()?;
    let preview_file = canonical_assets.join(&manifest.metadata.preview_asset);
    let metadata = fs::symlink_metadata(&preview_file).ok()?;
    if !metadata.file_type().is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() != asset.bytes
    {
        return None;
    }
    let canonical_preview = preview_file.canonicalize().ok()?;
    if canonical_preview.parent() != Some(canonical_assets.as_path()) {
        return None;
    }
    Some((asset, canonical_preview))
}

pub fn load_theme_preview(theme_id: &str) -> Option<(String, Vec<u8>)> {
    load_theme_preview_from(&registry::manager_theme_library_root(), theme_id)
}

fn load_theme_preview_from(library_root: &Path, theme_id: &str) -> Option<(String, Vec<u8>)> {
    if !valid_theme_id(theme_id) {
        return None;
    }
    let root_metadata = fs::symlink_metadata(library_root).ok()?;
    if !root_metadata.file_type().is_dir() || root_metadata.file_type().is_symlink() {
        return None;
    }
    let canonical_root = library_root.canonicalize().ok()?;
    let family = validated_direct_directory(
        &canonical_root,
        &canonical_root.join(theme_id),
        "theme preview family",
    )
    .ok()?;
    let manifest_file = family.join("family.json");
    let manifest_metadata = fs::symlink_metadata(&manifest_file).ok()?;
    if !manifest_metadata.file_type().is_file()
        || manifest_metadata.file_type().is_symlink()
        || manifest_metadata.len() < 2
        || manifest_metadata.len() > 2 * 1024 * 1024
    {
        return None;
    }
    let manifest: ThemePackageManifest =
        serde_json::from_slice(&fs::read(manifest_file).ok()?).ok()?;
    validate_package_manifest(&manifest).ok()?;
    if manifest.id != theme_id {
        return None;
    }
    let (asset, preview_file) = preview_asset_path(&family, &manifest)?;
    let bytes = fs::read(preview_file).ok()?;
    if !asset_magic_matches(&bytes[..bytes.len().min(12)], &asset.content_type)
        || format!("{:x}", Sha256::digest(&bytes)) != asset.sha256
    {
        return None;
    }
    Some((asset.content_type.clone(), bytes))
}

fn valid_package_version(value: &str) -> bool {
    if value.is_empty() || value.len() > 40 || !value.is_ascii() {
        return false;
    }
    let (core, prerelease) = value
        .split_once('-')
        .map_or((value, None), |(core, prerelease)| (core, Some(prerelease)));
    let parts = core.split('.').collect::<Vec<_>>();
    parts.len() == 3
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
        && prerelease.is_none_or(|suffix| {
            !suffix.is_empty()
                && suffix
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-'))
        })
}

fn numeric_version(value: &str) -> Option<(u64, u64, u64)> {
    let core = value.split_once('-').map_or(value, |(core, _)| core);
    let mut parts = core.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next()?.parse().ok()?;
    parts.next().is_none().then_some((major, minor, patch))
}

fn manager_supports(minimum: &str) -> bool {
    match (
        numeric_version(env!("CARGO_PKG_VERSION")),
        numeric_version(minimum),
    ) {
        (Some(current), Some(required)) => current >= required,
        _ => false,
    }
}

fn valid_locale(value: &str) -> bool {
    if value.len() < 2 || value.len() > 16 || !value.is_ascii() {
        return false;
    }
    let mut parts = value.split('-');
    let language = parts.next().unwrap_or_default();
    let region = parts.next();
    let valid_region = match region {
        Some(value) => value.len() == 2 && value.bytes().all(|byte| byte.is_ascii_uppercase()),
        None => true,
    };
    parts.next().is_none()
        && (2..=3).contains(&language.len())
        && language.bytes().all(|byte| byte.is_ascii_lowercase())
        && valid_region
}

fn safe_asset_basename(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 255
        && Path::new(value).file_name().and_then(|name| name.to_str()) == Some(value)
        && !value.contains(['/', '\\', ':'])
        && value.bytes().all(|byte| !byte.is_ascii_control())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
        && matches!(
            Path::new(value)
                .extension()
                .and_then(|extension| extension.to_str())
                .map(str::to_ascii_lowercase)
                .as_deref(),
            Some("png" | "jpg" | "jpeg" | "webp" | "mp4")
        )
}

fn validate_package_manifest(manifest: &ThemePackageManifest) -> Result<(), String> {
    if manifest.kind != "cc-theme.theme-family-package"
        || manifest.schema_version != 1
        || !valid_theme_id(&manifest.id)
        || !valid_package_version(&manifest.version)
        || !valid_package_version(&manifest.minimum_manager_version)
    {
        return Err("theme-package-manifest-invalid".to_string());
    }
    if !manager_supports(&manifest.minimum_manager_version) {
        return Err("theme-package-manager-version-unsupported".to_string());
    }
    if manifest.source.path != "unified-theme.json"
        || manifest.source.bytes == 0
        || manifest.source.bytes > 2 * 1024 * 1024
        || !valid_sha256(&manifest.source.sha256)
    {
        return Err("theme-package-source-manifest-invalid".to_string());
    }
    let metadata = &manifest.metadata;
    if metadata.author.trim().is_empty()
        || metadata.author.len() > 120
        || !valid_locale(&metadata.default_locale)
        || !metadata.locales.contains_key("zh-CN")
        || !metadata.locales.contains_key("en-US")
        || !metadata.locales.contains_key(&metadata.default_locale)
        || metadata.locales.len() > 24
        || !safe_asset_basename(&metadata.preview_asset)
        || !matches!(
            Path::new(&metadata.preview_asset)
                .extension()
                .and_then(|value| value.to_str())
                .map(str::to_ascii_lowercase)
                .as_deref(),
            Some("png" | "jpg" | "jpeg" | "webp")
        )
        || metadata.license.trim().is_empty()
        || metadata.license.len() > 80
        || metadata.asset_license.trim().is_empty()
        || metadata.asset_license.len() > 80
    {
        return Err("theme-package-metadata-invalid".to_string());
    }
    for (locale, display) in &metadata.locales {
        if !valid_locale(locale)
            || display.name.trim().is_empty()
            || display.name.len() > 120
            || display.description.trim().is_empty()
            || display.description.len() > 500
        {
            return Err("theme-package-localization-invalid".to_string());
        }
    }
    if manifest.assets.is_empty() || manifest.assets.len() > 64 {
        return Err("theme-package-assets-invalid".to_string());
    }
    let mut paths = BTreeSet::new();
    let allowed_roles = [
        "background",
        "home-hero",
        "video",
        "atlas",
        "preview",
        "supporting",
    ];
    for asset in &manifest.assets {
        let Some(name) = asset.path.strip_prefix("assets/") else {
            return Err("theme-package-asset-path-invalid".to_string());
        };
        if !safe_asset_basename(name)
            || !paths.insert(asset.path.clone())
            || asset.bytes == 0
            || asset.bytes > MAX_THEME_FILE_BYTES
            || !valid_sha256(&asset.sha256)
            || asset.roles.is_empty()
            || asset.roles.len() > 8
            || asset.roles.iter().collect::<BTreeSet<_>>().len() != asset.roles.len()
            || asset
                .roles
                .iter()
                .any(|role| !allowed_roles.contains(&role.as_str()))
        {
            return Err("theme-package-asset-manifest-invalid".to_string());
        }
        let expected_type = match Path::new(name)
            .extension()
            .and_then(|value| value.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref()
        {
            Some("png") => "image/png",
            Some("jpg" | "jpeg") => "image/jpeg",
            Some("webp") => "image/webp",
            Some("mp4") => "video/mp4",
            _ => return Err("theme-package-asset-type-invalid".to_string()),
        };
        if asset.content_type != expected_type {
            return Err("theme-package-asset-type-invalid".to_string());
        }
    }
    let preview_path = format!("assets/{}", metadata.preview_asset);
    if !manifest
        .assets
        .iter()
        .any(|asset| asset.path == preview_path && asset.roles.iter().any(|role| role == "preview"))
    {
        return Err("theme-package-preview-invalid".to_string());
    }
    if manifest.signatures.len() > 8 {
        return Err("theme-package-signature-invalid".to_string());
    }
    for signature in &manifest.signatures {
        if signature.algorithm != "Ed25519"
            || signature.key_id.is_empty()
            || signature.key_id.len() > 80
            || !signature
                .key_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
            || signature.value.len() != 88
            || !signature
                .value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'='))
            || !signature.value.ends_with("==")
        {
            return Err("theme-package-signature-invalid".to_string());
        }
    }
    Ok(())
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

/// Makes a downloaded central Theme Family available to the Adapter's saved library.
/// Existing valid saved themes win so a Manager apply never erases local edits.
pub fn ensure_saved_theme(
    definition: &registry::ClientDefinition,
    theme_id: &str,
) -> Result<PathBuf, String> {
    if !valid_theme_id(theme_id) {
        return Err("主题 id 不符合安全白名单".to_string());
    }
    let saved_root = registry::saved_themes_root(definition);
    let saved = saved_root.join(theme_id);
    if saved.exists() || saved.symlink_metadata().is_ok() {
        return validate_existing_saved_theme(&saved, theme_id);
    }
    if let Some(root) =
        std::env::var_os("CC_THEME_BUNDLED_THEMES_ROOT").filter(|value| !value.is_empty())
    {
        let central_root = PathBuf::from(root);
        let family = central_root.join(theme_id);
        if family.symlink_metadata().is_ok() {
            return seed_central_theme_into_library(
                &central_root,
                definition.id.as_str(),
                &saved_root,
                theme_id,
            );
        }
    }
    Err("主题不在中央主题库或已下载的本地主题库中".to_string())
}

/// Publishes a freshly compiled Adapter target together with the Theme Family's
/// shared assets. A matching generated snapshot is reused; a stale snapshot is
/// replaced atomically. Adapter-owned settings and transaction state live outside
/// this generated directory and are therefore preserved.
pub fn seed_compiled_theme_into_library(
    definition: &registry::ClientDefinition,
    compiled_target: &Path,
    assets: &Path,
    theme_id: &str,
    cache_key: &CompiledThemeCacheKey,
) -> Result<PathBuf, String> {
    if cache_key.adapter_id != definition.id.as_str() || cache_key.theme_id != theme_id {
        return Err("编译缓存身份与目标 Adapter 不一致".to_string());
    }
    seed_compiled_theme_to_saved_root(
        compiled_target,
        assets,
        &registry::saved_themes_root(definition),
        theme_id,
        cache_key,
    )
}

pub fn cached_compiled_theme(
    definition: &registry::ClientDefinition,
    cache_key: &CompiledThemeCacheKey,
) -> Option<PathBuf> {
    if cache_key.adapter_id != definition.id.as_str() {
        return None;
    }
    cached_compiled_theme_from(&registry::saved_themes_root(definition), cache_key)
}

fn valid_compiled_theme_cache_key(cache_key: &CompiledThemeCacheKey) -> bool {
    valid_adapter_id(&cache_key.adapter_id)
        && valid_theme_id(&cache_key.theme_id)
        && valid_sha256(&cache_key.fingerprint)
}

fn cached_compiled_theme_from(
    saved_root: &Path,
    cache_key: &CompiledThemeCacheKey,
) -> Option<PathBuf> {
    if !valid_compiled_theme_cache_key(cache_key) {
        return None;
    }
    let destination = saved_root.join(&cache_key.theme_id);
    if validate_existing_saved_theme(&destination, &cache_key.theme_id).is_err() {
        return None;
    }
    let record_path = destination.join(COMPILED_THEME_CACHE_FILE);
    let metadata = record_path.symlink_metadata().ok()?;
    if !metadata.file_type().is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() > 16 * 1024
    {
        return None;
    }
    let record: CompiledThemeCacheRecord =
        serde_json::from_slice(&fs::read(record_path).ok()?).ok()?;
    (record.kind == "cc-theme.compiled-target-cache"
        && record.schema_version == 1
        && record.adapter_id == cache_key.adapter_id
        && record.theme_id == cache_key.theme_id
        && record.fingerprint == cache_key.fingerprint)
        .then_some(destination)
}

fn seed_compiled_theme_to_saved_root(
    compiled_target: &Path,
    assets: &Path,
    saved_root: &Path,
    theme_id: &str,
    cache_key: &CompiledThemeCacheKey,
) -> Result<PathBuf, String> {
    if !valid_theme_id(theme_id) {
        return Err("主题 id 不符合安全白名单".to_string());
    }
    if !valid_compiled_theme_cache_key(cache_key) || cache_key.theme_id != theme_id {
        return Err("编译缓存身份无效".to_string());
    }
    let target_parent = compiled_target
        .parent()
        .ok_or_else(|| "编译目标目录无效".to_string())?
        .canonicalize()
        .map_err(|_| "无法解析编译输出根目录".to_string())?;
    let canonical_target =
        validated_direct_directory(&target_parent, compiled_target, "编译后的 Adapter target")?;
    let assets_parent = assets
        .parent()
        .ok_or_else(|| "主题 assets 目录无效".to_string())?
        .canonicalize()
        .map_err(|_| "无法解析主题 family".to_string())?;
    let canonical_assets = validated_direct_directory(&assets_parent, assets, "共享 assets")?;
    let theme_json = canonical_target.join("theme.json");
    if read_theme_id(&theme_json).as_deref() != Some(theme_id) {
        return Err("编译后的 target theme.json 与 family id 不一致".to_string());
    }

    prepare_saved_root(saved_root)?;
    let destination = saved_root.join(theme_id);
    if cached_compiled_theme_from(saved_root, cache_key).is_some() {
        return Ok(destination);
    }
    if destination.symlink_metadata().is_ok() {
        let saved_root_real = saved_root
            .canonicalize()
            .map_err(|_| "无法解析 Adapter 主题库".to_string())?;
        validated_direct_directory(&saved_root_real, &destination, "旧的编译主题缓存")?;
    }
    let stage_container = saved_root.join(format!(
        ".compile-{theme_id}-{}-{}",
        std::process::id(),
        SEED_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir(&stage_container).map_err(|_| "无法创建主题编译暂存目录".to_string())?;
    set_directory_permissions(&stage_container)?;
    let stage = stage_container.join(theme_id);
    fs::create_dir(&stage).map_err(|_| "无法创建主题编译暂存目录".to_string())?;
    set_directory_permissions(&stage)?;
    let mut limits = CopyLimits::default();
    let result = copy_theme_tree(&canonical_target, &stage, 0, &mut limits)
        .and_then(|_| copy_theme_tree(&canonical_assets, &stage, 0, &mut limits))
        .and_then(|_| {
            if read_theme_metadata(&stage).is_none() {
                return Err("编译主题未通过发布前校验".to_string());
            }
            let record = CompiledThemeCacheRecord {
                kind: "cc-theme.compiled-target-cache".to_string(),
                schema_version: 1,
                adapter_id: cache_key.adapter_id.clone(),
                theme_id: cache_key.theme_id.clone(),
                fingerprint: cache_key.fingerprint.clone(),
            };
            let record_path = stage.join(COMPILED_THEME_CACHE_FILE);
            fs::write(
                &record_path,
                serde_json::to_vec(&record).map_err(|_| "无法编码编译缓存身份".to_string())?,
            )
            .map_err(|_| "无法写入编译缓存身份".to_string())?;
            set_file_permissions(&record_path)?;

            let previous = stage_container.join("previous");
            let had_previous = destination.symlink_metadata().is_ok();
            if had_previous {
                fs::rename(&destination, &previous)
                    .map_err(|_| "无法隔离旧的编译主题缓存".to_string())?;
            }
            if fs::rename(&stage, &destination).is_err() {
                if had_previous {
                    let _ = fs::rename(&previous, &destination);
                }
                return Err("无法原子发布编译主题".to_string());
            }
            fs::remove_dir_all(&stage_container)
                .map_err(|_| "无法清理主题编译暂存目录".to_string())?;
            Ok(destination.clone())
        });
    if result.is_err() {
        let _ = fs::remove_dir_all(stage_container);
    }
    result
}

fn seed_central_theme_into_library(
    central_root: &Path,
    adapter_id: &str,
    saved_root: &Path,
    theme_id: &str,
) -> Result<PathBuf, String> {
    if !valid_theme_id(theme_id) || !valid_adapter_id(adapter_id) {
        return Err("中央主题 family 或 adapter id 不符合安全白名单".to_string());
    }
    let root_metadata =
        fs::symlink_metadata(central_root).map_err(|_| "中央主题库不存在".to_string())?;
    if !root_metadata.file_type().is_dir() || root_metadata.file_type().is_symlink() {
        return Err("中央主题库必须是普通目录，不能是符号链接".to_string());
    }
    let canonical_root = central_root
        .canonicalize()
        .map_err(|_| "无法解析中央主题库".to_string())?;
    let family = central_root.join(theme_id);
    let canonical_family = validated_direct_directory(&canonical_root, &family, "中央主题 family")?;
    let targets = canonical_family.join("targets");
    let canonical_targets = validated_direct_directory(&canonical_family, &targets, "targets")?;
    let target = canonical_targets.join(adapter_id);
    let canonical_target =
        validated_direct_directory(&canonical_targets, &target, "Adapter target theme")?;
    let assets = canonical_family.join("assets");
    let canonical_assets = validated_direct_directory(&canonical_family, &assets, "共享 assets")?;
    let theme_json = canonical_target.join("theme.json");
    if read_theme_id(&theme_json).as_deref() != Some(theme_id) {
        return Err("中央 target theme.json 的 id 与 family 不一致".to_string());
    }

    prepare_saved_root(saved_root)?;
    let destination = saved_root.join(theme_id);
    if destination.exists() || destination.symlink_metadata().is_ok() {
        return validate_existing_saved_theme(&destination, theme_id);
    }
    let stage_container = saved_root.join(format!(
        ".seed-{theme_id}-{}-{}",
        std::process::id(),
        SEED_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir(&stage_container)
        .map_err(|error| format!("无法创建中央主题暂存目录：{error}"))?;
    set_directory_permissions(&stage_container)?;
    let stage = stage_container.join(theme_id);
    fs::create_dir(&stage).map_err(|error| format!("无法创建中央主题暂存目录：{error}"))?;
    set_directory_permissions(&stage)?;
    let mut limits = CopyLimits::default();
    let result = copy_theme_tree(&canonical_target, &stage, 0, &mut limits)
        .and_then(|_| copy_theme_tree(&canonical_assets, &stage, 0, &mut limits))
        .and_then(|_| {
            if read_theme_metadata(&stage).is_none() {
                return Err("组装后的中央主题未通过基本元数据校验".to_string());
            }
            fs::rename(&stage, &destination)
                .map_err(|error| format!("无法原子提交中央主题：{error}"))?;
            fs::remove_dir(&stage_container)
                .map_err(|error| format!("无法清理中央主题暂存目录：{error}"))?;
            Ok(destination.clone())
        });
    if result.is_err() {
        let _ = fs::remove_dir_all(stage_container);
    }
    result
}

fn validated_direct_directory(
    canonical_parent: &Path,
    path: &Path,
    label: &str,
) -> Result<PathBuf, String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| format!("{label} 不存在"))?;
    if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
        return Err(format!("{label} 必须是普通目录，不能是符号链接"));
    }
    let canonical = path
        .canonicalize()
        .map_err(|_| format!("无法解析 {label}"))?;
    if canonical.parent() != Some(canonical_parent) {
        return Err(format!("{label} 逃逸了固定父目录"));
    }
    Ok(canonical)
}

fn read_theme_id(path: &Path) -> Option<String> {
    let metadata = fs::symlink_metadata(path).ok()?;
    if !metadata.file_type().is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() < 2
        || metadata.len() > 2 * 1024 * 1024
    {
        return None;
    }
    serde_json::from_slice::<Value>(&fs::read(path).ok()?)
        .ok()?
        .get("id")?
        .as_str()
        .filter(|id| valid_theme_id(id))
        .map(str::to_owned)
}

fn valid_adapter_id(id: &str) -> bool {
    (3..=80).contains(&id.len())
        && id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

fn validate_existing_saved_theme(path: &Path, theme_id: &str) -> Result<PathBuf, String> {
    let metadata = read_theme_metadata(path)
        .ok_or_else(|| "已保存的主题目录不安全或主题元数据无效".to_string())?;
    if metadata.id != theme_id {
        return Err("已保存的主题 id 与请求不一致".to_string());
    }
    Ok(path.to_path_buf())
}

#[cfg(test)]
fn seed_preset_into_library(
    preset: &Path,
    saved_root: &Path,
    theme_id: &str,
) -> Result<PathBuf, String> {
    if !valid_theme_id(theme_id) {
        return Err("主题 id 不符合安全白名单".to_string());
    }
    let source = validate_preset_source(preset, theme_id)?;
    prepare_saved_root(saved_root)?;
    let destination = saved_root.join(theme_id);
    if destination.exists() || destination.symlink_metadata().is_ok() {
        return validate_existing_saved_theme(&destination, theme_id);
    }

    let stage_container = saved_root.join(format!(
        ".seed-{theme_id}-{}-{}",
        std::process::id(),
        SEED_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    if stage_container.exists() || stage_container.symlink_metadata().is_ok() {
        return Err("主题暂存目录发生冲突".to_string());
    }
    fs::create_dir(&stage_container).map_err(|error| format!("无法创建主题暂存目录：{error}"))?;
    set_directory_permissions(&stage_container)?;
    let stage = stage_container.join(theme_id);
    fs::create_dir(&stage).map_err(|error| format!("无法创建主题暂存目录：{error}"))?;
    set_directory_permissions(&stage)?;
    let mut limits = CopyLimits::default();
    let copy_result = copy_theme_tree(&source, &stage, 0, &mut limits).and_then(|_| {
        let metadata =
            read_theme_metadata(&stage).ok_or_else(|| "暂存后的主题元数据校验失败".to_string())?;
        if metadata.id != theme_id {
            return Err("暂存后的主题 id 与请求不一致".to_string());
        }
        fs::rename(&stage, &destination)
            .map_err(|error| format!("无法原子提交主题到本地库：{error}"))?;
        fs::remove_dir(&stage_container)
            .map_err(|error| format!("无法清理主题暂存目录：{error}"))?;
        Ok(destination.clone())
    });
    if copy_result.is_err() {
        let _ = fs::remove_dir_all(&stage_container);
    }
    copy_result
}

#[cfg(test)]
fn validate_preset_source(preset: &Path, theme_id: &str) -> Result<PathBuf, String> {
    let metadata =
        fs::symlink_metadata(preset).map_err(|_| format!("Adapter preset 不存在：{theme_id}"))?;
    if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
        return Err("Adapter preset 必须是普通目录，不能是符号链接".to_string());
    }
    let parent = preset
        .parent()
        .ok_or_else(|| "Adapter preset 路径无效".to_string())?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|_| "无法解析 Adapter presets 根目录".to_string())?;
    let canonical_source = preset
        .canonicalize()
        .map_err(|_| "无法解析 Adapter preset 目录".to_string())?;
    if canonical_source.parent() != Some(canonical_parent.as_path()) {
        return Err("Adapter preset 逃逸了固定 presets 根目录".to_string());
    }
    let theme = read_theme_metadata(&canonical_source)
        .ok_or_else(|| "Adapter preset theme.json 无效".to_string())?;
    if theme.id != theme_id {
        return Err("Adapter preset 的主题 id 与请求不一致".to_string());
    }
    Ok(canonical_source)
}

fn prepare_saved_root(saved_root: &Path) -> Result<(), String> {
    if saved_root.exists() || saved_root.symlink_metadata().is_ok() {
        let metadata = fs::symlink_metadata(saved_root)
            .map_err(|error| format!("无法检查主题库目录：{error}"))?;
        if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
            return Err("主题库根路径不是可信的普通目录".to_string());
        }
    } else {
        fs::create_dir_all(saved_root).map_err(|error| format!("无法创建本地主题库：{error}"))?;
    }
    set_directory_permissions(saved_root)
}

#[derive(Default)]
struct CopyLimits {
    files: usize,
    total_bytes: u64,
}

fn copy_theme_tree(
    source: &Path,
    destination: &Path,
    depth: usize,
    limits: &mut CopyLimits,
) -> Result<(), String> {
    if depth > MAX_THEME_DEPTH {
        return Err("主题目录层级超过安全限制".to_string());
    }
    let entries = fs::read_dir(source).map_err(|error| format!("无法读取主题目录：{error}"))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("无法读取主题条目：{error}"))?;
        let file_name = entry.file_name();
        let source_path = entry.path();
        let destination_path = destination.join(&file_name);
        let metadata = fs::symlink_metadata(&source_path)
            .map_err(|error| format!("无法检查主题条目：{error}"))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "主题包含不允许的符号链接：{}",
                file_name.to_string_lossy()
            ));
        }
        if metadata.file_type().is_dir() {
            fs::create_dir(&destination_path)
                .map_err(|error| format!("无法创建主题子目录：{error}"))?;
            set_directory_permissions(&destination_path)?;
            copy_theme_tree(&source_path, &destination_path, depth + 1, limits)?;
        } else if metadata.file_type().is_file() {
            limits.files += 1;
            if limits.files > MAX_THEME_FILES {
                return Err(format!("主题文件数超过安全限制（{MAX_THEME_FILES}）"));
            }
            if metadata.len() > MAX_THEME_FILE_BYTES {
                return Err("单个主题文件超过安全大小限制".to_string());
            }
            limits.total_bytes = limits
                .total_bytes
                .checked_add(metadata.len())
                .ok_or_else(|| "主题总大小计算溢出".to_string())?;
            if limits.total_bytes > MAX_THEME_TOTAL_BYTES {
                return Err("主题总大小超过安全限制".to_string());
            }
            copy_regular_file(&source_path, &destination_path, metadata.len())?;
        } else {
            return Err(format!(
                "主题包含不允许的特殊文件：{}",
                file_name.to_string_lossy()
            ));
        }
    }
    Ok(())
}

fn copy_regular_file(source: &Path, destination: &Path, expected: u64) -> Result<(), String> {
    let mut input = fs::File::open(source).map_err(|error| format!("无法读取主题文件：{error}"))?;
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .map_err(|error| format!("无法创建主题文件：{error}"))?;
    set_file_permissions(destination)?;
    let copied = std::io::copy(&mut input, &mut output)
        .map_err(|error| format!("无法复制主题文件：{error}"))?;
    if copied != expected {
        return Err("主题文件在复制期间发生变化".to_string());
    }
    let mut trailing = [0_u8; 1];
    if input
        .read(&mut trailing)
        .map_err(|error| format!("无法复核主题文件：{error}"))?
        != 0
    {
        return Err("主题文件在复制期间增长".to_string());
    }
    output
        .flush()
        .and_then(|_| output.sync_all())
        .map_err(|error| format!("无法持久化主题文件：{error}"))
}

#[cfg(unix)]
fn set_directory_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|error| format!("无法设置主题目录权限：{error}"))
}

#[cfg(not(unix))]
fn set_directory_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(unix)]
fn set_file_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("无法设置主题文件权限：{error}"))
}

#[cfg(not(unix))]
fn set_file_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn theme_colors(value: &Value) -> [String; 3] {
    let colors = value.get("colors").or_else(|| {
        value
            .get("sharedCore")
            .and_then(|core| core.get("tokens"))
            .and_then(|tokens| tokens.get("colors"))
    });
    let get = |keys: &[&str]| {
        keys.iter().find_map(|key| {
            colors
                .and_then(|colors| colors.get(*key))
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
    };
    [
        get(&["background", "surfaceBase"]).unwrap_or_else(|| "#10151F".to_string()),
        get(&["accent", "action"]).unwrap_or_else(|| "#6699FF".to_string()),
        get(&["text"]).unwrap_or_else(|| "#E9EEF7".to_string()),
    ]
}

pub fn list_theme_families() -> Vec<ThemeFamily> {
    let local_root = registry::manager_theme_library_root();
    let bundled_root =
        std::env::var_os("CC_THEME_BUNDLED_THEMES_ROOT").filter(|value| !value.is_empty());
    let mut roots = Vec::new();
    if local_root.is_dir() {
        roots.push(local_root.as_path());
    }
    if let Some(root) = bundled_root.as_deref().map(Path::new) {
        if root != local_root {
            roots.push(root);
        }
    }
    list_theme_families_from_roots(roots)
}

#[cfg(test)]
fn list_theme_families_from(central_root: Option<&Path>) -> Vec<ThemeFamily> {
    list_theme_families_from_roots(central_root.into_iter())
}

fn list_theme_families_from_roots<'a>(
    central_roots: impl IntoIterator<Item = &'a Path>,
) -> Vec<ThemeFamily> {
    let mut families: BTreeMap<String, FamilyBuilder> = BTreeMap::new();
    let adapter_capabilities = capabilities::load_capabilities_or_fallback();
    for root in central_roots {
        collect_central_root(root, &adapter_capabilities, &mut families);
    }
    for client_id in ClientId::ALL {
        let definition = registry::definition(client_id);
        collect_root(
            &registry::saved_themes_root(&definition),
            client_id,
            true,
            &mut families,
        );
    }
    families
        .into_values()
        .map(|builder| {
            let compatibility = adapter_capabilities
                .clone()
                .into_iter()
                .map(|capability| {
                    let available = builder.clients.contains(&capability.adapter_id)
                        && capability.runtime_apply_available;
                    let status = if available {
                        CompatibilityState::Ready
                    } else {
                        CompatibilityState::Unavailable
                    };
                    let note = if available {
                        format!("{} 适配能力已就绪", capability.display_name)
                    } else {
                        capability.reason.clone()
                    };
                    (
                        capability.adapter_id,
                        ThemeCompatibility {
                            status,
                            adapter_version: capability.capability_version,
                            note,
                        },
                    )
                })
                .collect();
            let updated_at: DateTime<Utc> = builder.metadata.modified.into();
            ThemeFamily {
                id: builder.metadata.id,
                name: builder.metadata.name,
                author: builder.metadata.author,
                description: builder.metadata.description,
                default_locale: builder.metadata.default_locale,
                localizations: builder.metadata.localizations,
                colors: builder.metadata.colors,
                preview_url: builder.metadata.preview_url,
                installed: builder.installed || !builder.clients.is_empty(),
                updated_at: updated_at.to_rfc3339(),
                compatibility,
            }
        })
        .collect()
}

fn collect_central_root(
    root: &Path,
    adapter_capabilities: &[crate::models::AdapterCapability],
    families: &mut BTreeMap<String, FamilyBuilder>,
) {
    let Ok(root_metadata) = fs::symlink_metadata(root) else {
        return;
    };
    if !root_metadata.file_type().is_dir() || root_metadata.file_type().is_symlink() {
        return;
    }
    let Ok(canonical_root) = root.canonicalize() else {
        return;
    };
    let Ok(entries) = fs::read_dir(&canonical_root) else {
        return;
    };
    for entry in entries.flatten() {
        let family_path = entry.path();
        let Some(family_id) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if !valid_theme_id(&family_id) {
            continue;
        }
        let Ok(family_dir) =
            validated_direct_directory(&canonical_root, &family_path, "theme family")
        else {
            continue;
        };
        if let Some((metadata, target_ids)) = read_unified_family_metadata(&family_dir, &family_id)
        {
            let supported_targets: BTreeSet<String> = adapter_capabilities
                .iter()
                .filter(|capability| target_ids.contains(&capability.adapter_id))
                .map(|capability| capability.adapter_id.clone())
                .collect();
            if !supported_targets.is_empty() {
                let family = families
                    .entry(metadata.id.clone())
                    .or_insert_with(|| FamilyBuilder {
                        metadata: metadata.clone(),
                        central_metadata: true,
                        clients: BTreeSet::new(),
                        installed: true,
                    });
                family.clients.extend(supported_targets);
                family.installed = true;
            }
            continue;
        }
        let Ok(targets_dir) =
            validated_direct_directory(&family_dir, &family_dir.join("targets"), "theme targets")
        else {
            continue;
        };
        for capability in adapter_capabilities {
            let target_path = targets_dir.join(&capability.adapter_id);
            let Ok(target_dir) =
                validated_direct_directory(&targets_dir, &target_path, "adapter target theme")
            else {
                continue;
            };
            let Some(metadata) =
                read_theme_metadata_file(&target_dir.join("theme.json"), &family_id)
            else {
                continue;
            };
            let family = families
                .entry(metadata.id.clone())
                .or_insert_with(|| FamilyBuilder {
                    metadata: metadata.clone(),
                    central_metadata: true,
                    clients: BTreeSet::new(),
                    installed: true,
                });
            if metadata.modified > family.metadata.modified {
                family.metadata = metadata;
            }
            family.clients.insert(capability.adapter_id.clone());
            family.installed = true;
        }
    }
}

fn collect_root(
    root: &Path,
    client_id: ClientId,
    installed: bool,
    families: &mut BTreeMap<String, FamilyBuilder>,
) {
    let Ok(root_metadata) = fs::symlink_metadata(root) else {
        return;
    };
    if !root_metadata.file_type().is_dir() || root_metadata.file_type().is_symlink() {
        return;
    }
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let Some(metadata) = read_theme_metadata(&entry.path()) else {
            continue;
        };
        let family = families
            .entry(metadata.id.clone())
            .or_insert_with(|| FamilyBuilder {
                metadata: metadata.clone(),
                central_metadata: false,
                clients: BTreeSet::new(),
                installed: false,
            });
        if !family.central_metadata && metadata.modified > family.metadata.modified {
            family.metadata = metadata;
        }
        family.clients.insert(client_id.as_str().to_string());
        family.installed |= installed;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::io::Cursor;
    use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

    fn scratch(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "cc-theme-{name}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    fn digest(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    fn package_entries(id: &str) -> Vec<(String, Vec<u8>)> {
        let source = format!(
            r##"{{"kind":"cc-theme.unified-theme","schemaVersion":1,"id":"{id}","name":"Fixture","version":"1.0.0","sharedCore":{{"tokens":{{"colors":{{"surfaceBase":"#10151F","text":"#E9EEF7","textMuted":"#AAB5C5","action":"#2F7D57","actionForeground":"#FFFFFF","focusRing":"#7BCFA8"}},"fonts":{{"ui":["system-ui"]}}}},"background":{{"mode":"media","image":"background.webp"}},"accessibility":{{"reducedMotion":"static"}}}},"targets":["mac-codex"]}}"##
        )
        .into_bytes();
        let asset = b"RIFF\x04\x00\x00\x00WEBP".to_vec();
        let manifest = serde_json::to_vec(&serde_json::json!({
            "kind": "cc-theme.theme-family-package",
            "schemaVersion": 1,
            "id": id,
            "version": "1.0.0",
            "minimumManagerVersion": "0.1.0",
            "metadata": {
                "author": "Fixture Author",
                "defaultLocale": "en-US",
                "locales": {
                    "zh-CN": { "name": "测试主题", "description": "用于安全导入测试。" },
                    "en-US": { "name": "Fixture Theme", "description": "Used for secure import tests." }
                },
                "previewAsset": "background.webp",
                "license": "MIT",
                "assetLicense": "CC0-1.0"
            },
            "source": { "path": "unified-theme.json", "bytes": source.len(), "sha256": digest(&source) },
            "assets": [{
                "path": "assets/background.webp",
                "bytes": asset.len(),
                "sha256": digest(&asset),
                "contentType": "image/webp",
                "roles": ["background", "preview"]
            }]
        }))
        .unwrap();
        vec![
            ("family.json".to_string(), manifest),
            ("unified-theme.json".to_string(), source),
            ("assets/background.webp".to_string(), asset),
        ]
    }

    fn write_package(path: &Path, entries: Vec<(String, Vec<u8>)>) {
        let mut archive = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        for (name, bytes) in entries {
            archive.start_file(name, options).unwrap();
            archive.write_all(&bytes).unwrap();
        }
        let bytes = archive.finish().unwrap().into_inner();
        fs::write(path, bytes).unwrap();
    }

    fn mutate_package_source(entries: &mut [(String, Vec<u8>)], mutate: impl FnOnce(&mut Value)) {
        let source_entry = entries
            .iter_mut()
            .find(|(name, _)| name == "unified-theme.json")
            .unwrap();
        let mut source: Value = serde_json::from_slice(&source_entry.1).unwrap();
        mutate(&mut source);
        source_entry.1 = serde_json::to_vec(&source).unwrap();
        let source_bytes = source_entry.1.clone();
        let manifest_entry = entries
            .iter_mut()
            .find(|(name, _)| name == "family.json")
            .unwrap();
        let mut manifest: Value = serde_json::from_slice(&manifest_entry.1).unwrap();
        manifest["source"]["bytes"] = Value::from(source_bytes.len());
        manifest["source"]["sha256"] = Value::String(digest(&source_bytes));
        manifest_entry.1 = serde_json::to_vec(&manifest).unwrap();
    }

    fn immersive_scene_presentation(image: &str) -> Value {
        serde_json::json!({
            "profileId": "immersive-scene-v1",
            "profileVersion": 1,
            "strictness": "exact-required",
            "geometryPolicy": "scene-bounded",
            "surfaces": ["shell", "navigation", "home", "conversation", "composer", "cards", "overlays"],
            "parameters": {
                "density": "comfortable",
                "borderTreatment": "etched",
                "textureIntensity": 0.36,
                "surfaceOpacity": 0.72,
                "navigationTreatment": "framed",
                "composerTreatment": "anchored",
                "cardTreatment": "elevated"
            },
            "assetSlots": { "scene.backdrop": image },
            "fallbackPolicy": { "unsupportedSurface": "block", "reducedMotion": "static" }
        })
    }

    #[test]
    fn theme_ids_reject_traversal_and_shell_metacharacters() {
        assert!(valid_theme_id("fixture-v2_1"));
        for invalid in ["", "../theme", "theme/id", "a b", "$(open x)", "x;rm"] {
            assert!(!valid_theme_id(invalid), "{invalid} should be invalid");
        }
        assert!(!valid_theme_id(&"a".repeat(81)));
    }

    #[test]
    fn package_versions_match_the_public_schema_exactly() {
        for valid in ["0.1.0", "1.2.3", "12.34.56-beta.1", "1.0.0-rc-2"] {
            assert!(valid_package_version(valid), "{valid} should be valid");
        }
        for invalid in [
            "",
            "1",
            "1.2",
            "1.2.3.4",
            "1.two.3",
            "1.2.3-",
            "v1.2.3",
            "1.2.3+build",
        ] {
            assert!(
                !valid_package_version(invalid),
                "{invalid} should be invalid"
            );
        }
    }

    #[test]
    fn cctheme_import_is_atomic_and_preserves_bilingual_display_metadata() {
        let root = scratch("package-import");
        fs::create_dir_all(&root).unwrap();
        let package = root.join("fixture.cctheme");
        let library = root.join("library");
        write_package(&package, package_entries("fixture"));

        let installed_id = import_theme_package_to(&package, &library).unwrap();

        assert_eq!(installed_id, "fixture");
        let installed = library.join("fixture");
        assert!(installed.join("family.json").is_file());
        assert!(installed.join("unified-theme.json").is_file());
        let metadata = read_package_metadata(&installed, "fixture", "1.0.0").unwrap();
        assert_eq!(metadata.localizations["zh-CN"].name, "测试主题");
        assert_eq!(metadata.localizations["en-US"].name, "Fixture Theme");
        assert!(metadata
            .preview_url
            .as_deref()
            .is_some_and(|url| url.starts_with("cc-theme-preview://localhost/fixture?revision=")));
        let preview = load_theme_preview_from(&library, "fixture").unwrap();
        assert_eq!(preview.0, "image/webp");
        assert_eq!(
            preview.1,
            fs::read(installed.join("assets/background.webp")).unwrap()
        );
        let listed = list_theme_families_from(Some(&library));
        assert!(listed
            .iter()
            .find(|theme| theme.id == "fixture")
            .and_then(|theme| theme.preview_url.as_deref())
            .is_some_and(|url| url.starts_with("cc-theme-preview://localhost/fixture?revision=")));
        let mut changed_preview = fs::read(installed.join("assets/background.webp")).unwrap();
        *changed_preview.last_mut().unwrap() ^= 1;
        fs::write(installed.join("assets/background.webp"), changed_preview).unwrap();
        assert!(load_theme_preview_from(&library, "fixture").is_none());
        assert!(fs::read_dir(&library)
            .unwrap()
            .flatten()
            .all(|entry| !entry.file_name().to_string_lossy().starts_with(".import-")));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cctheme_import_accepts_a_closed_immersive_scene_presentation() {
        let root = scratch("gothic-void-crusade-presentation");
        fs::create_dir_all(&root).unwrap();
        let package = root.join("gothic-void-crusade.cctheme");
        let library = root.join("library");
        let mut entries = package_entries("gothic-void-crusade");
        mutate_package_source(&mut entries, |source| {
            source["presentation"] = immersive_scene_presentation("background.webp");
        });
        write_package(&package, entries);

        assert_eq!(
            import_theme_package_to(&package, &library).unwrap(),
            "gothic-void-crusade"
        );
        assert!(library
            .join("gothic-void-crusade/unified-theme.json")
            .is_file());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cctheme_import_rejects_unsafe_or_invalid_immersive_scene_presentation() {
        let root = scratch("immersive-scene-presentation-invalid");
        fs::create_dir_all(&root).unwrap();
        let mutations: Vec<(&str, Box<dyn FnOnce(&mut Value)>)> = vec![
            (
                "unknown-field",
                Box::new(|source| {
                    source["presentation"] = immersive_scene_presentation("background.webp");
                    source["presentation"]["selector"] = Value::String(".host-ui".into());
                }),
            ),
            (
                "invalid-policy",
                Box::new(|source| {
                    source["presentation"] = immersive_scene_presentation("background.webp");
                    source["presentation"]["geometryPolicy"] =
                        Value::String("replace-layout".into());
                }),
            ),
            (
                "invalid-asset-slot",
                Box::new(|source| {
                    source["presentation"] = immersive_scene_presentation("background.webp");
                    source["presentation"]["assetSlots"]["scene.backdrop"] =
                        Value::String("../outside.png".into());
                }),
            ),
            (
                "unknown-asset-slot",
                Box::new(|source| {
                    source["presentation"] = immersive_scene_presentation("background.webp");
                    source["presentation"]["assetSlots"]["scene.overlay"] =
                        Value::String("background.webp".into());
                }),
            ),
        ];
        for (index, (name, mutate)) in mutations.into_iter().enumerate() {
            let package = root.join(format!("{index}-{name}.cctheme"));
            let library = root.join(format!("library-{index}"));
            let mut entries = package_entries("gothic-void-crusade");
            mutate_package_source(&mut entries, mutate);
            write_package(&package, entries);

            assert_eq!(
                import_theme_package_to(&package, &library).unwrap_err(),
                "theme-package-presentation-invalid",
                "{name} must fail closed"
            );
            assert!(!library.join("gothic-void-crusade").exists());
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cctheme_import_keeps_legacy_themes_without_presentation_compatible() {
        let root = scratch("legacy-no-presentation");
        fs::create_dir_all(&root).unwrap();
        let package = root.join("legacy.cctheme");
        let library = root.join("library");
        write_package(&package, package_entries("legacy-theme"));

        assert_eq!(
            import_theme_package_to(&package, &library).unwrap(),
            "legacy-theme"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn compiled_adapter_snapshots_never_replace_central_package_display_metadata() {
        let root = scratch("central-display-authority");
        let package = root.join("fixture.cctheme");
        let library = root.join("library");
        let adapter_root = root.join("adapter-themes");
        fs::create_dir_all(&root).unwrap();
        write_package(&package, package_entries("fixture"));
        import_theme_package_to(&package, &library).unwrap();

        let adapter_theme = adapter_root.join("fixture");
        fs::create_dir_all(&adapter_theme).unwrap();
        fs::write(
            adapter_theme.join("theme.json"),
            br##"{"id":"fixture","name":"Compiled Target","colors":{"background":"#000000"}}"##,
        )
        .unwrap();

        let mut families = BTreeMap::new();
        let capabilities = capabilities::load_capabilities_or_fallback();
        collect_central_root(&library, &capabilities, &mut families);
        collect_root(&adapter_root, ClientId::Codex, true, &mut families);

        let family = families.get("fixture").unwrap();
        assert_eq!(family.metadata.name, "Fixture Theme");
        assert_eq!(family.metadata.localizations["zh-CN"].name, "测试主题");
        assert!(family.metadata.preview_url.is_some());
        assert!(family.clients.contains("mac-codex"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cctheme_import_rejects_traversal_and_leaves_no_partial_theme() {
        let root = scratch("package-traversal");
        fs::create_dir_all(&root).unwrap();
        let package = root.join("fixture.cctheme");
        let library = root.join("library");
        let mut entries = package_entries("fixture");
        entries.push(("../outside.txt".to_string(), b"forbidden".to_vec()));
        write_package(&package, entries);

        let error = import_theme_package_to(&package, &library).unwrap_err();

        assert!(matches!(
            error.as_str(),
            "theme-package-entry-path-invalid" | "theme-package-entry-not-allowlisted"
        ));
        assert!(!library.join("fixture").exists());
        assert!(!root.join("outside.txt").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cctheme_import_rejects_digest_mismatch_and_duplicate_identity() {
        let root = scratch("package-integrity");
        fs::create_dir_all(&root).unwrap();
        let bad_package = root.join("bad.cctheme");
        let valid_package = root.join("valid.cctheme");
        let library = root.join("library");
        let mut invalid = package_entries("fixture");
        invalid
            .iter_mut()
            .find(|(name, _)| name == "assets/background.webp")
            .unwrap()
            .1
            .push(0);
        write_package(&bad_package, invalid);
        assert_eq!(
            import_theme_package_to(&bad_package, &library).unwrap_err(),
            "theme-package-integrity-invalid"
        );

        write_package(&valid_package, package_entries("fixture"));
        import_theme_package_to(&valid_package, &library).unwrap();
        assert_eq!(
            import_theme_package_to(&valid_package, &library).unwrap_err(),
            "theme-package-already-installed"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cctheme_import_rejects_a_future_manager_requirement() {
        let root = scratch("package-manager-version");
        fs::create_dir_all(&root).unwrap();
        let package = root.join("future.cctheme");
        let library = root.join("library");
        let mut entries = package_entries("future");
        let manifest = &mut entries
            .iter_mut()
            .find(|(name, _)| name == "family.json")
            .unwrap()
            .1;
        let mut value: Value = serde_json::from_slice(manifest).unwrap();
        value["minimumManagerVersion"] = Value::String("99.0.0".to_string());
        *manifest = serde_json::to_vec(&value).unwrap();
        write_package(&package, entries);

        assert_eq!(
            import_theme_package_to(&package, &library).unwrap_err(),
            "theme-package-manager-version-unsupported"
        );
        assert!(!library.join("future").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cctheme_import_rejects_incomplete_or_noncanonical_theme_sources() {
        let root = scratch("package-source-contract");
        fs::create_dir_all(&root).unwrap();
        let mutations: Vec<(&str, Box<dyn FnOnce(&mut Value)>)> = vec![
            (
                "empty-targets",
                Box::new(|source| source["targets"] = serde_json::json!([])),
            ),
            (
                "legacy-target",
                Box::new(|source| source["targets"] = serde_json::json!(["mac-workbuddy-skin"])),
            ),
            (
                "missing-name",
                Box::new(|source| {
                    source.as_object_mut().unwrap().remove("name");
                }),
            ),
            (
                "empty-core",
                Box::new(|source| source["sharedCore"] = serde_json::json!({})),
            ),
            (
                "unknown-root",
                Box::new(|source| source["selector"] = Value::String("*".into())),
            ),
            (
                "missing-asset-binding",
                Box::new(|source| {
                    source["sharedCore"]["background"]["image"] =
                        Value::String("missing.webp".into());
                }),
            ),
        ];
        for (index, (name, mutate)) in mutations.into_iter().enumerate() {
            let package = root.join(format!("{index}-{name}.cctheme"));
            let library = root.join(format!("library-{index}"));
            let mut entries = package_entries("fixture");
            mutate_package_source(&mut entries, mutate);
            write_package(&package, entries);
            let error = import_theme_package_to(&package, &library).unwrap_err();
            assert!(
                matches!(
                    error.as_str(),
                    "theme-package-source-invalid"
                        | "theme-package-source-contract-invalid"
                        | "theme-package-source-asset-binding-invalid"
                ),
                "{name} produced unexpected error {error}"
            );
            assert!(!library.join("fixture").exists(), "{name} was installed");
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn deleting_a_theme_removes_all_managed_copies_and_per_theme_state() {
        let root = scratch("theme-delete");
        let manager = root.join("manager");
        let codex = root.join("codex");
        let override_root = root.join("overrides");
        let quarantine_root = root.join("quarantine");
        for directory in [
            manager.join("fixture"),
            codex.join("fixture"),
            override_root.clone(),
            quarantine_root.join("fixture"),
        ] {
            fs::create_dir_all(directory).unwrap();
        }
        fs::write(manager.join("fixture/family.json"), b"{}").unwrap();
        fs::write(codex.join("fixture/theme.json"), b"{}").unwrap();
        let override_file = override_root.join("fixture.json");
        fs::write(&override_file, b"{}").unwrap();

        let removed = delete_theme_family_from_paths(
            "fixture",
            &[manager.clone(), codex.clone()],
            &[override_file.clone()],
            &[quarantine_root.join("fixture")],
            &[],
        )
        .unwrap();

        assert_eq!(removed, 4);
        assert!(!manager.join("fixture").exists());
        assert!(!codex.join("fixture").exists());
        assert!(!override_file.exists());
        assert!(!quarantine_root.join("fixture").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn deleting_a_theme_fails_closed_while_a_theme_transaction_is_active() {
        let root = scratch("theme-delete-lock");
        let manager = root.join("manager");
        let lock_root = root.join("transactions");
        fs::create_dir_all(manager.join("fixture")).unwrap();
        fs::create_dir_all(&lock_root).unwrap();
        let lock = lock_root.join("fixture.lock");
        fs::create_dir(&lock).unwrap();

        assert_eq!(
            delete_theme_family_from_paths("fixture", &[manager.clone()], &[], &[], &[lock])
                .unwrap_err(),
            "theme-delete-transaction-busy"
        );
        assert!(manager.join("fixture").is_dir());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn preset_is_seeded_as_a_complete_theme_before_it_becomes_visible() {
        let root = scratch("seed-ok");
        let preset = root.join("presets/solar");
        let saved = root.join("saved");
        fs::create_dir_all(&preset).unwrap();
        fs::write(
            preset.join("theme.json"),
            r##"{"id":"solar","name":"Solar","colors":{"background":"#000000"}}"##,
        )
        .unwrap();
        fs::write(preset.join("background.png"), b"png").unwrap();

        let seeded = seed_preset_into_library(&preset, &saved, "solar").unwrap();

        assert_eq!(seeded, saved.join("solar"));
        assert!(read_theme_metadata(&seeded).is_some());
        assert_eq!(fs::read(seeded.join("background.png")).unwrap(), b"png");
        assert!(fs::read_dir(&saved)
            .unwrap()
            .flatten()
            .all(|entry| !entry.file_name().to_string_lossy().starts_with(".seed-")));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn preset_seed_rejects_symlinks_without_publishing_a_partial_theme() {
        use std::os::unix::fs::symlink;

        let root = scratch("seed-symlink");
        let preset = root.join("presets/solar");
        let saved = root.join("saved");
        fs::create_dir_all(&preset).unwrap();
        fs::write(preset.join("theme.json"), r#"{"id":"solar"}"#).unwrap();
        fs::write(root.join("outside.txt"), b"secret").unwrap();
        symlink(root.join("outside.txt"), preset.join("background.png")).unwrap();

        let error = seed_preset_into_library(&preset, &saved, "solar").unwrap_err();

        assert!(error.contains("符号链接"));
        assert!(!saved.join("solar").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn preset_seed_never_overwrites_an_existing_valid_local_theme() {
        let root = scratch("seed-preserve");
        let preset = root.join("presets/solar");
        let saved_theme = root.join("saved/solar");
        fs::create_dir_all(&preset).unwrap();
        fs::create_dir_all(&saved_theme).unwrap();
        fs::write(
            preset.join("theme.json"),
            r#"{"id":"solar","name":"Adapter preset"}"#,
        )
        .unwrap();
        let local = r#"{"id":"solar","name":"My local customization"}"#;
        fs::write(saved_theme.join("theme.json"), local).unwrap();

        let selected = seed_preset_into_library(&preset, &root.join("saved"), "solar").unwrap();

        assert_eq!(selected, saved_theme);
        assert_eq!(
            fs::read_to_string(selected.join("theme.json")).unwrap(),
            local
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn central_theme_family_seeds_target_contract_and_shared_assets() {
        let root = scratch("central-family");
        let family = root.join("families/solar");
        let target = family.join("targets/mac-codex");
        let assets = family.join("assets");
        let saved = root.join("saved");
        fs::create_dir_all(&target).unwrap();
        fs::create_dir_all(&assets).unwrap();
        fs::write(
            target.join("theme.json"),
            r#"{"id":"solar","name":"Solar","image":"background.png"}"#,
        )
        .unwrap();
        fs::write(assets.join("background.png"), b"shared-media").unwrap();

        let seeded =
            seed_central_theme_into_library(&root.join("families"), "mac-codex", &saved, "solar")
                .unwrap();

        assert!(read_theme_metadata(&seeded).is_some());
        assert_eq!(
            fs::read(seeded.join("background.png")).unwrap(),
            b"shared-media"
        );
        let listed = list_theme_families_from(Some(&root.join("families")));
        let solar = listed
            .iter()
            .find(|family| family.id == "solar")
            .expect("central family remains visible without adapter presets");
        assert!(solar.compatibility.contains_key("mac-codex"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn runtime_compiled_target_is_published_with_shared_assets() {
        let root = scratch("runtime-compiled");
        let output = root.join("compile/mac-codex");
        let assets = root.join("family/assets");
        fs::create_dir_all(&output).unwrap();
        fs::create_dir_all(&assets).unwrap();
        fs::write(
            output.join("theme.json"),
            r#"{"id":"neutral-fixture","name":"Runtime compiled","image":"background.png"}"#,
        )
        .unwrap();
        fs::write(assets.join("background.png"), b"shared").unwrap();
        let cache_key = CompiledThemeCacheKey {
            adapter_id: "mac-codex".to_string(),
            theme_id: "neutral-fixture".to_string(),
            fingerprint: "a".repeat(64),
        };
        let installed = seed_compiled_theme_to_saved_root(
            &output,
            &assets,
            &root.join("saved"),
            "neutral-fixture",
            &cache_key,
        )
        .unwrap();

        assert_eq!(
            fs::read(installed.join("background.png")).unwrap(),
            b"shared"
        );
        assert_eq!(
            read_theme_metadata(&installed).unwrap().name,
            "Runtime compiled"
        );
        assert_eq!(
            cached_compiled_theme_from(&root.join("saved"), &cache_key),
            Some(installed)
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn stale_compiled_target_is_atomically_replaced_for_a_new_cache_identity() {
        let root = scratch("runtime-compiled-refresh");
        let output = root.join("compile/mac-workbuddy");
        let assets = root.join("family/assets");
        let saved = root.join("saved");
        fs::create_dir_all(&output).unwrap();
        fs::create_dir_all(&assets).unwrap();
        fs::write(assets.join("background.png"), b"shared").unwrap();
        fs::write(
            output.join("theme.json"),
            r#"{"id":"neutral-fixture","name":"Old projection","appearance":{"backgroundVideoPosition":{"xPercent":50,"yPercent":50}}}"#,
        )
        .unwrap();
        let old_key = CompiledThemeCacheKey {
            adapter_id: "mac-workbuddy".to_string(),
            theme_id: "neutral-fixture".to_string(),
            fingerprint: "1".repeat(64),
        };
        seed_compiled_theme_to_saved_root(&output, &assets, &saved, "neutral-fixture", &old_key)
            .unwrap();

        fs::write(
            output.join("theme.json"),
            r#"{"id":"neutral-fixture","name":"Current projection","appearance":{"backgroundPosition":{"xPercent":50,"yPercent":50}}}"#,
        )
        .unwrap();
        let current_key = CompiledThemeCacheKey {
            adapter_id: "mac-workbuddy".to_string(),
            theme_id: "neutral-fixture".to_string(),
            fingerprint: "2".repeat(64),
        };
        let installed = seed_compiled_theme_to_saved_root(
            &output,
            &assets,
            &saved,
            "neutral-fixture",
            &current_key,
        )
        .unwrap();

        let theme = fs::read_to_string(installed.join("theme.json")).unwrap();
        assert!(theme.contains("Current projection"));
        assert!(!theme.contains("backgroundVideoPosition"));
        assert_eq!(
            cached_compiled_theme_from(&saved, &current_key),
            Some(installed)
        );
        assert_eq!(cached_compiled_theme_from(&saved, &old_key), None);
        assert!(fs::read_dir(&saved).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".previous-")));
        fs::remove_dir_all(root).unwrap();
    }
}
