import { useMemo } from "react";

interface SecureGpc { id: string; grapheme: string; order_index: number }

interface Props {
  secure: SecureGpc[];
  theme?: string; // meadow | forest | coast
  highlightIds?: string[]; // newly-secure for animation
}

// Deterministic plant kind per gpc order_index
const KINDS = ["flower", "shrub", "tree", "tall-flower", "mushroom", "vine"] as const;

function plantSVG(kind: string, palette: { leaf: string; stem: string; bloom: string }) {
  switch (kind) {
    case "tree":
      return (
        <>
          <rect x="46" y="60" width="8" height="30" fill={palette.stem} rx="2" />
          <circle cx="50" cy="50" r="22" fill={palette.leaf} />
          <circle cx="38" cy="42" r="12" fill={palette.leaf} />
          <circle cx="62" cy="42" r="12" fill={palette.leaf} />
        </>
      );
    case "shrub":
      return (
        <>
          <ellipse cx="50" cy="70" rx="28" ry="18" fill={palette.leaf} />
          <ellipse cx="38" cy="62" rx="14" ry="12" fill={palette.leaf} />
          <ellipse cx="62" cy="62" rx="14" ry="12" fill={palette.leaf} />
        </>
      );
    case "tall-flower":
      return (
        <>
          <rect x="48" y="40" width="4" height="50" fill={palette.stem} />
          <circle cx="50" cy="38" r="12" fill={palette.bloom} />
          <circle cx="50" cy="38" r="4" fill="#f6d76b" />
          <ellipse cx="42" cy="60" rx="7" ry="3" fill={palette.leaf} />
        </>
      );
    case "mushroom":
      return (
        <>
          <rect x="45" y="60" width="10" height="25" fill="#f4ecd8" rx="2" />
          <path d="M 25 60 Q 50 30 75 60 Z" fill={palette.bloom} />
          <circle cx="40" cy="55" r="3" fill="#fff" />
          <circle cx="58" cy="52" r="2.5" fill="#fff" />
        </>
      );
    case "vine":
      return (
        <>
          <path d="M 30 90 Q 40 60 50 70 Q 60 80 70 50" stroke={palette.stem} strokeWidth="4" fill="none" strokeLinecap="round" />
          <circle cx="40" cy="65" r="6" fill={palette.leaf} />
          <circle cx="58" cy="60" r="6" fill={palette.leaf} />
          <circle cx="70" cy="50" r="7" fill={palette.bloom} />
        </>
      );
    default: // flower
      return (
        <>
          <rect x="48" y="55" width="4" height="35" fill={palette.stem} />
          {[0, 72, 144, 216, 288].map((deg) => (
            <ellipse
              key={deg}
              cx="50"
              cy="42"
              rx="7"
              ry="12"
              fill={palette.bloom}
              transform={`rotate(${deg} 50 50)`}
            />
          ))}
          <circle cx="50" cy="50" r="5" fill="#f6d76b" />
        </>
      );
  }
}

export function Garden({ secure, theme = "meadow", highlightIds = [] }: Props) {
  const palette = useMemo(() => {
    if (theme === "forest") return { leaf: "#3f6b3f", stem: "#5c4a2f", bloom: "#c26b52" };
    if (theme === "coast") return { leaf: "#7ea8a3", stem: "#8b7455", bloom: "#e9b784" };
    return { leaf: "#7fa66b", stem: "#7a5c3d", bloom: "#d18a6a" };
  }, [theme]);

  const skyStops = theme === "coast" ? ["#cfe5ec", "#f5efdf"] : theme === "forest" ? ["#d9e6cf", "#f5efdf"] : ["#d8e6ec", "#f5efdf"];

  return (
    <div className="relative w-full aspect-[16/9] rounded-[2rem] overflow-hidden border border-border/60 shadow-sm bg-card">
      <svg viewBox="0 0 800 450" className="w-full h-full" preserveAspectRatio="xMidYMax slice">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={skyStops[0]} />
            <stop offset="100%" stopColor={skyStops[1]} />
          </linearGradient>
          <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#c8b78a" />
            <stop offset="100%" stopColor="#a89670" />
          </linearGradient>
        </defs>
        <rect width="800" height="450" fill="url(#sky)" />
        <circle cx="640" cy="90" r="40" fill="#f6d76b" opacity="0.75" />
        <path d="M 0 320 Q 200 290 400 310 T 800 300 L 800 450 L 0 450 Z" fill="url(#ground)" />
        {secure.length === 0 && (
          <text x="400" y="240" textAnchor="middle" className="font-display" fill="#7a6a54" fontSize="22">
            Your garden is ready to grow
          </text>
        )}
        {secure.map((s, i) => {
          const kind = KINDS[s.order_index % KINDS.length];
          const total = Math.max(secure.length, 1);
          const spread = Math.min(760, 60 + total * 40);
          const startX = 400 - spread / 2;
          const x = total === 1 ? 400 : startX + (i * spread) / (total - 1);
          const jitterY = (i % 3) * 8;
          const baseY = 320 - jitterY;
          const highlighted = highlightIds.includes(s.id);
          return (
            <g
              key={s.id}
              transform={`translate(${x - 50} ${baseY - 90})`}
              className={highlighted ? "animate-grow-in" : ""}
            >
              {plantSVG(kind, palette)}
              <text x="50" y="105" textAnchor="middle" className="font-display" fill="#5c4a2f" fontSize="14">
                {s.grapheme}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
