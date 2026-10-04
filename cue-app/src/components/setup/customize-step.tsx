import { ModelPicker } from "./model-picker";
import { HOLD_TO_PEEK_MS } from "../../lib/setup-options";

export function CustomizeStep({
  settingsMode,
  recordingShortcut,
  setRecordingShortcut,
  shortcutLabel,
  agentModel,
  setAgentModel,
  setError,
  reducedMotion,
  paused,
  openRevision,
}: {
  settingsMode: boolean;
  recordingShortcut: boolean;
  setRecordingShortcut: (recording: boolean) => void;
  shortcutLabel: string;
  agentModel: string;
  setAgentModel: (model: string) => void;
  setError: (error: string) => void;
  reducedMotion: boolean;
  paused: boolean;
  openRevision: number;
}) {
  return (
    <>
      <p className="ob-eyebrow">MAKE IT YOURS</p>
      <h1 id="ob-title">
        {settingsMode ? "Make it yours." : "Your way to cue."}
      </h1>
      <p className="ob-lead">
        Choose your shortcut and the model that does the thinking.
      </p>
      <div className="ob-customize">
        <label htmlFor="ob-shortcut-record">Shortcut</label>
        <button
          id="ob-shortcut-record"
          className="ob-shortcut-record"
          aria-pressed={recordingShortcut}
          onClick={() => setRecordingShortcut(!recordingShortcut)}
        >
          <span>
            {recordingShortcut ? (
              "Press your shortcut…"
            ) : (
              <kbd>{shortcutLabel}</kbd>
            )}
          </span>
          <span>{recordingShortcut ? "Esc to cancel" : "Click to record"}</span>
        </button>
        <p className="ob-customize-hint">
          Use a key combination or a single modifier. Tap to talk; hold{" "}
          {HOLD_TO_PEEK_MS / 1000} seconds to peek.
        </p>
        <label id="ob-model-label">Agent model</label>
        <ModelPicker
          value={agentModel}
          onChange={setAgentModel}
          onError={setError}
          reducedMotion={reducedMotion}
          key={`${paused}:${openRevision}`}
        />
      </div>
    </>
  );
}
