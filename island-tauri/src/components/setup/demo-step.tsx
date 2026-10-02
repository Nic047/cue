import { Check, Loader2, ArrowRight } from "lucide-react";
import { HOLD_TO_PEEK_MS } from "../../lib/setup-options";
import type { Snapshot } from "./types";

export function DemoStep({
  lesson,
  tapped,
  shortcutLabel,
  firstTask,
  peeked,
  snapshot,
  done,
  run,
  runError,
}: {
  lesson: number;
  tapped: boolean;
  shortcutLabel: string;
  firstTask: string;
  peeked: boolean;
  snapshot: Snapshot | null;
  done: boolean;
  run: (task: string) => Promise<void>;
  runError: string;
}) {
  return (
    <>
      <p className="ob-eyebrow">LET'S DO SOMETHING REAL</p>
      <h1 id="ob-title">Your first handoff.</h1>
      <p className="ob-lead">Try Cue with a real task.</p>
      <div
        className={`ob-lesson ${lesson === 1 ? "active" : tapped ? "complete" : ""}`}
      >
        <span className="ob-lesson-number">
          {tapped ? <Check size={13} className="ob-check" /> : "1"}
        </span>
        <div>
          <h2>
            Tap <kbd>{shortcutLabel}</kbd> and say
          </h2>
          <blockquote>{firstTask}</blockquote>
          <p>Tap again when you're done speaking.</p>
        </div>
      </div>
      <div
        className={`ob-lesson ${lesson === 2 && !peeked ? "active" : peeked ? "complete" : ""}`}
      >
        <span className="ob-lesson-number">
          {peeked ? <Check size={13} className="ob-check" /> : "2"}
        </span>
        <div>
          <h2>
            Keep working. Hold{" "}
            <kbd className={lesson === 2 && !peeked ? "ob-key-cue" : undefined}>
              {shortcutLabel}
            </kbd>{" "}
            to peek.
          </h2>
          <p>
            Hold for {HOLD_TO_PEEK_MS / 1000} seconds while agents run. Release
            to hide.
          </p>
          {snapshot?.phase === "working" && (
            <span className="ob-live">
              <Loader2 size={13} className="ob-spinner" />
              {snapshot.tasks.some((t) => t.status === "running")
                ? `${snapshot.tasks.filter((t) => t.status === "running").length} running`
                : "Planning"}{" "}
              — try the hold now.
            </span>
          )}
          {peeked && <span className="ob-completed">Peek learned.</span>}
        </div>
      </div>
      <div className={`ob-lesson ${lesson === 3 ? "active" : ""}`}>
        <span className="ob-lesson-number">3</span>
        <div>
          <h2>See what got done.</h2>
          <p>
            Double-tap <kbd>{shortcutLabel}</kbd> to open your result when the
            pill says “Results ready”. You can also click the pill once. Press
            Esc to come back.
          </p>
          {done && !peeked && (
            <button
              className="ob-text-button"
              onClick={() => void run(firstTask)}
            >
              Run again to practice the hold <ArrowRight size={13} />
            </button>
          )}
        </div>
      </div>
      <div aria-live="polite">
        {snapshot?.phase === "listening" && (
          <p className="ob-live">Listening… Tap {shortcutLabel} to send.</p>
        )}
        {snapshot?.phase === "transcribing" && (
          <p className="ob-live">Turning your voice into text…</p>
        )}
        {runError && <div className="ob-hint">{runError}</div>}
      </div>
    </>
  );
}
