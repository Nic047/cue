# Security policy

Cue is an early alpha. Please do not use it with sensitive data or credentials belonging to someone else.

## Reporting a vulnerability

Please use GitHub's **Report a vulnerability** option in this repository's Security tab. If private reporting is unavailable, contact the maintainer privately through the [GitHub profile](https://github.com/Nic047). Do not publish exploit details or working credentials in a public issue.

For ordinary bugs and feature requests, use [GitHub Issues](https://github.com/Nic047/cue/issues).

## Security boundaries

- The desktop host records audio, stores keys in macOS Keychain, handles shortcuts, and writes exported files. Cloud agents run in separate Solari browsers and Linux sandboxes.
- Browser navigation tools reject non-HTTP(S) URLs and embedded credentials. This is not a network firewall: redirects and page JavaScript still run in the remote browser.
- Prompts instruct browser agents to avoid purchases, credentials, account changes, and non-search submissions. These restrictions are not enforced as transaction-level authorization; do not use this alpha with authenticated or sensitive workflows. Treat web content, generated code, and downloaded files as untrusted.
- Sandbox preview URLs are public. Do not expose secrets or private data through them. Exports persist in `~/Downloads/Cue`; recent chats persist locally until deleted. Console logs can include request content, results, and URLs.
- The downloadable alpha is ad hoc signed, not Developer ID signed or notarized. Source changes are not automatically included in an existing installer.

## Dependency review (2026-10-03)

Both Bun lockfiles returned no known advisories from `bun audit`. An OSV scan of 541 registry packages in `Cargo.lock` found:

- [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html): GLib 0.18.5 iterator unsoundness. This Linux dependency is absent from Cue’s supported `aarch64-apple-darwin` dependency tree. Linux is not a supported target.
- [RUSTSEC-2024-0370](https://rustsec.org/advisories/RUSTSEC-2024-0370.html): unmaintained `proc-macro-error`, also absent from that macOS tree.
- Unmaintained `unic-*` crates ([0081](https://rustsec.org/advisories/RUSTSEC-2025-0081.html), [0075](https://rustsec.org/advisories/RUSTSEC-2025-0075.html), [0080](https://rustsec.org/advisories/RUSTSEC-2025-0080.html), [0100](https://rustsec.org/advisories/RUSTSEC-2025-0100.html), [0098](https://rustsec.org/advisories/RUSTSEC-2025-0098.html)), inherited through Tauri’s `urlpattern` dependency. These maintenance advisories remain unresolved and require an upstream migration.

The source/history scan found no matches for the locally configured credentials or the credential patterns checked. These checks are limited snapshots, not a security certification; Git dependencies and undisclosed vulnerabilities are not covered by the registry scan.
