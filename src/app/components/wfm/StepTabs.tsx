import { Check } from "lucide-react";

export interface StepItem { id: number; label: string; done?: boolean; }

interface Props { steps: StepItem[]; activeId: number; onChange: (id: number) => void; }

export function StepTabs({ steps, activeId, onChange }: Props) {
  return (
    <div className="sticky top-[84px] z-[15] h-9 bg-surface border-t border-b border-hairline flex items-center px-[18px]">
      {steps.map((s, i) => {
        const active = s.id === activeId;
        return (
          <div key={s.id} className="flex items-center">
            <button onClick={() => onChange(s.id)}
              className={`flex items-center gap-2 h-full px-3.5 text-[12px] relative ${active ? "text-ink font-medium" : "text-ink-3 hover:text-ink"}`}>
              <span className={`font-mono text-[10.5px] size-[18px] rounded-full inline-grid place-items-center border ${
                active ? "bg-indigo text-white border-indigo" :
                s.done ? "bg-pos-soft text-pos border-transparent" :
                "bg-surface-2 text-ink-3 border-hairline-2"
              }`}>
                {s.done ? <Check className="size-2.5" /> : s.id}
              </span>
              <span>{s.label}</span>
              {active && <span className="absolute left-0 right-0 bottom-0 h-[2px] bg-indigo" />}
            </button>
            {i < steps.length - 1 && <div className="w-4 h-px bg-hairline" />}
          </div>
        );
      })}
    </div>
  );
}
