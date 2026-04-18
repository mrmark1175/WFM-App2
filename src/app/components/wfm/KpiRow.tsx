export interface Kpi {
  label: string;
  val: string | number;
  unit?: string;
  delta?: string;
  dir?: "up" | "down" | "flat";
  note?: string;
  spark?: number[];
  color?: string;
}

function MiniSpark({ points, color = "#15171a" }: { points: number[]; color?: string }) {
  if (!points || points.length < 2) return null;
  const w = 84, h = 26, pad = 2;
  const min = Math.min(...points), max = Math.max(...points);
  const dx = (w - pad * 2) / (points.length - 1);
  const sy = (v: number) => h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2);
  const path = points.map((v, i) => `${i === 0 ? "M" : "L"}${pad + i * dx},${sy(v)}`).join(" ");
  return (
    <svg className="absolute right-4 top-3.5 opacity-85" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <path d={path} fill="none" stroke={color} strokeWidth="1.3" />
      <circle cx={pad + (points.length - 1) * dx} cy={sy(points[points.length - 1])} r="2" fill={color} />
    </svg>
  );
}

export function KpiRow({ kpis }: { kpis: Kpi[] }) {
  return (
    <div className="grid grid-cols-4 gap-px bg-hairline border-b border-hairline">
      {kpis.map((k, i) => (
        <div key={i} className="relative bg-surface px-4 pt-3 pb-3.5 flex flex-col gap-0.5">
          <div className="font-mono text-[10.5px] text-ink-3 uppercase tracking-[.09em]">{k.label}</div>
          <div className="font-mono text-[22px] font-medium tracking-tight tabular-nums text-ink leading-none mt-1">
            {k.val}{k.unit && <span className="text-[12px] text-ink-3 ml-1 font-normal">{k.unit}</span>}
          </div>
          <div className="flex items-center gap-1.5 mt-1 font-mono text-[11px]">
            {k.delta && (
              <span className={`px-1.5 py-[1px] rounded ${
                k.dir === "down" ? "bg-neg-soft text-neg" :
                k.dir === "flat" ? "bg-surface-2 text-ink-3 border border-hairline" :
                "bg-pos-soft text-pos"
              }`}>{k.delta}</span>
            )}
            {k.note && <span className="text-ink-3 text-[11px] font-sans">{k.note}</span>}
          </div>
          {k.spark && <MiniSpark points={k.spark} color={k.color} />}
        </div>
      ))}
    </div>
  );
}
