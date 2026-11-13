import { useTheme, type ThemeId } from "./themes";

const W = 1600;

function strata(h: number) {
  const cols = ["#b9a184", "#a58c6f", "#c8b498", "#94806a", "#bba78e"];
  const lines = cols.map((c, k) => {
    const base = h - 4 - k * 5.5;
    const pts: string[] = [];
    for (let x = 0; x <= W + 8; x += 8) {
      const y = base - 6 * Math.sin(x / 41 + k * 1.3) - 3 * Math.sin(x / 13 + k) - k * 1.5;
      pts.push(`${x},${y.toFixed(1)}`);
    }
    return <polyline key={k} points={pts.join(" ")} fill="none" stroke={c} strokeWidth={1.3} opacity={0.95 - k * 0.13} />;
  });
  return (
    <>
      <defs>
        <linearGradient id="dp-fog" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity={0.9} />
          <stop offset="1" stopColor="#fff" stopOpacity={0} />
        </linearGradient>
      </defs>
      {lines}
      <rect x={0} y={0} width={W} height={Math.round(h * 0.55)} fill="url(#dp-fog)" />
      {[0, 1, 2].map((k) => {
        const y = 6 + k * 6;
        return <path key={k} d={`M0 ${y} C ${W * 0.25} ${y - 3}, ${W * 0.5} ${y + 3}, ${W} ${y - 1}`} stroke="#fff" strokeWidth={2} opacity={0.7} fill="none" />;
      })}
    </>
  );
}

function facades(h: number) {
  const widths = [44, 36, 52, 40, 58, 38, 48, 42, 54, 36, 46, 50];
  const heights = [34, 40, 30, 42, 36, 32, 40, 30, 38, 42, 34, 36];
  const cols = ["#e2a83a", "#d4588f", "#3f6f9f", "#c8613f", "#8cbfa8", "#efd29a", "#7d5aa6", "#e7b9a2"];
  const out = [];
  for (let x = 0, i = 0; x < W; i++) {
    const bw = widths[i % widths.length]!;
    const bh = Math.round((heights[i % heights.length]! * h) / 46);
    const c = cols[i % cols.length]!;
    const y = h - bh;
    const dx = x + bw / 2 - 5;
    out.push(
      <g key={i}>
        <rect x={x} y={y} width={bw} height={bh} fill={c} />
        <rect x={x - 1} y={y - 3} width={bw + 2} height={4} fill={c} opacity={0.85} />
        <path d={`M${dx} ${h} v-11 a5 5 0 0 1 10 0 v11z`} fill="#fff" opacity={0.82} />
        {i % 3 === 1 &&
          Array.from({ length: 7 }, (_, k) => (
            <circle key={k} cx={x + 4 + ((k * 7) % (bw - 4))} cy={y + 2 + ((k * 5) % 12)} r={2.6 + (k % 3) * 0.7} fill={k % 2 ? "#b5266d" : "#d63c86"} />
          ))}
      </g>,
    );
    x += bw;
  }
  return out;
}

function fret(h: number) {
  const out = [];
  for (let x = 0, i = 0; x < W; x += 22, i++) {
    const up = i % 2 === 0;
    const d = up
      ? `M${x} ${h} h22 v-4 h-4 v-4 h-4 v-4 h-4 v-4 h-2 v4 h-4 v4 h-4 v4 h-4z`
      : `M${x} 0 h22 v4 h-4 v4 h-4 v4 h-4 v4 h-2 v-4 h-4 v-4 h-4 v-4 h-4z`;
    out.push(
      <g key={i}>
        <path d={d} fill={up ? "#a33b22" : "#2a1c12"} />
        <rect x={x + 9} y={up ? h - 9 : 6} width={4} height={3} fill="#f2e9d8" />
      </g>,
    );
  }
  return out;
}

const STRIPS: Record<ThemeId, { h: number; draw: (h: number) => React.ReactNode }> = {
  garua: { h: 34, draw: strata },
  fachada: { h: 34, draw: facades },
  chancay: { h: 22, draw: fret },
};

/** The theme's texture band: cliff strata under fog, house fronts, or a stepped fret. */
export function ThemeStrip({ className }: { className?: string }) {
  const { theme } = useTheme();
  const s = STRIPS[theme.id];
  return (
    <div className={`theme-strip ${className ?? ""}`} aria-hidden>
      <svg width={W} height={s.h} viewBox={`0 0 ${W} ${s.h}`} preserveAspectRatio="xMinYMax slice">
        {s.draw(s.h)}
      </svg>
    </div>
  );
}

export function ThemeGlyph({ size = 16 }: { size?: number }) {
  const { theme } = useTheme();
  const common = { width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": true } as const;
  switch (theme.id) {
    case "garua":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
          <path d="M3 8c3-2 6 2 9 0s6-2 9 0M3 13c3-2 6 2 9 0s6-2 9 0M3 18c3-2 6 2 9 0s6-2 9 0" />
        </svg>
      );
    case "fachada":
      return (
        <svg {...common}>
          <g fill="currentColor">
            <ellipse cx="12" cy="6.8" rx="3.6" ry="5" />
            <ellipse cx="12" cy="6.8" rx="3.6" ry="5" transform="rotate(120 12 12)" />
            <ellipse cx="12" cy="6.8" rx="3.6" ry="5" transform="rotate(240 12 12)" />
          </g>
          <circle cx="12" cy="12" r="2" fill="#fff" />
        </svg>
      );
    case "chancay":
      return (
        <svg {...common}>
          <path fill="currentColor" d="M12 2h2v3h3v3h3v3h2v2h-2v3h-3v3h-3v3h-2v-3H9v-3H6v-3H4v-2h2V8h3V5h3z" />
          <rect x="11" y="11" width="2" height="2" fill="#fff" />
        </svg>
      );
  }
}
