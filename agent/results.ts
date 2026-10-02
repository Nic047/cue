import { generateObject, streamText } from "ai";
import { z } from "zod";
import type { Plan } from "./planning.js";
import type { TaskResult } from "./execution.js";
import { PLANNER_MODEL } from "./config.js";
import { waitWithTimeout } from "../shared/wait-with-timeout.js";

export async function mergeResults(
  plan: Plan,
  results: TaskResult[],
): Promise<{ summary: string; detail: string }> {
  const successful = results.filter((r) => r.ok && r.text.trim());
  const failed = results.filter((r) => !r.ok || !r.text.trim());

  if (successful.length === 0) {
    const failures = failed
      .map((r) => `${r.title}: ${(r.error ?? "kein Ergebnis").slice(0, 160)}`)
      .join("; ");
    return {
      summary: `Keiner der Agents konnte ein Ergebnis liefern. ${failures}`,
      detail: failed
        .map((r) => `- ${r.title}: ${r.error ?? "kein Ergebnis"}`)
        .join("\n"),
    };
  }

  if (successful.length === 1 && failed.length === 0) {
    const detail = successful[0].text.trim();
    return {
      summary:
        detail.length > 300 ? `${detail.slice(0, 297).trimEnd()}…` : detail,
      detail,
    };
  }

  const system = `Du fasst die Ergebnisse mehrerer paralleler Agents (Browser und/oder Sandbox) zusammen.
Anweisung: ${plan.mergeInstruction || "Liefere eine vollständige, verständliche Antwort."}
Strategie war: ${plan.strategy}

Antworte als JSON mit EXAKT diesen zwei Feldern:
- "summary": Kurzfassung, MAXIMAL 2-3 Sätze. Nur Ergebnis + Quelle, keine Einleitung, keine Methodik, keine Wiederholung der Frage. Bei mehreren Quellen: das beste Ergebnis prominent nennen plus eine kurze Nebenzeile ("und N weitere"), z.B. "MediaMarkt: MacBook Pro 14 für €1.999 — und 2 weitere".
- "detail": Die vollständige Antwort für das Results-Panel, als Markdown. Bei mehreren
  Themen pro Thema eine ## Überschrift, darunter kurze erklärende Absätze und passende
  Listen oder Tabellen. Alle angefragten Werte und aussagekräftige Quellenlinks erhalten.
  Beispiel: ## Hacker News, ## Wetter in Berlin, ## Erste 20 Primzahlen — jeweils mit dem
  tatsächlichen Ergebnis und dem verfügbaren relevanten Kontext. Kein dicht gepackter Absatz.
  Die Begrenzung auf 2-3 Sätze gilt NUR für summary, niemals für detail. Keine künstliche
  Mindestlänge, keine Fülltexte, keine erfundenen Details. Einfachen Antworten reicht ein Absatz.

Regeln:
- Erfinde nichts, was nicht in den Einzelergebnissen steht.
- Nenne explizit, welche Quelle/welcher Task welchen Wert geliefert hat.
- Wenn ein Task fehlgeschlagen ist, erwähne das kurz und ehrlich.
- Bei Preisvergleichen: einheitliche Währung, Äpfel mit Äpfeln (neu vs. neu,
  refurbished vs. refurbished). Nicht Vergleichbares (andere Währung, andere
  Region, anderer Zustand) als solches kennzeichnen, nicht direkt verrechnen.
- Keine führenden/trailing Leerzeilen — direkt mit dem Inhalt beginnen.`;

  const MAX_MERGE_CHARS_PER_RESULT = 80_000;
  const MERGE_TIMEOUT_MS = 90_000;
  const MERGE_FALLBACK_TIMEOUT_MS = 60_000;

  const payload =
    successful
      .map((r) => {
        const text =
          r.text.length > MAX_MERGE_CHARS_PER_RESULT
            ? r.text.slice(0, MAX_MERGE_CHARS_PER_RESULT) +
              `\n[… gekürzt, ${r.text.length - MAX_MERGE_CHARS_PER_RESULT} Zeichen weggelassen]`
            : r.text;
        return `## ${r.title} [${r.type}]${r.source ? ` (${r.source})` : ""}\n${text}`;
      })
      .join("\n\n") +
    (failed.length
      ? "\n\n## Fehlgeschlagen\n" +
        failed
          .map((r) => `- ${r.title}: ${r.error ?? "kein Ergebnis"}`)
          .join("\n")
      : "");

  const MergeSchema = z.object({
    summary: z.string().describe("Kurzfassung, max. 2-3 Sätze."),
    detail: z
      .string()
      .trim()
      .min(1)
      .describe(
        "Vollständige Markdown-Antwort mit thematischen Abschnitten, Werten und Quellenlinks.",
      ),
  });

  console.error(
    `  merge: ${successful.length} ok / ${failed.length} failed, payload ${payload.length} Zeichen`,
  );
  try {
    const { object } = await waitWithTimeout(
      generateObject({
        model: PLANNER_MODEL,
        system,
        prompt: payload,
        schema: MergeSchema,
        abortSignal: AbortSignal.timeout(MERGE_TIMEOUT_MS),
      }),
      MERGE_TIMEOUT_MS,
      "merge",
    );
    return { summary: object.summary.trim(), detail: object.detail.trim() };
  } catch (err) {
    console.error(
      `  merge (strukturiert) fehlgeschlagen: ${String(err).slice(0, 200)} — Freitext-Fallback…`,
    );
  }
  try {
    // Fallback 1: Markdown ohne JSON-Schema.
    const result = streamText({
      model: PLANNER_MODEL,
      system: system.replace(
        /Antworte als JSON[\s\S]*?Regeln:/,
        "Antworte direkt als vollständiges Markdown, ohne JSON. Gliedere mehrere Themen mit ## Überschriften, kurzen Absätzen und Listen. Erhalte alle angefragten Werte und Quellenlinks.\n\nRegeln:",
      ),
      prompt: payload,
      abortSignal: AbortSignal.timeout(MERGE_FALLBACK_TIMEOUT_MS),
    });
    let text = "";
    const stream = (async () => {
      for await (const chunk of result.textStream) text += chunk;
    })();
    await waitWithTimeout(stream, MERGE_FALLBACK_TIMEOUT_MS, "merge-fallback");
    if (text.trim())
      return {
        summary:
          text.trim().length > 300
            ? `${text.trim().slice(0, 297)}…`
            : text.trim(),
        detail: text.trim(),
      };
  } catch (err) {
    console.error(
      `  merge (freitext) fehlgeschlagen: ${String(err).slice(0, 200)} — Notfall-Summary…`,
    );
  }
  // Fallback 2 (deterministisch, ohne LLM): Antwort kommt IMMER an —
  // lieber ein ehrlicher Ausschnitt als ewiges Haengen nach "fertig".
  const first = successful[0];
  const snippet = first.text.slice(0, 600).trim();
  return {
    summary: `${first.title}: ${snippet}${first.text.length > 600 ? " […]" : ""} (automatische Kurzfassung — Merge-Modell nicht erreichbar)`,
    detail: `Zusammenführen nicht verfügbar. Hier sind die einzelnen Ergebnisse:\n\n${payload}`,
  };
}
