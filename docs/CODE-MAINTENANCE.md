# Code maintenance handover

## Scope

Focused refactoring, with the current UI markup, classes, sizing and animations preserved. No framework or interface layer was added. This work is on the local branch `codex/code-maintenance`; it is included in the Cue 0.1.4 installer published to the website. The source refactor commits remain local.

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
| Sidecar spawning, stopping and stdin | `island-tauri/src-tauri/src/orchestrator_bridge.rs` |
| Window presentation, notch positioning and morphing | `island-tauri/src-tauri/src/window_layout.rs` |
| Setup step views and model picker | `island-tauri/src/components/setup/` |
| Setup shortcut capture | `island-tauri/src/lib/use-shortcut-recorder.ts` |
| Result view and recent chats | `island-tauri/src/components/results-panel.tsx`, `recent-chats-dialog.tsx` |
| Pill shortcut controller | `island-tauri/src/lib/use-pill-shortcuts.ts` |

## Runtime changes

- Producers compile against one `AgentEvent` union. The frontend rejects unknown or malformed JSONL events before updating state; `agent_error` remains supported for native process failures.
- AI requests use their supported abort signals/timeouts. `waitWithTimeout` explicitly limits waiting for APIs without cancellation support.
- Browser launch, page creation and sandbox creation dispose resources returned after a timeout. Tool timeouts end their session and prevent further tool operations; late exports are discarded and late preview notifications are suppressed.
- Pending shortcut timers are cleared on cleanup; overlay close callbacks read the current render rather than a stale closure.

## Verification

Passed locally:

```sh
bun run check
cargo check --manifest-path island-tauri/src-tauri/Cargo.toml
cargo fmt --manifest-path island-tauri/src-tauri/Cargo.toml --check
```

`check` includes offline sandbox/browser tool checks, completion evidence, file/preview checks, TypeScript compilation, the frontend build, and new event/timeout regression checks. No cloud calls, app launches, real permissions or fresh-Mac installation were tested during this refactor. Existing dependency `use client` build warnings are non-fatal.

## Commits and remaining work

The refactor is split into agent/protocol/timeout, native window separation, UI extraction, and this handover note. Each commit describes the problem, change, and checks.

The checkout already contained documentation, CI, release metadata and landing-page changes, plus independent Swift workflow experiments. Those remain outside these refactor commits. Review or commit them separately before merging or publishing; do not stage the entire checkout blindly. The website download is Cue 0.1.4, including this refactor.
