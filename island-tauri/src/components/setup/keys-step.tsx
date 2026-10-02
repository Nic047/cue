import { Check, Loader2, ShieldCheck, ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { providers, type Provider } from "../../lib/setup-options";
import type { KeyState } from "./types";

export function KeysStep({
  settingsMode,
  keys,
  preview,
  setError,
  changeKey,
  validate,
}: {
  settingsMode: boolean;
  keys: Record<Provider, KeyState>;
  preview: boolean;
  setError: (error: string) => void;
  changeKey: (provider: Provider, value: string) => void;
  validate: (provider: Provider, value?: string) => Promise<void>;
}) {
  return (
    <>
      <p className="ob-eyebrow">YOUR TOOLS, CONNECTED</p>
      <h1 id="ob-title">
        {settingsMode ? "Connections." : "Bring your keys."}
      </h1>
      <p className="ob-lead">
        Paste once. Stored securely in your Mac's Keychain.
      </p>
      <div className="ob-keys">
        {providers.map((p) => (
          <div className="ob-key" key={p.id}>
            <div className="ob-key-label">
              <label htmlFor={`key-${p.id}`}>{p.name}</label>
              <button
                onClick={() => {
                  if (!preview)
                    void openUrl(p.url).catch((e) => setError(String(e)));
                }}
              >
                Get a key <ExternalLink size={11} />
              </button>
            </div>
            <div
              className={`ob-input ${keys[p.id].state === "error" ? "invalid" : ""}`}
            >
              <input
                id={`key-${p.id}`}
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={keys[p.id].value}
                placeholder={
                  keys[p.id].state === "valid"
                    ? "Saved in Keychain"
                    : "Paste your API key"
                }
                onChange={(e) => changeKey(p.id, e.target.value)}
                aria-invalid={keys[p.id].state === "error"}
                aria-describedby={
                  keys[p.id].state === "error" ? `hint-${p.id}` : undefined
                }
              />
              <span className="ob-input-status" aria-hidden="true">
                {keys[p.id].state === "checking" && (
                  <Loader2 size={15} className="ob-spinner" />
                )}
                {keys[p.id].state === "valid" && (
                  <Check size={16} className="ob-check" />
                )}
              </span>
              <span className="ob-sr-only" role="status">
                {keys[p.id].state === "checking"
                  ? `Checking ${p.name} key`
                  : keys[p.id].state === "valid"
                    ? `${p.name} key verified and saved`
                    : ""}
              </span>
            </div>
            {keys[p.id].state === "error" && (
              <p
                id={`hint-${p.id}`}
                className={keys[p.id].state === "error" ? "ob-field-error" : ""}
              >
                {keys[p.id].error}
                {keys[p.id].state === "error" && (
                  <button
                    onClick={() =>
                      void validate(p.id, keys[p.id].value || undefined)
                    }
                  >
                    Retry
                  </button>
                )}
              </p>
            )}
          </div>
        ))}
      </div>
      <p className="ob-privacy">
        <ShieldCheck size={14} />
        <span>
          <span>
            Audio goes to Groq. Requests and task context go to Solari and
            Vercel AI Gateway.
          </span>
          <span>
            Keys are stored in Keychain and sent to their providers to
            authenticate. Usage may incur charges.
          </span>
        </span>
      </p>
    </>
  );
}
