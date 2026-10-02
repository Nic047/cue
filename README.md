# Cue

Cue is an early macOS desktop assistant built around a compact pill in the MacBook notch. It connects AI tasks to browser and sandbox tools through Solari.

This repository contains the Tauri app, its TypeScript orchestrator, and the landing page in `landing/`. Cue is an unsigned alpha; fresh-machine acceptance and signed distribution are still being completed. See [`INTERN-ABNAHME-CHECKLISTE.md`](INTERN-ABNAHME-CHECKLISTE.md) for current acceptance work.

## Development

Requirements: macOS, Bun, Node.js, and the Rust toolchain required by Tauri 2.

1. Clone this repository and install dependencies:

   ```sh
   bun install
   cd island-tauri
   bun install
   ```

2. Start the Tauri development app from `island-tauri`, setting the project directory to the repository root:

   ```sh
   CUE_PROJECT_DIR=.. bun run tauri dev
   ```

3. Add your Solari, Vercel AI Gateway, and Groq (voice transcription) credentials in Cue's onboarding. The app stores them in the macOS Keychain. The standalone orchestrator also reads `SOLARI_API_KEY`, `AI_GATEWAY_API_KEY`, and `GROQ_API_KEY` from its environment.

The landing page is static; open `landing/index.html` directly or serve the `landing/` directory with any local static web server.

## Status

Cue is a prototype. Browser and sandbox runs require valid provider credentials and network access. The current sidecar is Apple Silicon-only. The acceptance checklist tracks packaging, portability, and end-to-end verification; do not treat this repository as a stable release yet.

## License

Cue is licensed under the MIT License. See [`LICENSE`](LICENSE).

## Build an Apple Silicon app

Use an arm64 Node.js 22+ runtime, Bun, npm, and Rust on macOS. From `island-tauri`:

```sh
bun run bundle:unsigned
```

The build packages Node, the orchestrator, and its production dependencies. The installed app does not use `npx`, download a runtime, or require the repository. The app bundle is generated at `island-tauri/src-tauri/target/release/bundle/macos/Cue.app`. This ad hoc signed build is for local acceptance; signing/notarization and testing on another Mac remain release requirements.

Allow Microphone (voice input) and Accessibility (global shortcut) in System Settings when prompted. Keys stay in the macOS Keychain. Get credentials from [Solari](https://console.getsolari.com), [Vercel AI Gateway](https://vercel.com/dashboard/ai-gateway), and [Groq](https://console.groq.com/keys). Browser media control additionally requires the browser’s “Allow JavaScript from Apple Events” setting; agent execution does not depend on that permission.

### Reproducible acceptance demos

- Browser: “Open https://example.com, report its heading and main paragraph, and include the source link.” Expect **Example Domain** and the actual page text.
- Sandbox file: “Use Python to calculate the first 20 prime numbers, save them as primes.csv, export the file to my Mac, and list the numbers.” Expect 20 values from 2 through 71 and a file link. Click it to reveal the exported CSV in Finder.
- Preview: “Create a simple HTML page saying Hello Cue, serve it on port 3000, expose the port, and include the preview URL.” Open the URL in a second browser after the answer; test again before the displayed expiration and after expiration.
- Failure: “Run a sandbox shell command that exits with code 7. Do not repair it; report the failure.” Expect a failed task rather than a green success.

Exported files persist in `~/Downloads/Cue` until you delete them. Sandbox tasks without previews are destroyed when finished. Preview sessions use a server-enforced kill timeout of ten minutes, renewed at task completion; the answer includes their expiration. Closing the app does not extend the timeout. Cancelling an active task kills its sandbox. Remote expiration/availability still needs the real-provider acceptance test.

Local checks and remaining acceptance work: [`ABNAHME-NACHWEISE.md`](ABNAHME-NACHWEISE.md).

## Website download artifact

For the Finder layout, install the build-only tools once: `python3 -m venv /private/tmp/cue-dmg-tools && /private/tmp/cue-dmg-tools/bin/pip install -r scripts/requirements-dmg.txt` (or set `CUE_DMG_PYTHON` to an environment with those packages). These tools are not shipped inside Cue.

From `island-tauri`, run `bun run bundle:unsigned` to produce the Apple Silicon `.app` and `.dmg`. The DMG is in `../landing/downloads/`; use that file for a download link rather than the source checkout. No website deployment is performed by this command.

This command creates an **ad hoc signed, unnotarized alpha**. It compiles a native sidecar, signs the embedded Node runtime and sidecar before sealing the app, verifies the signatures, and verifies the DMG checksum. Label the download accordingly; standard Gatekeeper installation is not verified. For a signed release, use `bun run tauri build --bundles app,dmg` with your Developer ID setup and notarize the complete bundle, including its embedded Node runtime. Keep the existing app identifier stable across updates so preferences and permissions continue to refer to Cue.

Only one Cue process can own the menu bar and shortcut at a time. Quit the development app before opening the bundled app. Agent-runtime builds are staged before replacing the previous complete runtime; failed builds leave that runtime intact. Node’s license is included in the runtime resources.
