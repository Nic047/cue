import { parseAgentEvent } from "../../../shared/agent-events";
import { useEffect, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { playSound, primeAudioOnGesture } from "@/lib/sound-engine";
import { play as playCue } from "cuelume";
import { click002Sound } from "@/lib/click-002";

export { HOLD_TO_PEEK_MS } from "./setup-options";
let onboardingWatching = false;
const SILENCE_PEAK_THRESHOLD = 0.01;
const RECENT_CHATS_KEY = "cue.recent-chats";

export type RecentChat = {
  id: string;
  title: string;
  transcript: string;
  answer: string;
  detail: string;
  totalMs: number | null;
};

export function recentChats(): RecentChat[] {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(RECENT_CHATS_KEY) ?? "[]",
    );
    return Array.isArray(value)
      ? value
          .filter(
            (chat): chat is RecentChat =>
              chat &&
              typeof chat.id === "string" &&
              typeof chat.title === "string" &&
              typeof chat.transcript === "string" &&
              typeof chat.answer === "string" &&
              typeof chat.detail === "string" &&
              (chat.totalMs === null || typeof chat.totalMs === "number"),
          )
          .slice(0, 5)
      : [];
  } catch {
    return [];
  }
}

function saveRecentChat(
  answer: string,
  detail: string,
  generatedTitle?: string,
) {
  const transcript = store.transcript.trim();
  const rawTitle = (generatedTitle?.trim() || transcript || answer).replace(
    /\s+/g,
    " ",
  );
  const title =
    rawTitle.length > 56 ? `${rawTitle.slice(0, 55).trimEnd()}…` : rawTitle;
  const chat: RecentChat = {
    id: crypto.randomUUID(),
    title,
    transcript,
    answer,
    detail,
    totalMs: store.startedAt ? Date.now() - store.startedAt : null,
  };
  const chats = [
    chat,
    ...recentChats().filter((item) => item.id !== chat.id),
  ].slice(0, 5);
  try {
    localStorage.setItem(RECENT_CHATS_KEY, JSON.stringify(chats));
  } catch {
    return;
  }
}

// ---------------------------------------------------------------------
// Typen: die komplette Daten-Infrastruktur fuer Agent-UIs.
// ---------------------------------------------------------------------

export type Phase =
  | "idle"
  | "arming"
  | "listening"
  | "transcribing"
  | "working"
  | "error"
  | "done";

export interface PlanTask {
  id: string;
  type: "browser" | "sandbox";
  title: string;
  /** Steps dieses Tasks (bereits ohne Titel-Prefix). */
  steps: AgentStep[];
  /** Status: laeuft / fertig (ok) / fertig (failed). undefined = noch nicht gestartet. */
  status?: "running" | "done" | "failed";
  stepCount?: number;
}

export interface AgentStep {
  /** Text ohne Task-Titel-Prefix, z.B. "navigate ok". */
  label: string;
  /** true = Tool ok / normales Event, false = Tool fehlgeschlagen. */
  ok: boolean;
  /** Tool-Name (navigate, click, read_page, run_command...), falls strukturiert. */
  tool?: string;
  /** Ziel des Tools: URL, Selector, Befehl etc. */
  target?: string;
  /** Zugeordneter Task (falls bekannt). */
  taskId?: string;
}

export interface AgentState {
  phase: Phase;
  transcript: string;
  onboardingActive: boolean;
  error: string | null;
  /** Kurzer Einleitungssatz des Planers (< 10 Woerter, Englisch). */
  ack: string;
  /** Plan-Summary (ein Satz). */
  planSummary: string;
  strategy: string;
  tasks: PlanTask[];
  /** Alle Steps aller Tasks chronologisch (fuer eine flache Timeline). */
  allSteps: AgentStep[];
  /** Finale Antwort (Markdown), null bis vorhanden. */
  answer: string | null;
  /** Ausführliche Fassung (nur via Detail-Overlay), null wenn keine. */
  detail: string | null;
  /** Detail-Overlay geöffnet. */
  detailOpen: boolean;
  /** Offene Rückfrage des Orchestrators (Overlay, phasenunabhängig). */
  question: AgentQuestion | null;
  /** Plan-Dauer in ms (Plan-Event minus Run-Start), null bis geplant. */
  planMs: number | null;
  /** Gesamtlaufzeit in ms (eingefroren bei Antwort), null bis fertig. */
  totalMs: number | null;
  /** Panel aufgeklappt (wird auch vom ?demo-Harness gelesen). */
  expanded: boolean;
  /** Laufzeit in Sekunden seit Orchestrator-Start (null = laeuft nicht). */
  elapsedSec: number | null;
}

/** Rückfrage des Orchestrators: Text + antippbare Optionen + Freitext. */
export interface AgentQuestion {
  text: string;
  options: string[];
}

/**
 * true im ?demo-Browser-Harness (UI-Iteration ohne Task): Prod-Timer wie
 * der Done-Auto-Collapse werden dann pausiert, damit man in Ruhe auf
 * States schauen kann. In Tauri gibt es keinen Query-String — immer false.
 */
export const IS_DEMO =
  typeof window !== "undefined" &&
  typeof window.location !== "undefined" &&
  new URLSearchParams(window.location.search).has("demo");

/** Wide reading panel, capped to the available monitor size. */
export function resultsPanelSize(
  screenW: number,
  screenH: number,
): { width: number; height: number } {
  const height = Math.min(
    screenH - 48,
    Math.max(320, Math.round(screenH * 0.45)),
  );
  const width = Math.min(
    screenW - 48,
    Math.max(
      520,
      Math.min(Math.round(height * 2.45), Math.round(screenW * 0.78)),
    ),
  );
  return { width, height };
}

// ---------------------------------------------------------------------
// Store: ein globales Singleton, mehrere Hooks teilen sich den Stand.
// ---------------------------------------------------------------------

interface Store {
  phase: Phase;
  error: string | null;
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
  startedAt: number | null;
  /** Panel aufgeklappt (wird auch vom ?demo-Harness gelesen). */
  expanded: boolean;
  listeners: Set<() => void>;
  transcript: string;
}

const store: Store = {
  phase: "idle",
  error: null,
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
  startedAt: null,
  expanded: true,
  listeners: new Set(),
  transcript: "",
};

function notify() {
  store.listeners.forEach((fn) => fn());
  if (onboardingWatching)
    void emitTo("onboarding", "onboarding-state", {
      phase: store.phase,
      error: store.error,
      answer: store.answer,
      detailOpen: store.detailOpen,
      tasks: store.tasks,
      transcript: store.transcript,
      question: store.question,
    });
}

function set(patch: Partial<Store>) {
  Object.assign(store, patch);
  notify();
}

export function openRecentChat(id: string): boolean {
  if (
    ["arming", "listening", "transcribing", "working"].includes(store.phase)
  ) {
    return false;
  }
  const chat = recentChats().find((item) => item.id === id);
  if (!chat) return false;
  set({
    phase: "done",
    error: null,
    transcript: chat.transcript,
    answer: chat.answer,
    detail: chat.detail || null,
    totalMs: chat.totalMs,
    detailOpen: true,
    question: null,
    tasks: [],
    allSteps: [],
  });
  return true;
}

export function deleteRecentChat(id: string) {
  const chats = recentChats().filter((chat) => chat.id !== id);
  try {
    localStorage.setItem(RECENT_CHATS_KEY, JSON.stringify(chats));
  } catch {
    return;
  }
}

/** Entfernt den Task-Titel-Prefix ("<Titel>: navigate ok" -> "navigate ok"). */
function cleanStep(msg: string): string {
  for (const t of store.tasks) {
    if (msg.startsWith(t.title + ": ")) return msg.slice(t.title.length + 2);
  }
  return msg;
}

/** Findet den laufenden Task zu einer Step-Nachricht (Titel-Prefix-Match). */
function taskForMessage(msg: string): PlanTask | undefined {
  return store.tasks.find((t) => msg.startsWith(t.title + ": "));
}

// ---------------------------------------------------------------------
// Event-Verdrahtung: Tauri-Events -> Store. Einmal global, nicht pro Hook.
// ---------------------------------------------------------------------

let wired = false;

function ensureWired() {
  if (wired) return;
  wired = true;
  void listen<boolean>("onboarding-watch", ({ payload }) => {
    onboardingWatching = payload;
    notify();
  });
  void listen<string>("onboarding-run-task", ({ payload }) => {
    if (["idle", "done", "error"].includes(store.phase)) runTextTask(payload);
  });
  void listen<string>("onboarding-retry-task", ({ payload }) => {
    if (["idle", "done", "error", "working"].includes(store.phase))
      runTextTask(payload);
  });
  void listen("onboarding-open-result", () => openDetail());
  void listen("onboarding-start-over", () => {
    if (["idle", "done", "error"].includes(store.phase)) reset();
  });
  void listen("onboarding-closed", () => {
    onboardingWatching = false;
    if (["arming", "listening", "transcribing"].includes(store.phase)) cancel();
  });

  // Echte Klicks/Tasten im Fenster wecken den AudioContext — der globale
  // Shortcut allein ist keine User-Geste, sonst bleibt er ggf. suspendiert
  // (Autoplay-Policy) und Sounds spielen stumm ab.
  primeAudioOnGesture();
  // Bluetooth verbinden/trennen tauscht die Audiogeraete unter einer
  // laufenden Aufnahme weg: loggen (entprellt — BT feuert im Burst) +
  // tote Aufnahme sauber abbrechen, statt Stille zu schicken.
  let lastDevChangeLog = 0;
  try {
    navigator.mediaDevices?.addEventListener?.("devicechange", () => {
      const now = Date.now();
      if (now - lastDevChangeLog > 2000) {
        lastDevChangeLog = now;
        void invoke("log_line", {
          line: "[island] Audiogeräte geändert (z. B. Bluetooth verbunden/getrennt).",
        });
      }
    });
  } catch {
    /* ignore */
  }

  listen<string>("orchestrator-event", (e) => {
    const ev = parseAgentEvent(e.payload);
    if (!ev) {
      void invoke("log_line", {
        line: "[island] Unknown or malformed agent event ignored.",
      });
      return;
    }

    if (ev.type === "plan") {
      set({
        ack: ev.ack ?? "",
        planSummary: ev.summary ?? "",
        strategy: ev.strategy ?? "",
        question: null,
        planMs: store.startedAt ? Date.now() - store.startedAt : null,
        tasks: (ev.tasks ?? []).map((t) => ({
          id: t.id,
          type: t.type,
          title: t.title,
          steps: [],
        })),
      });
    } else if (ev.type === "question") {
      const options = Array.isArray(ev.options) ? ev.options.slice(0, 4) : [];
      set({
        question: { text: String(ev.text ?? ""), options },
      });
    } else if (ev.type === "task_start") {
      const msg = ev.message ?? "";
      const task = ev.taskId
        ? store.tasks.find((t) => t.id === ev.taskId)
        : taskForMessage(msg);
      if (task) {
        set({
          tasks: store.tasks.map((t) =>
            t.id === task.id ? { ...t, status: "running" as const } : t,
          ),
        });
      }
      const step: AgentStep = { label: cleanStep(msg), ok: true };
      set({ allSteps: [...store.allSteps, step] });
    } else if (ev.type === "step") {
      // Neue strukturierte Form: { taskId, tool, target, ok }.
      if (ev.tool) {
        const structured: AgentStep = {
          label: "",
          ok: Boolean(ev.ok),
          tool: ev.tool,
          target: ev.target,
          taskId: ev.taskId,
        };
        set({
          tasks: store.tasks.map((t) =>
            t.id === ev.taskId ? { ...t, steps: [...t.steps, structured] } : t,
          ),
          allSteps: [...store.allSteps, structured],
        });
        return;
      }
      // Fallback: freier Text-Step (LLM-Gedanke etc.).
      const msg = ev.message ?? "";
      const raw = cleanStep(msg);
      const ok = ev.ok !== false && !raw.includes("fehlgeschlagen");
      const step: AgentStep = { label: raw, ok };
      const task = ev.taskId
        ? store.tasks.find((t) => t.id === ev.taskId)
        : taskForMessage(msg);
      if (task) {
        set({
          tasks: store.tasks.map((t) =>
            t.id === task.id ? { ...t, steps: [...t.steps, step] } : t,
          ),
          allSteps: [...store.allSteps, step],
        });
      } else {
        set({ allSteps: [...store.allSteps, step] });
      }
    } else if (ev.type === "task_done") {
      const task = store.tasks.find((t) =>
        ev.taskId ? t.id === ev.taskId : t.title === ev.title,
      );
      const step: AgentStep = {
        label: `${ev.ok ? "OK" : "FEHLER"} — ${ev.title ?? ""} (${ev.steps ?? 0} steps)`,
        ok: Boolean(ev.ok),
      };
      set({
        tasks: store.tasks.map((t) =>
          t.id === (task?.id ?? "")
            ? {
                ...t,
                status: ev.ok ? ("done" as const) : ("failed" as const),
                stepCount: ev.steps,
              }
            : t,
        ),
        allSteps: [...store.allSteps, step],
      });
    } else if (ev.type === "answer") {
      // Kein aktiver Lauf (idle nach Cancel/Kill)? Dann ist das ein spaetes
      // Event eines toten Laufs — ignorieren statt "random" die Pill zu oeffnen.
      if (store.phase === "idle") {
        invoke("log_line", {
          line: "[island] Späte Antwort ignoriert (kein aktiver Lauf).",
        });
        return;
      }
      const answer = String(ev.text ?? "");
      const detail = typeof ev.detail === "string" ? ev.detail : "";
      if (answer.trim()) {
        saveRecentChat(
          answer,
          detail,
          typeof ev.chatTitle === "string" ? ev.chatTitle : undefined,
        );
      }
      set({
        answer,
        question: null,
        detail: detail || null,
        phase: "done",
        totalMs: store.startedAt ? Date.now() - store.startedAt : null,
      });
      // Results ready: Cuelume-"scan" als Fertig-Signal. Fire-and-forget —
      // bricht nie den Flow (cuelume schluckt Blockaden selbst, Guard trotzdem).
      try {
        playCue("scan");
      } catch {
        /* ignore */
      }
    } else if (ev.type === "agent_error") {
      set({
        phase: "error",
        error: String(ev.message ?? "Cue agent exited unexpectedly."),
      });
    }
  });

  listen("orchestrator-done", () => {
    // Falls kein answer-Event kam (Prozess tot / gekillt): trotzdem abschliessen.
    if (store.phase === "error") return;
    set({ phase: store.answer ? "done" : "idle" });
    if (!store.answer) reset();
  });
}

// ---------------------------------------------------------------------
// Aktionen + Hooks
// ---------------------------------------------------------------------

// Laufende Aufnahme-Generation: cancel()/Neustart machen alte native
// Start- und Transkriptionsketten wirkungslos.
let listenGen = 0;
let stopRecording: (() => void) | undefined;
let mediaControlQueue: Promise<void> | null = null;

function queueMediaControl(action: "pause" | "resume") {
  const command =
    action === "pause"
      ? "pause_media_for_listening"
      : "resume_media_after_listening";
  const next = (
    mediaControlQueue
      ? mediaControlQueue.then(() => invoke(command))
      : invoke(command)
  ).then(() => {});
  mediaControlQueue = next.catch((err) => {
    void invoke("log_line", {
      line: `[island] Media ${action} failed: ${err}`,
    });
  });
}

function showAudioError(message: string, detail?: string) {
  const gen = ++listenGen;
  if (detail) void invoke("log_line", { line: `[island] ${detail}` });
  if (onboardingWatching)
    void emitTo("onboarding", "onboarding-failure", detail || message);
  set({ phase: "error", error: message });
  window.setTimeout(() => {
    if (gen === listenGen && store.phase === "error") reset();
  }, 5000);
}

export function startListening() {
  ensureWired();
  // cancel()/Neustart invalidieren auch einen noch startenden nativen Stream.
  const gen = ++listenGen;
  set({ phase: "arming", error: null });
  queueMediaControl("pause");
  // Akustische Bestätigung (soundCN click-002): Transkription startet.
  // Fehler NICHT schlucken: "kein Ton" ist sonst unsichtbar (typisch:
  // AudioContext suspendiert, weil der Shortcut keine User-Geste ist).
  playSound(click002Sound.dataUri).catch((err) => {
    void invoke("log_line", { line: `[island] Klick-Sound stumm: ${err}` });
  });
  void invoke<string>("start_audio_recording")
    .then((device) => {
      if (gen !== listenGen) {
        void invoke("cancel_audio_recording");
        queueMediaControl("resume");
        return;
      }
      void invoke("log_line", { line: `[island] Native Mic: "${device}"` });
      set({ phase: "listening" });
      const stopAndTranscribe = () => {
        if (store.phase !== "listening") return;
        set({ phase: "transcribing" });
        void invoke<{
          dataUri: string;
          device: string;
          maxPeak: number;
          durationMs: number;
        }>("stop_audio_recording")
          .then(async (recording) => {
            queueMediaControl("resume");
            if (gen !== listenGen) return;
            const blob = await fetch(recording.dataUri).then((response) =>
              response.blob(),
            );
            void invoke("log_line", {
              line: `[island] Audio: ${blob.size} bytes, WAV=${recording.durationMs}ms, Mic="${recording.device}", maxPegel=${recording.maxPeak.toFixed(3)}`,
            });
            if (blob.size <= 44) {
              showAudioError(
                recording.durationMs < 700
                  ? "Recording too short"
                  : "No audio captured",
                "Native Aufnahme lieferte keine Samples.",
              );
              return;
            }
            if (recording.maxPeak < SILENCE_PEAK_THRESHOLD) {
              showAudioError(
                "Couldn't hear speech",
                "Aufnahme war komplett still; Eingabegerät prüfen.",
              );
              return;
            }
            invoke<string>("transcribe_recording", {
              dataUri: recording.dataUri,
            })
              .then((text) => {
                if (gen !== listenGen) return;
                if (!text.trim()) {
                  showAudioError("Try again.");
                  return;
                }
                runTextTask(text);
              })
              .catch((err) => {
                if (gen !== listenGen) return;
                invoke("log_line", {
                  line: `[island] Transkription fehlgeschlagen: ${err}`,
                });
                showAudioError("Transcription failed", String(err));
              });
          })
          .catch((err) => {
            queueMediaControl("resume");
            if (gen !== listenGen) return;
            invoke("log_line", {
              line: `[island] Aufnahme-Stop fehlgeschlagen: ${err}`,
            });
            showAudioError("Recording failed");
          });
      };
      stopRecording = stopAndTranscribe;
      window.setTimeout(() => {
        if (gen !== listenGen || store.phase !== "listening") return;
        invoke("log_line", {
          line: "[island] 5-Minuten-Aufnahmelimit erreicht.",
        });
        stopAndTranscribe();
      }, 300_000);
    })
    .catch((err) => {
      queueMediaControl("resume");
      if (gen !== listenGen) return;
      invoke("log_line", {
        line: `[island] Mikrofon nicht verfuegbar: ${err}`,
      });
      showAudioError("Microphone unavailable");
    });
}

export function stopListeningAndRun() {
  const stop = stopRecording;
  if (store.phase === "arming") {
    listenGen++;
    void invoke("cancel_audio_recording");
    queueMediaControl("resume");
    showAudioError("Microphone not ready");
  } else if (stop) stop();
}

/**
 * Nur verstecken (Task laeuft im Hintergrund weiter). Bei Fertigstellung
 * (answer-Event) zeigt sich die Pill von selbst wieder.
 */
export function hidePill() {
  void invoke("hide_window");
}

export function cancel() {
  listenGen++;
  void invoke("cancel_audio_recording");
  queueMediaControl("resume");
  stopRecording = undefined;
  void invoke("kill_task");
  reset();
}

export function reset() {
  set({
    phase: "idle",
    error: null,
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
    startedAt: null,
    transcript: "",
  });
}

/** Detail-Overlay öffnen/schliessen (nur wenn Detail vorhanden). */
export function openDetail() {
  // Summary allein reicht (Fallback-Merge ohne Detail) — Overlay zeigt,
  // was da ist.
  if (store.detail || store.answer) set({ detailOpen: true });
}

export function closeDetail() {
  set({ detailOpen: false });
}

/**
 * Rückfrage beantworten: Text an den Orchestrator (stdin) + Frage lokal
 * schliessen (der folgende plan-Task baut die Ansicht neu auf).
 * "" = ausdrücklich Cue entscheiden lassen; Timeout startet keine Tasks.
 */
export function answerQuestion(text: string) {
  set({ question: null });
  invoke("answer_question", { text }).catch((err) => {
    invoke("log_line", {
      line: `[island] Antwort senden fehlgeschlagen: ${err}`,
    });
  });
}

function runTextTask(text: string) {
  if (!text.trim()) return;
  set({
    phase: "working",
    error: null,
    transcript: text,
    startedAt: Date.now(),
    tasks: [],
    allSteps: [],
    answer: null,
    detail: null,
    detailOpen: false,
    question: null,
    planMs: null,
    totalMs: null,
  });
  void invoke("run_task", { task: text }).catch((err) =>
    showAudioError("Couldn't start task", String(err)),
  );
}

/**
 * Dev-Demo: Store direkt setzen (nur für den ?demo-Harness, nie im
 * Produktivpfad verwendet). Ermöglicht UI-Iteration ohne Voice-Calls.
 */
export function __demoSetState(patch: {
  phase?: Phase;
  error?: string | null;
  ack?: string;
  planSummary?: string;
  strategy?: string;
  tasks?: PlanTask[];
  allSteps?: AgentStep[];
  answer?: string | null;
  detail?: string | null;
  detailOpen?: boolean;
  question?: AgentQuestion | null;
  planMs?: number | null;
  totalMs?: number | null;
  expanded?: boolean;
  startedAt?: number | null;
  transcript?: string;
}) {
  set(patch);
}

/**
 * Panel auf-/zuklappen (geteilter State, damit ?demo-Harness und App
 * dieselbe Quelle lesen).
 */
export function setExpanded(v: boolean) {
  set({ expanded: v });
}

/**
 * Der zentrale UI-Hook: alles, was eine Agent-UI braucht.
 *
 * const { phase, plan, steps, answer, actions } = useAgent();
 */
export function useAgent(): AgentState & {
  /** Escape / Shortcut-Handling: bricht alles ab. */
  cancel: () => void;
  /** Nach "done": alles zuruecksetzen. */
  reset: () => void;
} {
  ensureWired();
  const [, tick] = useState(0);
  useEffect(() => {
    const fn = () => tick((n) => n + 1);
    store.listeners.add(fn);
    return () => {
      store.listeners.delete(fn);
    };
  }, []);

  // Verstrichene Zeit live mitzaehlen (100ms-Takt, 1 Dezimale).
  const [elapsedSec, setElapsedSec] = useState<number | null>(null);
  useEffect(() => {
    if (store.phase !== "working") {
      setElapsedSec(null);
      return;
    }
    const iv = window.setInterval(() => {
      if (store.startedAt)
        setElapsedSec(Math.round((Date.now() - store.startedAt) / 100) / 10);
    }, 100);
    return () => window.clearInterval(iv);
  }, [store.phase]);

  return {
    phase: store.phase,
    error: store.error,
    ack: store.ack,
    planSummary: store.planSummary,
    strategy: store.strategy,
    tasks: store.tasks,
    allSteps: store.allSteps,
    answer: store.answer,
    detail: store.detail,
    detailOpen: store.detailOpen,
    question: store.question,
    planMs: store.planMs,
    totalMs: store.totalMs,
    expanded: store.expanded,
    elapsedSec,
    transcript: store.transcript,
    onboardingActive: onboardingWatching,
    cancel,
    reset,
  };
}

// Shortcut-Events (rechte Option / Escape) -> Aktionen. Global, einmal.
let shortcutsWired = false;
export function wireShortcuts(handlers: {
  onToggle: () => void;
  onCancel: () => void;
  onRelease?: () => void;
}) {
  if (shortcutsWired) return;
  shortcutsWired = true;
  ensureWired();
  // Entprellung: Falls der Tap je doppelt feuert, fasst dieses Fenster
  // zwei Events zu EINEM Toggle zusammen (Gurtel + Hosentraeger zur
  // Rust-Flanke). 100ms filtert Hardware-Doppel (<50ms), laesst aber
  // bewusste Doppel-Taps (150ms+, z.B. Results oeffnen) durch.
  let lastToggle = 0;
  listen("shortcut-pressed", () => {
    const now = Date.now();
    if (now - lastToggle < 100) return;
    lastToggle = now;
    handlers.onToggle();
  });
  // Release-Flanke der rechten Option (fuer Hold-to-Peek). Optional —
  // ohne Handler passiert nichts.
  listen("shortcut-released", () => handlers.onRelease?.());
  listen("escape-pressed", () => handlers.onCancel());
}
