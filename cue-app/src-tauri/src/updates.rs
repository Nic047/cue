//! Check periodically and install signed updates only after an explicit click.
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem},
    AppHandle, Emitter, Manager,
};
use tauri_plugin_updater::UpdaterExt;

static INSTALLING: AtomicBool = AtomicBool::new(false);

pub struct UpdateState {
    available: Mutex<Option<String>>,
    menu: Mutex<(Menu<tauri::Wry>, MenuItem<tauri::Wry>)>,
}

impl UpdateState {
    fn new(menu: Menu<tauri::Wry>, menu_item: MenuItem<tauri::Wry>) -> Self {
        Self {
            available: Mutex::new(None),
            menu: Mutex::new((menu, menu_item)),
        }
    }
}

pub fn is_installing() -> bool {
    INSTALLING.load(Ordering::SeqCst)
}

struct InstallGuard;
impl Drop for InstallGuard {
    fn drop(&mut self) {
        INSTALLING.store(false, Ordering::SeqCst);
    }
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    available: bool,
}

async fn check_update(app: AppHandle) -> Result<Option<String>, String> {
    let update = app
        .updater_builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    Ok(update.map(|update| update.version.clone()))
}

fn available_version(app: &AppHandle) -> Option<String> {
    app.state::<UpdateState>().available.lock().unwrap().clone()
}

fn status(app: &AppHandle) -> UpdateStatus {
    let version = available_version(app);
    UpdateStatus {
        available: version.is_some(),
    }
}

fn publish_status(app: &AppHandle, version: Option<String>) {
    let state = app.state::<UpdateState>();
    *state.available.lock().unwrap() = version.clone();
    refresh_menu(app);
    let _ = app.emit(
        "update-status",
        UpdateStatus {
            available: version.is_some(),
        },
    );
}

pub fn initialize(app: &AppHandle, menu: Menu<tauri::Wry>, menu_item: MenuItem<tauri::Wry>) {
    app.manage(UpdateState::new(menu, menu_item));
}

pub fn replace_menu_item(app: &AppHandle, menu: Menu<tauri::Wry>, menu_item: MenuItem<tauri::Wry>) {
    *app.state::<UpdateState>().menu.lock().unwrap() = (menu, menu_item);
    refresh_menu(app);
}

fn refresh_menu(app: &AppHandle) {
    let available = available_version(app).is_some();
    let state = app.state::<UpdateState>();
    // Native menu calls dispatch to the main thread; release the lock before them.
    let (menu, item) = state.menu.lock().unwrap().clone();
    let present = menu.get("updates").is_some();
    let result = if available && !present {
        menu.insert(&item, 1)
    } else if !available && present {
        menu.remove(&item)
    } else {
        Ok(())
    };
    if let Err(error) = result {
        eprintln!("[cue] Update menu: {error}");
    }
}

pub fn monitor(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            if let Ok(version) = check_update(app.clone()).await {
                publish_status(&app, version);
            }
            tokio::time::sleep(Duration::from_secs(6 * 60 * 60)).await;
        }
    });
}

#[tauri::command]
pub fn get_update_status(app: AppHandle) -> UpdateStatus {
    status(&app)
}

#[tauri::command]
pub async fn update_action(app: AppHandle) -> Result<(), String> {
    if let Some(version) = available_version(&app) {
        install_update(app, version).await
    } else {
        let version = check_update(app.clone()).await?;
        publish_status(&app, version);
        Ok(())
    }
}

pub async fn menu_action(app: AppHandle) -> Result<(), String> {
    if let Some(version) = available_version(&app) {
        let item = app.state::<UpdateState>().menu.lock().unwrap().1.clone();
        let _ = item.set_text("Installing update…");
        match install_update(app.clone(), version).await {
            Ok(()) => Ok(()),
            Err(error) => {
                let _ = item.set_text("One update available");
                Err(error)
            }
        }
    } else {
        Ok(())
    }
}

async fn install_update(app: AppHandle, version: String) -> Result<(), String> {
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
