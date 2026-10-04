import { Check } from "lucide-react";

export function FinishStep({
  completing,
  shortcutLabel,
}: {
  completing: boolean;
  shortcutLabel: string;
}) {
  return (
    <>
      <div className={`ob-finish-icon${completing ? " is-celebrating" : ""}`}>
        <Check size={32} strokeWidth={1.4} />
      </div>
      <p className="ob-eyebrow">YOU'RE ALL SET</p>
      <h1 id="ob-title">Back to your flow.</h1>
      <p className="ob-lead">cue is there whenever you need a hand.</p>
      <div className="ob-reminders">
        <p>
          <kbd>{shortcutLabel}</kbd>
          <span>Tap to talk. Hold 1.5 seconds to peek.</span>
        </p>
        <p>
          <kbd>esc</kbd>
          <span>Once hides. Twice cancels the task.</span>
        </p>
      </div>
      <p className="ob-menu-detail">
        Change keys, open recent chats, or quit cue from the menu bar.
      </p>
    </>
  );
}
