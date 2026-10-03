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

  // Escape hides, double Escape cancels; open details close first. Holding the shortcut reveals background progress.
  const lastEsc = useRef(0);
  const holdTimerRef = useRef<number | null>(null);
  const peekShownRef = useRef(false);
  const peekHideTimerRef = useRef<number | null>(null);
  // Use the same interval for the timer and double-tap comparison to avoid inconsistent resets.
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
    // Peek uses compact voice-pill dimensions.
    peekHideTimerRef.current = window.setTimeout(() => {
      peekHideTimerRef.current = null;
      // Safety timeout if the release event is missed.
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
    // Hide only while work remains active; completion owns its own presentation.
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
          // Arm the hold timer without showing the pill immediately.
          if (holdTimerRef.current == null) {
            holdTimerRef.current = window.setTimeout(showPeek, HOLD_TO_PEEK_MS);
          }
        } else if (p === "done") {
          // Wait briefly for a second tap to open results; otherwise reset the compact pill.
          const now = Date.now();
          if (now - lastDoneTap.current < DONE_DOUBLE_TAP_MS) {
            if (doneTapTimer.current != null) {
              window.clearTimeout(doneTapTimer.current);
              doneTapTimer.current = null;
            }
            lastDoneTap.current = 0;
            log("[island] Double tap: opening results.");
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
        hidePeek(); // Clear peek; the branches below determine visibility.
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
        // A single Escape closes either pill size.
        const p = phaseRef.current;
        if (p === "working")
          hidePill(); // Work continues; completion will show the pill again.
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
