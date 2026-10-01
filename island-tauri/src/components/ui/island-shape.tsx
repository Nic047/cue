import type { CSSProperties } from "react";

/**
 * Die Island-Scoop-Form.
 * Wird per preserveAspectRatio="none" auf jede Groesse gestreckt —
 * Pill (220x42) und Panel teilen sich die Form, unterscheiden sich aber
 * in den unteren Ecken:
 * - "panel": engere Radien unten (~55 statt ~79 Einheiten), damit die
 *   Ecken bei Panel-Groesse nicht nach halbem Stadion aussehen.
 * - "pill": leicht runde Radien unten (~60 Einheiten) — etwas weicher
 *   als die vorige enge Variante, aber weit weg von den alten 79ern.
 * Oben bleibt der Path in beiden Varianten exakt gleich, damit die
 * Kante buendig mit der Notch-Leiste andockt.
 * Schatten via CSS `drop-shadow` auf dem SVG: folgt exakt dem Alpha-Pfad.
 */
const PANEL_PATH =
  "M0 0C33.14 0 60 26.86 60 60V103C60 133 76 158 108 158H340C372 158 388 133 388 103V60C388 26.86 414.86 0 448 0H0Z";

const PILL_PATH =
  "M0 0C33.14 0 60 26.86 60 60V98C60 130 74 158 106 158H342C374 158 388 130 388 98V60C388 26.86 414.86 0 448 0H0Z";

function pillPath(width: number): string {
  return `M0 0C33.14 0 60 26.86 60 60V98C60 130 74 158 106 158H${width - 106}C${width - 74} 158 ${width - 60} 130 ${width - 60} 98V60C${width - 60} 26.86 ${width - 33.14} 0 ${width} 0H0Z`;
}

// Results path uses its own viewBox and stretches to the monitor-sized panel.
export const RESULTS_VB_W = 840;
export const RESULTS_VB_H = 600;

/** Wider shoulders and a softer lower curve for the reading panel. */
function scoopPath(W: number, H: number): string {
  return (
    `M0 0C40 0 70 54 70 125V${H - 112}` +
    `C70 ${H - 45} 105 ${H} 155 ${H}` +
    `H${W - 155}` +
    `C${W - 105} ${H} ${W - 70} ${H - 45} ${W - 70} ${H - 112}` +
    `V125C${W - 70} 54 ${W - 40} 0 ${W} 0H0Z`
  );
}

const RESULTS_PATH = scoopPath(RESULTS_VB_W, RESULTS_VB_H);

export function IslandShape({
  className,
  style,
  variant = "panel",
  pillWidth,
  notched = false,
}: {
  className?: string;
  style?: CSSProperties;
  variant?: "pill" | "panel" | "results";
  pillWidth?: number;
  notched?: boolean;
}) {
  const isResults = variant === "results";
  const vbW = isResults ? RESULTS_VB_W : variant === "pill" && pillWidth ? (pillWidth * 448) / 220 : 448;
  const vbH = isResults ? RESULTS_VB_H : 158;
  const radiusX = isResults ? 24 : 12 * 448 / 220;
  const radiusY = isResults ? 24 : 12 * 158 / 42;
  const notchPath = `M0 0H${vbW}V${vbH - radiusY}Q${vbW} ${vbH} ${vbW - radiusX} ${vbH}H${radiusX}Q0 ${vbH} 0 ${vbH - radiusY}Z`;
  const resultsPath = notched ? notchPath : RESULTS_PATH;
  // Keep the scoop's notch curvature fixed in screen pixels as its width changes.
  const pillViewWidth = pillWidth ? (pillWidth * 448) / 220 : 448;
  return (
    <svg
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        display: "block",
        ...style,
      }}
      viewBox={
        isResults
          ? `0 0 ${RESULTS_VB_W} ${RESULTS_VB_H}`
          : `0 0 ${variant === "pill" ? pillViewWidth : 448} 158`
      }
      preserveAspectRatio="none"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {isResults && (
        <defs>
          <clipPath id="results-panel-clip" clipPathUnits="objectBoundingBox">
            <path
              d={resultsPath}
              transform={`scale(${1 / RESULTS_VB_W} ${1 / RESULTS_VB_H})`}
            />
          </clipPath>
        </defs>
      )}
      <path
        d={
          notched
            ? notchPath
            : isResults
            ? RESULTS_PATH
            : variant === "pill"
              ? pillWidth
                ? pillPath(pillViewWidth)
                : PILL_PATH
              : PANEL_PATH
        }
        fill="black"
        fillOpacity="1"
      />
    </svg>
  );
}
