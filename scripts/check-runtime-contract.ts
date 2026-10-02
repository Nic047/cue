import assert from "node:assert/strict";
import { parseAgentEvent, type AgentEvent } from "../shared/agent-events.js";
import {
  waitWithTimeout,
  WaitTimeoutError,
} from "../shared/wait-with-timeout.js";

const events: AgentEvent[] = [
  {
    type: "plan",
    ack: "Sure",
    summary: "Check",
    strategy: "single",
    tasks: [{ id: "t1", type: "browser", title: "Example" }],
  },
  { type: "task_start", message: "Starting", taskId: "t1", ok: true },
  {
    type: "step",
    tool: "navigate",
    target: "https://example.com",
    taskId: "t1",
    ok: true,
  },
  { type: "step", message: "Thinking", ok: true },
  { type: "task_done", taskId: "t1", title: "Example", ok: true, steps: 2 },
  { type: "question", text: "Choose", options: ["One", "Two"] },
  { type: "answer", text: "Done", detail: "## Result", chatTitle: "Example" },
  { type: "agent_error", message: "Exited" },
];
for (const event of events)
  assert.deepEqual(parseAgentEvent(JSON.stringify(event)), event);
for (const event of events)
  assert.equal(
    parseAgentEvent(JSON.stringify({ ...event, type: "unknown" })),
    null,
  );
for (const malformed of [
  "bad JSON",
  "null",
  "[]",
  '{"type":"answer","text":42}',
  '{"type":"plan","tasks":[null]}',
  '{"type":"step","ok":true}',
  '{"type":"question","text":"Choose","options":[1]}',
  '{"type":"task_done","taskId":"t1","title":"Example","ok":true,"steps":-1}',
]) {
  assert.equal(parseAgentEvent(malformed), null);
}
assert.equal(await waitWithTimeout(Promise.resolve(42), 100, "success"), 42);
await assert.rejects(
  waitWithTimeout(Promise.reject(new Error("original")), 100, "failure"),
  /original/,
);
let release: (value: number) => void = () => {};
let cleaned: number | undefined;
const late = new Promise<number>((resolve) => {
  release = resolve;
});
await assert.rejects(
  waitWithTimeout(late, 1, "late", (value) => {
    cleaned = value;
  }),
  WaitTimeoutError,
);
release(7);
await new Promise((resolve) => setImmediate(resolve));
assert.equal(cleaned, 7);
let rejectLate: (error: Error) => void = () => {};
const lateFailure = new Promise<never>((_, reject) => {
  rejectLate = reject;
});
await assert.rejects(
  waitWithTimeout(lateFailure, 1, "late failure"),
  WaitTimeoutError,
);
rejectLate(new Error("late rejection is consumed"));
await new Promise((resolve) => setImmediate(resolve));
console.log(
  "Event contract and timeout checks passed, including late cleanup and rejection handling.",
);
