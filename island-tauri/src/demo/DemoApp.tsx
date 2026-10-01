import { useEffect, useRef, useState } from "react";
import App, {
  PILL_H,
  PILL_W,
  PANEL_W,
  PILL_HEIGHT,
} from "../App";
import { __demoSetState, reset, resultsPanelSize, useAgent } from "../lib/agent-state";
import {
  SCENARIOS,
  applyDemoEvent,
  describeDemoEvent,
  type DemoEvent,
  type DemoState,
} from "./scenarios";

/**
 * Dev-Harness (?demo in der URL): spielt Szenarien + Event-Skripte in den
 * ECHTEN Store, die ECHTE App rendert. UI-Iteration im Browser mit HMR,
 * ohne Voice-Calls, ohne Tauri (invoke/listen rejecten still im Browser).
 *
 * Aufruf: `bun run dev` + http://localhost:5173/?demo
 */

// Darstellungspacing im Fake-Desktop (Menüleiste ist Deko).
const TICK_SLOW = 750;
const TICK_FAST = 300;

function freshInitial(id: string): { state: DemoState; script: DemoEvent[] } {
  const sc = SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
  return {
    state: { ...sc.initial, tasks: structuredClone(sc.initial.tasks), allSteps: [...sc.initial.allSteps], startedAt: Date.now() },
    script: sc.script ?? [],
  };
}

export default function DemoApp() {
  const [scenarioId, setScenarioId] = useState("listening");
  const [local, setLocal] = useState<DemoState>(() => freshInitial("listening").state);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedMs, setSpeedMs] = useState(TICK_SLOW);
  const [log, setLog] = useState<string[]>([]);
  const localRef = useRef(local);
  localRef.current = local;

  const select = (id: string) => {
    const sc = SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
    const { state, script } = freshInitial(id);
    // Store zuerst leeren: sonst ueberlebt z. B. ein offenes
    // Detail-Overlay oder eine alte Antwort den Szenario-Wechsel.
    reset();
    localRef.current = state;
    setLocal(state);
    setScenarioId(sc.id);
    setCursor(0);
    setLog([`— ${sc.label}`]);
    __demoSetState(state);
    setPlaying(script.length > 0);
  };

  const doReset = () => {
    setPlaying(false);
    setCursor(0);
    setLog([]);
    reset();
    const st = localRef.current;
    setLocal({ ...st, phase: "idle" });
  };

  // Direkt mit etwas Sichtbarem starten (StrictMode-safe: select ist
  // idempotent — reset + voller Store-Overwrite).
  useEffect(() => {
    select("listening");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ein Event pro Tick (StrictMode-safe: kein Seiteneffekt im Updater).
  useEffect(() => {
    if (!playing) return;
    const sc = SCENARIOS.find((s) => s.id === scenarioId);
    const script = sc?.script ?? [];
    if (cursor >= script.length) {
      setPlaying(false);
      return;
    }
    const t = window.setTimeout(() => {
      const ev = script[cursor];
      const next = applyDemoEvent(localRef.current, ev);
      localRef.current = next;
      setLocal(next);
      __demoSetState(next);
      setLog((prev) => [...prev.slice(-5), describeDemoEvent(ev)]);
      setCursor((c) => c + 1);
    }, speedMs);
    return () => window.clearTimeout(t);
  }, [playing, cursor, scenarioId, speedMs]);

  const sc = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];
  const scriptLen = sc.script?.length ?? 0;

  // Fake-OS-Fenster: bildet exakt die Rust-Fenstergrössen pro Phase nach,
  // damit Proportionen 1:1 wie in Produktion aussehen (die App selbst
  // rendert mit width/height 100% des Fensters).
  const live = useAgent();
  const winVisible = live.phase !== "idle" || live.question !== null;
  // Fake-OS-Fenster: bildet die Prod-Fenstergroessen pro Phase nach —
  // Small-Pill fuer ALLE Status + Done ("Results ready"), Panel-Hoehe
  // nur fuer Frage. Overlay = monitorabhaengige Leseflaeche wie in Prod
  // (Browser-screen als Naeherung). Breite je State.
  const scrW =
    typeof window !== "undefined" && window.screen ? window.screen.width : 1728;
  const scrH =
    typeof window !== "undefined" && window.screen
      ? window.screen.height
      : 1117;
  const resultsSize = resultsPanelSize(scrW, scrH);
  const winW = live.detailOpen
    ? resultsSize.width
    : live.question
      ? PANEL_W
      : PILL_W;
  const winH = live.detailOpen
    ? resultsSize.height
    : live.question
      ? PILL_HEIGHT
      : PILL_H;

  return (
    <div className="min-h-screen bg-[#0d1117] font-sans text-[#e8eaf0]">
      {/* Toolbar */}
      <header className="sticky top-0 z-50 flex flex-wrap items-center gap-1.5 border-b border-white/10 bg-[#0d1117]/95 px-4 py-2 backdrop-blur">
        <span className="mr-2 font-mono text-[11px] tracking-widest text-white/40 uppercase">
          demo
        </span>
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => select(s.id)}
            className={`rounded-md border px-2 py-1 font-mono text-[11px] transition-colors ${
              s.id === scenarioId
                ? "border-white/40 bg-white/10 text-white"
                : "border-white/10 bg-transparent text-white/55 hover:border-white/25 hover:text-white"
            }`}
          >
            {s.label}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-white/10" />
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          disabled={scriptLen === 0}
          className="rounded-md border border-white/10 px-2 py-1 font-mono text-[11px] text-white/70 hover:border-white/25 disabled:opacity-30"
        >
          {playing ? "⏸ pause" : "▶ stream"}
        </button>
        <button
          type="button"
          onClick={() => setSpeedMs((v) => (v === TICK_SLOW ? TICK_FAST : TICK_SLOW))}
          className="rounded-md border border-white/10 px-2 py-1 font-mono text-[11px] text-white/70 hover:border-white/25"
        >
          {speedMs === TICK_SLOW ? "1×" : "2.5×"}
        </button>
        <button
          type="button"
          onClick={doReset}
          className="rounded-md border border-white/10 px-2 py-1 font-mono text-[11px] text-white/70 hover:border-white/25"
        >
          reset
        </button>
        <span className="ml-auto font-mono text-[11px] text-white/40">
          {local.phase}
          {local.planMs != null && ` · plan ${(local.planMs / 1000).toFixed(1)}s`}
          {local.answer ? " · answer" : ""}
          {local.detailOpen ? " · overlay" : ""}
          {scriptLen > 0 && ` · ${cursor}/${scriptLen}`}
          {playing && " · streaming…"}
        </span>
      </header>

      {/* Bühne: Fake-Desktop mit Menüleiste, Pill dockt oben an.
          Das Fenster um <App/> hat exakt Produktions-Masse (Rust-seitig),
          damit Proportionen stimmen — sonst stretcht die Pill auf
          Bühnenbreite. CSS-Transition statt hartem Snap. */}
      <div className="flex justify-center px-4 pt-8 pb-4">
        <div className="relative h-[760px] w-[1600px] max-w-[94vw] overflow-hidden rounded-[28px] border border-white/10 bg-gradient-to-b from-[#171c26] to-[#090c11] shadow-2xl">
          <div className="flex h-7 items-center gap-2 px-4 text-[11px] text-white/60">
            <span className="flex gap-1.5" aria-hidden="true">
              <span className="size-2.5 rounded-full bg-[#ff5f57]" />
              <span className="size-2.5 rounded-full bg-[#febc2e]" />
              <span className="size-2.5 rounded-full bg-[#28c840]" />
            </span>
            <span className="ml-2 font-semibold text-white/80">Finder</span>
            <span className="hidden sm:inline">File&nbsp;&nbsp;Edit&nbsp;&nbsp;View&nbsp;&nbsp;Window</span>
            <span className="ml-auto tabular-nums">Di 9:41</span>
          </div>
          <div className="relative flex h-[calc(100%-28px)] justify-center">
            {winVisible ? (
              <div
                className="transition-[width,height] duration-300 ease-out"
                style={{ width: winW, height: winH }}
              >
                <App />
              </div>
            ) : (
              <div className="pt-16 font-mono text-[11px] text-white/25">
                idle — Fenster versteckt (Szenario wählen)
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Event-Log: was der Player zuletzt in den Store geschrieben hat */}
      <div className="mx-auto max-w-[1040px] px-4 pb-10">
        <div className="rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-white/60">
          <div className="mb-1 text-[10px] tracking-widest text-white/30 uppercase">
            store writes
          </div>
          {log.length === 0 ? (
            <div className="text-white/25">— noch nichts —</div>
          ) : (
            <ol className="m-0 list-none p-0">
              {log.map((line, i) => (
                <li key={`${i}-${line}`}>› {line}</li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
