import "dotenv/config";

export const CHEAP_MODEL = process.env.CHEAP_MODEL ?? "inception/mercury-2.5";
export const FALLBACK_MODEL =
  process.env.FALLBACK_MODEL ?? "inception/mercury-2.5";
export const PLANNER_MODEL = process.env.PLANNER_MODEL ?? FALLBACK_MODEL;
export const MAX_STEPS = 30;
export const MAX_LAUFZEIT_MS = 50 * 60 * 1000;
export const MAX_PARALLEL_TASKS = 5;
export const MODEL_REQUEST_TIMEOUT_MS = 60_000;
