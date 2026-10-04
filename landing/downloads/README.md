# cue alpha download

Current installer: https://trycue.lol/downloads/Cue-0.1.6-apple-silicon.dmg

Size: 52,941,709 bytes. SHA-256: `e445c88b6450f97302212b9bd1b1585c06d70c01c916a647b7c9218cd178e253`.

Version 0.1.6 removes the data-URL fetch blocked by packaged CSP after microphone recording. Native WAV size is checked in memory, and actual recording errors reach onboarding. Frontend/release build, sealed app signatures, and DMG checksum verified; live voice demo still needs a user run.

Version 0.1.5 opens pending onboarding after application startup, checks current permissions as well as saved setup, and restores dismissed setup when cue is reopened. The download notice explains the manual macOS Open Anyway step and remains visible until dismissed. Build, sealed app signatures, and DMG checksum verified; GUI first-launch behavior still needs a user check.

Version 0.1.4 includes the UI/backend responsibility refactor, validated shared event protocol, and corrected timeout cleanup. The packaged sidecar starts outside the repository; app version, signatures, and DMG checksum verified.

Version 0.1.3 adds the compact model picker shared by onboarding and Settings. Frontend build, sealed app signatures, and DMG checksum verified.

Version 0.1.2 uses normal app windows for onboarding/settings so native permission dialogs can appear in front. Setup supports dragging, minimizing, and restoring from the Dock without losing the current step. Build, signatures, and DMG checksum verified; live permission-dialog stacking remains to be checked by the user.

Version 0.1.1 retries the actual native shortcut connection while permissions are checked, offers a safe restart for macOS permission caching, and explicitly sets the runtime Dock icon from the bundled cue artwork. The app and installer use version 0.1.1. Packaging checks pass; a fresh GUI permission grant and Dock appearance still require a user run.

Revision 5 changed only the installer: the 640 × 420 layout is configured in `bundle.macOS.dmg`, the Finder view-mode metadata is corrected (`icvl`), and the volume name is unique. Its cue executable is byte-for-byte identical to revision 4. Use `node scripts/package-macos.mjs --installer-only` to repackage without rebuilding/re-signing the app. Revision 4 separates permission status from shortcut readiness, refreshes status on focus, checks CoreGraphics event permission too, and keeps setup reachable in the Dock behind System Settings. The Dock returns to menu-bar-only mode when setup closes. Old macOS Accessibility entries may still need replacing after an ad hoc signed update. Revision 3 added the cue app/volume icons, a custom Finder installer layout, independent first-run onboarding for installed builds, and hides setup while macOS permissions are granted. Revision 2 repaired the invalid Node signature and replaces the shell sidecar with a signable native launcher. The app is ad hoc signed, **not Developer ID signed or notarized**. The mounted DMG passes `codesign --verify --deep --strict`; its Node runtime starts, and `hdiutil verify` passes. Gatekeeper assessment still rejects this alpha, so standard downloaded-app installation remains unverified and requires Developer ID signing/notarization for a trusted release.

From `cue-app`, run `bun run bundle:unsigned`. The script signs the runtime, native launcher, and outer app in order, verifies the sealed app, creates a drag-and-drop DMG with an Applications shortcut, and verifies its checksum. No app is launched during packaging.

The binary is ignored by Git. `landing/download-worker.js` is the hosted handler using the Sites-managed R2 binding `BUCKET`. The authoritative website source is the Sites checkout. Upload credentials and temporary upload routes must be removed after publishing. Use a new filename for changed installers to avoid serving cached old files.

## Website analytics

The landing page uses Umami Cloud to track pageviews and installer-link clicks. The download Worker separately sends an `Installer request served` event after a successful installer GET; it omits client IP and referrer. Umami is configured to honor Do Not Track and exclude URL query strings. A served request indicates the file response started, not that installation completed.
