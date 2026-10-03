import { ResultsPanel } from "./components/results-panel";
import { RecentChatsDialog } from "./components/recent-chats-dialog";
import { usePillShortcuts } from "./lib/use-pill-shortcuts";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { AnimatePresence, motion, useSpring } from "framer-motion";
import {
  IS_DEMO,
  resultsPanelSize,
  useAgent,
  answerQuestion,
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

// Text states share a width; the empty start flash is narrower.
export const PILL_W = 230;
export const PILL_H = 42; // Compact voice pill and startup flash.
const MAX_ERROR_PILL_W = 480;

const ICON_SIZE = 20;
export const PANEL_W = 520;
export const PILL_HEIGHT = 400; // DIE fixe Hoehe aller Status-Zustaende
// Detail-Overlay: fallback size when monitor dimensions are unavailable.
export const OVERLAY_W = 1100;
export const OVERLAY_H = 540;
// Collapse completed results unless the detail overlay is open.
const DONE_COLLAPSE_MS = 10_000;
// Brief empty flash when a task starts.
const FLASH_MS = 700;
// Hold the shortcut to peek; release or the safety timeout hides it.

const RECENT_CHATS_W = 420;
const RECENT_CHATS_H = 380;

function presentWindow(
  size: { width: number; height: number },
  animate = false,
) {
  return invoke("show_window", { ...size, animate });
}

// Keep the icon fixed and center status text in the remaining space.
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
    void listen<{ width: number; height: number }>(
      "notch-layout",
      ({ payload }) => {
        if (!disposed) setNotch(payload);
      },
    )
      .then(async (stop) => {
        if (disposed) {
          stop();
          return;
        }
        unlisten = stop;
        const layout = await invoke<{ width: number; height: number }>(
          "get_notch_layout",
        );
        if (!disposed) setNotch(layout);
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
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
    void currentMonitor()
      .then((monitor) => {
        if (!monitor || disposed) return;
        setQuestionWidth(
          Math.min(PANEL_W, monitor.size.width / monitor.scaleFactor - 32),
        );
        setQuestionMaxHeight(
          Math.max(
            240,
            monitor.size.height / monitor.scaleFactor - notch.height - 48,
          ),
        );
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, [question, notch.height]);
  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  // Mirror the question for the persistent shortcut handlers.
  const questionRef = useRef(question);
  useEffect(() => {
    questionRef.current = question;
  }, [question]);
  // Mirror overlay state and restore pill size on close.
  const detailOpenRef = useRef(detailOpen);
  useEffect(() => {
    detailOpenRef.current = detailOpen;
  }, [detailOpen]);
  function restorePillSize() {
    if (phaseRef.current === "done") {
      // Return to the compact results-ready pill.
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

  // Only questions use the expanded dialog here.
  const [view, setView] = useState<"pill" | "panel" | null>(null);
  const [recentChatsOpen, setRecentChatsOpen] = useState(false);
  const recentChatsOpenRef = useRef(recentChatsOpen);
  recentChatsOpenRef.current = recentChatsOpen;
  const returnToRecentChatsRef = useRef(false);
  const recentMenuWasOpenRef = useRef(false);
  const [recentChatItems, setRecentChatItems] = useState<RecentChat[]>([]);
  const [resultsRevealed, setResultsRevealed] = useState(false);
  const [skeletonReady, setSkeletonReady] = useState(false);
  const errorTextRef = useRef<HTMLSpanElement>(null);
  const [errorPillWidth, setErrorPillWidth] = useState(PILL_W);
  const statusPillWidth =
    phase === "error" ? Math.max(PILL_W, errorPillWidth) : PILL_W;
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
      Math.max(
        PILL_W,
        Math.ceil(notched ? notch.width + 48 + textWidth + 28 : textWidth + 64),
      ),
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

  // Disable transitions for the first visible frame to match the native resize and prevent stale-size stretching.
  const wasVisible = useRef(false);
  const [skipEnterTransition, setSkipEnterTransition] = useState(false);
  useEffect(() => {
    const nowVisible = view !== null || question !== null;
    if (nowVisible && !wasVisible.current) {
      setSkipEnterTransition(true);
      // Enable transitions on the next frame for subsequent view changes.
      const raf = requestAnimationFrame(() => setSkipEnterTransition(false));
      wasVisible.current = true;
      return () => cancelAnimationFrame(raf);
    }
    wasVisible.current = nowVisible;
  }, [view, question]);

  // Briefly acknowledge startup, then hide background work until the user peeks.
  const [flash, setFlash] = useState(false);
  const flashPrevRef = useRef(phase);
  useEffect(() => {
    const prev = flashPrevRef.current;
    flashPrevRef.current = phase;
    if (phase !== "working") return;
    // Voice submission uses the running confirmation instead of an empty flash.
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

  // Show a brief running confirmation after transcription; skip this in the demo harness.
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

  usePillShortcuts({
    phaseRef,
    questionRef,
    detailOpenRef,
    recentChatsOpenRef,
    pillDimensions,
    closeOverlay,
    dismissRecentChats,
  });

  // Keep background work hidden except during explicit peeks, questions, and completion. Initial presentation snaps to size.
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
      // Expand results from the top-anchored pill with a spring.
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
          /* Use the fallback dimensions below. */
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
      // The startup flash has no content.
      void presentWindow({ width: PILL_ICON_W, height: PILL_H });
      return;
    }
    if (phase === "working") {
      if (committing || commitJustStartedRef.current) {
        // Keep the running confirmation visible briefly.
        void presentWindow({ width: PILL_W, height: PILL_H });
        return;
      }
      void invoke("hide_window");
      return;
    }
    if (phase === "done") {
      // Completion initially shows the compact results-ready pill.
      void presentWindow(pillDimensions.current, true);
      return;
    }
    if (
      phase === "arming" ||
      phase === "listening" ||
      phase === "transcribing" ||
      phase === "error"
    ) {
      const animate =
        phase !== "arming" &&
        view !== null &&
        !(
          phase === "error" &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches
        );
      void presentWindow({ width: statusPillWidth, height: PILL_H }, animate);
    }
  }, [
    phase,
    view,
    question,
    detailOpen,
    flash,
    committing,
    statusPillWidth,
    recentChatsOpen,
    PILL_W,
    PILL_H,
    PILL_ICON_W,
    notch.height,
    PILL_HEIGHT,
    questionWidth,
  ]);

  // Auto-collapse completed results unless details or the demo harness are open.
  useEffect(() => {
    if (IS_DEMO || onboardingActive) return;
    if (phase !== "done" || !answer || detailOpen || recentChatsOpen) return;
    const t = window.setTimeout(() => reset(), DONE_COLLAPSE_MS);
    return () => window.clearTimeout(t);
  }, [phase, answer, detailOpen, recentChatsOpen, onboardingActive]);

  const showQuestion = question !== null;
  // Only questions use this panel.
  const isBig = showQuestion;
  // Count unfinished tasks for the running indicator.
  const runningAgents = Math.max(
    1,
    tasks.filter((t) => t.status !== "done" && t.status !== "failed").length,
  );
  // Single-line status for compact states.
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
  // Questions take priority over the empty startup flash.
  const flashActive = flash && !showQuestion && !committing;
  // Use compact height except for questions.
  const targetHeight = showQuestion ? PILL_HEIGHT : PILL_H;

  // Match the native spring character with a small, quickly settling overshoot.
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

  // Keep IslandShape mounted across transitions. This early return must follow every hook.
  if (recentChatsOpen) {
    return (
      <RecentChatsDialog
        items={recentChatItems}
        notchHeight={notch.height}
        onClose={dismissRecentChats}
        onOpen={(id) => {
          if (!openRecentChat(id)) return;
          returnToRecentChatsRef.current = true;
          setRecentChatsOpen(false);
        }}
        onDelete={(id) => {
          deleteRecentChat(id);
          setRecentChatItems(recentChats());
        }}
      />
    );
  }
  if (view === null && !question) return null;

  return (
    <main
      onClick={() => {
        // Clicking the completed pill opens results; question controls handle their own clicks.
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
        borderRadius: notched
          ? `0 0 ${detailOpen ? 24 : 12}px ${detailOpen ? 24 : 12}px`
          : undefined,
        transition:
          notched &&
          !window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "border-radius 240ms cubic-bezier(0.23, 1, 0.32, 1)"
            : undefined,
        cursor:
          phase === "done" && (answer || detail) && !detailOpen
            ? "pointer"
            : "default",
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
          ...(isBig
            ? { background: "#0b0b0b", borderRadius: "0 0 24px 24px" }
            : {}),
        }}
      >
        {!isBig && !notched && (
          <IslandShape
            variant={!isBig || flashActive ? "pill" : "panel"}
            pillWidth={flashActive ? PILL_ICON_W : statusPillWidth}
            notched={notched}
          />
        )}

        {/* Overlap entering and exiting text without letting the exiting layer shift layout. */}
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
                        <span
                          key="listening"
                          style={{
                            transform: notched
                              ? "translateX(18px)"
                              : "translateX(3px)",
                          }}
                        >
                          <Shimmer>Listening...</Shimmer>
                        </span>,
                        <span
                          key="transcribing"
                          style={{
                            transform: notched
                              ? "translateX(18px)"
                              : "translateX(3px)",
                          }}
                        >
                          <Shimmer>Transcribing...</Shimmer>
                        </span>,
                        <span
                          key="running"
                          style={{
                            transform: notched
                              ? "translateX(8px)"
                              : "translateX(-7px)",
                          }}
                        >
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
                            transform: notched
                              ? "translateX(8px)"
                              : "translateX(5px)",
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
                {/* Results ready shares status geometry, with a green matrix and static text. */}
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
                style={{
                  position: "absolute",
                  inset: 0,
                  paddingTop: notch.height,
                }}
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
          <ResultsPanel
            detail={detail}
            answer={answer}
            transcript={transcript}
            totalMs={totalMs}
            tasks={tasks}
            notched={notched}
            notchHeight={notch.height}
            resultsRevealed={resultsRevealed}
            skeletonReady={skeletonReady}
            onClose={closeOverlay}
          />
        )}
      </AnimatePresence>
    </main>
  );
}
