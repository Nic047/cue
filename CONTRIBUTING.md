# Contributing to Cue

Bug reports, documentation fixes, and focused pull requests are welcome. For larger changes, open an issue first so the scope can be discussed before implementation.

## Development setup

Cue is a macOS app and currently targets Apple Silicon. Follow the setup in the [README](README.md). Do not commit API keys, credentials, user data, or generated app bundles.

## Before opening a pull request

Run the checks available in your environment and report their results in the PR:

```sh
bun run check
cargo fmt --manifest-path island-tauri/src-tauri/Cargo.toml --check
cargo check --locked --manifest-path island-tauri/src-tauri/Cargo.toml
```

Cloud-backed demos require your own provider keys and may incur provider costs. Do not include real credentials or personal data in logs, screenshots, issues, or pull requests.

Keep changes focused, describe the user-visible effect, and call out checks you could not run.

## UI development without cloud calls

Run `bun run dev` in `island-tauri/`, then open `http://localhost:5173/?demo`. The harness provides recording, running, question, result, and failure states. It does not test macOS permissions or real microphone capture.

`bun run check` runs offline tool/event checks, TypeScript checking, and the frontend build. `scripts/check-cloud.mjs` and `scripts/check-packaged-agent.mjs` cover live-provider and packaged-runtime checks respectively; read their usage before running them. Real cloud checks use your credentials and can incur costs.

Use Bun for both JavaScript projects and commit their lockfiles. Keep documentation, comments, and built-in UI strings in English; agent answers should follow the user’s language. Put personal experiments in the ignored `.local/` directory.
