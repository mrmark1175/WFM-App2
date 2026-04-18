import { Sparkles, Send } from "lucide-react";
import { Button } from "../ui/button";

export interface NarratorChange {
  kind: "pos" | "neg" | "warn" | "neutral";
  icon?: string;           // single char, e.g. "±", "!", "✓"
  label: React.ReactNode;
  value?: string;
  revertable?: boolean;
  onRevert?: () => void;
}

interface Props {
  scenarioName: string;
  version?: string;
  summary: React.ReactNode;
  changes: NarratorChange[];
  risks?: React.ReactNode;
  suggestions?: { label: string; icon?: React.ElementType; onClick?: () => void }[];
  onAsk?: (q: string) => void;
}

export function NarratorRail({ scenarioName, version = "v12", summary, changes, risks, suggestions, onAsk }: Props) {
  return (
    <aside className="bg-surface border-l border-hairline sticky top-[84px] h-[calc(100vh-44px-40px)] overflow-auto flex flex-col w-[340px]">
      <div className="sticky top-0 bg-surface z-[2] min-h-10 px-3.5 py-2.5 border-b border-hairline flex items-center gap-2">
        <span className="size-[7px] rounded-full bg-pos shadow-[0_0_0_3px_var(--pos-soft)]" />
        <h4 className="m-0 text-[12.5px] font-semibold tracking-tight">Insight Narrator</h4>
        <span className="ml-auto font-mono text-[10px] text-ink-3 uppercase tracking-wider">Live · {version}</span>
      </div>

      <section className="px-3.5 py-3 border-b border-hairline">
        <h5 className="m-0 mb-1.5 font-mono text-[10px] text-ink-3 uppercase tracking-[.09em] flex items-center gap-1.5">
          <span className="font-mono bg-ink text-white text-[9px] px-1.5 py-[1px] rounded">AI</span>
          Summary · {scenarioName}
        </h5>
        <div className="text-[12.5px] text-ink leading-[1.55] space-y-2">{summary}</div>
      </section>

      <section className="px-3.5 py-3 border-b border-hairline">
        <h5 className="m-0 mb-1.5 font-mono text-[10px] text-ink-3 uppercase tracking-[.09em]">What moved since last save</h5>
        <ul className="list-none p-0 m-0 flex flex-col gap-1.5">
          {changes.map((c, i) => (
            <li key={i} className="grid grid-cols-[14px_1fr_auto] gap-2 items-center p-1.5 px-2 bg-surface-2 border border-hairline rounded text-[12px]">
              <span className={`size-[14px] rounded-[3px] inline-grid place-items-center font-mono text-[10px] ${
                c.kind === "pos" ? "bg-pos-soft text-pos" :
                c.kind === "neg" ? "bg-neg-soft text-neg" :
                c.kind === "warn" ? "bg-warn-soft text-[var(--warn)]" :
                "bg-indigo-soft text-[var(--indigo-2)]"
              }`}>{c.icon || "±"}</span>
              <span className="text-ink-2">{c.label}</span>
              {c.revertable
                ? <button onClick={c.onRevert} className="font-mono text-[10px] text-ink-3 hover:text-ink hover:underline uppercase tracking-wider">revert</button>
                : <span className={`font-mono text-[11px] ${c.kind === "pos" ? "text-pos" : c.kind === "neg" ? "text-neg" : "text-ink"}`}>{c.value}</span>}
            </li>
          ))}
        </ul>
      </section>

      {risks && (
        <section className="px-3.5 py-3 border-b border-hairline">
          <h5 className="m-0 mb-1.5 font-mono text-[10px] text-ink-3 uppercase tracking-[.09em]">Risks & watch-outs</h5>
          <p className="text-[12px] text-ink-2 m-0">{risks}</p>
        </section>
      )}

      {suggestions && suggestions.length > 0 && (
        <section className="px-3.5 py-3 border-b border-hairline">
          <h5 className="m-0 mb-1.5 font-mono text-[10px] text-ink-3 uppercase tracking-[.09em]">Suggested next</h5>
          <div className="flex flex-col gap-1.5">
            {suggestions.map((s, i) => {
              const Icon = s.icon;
              return (
                <Button key={i} variant="outline" size="sm" onClick={s.onClick} className="justify-start h-7 text-[12px]">
                  {Icon && <Icon className="size-3" />}{s.label}
                </Button>
              );
            })}
          </div>
        </section>
      )}

      <div className="mt-auto px-3.5 py-2.5 border-t border-hairline flex gap-1.5 items-center bg-surface-2 sticky bottom-0">
        <Sparkles className="size-3.5 text-ink-3" />
        <input
          className="flex-1 bg-surface border border-hairline-2 rounded h-[26px] px-2 text-[12px] text-ink outline-none focus:border-ink-3"
          placeholder="Ask about this forecast…"
          onKeyDown={(e) => { if (e.key === "Enter") { const v = (e.target as HTMLInputElement).value; v && onAsk?.(v); (e.target as HTMLInputElement).value = ""; } }}
        />
        <Button size="sm" className="h-[26px] px-2"><Send className="size-3" /></Button>
      </div>
    </aside>
  );
}
