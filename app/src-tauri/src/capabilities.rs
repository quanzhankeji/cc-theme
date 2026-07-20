use std::{
    fs,
    path::{Path, PathBuf},
};

use serde_json::Value;

use crate::{
    models::{AdapterCapability, CapabilityAvailability, ClientId},
    registry,
};

const MAX_CAPABILITY_BYTES: u64 = 4 * 1024 * 1024;

pub fn load_capabilities() -> Result<Vec<AdapterCapability>, String> {
    let root = capability_root();
    let manifests = registry_manifest_names(&root)?;
    let source_root = capability_source_root();
    let mut capabilities = Vec::with_capacity(manifests.len());
    for manifest in manifests {
        let source = if manifest.contains('/') {
            capability_manifest_source(&manifest, &source_root)
        } else {
            root.join(&manifest)
        };
        let value = read_json_file(&source).ok();
        let capability = value
            .as_ref()
            .and_then(|value| normalize_capability(value).ok())
            .unwrap_or_else(|| unavailable_for_manifest(&manifest));
        capabilities.push(capability);
    }
    Ok(capabilities)
}

fn capability_manifest_source(manifest: &str, fallback_root: &Path) -> PathBuf {
    let path = Path::new(manifest);
    let mut components = path.components();
    let adapter_id = components.next().and_then(|component| match component {
        std::path::Component::Normal(value) => value.to_str(),
        _ => None,
    });
    let Some(client_id) = adapter_id.and_then(ClientId::from_adapter_id) else {
        return fallback_root.join(path);
    };
    let relative = components.as_path();
    registry::adapter_root(&registry::definition(client_id)).join(relative)
}

pub fn load_capabilities_or_fallback() -> Vec<AdapterCapability> {
    load_capabilities().unwrap_or_else(|_| {
        [
            ("mac-codex", "ChatGPT / Codex", true),
            ("mac-doubao", "Doubao", true),
            ("mac-workbuddy", "WorkBuddy", true),
        ]
        .into_iter()
        .map(|(id, name, launch)| unavailable_capability(id, name, launch))
        .collect()
    })
}

pub fn capability_for(client_id: ClientId) -> Option<AdapterCapability> {
    load_capabilities_or_fallback()
        .into_iter()
        .find(|capability| ClientId::from_adapter_id(&capability.adapter_id) == Some(client_id))
}

#[cfg(test)]
pub fn load_capabilities_from(root: &Path) -> Result<Vec<AdapterCapability>, String> {
    registry_manifest_names(root)?
        .into_iter()
        .map(|manifest| {
            read_json_file(&root.join(manifest)).and_then(|value| normalize_capability(&value))
        })
        .collect()
}

fn capability_root() -> PathBuf {
    if let Some(root) =
        std::env::var_os("CC_THEME_CAPABILITY_ROOT").filter(|value| !value.is_empty())
    {
        return PathBuf::from(root);
    }
    registry::repository_root_from_manifest(Path::new(env!("CARGO_MANIFEST_DIR")))
        .join("app/registry")
}

fn capability_source_root() -> PathBuf {
    if let Some(root) =
        std::env::var_os("CC_THEME_CAPABILITY_SOURCE_ROOT").filter(|value| !value.is_empty())
    {
        return PathBuf::from(root);
    }
    registry::repository_root_from_manifest(Path::new(env!("CARGO_MANIFEST_DIR"))).join("adapters")
}

fn registry_manifest_names(root: &Path) -> Result<Vec<String>, String> {
    let registry_file = ["registry.json", "adapter-capabilities.json"]
        .into_iter()
        .map(|name| root.join(name))
        .find(|path| path.is_file())
        .ok_or_else(|| "Capability registry 不存在".to_string())?;
    let value = read_json_file(&registry_file)?;
    if value.get("kind").and_then(Value::as_str) != Some("cc-theme.adapter-capability-registry")
        || value.get("schemaVersion").and_then(Value::as_u64) != Some(1)
    {
        return Err("Capability registry kind/schemaVersion 无效".to_string());
    }
    let manifests = if let Some(manifests) = value.get("manifests").and_then(Value::as_array) {
        manifests.clone()
    } else {
        value
            .get("adapters")
            .and_then(Value::as_array)
            .ok_or_else(|| "Capability registry 缺少 adapters/manifests".to_string())?
            .iter()
            .map(|adapter| {
                adapter
                    .get("capabilityFile")
                    .cloned()
                    .unwrap_or(Value::Null)
            })
            .collect()
    };
    if manifests.is_empty() || manifests.len() > 64 {
        return Err("Capability registry 条目数量无效".to_string());
    }
    manifests
        .iter()
        .map(|item| {
            let name = item
                .as_str()
                .ok_or_else(|| "Capability manifest 名称无效".to_string())?;
            let safe_relative = Path::new(name)
                .components()
                .all(|component| matches!(component, std::path::Component::Normal(_)));
            if name.len() > 160
                || !name.ends_with(".json")
                || !safe_relative
                || !name.bytes().all(|byte| {
                    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'/')
                })
            {
                return Err("Capability manifest 必须是固定目录下的安全文件名".to_string());
            }
            Ok(name.to_string())
        })
        .collect()
}

fn read_json_file(path: &Path) -> Result<Value, String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| format!("Capability 文件不存在：{}", path.display()))?;
    if !metadata.file_type().is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() < 2
        || metadata.len() > MAX_CAPABILITY_BYTES
    {
        return Err("Capability 文件不是可信的普通小文件".to_string());
    }
    serde_json::from_slice(&fs::read(path).map_err(|error| error.to_string())?)
        .map_err(|error| format!("Capability JSON 无效：{error}"))
}

fn normalize_capability(value: &Value) -> Result<AdapterCapability, String> {
    let adapter_id = value
        .get("adapterId")
        .and_then(Value::as_str)
        .filter(|id| valid_adapter_id(id))
        .ok_or_else(|| "Capability adapterId 无效".to_string())?
        .to_string();
    let availability_value = value.get("availability");
    let status = availability_value
        .and_then(Value::as_str)
        .or_else(|| {
            availability_value
                .and_then(|item| item.get("status"))
                .and_then(Value::as_str)
        })
        .or_else(|| value.get("status").and_then(Value::as_str))
        .or_else(|| {
            value
                .get("available")
                .and_then(Value::as_bool)
                .map(|available| {
                    if available {
                        "available"
                    } else {
                        "unavailable"
                    }
                })
        })
        .unwrap_or("unavailable");
    let availability = match status {
        "available" => CapabilityAvailability::Available,
        "contract-only" | "projection-only" => CapabilityAvailability::ContractOnly,
        _ => CapabilityAvailability::Unavailable,
    };
    let runtime_apply_available = value
        .get("runtimeApplyAvailable")
        .and_then(Value::as_bool)
        .or_else(|| {
            availability_value
                .and_then(|item| item.get("runtimeApplyAvailable"))
                .and_then(Value::as_bool)
        })
        .unwrap_or(false)
        && availability == CapabilityAvailability::Available;
    let local = value.get("localRuntimeOverrides").unwrap_or(&Value::Null);
    let explicit_deep = availability_value
        .and_then(|item| item.get("deepSettingsAvailable"))
        .and_then(Value::as_bool);
    let declared_transaction = local
        .get("serialTransactionSeamAvailable")
        .and_then(Value::as_bool)
        .unwrap_or_else(|| {
            local
                .get("transactionPolicy")
                .and_then(Value::as_str)
                .is_some()
                || local.get("concurrency").and_then(Value::as_str).is_some()
                || value
                    .get("transactionSeam")
                    .and_then(|item| item.get("implementation"))
                    .is_some()
        });
    let declared_rebase = local.get("baseHash").is_some()
        || local.get("baseBinding").is_some()
        || local.get("rebase").is_some();
    let declared_quarantine = local
        .get("incompatibleValuePolicy")
        .or_else(|| local.get("incompatiblePolicy"))
        .or_else(|| local.get("incompatible"))
        .and_then(Value::as_str)
        .is_some_and(|policy| policy.contains("quarantine"));
    let deep_settings_available = explicit_deep
        .unwrap_or(declared_transaction && declared_rebase && declared_quarantine)
        && availability == CapabilityAvailability::Available;
    let runtime_launch_available = ClientId::from_adapter_id(&adapter_id).is_some();
    let reason = availability_value
        .and_then(|item| item.get("reason"))
        .and_then(Value::as_str)
        .or_else(|| value.get("decisionScopeNotice").and_then(Value::as_str))
        .unwrap_or_else(|| {
            if runtime_apply_available {
                "Adapter capability 已允许本地应用"
            } else {
                "Adapter capability 当前未开放主题应用"
            }
        })
        .to_string();
    let display_name = value
        .get("displayName")
        .and_then(Value::as_str)
        .unwrap_or(&adapter_id)
        .to_string();
    Ok(AdapterCapability {
        adapter_id,
        display_name,
        availability,
        runtime_apply_available,
        runtime_launch_available,
        deep_settings_available,
        capability_version: scalar_string(value.get("capabilityVersion")),
        catalog_id: value
            .get("compatibility")
            .and_then(|compatibility| compatibility.get("currentEvidence"))
            .and_then(|evidence| scalar_string(evidence.get("surfaceCatalogId"))),
        catalog_version: scalar_string(value.get("catalogVersion"))
            .or_else(|| scalar_string(value.get("uiSurfaceCatalogVersion")))
            .or_else(|| {
                value.get("catalogs").and_then(|catalogs| {
                    scalar_string(catalogs.get("uiSurfaceCatalogVersion"))
                        .or_else(|| scalar_string(catalogs.get("uiSurfaceCatalogSchemaVersion")))
                })
            }),
        reason,
    })
}

fn scalar_string(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

fn valid_adapter_id(id: &str) -> bool {
    (3..=80).contains(&id.len())
        && id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

fn unavailable_for_manifest(manifest: &str) -> AdapterCapability {
    match manifest {
        path if path.contains("mac-codex") => {
            unavailable_capability("mac-codex", "ChatGPT / Codex", true)
        }
        path if path.contains("mac-doubao") => unavailable_capability("mac-doubao", "Doubao", true),
        path if path.contains("mac-workbuddy") => {
            unavailable_capability("mac-workbuddy", "WorkBuddy", true)
        }
        other => {
            let id = Path::new(other)
                .components()
                .find_map(|component| match component {
                    std::path::Component::Normal(value) => value.to_str(),
                    _ => None,
                })
                .filter(|id| valid_adapter_id(id))
                .unwrap_or("unknown-adapter");
            unavailable_capability(id, id, false)
        }
    }
}

fn unavailable_capability(id: &str, name: &str, launch: bool) -> AdapterCapability {
    AdapterCapability {
        adapter_id: id.to_string(),
        display_name: name.to_string(),
        availability: CapabilityAvailability::Unavailable,
        runtime_apply_available: false,
        runtime_launch_available: launch,
        deep_settings_available: false,
        capability_version: None,
        catalog_id: None,
        catalog_version: None,
        reason: "能力声明缺失或无效；已按 fail-closed 阻断应用".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf, time::SystemTime};

    use super::*;

    fn scratch() -> PathBuf {
        std::env::temp_dir().join(format!(
            "cc-theme-capabilities-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn registry_manifest_drives_apply_and_deep_settings_availability() {
        let root = scratch();
        fs::create_dir_all(&root).unwrap();
        fs::write(
            root.join("registry.json"),
            r#"{"kind":"cc-theme.adapter-capability-registry","schemaVersion":1,"manifests":["future-adapter.json"]}"#,
        )
        .unwrap();
        fs::write(
            root.join("future-adapter.json"),
            r#"{
              "kind":"cc-theme.adapter-capability","schemaVersion":1,
              "adapterId":"future-adapter","displayName":"Future Adapter",
              "availability":"contract-only","capabilityVersion":"1.0.0",
              "themeStyleCatalogVersion":0,"uiSurfaceCatalogVersion":0,
              "compileAvailable":false,"runtimeApplyAvailable":false,
              "localRuntimeOverrides":{"serialTransactionSeamAvailable":false,"atomicPersistence":false,"rollbackAvailable":false},
              "authority":{"owner":"future-adapter","status":"cc-theme-snapshot"}
            }"#,
        )
        .unwrap();

        let capabilities = load_capabilities_from(&root).unwrap();

        assert_eq!(capabilities.len(), 1);
        assert_eq!(capabilities[0].adapter_id, "future-adapter");
        assert!(!capabilities[0].runtime_apply_available);
        assert!(!capabilities[0].deep_settings_available);
        assert_eq!(
            capabilities[0].availability,
            CapabilityAvailability::ContractOnly
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn authoritative_registry_preserves_owner_ids_and_blocks_unavailable_targets() {
        let capabilities = load_capabilities().unwrap();
        let by_id = capabilities
            .iter()
            .map(|item| (item.adapter_id.as_str(), item))
            .collect::<std::collections::BTreeMap<_, _>>();
        assert!(by_id["mac-codex"].runtime_apply_available);
        assert!(by_id["mac-doubao"].runtime_apply_available);
        assert!(by_id["mac-workbuddy"].runtime_apply_available);
        assert_eq!(by_id["mac-workbuddy"].catalog_version.as_deref(), Some("2"));
        assert_eq!(by_id.len(), 3);
    }
}
