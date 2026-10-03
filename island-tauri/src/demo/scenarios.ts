import type {
  AgentQuestion,
  AgentStep,
  Phase,
  PlanTask,
} from "../lib/agent-state";

/** Development scenarios exercise real UI states without voice or cloud calls. */

/** Complete store snapshot for a scenario. */
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

/** One event is applied per tick in streaming mode. */
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
  /** Optional event sequence for streaming mode. */
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
  "Example result: MacBook Pro 14″ is €1,999 at MediaMarkt, €200 below the Apple Store.";

const DETAIL =
  "Illustrative MacBook Pro 14″ price comparison:\n\n" +
  "- MediaMarkt: €1,999 (free shipping, in stock)\n" +
  "- Amazon.de: €2,049 (marketplace seller, 2–3 days)\n" +
  "- Apple Store: €2,199 (list price)\n\n" +
  "Demo data only; these are not live prices. Lowest example price: MediaMarkt.";

/** Working-state tasks drive the agent indicator. */
function workingBase(
  over: Partial<DemoState> & { taskCount?: number },
): DemoState {
  const { taskCount = 1, ...rest } = over;
  const titles = ["Amazon.com", "MediaMarkt", "Python script"];
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
    transcript: "Compare MacBook prices",
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
    label: "Panel · Question",
    initial: base({
      phase: "working",
      ack: "One quick thing.",
      planMs: 1200,
      transcript: "Compare prices",
      question: {
        text: "What would you like to discover on Product Hunt?",
        options: ["Discover products", "Read tech news", "Present a project", "Just browse"],
      },
    }),
  },
  {
    id: "done",
    label: "Panel · Done + Answer",
    initial: base({
      phase: "done",
      ack: "Sure, checking Amazon for you.",
      planMs: 2400,
      totalMs: 18400,
      transcript: "Compare MacBook prices on Amazon",
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
    label: "Panel · Details",
    initial: base({
      phase: "done",
      ack: "Sure, checking Amazon for you.",
      planMs: 2400,
      totalMs: 18400,
      transcript: "Compare MacBook prices on Amazon",
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
      transcript: "Check a website",
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
        "Amazon blocked automated access. No result is available from that source; try again later.",
    }),
  },
];

/** Pure state update for a demo event. */
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

/** Short event description for the demo log. */
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
