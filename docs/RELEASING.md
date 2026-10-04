# Releasing cue

Source changes do not update installed apps. The **Release macOS** workflow builds an Apple Silicon app, seals its embedded runtime, creates the DMG, signs the final updater archive, and publishes a GitHub release.

## One-time setup

Add the private update signing key as the GitHub repository Actions secret `TAURI_SIGNING_PRIVATE_KEY`. The matching public key is already configured in `island-tauri/src-tauri/tauri.conf.json`. If the key has a password, add `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` too.

Keep a secure backup of the private key. Never commit it, publish it, or regenerate it for ordinary releases. Losing it prevents updates for already installed copies. Local keys and build artifacts belong in the ignored `.local/release/` directory.

Updater signatures authenticate app updates. They are separate from Apple Developer ID signing and notarization; this alpha still uses ad hoc macOS signing.

## Publish a release

1. Set the same new version in `island-tauri/package.json`, `island-tauri/src-tauri/Cargo.toml` and `island-tauri/src-tauri/tauri.conf.json`. Refresh the lockfiles and commit the source.
2. Push a matching tag, such as `v0.1.7`, or manually run **Release macOS** against the desired commit.
3. Wait for the release to finish. It publishes `cue-apple-silicon.dmg`, `cue.app.tar.gz`, its `.sig`, and `latest.json`.
4. Once the release exists, use `https://github.com/Nic047/cue/releases/latest/download/cue-apple-silicon.dmg` for the website's download button. Keep old download links working.

The in-app updater checks `https://github.com/Nic047/cue/releases/latest/download/latest.json`. It checks at launch and exposes **Check for updates…** in the menu bar and Settings. Installation is explicit, blocked while a task is active, verifies the archive signature, and restarts cue.

Users on 0.1.6 or earlier need to manually install the first updater-enabled release once. Their credentials, preferences and chat history retain the existing app identifier and storage keys.

## Package locally

```sh
cd island-tauri
bun run bundle:unsigned
cd ..
node scripts/package-update.mjs
```

The package command looks for `.local/release/updater.key`, or reads the standard `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PATH` environment variables. The updater archive is generated **after** all app signing is finished.
