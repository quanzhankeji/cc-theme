use std::{
    path::PathBuf,
    process::{Command, Output},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, MutexGuard, OnceLock, TryLockError,
    },
    thread,
    time::{Duration, Instant},
};

use chrono::Utc;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::{
    capabilities, compiler, discovery,
    models::{
        AdapterCapability, CapabilityAvailability, ClientId, ClientOperation, ClientRunState,
        DiagnosticCheck, DiagnosticReport, OperationProgress, OperationResult, SignatureState,
    },
    process::{run_with_timeout, ProcessError},
    registry::{self, ClientDefinition},
    themes::{ensure_saved_theme, valid_theme_id},
};

static OPERATION_SEQUENCE: AtomicU64 = AtomicU64::new(1);
static OPERATION_LOCKS: OnceLock<[Mutex<()>; 2]> = OnceLock::new();

fn apply_admission(capability: &AdapterCapability) -> Result<(), String> {
    if capability.availability == CapabilityAvailability::Available
        && capability.runtime_apply_available
    {
        Ok(())
    } else {
        Err(capability.reason.clone())
    }
}

fn launch_state_admission(
    operation: ClientOperation,
    run_state: ClientRunState,
) -> Result<(), (&'static str, &'static str)> {
    if !matches!(operation, ClientOperation::Apply | ClientOperation::Launch) {
        return Ok(());
    }
    match run_state {
        ClientRunState::Stopped => Ok(()),
        ClientRunState::Running => Err((
            "client-already-running",
            "客户端正在运行，请先退出客户端后再启动",
        )),
        ClientRunState::Unknown => Err((
            "client-runtime-state-unavailable",
            "无法确认客户端是否正在运行，请刷新状态后重试",
        )),
    }
}

fn operation_lock(client_id: ClientId) -> &'static Mutex<()> {
    let locks = OPERATION_LOCKS.get_or_init(|| [Mutex::new(()), Mutex::new(())]);
    match client_id {
        ClientId::Codex => &locks[0],
        ClientId::Workbuddy => &locks[1],
    }
}

fn acquire_operation_lock(client_id: ClientId) -> Result<MutexGuard<'static, ()>, ()> {
    match operation_lock(client_id).try_lock() {
        Ok(guard) => Ok(guard),
        Err(TryLockError::Poisoned(poisoned)) => Ok(poisoned.into_inner()),
        Err(TryLockError::WouldBlock) => Err(()),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandSpec {
    pub script_name: &'static str,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeLaunchSpec {
    pub program: &'static str,
    pub app_path: PathBuf,
}

pub fn native_launch_mapping(app_path: PathBuf) -> Result<NativeLaunchSpec, &'static str> {
    if !app_path.is_absolute()
        || app_path.extension().and_then(|value| value.to_str()) != Some("app")
    {
        return Err("launch requires a verified absolute app bundle path");
    }
    Ok(NativeLaunchSpec {
        program: "/usr/bin/open",
        app_path,
    })
}

pub fn command_mapping(
    client_id: ClientId,
    operation: ClientOperation,
    theme_id: Option<&str>,
    apply_and_launch: bool,
) -> Result<CommandSpec, &'static str> {
    let spec = match operation {
        ClientOperation::Apply => {
            let theme_id = theme_id.ok_or("apply requires a theme id")?;
            if !valid_theme_id(theme_id) {
                return Err("theme id may contain only letters, numbers, underscores and hyphens");
            }
            let mut args = vec!["--id".to_string(), theme_id.to_string()];
            if !apply_and_launch {
                args.push("--no-apply".to_string());
            }
            CommandSpec {
                script_name: "switch-theme-macos.sh",
                args,
            }
        }
        ClientOperation::Launch => {
            let _ = client_id;
            return Err("launch is a native bundle operation, not an adapter script");
        }
        ClientOperation::Pause => CommandSpec {
            script_name: "pause-skin-macos.sh",
            args: vec![],
        },
        ClientOperation::Restore => CommandSpec {
            script_name: "restore-skin-macos.sh",
            args: match client_id {
                ClientId::Codex => vec![
                    "--restore-base-theme".to_string(),
                    "--restart-codex".to_string(),
                ],
                ClientId::Workbuddy => vec![],
            },
        },
        ClientOperation::Verify => CommandSpec {
            script_name: "verify-skin-macos.sh",
            args: vec![],
        },
    };
    Ok(spec)
}

pub async fn run_operation(
    app: AppHandle,
    client_id: ClientId,
    operation: ClientOperation,
    theme_id: Option<String>,
    apply_and_launch: bool,
) -> OperationResult {
    let operation_id = format!(
        "{}-{}-{}",
        client_id.as_str(),
        Utc::now().timestamp_millis(),
        OPERATION_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );
    emit_progress(
        &app,
        &operation_id,
        client_id,
        operation,
        "queued",
        "操作已加入本地执行队列",
    );

    let result = tauri::async_runtime::spawn_blocking({
        let operation_id = operation_id.clone();
        let app = app.clone();
        move || {
            let Ok(_client_transaction) = acquire_operation_lock(client_id) else {
                return OperationResult::failed(
                    "client-operation-busy",
                    "该客户端已有操作正在进行，请稍后重试",
                );
            };
            emit_progress(
                &app,
                &operation_id,
                client_id,
                operation,
                "preflight",
                "正在验证客户端、签名和主题适配器",
            );
            let state = discovery::client_state(client_id);
            if !state.discovered {
                return OperationResult::failed("app-not-found", "未找到官方客户端");
            }
            if !matches!(state.signature.status, SignatureState::Verified) {
                return OperationResult::failed(
                    "signature-invalid",
                    "客户端签名或开发团队与官方身份不匹配",
                );
            }
            if let Err((code, message)) = launch_state_admission(operation, state.run_state) {
                return OperationResult::failed(code, message);
            }
            if matches!(operation, ClientOperation::Apply) {
                let capability = match capabilities::capability_for(client_id) {
                    Some(capability) => capability,
                    None => {
                        return OperationResult::failed(
                            "capability-unavailable",
                            "未找到 Adapter 权威能力声明，已按 fail-closed 阻断应用",
                        )
                    }
                };
                if let Err(reason) = apply_admission(&capability) {
                    return OperationResult::failed("capability-unavailable", reason);
                }
            }
            if !matches!(operation, ClientOperation::Launch) && !state.adapter_ready {
                return OperationResult::failed("adapter-unavailable", "客户端适配器不完整");
            }
            if matches!(operation, ClientOperation::Launch) {
                emit_progress(
                    &app,
                    &operation_id,
                    client_id,
                    operation,
                    "running",
                    operation_message(operation),
                );
                let Some(app_path) = discovery::verified_app_path(client_id) else {
                    return OperationResult::failed(
                        "launch-identity-changed",
                        "客户端路径或官方签名在启动前发生变化，请重新扫描",
                    );
                };
                return execute_native_launch(client_id, app_path);
            }
            if matches!(operation, ClientOperation::Apply) {
                let Some(theme_id) = theme_id.as_deref() else {
                    return OperationResult::failed("invalid-request", "应用主题需要主题 id");
                };
                let definition = registry::definition(client_id);
                match compiler::compile_and_seed_theme(&definition, theme_id, &state) {
                    Ok(Some(_)) => {}
                    Ok(None) => {
                        if let Err(error) = ensure_saved_theme(&definition, theme_id) {
                            return OperationResult::failed("theme-seed-failed", error);
                        }
                    }
                    Err(error) => {
                        return OperationResult {
                            status: crate::models::OperationStatus::Failed,
                            code: error.code,
                            message: error.message,
                            details: Some(error.details),
                        };
                    }
                }
            }
            let spec = match command_mapping(
                client_id,
                operation,
                theme_id.as_deref(),
                apply_and_launch,
            ) {
                Ok(spec) => spec,
                Err(message) => return OperationResult::failed("invalid-request", message),
            };
            emit_progress(
                &app,
                &operation_id,
                client_id,
                operation,
                "running",
                operation_message(operation),
            );
            execute_fixed_script(client_id, operation, spec)
        }
    })
    .await
    .unwrap_or_else(|_| OperationResult::failed("operation-join-failed", "本地操作异常结束"));

    let (stage, message) = match result.status {
        crate::models::OperationStatus::Success => ("finished", "操作已完成"),
        crate::models::OperationStatus::Failed => ("failed", "操作未完成，请查看诊断详情"),
    };
    emit_progress(&app, &operation_id, client_id, operation, stage, message);
    result
}

fn execute_native_launch(client_id: ClientId, app_path: PathBuf) -> OperationResult {
    let spec = match native_launch_mapping(app_path) {
        Ok(spec) => spec,
        Err(message) => return OperationResult::failed("launch-unavailable", message),
    };
    let mut command = Command::new(spec.program);
    command.arg(&spec.app_path);
    match run_with_timeout(&mut command, Duration::from_secs(15)) {
        Ok(output) if output.status.success() => {
            let deadline = Instant::now() + Duration::from_secs(5);
            while Instant::now() < deadline {
                if discovery::app_path_is_running(client_id, &spec.app_path) == Some(true) {
                    return OperationResult::success(
                        "launched",
                        "客户端已从已验证的本机路径启动（未注入或切换主题）",
                        json!({ "clientId": client_id, "bundleId": registry::definition(client_id).bundle_id }),
                    );
                }
                thread::sleep(Duration::from_millis(150));
            }
            OperationResult::failed(
                "launch-not-confirmed",
                "已发出启动请求，但未检测到客户端主进程，请重新扫描后重试",
            )
        }
        Ok(_) => OperationResult::failed(
            "launch-failed",
            "无法按官方 Bundle ID 启动客户端，请确认客户端安装完整",
        ),
        Err(_) => OperationResult::failed(
            "launch-failed",
            "无法按官方 Bundle ID 启动客户端，请确认客户端安装完整",
        ),
    }
}

fn execute_fixed_script(
    client_id: ClientId,
    operation: ClientOperation,
    spec: CommandSpec,
) -> OperationResult {
    let definition = registry::definition(client_id);
    let script = match resolve_fixed_script(&definition, spec.script_name) {
        Ok(script) => script,
        Err(message) => return OperationResult::failed("adapter-path-invalid", message),
    };
    let mut command = Command::new("/bin/bash");
    command
        .arg(&script)
        .args(&spec.args)
        .current_dir(registry::adapter_root(&definition))
        .env("PATH", safe_command_path());
    let output = match run_with_timeout(&mut command, operation_timeout(operation)) {
        Ok(output) => output,
        Err(ProcessError::TimedOut) => {
            return OperationResult::failed("adapter-timeout", "主题适配器超过安全执行时限，已停止")
        }
        Err(_) => {
            return OperationResult::failed(
                "adapter-start-failed",
                "无法启动 Adapter Engine，请重新安装或更新该 Adapter",
            )
        }
    };
    adapter_result(client_id, operation, output)
}

fn operation_timeout(operation: ClientOperation) -> Duration {
    match operation {
        ClientOperation::Apply => Duration::from_secs(120),
        ClientOperation::Restore => Duration::from_secs(90),
        ClientOperation::Pause | ClientOperation::Verify => Duration::from_secs(45),
        ClientOperation::Launch => Duration::from_secs(15),
    }
}

fn safe_command_path() -> String {
    const SYSTEM_PATH: &str = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
    let node = std::env::var_os("CC_THEME_NODE").or_else(|| std::env::var_os("NODE"));
    let Some(node) = node.map(PathBuf::from) else {
        return SYSTEM_PATH.to_string();
    };
    let Ok(metadata) = node.symlink_metadata() else {
        return SYSTEM_PATH.to_string();
    };
    if !node.is_absolute() || !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
        return SYSTEM_PATH.to_string();
    }
    let Some(parent) = node.parent() else {
        return SYSTEM_PATH.to_string();
    };
    format!("{}:{SYSTEM_PATH}", parent.display())
}

fn resolve_fixed_script(
    definition: &ClientDefinition,
    expected_name: &'static str,
) -> Result<PathBuf, String> {
    const ALLOWED_SCRIPTS: [&str; 6] = [
        "switch-theme-macos.sh",
        "start-skin-macos.sh",
        "pause-skin-macos.sh",
        "restore-skin-macos.sh",
        "verify-skin-macos.sh",
        "doctor-macos.sh",
    ];
    if !ALLOWED_SCRIPTS.contains(&expected_name) {
        return Err("请求的适配器脚本不在固定白名单内".to_string());
    }
    let adapter_root = registry::adapter_root(definition);
    let canonical_root = adapter_root
        .canonicalize()
        .map_err(|_| "适配器目录不存在".to_string())?;
    let scripts_root = canonical_root.join("scripts");
    let script = scripts_root.join(expected_name);
    let metadata = script
        .symlink_metadata()
        .map_err(|_| format!("适配器脚本缺失：{expected_name}"))?;
    if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
        return Err(format!("适配器脚本不是可信的普通文件：{expected_name}"));
    }
    let canonical_script = script
        .canonicalize()
        .map_err(|_| format!("无法解析适配器脚本：{expected_name}"))?;
    if canonical_script.parent() != Some(scripts_root.as_path()) {
        return Err("适配器脚本路径逃逸了固定 scripts 目录".to_string());
    }
    Ok(canonical_script)
}

fn adapter_result(
    client_id: ClientId,
    operation: ClientOperation,
    output: Output,
) -> OperationResult {
    let stdout = bounded_text(&output.stdout);
    let stderr = bounded_text(&output.stderr);
    let parsed = parse_adapter_output(&stdout);
    let details = json!({
        "clientId": client_id,
        "operation": operation,
        "exitCode": output.status.code(),
        "adapterCode": adapter_public_code(&parsed),
    });
    if output.status.success() {
        OperationResult::success(
            "ok",
            match operation {
                ClientOperation::Apply => "主题已应用",
                ClientOperation::Launch => "客户端已启动并启用主题",
                ClientOperation::Pause => "主题注入已暂停",
                ClientOperation::Restore => "已恢复原生外观",
                ClientOperation::Verify => "主题注入验证通过",
            },
            details,
        )
    } else {
        let raw = format!("{stderr}\n{stdout}");
        OperationResult {
            status: crate::models::OperationStatus::Failed,
            code: classify_failure(operation, &raw).to_string(),
            message: public_failure_message(operation, &raw),
            details: Some(details),
        }
    }
}

fn adapter_public_code(parsed: &Value) -> Option<&str> {
    parsed.get("code").and_then(Value::as_str).filter(|code| {
        !code.is_empty()
            && code.len() <= 80
            && code
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    })
}

fn public_failure_message(operation: ClientOperation, raw: &str) -> String {
    let lower = raw.to_ascii_lowercase();
    if lower.contains("enoent")
        || lower.contains("no such file")
        || lower.contains("ui-surface-catalog")
        || lower.contains("compatibility") && lower.contains("missing")
    {
        "Adapter Engine 缺少必需的兼容文件，请重新安装或更新该 Adapter".to_string()
    } else if lower.contains("signature") || lower.contains("signing team") {
        "客户端签名未通过官方身份校验".to_string()
    } else if lower.contains("permission denied") || lower.contains("eacces") {
        "Adapter Engine 没有完成操作所需的本地权限".to_string()
    } else if lower.contains("cdp")
        || lower.contains("debug port")
        || lower.contains("endpoint")
        || lower.contains("auth")
    {
        "Adapter Engine 当前无法与客户端建立安全连接".to_string()
    } else if lower.contains("theme")
        && (lower.contains("invalid")
            || lower.contains("missing")
            || lower.contains("unsafe")
            || lower.contains("failed validation"))
    {
        "目标主题未通过 Adapter Engine 的二次校验".to_string()
    } else {
        match operation {
            ClientOperation::Apply => "主题应用失败，请运行诊断后重试",
            ClientOperation::Launch => "客户端启动失败，请确认客户端安装完整",
            ClientOperation::Pause => "主题暂停失败，请运行诊断后重试",
            ClientOperation::Restore => "原生外观恢复失败，请运行诊断后重试",
            ClientOperation::Verify => "主题验证未通过，请运行诊断查看状态",
        }
        .to_string()
    }
}

fn parse_adapter_output(text: &str) -> Value {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return json!({});
    }
    if let Ok(value) = serde_json::from_str(trimmed) {
        return value;
    }
    for line in trimmed.lines().rev() {
        if let Ok(value) = serde_json::from_str(line.trim()) {
            return value;
        }
    }
    json!({ "summary": trimmed })
}

fn bounded_text(bytes: &[u8]) -> String {
    const LIMIT: usize = 24 * 1024;
    let start = bytes.len().saturating_sub(LIMIT);
    String::from_utf8_lossy(&bytes[start..]).into_owned()
}

fn classify_failure(operation: ClientOperation, message: &str) -> &'static str {
    let lower = message.to_ascii_lowercase();
    if lower.contains("not found") || lower.contains("could not find") {
        "app-not-found"
    } else if lower.contains("signature") || lower.contains("signing team") {
        "signature-invalid"
    } else if lower.contains("theme")
        && (lower.contains("invalid")
            || lower.contains("missing")
            || lower.contains("unsafe")
            || lower.contains("failed validation"))
    {
        "theme-invalid"
    } else if lower.contains("cdp") || lower.contains("debug port") || lower.contains("endpoint") {
        "transport-unavailable"
    } else {
        match operation {
            ClientOperation::Apply => "apply-failed",
            ClientOperation::Launch => "launch-failed",
            ClientOperation::Pause => "pause-failed",
            ClientOperation::Restore => "restore-failed",
            ClientOperation::Verify => "verify-failed",
        }
    }
}

fn operation_message(operation: ClientOperation) -> &'static str {
    match operation {
        ClientOperation::Apply => "正在校验、暂存并应用主题",
        ClientOperation::Launch => "正在按官方身份启动客户端",
        ClientOperation::Pause => "正在安全移除实时主题",
        ClientOperation::Restore => "正在恢复客户端原生外观",
        ClientOperation::Verify => "正在验证本地 CDP 和主题标记",
    }
}

fn emit_progress(
    app: &AppHandle,
    operation_id: &str,
    client_id: ClientId,
    operation: ClientOperation,
    stage: &str,
    message: &str,
) {
    let _ = app.emit(
        "operation-progress",
        OperationProgress {
            operation_id: operation_id.to_string(),
            client_id,
            operation,
            stage: stage.to_string(),
            message: message.to_string(),
            timestamp: Utc::now().to_rfc3339(),
        },
    );
}

pub fn run_diagnostic_report(client_id: Option<ClientId>) -> OperationResult {
    let ids: Vec<_> = client_id.map_or_else(|| ClientId::ALL.to_vec(), |id| vec![id]);
    let mut checks = Vec::new();
    for id in ids {
        let definition = registry::definition(id);
        let state = discovery::client_state(id);
        checks.push(DiagnosticCheck {
            id: format!("{}-installed", id.as_str()),
            label: format!("{} 客户端", definition.display_name),
            status: if state.discovered { "pass" } else { "fail" }.to_string(),
            detail: state.detail.clone(),
        });
        checks.push(DiagnosticCheck {
            id: format!("{}-signature", id.as_str()),
            label: "官方签名".to_string(),
            status: if matches!(state.signature.status, SignatureState::Verified) {
                "pass"
            } else if state.discovered {
                "fail"
            } else {
                "warn"
            }
            .to_string(),
            detail: state.signature.label.clone(),
        });
        checks.push(adapter_doctor_check(&definition));
    }
    let failures = checks.iter().filter(|check| check.status == "fail").count();
    let warnings = checks.iter().filter(|check| check.status == "warn").count();
    let summary = if failures == 0 && warnings == 0 {
        "全部客户端和主题适配器检查通过".to_string()
    } else {
        format!("诊断完成：{failures} 项失败，{warnings} 项需要注意")
    };
    let report = DiagnosticReport {
        client_id,
        summary: summary.clone(),
        generated_at: Utc::now().to_rfc3339(),
        checks,
    };
    OperationResult::success(
        "diagnostics-complete",
        "诊断完成",
        serde_json::to_value(report).unwrap_or_else(|_| json!({ "summary": summary })),
    )
}

fn adapter_doctor_check(definition: &ClientDefinition) -> DiagnosticCheck {
    let base = DiagnosticCheck {
        id: format!("{}-adapter", definition.id.as_str()),
        label: "主题适配器".to_string(),
        status: "fail".to_string(),
        detail: "主题适配器诊断未运行".to_string(),
    };
    let script = match resolve_fixed_script(definition, "doctor-macos.sh") {
        Ok(script) => script,
        Err(error) => {
            return DiagnosticCheck {
                detail: error,
                ..base
            }
        }
    };
    if let Some(check) = packaged_adapter_check(definition) {
        return check;
    }
    let mut command = Command::new("/bin/bash");
    command
        .arg(script)
        .current_dir(registry::adapter_root(definition))
        .env("PATH", safe_command_path());
    let output = match run_with_timeout(&mut command, Duration::from_secs(45)) {
        Ok(output) => output,
        Err(ProcessError::TimedOut) => {
            return DiagnosticCheck {
                detail: "适配器诊断超过 45 秒执行时限，已停止".to_string(),
                ..base
            }
        }
        Err(_) => {
            return DiagnosticCheck {
                detail: "无法启动适配器诊断，请重新安装或更新该 Adapter".to_string(),
                ..base
            }
        }
    };
    let stdout = bounded_text(&output.stdout);
    let stderr = bounded_text(&output.stderr);
    let parsed = parse_adapter_output(&stdout);
    let detail = diagnostic_summary(&parsed, &stdout, &stderr);
    DiagnosticCheck {
        status: if output.status.success() {
            "pass"
        } else {
            "fail"
        }
        .to_string(),
        detail,
        ..base
    }
}

fn packaged_adapter_check(definition: &ClientDefinition) -> Option<DiagnosticCheck> {
    std::env::var_os("CC_THEME_BUNDLED_ADAPTERS_ROOT").filter(|value| !value.is_empty())?;
    let adapter_root = registry::adapter_root(definition);
    if adapter_root.join("presets").is_dir() {
        return Some(DiagnosticCheck {
            id: format!("{}-adapter", definition.id.as_str()),
            label: "主题适配器".to_string(),
            status: "fail".to_string(),
            detail: "Adapter Engine 发布包错误地包含生产预制主题，请重新安装安全版本".to_string(),
        });
    }
    let capability_ready = capabilities::capability_for(definition.id).is_some();
    let compatibility_ready = trusted_directory(&adapter_root.join("compatibility"));
    let contracts_ready = trusted_directory(&adapter_root.join("contracts"));
    let scripts_ready = trusted_directory(&adapter_root.join("scripts"));
    let ready = capability_ready && compatibility_ready && contracts_ready && scripts_ready;
    Some(DiagnosticCheck {
        id: format!("{}-adapter", definition.id.as_str()),
        label: "主题适配器".to_string(),
        status: if ready { "pass" } else { "fail" }.to_string(),
        detail: if ready {
            "Adapter Engine、Capability、契约与兼容目录已就绪；生产主题由独立主题资源层按需提供"
                .to_string()
        } else {
            "Adapter Engine 安装包不完整，请重新安装或更新该 Adapter".to_string()
        },
    })
}

fn trusted_directory(path: &std::path::Path) -> bool {
    path.symlink_metadata()
        .is_ok_and(|metadata| metadata.file_type().is_dir() && !metadata.file_type().is_symlink())
}

fn diagnostic_summary(parsed: &Value, stdout: &str, stderr: &str) -> String {
    if let Some(code) = adapter_public_code(parsed) {
        return format!("适配器诊断结果：{code}");
    }
    if stderr.trim().is_empty() && stdout.trim().is_empty() {
        "适配器诊断已完成".to_string()
    } else {
        "适配器诊断未通过，请重新安装或更新该 Adapter".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_mapping_is_a_closed_allowlist() {
        let apply = command_mapping(
            ClientId::Codex,
            ClientOperation::Apply,
            Some("neutral-fixture"),
            false,
        )
        .unwrap();
        assert_eq!(apply.script_name, "switch-theme-macos.sh");
        assert_eq!(apply.args, ["--id", "neutral-fixture", "--no-apply"]);
        assert!(apply.args.iter().all(|argument| !argument.starts_with('/')));
        let live_apply = command_mapping(
            ClientId::Codex,
            ClientOperation::Apply,
            Some("neutral-fixture"),
            true,
        )
        .unwrap();
        assert_eq!(live_apply.script_name, "switch-theme-macos.sh");
        assert_eq!(live_apply.args, ["--id", "neutral-fixture"]);
        let codex_restore =
            command_mapping(ClientId::Codex, ClientOperation::Restore, None, true).unwrap();
        assert_eq!(codex_restore.script_name, "restore-skin-macos.sh");
        assert_eq!(
            codex_restore.args,
            ["--restore-base-theme", "--restart-codex"]
        );
        let workbuddy_restore =
            command_mapping(ClientId::Workbuddy, ClientOperation::Restore, None, true).unwrap();
        assert!(workbuddy_restore.args.is_empty());
    }

    #[test]
    fn launch_uses_only_the_fixed_native_bundle_identity() {
        for id in ClientId::ALL {
            let path = PathBuf::from("/Applications").join(registry::definition(id).app_filename);
            let spec = native_launch_mapping(path.clone()).expect("verified app path is accepted");
            assert_eq!(spec.program, "/usr/bin/open");
            assert_eq!(spec.app_path, path);
            assert!(command_mapping(id, ClientOperation::Launch, None, true).is_err());
        }
        assert!(native_launch_mapping(PathBuf::from("relative/Fake.app")).is_err());
        assert!(native_launch_mapping(PathBuf::from("/Applications/Fake.txt")).is_err());
    }

    #[test]
    fn unsafe_theme_id_never_reaches_an_argument() {
        assert!(command_mapping(
            ClientId::Workbuddy,
            ClientOperation::Apply,
            Some("../../escape"),
            true,
        )
        .is_err());
    }

    #[test]
    fn adapter_output_accepts_json_and_text() {
        assert_eq!(parse_adapter_output("{\"code\":\"ok\"}")["code"], "ok");
        assert_eq!(
            parse_adapter_output("line one\nline two")["summary"],
            "line one\nline two"
        );
    }

    #[test]
    fn adapter_failures_never_expose_local_paths_or_raw_stacks() {
        let raw = "Error: ENOENT: no such file or directory, open '/Users/example/Private/adapter.json'\n    at Object.openSync (/Applications/CC Theme.app/Contents/Resources/runtime/node/index.js:42:1)";
        let message = public_failure_message(ClientOperation::Apply, raw);
        assert!(!message.contains("/Users/"));
        assert!(!message.contains("/Applications/"));
        assert!(!message.contains("openSync"));
        assert_eq!(
            message,
            "Adapter Engine 缺少必需的兼容文件，请重新安装或更新该 Adapter"
        );
    }

    #[test]
    fn diagnostic_fallback_never_replays_untrusted_process_output() {
        let raw = "Error at /Users/example/private/doctor.js:10\nsecret-stack";
        let detail = diagnostic_summary(&json!({}), "", raw);
        assert_eq!(detail, "适配器诊断未通过，请重新安装或更新该 Adapter");
        assert!(!detail.contains("/Users/"));
        assert!(!detail.contains("secret-stack"));
    }

    #[test]
    fn fixed_script_names_cannot_be_replaced_by_a_path() {
        let definition = registry::definition(ClientId::Codex);
        let error = resolve_fixed_script(&definition, "../../evil.sh").unwrap_err();
        assert!(error.contains("白名单"));
    }

    #[test]
    fn operation_locks_serialize_each_client_without_blocking_other_clients() {
        let codex_guard = operation_lock(ClientId::Codex).lock().unwrap();
        assert!(acquire_operation_lock(ClientId::Codex).is_err());
        assert!(acquire_operation_lock(ClientId::Workbuddy).is_ok());
        drop(codex_guard);
        assert!(acquire_operation_lock(ClientId::Codex).is_ok());
    }

    #[test]
    fn apply_admission_is_fail_closed_when_capability_denies_runtime_apply() {
        let mut capability = crate::capabilities::load_capabilities_or_fallback()
            .into_iter()
            .find(|item| ClientId::from_adapter_id(&item.adapter_id) == Some(ClientId::Codex))
            .expect("Codex capability remains discoverable");
        capability.runtime_apply_available = false;
        assert!(apply_admission(&capability).is_err());
        capability.availability = crate::models::CapabilityAvailability::Available;
        capability.runtime_apply_available = true;
        assert!(apply_admission(&capability).is_ok());
    }

    #[test]
    fn launch_and_apply_require_a_proven_stopped_client() {
        for operation in [ClientOperation::Apply, ClientOperation::Launch] {
            assert!(launch_state_admission(operation, ClientRunState::Stopped).is_ok());
            assert_eq!(
                launch_state_admission(operation, ClientRunState::Running)
                    .unwrap_err()
                    .0,
                "client-already-running"
            );
            assert_eq!(
                launch_state_admission(operation, ClientRunState::Unknown)
                    .unwrap_err()
                    .0,
                "client-runtime-state-unavailable"
            );
        }
        assert!(launch_state_admission(ClientOperation::Restore, ClientRunState::Unknown).is_ok());
    }
}
