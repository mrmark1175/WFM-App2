import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { apiUrl } from "@/app/lib/api";
import { useLOB } from "@/app/lib/lobContext";

export interface WhatIfEntry {
  id: string;
  name: string;
  is_committed: boolean;
}

interface WhatIfContextValue {
  whatIfs: WhatIfEntry[];
  activeWhatIfId: string;
  setActiveWhatIfId: (id: string) => void;
  committedWhatIf: WhatIfEntry | null;
  isLoading: boolean;
  refetch: () => Promise<void>;
}

const WhatIfContext = createContext<WhatIfContextValue | null>(null);

export function WhatIfProvider({ children }: { children: React.ReactNode }) {
  const { activeLob } = useLOB();
  const [whatIfs, setWhatIfs] = useState<WhatIfEntry[]>([]);
  const [activeWhatIfId, setActiveWhatIfIdState] = useState<string>(() =>
    localStorage.getItem("activeWhatIfId") ?? ""
  );
  const [isLoading, setIsLoading] = useState(false);

  const fetchWhatIfs = useCallback(async () => {
    if (!activeLob) return;
    setIsLoading(true);
    try {
      const res = await fetch(apiUrl(`/api/demand-planner-scenarios?lob_id=${activeLob.id}`));
      if (!res.ok) return;
      const data: { scenario_id: string; scenario_name: string; is_committed: boolean }[] = await res.json();
      const entries: WhatIfEntry[] = data.map((r) => ({
        id: r.scenario_id,
        name: r.scenario_name,
        is_committed: r.is_committed ?? false,
      }));
      setWhatIfs(entries);
      // Reset to first what-if if stored ID no longer exists in this LOB
      setActiveWhatIfIdState((prev) => {
        const stillExists = entries.some((e) => e.id === prev);
        return stillExists ? prev : (entries[0]?.id ?? "");
      });
    } catch {
      // Backend unreachable — leave current state
    } finally {
      setIsLoading(false);
    }
  }, [activeLob]);

  useEffect(() => {
    fetchWhatIfs();
  }, [fetchWhatIfs]);

  const setActiveWhatIfId = (id: string) => {
    setActiveWhatIfIdState(id);
    localStorage.setItem("activeWhatIfId", id);
  };

  const committedWhatIf = whatIfs.find((w) => w.is_committed) ?? null;

  return (
    <WhatIfContext.Provider
      value={{ whatIfs, activeWhatIfId, setActiveWhatIfId, committedWhatIf, isLoading, refetch: fetchWhatIfs }}
    >
      {children}
    </WhatIfContext.Provider>
  );
}

export function useWhatIf(): WhatIfContextValue {
  const ctx = useContext(WhatIfContext);
  if (!ctx) throw new Error("useWhatIf must be used inside WhatIfProvider");
  return ctx;
}
