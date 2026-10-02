# Cue alpha download

Current installer: https://trycue.lol/downloads/Cue-0.1.2-apple-silicon.dmg

Size: 52,935,643 bytes. SHA-256: `dc92ee97b58d9e452e2215137f002343b207c536d60eea76f727bb2ad34b275e`.

Version 0.1.2 uses normal app windows for onboarding/settings so native permission dialogs can appear in front. Setup supports dragging, minimizing, and restoring from the Dock without losing the current step. Build, signatures, and DMG checksum verified; live permission-dialog stacking remains to be checked by the user.

Version 0.1.1 retries the actual native shortcut connection while permissions are checked, offers a safe restart for macOS permission caching, and explicitly sets the runtime Dock icon from the bundled Cue artwork. The app and installer use version 0.1.1. Packaging checks pass; a fresh GUI permission grant and Dock appearance still require a user run.

Revision 5 changed only the installer: the 640 × 420 layout is configured in `bundle.macOS.dmg`, the Finder view-mode metadata is corrected (`icvl`), and the volume name is unique. Its Cue executable is byte-for-byte identical to revision 4. Use `node scripts/package-macos.mjs --installer-only` to repackage without rebuilding/re-signing the app. Revision 4 separates permission status from shortcut readiness, refreshes status on focus, checks CoreGraphics event permission too, and keeps setup reachable in the Dock behind System Settings. The Dock returns to menu-bar-only mode when setup closes. Old macOS Accessibility entries may still need replacing after an ad hoc signed update. Revision 3 added the Cue app/volume icons, a custom Finder installer layout, independent first-run onboarding for installed builds, and hides setup while macOS permissions are granted. Revision 2 repaired the invalid Node signature and replaces the shell sidecar with a signable native launcher. The app is ad hoc signed, **not Developer ID signed or notarized**. The mounted DMG passes `codesign --verify --deep --strict`; its Node runtime starts, and `hdiutil verify` passes. Gatekeeper assessment still rejects this alpha, so standard downloaded-app installation remains unverified and requires Developer ID signing/notarization for a trusted release.

From `island-tauri`, run `bun run bundle:unsigned`. The script signs the runtime, native launcher, and outer app in order, verifies the sealed app, creates a drag-and-drop DMG with an Applications shortcut, and verifies its checksum. No app is launched during packaging.

The binary is ignored by Git. `landing/download-worker.js` is the hosted handler using the Sites-managed R2 binding `BUCKET`. The authoritative website source is the Sites checkout. Upload credentials and temporary upload routes must be removed after publishing. Use a new filename for changed installers to avoid serving cached old files.

## Website analytics

The Site worker optionally injects Umami Cloud when the public `UMAMI_WEBSITE_ID` Site environment variable is set. It tracks pageviews, installer link clicks, and successful installer GET requests as separate events. It omits IP, query strings, referrers, and custom visitor data; Umami is configured to honor Do Not Track. Create the site in Umami, set the exact Website ID under Sites environment variables, then deploy the current saved source version to activate tracking. A served request indicates the file response started, not that installation completed.
