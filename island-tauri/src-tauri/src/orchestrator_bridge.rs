//! Sidecar-Bridge: started den island-agent (Orchestrator als compiled
//! Bun-Binary) und streamed seine JSONL-Events als Tauri-Events ins
//! Frontend. stdout = reine JSONL-Events, stderr = menschliche Logs.

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

use crate::global_shortcut;

pub struct OrchestratorState {
    pub child: Mutex<Option<Child>>,
    pub stdin: Mutex<Option<ChildStdin>>,
}

/// Laufende Orchestrator-Generation: Jeder neue run_task UND jede kill_task
/// macht alte Reader-Threads stumm. So kann kein gekillter oder ueberholter
/// Lauf mehr Events emitten, fremde Child-Handles anfassen (wait/drop) oder
/// ein falsches orchestrator-done ausloesen, das die UI mitten im neuen Lauf
/// zuruecksetzt — und ein spaetes answer oeffnet nicht mehr "random" die Pill.
static RUN_GEN: AtomicU64 = AtomicU64::new(0);

#[tauri::command]
pub fn run_task(app: AppHandle, task: String) -> Result<(), String> {
    // Alten Lauf killen, falls einer haengt.
    kill_task(app.clone())?;
    // Neue Generation: alte Reader-Threads (falls noch am Leben) verstummen.
    let gen = RUN_GEN.fetch_add(1, Ordering::SeqCst) + 1;

    let project_dir = std::env::var_os("CUE_PROJECT_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
    // Sidecar-Binary: Tauri loest den Target-Tripler-Suffix auf
    // (island-agent-aarch64-apple-darwin).
    let sidecar = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir fehlgeschlagen: {e}"))?
        .join(format!("binaries/island-agent-{}", std::env::consts::ARCH));
    let sidecar = if sidecar.exists() {
        sidecar
    } else {
        // Dev-Fallback: direkt aus dem Quellverzeichnis.
        std::env::current_dir()
            .expect("cwd")
            .join("binaries")
            .join(format!(
                "island-agent-{}-apple-darwin",
                std::env::consts::ARCH
            ))
    };

    eprintln!(
        "[island] Sidecar-Spawn: {} (cwd: {})",
        sidecar.display(),
        project_dir.display()
    );

    let mut command = Command::new(&sidecar);
    command.env("CUE_PROJECT_DIR", &project_dir);
    super::onboarding::apply_credentials(&mut command)?;
    let prefs = super::onboarding::load_preferences(&app);
    if !prefs.agent_model.is_empty() {
        command.env("CHEAP_MODEL", &prefs.agent_model);
        command.env("FALLBACK_MODEL", &prefs.agent_model);
        command.env("PLANNER_MODEL", &prefs.agent_model);
    }
    let mut child = command
        .arg(&task)
        .current_dir(&project_dir)
        .stdin(Stdio::piped()) // für answer_question (Rückfrage-Antworten)
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit()) // menschliche Logs direkt ins Terminal
        .spawn()
        .map_err(|e| format!("Sidecar-Start fehlgeschlagen: {e}"))?;

    eprintln!(
        "[island] Orchestrator gestartet (pid {}): {}",
        child.id(),
        task
    );

    let stdout = child.stdout.take().expect("stdout piped");
    let stdin = child.stdin.take().expect("stdin piped");
    *app.state::<OrchestratorState>().child.lock().unwrap() = Some(child);
    *app.state::<OrchestratorState>().stdin.lock().unwrap() = Some(stdin);
    // Ab jetzt: Escape gehoert uns (auch bei versteckter Pill), bis der
    // Lauf endet oder gekillt wird.
    global_shortcut::set_task_active(true);

    // Lese-Thread: JSONL-Zeilen -> Tauri-Events.
    // Gehoert strikt zu DIESER Generation: bei Kill oder neuem Lauf sofort
    // still beenden, ohne State anzufassen oder done zu melden.
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            if RUN_GEN.load(Ordering::SeqCst) != gen {
                return;
            }
            let Ok(line) = line else { break };
            if line.trim().is_empty() {
                continue;
            }
            // Validieren, dass es JSON ist, bevor wir es emitten.
            if serde_json::from_str::<serde_json::Value>(&line).is_ok() {
                let _ = app.emit("orchestrator-event", line);
            } else {
                eprintln!("[island] Ungueltige stdout-Zeile: {line}");
            }
        }
        // Nur der aktuelle Lauf darf aufraeumen + done melden.
        if RUN_GEN.load(Ordering::SeqCst) != gen {
            return;
        }
        // Stream zu => Prozess fertig. Aufräumen.
        if let Some(state) = app.try_state::<OrchestratorState>() {
            let mut guard = state.child.lock().unwrap();
            if let Some(c) = guard.as_mut() {
                let _ = c.wait();
            }
            *guard = None;
            *state.stdin.lock().unwrap() = None;
            global_shortcut::set_task_active(false);
        }
        let _ = app.emit("orchestrator-done", ());
    });

    Ok(())
}

#[tauri::command]
pub fn kill_task(app: AppHandle) -> Result<(), String> {
    // Generation zuerst bumpen: Der Reader des sterbenden Laufs verstummt
    // sofort, egal wie lange kill/wait noch brauchen.
    RUN_GEN.fetch_add(1, Ordering::SeqCst);
    // Task als beendet markieren: Escape geht wieder normal ans System.
    global_shortcut::set_task_active(false);
    let state = app.state::<OrchestratorState>();
    // stdin-Handle zuerst droppen (Writer schließen), dann killen.
    *state.stdin.lock().unwrap() = None;
    if let Some(mut child) = state.child.lock().unwrap().take() {
        let pid = child.id();
        eprintln!("[island] Kill Orchestrator (pid {pid})");
        // Graceful zuerst: SIGTERM gibt dem Sidecar ~5s, um Cloud-Sessions
        // sauber freizugeben (sonst strandete Slots bis zum Idle-Timeout und
        // blockieren irgendwann neue Launches). Erst dann SIGKILL.
        #[cfg(unix)]
        unsafe {
            libc::kill(pid as libc::pid_t, libc::SIGTERM);
        }
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break, // tot (von selbst oder per SIGTERM)
                Ok(None) if std::time::Instant::now() < deadline => {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
                _ => {
                    let _ = child.kill(); // SIGKILL
                    let _ = child.wait();
                    break;
                }
            }
        }
    }
    Ok(())
}

/// Antwort auf eine Orchestrator-Rückfrage (question-Event) an den
/// Sidecar-prozess weiterreichen (eine Zeile via stdin).
#[tauri::command]
pub fn answer_question(app: AppHandle, text: String) -> Result<(), String> {
    let state = app.state::<OrchestratorState>();
    let mut guard = state.stdin.lock().unwrap();
    match guard.as_mut() {
        Some(stdin) => {
            eprintln!("[island] Rückfrage-Antwort: {text}");
            stdin
                .write_all(format!("{text}\n").as_bytes())
                .map_err(|e| format!("stdin-Write fehlgeschlagen: {e}"))?;
            stdin
                .flush()
                .map_err(|e| format!("stdin-Flush fehlgeschlagen: {e}"))?;
            Ok(())
        }
        None => Err("kein laufender Orchestrator (stdin)".to_string()),
    }
}

#[tauri::command]
pub fn resize_window(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    let gen = MORPH_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let win = app.get_webview_window("main").ok_or("main window fehlt")?;
    apply_morph_frame(&win, gen, width, height)
}

/// Fenster komplett ausblenden (idle): Ein transparentes, aber gemapptes
/// Fenster frisst sonst unsichtbar Mausklicks in seinem Rechteck.
/// PILL_OPEN wird erst nach 700ms Grace geloescht, damit ein schneller
/// Doppel-Escape (Pill zu + Task killen, Fenster: 600ms) das Frontend noch
/// erreicht — sonst wuerde der zweite Druck schon ans System durchgereicht.
static HIDE_GEN: AtomicU64 = AtomicU64::new(0);
static WINDOW_HIDDEN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);

#[tauri::command]
pub fn hide_window(app: AppHandle) -> Result<(), String> {
    // Laufenden Morph stoppen (Generation wird ungueltig).
    let morph_gen = MORPH_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    WINDOW_HIDDEN.store(true, Ordering::SeqCst);
    let gen = HIDE_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(700));
        if HIDE_GEN.load(Ordering::SeqCst) == gen {
            global_shortcut::set_pill_open(false);
        }
    });
    let win = app.get_webview_window("main").ok_or("main window fehlt")?;
    app.run_on_main_thread(move || {
        if MORPH_GEN.load(Ordering::SeqCst) == morph_gen {
            let _ = win.hide();
        }
    })
    .map_err(|e| e.to_string())
}

/// Fenster wieder einblenden (listening/transcribing/working/done).
/// Kein Fokus-Stehlen: Das Panel ist nonactivating (s. lib.rs).
/// Re-assertet danach Level + Front-Order: Tauri-show nutzt plain
/// orderFront, was das Panel hinter Fullscreen-Fenstern landen liesse.
#[tauri::command]
pub async fn show_window(
    app: AppHandle,
    width: f64,
    height: f64,
    animate: bool,
) -> Result<(), String> {
    let win = app.get_webview_window("main").ok_or("main window fehlt")?;
    let gen = MORPH_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    let dispatch = app.clone();
    app.run_on_main_thread(move || {
        let result = (|| -> Result<(), String> {
            if MORPH_GEN.load(Ordering::SeqCst) != gen {
                return Ok(());
            }
            // Retain the logical hidden state even if a queued hide has not run yet.
            let reopening = WINDOW_HIDDEN.load(Ordering::SeqCst);
            #[cfg(target_os = "macos")]
            unsafe {
                use objc2_app_kit::NSWindow;
                let native = &*(win.ns_window().map_err(|e| e.to_string())? as *const NSWindow);
                // A hidden window must reach its target size before its first visible frame.
                if reopening || !native.isVisible() || !animate {
                    set_frame_size(&win, width, height)?;
                }
                let actual_width = native.frame().size.width;
                pin_top_center(&win, actual_width)?;
                native.setLevel(1000);
                native.displayIfNeeded();
                native.orderFrontRegardless();
            }
            #[cfg(not(target_os = "macos"))]
            {
                if reopening || !win.is_visible().map_err(|e| e.to_string())? || !animate {
                    set_frame_size(&win, width, height)?;
                }
                pin_top_center(&win, width)?;
                win.show().map_err(|e| e.to_string())?;
            }
            HIDE_GEN.fetch_add(1, Ordering::SeqCst);
            WINDOW_HIDDEN.store(false, Ordering::SeqCst);
            global_shortcut::set_pill_open(true);
            if animate {
                morph_window(dispatch, width, height)?;
            }
            Ok(())
        })();
        let _ = sender.try_send(result);
    })
    .map_err(|e| e.to_string())?;
    receiver
        .recv()
        .await
        .ok_or("Window presentation interrupted")?
}

// These mutations run on the main thread, including the generation check.
fn set_frame_size(win: &tauri::WebviewWindow, width: f64, height: f64) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    unsafe {
        use objc2_app_kit::NSWindow;
        use objc2_foundation::NSSize;
        let native = &*(win.ns_window().map_err(|e| e.to_string())? as *const NSWindow);
        native.setContentSize(NSSize::new(width, height));
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        win.set_size(tauri::LogicalSize::new(width, height))
            .map_err(|e| e.to_string())
    }
}

fn apply_morph_frame(
    win: &tauri::WebviewWindow,
    gen: u64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let window = win.clone();
    win.app_handle()
        .run_on_main_thread(move || {
            if MORPH_GEN.load(Ordering::SeqCst) != gen {
                return;
            }
            if set_frame_size(&window, width, height).is_ok() {
                let _ = pin_top_center(&window, width);
            }
        })
        .map_err(|e| e.to_string())
}

/// Monotoner Zaehler: nur die juengste Morph-Animation laeuft.
/// Jeder neue morph_window/hide_window-Call macht alte Threads ungueltig.
static MORPH_GEN: AtomicU64 = AtomicU64::new(0);

#[cfg(all(debug_assertions, target_os = "macos"))]
static SIMULATE_NOTCH: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[cfg(all(debug_assertions, target_os = "macos"))]
pub fn toggle_notch_preview(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window("notch-preview").is_none() {
        let preview = tauri::WebviewWindowBuilder::new(
            app,
            "notch-preview",
            tauri::WebviewUrl::App("notch-preview.html".into()),
        )
        .title("Cue notch preview")
        .inner_size(180.0, 32.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        .focusable(false)
        .focused(false)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;
        use tauri_nspanel::WebviewWindowExt;
        let panel = preview.to_panel().map_err(|e| e.to_string())?;
        panel.set_style_mask(1 << 7); // Nonactivating, like Cue's main panel.
        panel.set_floating_panel(true);
        panel.set_hides_on_deactivate(false);
        preview
            .set_ignore_cursor_events(true)
            .map_err(|e| e.to_string())?;
    }
    SIMULATE_NOTCH.fetch_xor(true, Ordering::SeqCst);
    let win = app.get_webview_window("main").ok_or("main window fehlt")?;
    let width = win.outer_size().map_err(|e| e.to_string())?.width as f64
        / win.scale_factor().map_err(|e| e.to_string())?;
    pin_top_center(&win, width)
}

#[derive(Clone, Copy, Default, serde::Serialize, PartialEq)]
pub struct NotchLayout {
    width: f64,
    height: f64,
}
static NOTCH_LAYOUT: Mutex<NotchLayout> = Mutex::new(NotchLayout {
    width: 0.0,
    height: 0.0,
});

#[tauri::command]
pub fn get_notch_layout() -> NotchLayout {
    *NOTCH_LAYOUT.lock().unwrap()
}

/// Anchor at the display edge; the UI reserves the camera housing as negative space.
pub fn pin_top_center(win: &tauri::WebviewWindow, width: f64) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let window = win.clone();
        let _ = width; // Native frame dimensions are already in logical points.
        return win
            .app_handle()
            .run_on_main_thread(move || unsafe {
                use objc2::{msg_send, sel, MainThreadMarker};
                use objc2_app_kit::{NSScreen, NSWindow};
                use objc2_foundation::NSPoint;
                let Ok(pointer) = window.ns_window() else {
                    return;
                };
                let native = &*(pointer as *const NSWindow);
                let Some(screen) = native.screen().or_else(|| {
                    NSScreen::mainScreen(MainThreadMarker::new().expect("main thread"))
                }) else {
                    return;
                };
                let screen_frame = screen.frame();
                let frame = native.frame();
                // safeAreaInsets arrived in macOS 12; older systems have no notch.
                let has_safe_area: bool =
                    msg_send![&*screen, respondsToSelector: sel!(safeAreaInsets)];
                let inset = if has_safe_area {
                    screen.safeAreaInsets().top
                } else {
                    0.0
                };
                #[cfg(debug_assertions)]
                let inset = {
                    let simulated = SIMULATE_NOTCH.load(Ordering::SeqCst);
                    if let Some(preview) = window.app_handle().get_webview_window("notch-preview") {
                        if simulated {
                            if let Ok(pointer) = preview.ns_window() {
                                use objc2_app_kit::NSWindowCollectionBehavior;
                                let overlay = &*(pointer as *const NSWindow);
                                overlay.setCollectionBehavior(
                                    NSWindowCollectionBehavior::CanJoinAllSpaces
                                        | NSWindowCollectionBehavior::FullScreenAuxiliary
                                        | NSWindowCollectionBehavior::Stationary,
                                );
                                let (x, y) = top_center_origin(
                                    screen_frame.origin.x,
                                    screen_frame.origin.y,
                                    screen_frame.size.width,
                                    screen_frame.size.height,
                                    180.0,
                                    32.0,
                                );
                                overlay.setFrameOrigin(NSPoint::new(x, y));
                                overlay.setLevel(1001);
                                overlay.orderFrontRegardless();
                            }
                        } else {
                            let _ = preview.hide();
                        }
                    }
                    if simulated {
                        inset.max(32.0)
                    } else {
                        inset
                    }
                };
                let notch_width = if inset > 0.0 {
                    let left = screen.auxiliaryTopLeftArea();
                    let right = screen.auxiliaryTopRightArea();
                    let measured = (right.origin.x - left.origin.x - left.size.width).max(0.0);
                    #[cfg(debug_assertions)]
                    let measured = if SIMULATE_NOTCH.load(Ordering::SeqCst) {
                        180.0
                    } else {
                        measured
                    };
                    measured
                } else {
                    0.0
                };
                let layout = NotchLayout {
                    width: notch_width,
                    height: inset,
                };
                let changed = {
                    let mut current = NOTCH_LAYOUT.lock().unwrap();
                    let changed = *current != layout;
                    *current = layout;
                    changed
                };
                if changed {
                    let _ = window.emit("notch-layout", layout);
                }
                let (x, y) = top_center_origin(
                    screen_frame.origin.x,
                    screen_frame.origin.y,
                    screen_frame.size.width,
                    screen_frame.size.height,
                    frame.size.width,
                    frame.size.height,
                );
                let x = x + notch_anchor_offset(
                    frame.size.width,
                    frame.size.height,
                    notch_width,
                    inset,
                );
                native.setLevel(1000);
                // Avoid a Moved-event loop when macOS relocates a disconnected display.
                if (frame.origin.x - x).abs() > 0.5 || (frame.origin.y - y).abs() > 0.5 {
                    native.setFrameOrigin(NSPoint::new(x, y));
                }
            })
            .map_err(|e| e.to_string());
    }
    #[cfg(not(target_os = "macos"))]
    {
        let monitor = win
            .current_monitor()
            .unwrap_or(None)
            .or_else(|| win.primary_monitor().unwrap_or(None))
            .ok_or("kein monitor")?;
        let scale = monitor.scale_factor();
        let origin = monitor.position();
        let x = origin.x as f64 / scale + (monitor.size().width as f64 / scale - width) / 2.0;
        win.set_position(tauri::LogicalPosition::new(x, origin.y as f64 / scale))
            .map_err(|e| e.to_string())
    }
}

// The compact left wing is 48pt: 14pt padding + 20pt matrix + 14pt padding.
// Blend back to a centered panel as its height grows, avoiding a position jump.
fn notch_anchor_offset(width: f64, height: f64, notch_width: f64, notch_height: f64) -> f64 {
    if notch_width <= 0.0 {
        return 0.0;
    }
    let pill_height = (notch_height + 8.0).max(42.0);
    let progress = ((height - pill_height) / 120.0).clamp(0.0, 1.0);
    let compact = 1.0 - progress * progress * (3.0 - 2.0 * progress);
    ((width - notch_width) / 2.0 - 48.0) * compact
}

// AppKit coordinates start at the bottom left; all values are logical points.
fn top_center_origin(
    screen_x: f64,
    screen_y: f64,
    screen_w: f64,
    screen_h: f64,
    window_w: f64,
    window_h: f64,
) -> (f64, f64) {
    (
        screen_x + (screen_w - window_w) / 2.0,
        screen_y + screen_h - window_h,
    )
}

#[cfg(test)]
mod display_tests {
    use super::{notch_anchor_offset, top_center_origin};

    #[test]
    fn anchors_at_display_edge_and_respects_display_origins() {
        // Camera stays at x=666 while only the right wing expands.
        for width in [398.0, 548.0] {
            let (x, _) = top_center_origin(0., 0., 1512., 982., width, 42.);
            assert_eq!(x + notch_anchor_offset(width, 42., 180., 32.) + 48., 666.);
        }
        assert_eq!(notch_anchor_offset(800., 400., 180., 32.), 0.);
        assert_eq!(notch_anchor_offset(398., 102., 180., 32.), 30.5);
        assert_eq!(notch_anchor_offset(398., 162., 180., 32.), 0.);
        assert_eq!(notch_anchor_offset(230., 42., 0., 0.), 0.);
        assert_eq!(
            top_center_origin(0., 0., 1512., 982., 520., 42.),
            (496., 940.)
        );
        assert_eq!(
            top_center_origin(-1920., 200., 1920., 1080., 220., 42.),
            (-1070., 1238.)
        );
        assert_eq!(
            top_center_origin(0., 0., 1512., 982., 800., 400.),
            (356., 582.)
        );
    }
}

/// Fenster in EINEM IPC-Call per Feder-Physik auf Zielgroesse morphen.
///
/// WICHTIG: Es laeuft nur EINE Feder, nicht zwei getrennte auf (width,
/// height). Zwei unabhaengige Federn mit identischer Stiffness/Damping
/// sehen bei UNTERSCHIEDLICH GROSSEN Distanzen trotzdem versetzt aus,
/// weil die kuerzere Strecke schlicht frueher "ankommt" als die laengere
/// (z.B. Breite 220->560 vs. Hoehe 42->200: beide Achsen bewegen sich
/// "gleichzeitig" im Sinne der Physik, aber die kuerzere Achse wirkt
/// optisch frueher fertig -> man sieht "erst breiter, dann hoeher").
///
/// Fix: eine Feder laeuft auf einem normalisierten Fortschritt t (0..1),
/// gedaempft gegen das Ziel 1.0. Breite und Hoehe werden in JEDEM Frame
/// aus DEMSELBEN t interpoliert (lerp). Dadurch ist es UNMOEGLICH, dass
/// eine Achse der anderen vorauslaeuft - beide haengen an derselben
/// Zeitachse. Das Overshoot-Verhalten (leichtes "Ueberschwingen" durch
/// Unterdaempfung) bleibt erhalten, wirkt jetzt aber auf beide Achsen
/// exakt gleich proportional zu ihrer jeweiligen Distanz.
#[tauri::command]
pub fn morph_window(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    let win = app.get_webview_window("main").ok_or("main window fehlt")?;
    let gen = MORPH_GEN.fetch_add(1, Ordering::SeqCst) + 1;

    let scale = win.scale_factor().map_err(|e| e.to_string())?;
    let cur = win.inner_size().map_err(|e| e.to_string())?;
    let (start_w, start_h) = (cur.width as f64 / scale, cur.height as f64 / scale);
    if (start_w - width).abs() < 0.5 && (start_h - height).abs() < 0.5 {
        return pin_top_center(&win, width);
    }

    std::thread::spawn(move || {
        const DT: f64 = 1.0 / 60.0;
        // Etwas weicher als vorher (war 180/22), weil ein einzelner
        // Fortschritts-Parameter das ganze Fenster bewegt statt zweier
        // getrennter Achsen - bei gleicher Stiffness fuehlt sich ein
        // kombinierter Spring sonst schneller/harter an, da beide
        // Dimensionen gleichzeitig "mitgerissen" werden. Leichtes
        // Overshoot bleibt bewusst erhalten (Damping < kritisch).
        const STIFFNESS: f64 = 170.0;
        const DAMPING: f64 = 24.0;
        const MAX_FRAMES: u64 = 90;

        // t = 0 -> Startgroesse, t = 1 -> Zielgroesse. Eine einzige Feder
        // zieht t Richtung 1.0; w/h werden daraus abgeleitet, niemals
        // selbst gefedert.
        let mut t: f64 = 0.0;
        let mut vt: f64 = 0.0;
        let t0 = std::time::Instant::now();
        let mut frame: u64 = 0;

        loop {
            if MORPH_GEN.load(Ordering::SeqCst) != gen {
                return; // von neuerem Morph abgeloest
            }

            vt += (STIFFNESS * (1.0 - t) - DAMPING * vt) * DT;
            t += vt * DT;

            let pw = start_w + (width - start_w) * t;
            let ph = start_h + (height - start_h) * t;

            if apply_morph_frame(&win, gen, pw, ph).is_err() {
                return;
            }

            frame += 1;
            let settled = (1.0 - t).abs() < 0.003 && vt.abs() < 0.02;
            if settled || frame >= MAX_FRAMES {
                if MORPH_GEN.load(Ordering::SeqCst) == gen {
                    let _ = apply_morph_frame(&win, gen, width, height);
                }
                return;
            }

            let wake = t0 + std::time::Duration::from_secs_f64(frame as f64 * DT);
            let now = std::time::Instant::now();
            if wake > now {
                std::thread::sleep(wake - now);
            }
        }
    });
    Ok(())
}

fn dirs_home() -> std::path::PathBuf {
    std::env::var("HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("/"))
}
