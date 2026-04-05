import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { apiUrl } from "@/app/lib/api";
import { useLOB } from "@/app/lib/lobContext";

/**
 * usePagePreferences
 *
 * Generic hook that loads and auto-saves per-page UI preferences to the DB.
 * Each page gets its own `pageKey`; preferences are optionally scoped per LOB.
 *
 * @param pageKey   Unique string identifying the page (e.g. "arrival_analysis")
 * @param defaults  Default values used before DB data loads or when no record exists
 * @param lobScoped When true (default), preferences are stored per active LOB.
 *                  When false, they are stored globally (lob_id = NULL) — e.g. PerformanceAnalytics.
 */
export function usePagePreferences<T extends Record<string, unknown>>(
  pageKey: string,
  defaults: T,
  lobScoped = true
): [T, (updater: Partial<T> | ((prev: T) => T)) => void] {
  const { activeLob, isLoading: lobLoading } = useLOB();
  const [prefs, setPrefsState] = useState<T>(defaults);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialized = useRef(false);
  // Track the lob_id that was used to load the current prefs so we can
  // reload when the LOB switches.
  const loadedForLob = useRef<number | null | undefined>(undefined);

  const lobId = lobScoped ? activeLob?.id : undefined;

  // ── Load from DB ─────────────────────────────────────────────────────────────
  useEffect(() => {
    // Wait for LOB context to finish loading before fetching
    if (lobLoading) return;
    // If lob-scoped and no active LOB yet, wait
    if (lobScoped && !activeLob) return;
    // Skip if we already loaded for this exact LOB
    if (loadedForLob.current === lobId) return;

    initialized.current = false;
    loadedForLob.current = lobId;

    const url = lobId
      ? apiUrl(`/api/user-preferences?page_key=${pageKey}&lob_id=${lobId}`)
      : apiUrl(`/api/user-preferences?page_key=${pageKey}`);

    fetch(url)
      .then((r) => r.json())
      .then((data: Partial<T>) => {
        if (data && typeof data === "object" && Object.keys(data).length > 0) {
          setPrefsState({ ...defaults, ...data });
        } else {
          setPrefsState(defaults);
        }
      })
      .catch(() => {
        setPrefsState(defaults);
      })
      .finally(() => {
        initialized.current = true;
      });
  }, [lobLoading, lobScoped, activeLob, lobId, pageKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Save to DB (debounced 1.5s) ───────────────────────────────────────────────
  const saveToDb = useCallback(
    (next: T) => {
      if (!initialized.current) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        const url = lobId
          ? apiUrl(`/api/user-preferences?page_key=${pageKey}&lob_id=${lobId}`)
          : apiUrl(`/api/user-preferences?page_key=${pageKey}`);
        try {
          const res = await fetch(url, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ preferences: next }),
          });
          if (!res.ok) {
            toast.error("Your changes could not be saved. Please refresh and try again.");
          }
        } catch {
          toast.error("Could not reach the server to save your changes.");
        }
      }, 1500);
    },
    [lobId, pageKey]
  );

  // ── Public setter ─────────────────────────────────────────────────────────────
  const setPrefs = useCallback(
    (updater: Partial<T> | ((prev: T) => T)) => {
      setPrefsState((prev) => {
        const next =
          typeof updater === "function"
            ? updater(prev)
            : { ...prev, ...updater };
        saveToDb(next);
        return next;
      });
    },
    [saveToDb]
  );

  return [prefs, setPrefs];
}
