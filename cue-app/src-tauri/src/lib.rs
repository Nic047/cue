// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::{Emitter, Manager};
mod global_shortcut;
mod media_control;
mod native_audio;
mod onboarding;
mod orchestrator_bridge;
mod updates;
mod window_layout;
use orchestrator_bridge::OrchestratorState;

/// Forward WebView logs to the terminal.
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

fn build_tray_menu(
    app: &tauri::AppHandle,
) -> tauri::Result<(Menu<tauri::Wry>, MenuItem<tauri::Wry>)> {
    let menu = Menu::new(app)?;
    let recent = MenuItem::with_id(app, "recent-chats", "Recent Chats…", true, None::<&str>)?;
    menu.append(&recent)?;
    let update = MenuItem::with_id(app, "updates", "One update available", true, None::<&str>)?;
    menu.append(&MenuItem::with_id(
        app,
        "settings",
        "Settings…",
        true,
        None::<&str>,
    )?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    let toggle = MenuItem::with_id(app, "toggle", "Toggle cue", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit cue", true, None::<&str>)?;
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
    Ok((menu, update))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_nspanel::init())
        .invoke_handler(tauri::generate_handler![
            updates::get_update_status,
            updates::update_action,
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
            window_layout::get_notch_layout,
            window_layout::set_panel_dismiss,
            window_layout::resize_window,
            window_layout::morph_window,
            window_layout::hide_window,
            window_layout::show_window,
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
            // Run as a menu bar app; the pill uses a nonactivating NSPanel.
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
            let complete = onboarding::setup_complete(&prefs);
            app.manage(native_audio::NativeAudio::with_device(
                prefs.microphone.clone(),
            ));
            app.manage(onboarding::OnboardingState(std::sync::Mutex::new(prefs)));
            global_shortcut::set_enabled(complete);
            app.manage(media_control::MediaControl::default());

            // Install the global shortcut listener.
            global_shortcut::install(app.handle().clone());
            window_layout::watch_foreground(app.handle().clone());

            let Some(window) = app.get_webview_window("main") else {
                return Ok(());
            };

            #[cfg(target_os = "macos")]
            {
                #[allow(deprecated)]
                use tauri_nspanel::cocoa::appkit::NSWindowCollectionBehavior;
                use tauri_nspanel::WebviewWindowExt;

                // NSPanel supports placement above native full-screen applications.
                let panel = window.to_panel()?;

                // Nonactivating panels do not steal focus.
                const NS_WINDOW_STYLE_MASK_NONACTIVATING_PANEL: i32 = 1 << 7;
                panel.set_style_mask(NS_WINDOW_STYLE_MASK_NONACTIVATING_PANEL);
                panel.set_floating_panel(true);

                // Keep the panel visible when another application becomes active.
                panel.set_hides_on_deactivate(false);

                // Join all spaces and full-screen apps. tauri-nspanel requires the deprecated cocoa enum here.
                #[allow(deprecated)]
                panel.set_collection_behaviour(
                    NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces
                        | NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary
                        | NSWindowCollectionBehavior::NSWindowCollectionBehaviorStationary,
                );

                // Use screen-saver level to display above the menu bar and full-screen apps.
                panel.set_level(1000);

                // Ensure the panel is rendered.
                panel.order_front_regardless();
            }

            // Use the same safe-area anchor for startup, resizing, and display changes.
            let width = window.outer_size()?.width as f64 / window.scale_factor()?;
            window_layout::pin_top_center(&window, width)?;
            let display_window = window.clone();
            window.on_window_event(move |event| {
                if matches!(
                    event,
                    tauri::WindowEvent::ScaleFactorChanged { .. } | tauri::WindowEvent::Moved(_)
                ) {
                    if let (Ok(size), Ok(scale)) =
                        (display_window.outer_size(), display_window.scale_factor())
                    {
                        let _ = window_layout::pin_top_center(
                            &display_window,
                            size.width as f64 / scale,
                        );
                    }
                }
            });

            // Use a monochrome template icon that adapts to the menu bar.
            // Left click routes through the frontend shortcut handler; right click opens the menu.
            let (menu, update_item) = build_tray_menu(app.handle())?;
            updates::initialize(app.handle(), menu.clone(), update_item);
            updates::monitor(app.handle().clone());
            let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?;
            tauri::tray::TrayIconBuilder::with_id("main")
                .icon(icon)
                .icon_as_template(true)
                .tooltip("cue")
                .menu(&menu)
                .on_menu_event(move |app, event| {
                    let id = event.id.as_ref();
                    #[cfg(all(debug_assertions, target_os = "macos"))]
                    if id == "simulate-notch" {
                        if let Err(error) = window_layout::toggle_notch_preview(app) {
                            eprintln!("[cue] Notch preview: {error}");
                        }
                        return;
                    }
                    if id == "recent-chats" {
                        let _ = app.emit("recent-chats-open", ());
                        return;
                    }
                    if id == "updates" {
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Err(error) = updates::menu_action(app).await {
                                eprintln!("[cue] Update check failed: {error}");
                            }
                        });
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
            if matches!(event, tauri::RunEvent::Ready) {
                // Create and focus setup after macOS finishes launching the application.
                let Some(state) = app.try_state::<onboarding::OnboardingState>() else {
                    return;
                };
                let complete = onboarding::setup_complete(&state.0.lock().unwrap());
                if !complete {
                    if let Err(error) = onboarding::open(app, false) {
                        eprintln!("[cue] Could not open onboarding: {error}");
                    }
                }
            }
            if matches!(event, tauri::RunEvent::Reopen { .. }) {
                onboarding::reopen_setup(app);
            }
        });
}
