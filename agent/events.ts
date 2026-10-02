import type { AgentEvent } from "../shared/agent-events.js";

export function logStep(status: string, message: string): void {
  console.error(`[${new Date().toLocaleTimeString()}] ${status}: ${message}`);
}

/** stdout belongs to the typed JSONL stream; human logs use stderr. */
export function emitEvent(event: AgentEvent): void {
  process.stdout.write(JSON.stringify(event) + "\n");
}
