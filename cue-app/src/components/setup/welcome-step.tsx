import { AnimatePresence, motion } from "framer-motion";
import { IslandShape } from "../ui/island-shape";
import { DotmSquare11 } from "../ui/dotm-square-11";
import { DotmSquare8 } from "../ui/dotm-square-8";

export function WelcomeStep({
  label,
  reducedMotion,
}: {
  label: number;
  reducedMotion: boolean;
}) {
  return (
    <>
      <div className="ob-welcome-art ob-welcome-reveal" aria-hidden="true">
        <div className="ob-demo-pill">
          <IslandShape
            className="ob-demo-shape"
            variant="pill"
            pillWidth={248}
          />
          {label < 3 ? (
            <DotmSquare11
              size={22}
              dotSize={2.6}
              cellPadding={1.2}
              muted
              bloom
              speed={1.1}
              color="#ddd"
            />
          ) : (
            <DotmSquare8
              size={22}
              dotSize={2.6}
              cellPadding={1.2}
              muted
              bloom
              speed={label === 3 ? 0.8 : 1.1}
              color="#ddd"
            />
          )}
          <span className="ob-demo-copy">
            <AnimatePresence initial={false} mode="wait">
              <motion.span
                key={label}
                initial={reducedMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={reducedMotion ? undefined : { opacity: 0 }}
                transition={{
                  duration: reducedMotion ? 0 : 0.22,
                  ease: [0.23, 1, 0.32, 1],
                }}
              >
                {
                  [
                    "Listening…",
                    "Transcribing…",
                    "2 running · 13s",
                    "Results ready",
                  ][label]
                }
              </motion.span>
            </AnimatePresence>
          </span>
        </div>
        <div className="ob-orbit" />
      </div>
      <p
        className="ob-eyebrow ob-welcome-reveal"
        style={{ animationDelay: "120ms" }}
      >
        WELCOME
      </p>
      <h1
        id="ob-title"
        className="ob-welcome-reveal"
        style={{ animationDelay: "220ms" }}
      >
        Say what you want done.
        <br />
        Keep working.
      </h1>
      <p
        className="ob-lead ob-welcome-reveal"
        style={{ animationDelay: "340ms" }}
      >
        Only takes two minutes.
      </p>
    </>
  );
}
