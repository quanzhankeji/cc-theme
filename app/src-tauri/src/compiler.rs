use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::{
    capabilities,
    models::{CapabilityAvailability, ClientState, SignatureState},
    process::{run_with_timeout, ProcessError},
    registry::{self, ClientDefinition},
    themes::{
        cached_compiled_theme, seed_compiled_theme_into_library, valid_theme_id,
        CompiledThemeCacheKey,
    },
};

static WORKSPACE_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Debug)]
pub struct ThemeCompileFailure {
    pub code: String,
    pub message: String,
    pub details: Value,
}

impl ThemeCompileFailure {
    fn generic(message: impl Into<String>) -> Self {
        Self {
            code: "theme-compile-failed".to_string(),
            message: message.into(),
            details: json!({
                "stage": "manager-validation",
                "reasonCode": "theme-compile-failed"
            }),
        }
    }

    fn timed_out() -> Self {
        Self {
            code: "theme-compiler-timeout".to_string(),
            message: "主题编译超过安全执行时限，已停止".to_string(),
            details: json!({
                "stage": "adapter-projector",
                "reasonCode": "theme-compiler-timeout"
            }),
        }
    }

    fn start_failed() -> Self {
        Self {
            code: "theme-compiler-start-failed".to_string(),
            message: "无法启动内置主题编译器".to_string(),
            details: json!({
                "stage": "adapter-projector",
                "reasonCode": "theme-compiler-start-failed"
            }),
        }
    }
}

impl From<String> for ThemeCompileFailure {
    fn from(message: String) -> Self {
        Self::generic(message)
    }
}

struct CompileWorkspace {
    root: PathBuf,
}

impl CompileWorkspace {
    fn create() -> Result<Self, String> {
        let root = std::env::temp_dir().join(format!(
            "cc-theme-compile-{}-{}",
            std::process::id(),
            WORKSPACE_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).map_err(|_| "无法创建主题编译工作区".to_string())?;
        set_private_directory(&root)?;
        Ok(Self { root })
    }
}

impl Drop for CompileWorkspace {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

/// Compiles a Theme Family through the registered Adapter projectors and
/// publishes only the selected Adapter target. `Ok(None)` means the family is
/// an older precompiled package and the caller should use the compatibility
/// seeding path.
pub fn compile_and_seed_theme(
    definition: &ClientDefinition,
    theme_id: &str,
    client_state: &ClientState,
) -> Result<Option<PathBuf>, ThemeCompileFailure> {
    if !valid_theme_id(theme_id) {
        return Err(ThemeCompileFailure::generic("主题 id 不符合安全白名单"));
    }
    let local_root = registry::manager_theme_library_root();
    let theme_root = if local_root.join(theme_id).is_dir() {
        Some(local_root)
    } else {
        std::env::var_os("CC_THEME_BUNDLED_THEMES_ROOT")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
    };
    let Some(theme_root) = theme_root else {
        return Ok(None);
    };
    let theme_root = trusted_directory(&theme_root, "中央主题库")?;
    let family = trusted_direct_child(&theme_root, theme_id, "Theme Family")?;
    verify_family_manifest(&family, theme_id)?;
    let source = family.join("unified-theme.json");
    if !source.exists() {
        return Ok(None);
    }
    trusted_json_file(&source, "Unified Theme")?;
    let assets = trusted_direct_child(&family, "assets", "Theme Family assets")?;

    let compiler_root = compiler_root()?;
    let cli = compiler_root.join("cli.mjs");
    trusted_script_file(&cli, "主题编译器")?;
    let compile_context = build_compile_context_for(definition.id.as_str(), Some(client_state));
    let adapter_root = registry::adapter_root(definition);
    let adapter_sdk_root = compiler_root
        .parent()
        .unwrap_or_else(|| Path::new("/nonexistent"))
        .join("adapter-sdk");
    let capability_registry = std::env::var_os("CC_THEME_CAPABILITY_ROOT")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .map(|root| root.join("registry.json"));
    let cache_key = compile_cache_key_from(
        definition.id.as_str(),
        theme_id,
        &family,
        &compile_context,
        &adapter_root,
        &compiler_root,
        &adapter_sdk_root,
        capability_registry.as_deref(),
    )?;
    if let Some(cached) = cached_compiled_theme(definition, &cache_key) {
        return Ok(Some(cached));
    }
    let node = bundled_node()?;
    let workspace = CompileWorkspace::create()?;
    let context_file = workspace.root.join("compile-context.json");
    write_private_json(&context_file, &compile_context)?;
    let output_root = workspace.root.join("output");
    fs::create_dir(&output_root).map_err(|_| "无法创建编译输出目录".to_string())?;
    set_private_directory(&output_root)?;

    let mut command = Command::new(node);
    command
        .arg(cli)
        .arg(&source)
        .arg(&context_file)
        .arg(&output_root)
        .arg(definition.id.as_str())
        .current_dir(&compiler_root)
        .env("CC_THEME_COMPILER_SOURCE_ROOT", compiler_source_root())
        .env("CC_THEME_ADAPTER_SOURCE_ROOT", compiler_source_root())
        .env("CC_THEME_SELECTED_ADAPTER_ID", definition.id.as_str())
        .env(
            "CC_THEME_SELECTED_ADAPTER_ROOT",
            registry::adapter_root(definition),
        );
    if let Some(capability_root) =
        std::env::var_os("CC_THEME_CAPABILITY_ROOT").filter(|value| !value.is_empty())
    {
        command.env("CC_THEME_CAPABILITY_ROOT", capability_root);
    }
    let output = match run_with_timeout(&mut command, Duration::from_secs(45)) {
        Ok(output) => output,
        Err(ProcessError::TimedOut) => return Err(ThemeCompileFailure::timed_out()),
        Err(_) => return Err(ThemeCompileFailure::start_failed()),
    };
    if !output.status.success() {
        return Err(classify_compiler_failure(
            definition.id.as_str(),
            &output.stdout,
            &output.stderr,
        ));
    }
    let target_theme = compiled_theme_path(&output.stdout, &output_root, definition.id.as_str())?;
    let target_directory = target_theme
        .parent()
        .ok_or_else(|| "Adapter 编译结果目录无效".to_string())?;
    seed_compiled_theme_into_library(definition, target_directory, &assets, theme_id, &cache_key)
        .map(Some)
        .map_err(Into::into)
}

fn compile_cache_key_from(
    adapter_id: &str,
    theme_id: &str,
    family: &Path,
    compile_context: &Value,
    adapter_root: &Path,
    compiler_root: &Path,
    adapter_sdk_root: &Path,
    capability_registry: Option<&Path>,
) -> Result<CompiledThemeCacheKey, String> {
    let mut digest = Sha256::new();
    digest.update(b"cc-theme-compiled-target-cache-v1\0");
    digest.update(adapter_id.as_bytes());
    digest.update(b"\0");
    digest.update(theme_id.as_bytes());
    digest.update(b"\0family\0");
    update_digest_with_file(&mut digest, &family.join("family.json"), 2 * 1024 * 1024)?;
    digest.update(b"\0context\0");
    digest.update(
        serde_json::to_vec(compile_context)
            .map_err(|_| "无法编码 Adapter 编译上下文摘要".to_string())?,
    );

    for relative in ["package.json", "cli.mjs", "compiler.mjs"] {
        digest.update(b"\0compiler\0");
        digest.update(relative.as_bytes());
        update_digest_with_file(&mut digest, &compiler_root.join(relative), 4 * 1024 * 1024)?;
    }
    for relative in ["package.json", "adapter-registry.mjs", "workspace-root.mjs"] {
        digest.update(b"\0adapter-sdk\0");
        digest.update(relative.as_bytes());
        update_digest_with_file(
            &mut digest,
            &adapter_sdk_root.join(relative),
            4 * 1024 * 1024,
        )?;
    }
    if let Some(registry_file) = capability_registry {
        digest.update(b"\0capability-registry\0");
        update_digest_with_file(&mut digest, registry_file, 2 * 1024 * 1024)?;
    }

    let release_file = adapter_root.join("contracts/adapter-release-manifest.json");
    let release_bytes = read_bounded_regular_file(&release_file, 2 * 1024 * 1024)?;
    let release: Value = serde_json::from_slice(&release_bytes)
        .map_err(|_| "Adapter release manifest JSON 无效".to_string())?;
    if release.get("adapterId").and_then(Value::as_str) != Some(adapter_id) {
        return Err("Adapter release manifest 身份不一致".to_string());
    }
    let entries = release
        .get("entries")
        .and_then(Value::as_array)
        .filter(|entries| !entries.is_empty() && entries.len() <= 256)
        .ok_or_else(|| "Adapter release manifest entries 无效".to_string())?;
    let mut total_bytes = 0_u64;
    for entry in entries {
        let relative = entry
            .as_str()
            .filter(|value| safe_relative_path(value))
            .ok_or_else(|| "Adapter release manifest 包含不安全路径".to_string())?;
        let file = adapter_root.join(relative);
        let metadata = file
            .symlink_metadata()
            .map_err(|_| "Adapter release manifest 文件缺失".to_string())?;
        if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
            return Err("Adapter release manifest 条目不是可信普通文件".to_string());
        }
        total_bytes = total_bytes
            .checked_add(metadata.len())
            .filter(|total| *total <= 64 * 1024 * 1024)
            .ok_or_else(|| "Adapter release manifest 文件总量超过安全限制".to_string())?;
        digest.update(b"\0adapter-entry\0");
        digest.update(relative.as_bytes());
        update_digest_with_file(&mut digest, &file, 16 * 1024 * 1024)?;
    }
    Ok(CompiledThemeCacheKey {
        adapter_id: adapter_id.to_string(),
        theme_id: theme_id.to_string(),
        fingerprint: format!("{:x}", digest.finalize()),
    })
}

fn safe_relative_path(value: &str) -> bool {
    let path = Path::new(value);
    !value.is_empty()
        && !path.is_absolute()
        && path
            .components()
            .all(|component| matches!(component, std::path::Component::Normal(_)))
}

fn read_bounded_regular_file(path: &Path, maximum: u64) -> Result<Vec<u8>, String> {
    let metadata = path
        .symlink_metadata()
        .map_err(|_| "编译缓存输入文件不存在".to_string())?;
    if !metadata.file_type().is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() > maximum
    {
        return Err("编译缓存输入文件不可信或过大".to_string());
    }
    fs::read(path).map_err(|_| "无法读取编译缓存输入文件".to_string())
}

fn update_digest_with_file(digest: &mut Sha256, path: &Path, maximum: u64) -> Result<(), String> {
    let bytes = read_bounded_regular_file(path, maximum)?;
    digest.update((bytes.len() as u64).to_le_bytes());
    digest.update(bytes);
    Ok(())
}

fn classify_compiler_failure(
    adapter_id: &str,
    stdout: &[u8],
    stderr: &[u8],
) -> ThemeCompileFailure {
    if compiler_runtime_is_incompatible(stderr) || compiler_runtime_is_incompatible(stdout) {
        return ThemeCompileFailure {
            code: "theme-compiler-runtime-incompatible".to_string(),
            message: "内置主题编译运行时不可用，请更新 CC Theme 后重试".to_string(),
            details: json!({
                "stage": "compiler-runtime",
                "reasonCode": "theme-compiler-runtime-incompatible"
            }),
        };
    }
    let summary = structured_compiler_error(stderr)
        .or_else(|| structured_compiler_error(stdout))
        .unwrap_or_default();
    let lower = summary.to_ascii_lowercase();
    if lower.contains("compilecontext") && lower.contains("unsupported fields") {
        let unsupported_fields = compile_context_fields_in(&summary);
        return ThemeCompileFailure {
            code: "adapter-compile-context-incompatible".to_string(),
            message: "Adapter 编译上下文不兼容，请更新对应解释器后重试".to_string(),
            details: json!({
                "stage": "adapter-projector",
                "adapterId": adapter_id,
                "reasonCode": "adapter-compile-context-incompatible",
                "unsupportedFields": unsupported_fields
            }),
        };
    }
    ThemeCompileFailure {
        code: "adapter-projector-failed".to_string(),
        message: "Theme Family 未通过 Adapter 编译，请运行诊断后重试".to_string(),
        details: json!({
            "stage": "adapter-projector",
            "adapterId": adapter_id,
            "reasonCode": "adapter-projector-failed"
        }),
    }
}

fn compiler_runtime_is_incompatible(bytes: &[u8]) -> bool {
    const INPUT_LIMIT: usize = 8 * 1024;
    let start = bytes.len().saturating_sub(INPUT_LIMIT);
    let text = String::from_utf8_lossy(&bytes[start..]);
    text.contains("Fatal process out of memory")
        && text.contains("Failed to reserve virtual memory for CodeRange")
}

fn structured_compiler_error(bytes: &[u8]) -> Option<String> {
    const INPUT_LIMIT: usize = 8 * 1024;
    const ERROR_LIMIT: usize = 512;
    let start = bytes.len().saturating_sub(INPUT_LIMIT);
    let text = String::from_utf8_lossy(&bytes[start..]);
    text.lines().rev().find_map(|line| {
        let value = serde_json::from_str::<Value>(line.trim()).ok()?;
        if value.get("ok").and_then(Value::as_bool) == Some(false) {
            value
                .get("error")
                .and_then(Value::as_str)
                .map(|error| error.chars().take(ERROR_LIMIT).collect())
        } else {
            None
        }
    })
}

fn compile_context_fields_in(summary: &str) -> Vec<&'static str> {
    const FIELDS: [&str; 9] = [
        "detectedClientVersion",
        "detectedClientBuild",
        "surfaceCatalogId",
        "surfaceCatalogVersion",
        "probeStatus",
        "compileAllowed",
        "applyAllowed",
        "reasonCode",
        "localRuntimeOverrides",
    ];
    FIELDS
        .into_iter()
        .filter(|field| summary.contains(field))
        .collect()
}

fn compiler_root() -> Result<PathBuf, String> {
    let root = std::env::var_os("CC_THEME_COMPILER_ROOT")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            registry::repository_root_from_manifest(Path::new(env!("CARGO_MANIFEST_DIR")))
                .join("app/packages/shared-core")
        });
    trusted_directory(&root, "主题编译器目录")
}

fn compiler_source_root() -> PathBuf {
    std::env::var_os("CC_THEME_CAPABILITY_SOURCE_ROOT")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            registry::repository_root_from_manifest(Path::new(env!("CARGO_MANIFEST_DIR")))
                .join("adapters")
        })
}

fn bundled_node() -> Result<PathBuf, String> {
    let node = std::env::var_os("CC_THEME_NODE")
        .or_else(|| std::env::var_os("NODE"))
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/usr/bin/false"));
    let metadata = node
        .symlink_metadata()
        .map_err(|_| "内置 Node 运行时不存在".to_string())?;
    if !node.is_absolute() || !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
        return Err("内置 Node 运行时不可信".to_string());
    }
    Ok(node)
}

/// Builds only the compile context requested by the current operation.
///
/// A scoped compile must not make the selected Adapter wait for discovery and
/// deep signature verification of unrelated desktop clients. Runtime apply
/// admission is still revalidated for the selected client by `operations` and
/// by the Adapter-owned seam.
fn build_compile_context_for(
    selected_adapter_id: &str,
    selected_state: Option<&ClientState>,
) -> Value {
    let mut adapters = BTreeMap::new();
    let selected_state = selected_state.filter(|state| state.id.as_str() == selected_adapter_id);
    for capability in capabilities::load_capabilities_or_fallback()
        .into_iter()
        .filter(|capability| capability.adapter_id == selected_adapter_id)
    {
        let state = selected_state;
        let compatibility_attempt =
            state.is_some_and(|state| state.adapter_status == "compatibility-candidate");
        let identity_admitted = state.is_some_and(|state| {
            state.discovered
                && state.adapter_ready
                && matches!(state.signature.status, SignatureState::Verified)
        });
        let probe_passed = identity_admitted && !compatibility_attempt;
        let apply_allowed = identity_admitted && capability.runtime_apply_available;
        let catalog_version = capability
            .catalog_version
            .as_deref()
            .and_then(|value| value.parse::<u64>().ok());
        adapters.insert(
            capability.adapter_id.clone(),
            json!({
                "detectedClientVersion": state.and_then(|state| state.version.clone()),
                "detectedClientBuild": state.and_then(|state| state.build.clone()),
                "surfaceCatalogId": capability.catalog_id,
                "surfaceCatalogVersion": catalog_version,
                "probeStatus": if probe_passed { "passed" } else { "not-run" },
                "compileAllowed": capability.availability != CapabilityAvailability::Unavailable,
                "applyAllowed": apply_allowed,
                "reasonCode": if compatibility_attempt {
                    Value::String("older-adapter-compatibility-attempt".to_string())
                } else if apply_allowed {
                    Value::Null
                } else {
                    Value::String("runtime-apply-unavailable".to_string())
                },
                "localRuntimeOverrides": { "baseThemeHash": Value::Null, "entries": [] }
            }),
        );
    }
    json!({
        "kind": "cc-theme.compile-context",
        "schemaVersion": 1,
        "adapters": adapters
    })
}

fn compiled_theme_path(
    bytes: &[u8],
    output_root: &Path,
    adapter_id: &str,
) -> Result<PathBuf, String> {
    let text = String::from_utf8_lossy(bytes);
    let value = text
        .lines()
        .rev()
        .find_map(|line| serde_json::from_str::<Value>(line.trim()).ok())
        .ok_or_else(|| "主题编译器没有返回结构化结果".to_string())?;
    if value.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err("主题编译器返回失败".to_string());
    }
    let file = value
        .get("files")
        .and_then(|files| files.get(adapter_id))
        .and_then(Value::as_str)
        .map(PathBuf::from)
        .ok_or_else(|| "主题编译器没有返回所选 Adapter target".to_string())?;
    let metadata = file
        .symlink_metadata()
        .map_err(|_| "Adapter 编译结果不存在".to_string())?;
    if !metadata.file_type().is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() < 2
        || metadata.len() > 2 * 1024 * 1024
    {
        return Err("Adapter 编译结果不是可信的普通文件".to_string());
    }
    let canonical_root = output_root
        .canonicalize()
        .map_err(|_| "无法解析编译输出目录".to_string())?;
    let canonical_file = file
        .canonicalize()
        .map_err(|_| "无法解析 Adapter 编译结果".to_string())?;
    if !canonical_file.starts_with(&canonical_root)
        || canonical_file.file_name().and_then(|name| name.to_str()) != Some("theme.json")
    {
        return Err("Adapter 编译结果逃逸了隔离工作区".to_string());
    }
    Ok(canonical_file)
}

fn trusted_directory(path: &Path, label: &str) -> Result<PathBuf, String> {
    let metadata = path
        .symlink_metadata()
        .map_err(|_| format!("{label}不存在"))?;
    if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
        return Err(format!("{label}必须是普通目录"));
    }
    path.canonicalize().map_err(|_| format!("无法解析{label}"))
}

fn trusted_direct_child(parent: &Path, child: &str, label: &str) -> Result<PathBuf, String> {
    let requested = parent.join(child);
    let canonical = trusted_directory(&requested, label)?;
    if canonical.parent() != Some(parent) {
        return Err(format!("{label}逃逸了固定父目录"));
    }
    Ok(canonical)
}

fn trusted_json_file(path: &Path, label: &str) -> Result<(), String> {
    let metadata = path
        .symlink_metadata()
        .map_err(|_| format!("{label}不存在"))?;
    if !metadata.file_type().is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() < 2
        || metadata.len() > 2 * 1024 * 1024
    {
        return Err(format!("{label}不是可信的普通 JSON 文件"));
    }
    Ok(())
}

pub(crate) fn verify_family_manifest(family: &Path, theme_id: &str) -> Result<(), String> {
    let manifest_file = family.join("family.json");
    trusted_json_file(&manifest_file, "Theme Family manifest")?;
    let manifest: Value = serde_json::from_slice(
        &fs::read(&manifest_file).map_err(|_| "无法读取 Theme Family manifest".to_string())?,
    )
    .map_err(|_| "Theme Family manifest JSON 无效".to_string())?;
    if manifest.get("kind").and_then(Value::as_str) != Some("cc-theme.theme-family-package")
        || manifest.get("schemaVersion").and_then(Value::as_u64) != Some(1)
        || manifest.get("id").and_then(Value::as_str) != Some(theme_id)
    {
        return Err("Theme Family manifest 身份无效".to_string());
    }
    let source = manifest
        .get("source")
        .and_then(Value::as_object)
        .ok_or_else(|| "Theme Family 缺少统一主题 source".to_string())?;
    verify_manifest_file(family, source, "unified-theme.json", "统一主题 source")?;
    let assets = manifest
        .get("assets")
        .and_then(Value::as_array)
        .ok_or_else(|| "Theme Family assets 清单无效".to_string())?;
    if assets.is_empty() || assets.len() > 64 {
        return Err("Theme Family assets 数量无效".to_string());
    }
    let mut allowed_assets = BTreeSet::new();
    for entry in assets {
        let object = entry
            .as_object()
            .ok_or_else(|| "Theme Family asset 条目无效".to_string())?;
        let path = object
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| "Theme Family asset 路径无效".to_string())?;
        let Some(basename) = path.strip_prefix("assets/") else {
            return Err("Theme Family asset 必须位于 assets 目录".to_string());
        };
        if basename.is_empty()
            || basename
                != Path::new(basename)
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("")
            || basename.contains(['/', '\\', ':'])
        {
            return Err("Theme Family asset 文件名不安全".to_string());
        }
        let extension = Path::new(basename)
            .extension()
            .and_then(|value| value.to_str())
            .map(str::to_ascii_lowercase)
            .ok_or_else(|| "Theme Family asset 缺少受支持扩展名".to_string())?;
        if !matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "webp" | "mp4") {
            return Err("Theme Family asset 类型不在静态白名单".to_string());
        }
        if !allowed_assets.insert(basename.to_string()) {
            return Err("Theme Family asset 清单包含重复文件".to_string());
        }
        verify_manifest_file(family, object, path, "Theme Family asset")?;
    }
    if manifest.get("targets").is_some() {
        return Err("Theme Family 不得携带预编译 Adapter target".to_string());
    }
    verify_family_layout(family, &allowed_assets)?;
    Ok(())
}

fn verify_family_layout(family: &Path, allowed_assets: &BTreeSet<String>) -> Result<(), String> {
    let top_level = fs::read_dir(family).map_err(|_| "无法读取 Theme Family 目录".to_string())?;
    for entry in top_level {
        let entry = entry.map_err(|_| "无法读取 Theme Family 条目".to_string())?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| "Theme Family 条目名称不是安全 UTF-8".to_string())?;
        let file_type = entry
            .file_type()
            .map_err(|_| "无法读取 Theme Family 条目类型".to_string())?;
        match name.as_str() {
            "family.json" | "unified-theme.json" if file_type.is_file() => {}
            "assets" if file_type.is_dir() => {}
            _ => return Err("Theme Family 包含清单外文件或目录".to_string()),
        }
    }

    let assets_root = trusted_direct_child(family, "assets", "Theme Family assets")?;
    let mut actual_assets = BTreeSet::new();
    for entry in
        fs::read_dir(&assets_root).map_err(|_| "无法读取 Theme Family assets".to_string())?
    {
        let entry = entry.map_err(|_| "无法读取 Theme Family asset".to_string())?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| "Theme Family asset 名称不是安全 UTF-8".to_string())?;
        let file_type = entry
            .file_type()
            .map_err(|_| "无法读取 Theme Family asset 类型".to_string())?;
        if !file_type.is_file() || !actual_assets.insert(name) {
            return Err("Theme Family assets 包含非普通文件或重复条目".to_string());
        }
    }
    if &actual_assets != allowed_assets {
        return Err("Theme Family assets 与完整性清单不一致".to_string());
    }
    Ok(())
}

fn verify_manifest_file(
    family: &Path,
    entry: &serde_json::Map<String, Value>,
    expected_path: &str,
    label: &str,
) -> Result<(), String> {
    if entry.get("path").and_then(Value::as_str) != Some(expected_path) {
        return Err(format!("{label}路径与固定清单不一致"));
    }
    let expected_bytes = entry
        .get("bytes")
        .and_then(Value::as_u64)
        .ok_or_else(|| format!("{label}大小清单无效"))?;
    let expected_hash = entry
        .get("sha256")
        .and_then(Value::as_str)
        .filter(|hash| hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .ok_or_else(|| format!("{label}摘要清单无效"))?;
    let file = family.join(expected_path);
    let metadata = file
        .symlink_metadata()
        .map_err(|_| format!("{label}不存在"))?;
    if !metadata.file_type().is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() != expected_bytes
    {
        return Err(format!("{label}大小或文件类型与清单不一致"));
    }
    let actual_hash = sha256_file(&file)?;
    if actual_hash != expected_hash.to_ascii_lowercase() {
        return Err(format!("{label}未通过 SHA-256 完整性校验"));
    }
    Ok(())
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|_| "无法读取 Theme Family 文件".to_string())?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|_| "读取 Theme Family 文件时发生错误".to_string())?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn trusted_script_file(path: &Path, label: &str) -> Result<(), String> {
    trusted_json_file(path, label)
}

fn write_private_json(path: &Path, value: &Value) -> Result<(), String> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|_| "无法创建 Adapter 编译上下文".to_string())?;
    let bytes = serde_json::to_vec(value).map_err(|_| "无法编码 Adapter 编译上下文".to_string())?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| "无法持久化 Adapter 编译上下文".to_string())
}

#[cfg(unix)]
fn set_private_directory(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|_| "无法设置主题编译工作区权限".to_string())
}

#[cfg(not(unix))]
fn set_private_directory(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ClientId, ClientRunState, SignatureInfo};

    #[test]
    fn scoped_manager_compile_context_contains_only_the_selected_adapter_and_full_fact_shape() {
        let expected = BTreeSet::from([
            "detectedClientVersion",
            "detectedClientBuild",
            "surfaceCatalogId",
            "surfaceCatalogVersion",
            "probeStatus",
            "compileAllowed",
            "applyAllowed",
            "reasonCode",
            "localRuntimeOverrides",
        ]);
        let context = build_compile_context_for("mac-workbuddy", None);
        assert_eq!(context["kind"], "cc-theme.compile-context");
        assert_eq!(context["schemaVersion"], 1);
        let adapters = context["adapters"].as_object().unwrap();
        assert_eq!(
            adapters.keys().map(String::as_str).collect::<Vec<_>>(),
            vec!["mac-workbuddy"]
        );
        for (adapter_id, adapter_context) in adapters {
            let actual = adapter_context
                .as_object()
                .unwrap()
                .keys()
                .map(String::as_str)
                .collect::<BTreeSet<_>>();
            assert_eq!(actual, expected, "{adapter_id}");
        }
    }

    #[test]
    fn newer_host_context_marks_an_explicit_runtime_compatibility_attempt() {
        let state = ClientState {
            id: ClientId::Codex,
            name: "Codex".to_string(),
            bundle_id: "com.openai.codex".to_string(),
            discovered: true,
            version: Some("26.715.52143".to_string()),
            build: Some("6000".to_string()),
            signature: SignatureInfo {
                status: SignatureState::Verified,
                team_id: Some("2DC432GLL2".to_string()),
                label: "verified".to_string(),
            },
            run_state: ClientRunState::Stopped,
            current_theme_id: None,
            current_theme_name: "Native".to_string(),
            theme_paused: false,
            adapter_ready: true,
            adapter_version: Some("26.715.31925".to_string()),
            adapter_release_revision: Some(1),
            adapter_source: "bundled".to_string(),
            adapter_status: "compatibility-candidate".to_string(),
            detail: "compatibility".to_string(),
        };
        let context = build_compile_context_for("mac-codex", Some(&state));
        let adapter = &context["adapters"]["mac-codex"];
        assert_eq!(adapter["probeStatus"], "not-run");
        assert_eq!(adapter["applyAllowed"], true);
        assert_eq!(adapter["reasonCode"], "older-adapter-compatibility-attempt");
        assert_eq!(adapter["detectedClientVersion"], "26.715.52143");
    }

    #[test]
    fn compiler_result_must_point_to_selected_target_inside_workspace() {
        let root = std::env::temp_dir().join(format!(
            "cc-theme-compiler-result-{}-{}",
            std::process::id(),
            WORKSPACE_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let target = root.join("mac-codex/theme.json");
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(&target, br#"{"id":"neutral-fixture"}"#).unwrap();
        let response = format!(
            "{{\"ok\":true,\"files\":{{\"mac-codex\":{}}}}}\n",
            serde_json::to_string(target.to_str().unwrap()).unwrap()
        );

        assert_eq!(
            compiled_theme_path(response.as_bytes(), &root, "mac-codex").unwrap(),
            target.canonicalize().unwrap()
        );
        assert!(compiled_theme_path(response.as_bytes(), &root, "mac-workbuddy").is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn compiler_context_mismatch_returns_a_bounded_structured_diagnostic() {
        let stderr = br#"noise that must not be exposed
{"ok":false,"error":"compileContext.adapters.mac-workbuddy: contains unsupported fields: detectedClientBuild; /Users/private/theme; TOKEN=secret"}
"#;
        let failure = classify_compiler_failure("mac-workbuddy", b"", stderr);
        assert_eq!(failure.code, "adapter-compile-context-incompatible");
        assert_eq!(
            failure.message,
            "Adapter 编译上下文不兼容，请更新对应解释器后重试"
        );
        assert_eq!(
            failure.details["unsupportedFields"],
            json!(["detectedClientBuild"])
        );
        let public = serde_json::to_string(&failure.details).unwrap();
        assert!(public.len() < 512);
        for forbidden in [
            "/Users/private",
            "TOKEN=secret",
            "noise that must not be exposed",
        ] {
            assert!(!public.contains(forbidden), "leaked: {forbidden}");
        }
    }

    #[test]
    fn hardened_runtime_jit_failure_is_not_misreported_as_an_adapter_error() {
        let stderr = br#"
# Fatal process out of memory: Failed to reserve virtual memory for CodeRange
private stack frame /Users/example/theme TOKEN=secret
"#;
        let failure = classify_compiler_failure("mac-codex", b"", stderr);
        assert_eq!(failure.code, "theme-compiler-runtime-incompatible");
        assert_eq!(
            failure.message,
            "内置主题编译运行时不可用，请更新 CC Theme 后重试"
        );
        assert_eq!(failure.details["stage"], "compiler-runtime");
        let public = format!("{} {}", failure.message, failure.details);
        assert!(!public.contains("/Users/example"));
        assert!(!public.contains("TOKEN=secret"));
    }

    #[test]
    fn unknown_projector_failure_never_replays_node_output() {
        let stderr = br#"{"ok":false,"error":"unexpected /private/path --token secret-value"}"#;
        let failure = classify_compiler_failure("mac-workbuddy", b"", stderr);
        assert_eq!(failure.code, "adapter-projector-failed");
        let public = format!("{} {}", failure.message, failure.details);
        assert!(!public.contains("/private/path"));
        assert!(!public.contains("secret-value"));
    }

    #[test]
    fn family_manifest_hash_mismatch_is_rejected_before_compilation() {
        let root = std::env::temp_dir().join(format!(
            "cc-theme-family-integrity-{}-{}",
            std::process::id(),
            WORKSPACE_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(root.join("assets")).unwrap();
        fs::write(root.join("unified-theme.json"), b"{}").unwrap();
        fs::write(root.join("assets/background.png"), b"png").unwrap();
        fs::write(
            root.join("family.json"),
            br#"{
              "kind":"cc-theme.theme-family-package","schemaVersion":1,"id":"neutral-fixture",
              "source":{"path":"unified-theme.json","bytes":2,"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
              "assets":[{"path":"assets/background.png","bytes":3,"sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}]
            }"#,
        )
        .unwrap();

        let error =
            verify_family_manifest(&root.canonicalize().unwrap(), "neutral-fixture").unwrap_err();
        assert!(error.contains("SHA-256"), "unexpected error: {error}");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn family_manifest_rejects_precompiled_adapter_targets() {
        let root = std::env::temp_dir().join(format!(
            "cc-theme-family-target-integrity-{}-{}",
            std::process::id(),
            WORKSPACE_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(root.join("assets")).unwrap();
        fs::create_dir_all(root.join("targets/mac-retired")).unwrap();
        fs::write(root.join("unified-theme.json"), b"{}").unwrap();
        fs::write(root.join("assets/background.png"), b"png").unwrap();
        fs::write(root.join("targets/mac-retired/theme.json"), b"{}").unwrap();
        let manifest = json!({
            "kind": "cc-theme.theme-family-package",
            "schemaVersion": 1,
            "id": "neutral-fixture",
            "source": {
                "path": "unified-theme.json",
                "bytes": 2,
                "sha256": sha256_file(&root.join("unified-theme.json")).unwrap()
            },
            "assets": [{
                "path": "assets/background.png",
                "bytes": 3,
                "sha256": sha256_file(&root.join("assets/background.png")).unwrap()
            }],
            "targets": {
                "mac-retired": {
                    "path": "targets/mac-retired/theme.json",
                    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
                }
            }
        });
        fs::write(
            root.join("family.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();

        let error =
            verify_family_manifest(&root.canonicalize().unwrap(), "neutral-fixture").unwrap_err();
        assert!(
            error.contains("不得携带预编译"),
            "unexpected error: {error}"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn family_manifest_rejects_files_outside_the_declarative_allowlist() {
        let root = std::env::temp_dir().join(format!(
            "cc-theme-family-layout-{}-{}",
            std::process::id(),
            WORKSPACE_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(root.join("assets")).unwrap();
        fs::write(root.join("unified-theme.json"), b"{}").unwrap();
        fs::write(root.join("assets/background.png"), b"png").unwrap();
        fs::write(root.join("payload.js"), b"alert(1)").unwrap();
        let manifest = json!({
            "kind": "cc-theme.theme-family-package",
            "schemaVersion": 1,
            "id": "neutral-fixture",
            "source": {
                "path": "unified-theme.json",
                "bytes": 2,
                "sha256": sha256_file(&root.join("unified-theme.json")).unwrap()
            },
            "assets": [{
                "path": "assets/background.png",
                "bytes": 3,
                "sha256": sha256_file(&root.join("assets/background.png")).unwrap()
            }]
        });
        fs::write(
            root.join("family.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();

        let error =
            verify_family_manifest(&root.canonicalize().unwrap(), "neutral-fixture").unwrap_err();
        assert!(error.contains("清单外"), "unexpected error: {error}");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn compiled_cache_identity_tracks_theme_context_and_adapter_engine_bytes() {
        let root = std::env::temp_dir().join(format!(
            "cc-theme-cache-identity-{}-{}",
            std::process::id(),
            WORKSPACE_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let family = root.join("family");
        let adapter = root.join("adapter");
        let compiler = root.join("packages/shared-core");
        let sdk = root.join("packages/adapter-sdk");
        let registry = root.join("registry.json");
        fs::create_dir_all(adapter.join("contracts")).unwrap();
        fs::create_dir_all(adapter.join("scripts")).unwrap();
        fs::create_dir_all(&family).unwrap();
        fs::create_dir_all(&compiler).unwrap();
        fs::create_dir_all(&sdk).unwrap();
        fs::write(family.join("family.json"), br#"{"id":"fixture"}"#).unwrap();
        for (directory, names) in [
            (&compiler, ["package.json", "cli.mjs", "compiler.mjs"]),
            (
                &sdk,
                ["package.json", "adapter-registry.mjs", "workspace-root.mjs"],
            ),
        ] {
            for name in names {
                fs::write(directory.join(name), format!("{name}:v1")).unwrap();
            }
        }
        fs::write(&registry, br#"{"adapters":["mac-workbuddy"]}"#).unwrap();
        fs::write(adapter.join("scripts/projector.mjs"), b"projector-v1").unwrap();
        fs::write(
            adapter.join("contracts/adapter-release-manifest.json"),
            br#"{
              "adapterId":"mac-workbuddy",
              "entries":[
                "contracts/adapter-release-manifest.json",
                "scripts/projector.mjs"
              ]
            }"#,
        )
        .unwrap();
        let first_context = json!({"adapters":{"mac-workbuddy":{"probeStatus":"passed"}}});
        let first = compile_cache_key_from(
            "mac-workbuddy",
            "fixture",
            &family,
            &first_context,
            &adapter,
            &compiler,
            &sdk,
            Some(&registry),
        )
        .unwrap();
        let repeated = compile_cache_key_from(
            "mac-workbuddy",
            "fixture",
            &family,
            &first_context,
            &adapter,
            &compiler,
            &sdk,
            Some(&registry),
        )
        .unwrap();
        assert_eq!(first, repeated);

        let context_changed = compile_cache_key_from(
            "mac-workbuddy",
            "fixture",
            &family,
            &json!({"adapters":{"mac-workbuddy":{"probeStatus":"failed"}}}),
            &adapter,
            &compiler,
            &sdk,
            Some(&registry),
        )
        .unwrap();
        assert_ne!(first.fingerprint, context_changed.fingerprint);

        fs::write(adapter.join("scripts/projector.mjs"), b"projector-v2").unwrap();
        let engine_changed = compile_cache_key_from(
            "mac-workbuddy",
            "fixture",
            &family,
            &first_context,
            &adapter,
            &compiler,
            &sdk,
            Some(&registry),
        )
        .unwrap();
        assert_ne!(first.fingerprint, engine_changed.fingerprint);
        fs::remove_dir_all(root).unwrap();
    }
}
