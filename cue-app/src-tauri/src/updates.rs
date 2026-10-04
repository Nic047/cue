//! Signed updates are explicit and never interrupt an active task.
use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

static INSTALLING: AtomicBool = AtomicBool::new(false);
pub fn is_installing() -> bool {
    INSTALLING.load(Ordering::SeqCst)
}
struct InstallGuard;
impl Drop for InstallGuard {
    fn drop(&mut self) {
        INSTALLING.store(false, Ordering::SeqCst);
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    current_version: String,
    pub version: Option<String>,
    notes: Option<String>,
}

#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<UpdateInfo, String> {
    let update = app
        .updater_builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    Ok(UpdateInfo {
        current_version: app.package_info().version.to_string(),
        version: update.as_ref().map(|u| u.version.clone()),
        notes: update.and_then(|u| u.body),
    })
}

#[tauri::command]
pub async fn install_update(app: AppHandle, version: String) -> Result<(), String> {
    if INSTALLING.swap(true, Ordering::SeqCst) {
        return Err("An update is already installing.".into());
    }
    let _guard = InstallGuard;
    if app
        .state::<crate::orchestrator_bridge::OrchestratorState>()
        .child
        .lock()
        .unwrap()
        .is_some()
    {
        return Err("Finish or cancel your current task before updating.".into());
    }
    let update = app
        .updater_builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or("No update is available.")?;
    if update.version != version {
        return Err("A newer release appeared. Check for updates again.".into());
    }
    let was_enabled = crate::global_shortcut::is_enabled();
    crate::global_shortcut::set_enabled(false);
    crate::native_audio::cancel_audio_recording(app.state::<crate::native_audio::NativeAudio>());
    crate::media_control::resume_media_after_listening(
        app.state::<crate::media_control::MediaControl>(),
    );
    let handle = app.clone();
    let mut downloaded = 0u64;
    let result = update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = handle.emit(
                    "update-progress",
                    serde_json::json!({"downloaded": downloaded, "total": total}),
                );
            },
            || {},
        )
        .await;
    crate::global_shortcut::set_enabled(was_enabled);
    result.map_err(|e| e.to_string())?;
    app.restart();
}

#[tauri::command]
pub fn open_updates(app: AppHandle) -> Result<(), String> {
    open(&app)
}

pub fn open(app: &AppHandle) -> Result<(), String> {
    let _ = app.emit_to("main", "dismiss-panels", ());
    if let Some(win) = app.get_webview_window("updates") {
        win.show().map_err(|e| e.to_string())?;
        return win.set_focus().map_err(|e| e.to_string());
    }
    tauri::WebviewWindowBuilder::new(
        app,
        "updates",
        tauri::WebviewUrl::App("index.html?updates".into()),
    )
    .title("cue updates")
    .inner_size(480., 360.)
    .center()
    .resizable(false)
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}
