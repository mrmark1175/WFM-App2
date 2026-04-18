import * as React from "react";
import { cn } from "../ui/utils";

type Density = "compact" | "balanced" | "cozy";

const rowH: Record<Density, string> = {
  compact: "[&_tbody_td]:h-[26px]",
  balanced: "[&_tbody_td]:h-[30px]",
  cozy: "[&_tbody_td]:h-[36px]",
};

/**
 * Dense, spreadsheet-feel table for WFM planning grids.
 * Uses the same <table>/<thead>/<tbody>/<td> tags as shadcn Table
 * but with font-mono + tabular-nums + custom borders.
 */
export function DenseTable({
  density = "balanced",
  className,
  ...props
}: React.ComponentProps<"table"> & { density?: Density }) {
  return (
    <div className="relative w-full overflow-x-auto">
      <table
        data-slot="dense-table"
        className={cn(
          "w-full caption-bottom text-[12px] font-mono tabular-nums border-collapse",
          "[&_thead_th]:bg-surface-2 [&_thead_th]:h-7 [&_thead_th]:px-2.5 [&_thead_th]:text-left [&_thead_th]:font-sans [&_thead_th]:font-medium [&_thead_th]:text-[10.5px] [&_thead_th]:uppercase [&_thead_th]:tracking-[.08em] [&_thead_th]:text-ink-3 [&_thead_th]:border-b [&_thead_th]:border-r [&_thead_th]:border-hairline",
          "[&_thead_th.num]:text-right [&_thead_th.num]:font-mono [&_thead_th.num]:text-[11px] [&_thead_th.num]:normal-case [&_thead_th.num]:tracking-normal",
          "[&_thead_th.yr]:bg-surface [&_thead_th.yr]:text-ink [&_thead_th.yr]:text-[12px] [&_thead_th.yr]:font-mono",
          "[&_tbody_td]:border-b [&_tbody_td]:border-r [&_tbody_td]:border-hairline [&_tbody_td]:px-2.5 [&_tbody_td]:align-middle",
          "[&_tbody_tr:hover_td]:bg-[#fdfcf7]",
          "[&_tbody_td.num]:text-right [&_tbody_td.num]:text-ink",
          "[&_tbody_td.readonly]:text-ink-3 [&_tbody_td.readonly]:bg-surface-2",
          "[&_tbody_td.edit]:bg-[#fffdf0] [&_tbody_td.edit]:shadow-[inset_0_0_0_1.5px_var(--indigo)] [&_tbody_td.edit]:relative",
          "[&_tbody_td.delta]:text-right [&_tbody_td.delta]:text-[11px]",
          "[&_tbody_td.delta.up]:text-pos [&_tbody_td.delta.down]:text-neg [&_tbody_td.delta.flat]:text-ink-3",
          "[&_tfoot_td]:bg-surface-2 [&_tfoot_td]:border-t-2 [&_tfoot_td]:border-t-ink [&_tfoot_td]:border-b-0 [&_tfoot_td]:border-r [&_tfoot_td]:border-r-hairline [&_tfoot_td]:px-2.5 [&_tfoot_td]:py-2 [&_tfoot_td]:font-semibold [&_tfoot_td]:text-ink",
          "[&_.month]:text-ink-2 [&_.month]:font-sans [&_.month]:font-medium [&_.month]:text-[12px]",
          rowH[density],
          className
        )}
        {...props}
      />
    </div>
  );
}
