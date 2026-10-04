# Architecture

cue has three parts: a React interface, a native Tauri host, and a Node sidecar. Solari browser and sandbox sessions run in the cloud. The app does not give cloud agents general control of local applications.

## Request flow

1. The native shortcut starts microphone capture; Groq transcribes the recording.
2. The native host starts the sidecar with Keychain credentials in its process environment.
3. The planner returns independent tasks or a question. Responses return through stdin.
4. Browser and sandbox agents execute tasks and emit validated JSONL progress.
5. Result synthesis produces Markdown; the frontend stores recent chats locally.
6. Cancellation invalidates old event readers and releases cloud sessions.

## Module map

| Responsibility | Location |
| --- | --- |
| CLI coordination and question/answer stdin | `orchestrator.ts` |
| Plan schema, planner, repair retries | `agent/planning.ts` |
| Browser/sandbox execution, session cleanup, replay lookup | `agent/execution.ts` |
| Final answer synthesis and fallbacks | `agent/results.ts` |
| JSONL event emission | `agent/events.ts` |
| Shared event union and runtime validation | `shared/agent-events.ts` |
| Bounded waiting and disposal of late resources | `shared/wait-with-timeout.ts` |
| Sidecar spawning, stopping and stdin | `cue-app/src-tauri/src/orchestrator_bridge.rs` |
| Window presentation, notch positioning and morphing | `cue-app/src-tauri/src/window_layout.rs` |
| Setup step views and model picker | `cue-app/src/components/setup/` |
| Setup shortcut capture | `cue-app/src/lib/use-shortcut-recorder.ts` |
| Result view and recent chats | `cue-app/src/components/results-panel.tsx`, `recent-chats-dialog.tsx` |
| Pill shortcut controller | `cue-app/src/lib/use-pill-shortcuts.ts` |

## Lifecycle and trust boundaries

- `shared/agent-events.ts` defines the event union and rejects unknown or malformed events.
- `waitWithTimeout` limits waiting, not underlying execution. Resource-producing calls dispose late results; tool timeouts close their session. AI calls also use abort signals.
- Native process and recording generations prevent stale work from changing a newer run.
- The result renderer disables raw HTML and validates external link schemes. Export links resolve only inside the local export directory.
- Native permissions, credential handling, and window presentation remain in Rust; model instructions are not a security boundary. See [SECURITY.md](../SECURITY.md).

## Development and checks

See [CONTRIBUTING.md](../CONTRIBUTING.md). The browser-only `?demo` harness exercises real UI states without voice or cloud calls and is enabled only in development. Build output and local experiments are ignored by Git.
