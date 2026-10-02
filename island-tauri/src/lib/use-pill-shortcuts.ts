import { useEffect, useRef, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import {
  HOLD_TO_PEEK_MS,
  wireShortcuts,
  startListening,
  stopListeningAndRun,
  openDetail,
  answerQuestion,
  cancel,
  reset,
  hidePill,
  type Phase,
  type AgentQuestion,
} from "./agent-state";

const PEEK_MAX_MS = 5000;
const log = (line: string) => {
  void invoke("log_line", { line });
};
const presentWindow = (size: { width: number; height: number }) =>
  invoke("show_window", { ...size, animate: false });

export function usePillShortcuts({
  phaseRef,
  questionRef,
  detailOpenRef,
  recentChatsOpenRef,
  pillDimensions,
  closeOverlay,
  dismissRecentChats,
}: {
  phaseRef: RefObject<Phase>;
  questionRef: RefObject<AgentQuestion | null>;
  detailOpenRef: RefObject<boolean>;
  recentChatsOpenRef: RefObject<boolean>;
  pillDimensions: RefObject<{ width: number; height: number }>;
  closeOverlay: () => void;
  dismissRecentChats: () => void;
}) {
  const callbacks = useRef({ closeOverlay, dismissRecentChats });
  callbacks.current = { closeOverlay, dismissRecentChats };

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
    void presentWindow(pillDimensions.current).then(() =>
      emitTo("onboarding", "onboarding-peek", {}),
    );
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
          callbacks.current.closeOverlay();
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
          callbacks.current.dismissRecentChats();
          return;
        }
        if (detailOpenRef.current) {
          callbacks.current.closeOverlay();
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
      if (doneTapTimer.current != null)
        window.clearTimeout(doneTapTimer.current);
    };
  }, []);
}
