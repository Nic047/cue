import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Check, Copy } from "lucide-react";
import { IslandShape } from "./ui/island-shape";
import { DotmSquare11 } from "./ui/dotm-square-11";
import { Markdown } from "./ui/markdown";
import type { PlanTask } from "../lib/agent-state";

export function ResultsPanel({
  detail,
  answer,
  transcript,
  totalMs,
  tasks,
  notched,
  notchHeight,
  resultsRevealed,
  skeletonReady,
  onClose,
}: {
  detail: string | null;
  answer: string | null;
  transcript: string;
  totalMs: number | null;
  tasks: PlanTask[];
  notched: boolean;
  notchHeight: number;
  resultsRevealed: boolean;
  skeletonReady: boolean;
  onClose: () => void;
}) {
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
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  useEffect(() => {
    if (copyStatus === "idle") return;
    const timer = window.setTimeout(() => setCopyStatus("idle"), 1800);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);
  return (
    <>
      <motion.div
        key="results-catcher"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        onClick={onClose}
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
        <IslandShape
          variant="results"
          notched={notched}
          style={notched ? { opacity: 0 } : undefined}
        />
        <div
          className="agent-detail absolute inset-0"
          style={{
            paddingTop: 24 + notchHeight,
            paddingInline: notched ? 32 : "10%",
          }}
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
                    {tasks.length} {tasks.length === 1 ? "Agent" : "Agents"}{" "}
                    used
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
                        ? `${Math.max(32, Math.min(96, ((resultMarkdown.length % 90 || 90) / 90) * 100))}%`
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
  );
}
