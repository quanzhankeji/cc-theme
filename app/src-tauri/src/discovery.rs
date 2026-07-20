use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};

use plist::Value as PlistValue;
use serde_json::Value;

use crate::{
    adapter_installer,
    models::{
        ClientId, ClientRunState, ClientRuntimeState, ClientState, SignatureInfo, SignatureState,
    },
    process::{run_with_timeout, run_with_timeout_limit},
    registry::{self, ClientDefinition, StateKind},
    themes::{read_theme_metadata, valid_theme_id},
};

#[derive(Debug, Clone, Default)]
struct InstalledApp {
    path: Option<PathBuf>,
    version: Option<String>,
    build: Option<String>,
    team_id: Option<String>,
    signature_valid: Option<bool>,
    running: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SignatureVerification {
    Recursive,
    Outer,
}

pub fn client_state(id: ClientId) -> ClientState {
    let process_snapshot = process_executable_snapshot();
    client_state_from_snapshot(
        id,
        process_snapshot.as_deref(),
        SignatureVerification::Recursive,
    )
}

/// Performs the Manager-owned identity and outer-seal checks immediately before
/// invoking an Adapter. The Adapter remains the single owner of the recursive
/// host verification and repeats it before any runtime mutation. Keeping the
/// two checks complementary avoids two consecutive full bundle walks without
/// weakening the final apply gate.
pub fn client_state_for_adapter_operation(id: ClientId) -> ClientState {
    let process_snapshot = process_executable_snapshot();
    client_state_from_snapshot(
        id,
        process_snapshot.as_deref(),
        SignatureVerification::Outer,
    )
}

fn client_state_from_snapshot(
    id: ClientId,
    process_snapshot: Option<&str>,
    signature_verification: SignatureVerification,
) -> ClientState {
    let definition = registry::definition(id);
    let app = discover_app(&definition, process_snapshot, signature_verification);
    let adapter = adapter_installer::installed_adapter_info(&definition, app.version.as_deref());
    let adapter_ready = matches!(adapter.status, "ready" | "compatibility-candidate")
        && adapter_is_ready(&definition);
    let (current_theme_id, theme_paused) = read_theme_state(&definition);
    let current_theme_name = current_theme_id
        .as_deref()
        .and_then(|theme_id| theme_name(&definition, theme_id))
        .unwrap_or_else(|| {
            current_theme_id
                .clone()
                .unwrap_or_else(|| "原生外观".to_string())
        });
    let discovered = app.path.is_some();
    let signature_status = match (app.signature_valid, app.team_id.as_deref()) {
        (Some(true), Some(team)) if team == definition.expected_team_id => SignatureState::Verified,
        (Some(_), _) | (_, Some(_)) => SignatureState::Unverified,
        _ => SignatureState::Unknown,
    };
    let signature_label = match signature_status {
        SignatureState::Verified => format!("已验证 · {}", definition.expected_team_id),
        SignatureState::Unverified => "签名或开发团队不匹配".to_string(),
        SignatureState::Unknown => "尚未读取签名".to_string(),
    };
    let run_state = match app.running {
        Some(true) => ClientRunState::Running,
        Some(false) if discovered => ClientRunState::Stopped,
        _ => ClientRunState::Unknown,
    };
    let detail = if !discovered {
        format!("未找到官方 {}", definition.app_filename)
    } else if !adapter_ready {
        "已找到客户端，但适配器文件不完整".to_string()
    } else if adapter.status == "compatibility-candidate" {
        "客户端已更新；可使用旧版 Adapter 做受控兼容尝试".to_string()
    } else if !matches!(signature_status, SignatureState::Verified) {
        "已找到客户端，但官方签名校验未通过".to_string()
    } else if theme_paused {
        "主题已暂停，可随时重新应用".to_string()
    } else if current_theme_id.is_some() {
        "客户端与主题适配器均已就绪".to_string()
    } else {
        "客户端已就绪，尚未选择主题".to_string()
    };

    ClientState {
        id,
        name: definition.display_name.to_string(),
        bundle_id: definition.bundle_id.to_string(),
        discovered,
        version: app.version,
        build: app.build,
        signature: SignatureInfo {
            status: signature_status,
            team_id: app.team_id,
            label: signature_label,
        },
        run_state,
        current_theme_id,
        current_theme_name,
        theme_paused,
        adapter_ready,
        adapter_version: adapter.version,
        adapter_release_revision: adapter.release_revision,
        adapter_source: adapter.source.to_string(),
        adapter_status: adapter.status.to_string(),
        detail,
    }
}

pub fn all_client_states() -> Vec<ClientState> {
    let process_snapshot = process_executable_snapshot();
    ClientId::ALL
        .into_iter()
        .map(|id| {
            client_state_from_snapshot(
                id,
                process_snapshot.as_deref(),
                SignatureVerification::Recursive,
            )
        })
        .collect()
}

pub fn all_client_runtime_states() -> Vec<ClientRuntimeState> {
    let process_snapshot = process_executable_snapshot();
    ClientId::ALL
        .into_iter()
        .map(|id| {
            let definition = registry::definition(id);
            let app_path = candidate_app_paths(&definition)
                .into_iter()
                .find(|candidate| bundle_id(candidate).as_deref() == Some(definition.bundle_id))
                .or_else(|| mdfind_bundle(definition.bundle_id));
            let run_state = match (app_path.as_deref(), process_snapshot.as_deref()) {
                (Some(path), Some(snapshot)) => {
                    match snapshot_contains_app(snapshot, path, &definition) {
                        Some(true) => ClientRunState::Running,
                        Some(false) => ClientRunState::Stopped,
                        None => ClientRunState::Unknown,
                    }
                }
                _ => ClientRunState::Unknown,
            };
            ClientRuntimeState { id, run_state }
        })
        .collect()
}

pub fn verified_app_path(id: ClientId) -> Option<PathBuf> {
    let definition = registry::definition(id);
    let path = candidate_app_paths(&definition)
        .into_iter()
        .find(|candidate| bundle_id(candidate).as_deref() == Some(definition.bundle_id))
        .or_else(|| mdfind_bundle(definition.bundle_id))?;
    let canonical = fs::canonicalize(path).ok()?;
    if bundle_id(&canonical).as_deref() != Some(definition.bundle_id)
        || codesign_team_id(&canonical).as_deref() != Some(definition.expected_team_id)
        || codesign_verify(&canonical, SignatureVerification::Recursive) != Some(true)
    {
        return None;
    }
    Some(canonical)
}

pub fn app_path_is_running(id: ClientId, app_path: &Path) -> Option<bool> {
    let definition = registry::definition(id);
    process_executable_snapshot()
        .and_then(|snapshot| snapshot_contains_app(&snapshot, app_path, &definition))
}

fn discover_app(
    definition: &ClientDefinition,
    process_snapshot: Option<&str>,
    signature_verification: SignatureVerification,
) -> InstalledApp {
    let app_path = candidate_app_paths(definition)
        .into_iter()
        .find(|candidate| bundle_id(candidate).as_deref() == Some(definition.bundle_id))
        .or_else(|| mdfind_bundle(definition.bundle_id));
    let Some(path) = app_path else {
        return InstalledApp::default();
    };
    let version = plist_string(&path, "CFBundleShortVersionString");
    let build = plist_string(&path, "CFBundleVersion");
    let team_id = codesign_team_id(&path);
    let signature_valid = codesign_verify(&path, signature_verification);
    let running =
        process_snapshot.and_then(|snapshot| snapshot_contains_app(snapshot, &path, definition));
    InstalledApp {
        path: Some(path),
        version,
        build,
        team_id,
        signature_valid,
        running,
    }
}

fn candidate_app_paths(definition: &ClientDefinition) -> Vec<PathBuf> {
    let home = registry::home_dir();
    let mut paths = Vec::with_capacity(3);
    if let Some(overridden) =
        std::env::var_os(definition.app_override_env).filter(|value| !value.is_empty())
    {
        paths.push(PathBuf::from(overridden));
    }
    paths.push(PathBuf::from("/Applications").join(definition.app_filename));
    paths.push(home.join("Applications").join(definition.app_filename));
    paths
}

fn mdfind_bundle(expected_bundle_id: &str) -> Option<PathBuf> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    let query = format!("kMDItemCFBundleIdentifier == '{expected_bundle_id}'");
    let mut command = Command::new("/usr/bin/mdfind");
    command.arg(query);
    let output = run_with_timeout(&mut command, Duration::from_secs(3)).ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(PathBuf::from)
        .find(|path| bundle_id(path).as_deref() == Some(expected_bundle_id))
}

fn plist_string(app_path: &Path, key: &str) -> Option<String> {
    let info_path = app_path.join("Contents/Info.plist");
    let plist = PlistValue::from_file(info_path).ok()?;
    plist
        .as_dictionary()?
        .get(key)?
        .as_string()
        .map(ToOwned::to_owned)
}

fn bundle_id(app_path: &Path) -> Option<String> {
    plist_string(app_path, "CFBundleIdentifier")
}

fn codesign_team_id(app_path: &Path) -> Option<String> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    let mut command = Command::new("/usr/bin/codesign");
    command.args(["-dv", "--verbose=4"]).arg(app_path);
    let output = run_with_timeout(&mut command, Duration::from_secs(15)).ok()?;
    let text = String::from_utf8_lossy(&output.stderr);
    text.lines()
        .find_map(|line| line.strip_prefix("TeamIdentifier="))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn codesign_verify_args(verification: SignatureVerification) -> &'static [&'static str] {
    match verification {
        SignatureVerification::Recursive => &["--verify", "--deep", "--strict"],
        SignatureVerification::Outer => &["--verify", "--strict"],
    }
}

fn codesign_verify(app_path: &Path, verification: SignatureVerification) -> Option<bool> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    let mut command = Command::new("/usr/bin/codesign");
    command
        .args(codesign_verify_args(verification))
        .arg(app_path);
    run_with_timeout(&mut command, Duration::from_secs(15))
        .ok()
        .map(|output| output.status.success())
}

fn process_executable_snapshot() -> Option<String> {
    const MAX_PROCESS_SNAPSHOT_BYTES: usize = 2 * 1024 * 1024;
    let mut command = Command::new("/bin/ps");
    command.args(["-axo", "pid=,ppid=,comm="]);
    let result = run_with_timeout_limit(
        &mut command,
        Duration::from_secs(3),
        MAX_PROCESS_SNAPSHOT_BYTES,
    )
    .ok()?;
    if !result.output.status.success() || result.stdout_truncated || result.stderr_truncated {
        return None;
    }
    String::from_utf8(result.output.stdout).ok()
}

fn snapshot_contains_app(
    snapshot: &str,
    app_path: &Path,
    definition: &ClientDefinition,
) -> Option<bool> {
    let executable = plist_string(app_path, "CFBundleExecutable")?;
    let executable_name = Path::new(&executable);
    if executable_name.components().count() != 1 {
        return None;
    }
    let has_main_process = snapshot_contains_executable(
        snapshot,
        &app_path.join("Contents/MacOS").join(executable_name),
    );
    if !has_main_process || !matches!(definition.id, ClientId::Workbuddy) {
        return Some(has_main_process);
    }

    // WorkBuddy can leave its Electron host and CLI child behind after the user
    // quits the desktop UI.  That residue has no renderer and cannot represent
    // an interactive client session.  Requiring the bundle-owned renderer keeps
    // the launch gate accurate without inspecting command arguments or user data.
    Some(snapshot_contains_workbuddy_renderer(snapshot, app_path))
}

fn snapshot_contains_workbuddy_renderer(snapshot: &str, app_path: &Path) -> bool {
    let renderer_marker = " Helper (Renderer).app/Contents/MacOS/";
    let framework_root = app_path.join("Contents/Frameworks");
    snapshot.lines().any(|line| {
        process_executable_from_line(line).is_some_and(|path| {
            path.starts_with(&framework_root) && path.to_string_lossy().contains(renderer_marker)
        })
    })
}

fn snapshot_contains_executable(snapshot: &str, expected: &Path) -> bool {
    snapshot
        .lines()
        .filter_map(process_executable_from_line)
        .any(|path| path == expected)
}

fn process_executable_from_line(line: &str) -> Option<&Path> {
    let line = line.trim_start();
    let pid_end = line.find(char::is_whitespace)?;
    line[..pid_end].parse::<u32>().ok()?;
    let after_pid = line[pid_end..].trim_start();
    let ppid_end = after_pid.find(char::is_whitespace)?;
    after_pid[..ppid_end].parse::<u32>().ok()?;
    let executable = after_pid[ppid_end..].trim_start();
    (!executable.is_empty()).then(|| Path::new(executable))
}

pub fn adapter_is_ready(definition: &ClientDefinition) -> bool {
    let scripts = registry::adapter_root(definition).join("scripts");
    [
        "switch-theme-macos.sh",
        "start-skin-macos.sh",
        "pause-skin-macos.sh",
        "restore-skin-macos.sh",
        "verify-skin-macos.sh",
        "doctor-macos.sh",
    ]
    .into_iter()
    .all(|name| scripts.join(name).is_file())
}

fn read_theme_state(definition: &ClientDefinition) -> (Option<String>, bool) {
    let state_path = registry::state_path(definition);
    match definition.state_kind {
        StateKind::Json { .. } => read_json_theme_state(definition, &state_path),
        StateKind::Env { .. } => read_env_theme_state(&state_path),
    }
}

fn read_json_theme_state(
    definition: &ClientDefinition,
    state_path: &Path,
) -> (Option<String>, bool) {
    let state = read_small_json(state_path);
    let paused = state
        .as_ref()
        .and_then(|value| value.get("session"))
        .and_then(Value::as_str)
        == Some("paused");
    let active_record = state_path
        .parent()
        .map(|parent| parent.join("active-theme.json"))
        .and_then(|path| read_small_json(&path))
        .and_then(|value| {
            value
                .get("themeId")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .filter(|id| valid_theme_id(id));
    if active_record.is_some() {
        return (active_record, paused);
    }
    let live_theme_id = state
        .as_ref()
        .and_then(|value| value.get("themeDir"))
        .and_then(Value::as_str)
        .and_then(|directory| read_theme_metadata(Path::new(directory)))
        .map(|theme| theme.id)
        .filter(|id| valid_theme_id(id));
    if live_theme_id.is_some() {
        return (live_theme_id, paused);
    }
    let fallback = registry::saved_themes_root(definition)
        .parent()
        .and_then(read_theme_metadata)
        .map(|theme| theme.id)
        .filter(|id| valid_theme_id(id));
    (fallback, paused)
}

fn read_env_theme_state(state_path: &Path) -> (Option<String>, bool) {
    let Ok(metadata) = fs::symlink_metadata(state_path) else {
        return (None, false);
    };
    if !metadata.file_type().is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() > 64 * 1024
    {
        return (None, false);
    }
    let Ok(contents) = fs::read_to_string(state_path) else {
        return (None, false);
    };
    let mut mode = None;
    let mut theme_dir = None;
    for line in contents.lines() {
        if let Some(value) = line.strip_prefix("mode=") {
            mode = Some(value.trim());
        } else if let Some(value) = line.strip_prefix("theme_dir=") {
            theme_dir = Some(value.trim());
        }
    }
    let theme_id = theme_dir
        .and_then(|path| read_theme_metadata(Path::new(path)))
        .map(|theme| theme.id)
        .filter(|id| valid_theme_id(id));
    (theme_id, mode == Some("paused"))
}

fn read_small_json(path: &Path) -> Option<Value> {
    let metadata = fs::symlink_metadata(path).ok()?;
    if !metadata.file_type().is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() > 1024 * 1024
    {
        return None;
    }
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

fn theme_name(definition: &ClientDefinition, theme_id: &str) -> Option<String> {
    read_theme_metadata(&registry::saved_themes_root(definition).join(theme_id))
        .map(|theme| theme.name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn candidate_paths_include_system_and_user_locations() {
        let definition = registry::definition(ClientId::Codex);
        let paths = candidate_app_paths(&definition);
        assert!(paths.contains(&PathBuf::from("/Applications/ChatGPT.app")));
        assert!(paths
            .iter()
            .any(|path| path.ends_with("Applications/ChatGPT.app")));
    }

    #[test]
    fn missing_state_is_safely_inactive() {
        let result = read_env_theme_state(Path::new("/definitely/missing/state.env"));
        assert_eq!(result, (None, false));
    }

    #[test]
    fn runtime_detection_uses_executable_paths_without_process_arguments() {
        let snapshot = "  10   1 /Applications/WorkBuddy.app/Contents/MacOS/Electron\n  11  10 /Applications/WorkBuddy.app/Contents/Frameworks/WorkBuddy Helper.app/Contents/MacOS/WorkBuddy Helper\n";
        assert!(snapshot_contains_executable(
            snapshot,
            Path::new("/Applications/WorkBuddy.app/Contents/MacOS/Electron")
        ));
        assert!(!snapshot_contains_executable(
            snapshot,
            Path::new("/Applications/WorkBuddy.app/Contents/MacOS/WorkBuddy")
        ));
    }

    #[test]
    fn runtime_detection_finds_a_target_after_the_old_capture_boundary() {
        let mut snapshot = String::new();
        for index in 0..3_000 {
            snapshot.push_str(&format!(
                "{index:5}     1 /Applications/Filler-{index}.app/Contents/MacOS/Filler\n"
            ));
        }
        snapshot.push_str("99999     1 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT\n");
        assert!(snapshot.len() > 64 * 1024);
        assert!(snapshot_contains_executable(
            &snapshot,
            Path::new("/Applications/ChatGPT.app/Contents/MacOS/ChatGPT")
        ));
    }

    #[test]
    fn workbuddy_requires_a_bundle_owned_renderer_not_a_headless_host_residue() {
        let app = Path::new("/Applications/WorkBuddy.app");
        let residue = "56167     1 /Applications/WorkBuddy.app/Contents/MacOS/Electron\n56263 56167 /Users/test/.workbuddy/binaries/node/versions/current/bin/node\n";
        assert!(!snapshot_contains_workbuddy_renderer(residue, app));

        let interactive = "57600     1 /Applications/WorkBuddy.app/Contents/MacOS/Electron\n57657 57600 /Applications/WorkBuddy.app/Contents/Frameworks/WorkBuddy Helper (Renderer).app/Contents/MacOS/WorkBuddy Helper (Renderer)\n";
        assert!(snapshot_contains_workbuddy_renderer(interactive, app));
    }

    #[test]
    fn adapter_preflight_keeps_outer_seal_while_the_adapter_owns_recursive_verification() {
        assert_eq!(
            codesign_verify_args(SignatureVerification::Outer),
            ["--verify", "--strict"]
        );
        assert_eq!(
            codesign_verify_args(SignatureVerification::Recursive),
            ["--verify", "--deep", "--strict"]
        );
    }
}
