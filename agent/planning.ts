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
    .describe("Task ID, for example 't1'; filled automatically if missing."),
  type: z
    .enum(["browser", "sandbox"])
    .describe(
      "browser: requires a real website or web search. " +
        "sandbox: requires code execution, data processing, building, or testing.",
    ),
  title: z
    .string()
    .default("")
    .describe(
      "Short UI/log title, such as 'Amazon.com' or 'Run Python'; filled if missing.",
    ),
  instruction: z
    .string()
    .describe(
      "Complete, self-contained agent instruction including all relevant details from the user's request.",
    ),
  source: z
    .string()
    .default("")
    .describe(
      "For browser tasks: expected source, if known, such as 'amazon.com'. " +
        "Empty string if unknown or for sandbox tasks.",
    ),
  stealth: z
    .boolean()
    .default(true)
    .describe(
      "Browser only. true (default) for sites with bot defenses " +
        "(Amazon, Google, shops, logins, likely CAPTCHAs): slower " +
        "stealth pool with a US proxy. false for simple public pages " +
        "(examples, documentation, blogs): faster headless pool, " +
        "with lower startup latency.",
    ),
});

const PlanSchema = z.object({
  ack: z
    .string()
    .default("")
    .describe(
      'A brief acknowledgment (at most 8 English words), such as "Sure, checking Amazon for you." No details or plan.',
    ),
  summary: z
    .string()
    .default("")
    .describe("One sentence describing the overall task."),
  // Empty for executable requests.
  note: z
    .string()
    .default("")
    .describe(
      "Only for non-executable messages (greetings, small talk): briefly ask for a concrete task. Otherwise an empty string.",
    ),
  strategy: z
    .enum(["single", "parallel"])
    .describe(
      "single: only one task is needed. " +
        "parallel: multiple tasks for different facts or sources.",
    ),
  tasks: z.array(TaskSchema).max(MAX_PARALLEL_TASKS),
  mergeInstruction: z
    .string()
    .default("")
    .describe("Instruction for merging the final results."),
  // Ask when the user requests a choice or necessary details are missing.
  question: z
    .object({
      text: z.string().describe("A short, specific question for the user."),
      options: z
        .array(z.string())
        .max(4)
        .describe("Up to four short options to select."),
    })
    .optional()
    .describe(
      "Set when the user explicitly asks to be questioned first or essential information is missing. " +
        "The question field opens the interactive panel. Do not merely claim to be waiting in note.",
    ),
});

export type Plan = z.infer<typeof PlanSchema>;
export type Task = z.infer<typeof TaskSchema>;

export async function planTasks(userRequest: string): Promise<Plan> {
  const system = `You plan work for parallel browser and sandbox agents.
Split the user's request into one to ${MAX_PARALLEL_TASKS} concrete, independent tasks.

Each task needs a type:
- browser: visit a real website for research, price comparisons, or public searches. Do not plan purchases, account changes, or submission of personal information.
- sandbox: execute code, process data, build or test something, or perform a calculation.

For browser tasks, use stealth=true for sites with bot defenses (shops, search engines, login pages). Use false only for simple public documentation, examples, or blogs. Default to true if uncertain.

If there is NO executable request (greeting, small talk, or no concrete objective), set tasks=[] and return a short note asking for a task. Never invent work.

Rules:
- Each task's instruction must be self-contained: its agent sees only that instruction, not the original request. Preserve the user's language for instructions and answers.
- Include summary, strategy, tasks, and each task's id, type, title, and instruction.
- Never silently omit part of the request. Make reasonable assumptions for minor missing details and record them in both instruction and mergeInstruction.
- If the user explicitly asks to be questioned first, offered options, or to choose before work begins, you MUST set question. Its text and up to four short options open the interactive question panel. Honor the requested option count up to four. Set note=""; tasks may be empty while awaiting the choice. For example: "Which Python project would you like?", with "To-do app", "Quiz", "File organizer", "Expense tracker". Never merely write that you are waiting in note or in a task.
- Otherwise, ask only when one clarification is essential to produce a useful plan.
- If the request includes an answer to your question, use it and do not ask again. "Cue decides" explicitly delegates the choice; the original task still applies. This overrides an earlier request to ask first: plan tasks, leave note empty, omit question, and state the assumption in the result.
- Use parallel for independent tasks or multiple sources, and single when one task suffices.
- mergeInstruction must request a complete Markdown answer, with sections for separate topics, all requested results, and source links. Request a very short answer only if the user asked for one.
- Do not invent sources or steps unrelated to the request.`;

  // Use manual JSON parsing for models without structured output support.
  if (PLANNER_MODEL.includes("mercury")) {
    return planTasksManualJson(system, userRequest);
  }

  // Retry malformed output up to three times; fill display fields but require an instruction.
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
        `Plan attempt ${attempt} failed${attempt < 3 ? ", Retry…" : "."}`,
      );
    }
  }
  throw lastErr;
}

/** Fill display fields; an executable instruction remains required. */
function fillPlanGaps(plan: Plan): void {
  plan.tasks.forEach((t, i) => {
    if (!t.id) t.id = `t${i + 1}`;
    if (!t.title) t.title = t.instruction.slice(0, 40) || `Task ${i + 1}`;
  });
  if (!plan.summary) plan.summary = `${plan.tasks.length} task(s) to run.`;
}

/** Extract JSON from optional code fences or surrounding prose. */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("No JSON found");
  return JSON.parse(candidate.slice(start, end + 1));
}

/** Fallback planner: parse text as JSON, validate with Zod, then retry with repair feedback. */
async function planTasksManualJson(
  system: string,
  userRequest: string,
): Promise<Plan> {
  const shape = `Return ONLY a JSON object in this form, without Markdown or surrounding explanation:
{"ack": string, "summary": string, "note": string, "strategy": "single|parallel", "tasks": [{"id": string, "type": "browser|sandbox", "title": string, "instruction": string, "source": string, "stealth": boolean}], "mergeInstruction": string, "question": {"text": string, "options": [up to 4 short strings]}}
Omit question when no clarification is needed. Set stealth=false for simple public sites and true for sites with bot defenses; default to true.
Set question when the user asks to choose or be asked first. While waiting, tasks may be empty and note must be empty. Never repeat an answered question.
Use empty strings for unknown fields. Use tasks=[] and a short note only if there is NO executable request. Describe tasks; do not execute them yourself.`;
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
        `Manual plan attempt ${attempt} failed${attempt < 3 ? ", Retry…" : "."}`,
      );
      prompt =
        `${userRequest}\n\nYour last response was not valid plan JSON ` +
        `(${String(err).slice(0, 200)}). Return ONLY corrected JSON in the required format.`;
    }
  }
  throw lastErr;
}
