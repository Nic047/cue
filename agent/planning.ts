import { generateObject, generateText } from "ai";
import { z } from "zod";
import {
  PLANNER_MODEL,
  MAX_PARALLEL_TASKS,
  MODEL_REQUEST_TIMEOUT_MS,
} from "./config.js";

const TaskSchema = z.object({
  id: z
    .string()
    .default("")
    .describe("Task-ID, z.B. 't1' (wird ggf. ergänzt)."),
  type: z
    .enum(["browser", "sandbox"])
    .describe(
      "browser: braucht eine echte Website/Suche im Web. " +
        "sandbox: braucht Code-Ausführung, Datenverarbeitung, oder das Bauen/Testen von etwas.",
    ),
  title: z
    .string()
    .default("")
    .describe(
      "Kurzer Titel für UI/Logs, z.B. 'Amazon.com' oder 'Python-Skript ausführen' (wird ggf. ergänzt).",
    ),
  instruction: z
    .string()
    .describe(
      "Vollständige, eigenständige Anweisung für den Agenten, inkl. aller relevanten Details aus der Nutzeranfrage.",
    ),
  source: z
    .string()
    .default("")
    .describe(
      "Bei type=browser: erwartete Quelle/Website, falls bekannt, z.B. 'amazon.com'. " +
        "Leerer String, wenn unbekannt oder type=sandbox.",
    ),
  stealth: z
    .boolean()
    .default(true)
    .describe(
      "Nur bei type=browser. true (Default) für Seiten mit Bot-Abwehr " +
        "(Amazon, Google, Shops, Logins, CAPTCHA-Verdacht): langsamer " +
        "Stealth-Pool mit US-Proxy. false für einfache bot-freie Seiten " +
        "(Beispiel-, Doku-, Blogseiten): schneller Headless-Pool, " +
        "Start in ~1s statt Minuten.",
    ),
});

const PlanSchema = z.object({
  ack: z
    .string()
    .default("")
    .describe(
      'SEHR kurzer Einleitungssatz an den Nutzer (max. 8 Woerter, Englisch, locker). Z.B. "Sure, checking Amazon for you." Keine Details, kein Plan.',
    ),
  summary: z
    .string()
    .default("")
    .describe("Ein Satz, was insgesamt gemacht wird."),
  // Leerer String, wenn die Nachricht eine ausfuehrbare Aufgabe ist.
  note: z
    .string()
    .default("")
    .describe(
      "NUR wenn keine ausfuehrbare Aufgabe erkannt wurde (Begruessung,small talk): kurzer Hinweis an den Nutzer, dass eine konkrete Anfrage noetig ist. Sonst leerer String.",
    ),
  strategy: z
    .enum(["single", "parallel"])
    .describe(
      "single: nur ein Task nötig. " +
        "parallel: mehrere Tasks — unterschiedliche Infos oder mehrere Quellen für dieselbe Frage.",
    ),
  tasks: z.array(TaskSchema).max(MAX_PARALLEL_TASKS),
  mergeInstruction: z
    .string()
    .default("")
    .describe("Anweisung fürs finale Zusammenführen der Ergebnisse."),
  // Eine Rückfrage bei ausdrücklich gewünschter Auswahl oder nötiger Klärung.
  question: z
    .object({
      text: z.string().describe("Kurze, konkrete Frage an den Nutzer."),
      options: z
        .array(z.string())
        .max(4)
        .describe("Max. 4 kurze Antwort-Optionen zum Antippen."),
    })
    .optional()
    .describe(
      "Setzen, wenn der Nutzer ausdrücklich zuerst gefragt werden möchte oder eine nötige Angabe fehlt. " +
        "Das question-Feld öffnet das interaktive Frage-Panel. Nicht nur in note behaupten, auf eine Antwort zu warten.",
    ),
});

export type Plan = z.infer<typeof PlanSchema>;
export type Task = z.infer<typeof TaskSchema>;

export async function planTasks(userRequest: string): Promise<Plan> {
  const system = `Du bist der Planer für ein System aus parallelen Browser- und Sandbox-Agents.
Zerlege die Nutzeranfrage in 1 bis ${MAX_PARALLEL_TASKS} konkrete, unabhängig voneinander ausführbare Tasks.

Jeder Task braucht ein "type"-Feld:
- "browser": die Aufgabe erfordert das Aufrufen einer echten Website (Preise
  vergleichen, Informationen recherchieren, ein Formular ausfüllen, etc.)
- "sandbox": die Aufgabe erfordert Code auszuführen, Daten zu verarbeiten,
  etwas zu bauen/zu testen, oder eine Berechnung durchzuführen.

Bei type=browser auch "stealth" setzen: true lassen bei Bot-Abwehr
(Amazon, Google, Shops, Logins) — false nur, wenn die Zielseite sicher
simpel/bot-frei ist. Im Zweifel true.

WICHTIG: Ist die Nachricht KEINE ausfuehrbare Aufgabe (nur Begruessung wie
"hallo", Small Talk, unklare Frage ohne konkreten Auftrag), setze tasks auf
[] und fuelle das "note"-Feld mit einem kurzen Hinweis. Erfinde keine Task.

Regeln:
- Jeder Task muss für sich allein verständlich sein (der Agent, der ihn ausführt, sieht NUR "instruction", nicht die ursprüngliche Nutzeranfrage).
- PFLICHTFELDER, keines weglassen: summary, strategy, tasks — und pro Task id (z.B. "t1", "t2"), type, title, instruction.
- Keinen gewünschten Teil stillschweigend weglassen. Fehlt eine nötige Angabe
  (z.B. welche Website gemeint ist), triff die naheliegendste Annahme, schreibe
  sie in die Task-instruction UND in mergeInstruction, damit die finale Antwort
  die Annahme nennt. Nur wenn gar nichts Ausführbares dabei ist: tasks leer + note füllen.
- Wenn der Nutzer ausdrücklich "frag mich zuerst", "biete Optionen an" oder
  "warte auf meine Auswahl" verlangt, MUSST du question setzen. Das ist das
  Frage-Tool dieses Systems: question.text und bis zu 4 kurze question.options
  öffnen das interaktive Panel. Erfülle die gewünschte Anzahl bis maximal 4.
  Setze note auf "". tasks darf [] sein, solange die Auswahl noch aussteht.
  Beispiel: Python-Projekt nach Auswahl → question.text: "Welches Python-Projekt
  möchtest du erstellen?", options: ["To-do-App", "Quiz", "Dateien sortieren", "Ausgaben-Tracker"].
  Schreibe niemals nur "Ich warte auf deine Auswahl" in note oder in einen Task.
- Ohne ausdrücklichen Wunsch nur fragen, wenn die Aufgabe ohne EINE klärende
  Rückfrage nicht sinnvoll planbar ist. Bei Kleinigkeiten lieber annehmen.
- Enthält die Anfrage bereits eine Antwort auf deine Rückfrage, berücksichtige
  diese und plane die Umsetzung. Wiederhole die bereits beantwortete Frage nicht.
  "Cue entscheidet" ist eine ausdrückliche Erlaubnis zur Auswahl, keine fehlende
  Anfrage. Die ursprüngliche Aufgabe bleibt bestehen. Diese Antwort hat Vorrang
  vor dem ursprünglichen Wunsch "frag mich zuerst": jetzt tasks planen, note leer,
  question weglassen. Nenne die gewählte Annahme im Ergebnis.
- strategy "parallel" nutzen, wenn mehrere Tasks nötig sind — sei es unterschiedliche Infos oder mehrere Quellen für dieselbe Frage (z.B. Preisvergleich).
- strategy "single" nutzen, wenn ein Task reicht.
- mergeInstruction soll eine vollständige Markdown-Antwort verlangen: bei verschiedenen
  Themen separate Abschnitte mit allen angefragten Ergebnissen und Quellen. Eine sehr
  kurze Antwort nur verlangen, wenn der Nutzer das ausdrücklich wünscht.
- Erfinde keine Quellen/Schritte, die die Anfrage nicht impliziert.`;

  // TEMPORÄR: Mercury kann kein Structured Output (Provider-Warnung) —
  // dann manueller JSON-Pfad statt generateObject.
  if (PLANNER_MODEL.includes("mercury")) {
    return planTasksManualJson(system, userRequest);
  }

  // Das Flash-Modell laesst gelegentlich Pflichtfelder weg (flaky
  // structured output) — bis zu 3 Versuche statt sofort zu crashen.
  // Kosmetische Luecken (id/title/summary) werden danach automatisch
  // gefuellt; nur instruction bleibt hart Pflicht.
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { object } = await generateObject({
        model: PLANNER_MODEL,
        system,
        prompt: userRequest,
        schema: PlanSchema,
        temperature: PLANNER_MODEL.startsWith("openai/gpt-5") ? undefined : 0,
        abortSignal: AbortSignal.timeout(MODEL_REQUEST_TIMEOUT_MS),
      });
      fillPlanGaps(object);
      return object;
    } catch (err) {
      lastErr = err;
      console.error(
        `Plan Versuch ${attempt} fehlgeschlagen${attempt < 3 ? ", Retry…" : "."}`,
      );
    }
  }
  throw lastErr;
}

/** Kosmetische Plan-Lücken füllen (id/title/summary); instruction bleibt Pflicht. */
function fillPlanGaps(plan: Plan): void {
  plan.tasks.forEach((t, i) => {
    if (!t.id) t.id = `t${i + 1}`;
    if (!t.title) t.title = t.instruction.slice(0, 40) || `Task ${i + 1}`;
  });
  if (!plan.summary) plan.summary = `${plan.tasks.length} Task(s) ausführen.`;
}

/** JSON aus Modell-Text schälen (Code-Fences und Prosa tolerieren). */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("kein JSON gefunden");
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * TEMPORÄRER manueller Planner für Modelle ohne Structured Output
 * (Mercury): roher Text → JSON.parse → Zod-Validierung → Repair-Retry.
 */
async function planTasksManualJson(
  system: string,
  userRequest: string,
): Promise<Plan> {
  const shape = `Antworte AUSSCHLIESSLICH mit einem JSON-Objekt in exakt dieser Form (kein Markdown, keine Erklärung davor/danach):
{"ack": string, "summary": string, "note": string, "strategy": "single|parallel", "tasks": [{"id": string, "type": "browser|sandbox", "title": string, "instruction": string, "source": string, "stealth": boolean}], "mergeInstruction": string, "question": {"text": string, "options": [max. 4 kurze Strings]} oder weglassen}
"stealth": false bei simplen bot-freien Seiten (example.com, Dokus, Blogs), true bei Amazon/Google/Shops/Logins — im Zweifel true.
"question" MUSS gesetzt werden, wenn der Nutzer zuerst gefragt werden oder Optionen auswählen möchte; sonst nur bei nötiger Klärung. Mit question darf tasks [] sein und note muss leer sein. Eine bereits beantwortete Rückfrage nicht wiederholen.
Leere Strings wo unbekannt; "tasks": [] und "note" gefüllt, wenn KEINE ausführbare Aufgabe. Plane NIEMALS die Aufgabe selbst — nur Tasks beschreiben.`;
  let prompt = userRequest;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { text } = await generateText({
      model: PLANNER_MODEL,
      system: system + "\n\n" + shape,
      prompt,
      temperature: PLANNER_MODEL.startsWith("openai/gpt-5") ? undefined : 0,
      abortSignal: AbortSignal.timeout(MODEL_REQUEST_TIMEOUT_MS),
    });
    try {
      const parsed = PlanSchema.safeParse(extractJson(text));
      if (!parsed.success) throw parsed.error;
      fillPlanGaps(parsed.data);
      return parsed.data;
    } catch (err) {
      lastErr = err;
      console.error(
        `Plan (manuell) Versuch ${attempt} fehlgeschlagen${attempt < 3 ? ", Retry…" : "."}`,
      );
      prompt =
        `${userRequest}\n\nDeine letzte Antwort war kein gültiges Plan-JSON ` +
        `(${String(err).slice(0, 200)}). Antworte NUR mit korrigiertem JSON in der vorgegebenen Form.`;
    }
  }
  throw lastErr;
}
