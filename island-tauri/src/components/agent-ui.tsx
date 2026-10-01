/**
 * Agent-UI-Komponenten — gestylt mit Tailwind-Utilities.
 *
 * Jede Komponente behaelt zusaetzlich ihre stabile `agent-*`-Klasse als
 * Hook (Tests, spaetere CSS-Eingriffe). Look tweaken = Utilities direkt
 * hier im JSX aendern. Theme-Tokens (Fonts, Easing, Animationen) liegen
 * zentral in `src/index.css` (@theme).
 *
 * Jede Komponente bekommt ihre Daten als Props (aus useAgent()),
 * keine globale Kopplung.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, ChevronRight, MessageCircle } from "lucide-react";
import type { AgentQuestion } from "../lib/agent-state";

/**
 * Die kompakte Pill (listening/transcribing): zeigt nur Status-Label.
 * Der Scoop-SVG-Hintergrund bleibt vom Aufrufer (App) gesetzt – hier nur
 * der Content.
 */
export function PillContent({ phase }: { phase: string }) {
  const label =
    {
      listening: "Listening...",
      transcribing: "Transcribing...",
    }[phase] ?? "";
  if (!label) return null;
  return <span className="">{label}</span>;
}

/**
 * Rückfrage an den Nutzer: Text + antippbare Optionen + freies Textfeld.
 * onAnswer("") = keine Angabe → Orchestrator plant mit Annahme weiter.
 */
export function QuestionPanel({
  question,
  onAnswer,
  width = 520,
  maxHeight = 560,
  onHeightChange,
}: {
  question: AgentQuestion;
  onAnswer: (text: string) => void;
  width?: number;
  maxHeight?: number;
  onHeightChange?: (height: number) => void;
}) {
  const [draft, setDraft] = useState("");
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element || !onHeightChange) return;
    const measure = () => onHeightChange(Math.ceil(element.getBoundingClientRect().height));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [onHeightChange]);
  return (
    <div ref={root} className="agent-question" style={{ width, maxHeight }}
      role="region" aria-labelledby="agent-question-title">
      <header className="agent-question-heading">
        <MessageCircle size={15} strokeWidth={1.6} aria-hidden="true" />
        <span>Quick question</span>
      </header>
      <div className="agent-question-body">
        <h2 id="agent-question-title" className="agent-question-text">{question.text}</h2>
        {question.options.length > 0 && (
          <div className="agent-question-options">
            {question.options.map((option, index) => (
              <button key={`${index}-${option}`} type="button"
                className="agent-question-option" onClick={() => onAnswer(option)}>
                <span>{option}</span><ChevronRight size={14} aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
      </div>
      <form className="agent-question-form" onSubmit={(event) => {
        event.preventDefault();
        if (draft.trim()) onAnswer(draft.trim());
      }}>
        <textarea className="agent-question-input" rows={2}
          value={draft} onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (draft.trim()) onAnswer(draft.trim());
            }
          }}
          placeholder="Or write your own answer…" aria-label="Your answer" autoFocus />
        <button type="submit" className="agent-question-send"
          disabled={!draft.trim()} aria-label="Send answer" title="Send · Enter">
          <ArrowUp size={17} />
        </button>
      </form>
      <footer className="agent-question-footer">
        <button type="button" className="agent-question-skip" onClick={() => onAnswer("")}>
          Let Cue decide <kbd>esc</kbd>
        </button>
        <span>Enter to send</span>
      </footer>
    </div>
  );
}
