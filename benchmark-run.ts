import { waitWithTimeout } from "./shared/wait-with-timeout.js";
/**
 * Ein Benchmark-Durchlauf (Kindprozess): fixierte example.com-Task auf der
 * Fast-Lane (stealth:false), Modell kommt per CHEAP/FALLBACK_MODEL-Env.
 * Gibt genau EINE JSON-Zeile auf stdout aus.
 */
import "dotenv/config";
import { Solari } from "@solarisdk/browser";
import { runBrowserTask, type Task } from "./orchestrator.js";

const MODEL = process.env.CHEAP_MODEL ?? "unknown";

const task: Task = {
  id: "bench-1",
  type: "browser",
  title: "Benchmark example.com",
  instruction:
    "Open https://example.com and report its exact page title. " +
    "Answer with nothing but the title. Max 4 tool calls.",
  source: "example.com",
  stealth: false,
};

async function main() {
  const solari = new Solari({ apiKey: process.env.SOLARI_API_KEY! });
  const t0 = Date.now();
  try {
    const result = await runBrowserTask(task, solari, () => {});
    const ms = Date.now() - t0;
    const valid = result.ok && result.text.includes("Example Domain");
    console.log(
      JSON.stringify({
        model: MODEL,
        ok: result.ok,
        valid,
        ms,
        steps: result.steps,
        msPerStep: result.steps > 0 ? Math.round(ms / result.steps) : null,
        text: result.text.slice(0, 120),
        error: result.error?.slice(0, 200) ?? null,
      }),
    );
  } catch (err) {
    console.log(
      JSON.stringify({
        model: MODEL,
        ok: false,
        valid: false,
        ms: Date.now() - t0,
        steps: 0,
        msPerStep: null,
        text: "",
        error: String(err).slice(0, 200),
      }),
    );
  } finally {
    // close() kann bei angeschlagenem Backend haengen — nicht den
    // JSON-Output (schon gedruckt) blockieren.
    await waitWithTimeout(solari.close(), 10_000, "solari.close").catch(
      () => {},
    );
  }
}

main().then(() => {
  // Kurz spuelen lassen, dann hart beenden: offene Launch-Sockets eines
  // angeschlagenen Backends duerfen den Prozess nicht ewig am Leben halten.
  setTimeout(() => process.exit(0), 2000);
});
