import { Check, ChevronDown, Building2 } from "lucide-react";
import { useLOB } from "@/app/lib/lobContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { Button } from "@/app/components/ui/button";

export function LOBSelector({ className }: { className?: string }) {
  const { lobs, activeLob, setActiveLob, isLoading } = useLOB();

  if (isLoading) {
    return (
      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-card text-sm text-muted-foreground animate-pulse ${className ?? ""}`}>
        <Building2 className="size-4" />
        <span>Loading...</span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className={`flex items-center gap-2 max-w-[220px] ${className ?? ""}`}>
          <Building2 className="size-4 shrink-0 opacity-70" />
          <span className="truncate font-medium">{activeLob?.lob_name ?? "Select LOB"}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-70 ml-auto" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
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
