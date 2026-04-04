import React, { createContext, useContext, useEffect, useState } from "react";
import { apiUrl } from "@/app/lib/api";

export interface LOB {
  id: number;
  lob_name: string;
  organization_id: number;
  created_at?: string;
}

interface LOBContextValue {
  lobs: LOB[];
  activeLob: LOB | null;
  setActiveLob: (lob: LOB) => void;
  createLob: (name: string) => Promise<LOB>;
  renameLob: (id: number, name: string) => Promise<void>;
  deleteLob: (id: number) => Promise<void>;
  isLoading: boolean;
}

const LOBContext = createContext<LOBContextValue | null>(null);

export function LOBProvider({ children }: { children: React.ReactNode }) {
  const [lobs, setLobs] = useState<LOB[]>([]);
  const [activeLob, setActiveLobState] = useState<LOB | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch(apiUrl("/api/lobs"))
      .then((r) => r.json())
      .then((data: LOB[]) => {
        setLobs(data);
        const savedId = localStorage.getItem("activeLobId");
        const restored = savedId ? data.find((l) => l.id === Number(savedId)) : null;
        setActiveLobState(restored ?? data[0] ?? null);
      })
      .catch(() => {
        // Backend not reachable yet — leave isLoading true, will retry on navigate
      })
      .finally(() => setIsLoading(false));
  }, []);

  const setActiveLob = (lob: LOB) => {
    setActiveLobState(lob);
    localStorage.setItem("activeLobId", String(lob.id));
  };

  const createLob = async (name: string): Promise<LOB> => {
    const res = await fetch(apiUrl("/api/lobs"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lob_name: name }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Failed to create LOB");
    }
    const newLob: LOB = await res.json();
    setLobs((prev) => [...prev, newLob]);
    return newLob;
  };

  const renameLob = async (id: number, name: string): Promise<void> => {
    const res = await fetch(apiUrl(`/api/lobs/${id}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lob_name: name }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Failed to rename LOB");
    }
    setLobs((prev) => prev.map((l) => (l.id === id ? { ...l, lob_name: name } : l)));
    if (activeLob?.id === id) {
      setActiveLobState((prev) => (prev ? { ...prev, lob_name: name } : prev));
    }
  };

  const deleteLob = async (id: number): Promise<void> => {
    const res = await fetch(apiUrl(`/api/lobs/${id}`), { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Failed to delete LOB");
    }
    const remaining = lobs.filter((l) => l.id !== id);
    setLobs(remaining);
    if (activeLob?.id === id) {
      const next = remaining[0] ?? null;
      if (next) setActiveLob(next);
      else setActiveLobState(null);
    }
  };

  return (
    <LOBContext.Provider
      value={{ lobs, activeLob, setActiveLob, createLob, renameLob, deleteLob, isLoading }}
    >
      {children}
    </LOBContext.Provider>
  );
}

export function useLOB(): LOBContextValue {
  const ctx = useContext(LOBContext);
  if (!ctx) throw new Error("useLOB must be used inside LOBProvider");
  return ctx;
}
