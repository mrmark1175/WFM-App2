import { Check, ChevronDown, Building2 } from "lucide-react";
import { useLOB } from "@/app/lib/lobContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";

export function LOBSelector({ className }: { className?: string }) {
  const { lobs, activeLob, setActiveLob, isLoading } = useLOB();

  if (isLoading) {
    return (
      <div className={`h-[26px] px-2.5 rounded inline-flex items-center gap-1.5 text-[12px] text-white/85 bg-white/12 border border-white/25 animate-pulse ${className ?? ""}`}>
        <Building2 className="size-3.5 opacity-80" />
        <span className="w-20 h-2.5 bg-white/35 rounded" />
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={`h-[26px] px-2.5 rounded inline-flex items-center gap-1.5 text-[12px] text-white/90 hover:bg-white/15 hover:text-white border border-white/30 max-w-[200px] ${className ?? ""}`}>
          <Building2 className="size-3.5 shrink-0 opacity-85" />
          <span className="truncate">{activeLob?.lob_name ?? "Select LOB"}</span>
          <ChevronDown className="size-3 shrink-0 opacity-80 ml-0.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {lobs.map((lob) => (
          <DropdownMenuItem
            key={lob.id}
            className="flex items-center gap-2 cursor-pointer"
            onSelect={() => setActiveLob(lob)}
          >
            <Check className={`size-3.5 shrink-0 ${activeLob?.id === lob.id ? "opacity-100" : "opacity-0"}`} />
            <span className="truncate">{lob.lob_name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
