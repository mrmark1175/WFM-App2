import { Check, ChevronDown, GitFork, CheckCircle2, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { useWhatIf } from "@/app/lib/whatIfContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";

export function WhatIfSelector({ className }: { className?: string }) {
  const { whatIfs, activeWhatIfId, setActiveWhatIfId, isLoading } = useWhatIf();

  if (isLoading || whatIfs.length === 0) return null;

  const activeWhatIf = whatIfs.find((w) => w.id === activeWhatIfId) ?? whatIfs[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={`h-[26px] px-2.5 rounded inline-flex items-center gap-1.5 text-[12px] text-white/90 hover:bg-white/15 hover:text-white border border-white/30 max-w-[200px] ${className ?? ""}`}
        >
          <GitFork className="size-3.5 shrink-0 opacity-85" />
          {activeWhatIf?.is_committed && <CheckCircle2 className="size-3 shrink-0 text-emerald-300" />}
          <span className="truncate">{activeWhatIf?.name ?? "Select What-if"}</span>
          <ChevronDown className="size-3 shrink-0 opacity-80 ml-0.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {whatIfs.map((w) => (
          <DropdownMenuItem
            key={w.id}
            className="flex items-center gap-2 cursor-pointer"
            onSelect={() => setActiveWhatIfId(w.id)}
          >
            <Check className={`size-3.5 shrink-0 ${activeWhatIf?.id === w.id ? "opacity-100" : "opacity-0"}`} />
            <span className="truncate flex-1">{w.name}</span>
            {w.is_committed && (
              <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link
            to="/wfm/long-term-forecasting-demand"
            className="flex items-center gap-2 cursor-pointer text-muted-foreground text-[12px]"
          >
            <ExternalLink className="size-3.5 shrink-0" />
            Open Demand Planner
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
