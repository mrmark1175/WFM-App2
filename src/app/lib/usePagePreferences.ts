import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { apiUrl } from "@/app/lib/api";
import { useLOB } from "@/app/lib/lobContext";

interface UsePagePreferencesOptions<T extends Record<string, unknown>> {
  shouldUsePrimary?: (data: Partial<T>) => boolean;
  prepareForSave?: (next: T) => Partial<T> | T;
  transformFallback?: (data: Partial<T>) => Partial<T>;
}

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
  lobScoped = true,
  fallbackPageKey?: string,
  options?: UsePagePreferencesOptions<T>
): [T, (updater: Partial<T> | ((prev: T) => T)) => void, { loadedFromFallback: boolean }] {
  const { activeLob, isLoading: lobLoading } = useLOB();
  const lobId = lobScoped ? activeLob?.id : undefined;
  const currentScope = `${pageKey}|${fallbackPageKey ?? ""}|${lobId ?? "global"}`;
  const [prefsState, setPrefsState] = useState<{ scope: string; prefs: T }>(() => ({
    scope: currentScope,
    prefs: defaults,
  }));
  const [loadedFromFallback, setLoadedFromFallback] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialized = useRef(false);
  // Track the exact scope that was loaded so dynamic page keys reload when
  // channel/staffing-mode scoped pages switch inside the same LOB.
  const loadedForScope = useRef<string | undefined>(undefined);

  // ── Load from DB ─────────────────────────────────────────────────────────────
  useEffect(() => {
    // Wait for LOB context to finish loading before fetching
    if (lobLoading) return;
    // If lob-scoped and no active LOB yet, wait
    if (lobScoped && !activeLob) return;
    const loadScope = currentScope;
    // Skip if we already loaded for this exact scope
    if (loadedForScope.current === loadScope) return;

    let cancelled = false;
    initialized.current = false;
    loadedForScope.current = loadScope;
    setPrefsState({ scope: loadScope, prefs: defaults });
    setLoadedFromFallback(false);

    const url = lobId
      ? apiUrl(`/api/user-preferences?page_key=${encodeURIComponent(pageKey)}&lob_id=${lobId}`)
      : apiUrl(`/api/user-preferences?page_key=${encodeURIComponent(pageKey)}`);

    fetch(url)
      .then((r) => r.json())
      .then(async (data: Partial<T>) => {
        if (cancelled) return;
        const hasPrimaryRecord = data && typeof data === "object" && Object.keys(data).length > 0;
        const shouldUsePrimary = hasPrimaryRecord && (options?.shouldUsePrimary ? options.shouldUsePrimary(data) : true);
        if (shouldUsePrimary) {
          setPrefsState({ scope: loadScope, prefs: { ...defaults, ...data } });
          setLoadedFromFallback(false);
        } else {
          if (fallbackPageKey && fallbackPageKey !== pageKey) {
            const fallbackUrl = lobId
              ? apiUrl(`/api/user-preferences?page_key=${encodeURIComponent(fallbackPageKey)}&lob_id=${lobId}`)
              : apiUrl(`/api/user-preferences?page_key=${encodeURIComponent(fallbackPageKey)}`);
            const fallback = await fetch(fallbackUrl).then((r) => r.ok ? r.json() : null).catch(() => null) as Partial<T> | null;
            if (cancelled) return;
            if (fallback && typeof fallback === "object" && Object.keys(fallback).length > 0) {
              const transformedFallback = options?.transformFallback ? options.transformFallback(fallback) : fallback;
              setPrefsState({ scope: loadScope, prefs: { ...defaults, ...transformedFallback } });
              setLoadedFromFallback(true);
              return;
            }
          }
          setPrefsState({ scope: loadScope, prefs: defaults });
          setLoadedFromFallback(false);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setPrefsState({ scope: loadScope, prefs: defaults });
        setLoadedFromFallback(false);
      })
      .finally(() => {
        if (cancelled) return;
        initialized.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [lobLoading, lobScoped, activeLob, lobId, pageKey, fallbackPageKey, options, currentScope]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Save to DB (debounced 1.5s) ───────────────────────────────────────────────
  const saveToDb = useCallback(
    (next: T) => {
      if (!initialized.current) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        const url = lobId
          ? apiUrl(`/api/user-preferences?page_key=${encodeURIComponent(pageKey)}&lob_id=${lobId}`)
          : apiUrl(`/api/user-preferences?page_key=${encodeURIComponent(pageKey)}`);
        try {
          const payload = options?.prepareForSave ? options.prepareForSave(next) : next;
          const res = await fetch(url, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ preferences: payload }),
          });
          if (!res.ok) {
            toast.error("Your changes could not be saved. Please refresh and try again.");
          }
        } catch {
          toast.error("Could not reach the server to save your changes.");
        }
      }, 1500);
    },
    [lobId, pageKey, options]
  );

  // ── Public setter ─────────────────────────────────────────────────────────────
  const setPrefs = useCallback(
    (updater: Partial<T> | ((prev: T) => T)) => {
      setPrefsState((state) => {
        const prev = state.scope === currentScope ? state.prefs : defaults;
        const next =
          typeof updater === "function"
            ? updater(prev)
            : { ...prev, ...updater };
        saveToDb(next);
        setLoadedFromFallback(false);
        return { scope: currentScope, prefs: next };
      });
    },
    [currentScope, defaults, saveToDb]
  );

  const prefs = prefsState.scope === currentScope ? prefsState.prefs : defaults;
  return [prefs, setPrefs, { loadedFromFallback: prefsState.scope === currentScope && loadedFromFallback }];
}
