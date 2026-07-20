mod adapter_catalog;
mod adapter_installer;
mod capabilities;
mod compiler;
mod discovery;
mod models;
mod operations;
mod process;
mod registry;
mod themes;

use chrono::Utc;
use models::{ClientId, ClientOperation, DashboardState, OperationResult};
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};

const MANAGER_CLOSE_REQUESTED_EVENT: &str = "manager-close-requested";
const TRAY_ID: &str = "cc-theme-menu-bar";
const TRAY_OPEN_ID: &str = "open-manager";
const TRAY_QUIT_ID: &str = "quit-manager";
static QUITTING: AtomicBool = AtomicBool::new(false);

fn show_manager_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn install_menu_bar_item(app: &mut tauri::App) -> tauri::Result<()> {
    let (open_label, quit_label) = menu_bar_labels("zh-CN");
    let open = MenuItem::with_id(app, TRAY_OPEN_ID, open_label, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, TRAY_QUIT_ID, quit_label, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let menu_bar_icon =
        tauri::image::Image::from_bytes(include_bytes!("../icons/menu-bar-icon.png"))?;
    TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .icon(menu_bar_icon)
        .show_menu_on_left_click(true)
        .tooltip("CC Theme")
        .icon_as_template(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            TRAY_OPEN_ID => show_manager_window(app),
            TRAY_QUIT_ID => {
                QUITTING.store(true, Ordering::SeqCst);
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;
    Ok(())
}

fn menu_bar_labels(locale: &str) -> (&'static str, &'static str) {
    match locale {
        "en-US" => ("Open Window", "Quit"),
        _ => ("打开窗口", "退出"),
    }
}

#[tauri::command]
fn set_manager_locale(app: AppHandle, locale: String) -> Result<(), String> {
    if locale != "zh-CN" && locale != "en-US" {
        return Err("unsupported-manager-locale".to_string());
    }
    let (open_label, quit_label) = menu_bar_labels(&locale);
    let open = MenuItem::with_id(&app, TRAY_OPEN_ID, open_label, true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let quit = MenuItem::with_id(&app, TRAY_QUIT_ID, quit_label, true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let menu = Menu::with_items(&app, &[&open, &quit]).map_err(|error| error.to_string())?;
    app.tray_by_id(TRAY_ID)
        .ok_or_else(|| "menu-bar-item-unavailable".to_string())?
        .set_menu(Some(menu))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn minimize_to_menu_bar(app: AppHandle) -> Result<(), String> {
    app.get_webview_window("main")
        .ok_or_else(|| "找不到主窗口".to_string())?
        .hide()
        .map_err(|error| format!("无法最小化到菜单栏：{error}"))
}

#[tauri::command]
fn quit_manager(app: AppHandle) {
    QUITTING.store(true, Ordering::SeqCst);
    app.exit(0);
}

#[tauri::command]
async fn get_dashboard_state() -> DashboardState {
    tauri::async_runtime::spawn_blocking(|| DashboardState {
        capabilities: capabilities::load_capabilities_or_fallback(),
        clients: discovery::all_client_states(),
        themes: themes::list_theme_families(),
        activities: vec![],
        last_refreshed_at: Utc::now().to_rfc3339(),
    })
    .await
    .unwrap_or_else(|_| DashboardState {
        capabilities: capabilities::load_capabilities_or_fallback(),
        clients: vec![],
        themes: vec![],
        activities: vec![],
        last_refreshed_at: Utc::now().to_rfc3339(),
    })
}

#[tauri::command]
async fn get_client_runtime_states() -> Vec<models::ClientRuntimeState> {
    tauri::async_runtime::spawn_blocking(discovery::all_client_runtime_states)
        .await
        .unwrap_or_default()
}

#[tauri::command(rename_all = "camelCase")]
async fn refresh_client(client_id: ClientId) -> OperationResult {
    match tauri::async_runtime::spawn_blocking(move || discovery::client_state(client_id)).await {
        Ok(state) => OperationResult::success(
            "refreshed",
            "客户端状态已刷新",
            serde_json::to_value(state).unwrap_or_else(|_| json!({})),
        ),
        Err(error) => {
            OperationResult::failed("refresh-failed", format!("刷新客户端状态失败：{error}"))
        }
    }
}

#[tauri::command(rename_all = "camelCase")]
async fn apply_theme(
    app: AppHandle,
    client_id: ClientId,
    theme_id: String,
    launch: bool,
) -> OperationResult {
    operations::run_operation(
        app,
        client_id,
        ClientOperation::Apply,
        Some(theme_id),
        launch,
    )
    .await
}

#[tauri::command(rename_all = "camelCase")]
async fn launch_client(app: AppHandle, client_id: ClientId) -> OperationResult {
    operations::run_operation(app, client_id, ClientOperation::Launch, None, true).await
}

#[tauri::command(rename_all = "camelCase")]
async fn pause_theme(app: AppHandle, client_id: ClientId) -> OperationResult {
    operations::run_operation(app, client_id, ClientOperation::Pause, None, true).await
}

#[tauri::command(rename_all = "camelCase")]
async fn restore_theme(app: AppHandle, client_id: ClientId) -> OperationResult {
    operations::run_operation(app, client_id, ClientOperation::Restore, None, true).await
}

#[tauri::command(rename_all = "camelCase")]
async fn run_diagnostics(client_id: Option<ClientId>) -> OperationResult {
    tauri::async_runtime::spawn_blocking(move || operations::run_diagnostic_report(client_id))
        .await
        .unwrap_or_else(|error| {
            OperationResult::failed("diagnostics-failed", format!("诊断异常结束：{error}"))
        })
}

#[tauri::command(rename_all = "camelCase")]
async fn import_theme_package(package_path: String) -> OperationResult {
    tauri::async_runtime::spawn_blocking(move || {
        match themes::import_theme_package(std::path::Path::new(&package_path)) {
            Ok(theme_id) => OperationResult::success(
                "theme-imported",
                "主题包已安全导入",
                json!({ "themeId": theme_id }),
            ),
            Err(error) => {
                let code = if error.starts_with("theme-package-") {
                    error.as_str()
                } else {
                    "theme-package-import-failed"
                };
                OperationResult::failed(code, "主题包未通过安全校验或已经安装")
            }
        }
    })
    .await
    .unwrap_or_else(|_| {
        OperationResult::failed("theme-package-import-failed", "主题包导入异常结束")
    })
}

#[tauri::command(rename_all = "camelCase")]
async fn install_local_adapter(client_id: ClientId, package_path: String) -> OperationResult {
    tauri::async_runtime::spawn_blocking(move || {
        let client = discovery::client_state(client_id);
        if !client.discovered {
            return OperationResult::failed(
                "adapter-host-not-installed",
                "请先安装对应的桌面客户端",
            );
        }
        match adapter_installer::install_adapter_package(
            std::path::Path::new(&package_path),
            client_id.as_str(),
            client.version.as_deref(),
        ) {
            Ok(receipt) => OperationResult::success(
                "adapter-installed",
                "Adapter 已完成校验并安全安装",
                serde_json::to_value(receipt).unwrap_or_else(|_| json!({})),
            ),
            Err(code) => {
                OperationResult::failed(code, "Adapter 包不兼容、已损坏，或未通过安全校验")
            }
        }
    })
    .await
    .unwrap_or_else(|_| OperationResult::failed("adapter-install-failed", "Adapter 安装异常结束"))
}

#[tauri::command(rename_all = "camelCase")]
async fn check_adapter_updates(force: bool) -> OperationResult {
    tauri::async_runtime::spawn_blocking(move || {
        match adapter_catalog::check_adapter_updates(force) {
            Ok(status) => OperationResult::success(
                "adapter-catalog-ready",
                "已通过官方签名清单检查 Adapter",
                serde_json::to_value(status).unwrap_or_else(|_| json!({})),
            ),
            Err(code) => OperationResult::failed(code, "暂时无法获取可信的 Adapter 版本清单"),
        }
    })
    .await
    .unwrap_or_else(|_| {
        OperationResult::failed("adapter-catalog-check-failed", "Adapter 版本检查异常结束")
    })
}

#[tauri::command(rename_all = "camelCase")]
async fn download_latest_adapter(client_id: ClientId) -> OperationResult {
    tauri::async_runtime::spawn_blocking(move || {
        let client = discovery::client_state(client_id);
        if !client.discovered {
            return OperationResult::failed(
                "adapter-host-not-installed",
                "请先安装对应的桌面客户端",
            );
        }
        match adapter_catalog::download_and_install_latest_adapter(
            client_id,
            client.version.as_deref(),
        ) {
            Ok(receipt) => OperationResult::success(
                "adapter-downloaded-installed",
                "已从官方签名清单下载并安全安装 Adapter",
                serde_json::to_value(receipt).unwrap_or_else(|_| json!({})),
            ),
            Err(code) => OperationResult::failed(
                code,
                "Adapter 下载、校验或安装未完成；现有 Adapter 保持不变",
            ),
        }
    })
    .await
    .unwrap_or_else(|_| {
        OperationResult::failed("adapter-download-failed", "Adapter 下载任务异常结束")
    })
}

#[tauri::command(rename_all = "camelCase")]
async fn delete_local_theme(app: AppHandle, theme_id: String) -> OperationResult {
    if !themes::valid_theme_id(&theme_id) {
        return OperationResult::failed("theme-delete-id-invalid", "主题标识不符合安全规则");
    }
    for client_id in ClientId::ALL {
        let state = discovery::client_state(client_id);
        if state.current_theme_id.as_deref() != Some(theme_id.as_str()) {
            continue;
        }
        let result =
            operations::run_operation(app.clone(), client_id, ClientOperation::Restore, None, true)
                .await;
        if matches!(result.status, models::OperationStatus::Failed) {
            return OperationResult::failed(
                "theme-delete-restore-failed",
                format!(
                    "{} 仍在使用该主题，恢复原生外观失败，已取消删除",
                    state.name
                ),
            );
        }
    }
    tauri::async_runtime::spawn_blocking(move || themes::delete_theme_family(&theme_id))
        .await
        .map_or_else(
            |_| OperationResult::failed("theme-delete-failed", "主题删除任务异常结束"),
            |result| match result {
                Ok(removed_entries) => OperationResult::success(
                    "theme-deleted",
                    "本地主题及其关联数据已删除",
                    json!({ "removedEntries": removed_entries }),
                ),
                Err(code) => OperationResult::failed(code, "无法完整删除本地主题，未继续操作"),
            },
        )
}

pub fn run() {
    tauri::Builder::default()
        .register_uri_scheme_protocol("cc-theme-preview", |_context, request| {
            let theme_id = request.uri().path().strip_prefix('/').unwrap_or_default();
            match themes::load_theme_preview(theme_id) {
                Some((content_type, bytes)) => tauri::http::Response::builder()
                    .status(tauri::http::StatusCode::OK)
                    .header(tauri::http::header::CONTENT_TYPE, content_type)
                    .header(
                        tauri::http::header::CACHE_CONTROL,
                        "private, max-age=31536000, immutable",
                    )
                    .header("X-Content-Type-Options", "nosniff")
                    .body(bytes)
                    .expect("valid theme preview response"),
                None => tauri::http::Response::builder()
                    .status(tauri::http::StatusCode::NOT_FOUND)
                    .header(
                        tauri::http::header::CONTENT_TYPE,
                        "text/plain; charset=utf-8",
                    )
                    .header(tauri::http::header::CACHE_CONTROL, "no-store")
                    .body(Vec::new())
                    .expect("valid missing theme preview response"),
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            install_menu_bar_item(app)?;
            if let Some(window) = app.get_webview_window("main") {
                let close_event_window = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        if !QUITTING.load(Ordering::SeqCst) {
                            api.prevent_close();
                            let _ = close_event_window.emit(MANAGER_CLOSE_REQUESTED_EVENT, ());
                        }
                    }
                });
            }
            if let Ok(resource_dir) = app.path().resource_dir() {
                let bundled_node = resource_dir.join("runtime/node/bin/node");
                if bundled_node.is_file() {
                    if std::env::var_os("CC_THEME_NODE").is_none() {
                        std::env::set_var("CC_THEME_NODE", &bundled_node);
                    }
                    if std::env::var_os("NODE").is_none() {
                        std::env::set_var("NODE", &bundled_node);
                    }
                }
                let adapters = resource_dir.join("adapters");
                if adapters.is_dir() {
                    std::env::set_var("CC_THEME_BUNDLED_ADAPTERS_ROOT", adapters);
                    std::env::set_var("CC_THEME_ENABLE_LOCAL_ADAPTERS", "1");
                }
                let capability_root = resource_dir.join("capabilities");
                if capability_root.join("registry.json").is_file() {
                    std::env::set_var("CC_THEME_CAPABILITY_ROOT", capability_root);
                    std::env::set_var(
                        "CC_THEME_CAPABILITY_SOURCE_ROOT",
                        resource_dir.join("adapters"),
                    );
                }
                let themes = resource_dir.join("themes");
                if themes.is_dir() {
                    std::env::set_var("CC_THEME_BUNDLED_THEMES_ROOT", themes);
                }
                let compiler = resource_dir.join("theme-core");
                if compiler.join("cli.mjs").is_file() {
                    std::env::set_var("CC_THEME_COMPILER_ROOT", compiler);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_dashboard_state,
            get_client_runtime_states,
            refresh_client,
            apply_theme,
            launch_client,
            pause_theme,
            restore_theme,
            run_diagnostics,
            import_theme_package,
            install_local_adapter,
            check_adapter_updates,
            download_latest_adapter,
            delete_local_theme,
            set_manager_locale,
            minimize_to_menu_bar,
            quit_manager
        ])
        .build(tauri::generate_context!())
        .expect("failed to build CC Theme")
        .run(|app, event| {
            if let tauri::RunEvent::Reopen { .. } = event {
                show_manager_window(app);
            }
        });
}

#[cfg(test)]
mod locale_tests {
    use super::menu_bar_labels;

    #[test]
    fn menu_bar_labels_follow_the_manager_locale() {
        assert_eq!(menu_bar_labels("zh-CN"), ("打开窗口", "退出"));
        assert_eq!(menu_bar_labels("en-US"), ("Open Window", "Quit"));
        assert_eq!(menu_bar_labels("unsupported"), ("打开窗口", "退出"));
    }
}
