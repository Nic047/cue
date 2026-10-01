import type {
  AgentQuestion,
  AgentStep,
  Phase,
  PlanTask,
} from "../lib/agent-state";

/**
 * Demo-Szenarien (?demo-Harness): fahren den ECHTEN Store in exakt die
 * States, die die Prod-UI rendert — ohne Voice, ohne Task, ohne Option.
 *
 * States der aktuellen UI (Ambient-Regeln):
 *  - listening/transcribing: winzige Voice-Pill.
 *  - working + planMs==null: Planning-Shimmer (tritt per "plan"-Event
 *    auf Executing um — sequentiell, kein Stack).
 *  - working + planMs!=null: Executing-Indikator + Timer + Agent-Dots
 *    (Dots = tasks.length).
 *  - done: nur Summary + Details-Button; detailOpen=true = Overlay.
 *  - question: Frage-Dialog (phasenunabhaengig).
 * Trace-Listen/Steps rendert die Pill nicht mehr — die alten
 * step/taskStatus-Events existieren nur noch als Harness-Reserve.
 */

/** Vollständiger Store-Schnappschuss für ein Szenario. */
export interface DemoState {
  phase: Phase;
  ack: string;
  planSummary: string;
  strategy: string;
  tasks: PlanTask[];
  allSteps: AgentStep[];
  answer: string | null;
  detail: string | null;
  detailOpen: boolean;
  question: AgentQuestion | null;
  planMs: number | null;
  totalMs: number | null;
  expanded: boolean;
  startedAt: number | null;
  transcript: string;
}

/** Ein Demo-Event: wird im Stream-Modus eines pro Tick angewendet. */
export type DemoEvent =
  | { kind: "step"; taskId: string; step: AgentStep }
  | {
      kind: "taskStatus";
      taskId: string;
      status: "running" | "done" | "failed";
      stepCount?: number;
    }
  | { kind: "plan"; planMs: number }
  | { kind: "answer"; text: string; totalMs: number; detail?: string }
  | { kind: "phase"; phase: Phase };

export interface DemoScenario {
  id: string;
  label: string;
  initial: DemoState;
  /** Falls gesetzt: läuft im Stream-Modus ein Event pro Tick. */
  script?: DemoEvent[];
}

function base(over: Partial<DemoState>): DemoState {
  return {
    phase: "idle",
    ack: "",
    planSummary: "",
    strategy: "",
    tasks: [],
    allSteps: [],
    answer: null,
    detail: null,
    detailOpen: false,
    question: null,
    planMs: null,
    totalMs: null,
    expanded: true,
    startedAt: null,
    transcript: "",
    ...over,
  };
}

const ANSWER =
  "Das MacBook Pro 14″ (M5, 16 GB) gibt es bei MediaMarkt für €1.999,00 — €200 unter Apple Store (€2.199,00).";

const DETAIL =
  "MacBook Pro 14″ (M5, 16 GB, 512 GB) im Vergleich:\n\n" +
  "- MediaMarkt: €1.999,00 (versandkostenfrei, sofort lieferbar)\n" +
  "- Amazon.de: €2.049,00 (Marketplace-Händler, 2–3 Tage)\n" +
  "- Apple Store: €2.199,00 (UVP, inkl. Gravur-Option)\n\n" +
  "Alle Preise inkl. MwSt., Stand heute. Gewinner: MediaMarkt — und 2 weitere.";

/** working-Basis: tasks steuern die Agent-Dots (tasks.length, max 4). */
function workingBase(
  over: Partial<DemoState> & { taskCount?: number },
): DemoState {
  const { taskCount = 1, ...rest } = over;
  const titles = ["Amazon.com", "MediaMarkt", "Python-Skript"];
  const tasks: PlanTask[] = Array.from({ length: taskCount }, (_, i) => ({
    id: `t${i + 1}`,
    type: i === 2 ? "sandbox" : "browser",
    title: titles[i] ?? `Task ${i + 1}`,
    status: "running",
    steps: [],
  }));
  return base({
    phase: "working",
    ack: "Sure, checking that for you.",
    transcript: "Vergleiche MacBook Preise",
    tasks,
    allSteps: [],
    ...rest,
  });
}

export const SCENARIOS: DemoScenario[] = [
  {
    id: "listening",
    label: "Pill · Listening",
    initial: base({ phase: "listening" }),
  },
  {
    id: "transcribing",
    label: "Pill · Transcribing",
    initial: base({ phase: "transcribing" }),
  },
  {
    id: "planning",
    label: "Panel · Planning",
    initial: workingBase({ planMs: null }),
  },
  {
    id: "run",
    label: "▶ Full run (stream)",
    initial: workingBase({ planMs: null, taskCount: 2 }),
    script: [
      { kind: "plan", planMs: 2400 },
      { kind: "taskStatus", taskId: "t1", status: "done", stepCount: 9 },
      { kind: "answer", text: ANSWER, totalMs: 18400, detail: DETAIL },
    ],
  },
  {
    id: "executing",
    label: "Panel · Executing",
    initial: workingBase({ planMs: 2400 }),
  },
  {
    id: "executing-x3",
    label: "Panel · Executing ×3",
    initial: workingBase({ planMs: 3100, taskCount: 3 }),
  },
  {
    id: "question",
    label: "Panel · Rückfrage",
    initial: base({
      phase: "working",
      ack: "One quick thing.",
      planMs: 1200,
      transcript: "Vergleiche Preise",
      question: {
        text: "Was möchtest du auf Product Hunt entdecken?",
        options: ["Produkte entdecken", "Tech-Nachrichten lesen", "Ein Projekt vorstellen", "Nur stöbern"],
      },
    }),
  },
  {
    id: "done",
    label: "Panel · Done + Antwort",
    initial: base({
      phase: "done",
      ack: "Sure, checking Amazon for you.",
      planMs: 2400,
      totalMs: 18400,
      transcript: "Vergleiche MacBook Preise auf Amazon",
      tasks: [
        {
          id: "t1",
          type: "browser",
          title: "Amazon.com",
          status: "done",
          stepCount: 9,
          steps: [],
        },
      ],
      answer: ANSWER,
      detail: DETAIL,
    }),
  },
  {
    id: "done-detail",
    label: "Panel · Detail-Overlay",
    initial: base({
      phase: "done",
      ack: "Sure, checking Amazon for you.",
      planMs: 2400,
      totalMs: 18400,
      transcript: "Vergleiche MacBook Preise auf Amazon",
      tasks: [
        {
          id: "t1",
          type: "browser",
          title: "Amazon.com",
          status: "done",
          stepCount: 9,
          steps: [],
        },
      ],
      answer: ANSWER,
      detail: DETAIL,
      detailOpen: true,
    }),
  },
  {
    id: "failed",
    label: "Panel · Task failed",
    initial: base({
      phase: "done",
      ack: "That one didn't make it.",
      planMs: 1900,
      totalMs: 22100,
      transcript: "Prüfe irgendwas",
      tasks: [
        {
          id: "t1",
          type: "browser",
          title: "Amazon.com",
          status: "failed",
          stepCount: 6,
          steps: [],
        },
      ],
      answer:
        "Amazon hat den Bot-Check nicht bestanden — kein Ergebnis von dort. Versuch es später erneut.",
    }),
  },
];

/** Wendet ein Demo-Event auf einen State an (pure Funktion, gut testbar). */
export function applyDemoEvent(state: DemoState, ev: DemoEvent): DemoState {
  switch (ev.kind) {
    case "step":
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === ev.taskId ? { ...t, steps: [...t.steps, ev.step] } : t,
        ),
        allSteps: [...state.allSteps, ev.step],
      };
    case "taskStatus":
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === ev.taskId
            ? { ...t, status: ev.status, stepCount: ev.stepCount ?? t.stepCount }
            : t,
        ),
      };
    case "plan":
      return { ...state, planMs: ev.planMs };
    case "answer":
      return {
        ...state,
        answer: ev.text,
        detail: ev.detail ?? null,
        totalMs: ev.totalMs,
        phase: "done",
      };
    case "phase":
      return { ...state, phase: ev.phase };
  }
}

/** Kurzbeschreibung eines Events fürs Demo-Log. */
export function describeDemoEvent(ev: DemoEvent): string {
  switch (ev.kind) {
    case "step":
      return `step ${ev.taskId}: ${ev.step.tool ?? "?"} ${ev.step.target ?? ""}${ev.step.ok ? "" : " (FAIL)"}`;
    case "taskStatus":
      return `task ${ev.taskId} → ${ev.status}`;
    case "plan":
      return `plan (${(ev.planMs / 1000).toFixed(1)}s) → Executing`;
    case "answer":
      return `answer (${ev.text.length} chars)`;
    case "phase":
      return `phase → ${ev.phase}`;
  }
}
