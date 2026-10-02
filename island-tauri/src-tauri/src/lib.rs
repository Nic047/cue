// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::{Emitter, Manager};
mod global_shortcut;
mod media_control;
mod native_audio;
mod onboarding;
mod orchestrator_bridge;
use orchestrator_bridge::OrchestratorState;

/// Frontend-Logs ins Terminal durchreichen (Webview-Console ist unsichtbar).
#[tauri::command]
fn log_line(line: String) {
    println!("{}", line);
}

// Keep the advisory lock open for the app lifetime; macOS releases it after a crash too.
#[cfg(target_os = "macos")]
fn acquire_instance_lock(app: &tauri::AppHandle) -> std::io::Result<Option<std::fs::File>> {
    use std::os::fd::AsRawFd;
    let directory = app.path().app_data_dir().map_err(std::io::Error::other)?;
    std::fs::create_dir_all(&directory)?;
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(directory.join("instance.lock"))?;
    if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == 0 {
        return Ok(Some(lock));
    }
    let error = std::io::Error::last_os_error();
    if error.kind() == std::io::ErrorKind::WouldBlock {
        Ok(None)
    } else {
        Err(error)
    }
}

fn build_tray_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;
    let recent = MenuItem::with_id(app, "recent-chats", "Recent Chats…", true, None::<&str>)?;
    menu.append(&recent)?;
    menu.append(&MenuItem::with_id(
        app,
        "settings",
        "Settings…",
        true,
        None::<&str>,
    )?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    let toggle = MenuItem::with_id(app, "toggle", "Toggle Cue", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Cue", true, None::<&str>)?;
    menu.append(&MenuItem::with_id(
        app,
        "show-onboarding",
        "Show onboarding…",
        true,
        None::<&str>,
    )?)?;
    menu.append(&toggle)?;
    #[cfg(all(debug_assertions, target_os = "macos"))]
    menu.append(&tauri::menu::CheckMenuItem::with_id(
        app,
        "simulate-notch",
        "Debug: Simulate notch",
        true,
        false,
        None::<&str>,
    )?)?;
    menu.append(&quit)?;
    Ok(menu)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_nspanel::init())
        .invoke_handler(tauri::generate_handler![
            onboarding::onboarding_status,
            onboarding::dismiss_setup,
            onboarding::restart_for_permissions,
            onboarding::get_customization,
            global_shortcut::capture_shortcut,
            onboarding::save_customization,
            onboarding::request_onboarding_permission,
            onboarding::validate_credential,
            onboarding::save_credential,
            onboarding::transcribe_recording,
            onboarding::set_onboarding_ready,
            onboarding::finish_onboarding,
            native_audio::audio_inputs,
            native_audio::select_audio_input,
            native_audio::start_mic_check,
            native_audio::microphone_level,
            native_audio::stop_mic_check,
            log_line,
            orchestrator_bridge::run_task,
            orchestrator_bridge::open_export,
            orchestrator_bridge::kill_task,
            orchestrator_bridge::get_notch_layout,
            orchestrator_bridge::resize_window,
            orchestrator_bridge::morph_window,
            orchestrator_bridge::hide_window,
            orchestrator_bridge::show_window,
            orchestrator_bridge::answer_question,
            native_audio::start_audio_recording,
            native_audio::stop_audio_recording,
            native_audio::cancel_audio_recording,
            media_control::pause_media_for_listening,
            media_control::resume_media_after_listening,
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            match acquire_instance_lock(app.handle())? {
                Some(lock) => {
                    app.manage(lock);
                }
                None => {
                    app.handle().exit(0);
                    return Ok(());
                }
            }
            // Menueleisten-App: kein Dock-Icon (Agent). Die Pill laeuft
            // als NSPanel weiter und kuemmert sich nicht um Aktivierung.
            #[cfg(target_os = "macos")]
            let _ = app
                .handle()
                .set_activation_policy(tauri::ActivationPolicy::Accessory);

            app.manage(OrchestratorState {
                child: std::sync::Mutex::new(None),
                stdin: std::sync::Mutex::new(None),
            });
            let mut prefs = onboarding::load_preferences(app.handle());
            if !cfg!(debug_assertions) && !prefs.installed_setup_complete {
                prefs.complete = false;
            }
            global_shortcut::set_shortcut(&prefs.shortcut);
            let complete = prefs.complete && onboarding::has_keys();
            app.manage(native_audio::NativeAudio::with_device(
                prefs.microphone.clone(),
            ));
            app.manage(onboarding::OnboardingState(std::sync::Mutex::new(prefs)));
            global_shortcut::set_enabled(complete);
            app.manage(media_control::MediaControl::default());

            // Globalen Hotkey (rechte Option-Taste) installieren – der
            // Shortcut toggle im Frontend den Listen/Transcribe-Loop.
            global_shortcut::install(app.handle().clone());

            let Some(window) = app.get_webview_window("main") else {
                return Ok(());
            };

            #[cfg(target_os = "macos")]
            {
                #[allow(deprecated)]
                use tauri_nspanel::cocoa::appkit::NSWindowCollectionBehavior;
                use tauri_nspanel::WebviewWindowExt;

                // NSWindow -> NSPanel: Standard-NSWindows koennen sich per
                // macOS-Design NICHT ueber native Fullscreen-Apps legen.
                // NSPanels schon – genau dafuer existieren sie.
                let panel = window.to_panel()?;

                // Nonactivating (1 << 7): die Pill klaut nie den Fokus.
                const NS_WINDOW_STYLE_MASK_NONACTIVATING_PANEL: i32 = 1 << 7;
                panel.set_style_mask(NS_WINDOW_STYLE_MASK_NONACTIVATING_PANEL);
                panel.set_floating_panel(true);

                // Beim App-/Window-Wechsel sichtbar bleiben: NSPanels
                // verstecken sich sonst, sobald die App deaktiviert wird.
                panel.set_hides_on_deactivate(false);

                // Auf allen Spaces + ueber Fullscreen-Apps + stationaer.
                // N.B.: tauri-nspanel 2.0.1 nimmt hier den cocoa-Typ — der ist
                // deprecated (objc2-app-kit waere neu), aber ein objc2-Wert
                // passt nicht in set_collection_behaviour. Warnung ok.
                #[allow(deprecated)]
                panel.set_collection_behaviour(
                    NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces
                        | NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary
                        | NSWindowCollectionBehavior::NSWindowCollectionBehaviorStationary,
                );

                // Screen-Saver-Level (1000): ueber Menuebar, Dock und
                // Fullscreen-Apps. Als Panel ueberlebt es den Fullscreen-Space.
                panel.set_level(1000);

                // Sicherstellen, dass es tatsaechlich gerendert wird.
                panel.order_front_regardless();
            }

            // Use the same safe-area anchor for startup, resizing, and display changes.
            let width = window.outer_size()?.width as f64 / window.scale_factor()?;
            orchestrator_bridge::pin_top_center(&window, width)?;
            let display_window = window.clone();
            window.on_window_event(move |event| {
                if matches!(
                    event,
                    tauri::WindowEvent::ScaleFactorChanged { .. } | tauri::WindowEvent::Moved(_)
                ) {
                    if let (Ok(size), Ok(scale)) =
                        (display_window.outer_size(), display_window.scale_factor())
                    {
                        let _ = orchestrator_bridge::pin_top_center(
                            &display_window,
                            size.width as f64 / scale,
                        );
                    }
                }
            });

            // Monochromes transparentes Icon passt sich dem Menueleisten-Modus an.
            // Linksklick = wie rechter Option-Hotkey (toggelt den Loop uebers
            // Frontend, inkl. Debounce). Rechtsklick = Menue.
            let menu = build_tray_menu(app.handle())?;
            let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?;
            tauri::tray::TrayIconBuilder::with_id("main")
                .icon(icon)
                .icon_as_template(true)
                .tooltip("Cue")
                .menu(&menu)
                .on_menu_event(|app, event| {
                    let id = event.id.as_ref();
                    #[cfg(all(debug_assertions, target_os = "macos"))]
                    if id == "simulate-notch" {
                        if let Err(error) = orchestrator_bridge::toggle_notch_preview(app) {
                            eprintln!("[cue] Notch preview: {error}");
                        }
                        return;
                    }
                    if id == "recent-chats" {
                        let _ = app.emit("recent-chats-open", ());
                        return;
                    }
                    if id == "settings" {
                        if let Err(error) = onboarding::open_settings(app) {
                            eprintln!("[cue] Cannot open Settings: {error}");
                        }
                        return;
                    }
                    if id == "show-onboarding" {
                        let _ = onboarding::show_full(app);
                        return;
                    }
                    match id {
                        "toggle" => {
                            if !global_shortcut::is_enabled() {
                                let _ = onboarding::open(app, false);
                                return;
                            }
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.emit("shortcut-pressed", ());
                            }
                        }
                        "quit" => {
                            let _ = orchestrator_bridge::kill_task(app.clone());
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if !global_shortcut::is_enabled() {
                            let _ = onboarding::open(app, false);
                            return;
                        }
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.emit("shortcut-pressed", ());
                        }
                    }
                })
                .build(app)?;
            if !complete {
                onboarding::open(app.handle(), false).map_err(std::io::Error::other)?;
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if matches!(event, tauri::RunEvent::Ready) {
                use objc2::{AllocAnyThread, MainThreadMarker};
                use objc2_app_kit::{NSApplication, NSImage};
                use objc2_foundation::NSData;
                if let Some(mtm) = MainThreadMarker::new() {
                    let data = NSData::with_bytes(include_bytes!("../icons/icon.icns"));
                    if let Some(icon) = NSImage::initWithData(NSImage::alloc(), &data) {
                        unsafe {
                            NSApplication::sharedApplication(mtm)
                                .setApplicationIconImage(Some(&icon));
                        }
                    }
                }
            }
            if matches!(event, tauri::RunEvent::Reopen { .. }) {
                onboarding::reopen_setup(app);
            }
        });
}
