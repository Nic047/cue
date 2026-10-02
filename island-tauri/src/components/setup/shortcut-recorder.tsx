import type { RefObject } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CornerDownLeft, X } from "lucide-react";
import { shortcutBadges, type RecordedShortcut } from "../../lib/setup-options";

export function ShortcutRecorder({
  recorderRef,
  reducedMotion,
  draftShortcut,
  shortcutReady,
  onCancel,
}: {
  recorderRef: RefObject<HTMLDivElement | null>;
  reducedMotion: boolean;
  draftShortcut: RecordedShortcut | null;
  shortcutReady: boolean;
  onCancel: () => void;
}) {
  return (
    <motion.div
      className="ob-recorder"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ob-recorder-title"
      tabIndex={-1}
      ref={recorderRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.2 }}
    >
      <button
        className="ob-close"
        aria-label="Cancel recording"
        onClick={onCancel}
      >
        <X size={16} />
      </button>
      <motion.div
        className="ob-recorder-center"
        initial={
          reducedMotion
            ? false
            : {
                opacity: 0,
                filter: "blur(6px)",
                transform: "translateY(8px)",
              }
        }
        animate={{
          opacity: 1,
          filter: "blur(0px)",
          transform: "translateY(0px)",
        }}
        transition={{
          duration: reducedMotion ? 0 : 0.3,
          ease: [0.23, 1, 0.32, 1],
        }}
      >
        <p className="ob-eyebrow">MAKE IT A GESTURE</p>
        <h1 id="ob-recorder-title">Record your shortcut.</h1>
        <p className="ob-recorder-hint">Press your keys together.</p>
        <div className="ob-recorded-keys" aria-live="polite">
          <AnimatePresence initial={false}>
            {draftShortcut ? (
              shortcutBadges(draftShortcut).map((key) => (
                <motion.kbd
                  key={key}
                  initial={{
                    opacity: 0,
                    transform: "translateY(6px) scale(.98)",
                  }}
                  animate={{
                    opacity: 1,
                    transform: "translateY(0px) scale(1)",
                  }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reducedMotion ? 0 : 0.2 }}
                >
                  {key}
                </motion.kbd>
              ))
            ) : (
              <span className="ob-key-placeholder">Waiting for your keys</span>
            )}
          </AnimatePresence>
        </div>
        <div className="ob-recorder-confirm" data-ready={shortcutReady}>
          <span>Press</span>
          <kbd aria-label="Enter">
            <CornerDownLeft size={18} />
          </kbd>
          <span>to continue</span>
        </div>
        <p className="ob-recorder-cancel">Esc to cancel</p>
      </motion.div>
    </motion.div>
  );
}
