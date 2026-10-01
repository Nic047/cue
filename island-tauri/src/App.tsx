import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { AnimatePresence, motion, useSpring } from "framer-motion";
import { Check, Copy, Trash2 } from "lucide-react";
import {
  IS_DEMO,
  HOLD_TO_PEEK_MS,
  resultsPanelSize,
  useAgent,
  wireShortcuts,
  startListening,
  stopListeningAndRun,
  answerQuestion,
  hidePill,
  cancel,
  reset,
  openDetail,
  closeDetail,
  recentChats,
  openRecentChat,
  deleteRecentChat,
  type RecentChat,
} from "./lib/agent-state";
import { QuestionPanel } from "./components/agent-ui";
import { DotmSquare11 } from "./components/ui/dotm-square-11";
import { DotmSquare8 } from "./components/ui/dotm-square-8";
import { IslandShape } from "./components/ui/island-shape";
import { Shimmer } from "./components/ui/shimmer-text";
import { Markdown } from "./components/ui/markdown";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "./components/ui/context-menu";

// Feste Breite fuer alle Text-Zustaende; nur der leere Start-Flash ist schmal.
export const PILL_W = 230;
export const PILL_H = 42; // nur Voice-Pill + Start-Flash (Ausnahmen, s.u.)
const MAX_ERROR_PILL_W = 480;

const ICON_SIZE = 20;
export const PANEL_W = 520;
export const PILL_HEIGHT = 400; // DIE fixe Hoehe aller Status-Zustaende
// Detail-Overlay: fallback size when monitor dimensions are unavailable.
export const OVERLAY_W = 1100;
export const OVERLAY_H = 540;
// Pill kollabiert nach Antwort von selbst zurück (ausser Overlay offen).
const DONE_COLLAPSE_MS = 10_000;
// Start-Flash: winziger Scoop-Blip bei Task-Start, dann Stille.
const FLASH_MS = 700;
// Hold-to-Peek: Option 1.5s halten => Status einblenden; loslassen (oder
// spaetestens nach 5s) => wieder verstecken.

const PEEK_MAX_MS = 5000;
const RECENT_CHATS_W = 420;
const RECENT_CHATS_H = 380;

function log(line: string) {
  void invoke("log_line", { line });
}

function presentWindow(size: { width: number; height: number }, animate = false) {
  return invoke("show_window", { ...size, animate });
}

// Gemeinsame Zeile fuer alle Pill-States: Icon bleibt fest, jeder Text wird
// im gleichen Bereich zwischen Icon und rechter Pill-Kante zentriert.
function PillRow({
  icon,
  children,
  notchWidth = 0,
}: {
  notchWidth?: number;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: notchWidth ? 14 : 50,
          top: 0,
          bottom: 0,
          width: ICON_SIZE,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {icon}
      </div>
      <div
        style={{
          position: "absolute",
          left: notchWidth ? notchWidth + 48 + 14 : 40,
          right: notchWidth ? 14 : 0,
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: 0,
          overflow: "hidden",
          whiteSpace: "nowrap",
        }}
      >
        {children}
      </div>
    </div>
  );
}

export default function App() {
  const [notch, setNotch] = useState({ width: 0, height: 0 });
  const notched = notch.width > 0;
  const PILL_W = notched ? notch.width + 48 + 170 : 230;
  const PILL_ICON_W = notched ? PILL_W : 112;
  const PILL_H = notched ? Math.max(42, notch.height + 8) : 42;
  const [questionContentHeight, setQuestionContentHeight] = useState(340);
  const [questionWidth, setQuestionWidth] = useState(PANEL_W);
  const [questionMaxHeight, setQuestionMaxHeight] = useState(560);
  const PILL_HEIGHT = questionContentHeight + notch.height;
  const pillDimensions = useRef({ width: PILL_W, height: PILL_H });
  pillDimensions.current = { width: PILL_W, height: PILL_H };
  useEffect(() => {
    if (IS_DEMO) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<{ width: number; height: number }>("notch-layout", ({ payload }) => {
      if (!disposed) setNotch(payload);
    }).then(async (stop) => {
      if (disposed) { stop(); return; }
      unlisten = stop;
      const layout = await invoke<{ width: number; height: number }>("get_notch_layout");
      if (!disposed) setNotch(layout);
    }).catch(() => {});
    return () => { disposed = true; unlisten?.(); };
  }, []);
  const agent = useAgent();
  const {
    phase,
    error,
    answer,
    detail,
    detailOpen,
    question,
    planMs,
    totalMs,
    tasks,
    elapsedSec,
    transcript,
    onboardingActive,
  } = agent;
  useEffect(() => {
    if (!question || IS_DEMO) return;
    let disposed = false;
    void currentMonitor().then((monitor) => {
      if (!monitor || disposed) return;
      setQuestionWidth(Math.min(PANEL_W, monitor.size.width / monitor.scaleFactor - 32));
      setQuestionMaxHeight(Math.max(240, monitor.size.height / monitor.scaleFactor - notch.height - 48));
    }).catch(() => {});
    return () => { disposed = true; };
  }, [question, notch.height]);
  const resultMarkdown = detail?.trim() || answer || "";
  const skeletonLineCount = Math.min(
    12,
    Math.max(1, Math.ceil(resultMarkdown.trim().length / 90)),
  );
  const workedSeconds = Math.round((totalMs ?? 0) / 1000);
  const workedLabel =
    totalMs == null
      ? "Work complete"
      : workedSeconds < 60
        ? `Worked for ${workedSeconds}s`
        : `Worked for ${Math.floor(workedSeconds / 60)}m ${String(workedSeconds % 60).padStart(2, "0")}s`;
  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  // Frage-Spiegel für Shortcut-Handler (einmal verdrahtet).
  const questionRef = useRef(question);
  useEffect(() => {
    questionRef.current = question;
  }, [question]);
  // Overlay-Spiegel + Schliessen (stellt Pill-Groesse wieder her).
  const detailOpenRef = useRef(detailOpen);
  useEffect(() => {
    detailOpenRef.current = detailOpen;
  }, [detailOpen]);
  function restorePillSize() {
    if (phaseRef.current === "done") {
      // Zurueck auf kleine Pill (Done = "Results ready", kein Panel).
      void presentWindow(pillDimensions.current, true);
    } else {
      void invoke("hide_window");
    }
  }

  function closeOverlay() {
    closeDetail();
    if (returnToRecentChatsRef.current) {
      returnToRecentChatsRef.current = false;
      setRecentChatItems(recentChats());
      setRecentChatsOpen(true);
      return;
    }
    restorePillSize();
  }

  // Angezeigte Ansicht: Pill fuer alles ausser Frage-Dialog (Done ist
  // seit "Results ready" ebenfalls nur noch die kleine Pill).
  const [view, setView] = useState<"pill" | "panel" | null>(null);
  const [recentChatsOpen, setRecentChatsOpen] = useState(false);
  const recentChatsOpenRef = useRef(recentChatsOpen);
  recentChatsOpenRef.current = recentChatsOpen;
  const returnToRecentChatsRef = useRef(false);
  const recentMenuWasOpenRef = useRef(false);
  const [recentChatItems, setRecentChatItems] = useState<RecentChat[]>([]);
  const [resultsRevealed, setResultsRevealed] = useState(false);
  const [skeletonReady, setSkeletonReady] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  useEffect(() => {
    if (copyStatus === "idle") return;
    const timer = window.setTimeout(() => setCopyStatus("idle"), 1800);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);
  const errorTextRef = useRef<HTMLSpanElement>(null);
  const [errorPillWidth, setErrorPillWidth] = useState(PILL_W);
  const statusPillWidth = phase === "error" ? Math.max(PILL_W, errorPillWidth) : PILL_W;
  function dismissRecentChats() {
    setRecentChatsOpen(false);
    returnToRecentChatsRef.current = false;
    detailOpenRef.current = false;
    closeDetail();
    void invoke("hide_window");
  }
  useEffect(() => {
    if (IS_DEMO) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen("recent-chats-open", () => {
      setRecentChatItems(recentChats());
      setRecentChatsOpen(true);
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!recentChatsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismissRecentChats();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [recentChatsOpen]);
  useLayoutEffect(() => {
    if (phase !== "error") {
      setErrorPillWidth(PILL_W);
      return;
    }
    const textWidth = errorTextRef.current?.scrollWidth;
    if (textWidth == null) return;
    const nextWidth = Math.min(
      notched ? notch.width + 48 + 400 : MAX_ERROR_PILL_W,
      Math.max(PILL_W, Math.ceil(notched ? notch.width + 48 + textWidth + 28 : textWidth + 64)),
    );
    setErrorPillWidth((width) => (width === nextWidth ? width : nextWidth));
  }, [phase, error, view, PILL_W, notched, notch.width]);
  useEffect(() => {
    if (phase === "idle") {
      setView(null);
      return;
    }
    setView("pill");
  }, [phase]);

  // "Frisch aus idle heraus gemountet" -> KEINE CSS-Transition auf der
  // ersten Groessenangabe. Vorher: resize_window (Rust, sofort/hart) lief
  // parallel zu einer CSS-Transition, die noch von einem alten/leeren
  // Hoehenwert Richtung PILL_H animierte -> kurzer "Stretch"-Frame, bevor
  // sich beides auf denselben Endwert eingeschwungen hat. Jetzt: beim
  // Uebergang von view===null zu einem echten View wird die Transition
  // fuer genau einen Frame deaktiviert, das Div erscheint direkt in
  // Zielgroesse (deckt sich mit dem harten resize_window), und danach
  // erst wird Transition wieder aktiv fuer alle folgenden Wechsel.
  const wasVisible = useRef(false);
  const [skipEnterTransition, setSkipEnterTransition] = useState(false);
  useEffect(() => {
    const nowVisible = view !== null || question !== null;
    if (nowVisible && !wasVisible.current) {
      setSkipEnterTransition(true);
      // Naechster Frame: Transition wieder normal einschalten, damit
      // View-Wechsel danach (pill<->panel) weiterhin animiert sind.
      const raf = requestAnimationFrame(() => setSkipEnterTransition(false));
      wasVisible.current = true;
      return () => cancelAnimationFrame(raf);
    }
    wasVisible.current = nowVisible;
  }, [view, question]);

  // Start-Flash: Bei Task-Start blitzt kurz die leere Scoop-Form auf
  // ("es passiert etwas"), dann wird es wieder still. Waehrend working
  // bleibt das Fenster sonst versteckt (Status nur per Hold-to-Peek).
  const [flash, setFlash] = useState(false);
  const flashPrevRef = useRef(phase);
  useEffect(() => {
    const prev = flashPrevRef.current;
    flashPrevRef.current = phase;
    if (phase !== "working") return;
    // Echte Transkription (transcribing -> working): kein leerer Blip —
    // der Commit-Flow zeigt stattdessen 1s "Running...".
    if (prev === "transcribing") return;
    setFlash(true);
    const t = window.setTimeout(() => {
      setFlash(false);
      if (phaseRef.current === "working") void invoke("hide_window");
    }, FLASH_MS);
    return () => {
      window.clearTimeout(t);
      setFlash(false);
    };
  }, [phase]);

  // Transkriptions-Bestaetigung: Bei Erfolg (transcribing -> working)
  // zeigt die Pill 1s "Running..." im gleichen Layout und fadet dann aus —
  // der Nutzer sieht, dass die Transkription ankam. Nur echter Flow (nicht
  // ?demo — dort wuerde das die UI-Arbeit stoeren).
  const [committing, setCommitting] = useState(false);
  const [commitFading, setCommitFading] = useState(false);
  const commitJustStartedRef = useRef(false);
  const commitPrevRef = useRef(phase);
  useEffect(() => {
    const prev = commitPrevRef.current;
    commitPrevRef.current = phase;
    if (IS_DEMO) return;
    if (phase === "working" && prev === "transcribing") {
      // The visibility effect below runs in this same effect flush. Keep it
      // from hiding the pill before the `committing` state update renders.
      commitJustStartedRef.current = true;
      setCommitting(true);
      setCommitFading(false);
      const t1 = window.setTimeout(() => setCommitFading(true), 1000);
      const t2 = window.setTimeout(() => {
        commitJustStartedRef.current = false;
        setCommitting(false);
        setCommitFading(false);
      }, 1250);
      return () => {
        window.clearTimeout(t1);
        window.clearTimeout(t2);
      };
    }
    if (phase !== "working") {
      commitJustStartedRef.current = false;
      setCommitting(false);
      setCommitFading(false);
    }
  }, [phase]);

  // Shortcut-Verdrahtung: einmal, global.
  // Escape kommt nur an, wenn die Pill offen ist (Rust schluckt es sonst
  // gar nicht erst) — die Front-App sieht es dann nie.
  // Einmal = Pill weg (Task laeuft ggf. weiter), 2x schnell = alles killen.
  // Offenes Detail-Overlay geht immer vor (schliessen statt killen).
  // Hold-to-Peek: Option 1.5s halten (nur waehrend working) blendet den
  // Status ein; Loslassen versteckt ihn wieder. Tap-Verhalten unveraendert.
  const lastEsc = useRef(0);
  const holdTimerRef = useRef<number | null>(null);
  const peekShownRef = useRef(false);
  const peekHideTimerRef = useRef<number | null>(null);
  // Doppel-Tap rechte Option bei Done: erster Tap wartet kurz, ob ein
  // zweiter folgt (Results oeffnen) — sonst normaler Reset. EIN Fenster
  // fuer beides (Timer + Vergleich), sonst entsteht eine Luecke, in der
  // der Reset schon lief, der zweite Tap aber noch als "Doppel" zaehlt
  // (oder umgekehrt) — genau das hat den Doppel-Tap unzuverlaessig gemacht.
  const DONE_DOUBLE_TAP_MS = 800;
  const lastDoneTap = useRef(0);
  const doneTapTimer = useRef<number | null>(null);

  function clearHoldTimer() {
    if (holdTimerRef.current != null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }

  function clearPeekHideTimer() {
    if (peekHideTimerRef.current != null) {
      window.clearTimeout(peekHideTimerRef.current);
      peekHideTimerRef.current = null;
    }
  }

  function showPeek() {
    holdTimerRef.current = null;
    if (phaseRef.current !== "working" || peekShownRef.current) return;
    peekShownRef.current = true;
    void presentWindow(pillDimensions.current).then(() => emitTo("onboarding", "onboarding-peek", {}));
    // Peek zeigt die kleine Pill (Working-Status) — gleiche Masse wie
    // Voice: Small-Pill-Hoehe, keine Panel-Groesse mehr.
    peekHideTimerRef.current = window.setTimeout(() => {
      peekHideTimerRef.current = null;
      // Sicherheitsnetz: auch bei gehaltenem Finger irgendwann zu
      // (Release blendet normalerweise aus, s. onRelease).
      if (peekShownRef.current && phaseRef.current === "working") {
        peekShownRef.current = false;
        void invoke("hide_window");
      }
    }, PEEK_MAX_MS);
  }

  function hidePeek() {
    clearHoldTimer();
    clearPeekHideTimer();
    if (!peekShownRef.current) return;
    peekShownRef.current = false;
    // Nur verstecken, wenn der Run noch laeuft — done-summary etc.
    // gehoert dem normalen Flow (wird dort gezeigt/gemorpht).
    if (phaseRef.current === "working") void invoke("hide_window");
  }

  useEffect(() => {
    wireShortcuts({
      onToggle: () => {
        if (detailOpenRef.current) {
          closeOverlay();
          return;
        }
        if (questionRef.current) return;
        const p = phaseRef.current;
        if (p === "idle" || p === "error") startListening();
        else if (p === "arming" || p === "listening") stopListeningAndRun();
        else if (p === "working") {
          // Kein sofortiges Show mehr — nur Peek-Timer armen.
          // (Altes "press = re-show" ist durch Hold-to-Peek ersetzt.)
          if (holdTimerRef.current == null) {
            holdTimerRef.current = window.setTimeout(showPeek, HOLD_TO_PEEK_MS);
          }
        } else if (p === "done") {
          // Single vs. Doppel-Tap entwirren: Erster Tap wartet
          // DONE_DOUBLE_TAP_MS — folgt ein zweiter, oeffnet das grosse
          // Results-Panel, sonst normaler Reset (Pill zu).
          const now = Date.now();
          if (now - lastDoneTap.current < DONE_DOUBLE_TAP_MS) {
            if (doneTapTimer.current != null) {
              window.clearTimeout(doneTapTimer.current);
              doneTapTimer.current = null;
            }
            lastDoneTap.current = 0;
            log("[island] Doppel-Tap: Results-Panel oeffnen.");
            openDetail();
          } else {
            lastDoneTap.current = now;
            doneTapTimer.current = window.setTimeout(() => {
              doneTapTimer.current = null;
              if (phaseRef.current === "done") reset();
            }, DONE_DOUBLE_TAP_MS);
          }
        }
        // transcribing: ignorieren
      },
      onRelease: () => {
        // Hold abgebrochen bzw. beendet: Timer weg, ggf. Peek verstecken.
        clearHoldTimer();
        hidePeek();
      },
      onCancel: () => {
        hidePeek(); // Peek-Flag weg (Sichtbarkeit regeln die Zweige unten)
        if (recentChatsOpenRef.current) {
          dismissRecentChats();
          return;
        }
        if (detailOpenRef.current) {
          closeOverlay();
          return;
        }
        const now = Date.now();
        const isDouble = now - lastEsc.current < 400;
        lastEsc.current = now;
        if (questionRef.current) {
          answerQuestion("");
          if (isDouble) cancel();
          return;
        }
        if (isDouble) {
          cancel(); // zu + Task killen
          return;
        }
        // Einmal: Pill schliessen, egal welche Groesse.
        const p = phaseRef.current;
        if (p === "working")
          hidePill(); // Task laeuft weiter, Ende zeigt sich wieder
        else cancel(); // listening/transcribing/done: verwerfen + zu
      },
    });
    return () => {
      clearHoldTimer();
      clearPeekHideTimer();
    };
  }, []);

  // Sichtbarkeit + Fenster-Morph. Ambient-Regel: Das Fenster ist fast
  // immer unsichtbar. Sichtbar nur: Voice (listening/transcribing),
  // Frage-Dialog, Start-Flash, Hold-Peek (via showPeek, nicht hier),
  // Done-Summary und Detail-Overlay. Waehrend working (ohne Flash/Peek)
  // bleibt es versteckt — der Run laeuft unsichtbar im Hintergrund.
  // Initial-Oeffnen (aus idle): direkt erscheinen ohne Animation.
  useEffect(() => {
    if (recentChatsOpen) {
      recentMenuWasOpenRef.current = true;
      void presentWindow({ width: RECENT_CHATS_W, height: RECENT_CHATS_H });
      return;
    }
    if (recentMenuWasOpenRef.current) {
      recentMenuWasOpenRef.current = false;
      if (!detailOpen) {
        void invoke("hide_window");
        return;
      }
    }
    if (detailOpen) {
      setResultsRevealed(false);
      setSkeletonReady(false);
      if (IS_DEMO) {
        const skeleton = window.setTimeout(() => setSkeletonReady(true), 40);
        const reveal = window.setTimeout(() => setResultsRevealed(true), 200);
        return () => {
          window.clearTimeout(skeleton);
          window.clearTimeout(reveal);
        };
      }
      // Grosses Results-Panel: aus der Pill per Feder herauswachsen,
      // oben verankert — kein zentrierter Blur-Pop.
      // Kein show_overlay mehr (war zentriert + hart gesetzt).
      let disposed = false;
      let unlisten: (() => void) | undefined;
      let settleTimer: number | undefined;
      let fallbackTimer: number | undefined;
      let revealFrame: number | undefined;
      let skeletonTimer: number | undefined;
      let revealStarted = false;
      const reveal = () => {
        if (disposed || revealStarted) return;
        revealStarted = true;
        if (fallbackTimer != null) window.clearTimeout(fallbackTimer);
        if (skeletonTimer != null) window.clearTimeout(skeletonTimer);
        revealFrame = window.requestAnimationFrame(() => {
          if (disposed) return;
          setSkeletonReady(true);
          skeletonTimer = window.setTimeout(() => {
            if (!disposed) setResultsRevealed(true);
          }, 160);
        });
      };
      void (async () => {
        const win = getCurrentWindow();
        let width = OVERLAY_W;
        let height = OVERLAY_H;
        let scale = 1;
        try {
          const m = await currentMonitor();
          if (m) {
            scale = m.scaleFactor || 1;
            ({ width, height } = resultsPanelSize(
              m.size.width / scale,
              m.size.height / scale,
            ));
          }
        } catch {
          /* Fallback-Groesse unten verwenden. */
        }
        if (disposed) return;

        const target = { width: width * scale, height: height * scale };
        const atTarget = (size: { width: number; height: number }) =>
          Math.abs(size.width - target.width) <= 1 &&
          Math.abs(size.height - target.height) <= 1;

        try {
          const stop = await win.onResized(({ payload }) => {
            if (atTarget(payload)) {
              if (settleTimer != null) window.clearTimeout(settleTimer);
              settleTimer = window.setTimeout(reveal, 40);
            } else if (settleTimer != null) {
              window.clearTimeout(settleTimer);
              settleTimer = undefined;
            }
          });
          if (disposed) {
            stop();
            return;
          }
          unlisten = stop;
          if (atTarget(await win.outerSize())) reveal();
        } catch {
          /* The fallback below reveals the copy without a resizing skeleton. */
        }

        fallbackTimer = window.setTimeout(reveal, 800);
        await presentWindow({ width, height }, true).catch(() => {
          if (!disposed) setResultsRevealed(true);
        });
      })();
      return () => {
        disposed = true;
        unlisten?.();
        if (settleTimer != null) window.clearTimeout(settleTimer);
        if (fallbackTimer != null) window.clearTimeout(fallbackTimer);
        if (skeletonTimer != null) window.clearTimeout(skeletonTimer);
        if (revealFrame != null) window.cancelAnimationFrame(revealFrame);
      };
    }
    setResultsRevealed(false);
    setSkeletonReady(false);
    if (phase === "idle") {
      void invoke("hide_window");
      return;
    }
    if (question) {
      void presentWindow({ width: questionWidth, height: PILL_HEIGHT }, true);
      return;
    }
    if (flash) {
      // Start-Flash: winziger Scoop-Blip in Pill-Groesse, kein Inhalt.
      void presentWindow({ width: PILL_ICON_W, height: PILL_H });
      return;
    }
    if (phase === "working") {
      if (committing || commitJustStartedRef.current) {
        // Transkriptions-Bestaetigung: Pill mit "Running..." 1s halten.
        void presentWindow({ width: PILL_W, height: PILL_H });
        return;
      }
      void invoke("hide_window");
      return;
    }
    if (phase === "done") {
      // Done = kleine Pill ("Results ready"), keine Summary direkt.
      // Wer mehr will, klickt (Detail-Overlay).
      void presentWindow(pillDimensions.current, true);
      return;
    }
    if (
      phase === "arming" ||
      phase === "listening" ||
      phase === "transcribing" ||
      phase === "error"
    ) {
      const animate = phase !== "arming" && view !== null && !(
        phase === "error" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
      );
      void presentWindow({ width: statusPillWidth, height: PILL_H }, animate);
    }
  }, [phase, view, question, detailOpen, flash, committing, statusPillWidth, recentChatsOpen, PILL_W, PILL_H, PILL_ICON_W, notch.height, PILL_HEIGHT, questionWidth]);

  // Auto-Collapse: Antwort ungelesen liegen lassen ist nicht Ambient —
  // nach einigen Sekunden zurueck zu Idle. Pausiert bei offenem Overlay
  // und im ?demo-Harness (dort will man in Ruhe auf Done schauen).
  useEffect(() => {
    if (IS_DEMO || onboardingActive) return;
    if (phase !== "done" || !answer || detailOpen || recentChatsOpen) return;
    const t = window.setTimeout(() => reset(), DONE_COLLAPSE_MS);
    return () => window.clearTimeout(t);
  }, [phase, answer, detailOpen, recentChatsOpen, onboardingActive]);

  const showQuestion = question !== null;
  // Panel nur noch fuer den Frage-Dialog — Done ist die kleine Pill
  // ("Results ready"), Working/Voice sowieso.
  const isBig = showQuestion;
  // NOCH laufende Agents (done/failed zaehlen raus): Der Executing-Text
  // zaehlt damit live herunter, bis der letzte Task fertig ist.
  const runningAgents = Math.max(
    1,
    tasks.filter((t) => t.status !== "done" && t.status !== "failed").length,
  );
  // Einzeiliger Pill-Status fuer alle Nicht-Panel-Zustaende.
  // Index: 0 Listening, 1 Transcribing, 2 Running (Commit),
  // 3 Planning, 4 N running + elapsed time, 5 capture/transcription error.
  const agentsRunningText = `${runningAgents} running`;
  const statusIndex =
    phase === "error"
      ? 5
      : phase === "transcribing"
        ? 1
        : phase === "working"
          ? committing
            ? 2
            : planMs == null
              ? 3
              : 4
          : 0;
  // Start-Flash zeigt nur die leere Scoop-Form (Ausnahme, falls parallel
  // eine Frage reinkommt: die geht immer vor).
  const flashActive = flash && !showQuestion && !committing;
  // Hoehe: Small-Pill (42) fuer ALLES ausser Frage-Dialog — auch Done
  // ("Results ready"). Nur die Frage bekommt Panel-Hoehe.
  const targetHeight = showQuestion ? PILL_HEIGHT : PILL_H;

  // Echter Spring statt CSS-cubic-bezier, damit man das Overshoot (das
  // "bisschen Federn") tatsaechlich sieht/spuert, nicht nur eine flache
  // Ease-Kurve. Werte grob an den Rust-Spring angelehnt (stiffness 170,
  // damping 24 auf einem 0..1-Fortschritt) - framer-motions Einheiten sind
  // nicht 1:1 dieselbe Physik-Formel, daher hier nach Gefuehl nachjustiert
  // auf denselben Charakter (schnell, ein Hauch Ueberschwingen, kein
  // Wackeln danach). Bei Bedarf: stiffness hoch = straffer/schneller,
  // damping runter = mehr Ueberschwingen.
  const heightSpring = useSpring(PILL_H, {
    stiffness: 300,
    damping: 28,
    mass: 0.7,
  });
  useLayoutEffect(() => {
    if (skipEnterTransition || phase === "arming" || !wasVisible.current) {
      heightSpring.jump(targetHeight);
    } else {
      heightSpring.set(targetHeight);
    }
  }, [targetHeight, skipEnterTransition, heightSpring, phase]);

  // EIN persistenter Container fuer die Scoop-Form. Vorher wurde
  // IslandShape in zwei getrennten JSX-Zweigen (isBig ? panel : pill)
  // gemountet -> React hat das SVG bei jedem Wechsel komplett neu erzeugt,
  // wodurch die Groessenaenderung ungeanimiert "gesnapped" ist, waehrend
  // das Rust-seitige morph_window noch lief. Jetzt bleibt IslandShape
  // durchgehend gemountet; nur die Hoehe des umgebenden Divs aendert sich,
  // ueber denselben Spring-Charakter wie der Rust-seitige Fenster-Morph.
  // HINWEIS: Dieses early-return MUSS hinter allen Hooks stehen (useSpring
  // etc.) — sonst kracht React mit "Rendered more hooks..." und die Pill
  // bleibt unsichtbar, obwohl der Sound schon lief.
  if (recentChatsOpen) {
    return (
      <main className="recent-chats-dialog" style={{ width: "100%", height: "100%", padding: 0, background: "#101010", userSelect: "none", WebkitUserSelect: "none" }}>
        <section
          aria-label="Recent chats"
          style={{
            width: "100%",
            height: "100%",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            padding: `${18 + notch.height}px 16px 12px`,
            background: "#101010",
            color: "#eee",
            fontFamily: "Geist, sans-serif",
            userSelect: "none",
            WebkitUserSelect: "none",
          }}
        >
          <header style={{ display: "flex", flexShrink: 0, alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Recent chats</span>
            <button
              aria-label="Close recent chats"
              onClick={dismissRecentChats}
              style={{ border: 0, background: "transparent", color: "#888", fontSize: 18, lineHeight: 1, cursor: "pointer" }}
            >×</button>
          </header>
          {recentChatItems.length ? (
            <div style={{ display: "grid", gap: 3, flex: 1, minHeight: 0, overflowY: "auto", alignContent: "start", overscrollBehavior: "contain" }}>
              {recentChatItems.map((chat) => (
                <ContextMenu key={chat.id}>
                  <ContextMenuTrigger asChild>
                <button
                  onClick={() => {
                    if (!openRecentChat(chat.id)) return;
                    returnToRecentChatsRef.current = true;
                    setRecentChatsOpen(false);
                  }}
                  className="recent-chat-item"
                  style={{
                    width: "100%",
                    border: 0,
                    borderRadius: 12,
                    padding: "10px 11px",
                    color: "inherit",
                    textAlign: "left",
                    cursor: "pointer",
                    display: "grid",
                    gap: 3,
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: 500 }}>{chat.title}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, color: "#888" }}>{chat.transcript || chat.answer}</span>
                </button>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="recent-context-menu">
                    <ContextMenuItem
                      variant="destructive"
                      onSelect={() => {
                        deleteRecentChat(chat.id);
                        setRecentChatItems(recentChats());
                      }}
                    >
                      <Trash2 size={14} />
                      Delete chat
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ))}
            </div>
          ) : (
            <div style={{ padding: "28px 8px", color: "#888", textAlign: "center", fontSize: 12 }}>No recent chats yet</div>
          )}
        </section>
      </main>
    );
  }
  if (view === null && !question) return null;

  return (
    <main
      onClick={() => {
        // Done-Pill anklickbar: oeffnet Summary + Detail im Overlay.
        // (Frage-Buttons/Overlay haben eigene Handler; Guard engt ein.)
        if (phase === "done" && (answer || detail) && !detailOpen) {
          openDetail();
        }
      }}
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        overflow: "hidden",
        background: notched ? "black" : "transparent",
        borderRadius: notched ? `0 0 ${detailOpen ? 24 : 12}px ${detailOpen ? 24 : 12}px` : undefined,
        transition: notched && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "border-radius 240ms cubic-bezier(0.23, 1, 0.32, 1)" : undefined,
        cursor: phase === "done" && (answer || detail) && !detailOpen ? "pointer" : "default",
      }}
    >
      <motion.div
        className={
          commitFading ? "island-enter island-leaving" : "island-enter"
        }
        style={{
          position: "relative",
          width: "100%",
          height: heightSpring,
          // Status follows the SVG; questions use a complete card behind their controls.
          overflow: "hidden",
          ...(isBig ? { background: "#0b0b0b", borderRadius: "0 0 24px 24px" } : {}),
        }}
      >
        {!isBig && !notched && <IslandShape
          variant={!isBig || flashActive ? "pill" : "panel"}
          pillWidth={flashActive ? PILL_ICON_W : statusPillWidth}
          notched={notched}
        />}

        {/* Text-Layer: beide States kurz gleichzeitig gemountet, damit
            exit/enter tatsaechlich uebereinander animieren koennen statt
            hart zu tauschen. mode="popLayout" verhindert, dass das
            austretende Element beim Verschwinden noch Layout beansprucht
            und das eintretende verschiebt. Dauer bewusst kuerzer als die
            Shape-Transition (150-180ms vs. 300ms), damit der Text fertig
            ist, bevor die Form ihre Zielgroesse erreicht — sonst wirkt es
            trotz smoother Form traege. Waehren Flash: nur Scoop, Stille. */}
        {!flashActive && (
          <AnimatePresence mode="popLayout">
            {!isBig &&
              (phase === "arming" ||
                phase === "error" ||
                phase === "listening" ||
                phase === "transcribing" ||
                phase === "working") && (
                <motion.div
                  key="pill-text"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15, ease: "easeOut" }}
                  style={{
                    position: "absolute",
                    inset: 0,
                    zIndex: 10,
                    color: "#B8B8B8",
                    fontSize: 14,
                    fontWeight: 400,
                  }}
                >
                  <PillRow
                    notchWidth={notch.width}
                    icon={
                      <DotmSquare11
                        muted
                        bloom
                        speed={1.1}
                        size={ICON_SIZE}
                        cellPadding={1.2}
                        dotSize={2.6}
                      />
                    }
                  >
                    {
                      [
                        <span key="listening" style={{ transform: notched ? "translateX(18px)" : "translateX(3px)" }}>
                          <Shimmer>Listening...</Shimmer>
                        </span>,
                        <span key="transcribing" style={{ transform: notched ? "translateX(18px)" : "translateX(3px)" }}>
                          <Shimmer>Transcribing...</Shimmer>
                        </span>,
                        <span key="running" style={{ transform: notched ? "translateX(8px)" : "translateX(-7px)" }}>
                          <Shimmer>Running...</Shimmer>
                        </span>,
                        <Shimmer key="planning">Planning...</Shimmer>,
                        <span
                          key="agents-running"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 2,
                            margin: notched ? 0 : "0px 0px 0px 10px",
                            transform: notched ? "translateX(8px)" : "translateX(5px)",
                          }}
                        >
                          <Shimmer>{agentsRunningText}</Shimmer>
                          <span
                            style={{
                              color: "#777",
                              margin: "0px 5px 0px 5px",
                            }}
                          >
                            ·
                          </span>
                          <span
                            style={{
                              minWidth: "5ch",
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            <Shimmer>{`${(elapsedSec ?? 0).toFixed(1)}s`}</Shimmer>
                          </span>
                        </span>,
                        <span
                          ref={errorTextRef}
                          key="error"
                          style={{
                            color: "#b99777",
                            display: "block",
                            width: "100%",
                            minWidth: 0,
                            maxWidth: "100%",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            textAlign: "center",
                          }}
                        >
                          {error ?? "Audio failed"}
                        </span>,
                      ][statusIndex]
                    }
                  </PillRow>
                </motion.div>
              )}

            {!isBig && phase === "done" && answer && !detailOpen && (
              <motion.div
                key="done-text"
                role="button"
                tabIndex={0}
                aria-label="Open result"
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openDetail();
                  }
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 10,
                  color: "#B8B8B8",
                  fontSize: 14,
                  fontWeight: 400,
                }}
              >
                {/* Results ready: gleiche Zeilen-Geometrie wie Status,
                    aber gruene DotmSquare8 (nur hier) + statischer Text
                    ohne Shimmer. Klick oeffnet das Detail-Overlay. */}
                <PillRow
                  notchWidth={notch.width}
                  icon={
                    <DotmSquare8
                      size={ICON_SIZE}
                      dotSize={2.6}
                      cellPadding={1.2}
                      color="#4ade80"
                      muted
                      bloom
                      speed={0.8}
                    />
                  }
                >
                  <span style={{ whiteSpace: "nowrap" }}>Results ready</span>
                </PillRow>
              </motion.div>
            )}

            {isBig && question && (
              <motion.div
                key="question"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18, ease: "easeOut", delay: 0.06 }}
                style={{ position: "absolute", inset: 0, paddingTop: notch.height }}
              >
                <QuestionPanel
                  key={question.text}
                  width={questionWidth}
                  maxHeight={questionMaxHeight}
                  onHeightChange={setQuestionContentHeight}
                  question={question}
                  onAnswer={(text) => answerQuestion(text)}
                />
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </motion.div>
      {/* Wide results scoop; clicking outside closes it. */}
      <AnimatePresence>
        {detailOpen && (detail || answer) && (
          <>
            <motion.div
              key="results-catcher"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              onClick={closeOverlay}
              className="absolute inset-0 z-10"
            />
            <motion.div
              key="results-scoop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="absolute inset-0 z-20"
              style={{ pointerEvents: "none" }}
            >
              <IslandShape variant="results" notched={notched} style={notched ? { opacity: 0 } : undefined} />
              <div
                className="agent-detail absolute inset-0"
                style={{ paddingTop: 24 + notch.height, paddingInline: notched ? 32 : "10%" }}
                data-revealed={resultsRevealed}
                data-skeleton-ready={skeletonReady}
                aria-busy={!resultsRevealed}
              >
                <header className="results-header">
                  <div className="results-meta">
                    <DotmSquare11
                      size={24}
                      dotSize={2.5}
                      cellPadding={1.1}
                      color="#a6a6a6"
                      animated={false}
                    />
                    <span>{workedLabel}</span>
                    {tasks.length > 0 && (
                      <>
                        <span className="results-dot" aria-hidden="true">
                          ·
                        </span>
                        <span>
                          {tasks.length}{" "}
                          {tasks.length === 1 ? "Agent" : "Agents"} used
                        </span>
                      </>
                    )}
                  </div>
                  <button
                    className="results-copy-button"
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(resultMarkdown);
                        setCopyStatus("copied");
                      } catch {
                        setCopyStatus("error");
                      }
                    }}
                    aria-label={
                      copyStatus === "copied"
                        ? "Result copied"
                        : "Copy result as Markdown"
                    }
                    title="Copy result as Markdown"
                  >
                    {copyStatus === "copied" ? (
                      <Check size={14} />
                    ) : (
                      <Copy size={14} />
                    )}
                    <span aria-live="polite">
                      {copyStatus === "copied"
                        ? "Copied"
                        : copyStatus === "error"
                          ? "Try again"
                          : "Copy"}
                    </span>
                  </button>
                </header>
                <div className="results-scroll">
                  <div className="results-skeleton" aria-hidden="true">
                    {Array.from({ length: skeletonLineCount }, (_, index) => (
                      <span
                        key={index}
                        style={{
                          width:
                            index === skeletonLineCount - 1
                              ? `${Math.max(32, Math.min(96, (resultMarkdown.length % 90 || 90) / 90 * 100))}%`
                              : `${[96, 84, 92, 76][index % 4]}%`,
                        }}
                      />
                    ))}
                  </div>
                  <div className="results-copy">
                    {transcript.trim() && (
                      <div className="results-request">
                        <span>Your request</span>
                        <p>{transcript.trim()}</p>
                      </div>
                    )}
                    <Markdown text={resultMarkdown} />
                  </div>
                </div>
                <div className="results-fade" aria-hidden="true" />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </main>
  );
}
