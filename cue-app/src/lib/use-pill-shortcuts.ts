import { useEffect, useRef, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import {
  HOLD_TO_PEEK_MS,
  wireShortcuts,
  startListening,
  stopListeningAndRun,
  answerQuestion,
  cancel,
  hidePill,
  type Phase,
  type AgentQuestion,
} from "./agent-state";

const PEEK_MAX_MS = 5000;
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
  openLatestResult,
  revealQuestion,
}: {
  phaseRef: RefObject<Phase>;
  questionRef: RefObject<AgentQuestion | null>;
  detailOpenRef: RefObject<boolean>;
  recentChatsOpenRef: RefObject<boolean>;
  pillDimensions: RefObject<{ width: number; height: number }>;
  closeOverlay: () => void;
  dismissRecentChats: () => void;
  openLatestResult: () => void;
  revealQuestion: () => void;
}) {
  const callbacks = useRef({ closeOverlay, dismissRecentChats, openLatestResult, revealQuestion });
  callbacks.current = { closeOverlay, dismissRecentChats, openLatestResult, revealQuestion };

  // Escape hides, double Escape cancels; open details close first. Holding the shortcut reveals background progress.
  const lastEsc = useRef(0);
  const holdTimerRef = useRef<number | null>(null);
  const peekShownRef = useRef(false);
  const peekHideTimerRef = useRef<number | null>(null);
  const DOUBLE_TAP_MS = 450;
  const lastTap = useRef(0);

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
        const now = Date.now();
        const p = phaseRef.current;
        const doubleTap = now - lastTap.current < DOUBLE_TAP_MS;
        lastTap.current = now;
        if (doubleTap) {
          lastTap.current = 0;
          clearHoldTimer();
          hidePeek();
          if (p !== "working" && p !== "transcribing") cancel();
          callbacks.current.openLatestResult();
          return;
        }
        if (recentChatsOpenRef.current) callbacks.current.dismissRecentChats();
        if (detailOpenRef.current) {
          callbacks.current.closeOverlay();
          return;
        }
        if (questionRef.current) {
          callbacks.current.revealQuestion();
          return;
        }
        if (p === "idle" || p === "error" || p === "done") startListening();
        else if (p === "arming" || p === "listening") stopListeningAndRun();
        else if (p === "working" && holdTimerRef.current == null) {
          holdTimerRef.current = window.setTimeout(showPeek, HOLD_TO_PEEK_MS);
        }
      },
      onRelease: () => {
        // Release cancels the hold timer and hides a peek.
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
          cancel(); // Stop the task.
          return;
        }
        // A single Escape closes either pill size.
        const p = phaseRef.current;
        if (p === "working")
          hidePill(); // Work continues; completion will show the pill again.
        else cancel(); // Discard recording or dismiss completion.
      },
    });
    return () => {
      clearHoldTimer();
      clearPeekHideTimer();

    };
  }, []);
}
