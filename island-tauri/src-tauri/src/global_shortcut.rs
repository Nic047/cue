//! Native shortcut recording and global tap/hold handling.
//! CGEventTap supports standalone modifiers and arbitrary key chords.
//! Escape is consumed only while cue or an active task needs it.

use objc2::{class, msg_send, runtime::AnyObject};
use objc2_foundation::NSString;
use serde::{Deserialize, Serialize};
use std::os::raw::c_void;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager};

const K_CG_SESSION_EVENT_TAP: u32 = 1;
const K_CG_HEAD_INSERT_EVENT_TAP: u32 = 0;
const K_CG_EVENT_TAP_OPTION_DEFAULT: u32 = 0; // aktiv: Events duerfen geschluckt werden
const K_CG_EVENT_FLAGS_CHANGED: u32 = 12;
const K_CG_EVENT_KEY_DOWN: u32 = 10;
const K_CG_EVENT_KEY_UP: u32 = 11;
const MODIFIERS: u64 = 0x1e0000;
const DEVICE_MODIFIERS: u64 = 0x80207f;
const K_CG_KEYBOARD_EVENT_KEYCODE: u64 = 9; // CGEventField kCGKeyboardEventKeycode
const K_CG_KEYBOARD_EVENT_AUTOREPEAT: u64 = 8; // CGEventField kCGKeyboardEventAutorepeat (Header: CGEventTypes.h)
const K_CG_EVENT_TAP_DISABLED_BY_TIMEOUT: u32 = 0xFFFFFFFE;
const K_CG_EVENT_TAP_DISABLED_BY_USER_INPUT: u32 = 0xFFFFFFFF;
const K_VK_ESCAPE: u16 = 53; // kVK_Escape

type CGEventTapCallBack = unsafe extern "C" fn(
    proxy: *mut c_void,
    etype: u32,
    event: *mut c_void,
    userinfo: *mut c_void,
) -> *mut c_void;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventTapCreate(
        tap: u32,
        place: u32,
        options: u32,
        events_of_interest: u64,
        callback: CGEventTapCallBack,
        user_info: *mut c_void,
    ) -> *mut c_void; // CFMachPortRef
    fn CGEventTapEnable(tap: *mut c_void, enable: bool);
    fn CGEventTapIsEnabled(tap: *mut c_void) -> bool;
    fn CGEventGetFlags(event: *mut c_void) -> u64;
    fn CGEventGetLocation(event: *mut c_void) -> objc2_foundation::NSPoint;
    fn CGEventCreateCopy(event: *mut c_void) -> *mut c_void;
    fn CGEventGetIntegerValueField(event: *mut c_void, field: u64) -> i64;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    // CFStringRef kCFRunLoopCommonModes – echtes globales Symbol.
    #[link_name = "kCFRunLoopCommonModes"]
    static K_CF_RUNLOOP_COMMON_MODES: *const c_void;
    fn CFMachPortCreateRunLoopSource(
        allocator: *mut c_void,
        port: *mut c_void,
        order: i64,
    ) -> *mut c_void;
    fn CFRunLoopAddSource(rl: *mut c_void, source: *mut c_void, modes: *mut c_void);
    fn CFRunLoopGetCurrent() -> *mut c_void;
    fn CFRunLoopRun();
    fn CFRelease(value: *const c_void);
}

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

/// Emit shortcut events on press/release edges, avoiding repeated modifier events.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Shortcut {
    pub key_code: Option<u16>,
    pub modifiers: u64,
    pub modifier_mask: u64,
    pub label: String,
}
impl Default for Shortcut {
    fn default() -> Self {
        Self {
            key_code: None,
            modifiers: 0,
            modifier_mask: 0x40,
            label: "right ⌥".into(),
        }
    }
}
impl Shortcut {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "" | "right-option" => return Ok(Self::default()),
            "right-control" => {
                return Ok(Self {
                    modifier_mask: 0x2000,
                    label: "right ⌃".into(),
                    ..Self::default()
                })
            }
            "right-shift" => {
                return Ok(Self {
                    modifier_mask: 4,
                    label: "right ⇧".into(),
                    ..Self::default()
                })
            }
            _ => {}
        }
        let shortcut: Self =
            serde_json::from_str(value).map_err(|_| "Record a shortcut first.".to_string())?;
        let valid = shortcut.modifiers & !MODIFIERS == 0
            && shortcut.label.len() <= 80
            && !shortcut.label.is_empty()
            && match shortcut.key_code {
                Some(code) => {
                    code <= 126
                        && code != 53
                        && modifier_key(code).is_none()
                        && shortcut.modifier_mask == 0
                }
                None => {
                    shortcut.modifier_mask != 0 && shortcut.modifier_mask & !DEVICE_MODIFIERS == 0
                }
            };
        if !valid {
            return Err("Choose a key or modifier. Escape is reserved for closing cue.".into());
        }
        Ok(shortcut)
    }
    fn modifiers_match(&self, flags: u64) -> bool {
        flags & MODIFIERS == self.modifiers
    }
}
static SHORTCUT: OnceLock<Mutex<Shortcut>> = OnceLock::new();
pub fn set_shortcut(value: &str) {
    *SHORTCUT
        .get_or_init(|| Mutex::new(Shortcut::default()))
        .lock()
        .unwrap() = Shortcut::parse(value).unwrap_or_default();
}
static CAPTURING: AtomicBool = AtomicBool::new(false);
static CAPTURE_REVISION: AtomicUsize = AtomicUsize::new(0);
#[tauri::command]
pub fn capture_shortcut(active: bool) -> Result<(), String> {
    if active && !is_ready() {
        return Err("Grant Accessibility permission first.".into());
    }
    CAPTURE_REVISION.fetch_add(1, Ordering::SeqCst);
    CAPTURING.store(active, Ordering::SeqCst);
    Ok(())
}
fn modifier_key(code: u16) -> Option<(u64, &'static str)> {
    match code {
        54 => Some((16, "right ⌘")),
        55 => Some((8, "left ⌘")),
        56 => Some((2, "left ⇧")),
        60 => Some((4, "right ⇧")),
        58 => Some((32, "left ⌥")),
        61 => Some((64, "right ⌥")),
        59 => Some((1, "left ⌃")),
        62 => Some((8192, "right ⌃")),
        63 => Some((0x800000, "fn")),
        _ => None,
    }
}
fn capture_result(shortcut: Option<Shortcut>) {
    if let Some(app) = APP_HANDLE.get() {
        let _ = app.emit("shortcut-captured", shortcut);
    }
}
fn emit_shortcut(pressed: bool) {
    if let Some(app) = APP_HANDLE.get() {
        let _ = app.emit_to(
            "main",
            if pressed {
                "shortcut-pressed"
            } else {
                "shortcut-released"
            },
            (),
        );
    }
}

unsafe fn recorded_key_label(event: *mut c_void) -> String {
    let native: *mut AnyObject = msg_send![class!(NSEvent), eventWithCGEvent: event];
    if native.is_null() {
        return String::new();
    }
    let characters: *mut NSString = msg_send![native, charactersIgnoringModifiers];
    if characters.is_null() {
        return String::new();
    }
    let text = (&*characters).to_string();
    if text
        .chars()
        .all(|c| !c.is_control() && !c.is_whitespace() && !(('\u{f700}'..='\u{f8ff}').contains(&c)))
    {
        text.to_uppercase()
    } else {
        String::new()
    }
}

unsafe fn capture_key(event: *mut c_void, keycode: u16, flags: u64) {
    let revision = CAPTURE_REVISION.fetch_add(1, Ordering::SeqCst) + 1;
    let Some(app) = APP_HANDLE.get() else { return };
    let copied = CGEventCreateCopy(event) as usize;
    // AppKit's keyboard-layout lookup requires the main thread. Never block the event tap.
    if app
        .run_on_main_thread(move || {
            if CAPTURING.load(Ordering::SeqCst)
                && CAPTURE_REVISION.load(Ordering::SeqCst) == revision
            {
                objc2::rc::autoreleasepool(|_| {
                    capture_result(Some(Shortcut {
                        key_code: Some(keycode),
                        modifiers: flags & MODIFIERS,
                        modifier_mask: 0,
                        label: if copied == 0 {
                            String::new()
                        } else {
                            unsafe { recorded_key_label(copied as *mut c_void) }
                        },
                    }));
                });
            }
            if copied != 0 {
                unsafe { CFRelease(copied as *const c_void) };
            }
        })
        .is_err()
        && copied != 0
    {
        CFRelease(copied as *const c_void);
    }
}

static OPTION_HELD: AtomicBool = AtomicBool::new(false);

/// Keep the event tap handle so disabled taps can be re-enabled.
static ENABLED: AtomicBool = AtomicBool::new(false);
static INSTALLING: AtomicBool = AtomicBool::new(false);
static PERMISSION_FAILURE_REPORTED: AtomicBool = AtomicBool::new(false);
pub fn set_enabled(enabled: bool) {
    ENABLED.store(enabled, Ordering::SeqCst);
}
pub fn is_enabled() -> bool {
    ENABLED.load(Ordering::SeqCst)
}
pub fn is_ready() -> bool {
    let tap = TAP_HANDLE.load(Ordering::SeqCst) as *mut c_void;
    !tap.is_null() && unsafe { CGEventTapIsEnabled(tap) }
}

static TAP_HANDLE: AtomicUsize = AtomicUsize::new(0);

/// Pill visibility is one condition for intercepting Escape.
static PILL_OPEN: AtomicBool = AtomicBool::new(false);

pub fn set_pill_open(open: bool) {
    PILL_OPEN.store(open, Ordering::SeqCst);
}

/// Active background tasks also intercept Escape, allowing cancellation while hidden.
static TASK_ACTIVE: AtomicBool = AtomicBool::new(false);

pub fn set_task_active(active: bool) {
    TASK_ACTIVE.store(active, Ordering::SeqCst);
}

/// Intercept Escape when the pill is visible or a task is active.
fn esc_is_ours() -> bool {
    PILL_OPEN.load(Ordering::SeqCst) || TASK_ACTIVE.load(Ordering::SeqCst)
}

unsafe extern "C" fn on_flags_changed(
    _proxy: *mut c_void,
    etype: u32,
    event: *mut c_void,
    _userinfo: *mut c_void,
) -> *mut c_void {
    // Re-enable disabled taps immediately. Their event pointer is null and must not be dereferenced.
    if etype == K_CG_EVENT_TAP_DISABLED_BY_TIMEOUT || etype == K_CG_EVENT_TAP_DISABLED_BY_USER_INPUT
    {
        let tap = TAP_HANDLE.load(Ordering::SeqCst) as *mut c_void;
        if !tap.is_null() {
            CGEventTapEnable(tap, true);
            eprintln!("[island] Event tap was disabled; re-enabled.");
        }
        return std::ptr::null_mut();
    }
    if etype == 1 || etype == 3 {
        if let Some(app) = APP_HANDLE.get() {
            let point = CGEventGetLocation(event);
            crate::window_layout::dismiss_if_outside(app, point.x, point.y);
        }
        return event; // Never consume another app's mouse click.
    }
    let flags = CGEventGetFlags(event);
    let keycode = CGEventGetIntegerValueField(event, K_CG_KEYBOARD_EVENT_KEYCODE) as u16;
    if CAPTURING.load(Ordering::SeqCst) {
        if etype == K_CG_EVENT_KEY_DOWN {
            if CGEventGetIntegerValueField(event, K_CG_KEYBOARD_EVENT_AUTOREPEAT) != 0 {
                return std::ptr::null_mut();
            }
            if keycode == K_VK_ESCAPE {
                CAPTURE_REVISION.fetch_add(1, Ordering::SeqCst);
                capture_result(None);
            } else if keycode == 36 || keycode == 76 {
                if let Some(app) = APP_HANDLE.get() {
                    let _ = app.emit("shortcut-confirm", ());
                }
            } else {
                capture_key(event, keycode, flags);
            }
            return std::ptr::null_mut();
        }
        if etype == K_CG_EVENT_FLAGS_CHANGED {
            if let Some((mask, _)) = modifier_key(keycode) {
                if flags & mask != 0 {
                    CAPTURE_REVISION.fetch_add(1, Ordering::SeqCst);
                    let captured = flags & DEVICE_MODIFIERS;
                    let label = [59, 62, 58, 61, 56, 60, 55, 54, 63]
                        .iter()
                        .filter_map(|code| modifier_key(*code))
                        .filter(|(bit, _)| captured & bit != 0)
                        .map(|(_, name)| name)
                        .collect::<Vec<_>>()
                        .join(" + ");
                    capture_result(Some(Shortcut {
                        key_code: None,
                        modifiers: 0,
                        modifier_mask: captured,
                        label,
                    }));
                }
            }
        }
        return if etype == K_CG_EVENT_KEY_UP {
            std::ptr::null_mut()
        } else {
            event
        };
    }
    if is_enabled() {
        let shortcut = SHORTCUT
            .get_or_init(|| Mutex::new(Shortcut::default()))
            .lock()
            .unwrap()
            .clone();
        if etype == K_CG_EVENT_FLAGS_CHANGED && shortcut.key_code.is_none() {
            let pressed = flags & shortcut.modifier_mask == shortcut.modifier_mask;
            if OPTION_HELD.swap(pressed, Ordering::SeqCst) != pressed {
                emit_shortcut(pressed);
            }
        } else if let Some(code) = shortcut.key_code {
            if etype == K_CG_EVENT_KEY_DOWN && keycode == code && shortcut.modifiers_match(flags) {
                if !OPTION_HELD.swap(true, Ordering::SeqCst) {
                    emit_shortcut(true);
                }
                return std::ptr::null_mut();
            }
            if OPTION_HELD.load(Ordering::SeqCst)
                && ((etype == K_CG_EVENT_KEY_UP && keycode == code)
                    || (etype == K_CG_EVENT_FLAGS_CHANGED && !shortcut.modifiers_match(flags)))
            {
                OPTION_HELD.store(false, Ordering::SeqCst);
                emit_shortcut(false);
                if etype == K_CG_EVENT_KEY_UP {
                    return std::ptr::null_mut();
                }
            }
        }
    } else {
        OPTION_HELD.store(false, Ordering::SeqCst);
    }
    if etype == K_CG_EVENT_KEY_DOWN {
        if keycode == K_VK_ESCAPE {
            if !esc_is_ours() {
                return event; // No pill or task: pass through without emitting.
            }
            // Swallow Escape autorepeat without emitting another event; holding must not count as double-tapping.
            let repeat = CGEventGetIntegerValueField(event, K_CG_KEYBOARD_EVENT_AUTOREPEAT);
            if repeat != 0 {
                return std::ptr::null_mut();
            }
            if let Some(app) = APP_HANDLE.get() {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.emit("escape-pressed", ());
                }
            }
            eprintln!("[island] Escape handled while the pill is open.");
            return std::ptr::null_mut(); // Consumed; do not forward to the foreground app.
        }
    }
    event
}

pub fn install(app: AppHandle) {
    let _ = APP_HANDLE.set(app);
    if TAP_HANDLE.load(Ordering::SeqCst) != 0 || INSTALLING.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(|| unsafe {
        let tap = CGEventTapCreate(
            K_CG_SESSION_EVENT_TAP,
            K_CG_HEAD_INSERT_EVENT_TAP,
            K_CG_EVENT_TAP_OPTION_DEFAULT,
            (1u64 << K_CG_EVENT_FLAGS_CHANGED)
                | (1u64 << K_CG_EVENT_KEY_DOWN)
                | (1u64 << K_CG_EVENT_KEY_UP)
                | (1u64 << 1)
                | (1u64 << 3),
            on_flags_changed,
            std::ptr::null_mut(),
        );
        if tap.is_null() {
            INSTALLING.store(false, Ordering::SeqCst);
            if !PERMISSION_FAILURE_REPORTED.swap(true, Ordering::SeqCst) {
                eprintln!("[cue] Shortcut access denied. Enable cue in System Settings > Privacy & Security > Accessibility.");
            }
            return;
        }
        CGEventTapEnable(tap, true);
        TAP_HANDLE.store(tap as usize, Ordering::SeqCst);
        let source = CFMachPortCreateRunLoopSource(std::ptr::null_mut(), tap, 0);
        CFRunLoopAddSource(
            CFRunLoopGetCurrent(),
            source,
            K_CF_RUNLOOP_COMMON_MODES as *mut c_void,
        );
        CFRunLoopRun(); // Keep this dedicated event thread alive.
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shortcuts_validate_and_match() {
        let legacy = Shortcut::parse("right-option").unwrap();
        assert_eq!(legacy.modifier_mask, 64);
        let chord = Shortcut {
            key_code: Some(40),
            modifiers: 0x180000,
            modifier_mask: 0,
            label: "⌥⌘K".into(),
        };
        let parsed = Shortcut::parse(&serde_json::to_string(&chord).unwrap()).unwrap();
        assert!(parsed.modifiers_match(0x180100));
        assert!(!parsed.modifiers_match(0x1a0000));
        assert!(Shortcut::parse(
            "{\"keyCode\":53,\"modifiers\":0,\"modifierMask\":0,\"label\":\"Esc\"}"
        )
        .is_err());
        assert!(Shortcut::parse("{}").is_err());
        let modifiers = Shortcut {
            key_code: None,
            modifiers: 0,
            modifier_mask: 0x42,
            label: "left ⇧ + right ⌥".into(),
        };
        assert!(Shortcut::parse(&serde_json::to_string(&modifiers).unwrap()).is_ok());
        let invalid = Shortcut {
            modifier_mask: 0x100,
            ..modifiers
        };
        assert!(Shortcut::parse(&serde_json::to_string(&invalid).unwrap()).is_err());
    }
}
