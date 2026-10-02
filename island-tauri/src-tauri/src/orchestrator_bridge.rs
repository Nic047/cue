//! Sidecar-Bridge: started den island-agent (Orchestrator als compiled
//! Node-Runtime) und streamed seine JSONL-Events als Tauri-Events ins
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

    let resources = app.path().resource_dir().map_err(|e| e.to_string())?;
    let project_dir = if cfg!(debug_assertions) {
        std::env::var_os("CUE_PROJECT_DIR")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| {
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .parent()
                    .unwrap()
                    .parent()
                    .unwrap()
                    .to_path_buf()
            })
    } else {
        resources.clone()
    };
    let project_dir = project_dir
        .canonicalize()
        .map_err(|e| format!("Agent working directory unavailable: {e}"))?;
    let sidecar = if cfg!(debug_assertions) {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(format!(
                "island-agent-{}-apple-darwin",
                std::env::consts::ARCH
            ))
    } else {
        std::env::current_exe()
            .map_err(|e| e.to_string())?
            .parent()
            .ok_or("App executable has no parent directory")?
            .join("island-agent")
    };

    eprintln!(
        "[island] Sidecar-Spawn: {} (cwd: {})",
        sidecar.display(),
        project_dir.display()
    );

    let mut command = Command::new(&sidecar);
    if cfg!(debug_assertions) {
        command.env("CUE_PROJECT_DIR", &project_dir);
    } else {
        command.env_remove("CUE_PROJECT_DIR");
        command.env("CUE_AGENT_RUNTIME", resources.join("agent-runtime"));
    }
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
        let mut exit_error = None;
        if let Some(state) = app.try_state::<OrchestratorState>() {
            let mut guard = state.child.lock().unwrap();
            if let Some(c) = guard.as_mut() {
                match c.wait() {
                    Ok(status) if !status.success() => {
                        exit_error = Some(format!(
                            "Cue agent exited unexpectedly{}.",
                            status
                                .code()
                                .map(|code| format!(" with code {code}"))
                                .unwrap_or_default()
                        ));
                    }
                    Err(error) => {
                        exit_error = Some(format!("Cue agent status unavailable: {error}"))
                    }
                    _ => {}
                }
            }
            *guard = None;
            *state.stdin.lock().unwrap() = None;
            global_shortcut::set_task_active(false);
        }
        if let Some(message) = exit_error {
            let event =
                serde_json::json!({ "type": "agent_error", "message": message }).to_string();
            let _ = app.emit("orchestrator-event", event);
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

/// Only open files exported by Cue; arbitrary paths from Markdown are rejected.
#[tauri::command]
pub fn open_export(app: AppHandle, id: String) -> Result<(), String> {
    if id.is_empty()
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
    {
        return Err("Invalid export ID".into());
    }
    let root = app
        .path()
        .download_dir()
        .map_err(|e| e.to_string())?
        .join("Cue")
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let path = root.join(id).canonicalize().map_err(|e| e.to_string())?;
    if !path.starts_with(&root) || !path.is_file() {
        return Err("Invalid export path".into());
    }
    let status = Command::new("/usr/bin/open")
        .arg("-R")
        .arg(path)
        .status()
        .map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("Could not reveal exported file".into())
    }
}
