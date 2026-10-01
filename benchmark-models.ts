/**
 * Modell-Vergleich: gleiche example.com-Task (Fast-Lane) pro Modell,
 * je ein frischer Prozess (eigene Modul-Instanz mit eigenem Modell).
 * Nutzung: bun benchmark-models.ts [model1 model2 ...]
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

// WICHTIG: Kindprozesse laufen unter tsx/Node, NICHT Bun —
// patchrights chromium.connect(ws) haengt unter Bun ewig (verifiziert),
// unter Node steht die Session in ~2s. Gleiches gilt für den
// Produktions-Sidecar (binaries/island-agent ruft tsx auf).
const TSX = join(process.cwd(), "node_modules", ".bin", "tsx");

const DEFAULTS = [
  "zai/glm-5.3-flash",
  "zai/glm-5.3-fast",
  "openai/gpt-5-mini-fast",
  "google/gemini-3.5-flash-lite",
];

const models = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULTS;
const PER_MODEL_TIMEOUT_MS = 8 * 60 * 1000;

interface Row {
  model: string;
  ok: boolean;
  valid: boolean;
  ms: number;
  steps: number;
  msPerStep: number | null;
  text: string;
  error: string | null;
}

const rows: Row[] = [];
for (const model of models) {
  console.error(`\n=== ${model} ===`);
  const t0 = Date.now();
  const child = spawnSync(
    TSX,
    ["benchmark-run.ts"],
    {
      env: {
        ...process.env,
        CHEAP_MODEL: model,
        FALLBACK_MODEL: model,
      },
      encoding: "utf-8",
      timeout: PER_MODEL_TIMEOUT_MS,
    },
  );
  const wall = Date.now() - t0;
  if (child.error) {
    console.error(`FEHLER: ${String(child.error).slice(0, 200)}`);
    rows.push({ model, ok: false, valid: false, ms: wall, steps: 0, msPerStep: null, text: "", error: String(child.error).slice(0, 200) });
    continue;
  }
  const errOut = (child.stderr ?? "").trim().split("\n").slice(-3).join(" | ");
  if (errOut) console.error(`(stderr: ${errOut.slice(0, 300)})`);
  const line = (child.stdout ?? "").trim().split("\n").pop() ?? "";
  try {
    rows.push(JSON.parse(line) as Row);
  } catch {
    rows.push({ model, ok: false, valid: false, ms: wall, steps: 0, msPerStep: null, text: "", error: `kein JSON (${line.slice(0, 150)})` });
  }
}

console.error("\n================ ERGEBNIS ================");
console.log("Modell | ok | valide | Zeit | Steps | ms/Step");
for (const r of rows) {
  console.log(
    `${r.model} | ${r.ok ? "ja" : "NEIN"} | ${r.valid ? "ja" : "NEIN"} | ${(r.ms / 1000).toFixed(1)}s | ${r.steps} | ${r.msPerStep ?? "-"}`,
  );
}
if (rows.some((r) => !r.valid)) {
  console.log("--- Details Fehlschläge ---");
  for (const r of rows.filter((r) => !r.valid))
    console.log(`${r.model}: ok=${r.ok} err=${r.error} text=${r.text}`);
}
