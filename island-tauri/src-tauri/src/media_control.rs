use std::process::Command;
use std::sync::Mutex;
use tauri::State;

#[derive(Default)]
pub struct MediaControl {
    spotify_paused: Mutex<bool>,
}

const SPOTIFY_PAUSE: &str = r#"
try
  if application "Spotify" is running then
    tell application "Spotify"
      if player state is playing then
        pause
        return "paused"
      end if
    end tell
  end if
end try
return ""
"#;

const SPOTIFY_RESUME: &str = r#"
try
  if application "Spotify" is running then
    tell application "Spotify"
      if player state is paused then play
    end tell
  end if
end try
"#;

const BROWSER_MEDIA_PAUSE: &str = "(()=>{if(window.__islandVoicePaused?.length)return 0;const host=location.hostname;const isMediaSite=host==='youtube.com'||host.endsWith('.youtube.com')||host==='spotify.com'||host.endsWith('.spotify.com');const media=[...document.querySelectorAll('video,audio')].filter(v=>isMediaSite&&!v.paused&&!v.ended);window.__islandVoicePaused=media.map(element=>{const state={element,src:element.currentSrc,userStarted:false,onPlay:null};state.onPlay=()=>state.userStarted=true;element.addEventListener('play',state.onPlay);element.pause();return state});return media.length})()";
const BROWSER_MEDIA_RESUME: &str = "(()=>{const states=window.__islandVoicePaused||[];delete window.__islandVoicePaused;for(const state of states){const {element}=state;element.removeEventListener('play',state.onPlay);if(element.isConnected&&!state.userStarted&&element.paused&&element.currentSrc===state.src)element.play().catch(()=>{})}return 0})()";

fn browser_script(js: &str) -> String {
    let mut script = String::from("set pausedCount to 0\n");
    script.push_str("set failedTabCount to 0\n");
    for (name, safari) in [("Google Chrome", false), ("Safari", true), ("Arc", false)] {
        let js = js.replace('\\', "\\\\").replace('"', "\\\"");
        let evaluate = if safari {
            format!("do JavaScript \"{js}\" in browserTab")
        } else {
            format!("execute javascript \"{js}\" in browserTab")
        };
        script.push_str(&format!(
            "try\n  if application \"{name}\" is running then\n    tell application \"{name}\"\n      repeat with browserWindow in windows\n        repeat with browserTab in tabs of browserWindow\n          try\n            set tabUrl to URL of browserTab\n            if (tabUrl contains \"youtube.com\" or tabUrl contains \"spotify.com\") then\n              set tabChanged to {evaluate}\n              set pausedCount to pausedCount + (tabChanged as integer)\n            end if\n          on error\n            set failedTabCount to failedTabCount + 1\n          end try\n        end repeat\n      end repeat\n    end tell\n  end if\nend try\n"
        ));
    }
    script.push_str("return (pausedCount as text) & \"|\" & (failedTabCount as text)");
    script
}

#[cfg(target_os = "macos")]
fn log_browser_failures(action: &str, result: Result<String, String>) {
    match result {
        Ok(output) => {
            if output
                .split('|')
                .nth(1)
                .and_then(|count| count.parse::<u32>().ok())
                .unwrap_or(0)
                > 0
            {
                eprintln!("[island] Browser media {action} skipped: enable 'Allow JavaScript from Apple Events' in the browser's Developer menu.");
            }
        }
        Err(error) if error.contains("-1723") => {
            eprintln!("[island] Browser media {action} blocked by browser scripting permissions; enable 'Allow JavaScript from Apple Events' in the browser's Developer menu.");
        }
        Err(error) => eprintln!("[island] Browser media {action} unavailable: {error}"),
    }
}

#[cfg(target_os = "macos")]
fn run_osascript(script: &str) -> Result<String, String> {
    let output = Command::new("/usr/bin/osascript")
        .args(["-e", script])
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

#[tauri::command]
pub fn pause_media_for_listening(state: State<'_, MediaControl>) {
    #[cfg(target_os = "macos")]
    {
        let spotify_paused = run_osascript(SPOTIFY_PAUSE)
            .map(|result| result == "paused")
            .unwrap_or_else(|error| {
                eprintln!("[island] Spotify pause unavailable: {error}");
                false
            });
        if let Ok(mut paused) = state.spotify_paused.lock() {
            *paused = spotify_paused;
        }
        log_browser_failures("pause", run_osascript(&browser_script(BROWSER_MEDIA_PAUSE)));
    }
    #[cfg(not(target_os = "macos"))]
    let _ = state;
}

#[tauri::command]
pub fn resume_media_after_listening(state: State<'_, MediaControl>) {
    #[cfg(target_os = "macos")]
    {
        let spotify_paused = state
            .spotify_paused
            .lock()
            .map(|mut paused| std::mem::replace(&mut *paused, false))
            .unwrap_or(false);
        if spotify_paused {
            if let Err(error) = run_osascript(SPOTIFY_RESUME) {
                eprintln!("[island] Spotify resume unavailable: {error}");
            }
        }
        log_browser_failures(
            "resume",
            run_osascript(&browser_script(BROWSER_MEDIA_RESUME)),
        );
    }
    #[cfg(not(target_os = "macos"))]
    let _ = state;
}
