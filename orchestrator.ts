/** CLI coordinator: planning → execution → results, via JSONL events. */
import "dotenv/config";
import { pathToFileURL } from "node:url";
import readline from "node:readline";
import { generateText } from "ai";
import { CHEAP_MODEL } from "./agent/config.js";
import { planTasks, type Plan } from "./agent/planning.js";
import {
  runTasksInParallel,
  resolveReplays,
  shutdownGracefully,
  type StatusFn,
} from "./agent/execution.js";
import { mergeResults } from "./agent/results.js";
import { emitEvent, logStep } from "./agent/events.js";
import { waitWithTimeout } from "./shared/wait-with-timeout.js";
// Public entry points used by runtime checks.
export {
  runBrowserTask,
  completionError,
  BROWSER_SYSTEM_PROMPT,
} from "./agent/execution.js";
export type { TaskResult } from "./agent/execution.js";
export type { Plan, Task } from "./agent/planning.js";

async function generateChatTitle(
  request: string,
  fallback: string,
): Promise<string> {
  try {
    const { text } = await waitWithTimeout(
      generateText({
        model: CHEAP_MODEL,
        system:
          "Create a concise, specific chat title from the user's request. Return only the title, at most 6 words.",
        prompt: request,
        maxOutputTokens: 24,
        abortSignal: AbortSignal.timeout(8_000),
      }),
      8_000,
      "chat-title",
    );
    const title = text
      .trim()
      .replace(/^[\"'“”]+|[\"'“”]+$/g, "")
      .replace(/\s+/g, " ");
    return (title || fallback).slice(0, 56).trimEnd();
  } catch {
    return fallback.slice(0, 56).trimEnd();
  }
}

const QUESTION_TIMEOUT_MS = 90_000;

/** Read a response line from stdin. EOF/timeout means no action; an empty line explicitly delegates to Cue. */
function readQuestionAnswer(timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        rl?.close();
      } catch {
        /* ignore */
      }
      resolve(value?.trim() ?? null);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    // The timer must not keep the process alive.
    timer.unref?.();
    let rl: ReturnType<typeof readline.createInterface> | undefined;
    try {
      rl = readline.createInterface({ input: process.stdin });
    } catch {
      finish(null);
      return;
    }
    rl.on("line", (line: string) => finish(String(line)));
    rl.on("close", () => finish(null));
    rl.on("error", () => finish(null));
  });
}

/** Timestamp of the last event for heartbeat throttling. */
async function main() {
  const userRequest = process.argv.slice(2).join(" ");
  if (!userRequest) {
    console.error('Usage: npm start -- "..."');
    process.exit(1);
  }

  console.error("◈ planning…");
  let plan: Plan;
  try {
    plan = await planTasks(userRequest);
  } catch (err) {
    // Return an honest planning failure so the UI can finish cleanly.
    console.error("◈ Planning failed:", String(err).slice(0, 200));
    emitEvent({
      type: "answer",
      text: "I couldn't plan your request. Please try again.",
      detail: "",
    });
    return;
  }

  // Ask before execution, then replan with the response.
  if (plan.question?.text?.trim()) {
    const q = plan.question;
    console.error(`◈ Question: ${q.text}`);
    emitEvent({
      type: "question",
      text: q.text,
      options: (q.options ?? []).slice(0, 4),
    });
    const answer = await readQuestionAnswer(QUESTION_TIMEOUT_MS);
    if (answer === null) {
      emitEvent({
        type: "answer",
        text: "I didn't receive a choice and haven't started anything. Please try again.",
        detail: "",
      });
      return;
    }
    const selected =
      answer || q.options.find((option) => option.trim())?.trim();
    console.error(`◈ Question answer: ${answer || "(Cue decides)"}`);
    const enriched =
      userRequest +
      "\n\n[Question for the user: " +
      q.text +
      " | User response: " +
      (answer ||
        (selected
          ? `Cue decides: The user explicitly delegated the choice. Selected option: ${selected}.`
          : "Cue decides: The user explicitly delegated the choice. Make a reasonable assumption.")) +
      "]\nThe question has been answered. Complete the original task using this choice. " +
      "Create concrete tasks; leave note empty and omit question. State the choice in the result.";
    try {
      plan = await planTasks(enriched);
      if (plan.tasks.length === 0) {
        plan = await planTasks(
          enriched +
            "\nYour last plan had no tasks. " +
            "The original task is executable and the choice has been answered. " +
            "Correct the plan with at least one browser or sandbox task.",
        );
      }
    } catch (err) {
      console.error("◈ Re-Planning failed:", String(err).slice(0, 200));
      emitEvent({
        type: "answer",
        text: "I couldn't plan your request. Please try again.",
        detail: "",
      });
      return;
    }
    if (plan.tasks.length === 0) {
      emitEvent({
        type: "answer",
        text: "I couldn't plan the task after your choice. Please try again.",
        detail: "",
      });
      return;
    }
  }

  // Finish cleanly when no executable task was requested.
  if (plan.tasks.length === 0) {
    const msg =
      plan.note ||
      "I couldn't identify a concrete task. Tell me what you'd like me to do.";
    emitEvent({ type: "answer", text: msg, detail: "" });
    console.error("◈ No executable task:", msg);
    return;
  }

  emitEvent({
    type: "plan",
    ack: plan.ack ?? "",
    summary: plan.summary,
    strategy: plan.strategy,
    tasks: plan.tasks.map((t) => ({ id: t.id, type: t.type, title: t.title })),
  });

  const chatTitle = generateChatTitle(
    userRequest,
    plan.tasks.length === 1 ? plan.tasks[0].title : plan.summary,
  );

  console.error();
  console.error("◈ PLAN");
  console.error(`  ${plan.summary}`);
  console.error(`  strategy: ${plan.strategy} · ${plan.tasks.length} tasks`);
  for (const task of plan.tasks) {
    console.error(
      `   • [${task.type}] ${task.title}${task.source ? ` @ ${task.source}` : ""}`,
    );
  }
  console.error();

  // Emit structured progress alongside terminal logs.
  const emit: StatusFn = (status, message, taskId) => {
    logStep(status, message);
    emitEvent({
      type: status === "starting" ? "task_start" : "step",
      message,
      taskId,
      ok: status !== "error",
    });
  };
  const { results, solari } = await runTasksInParallel(plan.tasks, emit);

  console.error();
  console.error("◈ ANTWORT");
  const { summary, detail } = await mergeResults(plan, results);
  const artifacts = results.flatMap((result) => result.artifacts ?? []);
  emitEvent({
    type: "answer",
    text: summary,
    detail:
      detail +
      (artifacts.length
        ? "\n\n### Files & previews\n\n" + artifacts.join("\n\n")
        : ""),
    chatTitle: await chatTitle,
  });
  console.error();
  console.error(summary);

  // Deliver the answer before replay lookup, then close the client with bounded waiting.
  console.error();
  console.error("◈ REPLAYS");
  await resolveReplays(solari, results);
  await waitWithTimeout(solari.close(), 10_000, "solari.close").catch(() => {});

  console.error();
  console.error("◈ AGENT RESULTS");
  for (const result of results) {
    const mark = result.ok ? "✔" : "✘";
    console.error(
      `  ${mark} [${result.type}] ${result.title} (${result.steps} steps, ${result.model})`,
    );
    console.error(`    ${result.ok ? result.text : result.error}`);
    if (result.replayUrl) console.error(`    replay: ${result.replayUrl}`);
  }
}

// Run only as the CLI entry point, not when imported.
if (
  import.meta.main ||
  (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
) {
  // Release active cloud sessions on SIGTERM/SIGINT before exiting.
  process.on("SIGTERM", () => void shutdownGracefully("SIGTERM"));
  process.on("SIGINT", () => void shutdownGracefully("SIGINT (Ctrl+C)"));
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
