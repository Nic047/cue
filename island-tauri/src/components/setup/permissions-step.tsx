import { Check, Mic, ShieldCheck, ExternalLink } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { Status } from "./types";

export function PermissionsStep({
  status,
  request,
  preview,
  setError,
}: {
  status: Status;
  request: (permission: string) => Promise<void>;
  preview: boolean;
  setError: (error: string) => void;
}) {
  return (
    <>
      <p className="ob-eyebrow">LET CUE HEAR YOU</p>
      <h1 id="ob-title">Two small permissions.</h1>
      <p className="ob-lead">Voice in. One key to bring it all together.</p>
      {[
        {
          id: "microphone",
          title: "Microphone",
          reason: "For your voice. Only records when you ask.",
          granted: status.microphone === "granted",
          icon: Mic,
        },
        {
          id: "accessibility",
          title: "Accessibility",
          reason: "For the right Option shortcut, wherever you work.",
          granted: status.accessibility,
          icon: ShieldCheck,
        },
      ].map((p) => (
        <div className="ob-permission" key={p.id}>
          <p.icon size={21} strokeWidth={1.5} />
          <div>
            <h2>{p.title}</h2>
            <p>{p.reason}</p>
            {p.id === "microphone" &&
              ["denied", "restricted"].includes(status.microphone) && (
                <small>
                  Voice input is unavailable until you allow microphone access.
                </small>
              )}
            {p.id === "accessibility" &&
              status.accessibility &&
              !status.hotkeyReady && (
                <small>
                  Accessibility is allowed. Connecting the shortcut… If this
                  stays here, quit and reopen cue.
                </small>
              )}
          </div>
          {p.granted ? (
            <span className="ob-granted">
              <Check size={15} className="ob-check" />
              Allowed
            </span>
          ) : (
            <button className="ob-secondary" onClick={() => void request(p.id)}>
              {p.id === "microphone" && status.microphone === "not-determined"
                ? "Allow"
                : "Open Settings"}
              <ExternalLink size={12} />
            </button>
          )}
        </div>
      ))}
      {!status.hotkeyReady && (
        <div className="ob-permission">
          <div>
            <p>Already enabled Accessibility? macOS may need cue to restart.</p>
          </div>
          <button
            className="ob-secondary"
            onClick={() => {
              if (preview) return;
              void invoke("restart_for_permissions").catch((e) =>
                setError(String(e)),
              );
            }}
          >
            Restart cue
          </button>
        </div>
      )}
      <p className="ob-footnote">
        If cue is already enabled but still shows as blocked, remove the old cue
        entry with “−”, add cue from Applications again, and enable it. Reopen
        cue if macOS asks you to quit.
      </p>
    </>
  );
}
