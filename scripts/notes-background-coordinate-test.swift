#!/usr/bin/swift
import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

func stop(_ message: String) -> Never {
    fputs("\(message)\n", stderr)
    exit(1)
}

func pause(_ seconds: TimeInterval) {
    RunLoop.current.run(until: Date().addingTimeInterval(seconds))
}

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}

guard AXIsProcessTrusted() else {
    stop("Terminal needs Accessibility permission in System Settings → Privacy & Security → Accessibility. No input sent.")
}

let launch = Process()
launch.executableURL = URL(fileURLWithPath: "/usr/bin/open")
launch.arguments = ["-g", "/System/Applications/Notes.app"]
do {
    try launch.run()
    launch.waitUntilExit()
} catch {
    stop("Could not launch Notes: \(error.localizedDescription)")
}
guard launch.terminationStatus == 0 else { stop("Notes did not launch.") }

print("Notes requested in the background. Switch to Codex or keep another app in front; starting in 5 seconds…")
fflush(stdout)
pause(5)
guard let notes = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.Notes").first,
      !notes.isTerminated else { stop("Notes process not found.") }
guard let foreground = NSWorkspace.shared.frontmostApplication,
      foreground.processIdentifier != notes.processIdentifier else {
    stop("Notes is frontmost. Switch to another app and rerun for the background test.")
}
let pid = notes.processIdentifier
let app = AXUIElementCreateApplication(pid)

func checkForeground() {
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == foreground.processIdentifier else {
        stop("Foreground changed; stopping further input. Background interaction was not maintained.")
    }
}

func click(_ point: CGPoint) {
    checkForeground()
    let windows = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]] ?? []
    let candidates = windows.filter { window in
        guard (window[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid,
              (window[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
              let bounds = window[kCGWindowBounds as String] as? [String: Any],
              let frame = CGRect(dictionaryRepresentation: bounds as CFDictionary) else { return false }
        return frame.width > 300 && frame.height > 200 && frame.contains(point)
    }
    guard let window = candidates.first,
          let windowID = window[kCGWindowNumber as String] as? NSNumber else {
        stop("No Notes window covers (\(Int(point.x)), \(Int(point.y))). Keep its window open at those screen coordinates; no click sent.")
    }

    var hit: AXUIElement?
    if AXUIElementCopyElementAtPosition(app, Float(point.x), Float(point.y), &hit) == .success,
       let hit {
        var actions: CFArray?
        if AXUIElementCopyActionNames(hit, &actions) == .success,
           (actions as? [String])?.contains(kAXPressAction as String) == true,
           AXUIElementPerformAction(hit, kAXPressAction as CFString) == .success {
            pause(0.3)
            checkForeground()
            print("(\(Int(point.x)), \(Int(point.y)): Notes accepted an Accessibility press.")
            return
        }
    }

    let source = CGEventSource(stateID: .privateState)
    for type in [CGEventType.mouseMoved, .leftMouseDown, .leftMouseUp] {
        guard let event = CGEvent(mouseEventSource: source, mouseType: type,
                                  mouseCursorPosition: point, mouseButton: .left) else {
            stop("Could not create mouse events.")
        }
        event.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: windowID.int64Value)
        event.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent, value: windowID.int64Value)
        if type != .mouseMoved {
            event.setIntegerValueField(.mouseEventClickState, value: 1)
            event.setIntegerValueField(.mouseEventNumber, value: 1)
        }
        event.postToPid(pid)
        pause(type == .leftMouseDown ? 0.35 : 0.15)
    }
    checkForeground()
    print("(\(Int(point.x)), \(Int(point.y)): move/down/up sent to Notes window \(windowID); acceptance not yet verified.")
}

click(CGPoint(x: 400, y: 491))
click(CGPoint(x: 800, y: 450))

func focusedEditor() -> AXUIElement? {
    guard let value = attribute(app, kAXFocusedUIElementAttribute),
          CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    let element = value as! AXUIElement
    let role = attribute(element, kAXRoleAttribute) as? String
    guard role == kAXTextAreaRole || role == kAXTextFieldRole,
          let positionValue = attribute(element, kAXPositionAttribute),
          let sizeValue = attribute(element, kAXSizeAttribute),
          CFGetTypeID(positionValue) == AXValueGetTypeID(),
          CFGetTypeID(sizeValue) == AXValueGetTypeID() else { return nil }
    var position = CGPoint.zero
    var size = CGSize.zero
    guard AXValueGetValue(positionValue as! AXValue, .cgPoint, &position),
          AXValueGetValue(sizeValue as! AXValue, .cgSize, &size),
          CGRect(origin: position, size: size).contains(CGPoint(x: 800, y: 450)) else { return nil }
    return element
}

// Focus the text control under the second coordinate if the mouse event was ignored.
if focusedEditor() == nil {
    var hit: AXUIElement?
    if AXUIElementCopyElementAtPosition(app, 800, 450, &hit) == .success, let hit {
        let role = attribute(hit, kAXRoleAttribute) as? String
        if role == kAXTextAreaRole || role == kAXTextFieldRole {
            _ = AXUIElementSetAttributeValue(hit, kAXFocusedAttribute as CFString, kCFBooleanTrue)
            pause(0.2)
        }
    }
}
checkForeground()
guard let editor = focusedEditor() else {
    stop("The clicks did not focus a Notes text field. No text sent; this background click attempt failed.")
}
let before = attribute(editor, kAXValueAttribute) as? String

for character in "Hallöchen" {
    checkForeground()
    guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
          let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) else {
        stop("Could not create keyboard events.")
    }
    let utf16 = Array(String(character).utf16)
    utf16.withUnsafeBufferPointer {
        down.keyboardSetUnicodeString(stringLength: $0.count, unicodeString: $0.baseAddress)
        up.keyboardSetUnicodeString(stringLength: $0.count, unicodeString: $0.baseAddress)
    }
    down.postToPid(pid)
    pause(0.06)
    up.postToPid(pid)
    pause(0.04)
}
pause(0.4)
checkForeground()
if let after = attribute(editor, kAXValueAttribute) as? String,
   after != before, after.contains("Hallöchen") {
    print("Verified: ‘Hallöchen’ appeared in Notes. \(foreground.localizedName ?? "Your app") stayed frontmost.")
} else {
    stop("Typing events sent, but ‘Hallöchen’ could not be verified in the text field. Check Notes; success is unconfirmed.")
}
