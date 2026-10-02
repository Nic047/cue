import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { agentModels } from "../../lib/setup-options";

function ModelBars({ model }: { model: (typeof agentModels)[number] }) {
  const descriptors = {
    intelligence: ["", "Basic", "Everyday", "Capable", "High", "Very high"],
    speed: ["", "Measured", "Steady", "Fast", "Very fast", "Very fast"],
    price: ["", "Very low", "Low", "Moderate", "High", "Premium"],
  };
  return (
    <span className="ob-model-bars">
      {(["intelligence", "speed", "price"] as const).map((metric) => (
        <span
          className="ob-model-meter"
          key={metric}
          role="meter"
          aria-label={metric === "price" ? "Cost" : metric}
          aria-valuemin={1}
          aria-valuemax={5}
          aria-valuenow={model[metric]}
          aria-valuetext={descriptors[metric][model[metric]]}
          title={`${metric === "price" ? "Cost" : metric}: ${descriptors[metric][model[metric]]}`}
        >
          {Array.from({ length: 5 }, (_, index) => (
            <i key={index} data-filled={index < model[metric]} />
          ))}
        </span>
      ))}
    </span>
  );
}
export function ModelPicker({
  value,
  onChange,
  onError,
  reducedMotion,
}: {
  value: string;
  onChange: (value: string) => void;
  onError: (error: string) => void;
  reducedMotion: boolean;
}) {
  const [modelOpen, setModelOpen] = useState(false);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const chosenModel = agentModels.find((model) => model.id === value);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!modelPickerRef.current?.contains(event.target as Node))
        setModelOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  return (
    <>
      <div
        className="ob-model-picker"
        ref={modelPickerRef}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setModelOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setModelOpen(false);
            event.stopPropagation();
            modelPickerRef.current
              ?.querySelector<HTMLButtonElement>(".ob-model-trigger")
              ?.focus();
          }
          if (modelOpen && ["ArrowDown", "ArrowUp"].includes(event.key)) {
            const options = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                "[role=option]",
              ),
            );
            const current = options.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            options[
              current < 0
                ? event.key === "ArrowDown"
                  ? 0
                  : options.length - 1
                : (current +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    options.length) %
                  options.length
            ]?.focus();
            event.preventDefault();
          }
        }}
      >
        <button
          type="button"
          className="ob-model-trigger"
          aria-haspopup="listbox"
          aria-expanded={modelOpen}
          aria-labelledby="ob-model-label ob-model-name"
          onClick={() => setModelOpen(!modelOpen)}
        >
          <span className="ob-model-summary">
            <span id="ob-model-name">{chosenModel?.name || value}</span>
          </span>
          <ChevronDown size={15} />
        </button>
        <AnimatePresence>
          {modelOpen && (
            <motion.div
              className="ob-model-options"
              initial={{
                opacity: 0,
                transform: "translateY(3px) scale(.995)",
              }}
              animate={{
                opacity: 1,
                transform: "translateY(0px) scale(1)",
              }}
              exit={{
                opacity: 0,
                transform: "translateY(3px) scale(.995)",
              }}
              transition={{
                duration: reducedMotion ? 0 : 0.16,
                ease: [0.23, 1, 0.32, 1],
              }}
            >
              <div className="ob-model-menu-heading" aria-hidden="true">
                <span>Model</span>
                <span className="ob-model-columns">
                  <span>Ability</span>
                  <span>Speed</span>
                  <span>Cost</span>
                </span>
                <span />
              </div>
              <div role="listbox" aria-label="Agent model">
                {agentModels.map((model) => (
                  <button
                    type="button"
                    key={model.id}
                    role="option"
                    aria-selected={value === model.id}
                    onClick={() => {
                      onChange(model.id);
                      setModelOpen(false);
                      modelPickerRef.current
                        ?.querySelector<HTMLButtonElement>(".ob-model-trigger")
                        ?.focus();
                    }}
                  >
                    <span
                      className="ob-model-name"
                      title={`${model.name} · ${model.hint}`}
                    >
                      {model.name}
                    </span>
                    <ModelBars model={model} />
                    <span className="ob-model-check" aria-hidden="true">
                      {value === model.id && <Check size={12} />}
                    </span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <p className="ob-customize-hint ob-model-disclaimer">
        Ability and speed are estimates. More cost marks = higher price.
      </p>
      {chosenModel && (
        <p className="ob-model-pricing">
          From ${chosenModel.input} input · ${chosenModel.output} output / 1M
          tokens. {chosenModel.note && `${chosenModel.note}. `}
          <button
            className="ob-text-button"
            onClick={() =>
              void openUrl(
                `https://vercel.com/ai-gateway/models/${chosenModel.slug}`,
              ).catch((e) => onError(String(e)))
            }
          >
            Rates <ExternalLink size={11} />
          </button>
        </p>
      )}
    </>
  );
}
