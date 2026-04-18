import { Check, ChevronDown, Layers } from "lucide-react";
import { useLOB, CHANNEL_OPTIONS } from "@/app/lib/lobContext";
import type { ChannelKey } from "@/app/lib/lobContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { Button } from "@/app/components/ui/button";

export function ChannelSelector({ className }: { className?: string }) {
  const { activeChannel, setActiveChannel } = useLOB();

  const current = CHANNEL_OPTIONS.find((o) => o.value === activeChannel);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className={`flex items-center gap-2 w-32 ${className ?? ""}`}>
          <Layers className="size-4 shrink-0 opacity-70" />
          <span className="truncate font-medium">{current?.label ?? "Channel"}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-70 ml-auto" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-36">
        {CHANNEL_OPTIONS.map((opt) => (
          <DropdownMenuItem
            key={opt.value}
            className="flex items-center gap-2 cursor-pointer"
            onSelect={() => setActiveChannel(opt.value as ChannelKey)}
          >
            <Check className={`size-3.5 shrink-0 ${activeChannel === opt.value ? "opacity-100" : "opacity-0"}`} />
            <span>{opt.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
