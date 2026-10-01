import { Children, useCallback, useEffect, useMemo, useState } from "react";
import {
  AnimatePresence,
  motion,
  type AnimatePresenceProps,
  type Transition,
  type Variants,
} from "framer-motion";

export type TextLoopProps = {
  children: React.ReactNode[];
  className?: string;
  /** Sekunden zwischen zwei Items (nur im Selbstlauf-Modus). */
  interval?: number;
  transition?: Transition;
  variants?: Variants;
  onIndexChange?: (index: number) => void;
  /** Selbstlauf an/aus (default true). */
  trigger?: boolean;
  mode?: AnimatePresenceProps["mode"];
  /**
   * Kontrolliert: ueberschreibt den internen Index und stoppt den
   * Selbstlauf — z.B. Pill-Phase treibt das angezeigte Item
   * (listening = 0, transcribing = 1). Default-Verhalten (ungesteuert
   * + Intervall) bleibt unveraendert, wenn weggelassen.
   */
  index?: number;
};

/**
 * motion-primitives "Text Loop" (Docs: text-loop): Items sliden per
 * y-Transition durch (rein von unten, raus nach oben). Original-Verhalten
 * unangetastet; plus optionaler kontrollierter `index` fuer
 * zustandgetriebene Wechsel statt Intervall.
 */
export function TextLoop({
  children,
  className,
  interval = 2,
  transition = { duration: 0.2 },
  variants,
  onIndexChange,
  trigger = true,
  mode = "popLayout",
  index: controlledIndex,
}: TextLoopProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const items = useMemo(() => Children.toArray(children), [children]);

  const updateIndex = useCallback(() => {
    setCurrentIndex((current) => {
      const next = (current + 1) % items.length;
      onIndexChange?.(next);
      return next;
    });
  }, [items.length, onIndexChange]);

  useEffect(() => {
    if (!trigger || controlledIndex !== undefined) return;
    const id = window.setInterval(updateIndex, interval * 1000);
    return () => window.clearInterval(id);
  }, [interval, trigger, updateIndex, controlledIndex]);

  // Guard gegen leere/leere Items + negative Indizes.
  const activeIndex =
    items.length === 0
      ? 0
      : controlledIndex !== undefined
        ? ((controlledIndex % items.length) + items.length) % items.length
        : currentIndex % items.length;

  const motionVariants: Variants = useMemo(
    () => ({
      initial: { y: 20, opacity: 0 },
      animate: { y: 0, opacity: 1 },
      exit: { y: -20, opacity: 0 },
    }),
    [],
  );

  return (
    <div
      className={["relative inline-block whitespace-nowrap", className]
        .filter(Boolean)
        .join(" ")}
    >
      <AnimatePresence mode={mode} initial={false}>
        <motion.div
          key={activeIndex}
          transition={transition}
          {...(variants ?? motionVariants)}
        >
          {items[activeIndex]}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
