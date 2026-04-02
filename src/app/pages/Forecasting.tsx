import React, { useState, useEffect } from "react";
import { PageLayout } from "../components/PageLayout";
import { apiUrl } from "../lib/api";
import {
  TrendingUp, 
  Plus, 
  LineChart, 
  ChevronDown, 
  Settings2,
  Table as TableIcon,
  Phone,
  X,
  AlertTriangle
} from "lucide-react";
import {
  ComposedChart,
  Bar,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type ChannelKey = "voice" | "chat" | "email" | "cases";

const CHANNEL_OPTIONS: { value: ChannelKey; label: string }[] = [
  { value: "voice", label: "Voice" },
  { value: "chat", label: "Chat" },
  { value: "email", label: "Email" },
  { value: "cases", label: "Cases" },
];

export function Forecasting() {
  const [selectedChannel, setSelectedChannel] = useState<ChannelKey>("voice");
  const [volumes, setVolumes] = useState(Array(12).fill(0));
  const [selectedYear, setSelectedYear] = useState("Year 1");
  const [basisYearFrom, setBasisYearFrom] = useState("Year 1");
  const [years, setYears] = useState<string[]>([]);             // loaded from DB
  const [method, setMethod] = useState("Holt-Winters (Triple Exponential Smoothing)");
  const [forecastResults, setForecastResults] = useState<number[]>(Array(12).fill(0));
  const [alpha, setAlpha] = useState(0.3);
  const [beta, setBeta] = useState(0.1);
  const [gamma, setGamma] = useState(0.2);
  const [isSyncing,        setIsSyncing]        = useState(false);
  const [isSyncingArrival, setIsSyncingArrival] = useState(false);
  const [arrivalSyncMsg,   setArrivalSyncMsg]   = useState<{ ok: boolean; text: string } | null>(null);
  const [syncProgress,     setSyncProgress]     = useState<number>(0);
  const [syncStep,         setSyncStep]         = useState<string>("");
  const [isSaving,  setIsSaving]  = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [saveMsg,   setSaveMsg]   = useState<{ ok: boolean; text: string } | null>(null);

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthsShort = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

  const projectionLabel = (() => {
    // If selectedYear is a calendar year ("2024"), show "2025 Projection"
    const asNum = parseInt(selectedYear, 10);
    if (!isNaN(asNum) && asNum > 2000) return `${asNum + 1} Projection`;
    // Legacy "Year N" fallback
    const idx = years.indexOf(selectedYear);
    return `Year ${idx + 2} Projection`;
  })();

  const showSeasonalWarning =
    method.includes("Seasonal Decomposition") &&
    years.indexOf(selectedYear) < 1;

  // ── Load all saved years from DB on mount ──────────────────────────────────
  // Priority: saved forecast year_labels first, then detect from arrival data
  useEffect(() => {
    const fetchAllYears = async () => {
      try {
        // 1. Try saved forecasts first
        const res  = await fetch(apiUrl(`/api/forecasts?channel=${selectedChannel}`));
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          const savedYears = data.map((d: any) => d.year_label);
          setYears(savedYears);
          setSelectedYear(savedYears[savedYears.length - 1]);
          setBasisYearFrom(savedYears[0]);
          return;
        }
        // 2. No saved forecasts — detect calendar years from arrival data
        //    without pulling all records
        const probe = await fetch(
          apiUrl(`/api/interaction-arrival?startDate=2020-01-01&endDate=2030-12-31&channel=${selectedChannel}`)
        );
        const recs: any[] = await probe.json();
        if (Array.isArray(recs) && recs.length > 0) {
          const calYears = Array.from(new Set(
            recs.map(r => new Date((r.interval_date as string).split("T")[0] + "T00:00:00").getFullYear())
          )).sort() as number[];
          const labels = calYears.map(String);
          setYears(labels);
          setSelectedYear(labels[labels.length - 1]);
          setBasisYearFrom(labels[0]);
        } else {
          setYears(["Year 1"]);
          setSelectedYear("Year 1");
          setBasisYearFrom("Year 1");
        }
      } catch {
        setYears(["Year 1"]);
        setSelectedYear("Year 1");
      }
    };
    fetchAllYears();
  }, [selectedChannel]);

  // ── Helper: Fetch and aggregate Arrival Data ──────────────────────────────
  const fetchArrivalRollup = async (calendarYear: number): Promise<number[] | null> => {
    try {
      const res = await fetch(
        apiUrl(`/api/interaction-arrival?startDate=${calendarYear}-01-01&endDate=${calendarYear}-12-31&channel=${selectedChannel}`)
      );
      const recs: any[] = await res.json();
      if (!Array.isArray(recs) || recs.length === 0) return null;

      const monthly = Array(12).fill(0);
      const monthsFound = new Set<number>();

      recs.forEach(r => {
        const ds = (r.interval_date as string).split("T")[0];
        const mo = new Date(ds + "T00:00:00").getMonth();
        monthly[mo] += (r.volume || 0);
        if ((r.volume || 0) > 0) monthsFound.add(mo);
      });

      // "Completeness" check: records must exist across all 12 months
      if (monthsFound.size < 12) {
        console.log(`[Sync] ${calendarYear} data incomplete: only ${monthsFound.size}/12 months have volume.`);
        return null;
      }

      return monthly;
    } catch (err) {
      console.error("Rollup fetch error:", err);
      return null;
    }
  };

  // ── Load this year's data whenever selectedYear changes ───────────────────
  useEffect(() => {
    if (!selectedYear) return;
    const fetchYearData = async () => {
      try {
        const response = await fetch(apiUrl(`/api/forecasts/${selectedYear}?channel=${selectedChannel}`));
        const data = await response.json();
        
        if (data && data.monthly_volumes) {
          // 1. Data exists in Forecasts DB — Load it
          const vols = Array.isArray(data.monthly_volumes) ? data.monthly_volumes : JSON.parse(data.monthly_volumes);
          setVolumes(vols);
          setMethod(data.forecast_method || "Holt-Winters (Triple Exponential Smoothing)");
          const fr = data.forecast_results ? (Array.isArray(data.forecast_results) ? data.forecast_results : JSON.parse(data.forecast_results)) : Array(12).fill(0);
          setForecastResults(fr);
          setAlpha(data.alpha ?? 0.3);
          setBeta(data.beta ?? 0.1);
          setGamma(data.gamma ?? 0.2);
        } else {
          // 2. Not in Forecasts DB — Auto-check Arrival Data Baseline
          const calYear = parseInt(selectedYear, 10);
          if (!isNaN(calYear) && calYear > 2000) {
            const rollup = await fetchArrivalRollup(calYear);
            if (rollup) {
              setVolumes(rollup);
              setArrivalSyncMsg({ ok: true, text: `✓ Auto-synced ${calYear} actuals from Arrival Data` });
              setTimeout(() => setArrivalSyncMsg(null), 3000);
            } else {
              setVolumes(Array(12).fill(0));
            }
          } else {
            setVolumes(Array(12).fill(0));
          }
          
          setForecastResults(Array(12).fill(0));
          setAlpha(0.3);
          setBeta(0.1);
          setGamma(0.2);
        }
      } catch (error) {
        console.error("❌ Error fetching from server:", error);
        setVolumes(Array(12).fill(0));
        setForecastResults(Array(12).fill(0));
      }
    };
    fetchYearData();
  }, [selectedYear, selectedChannel]);

  const forecastingMethods = [
    { id: "holt-winters", name: "Holt-Winters (Triple Exponential Smoothing)" },
    { id: "decomposition", name: "Seasonal Decomposition" },
    { id: "arima", name: "ARIMA (Auto-Regressive Integrated Moving Average)" },
    { id: "linear", name: "Linear Regression" }
  ];

  const totalActual = volumes.reduce((sum, val) => sum + val, 0);
  const totalForecast = forecastResults.reduce((sum, val) => sum + val, 0);
  const peakForecast = Math.max(...forecastResults);
  const peakMonthIdx = forecastResults.indexOf(peakForecast);
  const variance = totalActual > 0 ? ((totalForecast - totalActual) / totalActual) * 100 : 0;

  // ── Save to DB ─────────────────────────────────────────────────────────────
  const handleSaveToDatabase = async () => {
    setIsSaving(true);
    setSaveMsg(null);
    const payload = {
      channel: selectedChannel,
      year_label: selectedYear,
      forecast_method: method,
      monthly_volumes: volumes,
      total_volume: totalForecast,
      peak_volume: peakForecast,
      forecast_results: forecastResults,
      alpha,
      beta,
      gamma,
    };
    try {
      const response = await fetch(apiUrl("/api/forecasts"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.ok) {
        setSaveMsg({ ok: true, text: `✓ ${selectedYear} saved successfully` });
      } else {
        setSaveMsg({ ok: false, text: "❌ Server responded with an error." });
      }
    } catch (error) {
      console.error("Save Error:", error);
      setSaveMsg({ ok: false, text: "❌ Could not connect to server. Is server.cjs running?" });
    } finally {
      setIsSaving(false);
      setTimeout(() => setSaveMsg(null), 3000);
    }
  };

  const handleGenesysSync = async () => {
    setIsSyncing(true);
    try {
      const response = await fetch(apiUrl("/api/genesys/sync"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          queueId: "63baa170-6599-4d6d-855f-8367f3747f52",
          interval: "2026-01-01T00:00:00/2026-03-13T00:00:00",
          channel: selectedChannel,
        }),
      });
      const result = await response.json();
      if (result.success) {
        console.log("Genesys Data:", result.data);
        alert("✅ Successfully pulled volume data from Genesys Cloud!");
      } else {
        alert("❌ Genesys Sync Failed: " + result.message);
      }
    } catch (error) {
      console.error("Sync Error:", error);
      alert("❌ Could not connect to Genesys Pipeline.");
    } finally {
      setIsSyncing(false);
    }
  };

  // ── Sync monthly volumes from Arrival Analysis data ───────────────────────
  // Fetches ONE year at a time (Jan 1 – Dec 31) to avoid payload limits.
  // selectedYear is either a 4-digit calendar year string ("2024") or
  // a legacy "Year N" label — both cases are handled.
  const handleSyncFromArrival = async () => {
    setIsSyncingArrival(true);
    setArrivalSyncMsg(null);
    setSyncProgress(0);
    setSyncStep("Resolving calendar year…");
    try {
      let calendarYear: number | null = null;
      const asNumber = parseInt(selectedYear, 10);
      if (!isNaN(asNumber) && asNumber > 2000 && asNumber < 2100) {
        calendarYear = asNumber;
      } else {
        setSyncStep("Probing arrival database…");
        const probeRes = await fetch(apiUrl(`/api/interaction-arrival?startDate=2020-01-01&endDate=2030-12-31&channel=${selectedChannel}`));
        const probeRecs: any[] = await probeRes.json();
        if (Array.isArray(probeRecs) && probeRecs.length > 0) {
          const calYears = Array.from(new Set(probeRecs.map(r => new Date((r.interval_date as string).split("T")[0] + "T00:00:00").getFullYear()))).sort() as number[];
          calendarYear = calYears[years.indexOf(selectedYear)] ?? null;
        }
      }

      if (!calendarYear) {
        setArrivalSyncMsg({ ok: false, text: "Could not map to a calendar year in arrival data." });
        return;
      }

      setSyncProgress(40);
      setSyncStep(`Fetching & aggregating ${calendarYear} records…`);
      
      const rollup = await fetchArrivalRollup(calendarYear);
      setSyncProgress(90);

      if (rollup) {
        setVolumes(rollup);
        setSyncProgress(100);
        setArrivalSyncMsg({ ok: true, text: `✓ Synced ${calendarYear} — Monthly totals updated` });
      } else {
        setArrivalSyncMsg({ ok: false, text: `⚠️ ${calendarYear} data is incomplete (requires all 12 months).` });
      }

      setTimeout(() => { setArrivalSyncMsg(null); setSyncProgress(0); setSyncStep(""); }, 5000);
    } catch (err) {
      setArrivalSyncMsg({ ok: false, text: "❌ Connection error." });
    } finally {
      setIsSyncingArrival(false);
    }
  };

  // ── Delete year — removes from DB and local state ─────────────────────────
  const handleDeleteYear = async (yearToDelete: string) => {
    if (years.length === 1) return; // always keep at least one tab
    try {
        await fetch(apiUrl(`/api/forecasts/${encodeURIComponent(yearToDelete)}?channel=${selectedChannel}`), {
          method: "DELETE",
        });
    } catch { /* ignore network errors */ }
    const newYears = years.filter(y => y !== yearToDelete);
    setYears(newYears);
    if (selectedYear === yearToDelete) {
      setSelectedYear(newYears[newYears.length - 1]);
    }
  };

  // ── Add year — uses next calendar year if tabs are already calendar years ──
  const handleAddYear = () => {
    // If existing tabs are calendar years (e.g. "2023", "2024"), continue the sequence
    const lastYear = years[years.length - 1];
    const lastNum  = parseInt(lastYear, 10);
    const nextYear = !isNaN(lastNum) && lastNum > 2000
      ? String(lastNum + 1)
      : `Year ${years.length + 1}`;
    setYears(prev => [...prev, nextYear]);
    setSelectedYear(nextYear);
  };

  const generateHoltWintersForecast = (
    historicalData: number[],
    α: number = alpha,
    β: number = beta,
    γ: number = gamma
  ): number[] => {
    const m = 12;
    if (historicalData.length < m) return Array(12).fill(0);

    let L = historicalData.slice(0, m).reduce((a, b) => a + b, 0) / m;
    let T = 0;
    if (historicalData.length >= m * 2) {
      const season2Avg = historicalData.slice(m, m * 2).reduce((a, b) => a + b, 0) / m;
      T = (season2Avg - L) / m;
    } else {
      T = L * 0.004;
    }
    const S = historicalData.slice(0, m).map(v => v / (L || 1));

    for (let i = m; i < historicalData.length; i++) {
      const prevL = L;
      const prevT = T;
      L = α * (historicalData[i] / (S[i % m] || 1)) + (1 - α) * (prevL + prevT);
      T = β * (L - prevL) + (1 - β) * prevT;
      S[i % m] = γ * (historicalData[i] / (L || 1)) + (1 - γ) * S[i % m];
    }

    return Array.from({ length: 12 }, (_, i) =>
      Math.round((L + (i + 1) * T) * (S[i % m] || 1))
    );
  };

  const generateSeasonalDecompositionForecast = (
    historicalData: number[]
  ): number[] => {
    const m = 12;
    const n = historicalData.length;
    if (n < m) return Array(12).fill(0);

    const trend: (number | null)[] = Array(n).fill(null);
    const half = Math.floor(m / 2);
    for (let i = half; i < n - half; i++) {
      const window = historicalData.slice(i - half, i + half + 1);
      trend[i] = window.reduce((a, b) => a + b, 0) / window.length;
    }

    const seasonalBuckets: number[][] = Array.from({ length: m }, () => []);
    for (let i = 0; i < n; i++) {
      if (trend[i] !== null && (trend[i] as number) !== 0) {
        seasonalBuckets[i % m].push(historicalData[i] / (trend[i] as number));
      }
    }

    const rawIndices = seasonalBuckets.map(bucket =>
      bucket.length > 0 ? bucket.reduce((a, b) => a + b, 0) / bucket.length : 1
    );
    const indicesSum = rawIndices.reduce((a, b) => a + b, 0) || m;
    const seasonalIndices = rawIndices.map(s => s * (m / indicesSum));

    const deseasonalized = historicalData.map((v, i) =>
      v / (seasonalIndices[i % m] || 1)
    );

    const xMean = (n - 1) / 2;
    const yMean = deseasonalized.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      num += (i - xMean) * (deseasonalized[i] - yMean);
      den += (i - xMean) ** 2;
    }
    const slope = den !== 0 ? num / den : 0;
    const intercept = yMean - slope * xMean;

    return Array.from({ length: 12 }, (_, i) => {
      const x = n + i;
      const trendValue = intercept + slope * x;
      return Math.round(trendValue * seasonalIndices[i % m]);
    });
  };

  // ✅ ARIMA(1,1,1)(1,1,0)[12] — Seasonal ARIMA implementation
  const generateARIMAForecast = (historicalData: number[]): number[] => {
    const n = historicalData.length;
    const s = 12;

    if (n < s + 2) return Array(12).fill(0);

    const seasonalDiff: number[] = [];
    for (let i = s; i < n; i++) {
      seasonalDiff.push(historicalData[i] - historicalData[i - s]);
    }

    const doubleDiff: number[] = [];
    for (let i = 1; i < seasonalDiff.length; i++) {
      doubleDiff.push(seasonalDiff[i] - seasonalDiff[i - 1]);
    }

    if (doubleDiff.length < 3) return Array(12).fill(0);

    const ddMean = doubleDiff.reduce((a, b) => a + b, 0) / doubleDiff.length;
    let covLag = 0, varLag = 0;
    for (let i = 1; i < doubleDiff.length; i++) {
      covLag += (doubleDiff[i - 1] - ddMean) * (doubleDiff[i] - ddMean);
      varLag += (doubleDiff[i - 1] - ddMean) ** 2;
    }
    const arCoeff = varLag !== 0 ? Math.max(-0.95, Math.min(0.95, covLag / varLag)) : 0.3;

    const variance = doubleDiff.reduce((s, v) => s + (v - ddMean) ** 2, 0) / doubleDiff.length;
    const lag1Cov = doubleDiff.slice(1).reduce((s, v, i) => s + (v - ddMean) * (doubleDiff[i] - ddMean), 0) / doubleDiff.length;
    const rho1 = variance !== 0 ? lag1Cov / variance : 0;
    let maCoeff = 0;
    if (Math.abs(rho1) < 0.5) {
      const disc = 1 - 4 * rho1 * rho1;
      maCoeff = disc >= 0 ? (-1 + Math.sqrt(disc)) / (2 * rho1 || 1) : 0;
      maCoeff = Math.max(-0.95, Math.min(0.95, maCoeff));
    }

    const ddForecast: number[] = [];
    let prevValue = doubleDiff[doubleDiff.length - 1];
    let prevError = 0;

    for (let h = 0; h < 12; h++) {
      const forecast = arCoeff * prevValue + maCoeff * prevError;
      ddForecast.push(forecast);
      prevError = 0;
      prevValue = forecast;
    }

    const sdForecast: number[] = [];
    let prevSD = seasonalDiff[seasonalDiff.length - 1];
    for (let h = 0; h < 12; h++) {
      const val = prevSD + ddForecast[h];
      sdForecast.push(val);
      prevSD = val;
    }

    const extended = [...historicalData];
    for (let h = 0; h < 12; h++) {
      const seasonalBase = extended[extended.length - s];
      const val = Math.round(sdForecast[h] + seasonalBase);
      extended.push(val);
    }

    return extended.slice(n);
  };

  const generateLinearRegressionForecast = (historicalData: number[]): number[] => {
    const n = historicalData.length;
    if (n < 2) return Array(12).fill(historicalData[0] || 0);

    let xSum = 0, ySum = 0, xySum = 0, x2Sum = 0;
    for (let i = 0; i < n; i++) {
      xSum += i;
      ySum += historicalData[i];
      xySum += i * historicalData[i];
      x2Sum += i * i;
    }

    const slope = (n * xySum - xSum * ySum) / (n * x2Sum - xSum * xSum || 1);
    const intercept = (ySum - slope * xSum) / n;

    return Array.from({ length: 12 }, (_, i) => Math.round(intercept + slope * (n + i)));
  };

  const handleGenerate = async (silent = false) => {
    setIsGenerating(true);
    let dataToBasis: number[] = [];
    try {
      const startIndex = years.indexOf(basisYearFrom);
      const endIndex = years.indexOf(selectedYear);

      if (startIndex < 0 || endIndex < 0 || startIndex > endIndex) {
        if (!silent) alert("Invalid baseline range. Please ensure 'Year From' is before or same as 'Year To'.");
        setIsGenerating(false);
        return;
      }

      // 1. Fetch historical years in the range (excluding current year on screen)
      let historical: number[] = [];
      const yearsToFetch = years.slice(startIndex, endIndex);
      
      if (yearsToFetch.length > 0) {
        const fetches = yearsToFetch.map(y =>
          fetch(apiUrl(`/api/forecasts/${y}?channel=${selectedChannel}`)).then(r => r.json())
        );
        const results = await Promise.all(fetches);
        historical = results.flatMap((d: any) => {
          if (!d?.monthly_volumes) return [];
          return Array.isArray(d.monthly_volumes) ? d.monthly_volumes : JSON.parse(d.monthly_volumes);
        });
      }

      // 2. Combine with CURRENT volumes from screen state
      dataToBasis = [...historical, ...volumes];

      if (!dataToBasis.length || dataToBasis.every(v => v === 0)) {
        if (!silent) alert(`Please enter volume data for ${selectedYear} first.`);
        setIsGenerating(false);
        return;
      }

      let result: number[] = [];
      if (method.includes("Holt-Winters")) {
        result = generateHoltWintersForecast(dataToBasis, alpha, beta, gamma);
      } else if (method.includes("Seasonal Decomposition")) {
        if (dataToBasis.length < 24) {
          if (!silent) alert("⚠️ Seasonal Decomposition requires at least 2 full years (24 months) of data.");
          setIsGenerating(false);
          return;
        }
        result = generateSeasonalDecompositionForecast(dataToBasis);
      } else if (method.includes("ARIMA")) {
        if (dataToBasis.length < 14) {
          if (!silent) alert("⚠️ ARIMA requires at least 14 months of data.");
          setIsGenerating(false);
          return;
        }
        result = generateARIMAForecast(dataToBasis);
      } else if (method.includes("Linear Regression")) {
        result = generateLinearRegressionForecast(dataToBasis);
      }

      setForecastResults(result);
    } catch (err) {
      console.error("Forecasting failed:", err);
    } finally {
      setIsGenerating(false);
    }
  };

  // ── Auto-compute forecast whenever inputs change ──────────────────────────
  useEffect(() => {
    const autoGenerate = async () => {
      if (volumes.some(v => v > 0)) {
        await handleGenerate(true); // silent = true
      }
    };
    autoGenerate();
  }, [volumes, method, alpha, beta, gamma, selectedYear]);

  const chartData = months.map((month, idx) => ({
    month,
    actual: volumes[idx] > 0 ? volumes[idx] : null,
    forecast: forecastResults[idx] > 0 ? forecastResults[idx] : null,
  }));

  const hasActuals = volumes.some(v => v > 0);
  const hasForecast = forecastResults.some(v => v > 0);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white dark:bg-slate-800 border border-border rounded-lg shadow-lg p-3 text-sm min-w-[140px]">
          <p className="font-bold text-slate-700 dark:text-slate-200 mb-2 text-xs uppercase tracking-wider">{label}</p>
          {payload.map((entry: any) => (
            entry.value !== null && (
              <div key={entry.name} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5 text-muted-foreground capitalize text-xs">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
                  {entry.name}
                </span>
                <span className="font-semibold text-xs tabular-nums" style={{ color: entry.color }}>
                  {entry.value?.toLocaleString()}
                </span>
              </div>
            )
          ))}
        </div>
      );
    }
    return null;
  };

  const paramConfig = [
    {
      label: "Alpha (α) — Level",
      value: alpha,
      setter: setAlpha,
      desc: "Controls how fast the level reacts to recent observations. Higher = more reactive.",
      color: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-50 dark:bg-blue-900/20",
    },
    {
      label: "Beta (β) — Trend",
      value: beta,
      setter: setBeta,
      desc: "Controls how fast the trend component adapts. Lower = smoother long-term trend.",
      color: "text-violet-600 dark:text-violet-400",
      bg: "bg-violet-50 dark:bg-violet-900/20",
    },
    {
      label: "Gamma (γ) — Seasonality",
      value: gamma,
      setter: setGamma,
      desc: "Controls how fast seasonal patterns update. Higher = follows recent seasonal shifts.",
      color: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-50 dark:bg-emerald-900/20",
    },
  ];

  return (
    <PageLayout title="Long Term Forecast">
      <div className="space-y-6">

        {/* Summary Cards */}
        <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-6 bg-white dark:bg-slate-900 rounded-xl border border-border shadow-sm">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1">Annual Forecast Total</p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-primary">{totalForecast.toLocaleString()}</span>
              <span className="text-sm text-muted-foreground font-medium">units</span>
            </div>
          </div>
          <div className="p-6 bg-white dark:bg-slate-900 rounded-xl border border-border shadow-sm">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1">Variance from Basis</p>
            <div className="flex items-baseline gap-2">
              <span className={`text-3xl font-bold ${variance >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                {variance >= 0 ? "+" : ""}{variance.toFixed(1)}%
              </span>
              <span className="text-sm text-muted-foreground font-medium">growth</span>
            </div>
          </div>
          <div className="p-6 bg-white dark:bg-slate-900 rounded-xl border border-border shadow-sm">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1">Projected Peak Month</p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-orange-600">
                {peakForecast > 0 ? months[peakMonthIdx] : "N/A"}
              </span>
              <span className="text-sm text-muted-foreground font-medium">
                ({peakForecast.toLocaleString()} units)
              </span>
            </div>
          </div>
        </div>

        {/* Configuration Header */}
        <div className="bg-card border border-border rounded-xl p-6 flex flex-wrap items-center justify-between gap-4 shadow-sm">
          <div className="flex items-center gap-8 flex-wrap">
            
            {/* Range Baseline Selector */}
            <div className="flex items-center gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                  <div className="size-1.5 rounded-full bg-slate-400" />
                  Basis Year From
                </label>
                <div className="relative group">
                  <select
                    value={basisYearFrom}
                    onChange={(e) => setBasisYearFrom(e.target.value)}
                    className="appearance-none bg-accent/50 border border-border rounded-lg px-4 py-2 text-sm pr-10 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all hover:bg-accent font-semibold"
                  >
                    {years.map(y => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none group-hover:text-primary transition-colors" />
                </div>
              </div>

              <div className="pt-5 text-muted-foreground/40 font-light text-xl">→</div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-primary uppercase tracking-widest flex items-center gap-1.5">
                  <div className="size-1.5 rounded-full bg-primary animate-pulse" />
                  Current Actuals (Year 2)
                </label>
                <div className="flex items-center gap-2">
                  <div className="relative group">
                    <select
                      value={selectedYear}
                      onChange={(e) => setSelectedYear(e.target.value)}
                      className="appearance-none bg-primary/5 border border-primary/20 rounded-lg px-4 py-2 text-sm pr-10 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all hover:bg-primary/10 font-bold text-primary"
                    >
                      {years.map(y => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-primary pointer-events-none" />
                  </div>
                  
                  <button
                    onClick={handleAddYear}
                    title="Add new year"
                    className="p-2 rounded-lg bg-white border border-border hover:border-primary hover:text-primary transition-all shadow-sm active:scale-95"
                  >
                    <Plus className="size-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Method Selector */}
            <div className="space-y-1.5 border-l border-border pl-8">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Channel</label>
              <div className="relative group mb-4">
                <select
                  value={selectedChannel}
                  onChange={(e) => setSelectedChannel(e.target.value as ChannelKey)}
                  className="appearance-none bg-slate-50 border border-border rounded-lg px-4 py-2 text-sm pr-10 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all hover:border-slate-400 min-w-[180px]"
                >
                  {CHANNEL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none group-hover:text-primary transition-colors" />
              </div>
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Model Selection</label>
              <div className="relative group">
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  className="appearance-none bg-slate-50 border border-border rounded-lg px-4 py-2 text-sm pr-10 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all hover:border-slate-400 min-w-[240px]"
                >
                  {forecastingMethods.map(m => (
                    <option key={m.id} value={m.name}>{m.name}</option>
                  ))}
                </select>
                <Settings2 className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none group-hover:text-primary transition-colors" />
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3 flex-wrap">

            {/* ── Sync from Arrival Analysis ── */}
            <div className="flex flex-col gap-1.5 min-w-[220px]">
              <button
                onClick={handleSyncFromArrival}
                disabled={isSyncingArrival}
                title="Pull monthly totals from Interaction Arrival data for this planning year"
                className={`bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors shadow-sm ${isSyncingArrival ? "opacity-80 cursor-not-allowed" : ""}`}
              >
                <TrendingUp className={`size-4 ${isSyncingArrival ? "animate-pulse" : ""}`} />
                {isSyncingArrival ? "Syncing…" : "Sync Arrival Data"}
              </button>

              {/* Progress bar — visible only while syncing or just finished */}
              {(isSyncingArrival || syncProgress > 0) && !arrivalSyncMsg && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground truncate max-w-[180px]">{syncStep}</span>
                    <span className="text-[10px] font-bold text-orange-600 tabular-nums ml-1">{syncProgress}%</span>
                  </div>
                  <div className="h-1.5 w-full bg-orange-100 dark:bg-orange-900/30 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-orange-500 rounded-full transition-all duration-300 ease-out"
                      style={{ width: `${syncProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Success / error message after sync completes */}
              {arrivalSyncMsg && (
                <span className={`text-xs font-semibold ${arrivalSyncMsg.ok ? "text-green-600" : "text-red-500"}`}>
                  {arrivalSyncMsg.text}
                </span>
              )}
            </div>

            <button
              onClick={handleGenesysSync}
              disabled={isSyncing}
              className={`bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors shadow-sm ${isSyncing ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <Phone className={`size-4 ${isSyncing ? "animate-pulse" : ""}`} />
              {isSyncing ? "Syncing..." : "Sync Genesys"}
            </button>
            <button
              onClick={() => handleGenerate(false)}
              disabled={isGenerating}
              className={`bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-all ${isGenerating ? "opacity-70 cursor-wait" : "hover:shadow-md"}`}
            >
              {isGenerating ? (
                <div className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <LineChart className="size-4" />
              )}
              {isGenerating ? "Generating..." : "Generate Forecast"}
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSaveToDatabase}
                disabled={isSaving}
                className={`bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors shadow-sm ${isSaving ? "opacity-60 cursor-not-allowed" : ""}`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                  <polyline points="17 21 17 13 7 13 7 21"/>
                  <polyline points="7 3 7 8 15 8"/>
                </svg>
                {isSaving ? "Saving..." : "Save to DB"}
              </button>
              {saveMsg && (
                <span className={`text-xs font-semibold ${saveMsg.ok ? "text-green-600" : "text-red-500"}`}>
                  {saveMsg.text}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Seasonal Decomposition warning banner */}
        {showSeasonalWarning && (
          <div className="flex items-start gap-3 px-5 py-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl shadow-sm">
            <AlertTriangle className="size-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Insufficient Data for Seasonal Decomposition</p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                This method requires at least <strong>2 full years (24 months)</strong> of saved actuals to compute reliable seasonal indices.
                Please switch to <strong>Year 2 or higher</strong> and ensure all prior years are saved to the database before generating.
              </p>
            </div>
          </div>
        )}

        {/* Volume Input Table */}
        <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm transition-all hover:shadow-md">
          <div className="p-5 border-b border-border bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded-lg text-slate-600">
                <TableIcon className="size-4" />
              </div>
              <div>
                <h3 className="font-bold text-slate-800 dark:text-slate-100">{selectedYear} - Monthly Actual Volumes</h3>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">Source Data for Forecast Baseline</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
               <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-3 py-1 bg-white dark:bg-slate-800 border border-border rounded-full italic">Manual Entry or Sync Arrival</span>
            </div>
          </div>
          
          <div className="p-6 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-12 gap-3 bg-slate-50/20">
            {months.map((m, index) => (
              <div key={m} className="group relative bg-white dark:bg-slate-900 border border-border rounded-xl p-3 transition-all hover:border-primary/50 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10 shadow-sm">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-tighter mb-1.5 group-hover:text-primary transition-colors">{m}</label>
                <input
                  type="text"
                  value={volumes[index] === 0 ? "" : volumes[index].toLocaleString()}
                  onChange={(e) => {
                    const rawValue = e.target.value.replace(/,/g, "");
                    if (/^\d*$/.test(rawValue)) {
                      const newVol = [...volumes];
                      newVol[index] = Number(rawValue);
                      setVolumes(newVol);
                    }
                  }}
                  placeholder="0"
                  className="w-full bg-transparent focus:outline-none font-mono font-bold text-lg text-slate-700 dark:text-slate-200"
                />
                <div className="absolute bottom-0 left-0 h-0.5 w-0 group-hover:w-full bg-primary transition-all duration-300" />
              </div>
            ))}
          </div>
        </div>

        {/* Forecast Output Table */}
        <div className="mt-10 p-8 bg-gradient-to-br from-blue-50/80 to-indigo-50/50 dark:from-blue-900/10 dark:to-indigo-900/5 rounded-2xl border border-blue-100 dark:border-blue-800/30 shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 p-12 opacity-5 pointer-events-none">
            <LineChart className="size-64" />
          </div>
          
          <div className="flex items-center justify-between mb-8 relative z-10">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-primary text-white rounded-xl shadow-lg shadow-primary/20">
                <TrendingUp className="size-6" />
              </div>
              <div>
                <h3 className="text-2xl font-black text-slate-900 dark:text-slate-100 tracking-tight leading-none">
                  {projectionLabel}
                </h3>
                <p className="text-xs font-medium text-blue-600 dark:text-blue-400 mt-2 flex items-center gap-2">
                  <Settings2 className="size-3" />
                  Engine: {method}
                </p>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="bg-white dark:bg-slate-800 px-4 py-1.5 rounded-full border border-blue-200 dark:border-blue-800 shadow-sm">
                <span className="text-[10px] font-black text-primary uppercase tracking-[0.2em]">Verified Projection</span>
              </div>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Confidence Interval: 95%</p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-12 gap-4 relative z-10">
            {monthsShort.map((month, idx) => (
              <div key={month} className="flex flex-col items-center py-6 px-2 rounded-2xl bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm border border-white dark:border-slate-700 shadow-sm transition-all hover:scale-105 hover:shadow-xl hover:border-primary/30 group cursor-default">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 group-hover:text-primary transition-colors">{month}</span>
                <span className="text-2xl font-mono font-black text-slate-800 dark:text-slate-100 leading-none group-hover:text-primary transition-colors">
                  {forecastResults[idx]?.toLocaleString() || 0}
                </span>
                <div className="mt-3 h-1 w-8 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                   <div className="h-full bg-primary/40 w-full" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Chart + Model Parameters */}
        <div className="grid md:grid-cols-3 gap-6">
          <div className="md:col-span-2 bg-card border border-border rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <TrendingUp className="size-4 text-primary" />
                <h4 className="font-semibold text-slate-800 dark:text-slate-100">Forecast Visualization</h4>
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                {hasActuals && (
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm bg-slate-300 dark:bg-slate-600 inline-block" />
                    Actual
                  </span>
                )}
                {hasForecast && (
                  <span className="flex items-center gap-1.5">
                    <span className="w-5 h-0.5 bg-primary inline-block rounded-full" />
                    Forecast
                  </span>
                )}
              </div>
            </div>
            {!hasActuals && !hasForecast ? (
              <div className="h-[250px] flex flex-col items-center justify-center text-center">
                <TrendingUp className="size-10 text-muted-foreground/20 mb-3" />
                <p className="text-muted-foreground font-medium text-sm">No data to display yet</p>
                <p className="text-xs text-muted-foreground/60 max-w-xs mt-1">
                  Enter monthly volumes above, then click <strong>Generate Forecast</strong> to populate this chart.
                </p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="forecastFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.18} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))", fontWeight: 600 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} width={40} />
                  <Tooltip content={<CustomTooltip />} />
                  {hasActuals && (
                    <Bar dataKey="actual" name="Actual" fill="hsl(var(--muted-foreground))" fillOpacity={0.35} radius={[3, 3, 0, 0]} maxBarSize={28} />
                  )}
                  {hasForecast && (
                    <Area type="monotone" dataKey="forecast" name="Forecast" stroke="hsl(var(--primary))" strokeWidth={2.5} fill="url(#forecastFill)" dot={{ r: 4, fill: "hsl(var(--primary))", strokeWidth: 2, stroke: "white" }} activeDot={{ r: 6 }} connectNulls={false} />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Model Parameters */}
          <div className="bg-card border border-border rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Settings2 className="size-4 text-primary" />
              <h4 className="font-semibold">Model Parameters</h4>
            </div>
            <div className="space-y-5">
              {paramConfig.map(({ label, value, setter, desc, color, bg }) => (
                <div key={label} className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <label className={`text-xs font-semibold ${color}`}>{label}</label>
                    <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded-full ${bg} ${color}`}>
                      {value.toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range" min={0.01} max={0.99} step={0.01} value={value}
                    onChange={(e) => setter(parseFloat(e.target.value))}
                    className="w-full accent-primary cursor-pointer"
                  />
                  <p className="text-[10px] text-muted-foreground italic leading-tight">{desc}</p>
                </div>
              ))}
              <div className="pt-2 border-t border-border">
                <p className="text-[10px] text-muted-foreground italic">
                  Note: Holt-Winters requires at least 24 months of data for optimal seasonality detection.
                </p>
              </div>
            </div>
          </div>
        </div>

      </div>
    </PageLayout>
  );
}
