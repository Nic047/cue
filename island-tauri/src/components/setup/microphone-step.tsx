import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, ExternalLink } from "lucide-react";

export function MicrophoneStep({
  settingsMode,
  level,
  heard,
  selected,
  micOpen,
  micPickerRef,
  setMicOpen,
  devices,
  reducedMotion,
  chooseMicrophone,
  flat,
  request,
  preview,
  setHeard,
  setLevel,
}: {
  settingsMode: boolean;
  level: number;
  heard: boolean;
  selected: string;
  micOpen: boolean;
  micPickerRef: React.RefObject<HTMLDivElement | null>;
  setMicOpen: (open: boolean) => void;
  devices: string[];
  reducedMotion: boolean;
  chooseMicrophone: (name: string) => Promise<void>;
  flat: boolean;
  request: (permission: string) => Promise<void>;
  preview: boolean;
  setHeard: (heard: boolean) => void;
  setLevel: (level: number) => void;
}) {
  return (
    <>
      <p className="ob-eyebrow">A QUICK SOUND CHECK</p>
      <h1 id="ob-title">{settingsMode ? "Your voice." : "Say something."}</h1>
      <p className="ob-lead">
        Let's make sure we're listening to the right microphone.
      </p>
      <div
        className="ob-meter"
        role="meter"
        aria-label="Microphone level"
        aria-valuenow={Math.round(level * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {Array.from({ length: 36 }, (_, i) => (
          <i
            key={i}
            style={{
              transform: `scaleY(${0.2 + 0.8 * Math.max(0, Math.min(1, level * 36 - i))})`,
              opacity: 0.18 + 0.82 * Math.max(0, Math.min(1, level * 36 - i)),
            }}
          />
        ))}
      </div>
      <p className="ob-meter-caption" aria-live="polite">
        {heard ? (
          <>
            <Check size={15} className="ob-check" /> Sounds good. We can hear
            you.
          </>
        ) : (
          "Listening for your voice…"
        )}
      </p>
      <div className="ob-device">
        <span id="ob-device-label">Microphone</span>
        <div
          ref={micPickerRef}
          className="ob-device-picker"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget))
              setMicOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setMicOpen(false);
              micPickerRef.current
                ?.querySelector<HTMLButtonElement>(".ob-device-trigger")
                ?.focus();
              event.stopPropagation();
            } else if (
              micOpen &&
              (event.key === "ArrowDown" || event.key === "ArrowUp")
            ) {
              const options = Array.from(
                micPickerRef.current!.querySelectorAll<HTMLButtonElement>(
                  ".ob-device-options button",
                ),
              );
              const current = options.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              const next =
                current < 0
                  ? event.key === "ArrowDown"
                    ? 0
                    : options.length - 1
                  : (current +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      options.length) %
                    options.length;
              options[next]?.focus();
              event.preventDefault();
            }
          }}
        >
          <button
            type="button"
            className="ob-device-trigger"
            aria-expanded={micOpen}
            aria-haspopup="listbox"
            onClick={() => setMicOpen(!micOpen)}
          >
            <span>{selected || "System default"}</span>
            <ChevronDown size={15} strokeWidth={1.6} />
          </button>
          <AnimatePresence>
            {micOpen && (
              <motion.div
                initial={{ opacity: 0, y: 4, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.98 }}
                transition={{
                  duration: reducedMotion ? 0 : 0.22,
                  ease: [0.23, 1, 0.32, 1],
                }}
                className="ob-device-options"
                role="listbox"
                aria-label="Microphone input"
              >
                {["", ...devices].map((device) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected === device}
                    key={device || "default"}
                    onClick={() => void chooseMicrophone(device)}
                  >
                    <span>{device || "System default"}</span>
                    {selected === device && (
                      <Check size={14} strokeWidth={1.7} />
                    )}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      {!heard && flat && (
        <div className="ob-hint">
          No sound yet? Bluetooth headsets sometimes use the wrong input.
          <button onClick={() => void request("sound")}>
            Check System Settings → Sound → Input <ExternalLink size={12} />
          </button>
        </div>
      )}
      {preview && (
        <button
          className="ob-text-button"
          onClick={() => {
            setHeard(true);
            setLevel(0.5);
          }}
        >
          Preview: simulate sound
        </button>
      )}
    </>
  );
}
