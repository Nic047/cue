/** JSONL contract shared by the sidecar and the frontend. */
export type EventTask = {
  id: string;
  type: "browser" | "sandbox";
  title: string;
};
export type AgentEvent =
  | {
      type: "plan";
      ack: string;
      summary: string;
      strategy: "single" | "parallel";
      tasks: EventTask[];
    }
  | { type: "task_start"; message: string; taskId?: string; ok: boolean }
  | {
      type: "step";
      message?: string;
      tool?: string;
      target?: string;
      taskId?: string;
      ok: boolean;
    }
  | {
      type: "task_done";
      taskId: string;
      title: string;
      ok: boolean;
      steps: number;
    }
  | { type: "question"; text: string; options: string[] }
  | { type: "answer"; text: string; detail: string; chatTitle?: string }
  | { type: "no_task"; message: string }
  | { type: "agent_error"; message: string };

/** Reject unknown/malformed events before they reach UI state. */
export function parseAgentEvent(line: string): AgentEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  const string = (key: string) => typeof event[key] === "string";
  const optionalString = (key: string) =>
    event[key] === undefined || string(key);
  const strings = (items: unknown): items is string[] =>
    Array.isArray(items) && items.every((item) => typeof item === "string");
  let valid = false;
  switch (event.type) {
    case "plan":
      valid =
        string("ack") &&
        string("summary") &&
        ["single", "parallel"].includes(String(event.strategy)) &&
        Array.isArray(event.tasks) &&
        event.tasks.length <= 5 &&
        event.tasks.every(
          (task) =>
            task &&
            typeof task === "object" &&
            typeof task.id === "string" &&
            typeof task.title === "string" &&
            ["browser", "sandbox"].includes(task.type),
        );
      break;
    case "task_start":
      valid =
        string("message") &&
        optionalString("taskId") &&
        typeof event.ok === "boolean";
      break;
    case "step":
      valid =
        (string("message") || string("tool")) &&
        optionalString("message") &&
        optionalString("tool") &&
        optionalString("target") &&
        optionalString("taskId") &&
        typeof event.ok === "boolean";
      break;
    case "task_done":
      valid =
        string("taskId") &&
        string("title") &&
        typeof event.ok === "boolean" &&
        typeof event.steps === "number" &&
        Number.isSafeInteger(event.steps) &&
        event.steps >= 0;
      break;
    case "question":
      valid =
        string("text") && strings(event.options) && event.options.length <= 4;
      break;
    case "answer":
      valid = string("text") && string("detail") && optionalString("chatTitle");
      break;
    case "no_task":
    case "agent_error":
      valid = string("message");
      break;
  }
  return valid ? (value as AgentEvent) : null;
}
