# Cue for macOS

This directory contains Cue's Tauri desktop application. For project overview, setup, build instructions, and current limitations, see the [repository README](../README.md).

## Run the app in development

From this directory, install dependencies and start the Tauri development app with the repository root as the project directory:

```sh
bun install
CUE_PROJECT_DIR=.. bun run tauri dev
```

The app's first-run onboarding configures provider keys and requests the permissions needed for voice input and the global shortcut. See [CONTRIBUTING.md](../CONTRIBUTING.md) for local checks.
