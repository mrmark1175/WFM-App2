import { Plus, RotateCcw, Download, Save, Columns2, X } from "lucide-react";

export interface ScenarioTabItem {
  id: string;
  name: string;
  version?: string;          // e.g. "v12"
  dotClass?: string;         // tailwind bg-* class for the dot
  closable?: boolean;
}

interface Props {
  scenarios: ScenarioTabItem[];
  activeId: string;
  onChange: (id: string) => void;
  onNew: () => void;
  onRename?: () => void;
  onDelete?: (id: string) => void;
  onSave: () => void;
  onRevert?: () => void;
  onExport?: () => void;
  compare?: boolean;
  setCompare?: (v: boolean) => void;
}

export function ScenarioBar({ scenarios, activeId, onChange, onNew, onDelete, onSave, onRevert, onExport, compare, setCompare }: Props) {
  return (
    <div className="sticky top-11 z-20 h-10 bg-surface border-b border-hairline flex items-stretch pl-[18px]">
      {scenarios.map((s, i) => {
        const active = s.id === activeId;
        return (
          <button key={s.id} onClick={() => onChange(s.id)}
            className={`flex items-center gap-2 px-3.5 text-[12px] border-r border-hairline ${i === 0 ? "border-l" : ""} ${
              active
                ? "text-ink bg-canvas shadow-[inset_0_-2px_0_var(--color-ink,#15171a)]"
                : "text-ink-3 hover:text-ink-2 hover:bg-surface-2"
            }`}>
            <span className={`size-[7px] rounded-full ${s.dotClass || "bg-indigo"}`} />
            <span className="font-medium">{s.name}</span>
            {s.version && <span className="font-mono text-[10.5px] text-ink-4">{s.version}</span>}
            {s.closable && onDelete && (
              <span role="button" onClick={(e) => { e.stopPropagation(); onDelete(s.id); }}
                className="text-ink-4 hover:text-ink text-[13px] ml-0.5"><X className="size-3" /></span>
            )}
          </button>
        );
      })}

      <button onClick={onNew}
        className="flex items-center gap-1.5 px-3 text-[12px] text-ink-3 hover:text-ink">
        <Plus className="size-3" /> Branch scenario
      </button>

      <div className="ml-auto flex items-center gap-0.5 pr-2.5">
        {setCompare && (
          <button onClick={() => setCompare(!compare)}
            className={`h-6 px-2.5 rounded text-[11.5px] inline-flex items-center gap-1.5 ${
              compare ? "bg-indigo-soft text-[var(--indigo-2)]" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
            }`}>
            <Columns2 className="size-3" /> Compare
          </button>
        )}
        {onRevert && (
          <button onClick={onRevert} className="h-6 px-2.5 rounded text-[11.5px] inline-flex items-center gap-1.5 text-ink-2 hover:bg-surface-2 hover:text-ink">
            <RotateCcw className="size-3" /> Revert
          </button>
        )}
        {onExport && (
          <button onClick={onExport} className="h-6 px-2.5 rounded text-[11.5px] inline-flex items-center gap-1.5 text-ink-2 hover:bg-surface-2 hover:text-ink">
            <Download className="size-3" /> Export
          </button>
        )}
        <button onClick={onSave} className="h-6 px-2.5 rounded text-[11.5px] inline-flex items-center gap-1.5 bg-ink text-white hover:bg-black">
          <Save className="size-3" /> Save
        </button>
      </div>
    </div>
  );
}
