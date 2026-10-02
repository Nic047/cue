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
// Public entry points used by the benchmark and acceptance checks.
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

/**
 * Antwort des Nutzers auf eine Rückfrage lesen (eine Zeile via stdin —
 * die Tauri-Bridge schreibt per answer_question-Command hinein).
 * Timeout/geschlossenes stdin → null (keine Umsetzung ohne Antwort).
 * Eine bewusst leere Antwort bedeutet: Nutzer lässt Cue entscheiden.
 */
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
    // Timer allein hält nichts unnötig wach, blockiert aber auch nichts.
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

/** Zeitpunkt des letzten gesendeten Events – fuer den Keepalive-Throttle. */
async function main() {
  const userRequest = process.argv.slice(2).join(" ");
  if (!userRequest) {
    console.error('Nutzung: npm start -- "..."');
    process.exit(1);
  }

  console.error("◈ planning…");
  let plan: Plan;
  try {
    plan = await planTasks(userRequest);
  } catch (err) {
    // Planung endgültig fehlgeschlagen: ehrliche Antwort statt Stacktrace,
    // damit die UI sauber abschliesst.
    console.error("◈ Planung fehlgeschlagen:", String(err).slice(0, 200));
    emitEvent({
      type: "answer",
      text: "Ich konnte deine Anfrage leider nicht einplanen – versuch es bitte nochmal.",
      detail: "",
    });
    return;
  }

  // Rückfrage nötig? Frage ans UI stellen, auf Antwort warten (oder Timeout),
  // dann mit der Antwort neu planen. Antwort landet in den Tasks.
  if (plan.question?.text?.trim()) {
    const q = plan.question;
    console.error(`◈ Rückfrage: ${q.text}`);
    emitEvent({
      type: "question",
      text: q.text,
      options: (q.options ?? []).slice(0, 4),
    });
    const answer = await readQuestionAnswer(QUESTION_TIMEOUT_MS);
    if (answer === null) {
      emitEvent({
        type: "answer",
        text: "Ich habe keine Auswahl erhalten und noch nichts gestartet. Bitte versuche es erneut.",
        detail: "",
      });
      return;
    }
    const selected =
      answer || q.options.find((option) => option.trim())?.trim();
    console.error(`◈ Rückfrage-Antwort: ${answer || "(Cue entscheidet)"}`);
    const enriched =
      userRequest +
      "\n\n[Rückfrage an den Nutzer: " +
      q.text +
      " | Antwort des Nutzers: " +
      (answer ||
        (selected
          ? `Cue entscheidet: Der Nutzer hat die Auswahl ausdrücklich delegiert. Gewählte Option: ${selected}.`
          : "Cue entscheidet: Der Nutzer hat die Auswahl ausdrücklich delegiert. Triff eine passende Annahme.")) +
      "]\nDie Rückfrage ist damit beantwortet. Führe die ursprüngliche Aufgabe mit dieser Auswahl aus. " +
      "Erstelle konkrete tasks; note leer, keine erneute question. Nenne die Auswahl im Ergebnis.";
    try {
      plan = await planTasks(enriched);
      if (plan.tasks.length === 0) {
        plan = await planTasks(
          enriched +
            "\nDein letzter Plan enthielt keine Tasks. " +
            "Die ursprüngliche Aufgabe ist ausführbar und die Auswahl wurde beantwortet. " +
            "Korrigiere den Plan mit mindestens einem browser- oder sandbox-Task für die Umsetzung.",
        );
      }
    } catch (err) {
      console.error("◈ Re-Planung fehlgeschlagen:", String(err).slice(0, 200));
      emitEvent({
        type: "answer",
        text: "Ich konnte deine Anfrage leider nicht einplanen – versuch es bitte nochmal.",
        detail: "",
      });
      return;
    }
    if (plan.tasks.length === 0) {
      emitEvent({
        type: "answer",
        text: "Ich konnte die Umsetzung nach deiner Auswahl nicht planen. Bitte versuche es erneut.",
        detail: "",
      });
      return;
    }
  }

  // Keine ausfuehrbare Aufgabe (Begruessung etc.): sauber beenden statt crash.
  if (plan.tasks.length === 0) {
    const msg =
      plan.note ||
      "Ich habe keine konkrete Aufgabe erkannt – sag mir, was ich tun soll.";
    emitEvent({ type: "answer", text: msg, detail: "" });
    console.error("◈ Keine ausfuehrbare Aufgabe:", msg);
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

  // Status auch als Event rausschreiben (task_start/step), parallel zum
  // menschlichen Log.
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

  // Replays erst NACH der Antwort einsammeln (UI hat sie schon),
  // dann Client schliessen (mit Timeout — close() kann bei einem
  // angeschlagenen Backend ebenfalls haengen).
  console.error();
  console.error("◈ REPLAYS");
  await resolveReplays(solari, results);
  await waitWithTimeout(solari.close(), 10_000, "solari.close").catch(() => {});

  console.error();
  console.error("◈ AGENT RESULTS");
  for (const result of results) {
    const mark = result.ok ? "✔" : "✘";
    console.error(
      `  ${mark} [${result.type}] ${result.title} (${result.steps} Schritte, ${result.model})`,
    );
    console.error(`    ${result.ok ? result.text : result.error}`);
    if (result.replayUrl) console.error(`    replay: ${result.replayUrl}`);
  }
}

// Nur als Skript ausfuehren (Sidecar) — nicht beim Import (Benchmark-Skript).
if (
  import.meta.main ||
  (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
) {
  // Graceful Shutdown: SIGTERM (kill_task) und SIGINT (Ctrl+C) geben erst
  // aktive Cloud-Sessions frei, statt Slots stranden zu lassen.
  process.on("SIGTERM", () => void shutdownGracefully("SIGTERM"));
  process.on("SIGINT", () => void shutdownGracefully("SIGINT (Ctrl+C)"));
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
