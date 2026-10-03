# Cue

**Say what you want done. Keep working.**

Cue is an open-source macOS assistant that lets you hand off browser and sandbox tasks to AI agents while you continue working. It lives in the menu bar and, on supported MacBook displays, can sit around the notch.

[Download Cue](https://trycue.lol/) · [Source code](https://github.com/Nic047/cue) · [Report a bug](https://github.com/Nic047/cue/issues)

## Project status

Cue is an early alpha for evaluation. It currently supports Apple Silicon Macs and requires your own Solari, Vercel AI Gateway, and Groq API keys. The downloadable build is not notarized by Apple, and a clean-machine installation has not yet been fully verified. Expect rough edges; do not rely on Cue for important or time-sensitive work.

## What it does

- Start a task by voice or keyboard shortcut.
- Run browser and sandbox work in parallel while Cue stays in the menu bar.
- Review the result, task details, and recent chats in a compact panel.

Browser agents use separate cloud sessions, not your signed-in local browser. Their instructions prohibit purchases, account changes, and form submissions other than public searches. These are model instructions, not a technical guarantee: browser tools can interact with pages. See [Security boundaries](SECURITY.md#security-boundaries).

## Install

Download the Apple Silicon build from [trycue.lol](https://trycue.lol/), open the DMG, and drag Cue to Applications. On first launch, onboarding guides you through Microphone and Accessibility permissions, microphone selection, your shortcut, and provider keys.

## Develop

Development requires macOS, Apple Silicon, Node.js 22 or later, Bun, and the Rust toolchain used by Tauri 2. Xcode Command Line Tools must be installed for native builds.

```sh
bun install
cd island-tauri
bun install
CUE_PROJECT_DIR=.. bun run tauri dev
```

Add keys through onboarding. For standalone orchestrator development, copy `.env.example` to `.env` and add `SOLARI_API_KEY`, `AI_GATEWAY_API_KEY`, and `GROQ_API_KEY`. Never commit real keys.

The landing page lives in `landing/` and can be served with any static web server.

## Build an unsigned app

From the repository root, install the build-only DMG tools once, then build from `island-tauri/`:

```sh
python3 -m venv /private/tmp/cue-dmg-tools
/private/tmp/cue-dmg-tools/bin/python -m pip install -r scripts/requirements-dmg.txt
cd island-tauri
bun run bundle:unsigned
```

The app is created under `island-tauri/src-tauri/target/release/bundle/macos/`; the DMG is written to `landing/downloads/`. These Python packages are used only to lay out the installer and are not shipped with Cue. The app is ad hoc signed but not notarized, and standard Gatekeeper installation is not verified. Signing and notarizing the complete app—including its embedded Node runtime and sidecar—are still required for a smooth public release.

## Providers and privacy

Cue stores app credentials in the macOS Keychain. Voice audio is sent to Groq for transcription; the resulting prompt and task context are processed by the configured agent and model providers. A task may also send relevant page content to the tools it uses. Recent chats are stored locally in WebView storage; exported files stay in `~/Downloads/Cue` until you remove them. Terminal logs may contain task content and URLs. Sandbox preview links are public and expire ten minutes after completion. Review your providers’ policies and avoid sensitive data in this alpha.

## Repository layout

- `island-tauri/` — macOS app and UI
- `orchestrator.ts`, `browser-tools.ts`, `sandbox-tools.ts` — task orchestration and agent tools
- `agent/`, `shared/` — planning, execution, result synthesis, and validated events
- `scripts/` — packaging and local checks
- `landing/` — download site source and download worker

See [Architecture](docs/CODE-MAINTENANCE.md) for the runtime flow and module map.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and contribution guidance. Please include the checks you ran and any limitations in pull requests.

## Security

Please report suspected vulnerabilities privately. See [SECURITY.md](SECURITY.md); do not post credentials or exploitable details in public issues.

## License

Cue is licensed under the [MIT License](LICENSE). Bundled Geist fonts use the [SIL Open Font License](island-tauri/public/OFL-Geist.txt); dependencies retain their respective licenses.
