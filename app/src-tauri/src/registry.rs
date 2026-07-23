use std::{
    fs,
    path::{Path, PathBuf},
};

use serde_json::Value;

use crate::models::ClientId;

pub const WORKSPACE_MARKER: &str = ".cc-theme-workspace.json";

#[derive(Debug, Clone)]
pub struct ClientDefinition {
    pub id: ClientId,
    pub display_name: &'static str,
    pub bundle_id: &'static str,
    pub expected_team_id: &'static str,
    pub app_filename: &'static str,
    pub app_override_env: &'static str,
    pub adapter_dirname: &'static str,
    pub adapter_override_env: &'static str,
    pub state_kind: StateKind,
}

#[derive(Debug, Clone, Copy)]
pub enum StateKind {
    Json { relative: &'static str },
    Env { relative: &'static str },
}

pub fn definition(id: ClientId) -> ClientDefinition {
    match id {
        ClientId::Codex => ClientDefinition {
            id,
            display_name: "ChatGPT / Codex",
            bundle_id: "com.openai.codex",
            expected_team_id: "2DC432GLL2",
            app_filename: "ChatGPT.app",
            app_override_env: "CODEX_APP_BUNDLE",
            adapter_dirname: "mac-codex",
            adapter_override_env: "CC_THEME_CODEX_ADAPTER_ROOT",
            state_kind: StateKind::Json {
                relative: "Library/Application Support/CCTheme/state.json",
            },
        },
        ClientId::Doubao => ClientDefinition {
            id,
            display_name: "Doubao",
            bundle_id: "com.bot.pc.doubao",
            expected_team_id: "96L78H6LMH",
            app_filename: "Doubao.app",
            app_override_env: "DOUBAO_APP_BUNDLE",
            adapter_dirname: "mac-doubao",
            adapter_override_env: "CC_THEME_DOUBAO_ADAPTER_ROOT",
            state_kind: StateKind::Env {
                relative: "Library/Application Support/mac-doubao/state.env",
            },
        },
        ClientId::Workbuddy => ClientDefinition {
            id,
            display_name: "WorkBuddy",
            bundle_id: "com.workbuddy.workbuddy",
            expected_team_id: "FN2V63AD2J",
            app_filename: "WorkBuddy.app",
            app_override_env: "WORKBUDDY_APP_BUNDLE",
            adapter_dirname: "mac-workbuddy",
            adapter_override_env: "CC_THEME_WORKBUDDY_ADAPTER_ROOT",
            state_kind: StateKind::Env {
                relative: "Library/Application Support/mac-workbuddy/state.env",
            },
        },
    }
}

pub fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/Users/Shared"))
}

pub fn repository_root_from_manifest(manifest_dir: &Path) -> PathBuf {
    workspace_root_from(manifest_dir)
        .unwrap_or_else(|_| PathBuf::from("/nonexistent/cc-theme-workspace"))
}

pub fn workspace_root_from(start: &Path) -> Result<PathBuf, String> {
    let mut current = if start.is_file() {
        start.parent().unwrap_or(start).to_path_buf()
    } else {
        start.to_path_buf()
    };
    if !current.is_absolute() {
        current = std::env::current_dir()
            .map_err(|_| "无法解析当前工作目录".to_string())?
            .join(current);
    }
    loop {
        let marker = current.join(WORKSPACE_MARKER);
        if let Ok(metadata) = fs::symlink_metadata(&marker) {
            if metadata.file_type().is_file() && !metadata.file_type().is_symlink() {
                let value = fs::read(&marker)
                    .ok()
                    .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
                if value
                    .as_ref()
                    .and_then(|item| item.get("kind"))
                    .and_then(Value::as_str)
                    == Some("cc-theme.workspace")
                    && value
                        .as_ref()
                        .and_then(|item| item.get("schemaVersion"))
                        .and_then(Value::as_u64)
                        == Some(1)
                {
                    return Ok(current);
                }
            }
        }
        if !current.pop() {
            break;
        }
    }
    Err(format!(
        "找不到 CC Theme workspace marker：{}",
        start.display()
    ))
}

pub fn adapter_root(definition: &ClientDefinition) -> PathBuf {
    if let Some(path) = std::env::var_os(definition.adapter_override_env).filter(|p| !p.is_empty())
    {
        return PathBuf::from(path);
    }
    if let Some(repository) = std::env::var_os("CC_THEME_REPOSITORY_ROOT").filter(|p| !p.is_empty())
    {
        return PathBuf::from(repository)
            .join("adapters")
            .join(definition.adapter_dirname);
    }
    if std::env::var_os("CC_THEME_ENABLE_LOCAL_ADAPTERS").as_deref()
        == Some(std::ffi::OsStr::new("1"))
    {
        let bundled = std::env::var_os("CC_THEME_BUNDLED_ADAPTERS_ROOT")
            .filter(|p| !p.is_empty())
            .map(PathBuf::from)
            .map(|root| root.join(definition.adapter_dirname));
        if let Some(active) = crate::adapter_installer::active_adapter_root(definition.id.as_str())
        {
            if bundled.as_ref().is_none_or(|bundled| {
                crate::adapter_installer::active_adapter_is_not_older_than(
                    definition.id.as_str(),
                    bundled,
                )
            }) {
                return active;
            }
        }
        if let Some(bundled) = bundled.filter(|path| path.is_dir()) {
            return bundled;
        }
    }
    if let Some(resources) =
        std::env::var_os("CC_THEME_BUNDLED_ADAPTERS_ROOT").filter(|p| !p.is_empty())
    {
        let bundled = PathBuf::from(resources).join(definition.adapter_dirname);
        if bundled.is_dir() {
            return bundled;
        }
    }
    repository_root_from_manifest(Path::new(env!("CARGO_MANIFEST_DIR")))
        .join("adapters")
        .join(definition.adapter_dirname)
}

pub fn state_path(definition: &ClientDefinition) -> PathBuf {
    let relative = match definition.state_kind {
        StateKind::Json { relative } | StateKind::Env { relative } => relative,
    };
    home_dir().join(relative)
}

pub fn saved_themes_root(definition: &ClientDefinition) -> PathBuf {
    state_path(definition)
        .parent()
        .unwrap_or_else(|| Path::new("/nonexistent"))
        .join("themes")
}

pub fn manager_theme_library_root() -> PathBuf {
    std::env::var_os("CC_THEME_THEME_LIBRARY_ROOT")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            home_dir()
                .join("Library/Application Support/CC Theme")
                .join("themes")
        })
}

/// Local, Manager-owned adjustments live beside the imported Theme Family
/// rather than inside it.  This preserves the package's signed/hash-verified
/// source and lets a user remove either the theme or its local data atomically.
pub fn manager_theme_overrides_root() -> PathBuf {
    home_dir()
        .join("Library/Application Support/CC Theme")
        .join("theme-overrides")
}

pub fn manager_adapter_library_root() -> PathBuf {
    home_dir().join("Library/Application Support/CC Theme/adapters")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_marker_resolves_from_arbitrarily_nested_paths() {
        let root =
            std::env::temp_dir().join(format!("cc-theme-workspace-root-{}", std::process::id()));
        let nested = root.join("app/src-tauri/src");
        fs::create_dir_all(&nested).unwrap();
        fs::write(
            root.join(WORKSPACE_MARKER),
            br#"{"kind":"cc-theme.workspace","schemaVersion":1}"#,
        )
        .unwrap();
        assert_eq!(workspace_root_from(&nested).unwrap(), root);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn workspace_marker_fails_closed_when_missing() {
        assert!(workspace_root_from(Path::new("/tmp/cc-theme-no-workspace/nested")).is_err());
    }

    #[test]
    fn every_client_has_a_distinct_fixed_identity() {
        let identities: Vec<_> = ClientId::ALL
            .into_iter()
            .map(|id| {
                let item = definition(id);
                (item.bundle_id, item.expected_team_id, item.adapter_dirname)
            })
            .collect();
        assert_eq!(identities.len(), 3);
        assert_eq!(
            identities
                .iter()
                .collect::<std::collections::BTreeSet<_>>()
                .len(),
            3
        );
    }
}
