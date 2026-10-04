use base64::{engine::general_purpose::STANDARD, Engine};
use block2::RcBlock;
use objc2::{class, msg_send, runtime::Bool};
use objc2_foundation::NSString;
use security_framework::item::{ItemClass, ItemSearchOptions};
use security_framework::passwords::{get_generic_password, set_generic_password};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{process::Command, sync::Mutex, time::Duration};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

const KEYCHAIN_SERVICE: &str = "computer.cue.credentials";

#[derive(Default, Serialize, Deserialize)]
pub struct Preferences {
    #[serde(default)]
    pub complete: bool,
    #[serde(default)]
    pub installed_setup_complete: bool,
    #[serde(default)]
    pub microphone: Option<String>,
    #[serde(default)]
    pub shortcut: String,
    #[serde(default)]
    pub agent_model: String,
}

pub struct OnboardingState(pub Mutex<Preferences>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupStatus {
    complete: bool,
    microphone: String,
    selected_microphone: Option<String>,
    accessibility: bool,
    hotkey_ready: bool,
    solari: bool,
    llm: bool,
    groq: bool,
}

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
    fn AXIsProcessTrustedWithOptions(options: *const std::ffi::c_void) -> bool;
    static kAXTrustedCheckOptionPrompt: *const std::ffi::c_void;
}
#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    static kCFBooleanTrue: *const std::ffi::c_void;
    fn CFDictionaryCreate(
        allocator: *const std::ffi::c_void,
        keys: *const *const std::ffi::c_void,
        values: *const *const std::ffi::c_void,
        count: isize,
        key_callbacks: *const std::ffi::c_void,
        value_callbacks: *const std::ffi::c_void,
    ) -> *const std::ffi::c_void;
    fn CFRelease(value: *const std::ffi::c_void);
}
#[link(name = "AVFoundation", kind = "framework")]
extern "C" {}

pub fn load_preferences(app: &AppHandle) -> Preferences {
    app.path()
        .app_config_dir()
        .ok()
        .and_then(|dir| std::fs::read(dir.join("onboarding.json")).ok())
        .and_then(|data| serde_json::from_slice(&data).ok())
        .unwrap_or_default()
}

fn save_preferences(app: &AppHandle, prefs: &Preferences) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let data = serde_json::to_vec(prefs).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("onboarding.tmp"), data).map_err(|e| e.to_string())?;
    std::fs::rename(dir.join("onboarding.tmp"), dir.join("onboarding.json"))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_customization(state: State<'_, OnboardingState>) -> serde_json::Value {
    let prefs = state.0.lock().unwrap();
    json!({"shortcut": if prefs.shortcut.is_empty() {"right-option"} else {&prefs.shortcut},
        "agentModel": if prefs.agent_model.is_empty() {"inception/mercury-2.5"} else {&prefs.agent_model}})
}

#[tauri::command]
pub fn save_customization(
    app: AppHandle,
    state: State<'_, OnboardingState>,
    shortcut: String,
    agent_model: String,
) -> Result<(), String> {
    super::global_shortcut::Shortcut::parse(&shortcut)?;
    let model = agent_model.trim();
    if model.len() > 160
        || !model.contains('/')
        || !model
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "/-._:".contains(c))
    {
        return Err("Use a Gateway model ID such as inception/mercury-2.5.".into());
    }
    let mut prefs = state.0.lock().unwrap();
    let previous_shortcut = std::mem::replace(&mut prefs.shortcut, shortcut);
    let previous_model = std::mem::replace(&mut prefs.agent_model, model.into());
    if let Err(error) = save_preferences(&app, &prefs) {
        prefs.shortcut = previous_shortcut;
        prefs.agent_model = previous_model;
        return Err(error);
    }
    super::global_shortcut::set_shortcut(&prefs.shortcut);
    Ok(())
}

fn account(provider: &str) -> Result<&'static str, String> {
    match provider {
        "solari" => Ok("SOLARI_API_KEY"),
        "llm" => Ok("AI_GATEWAY_API_KEY"),
        "groq" => Ok("GROQ_API_KEY"),
        _ => Err("Unknown credential provider.".into()),
    }
}

pub fn credential(provider: &str) -> Result<String, String> {
    let bytes = get_generic_password(KEYCHAIN_SERVICE, account(provider)?)
        .map_err(|_| format!("Add your {} key in the menu bar → API keys.", provider))?;
    String::from_utf8(bytes).map_err(|_| "Stored key is invalid. Paste it again.".into())
}

pub fn has_keys() -> bool {
    ["solari", "llm", "groq"]
        .iter()
        .all(|provider| credential_saved(provider))
}

fn credential_saved(provider: &str) -> bool {
    let Ok(account) = account(provider) else {
        return false;
    };
    // Status polling needs metadata, not secret access or an authorization dialog.
    ItemSearchOptions::new()
        .class(ItemClass::generic_password())
        .service(KEYCHAIN_SERVICE)
        .account(account)
        .load_attributes(true)
        .skip_authenticated_items(true)
        .search()
        .map(|items| !items.is_empty())
        .unwrap_or(false)
}

pub fn apply_credentials(command: &mut Command) -> Result<(), String> {
    command.env("SOLARI_API_KEY", credential("solari")?);
    command.env("AI_GATEWAY_API_KEY", credential("llm")?);
    Ok(())
}

fn microphone_permission() -> String {
    let media = NSString::from_str("soun");
    let status: isize =
        unsafe { msg_send![class!(AVCaptureDevice), authorizationStatusForMediaType: &*media] };
    match status {
        3 => "granted",
        0 => "not-determined",
        1 => "restricted",
        _ => "denied",
    }
    .into()
}

pub fn setup_complete(prefs: &Preferences) -> bool {
    prefs.complete
        && (cfg!(debug_assertions) || prefs.installed_setup_complete)
        && has_keys()
        && microphone_permission() == "granted"
        && accessibility_granted()
}

// Check both Accessibility and the CoreGraphics event permission used by our shortcut.
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightPostEventAccess() -> bool;
}
fn accessibility_granted() -> bool {
    let trusted = unsafe { AXIsProcessTrusted() || CGPreflightPostEventAccess() };
    trusted || super::global_shortcut::is_ready()
}

#[tauri::command]
pub fn onboarding_status(app: AppHandle, state: State<'_, OnboardingState>) -> SetupStatus {
    // Retry the actual event tap: macOS can cache a negative trust check until restart.
    super::global_shortcut::install(app);
    let accessibility = accessibility_granted();
    let prefs = state.0.lock().unwrap();
    SetupStatus {
        complete: prefs.complete,
        microphone: microphone_permission(),
        selected_microphone: prefs.microphone.clone(),
        accessibility,
        hotkey_ready: super::global_shortcut::is_ready(),
        solari: credential_saved("solari"),
        llm: credential_saved("llm"),
        groq: credential_saved("groq"),
    }
}

#[tauri::command]
pub async fn request_onboarding_permission(permission: String) -> Result<(), String> {
    if permission == "microphone" && microphone_permission() == "not-determined" {
        return tauri::async_runtime::spawn_blocking(|| {
            let (send, receive) = std::sync::mpsc::channel();
            let completion = RcBlock::new(move |allowed: Bool| { let _ = send.send(allowed.as_bool()); });
            let media = NSString::from_str("soun");
            unsafe {
                let _: () = msg_send![class!(AVCaptureDevice), requestAccessForMediaType: &*media, completionHandler: &*completion];
            }
            receive.recv_timeout(Duration::from_secs(120))
                .map_err(|_| "Microphone permission request timed out.".to_string())?;
            Ok(())
        }).await.map_err(|e| e.to_string())?;
    }
    if !matches!(
        permission.as_str(),
        "microphone" | "accessibility" | "sound"
    ) {
        return Err("Unknown permission.".into());
    }
    if permission == "accessibility" {
        unsafe {
            let options = CFDictionaryCreate(
                std::ptr::null(),
                &kAXTrustedCheckOptionPrompt,
                &kCFBooleanTrue,
                1,
                std::ptr::null(),
                std::ptr::null(),
            );
            if !options.is_null() {
                AXIsProcessTrustedWithOptions(options);
                CFRelease(options);
            }
        }
    }
    let pane = match permission.as_str() {
        "microphone" => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
        }
        "accessibility" => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
        }
        "sound" => "x-apple.systempreferences:com.apple.preference.sound?input",
        _ => return Err("Unknown permission.".into()),
    };
    if let Err(error) = Command::new("/usr/bin/open").arg(pane).spawn() {
        return Err(error.to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn validate_credential(provider: String, key: Option<String>) -> Result<(), String> {
    let key = key
        .map(Ok)
        .unwrap_or_else(|| credential(&provider))?
        .trim()
        .to_string();
    if key.is_empty() || key.len() > 4096 {
        return Err("Paste a valid API key.".into());
    }
    account(&provider)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let request = match provider.as_str() {
        "solari" => client.get("https://api.getsolari.com/profiles"),
        "groq" => client.get("https://api.groq.com/openai/v1/models/whisper-large-v3"),
        _ => client.post("https://ai-gateway.vercel.sh/v1/chat/completions")
            .json(&json!({"model":"inception/mercury-2.5","messages":[{"role":"user","content":"Reply OK."}],"max_tokens":1})),
    };
    let response = request.bearer_auth(&key).send().await.map_err(|_| {
        format!(
            "Couldn't reach {}. Check your connection and retry.",
            provider
        )
    })?;
    if response.status().is_success() {
        return Ok(());
    }
    let reason = match response.status().as_u16() {
        401 => "This key was rejected. Check it or create a new one.",
        402 => "No credits available. Add credits in the provider console.",
        403 => "This key does not have access to the required service.",
        429 => "Rate limit reached. Wait a moment and retry.",
        _ => "The provider could not validate this key. Try again.",
    };
    Err(format!(
        "{}: {} ({})",
        provider,
        reason,
        response.status().as_u16()
    ))
}

#[tauri::command]
pub fn save_credential(provider: String, key: String) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() || key.len() > 4096 {
        return Err("Paste a valid API key.".into());
    }
    set_generic_password(KEYCHAIN_SERVICE, account(&provider)?, key.as_bytes())
        .map_err(|_| "macOS Keychain could not save this key. Allow access and retry.".into())
}

#[tauri::command]
pub async fn transcribe_recording(data_uri: String) -> Result<String, String> {
    let data = data_uri
        .strip_prefix("data:audio/wav;base64,")
        .ok_or("Invalid recording format.")?;
    if data.len() > 20_000_000 {
        return Err("Recording is too large.".into());
    }
    let audio = STANDARD.decode(data).map_err(|_| "Invalid audio data.")?;
    if audio.len() < 44 || &audio[..4] != b"RIFF" || &audio[8..12] != b"WAVE" {
        return Err("Invalid WAV recording.".into());
    }
    let part = reqwest::multipart::Part::bytes(audio)
        .file_name("speech.wav")
        .mime_str("audio/wav")
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("model", "whisper-large-v3")
        .text("response_format", "verbose_json")
        .text("temperature", "0");
    let response = reqwest::Client::new()
        .post("https://api.groq.com/openai/v1/audio/transcriptions")
        .bearer_auth(credential("groq")?)
        .timeout(Duration::from_secs(60))
        .multipart(form)
        .send()
        .await
        .map_err(|_| "Groq transcription could not connect. Try again.".to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Groq transcription failed ({}). Check your Groq key and credits in the menu bar.",
            response.status().as_u16()
        ));
    }
    let data: serde_json::Value = response
        .json()
        .await
        .map_err(|_| "Groq returned an invalid transcription.")?;
    let segments = data["segments"].as_array();
    if segments.is_some_and(|segments| {
        !segments.is_empty()
            && segments
                .iter()
                .all(|s| s["no_speech_prob"].as_f64().is_some_and(|p| p > 0.6))
    }) {
        return Ok(String::new());
    }
    Ok(data["text"].as_str().unwrap_or_default().trim().to_string())
}

pub fn show_full(app: &AppHandle) -> Result<(), String> {
    let _ = app.emit_to("main", "onboarding-watch", false);
    let _ = app.emit_to("main", "onboarding-start-over", ());
    if let Some(win) = app.get_webview_window("onboarding") {
        win.set_size(tauri::LogicalSize::new(700., 740.))
            .map_err(|e| e.to_string())?;
        win.center().map_err(|e| e.to_string())?;
        let _ = win.emit("onboarding-start-over", ());
        return present_setup_window(&win);
    }
    open(app, false)
}

pub fn open_settings(app: &AppHandle) -> Result<(), String> {
    // The demo may otherwise bring setup back in front when a result closes.
    if let Some(win) = app.get_webview_window("onboarding") {
        win.emit("onboarding-suspended", ())
            .map_err(|e| e.to_string())?;
        win.hide().map_err(|e| e.to_string())?;
    }
    let _ = app.emit_to("main", "onboarding-watch", false);
    open_window(app, false, true)
}

pub fn open(app: &AppHandle, keys_only: bool) -> Result<(), String> {
    open_window(app, keys_only, false)
}

fn open_window(app: &AppHandle, keys_only: bool, settings: bool) -> Result<(), String> {
    let _ = app.emit_to("main", "dismiss-panels", ());
    let label = if settings { "settings" } else { "onboarding" };
    let width = if settings { 780. } else { 700. };
    if let Some(win) = app.get_webview_window(label) {
        win.set_size(tauri::LogicalSize::new(width, 740.))
            .map_err(|e| e.to_string())?;
        win.center().map_err(|e| e.to_string())?;
        win.emit(
            if settings {
                "settings-open"
            } else if keys_only {
                "keys-open"
            } else {
                "onboarding-resumed"
            },
            (),
        )
        .map_err(|e| e.to_string())?;
        return present_setup_window(&win);
    }
    let url = if settings {
        "index.html?onboarding&settings"
    } else if keys_only {
        "index.html?onboarding&keys"
    } else {
        "index.html?onboarding"
    };
    let win = WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into()))
        .title("cue")
        .inner_size(width, 740.)
        .resizable(false)
        .center()
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(false)
        .minimizable(true)
        .visible(false)
        .background_color(tauri::window::Color(0, 0, 0, 0))
        .build()
        .map_err(|e| e.to_string())?;
    let app = app.clone();
    let setup_window = win.clone();
    win.on_window_event(move |event| {
        if let tauri::WindowEvent::Focused(focused) = event {
            if *focused {
                let _ = setup_window.emit("setup-focus", ());
            }
        }
        if matches!(event, tauri::WindowEvent::Destroyed) {
            let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let _ = super::global_shortcut::capture_shortcut(false);
            super::native_audio::cancel_check(&app);
            let complete = app.state::<OnboardingState>().0.lock().unwrap().complete;
            if !complete && !settings {
                let _ = app.emit_to("main", "onboarding-closed", ());
            }
            super::global_shortcut::set_enabled(complete && has_keys());
        }
    });
    present_setup_window(&win)
}

pub fn reopen_setup(app: &AppHandle) {
    for label in ["settings", "onboarding"] {
        if let Some(win) = app.get_webview_window(label) {
            if win.is_visible().unwrap_or(false) || win.is_minimized().unwrap_or(false) {
                let _ = present_setup_window(&win);
                return;
            }
        }
    }
    // Launching cue again should restore setup, including a previously dismissed window.
    if let Err(error) = open(app, false) {
        eprintln!("[cue] Could not reopen onboarding: {error}");
    }
}

fn present_setup_window(win: &tauri::WebviewWindow) -> Result<(), String> {
    // Setup is a normal app window, so macOS permission dialogs can cover it.
    win.app_handle()
        .set_activation_policy(tauri::ActivationPolicy::Regular)
        .map_err(|e| e.to_string())?;
    win.unminimize().map_err(|e| e.to_string())?;
    win.show().map_err(|e| e.to_string())?;
    win.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn restart_for_permissions(app: AppHandle) -> Result<(), String> {
    use std::os::fd::AsRawFd;
    if app
        .state::<super::OrchestratorState>()
        .child
        .lock()
        .unwrap()
        .is_some()
    {
        return Err("Finish or cancel your running task before restarting cue.".into());
    }
    // Tauri starts the replacement before exiting; release our instance lock first.
    let lock = app.state::<std::fs::File>();
    if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_UN) } != 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    app.request_restart();
    Ok(())
}

#[tauri::command]
pub fn dismiss_setup(app: AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())?;
    app.set_activation_policy(tauri::ActivationPolicy::Accessory)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_onboarding_ready(app: AppHandle, ready: bool) -> Result<(), String> {
    if ready && (!has_keys() || microphone_permission() != "granted" || !accessibility_granted()) {
        return Err("Grant permissions and validate all three keys first.".into());
    }
    super::global_shortcut::set_enabled(ready);
    if ready {
        super::global_shortcut::install(app);
    }
    Ok(())
}

#[tauri::command]
pub fn finish_onboarding(app: AppHandle, state: State<'_, OnboardingState>) -> Result<(), String> {
    if !has_keys()
        || microphone_permission() != "granted"
        || !accessibility_granted()
        || !super::global_shortcut::is_ready()
    {
        return Err("Finish permissions and keys before closing setup.".into());
    }
    let mut prefs = state.0.lock().unwrap();
    prefs.complete = true;
    prefs.installed_setup_complete |= !cfg!(debug_assertions);
    if let Err(error) = save_preferences(&app, &prefs) {
        prefs.complete = false;
        return Err(error);
    }
    drop(prefs);
    super::global_shortcut::set_enabled(true);
    if let Some(tray) = app.tray_by_id("main") {
        if let Ok(menu) = super::build_tray_menu(&app) {
            let _ = tray.set_menu(Some(menu));
        }
    }
    Ok(())
}

pub fn save_microphone(app: &AppHandle, microphone: Option<String>) -> Result<(), String> {
    let state = app.state::<OnboardingState>();
    let mut prefs = state.0.lock().unwrap();
    prefs.microphone = microphone;
    save_preferences(app, &prefs)
}

#[cfg(test)]
mod tests {
    #[test]
    fn credentials_are_limited_to_known_keychain_accounts() {
        assert_eq!(super::account("groq").unwrap(), "GROQ_API_KEY");
        assert_eq!(super::account("solari").unwrap(), "SOLARI_API_KEY");
        assert_eq!(super::account("llm").unwrap(), "AI_GATEWAY_API_KEY");
        assert!(super::account("../other-account").is_err());
        assert!(super::account("").is_err());
    }
}
