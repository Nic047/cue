// Transitions.dev — Shimmer text (React, self-contained)
// Drop into any React project — no extra CSS file needed.

// ── Styles ──────────────────────────────────────────────
// Auto-injected on first import. Idempotent (guarded by
// the element id) and SSR-safe (no-ops without document).
const __TRANSITION_STYLES = `
:root {
  --shimmer-dur: 3200ms;
  --shimmer-base: #6e6e6e;
  --shimmer-highlight: #ededed;
  --shimmer-band: 200%;
  --shimmer-ease: ease-in-out;
}

/* Two-layer construction:
   1. The base text renders normally in --shimmer-base.
   2. ::before duplicates it via content: attr(data-text),
      paints a narrow transparent → highlight → transparent band
      onto it, and clips that band to the glyphs via
      background-clip: text. Animating background-position
      sweeps the band across the text, letter by letter.
   Band + Range sind so gewaehlt, dass der Sweep quasi durchgehend
   sichtbar ist (220% -> -120% bei 130% Bandbreite): Bei 250% Band
   mit 120% -> -120% stand das Band ~60% jedes Zyklus ausserhalb der
   Glyphen — der Text wirkte eingefroren, obwohl die Animation lief. */
.t-shimmer {
  position: relative;
  display: inline-block;
  color: var(--shimmer-base);f55
}
.t-shimmer::before {
  content: attr(data-text);
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image: linear-gradient(
    100deg,
    transparent          0%,
    transparent         42%,
    var(--shimmer-highlight) 50%,
    transparent         58%,
    transparent        100%
  );
  background-size: var(--shimmer-band) 100%;
  background-repeat: no-repeat;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  animation: t-shimmer var(--shimmer-dur) var(--shimmer-ease) infinite;
}
@keyframes t-shimmer {
  0%   { background-position: 220% 0; }
  100% { background-position: -120% 0; }
}

@media (prefers-reduced-motion: reduce) {
  .t-shimmer::before { animation: none !important; }
}
`;
if (
  typeof document !== "undefined" &&
  !document.getElementById("transitions-p15")
) {
  const __style = document.createElement("style");
  __style.id = "transitions-p15";
  __style.textContent = __TRANSITION_STYLES;
  document.head.appendChild(__style);
}

// Pair with the CSS from the CSS tab.
// Pure CSS — no hooks, no state. The `data-text` attribute
// duplicates the visible string into the masked ::before layer.
// Keep them in sync if the text changes.
export function Shimmer({ children }: { children: string }) {
  return (
    <span className="t-shimmer" data-text={children}>
      {children}
    </span>
  );
}
