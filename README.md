# Cue

Cue is an early macOS desktop assistant built around a compact pill in the MacBook notch. It connects AI tasks to browser and sandbox tools through Solari.

This repository contains the Tauri app, its TypeScript orchestrator, and the landing page in `landing/`. Cue is an alpha project; packaged distribution and fresh-machine setup are still being completed. See [`INTERN-ABNAHME-CHECKLISTE.md`](INTERN-ABNAHME-CHECKLISTE.md) for current acceptance work.

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

3. Add your Solari and AI Gateway credentials in Cue's onboarding. The app stores them in the macOS Keychain. The standalone orchestrator also reads `SOLARI_API_KEY` and `AI_GATEWAY_API_KEY` from its environment.

The landing page is static; open `landing/index.html` directly or serve the `landing/` directory with any local static web server.

## Status

Cue is a prototype. Browser and sandbox runs require valid provider credentials and network access. The current sidecar is Apple Silicon-only. The acceptance checklist tracks packaging, portability, and end-to-end verification; do not treat this repository as a stable release yet.

## License

Cue is licensed under the MIT License. See [`LICENSE`](LICENSE).
