import React, { useState, useEffect } from "react";
import { PageLayout } from "../components/PageLayout";
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

export function Forecasting() {
  const [volumes, setVolumes] = useState(Array(12).fill(0));
  const [selectedYear, setSelectedYear] = useState("Year 1");
  const [years, setYears] = useState<string[]>([]);             // loaded from DB
  const [method, setMethod] = useState("Holt-Winters (Triple Exponential Smoothing)");
  const [forecastResults, setForecastResults] = useState<number[]>(Array(12).fill(0));
  const [alpha, setAlpha] = useState(0.3);
  const [beta, setBeta] = useState(0.1);
  const [gamma, setGamma] = useState(0.2);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthsShort = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

  const projectionLabel = (() => {
    const idx = years.indexOf(selectedYear);
    return `Year ${idx + 2} Projection`;
  })();

  const showSeasonalWarning =
    method.includes("Seasonal Decomposition") &&
    years.indexOf(selectedYear) < 1;

  // ── Load all saved years from DB on mount ──────────────────────────────────
  useEffect(() => {
    const fetchAllYears = async () => {
      try {
        const res = await fetch("http://localhost:5000/api/forecasts");
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          const savedYears = data.map((d: any) => d.year_label);
          setYears(savedYears);
          setSelectedYear(savedYears[0]);
        } else {
          // No saved years yet — seed with Year 1 as a local-only starting point
          setYears(["Year 1"]);
          setSelectedYear("Year 1");
        }
      } catch {
        setYears(["Year 1"]);
        setSelectedYear("Year 1");
      }
    };
    fetchAllYears();
  }, []);

  // ── Load this year's data whenever selectedYear changes ───────────────────
  useEffect(() => {
    if (!selectedYear) return;
    const fetchYearData = async () => {
      try {
        const response = await fetch(`http://localhost:5000/api/forecasts/${selectedYear}`);
        const data = await response.json();
        if (data && data.monthly_volumes) {
          // Parse monthly_volumes (may come as string or array)
          const vols = Array.isArray(data.monthly_volumes)
            ? data.monthly_volumes
            : JSON.parse(data.monthly_volumes);
          setVolumes(vols);
          setMethod(data.forecast_method || "Holt-Winters (Triple Exponential Smoothing)");

          // Restore forecast projection
          const fr = data.forecast_results
            ? (Array.isArray(data.forecast_results)
                ? data.forecast_results
                : JSON.parse(data.forecast_results))
            : Array(12).fill(0);
          setForecastResults(fr);

          // Restore model parameters
          setAlpha(data.alpha  ?? 0.3);
          setBeta(data.beta    ?? 0.1);
          setGamma(data.gamma  ?? 0.2);
        } else {
          // Year exists in list but hasn't been saved to DB yet
          setVolumes(Array(12).fill(0));
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
  }, [selectedYear]);

  const forecastingMethods = [
    { id: "holt-winters", name: "Holt-Winters (Triple Exponential Smoothing)" },
    { id: "decomposition", name: "Seasonal Decomposition" },
    { id: "arima", name: "ARIMA (Auto-Regressive Integrated Moving Average)" },
    { id: "linear", name: "Linear Regression" }
  ];

  const totalVolume = volumes.reduce((sum, val) => sum + val, 0);
  const peakVolume = Math.max(...volumes);

  // ── Save to DB — now includes forecast_results + model params ─────────────
  const handleSaveToDatabase = async () => {
    setIsSaving(true);
    setSaveMsg(null);
    const payload = {
      year_label: selectedYear,
      forecast_method: method,
      monthly_volumes: volumes,
      total_volume: totalVolume,
      peak_volume: peakVolume,
      forecast_results: forecastResults,
      alpha,
      beta,
      gamma,
    };
    try {
      const response = await fetch("http://localhost:5000/api/forecasts", {
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
      const response = await fetch("http://localhost:5000/api/genesys/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          queueId: "63baa170-6599-4d6d-855f-8367f3747f52",
          interval: "2026-01-01T00:00:00/2026-03-13T00:00:00"
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

  // ── Delete year — removes from DB and local state ─────────────────────────
  const handleDeleteYear = async (yearToDelete: string) => {
    if (years.length === 1) return;
    // Remove from DB (ignore if it was never saved)
    try {
      await fetch(`http://localhost:5000/api/forecasts/${encodeURIComponent(yearToDelete)}`, {
        method: "DELETE",
      });
    } catch { /* ignore network errors */ }
    const newYears = years.filter(y => y !== yearToDelete);
    setYears(newYears);
    if (selectedYear === yearToDelete) {
      setSelectedYear(newYears[newYears.length - 1]);
    }
  };

  // ── Add year — adds to local list only; persisted when user saves ─────────
  const handleAddYear = () => {
    const nextYear = `Year ${years.length + 1}`;
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
    const indicesSum = rawIndices.reduce((a, b) => a + b, 0);
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

  const handleGenerate = async () => {
    let dataToBasis: number[] = [];
    try {
      const currentYearIndex = years.indexOf(selectedYear);

      if (currentYearIndex === 0) {
        dataToBasis = [...volumes];
      } else {
        const fetches = years.slice(0, currentYearIndex + 1).map(y =>
          fetch(`http://localhost:5000/api/forecasts/${y}`).then(r => r.json())
        );
        const results = await Promise.all(fetches);
        dataToBasis = results.flatMap((d: any) => {
          if (!d?.monthly_volumes) return [];
          return Array.isArray(d.monthly_volumes) ? d.monthly_volumes : JSON.parse(d.monthly_volumes);
        });
      }

      if (!dataToBasis.length || dataToBasis.every(v => v === 0)) {
        alert(`Please enter and save ${selectedYear} data before generating a forecast.`);
        return;
      }

      let result: number[] = [];
      if (method.includes("Holt-Winters")) {
        result = generateHoltWintersForecast(dataToBasis, alpha, beta, gamma);
      } else if (method.includes("Seasonal Decomposition")) {
        if (dataToBasis.length < 24) {
          alert("⚠️ Seasonal Decomposition requires at least 2 full years (24 months) of data.\n\nPlease select Year 2 or higher and ensure all years are saved.");
          return;
        }
        result = generateSeasonalDecompositionForecast(dataToBasis);
      } else if (method.includes("ARIMA")) {
        if (dataToBasis.length < 14) {
          alert("⚠️ ARIMA requires at least 14 months of data to estimate AR and MA coefficients reliably.");
          return;
        }
        result = generateARIMAForecast(dataToBasis);
      } else {
        alert("This method is under development!");
        return;
      }

      setForecastResults(result);
    } catch (err) {
      console.error("Forecasting failed:", err);
    }
  };

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
              <span className="text-3xl font-bold text-primary">{totalVolume.toLocaleString()}</span>
              <span className="text-sm text-muted-foreground font-medium">units</span>
            </div>
          </div>
          <div className="p-6 bg-white dark:bg-slate-900 rounded-xl border border-border shadow-sm">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1">Average Monthly</p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-slate-700 dark:text-slate-200">{Math.round(totalVolume / 12).toLocaleString()}</span>
              <span className="text-sm text-muted-foreground font-medium">/ month</span>
            </div>
          </div>
          <div className="p-6 bg-white dark:bg-slate-900 rounded-xl border border-border shadow-sm">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1">Peak Month Volume</p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-orange-600 dark:text-orange-400">{peakVolume.toLocaleString()}</span>
              <span className="text-sm text-muted-foreground font-medium">units</span>
            </div>
          </div>
        </div>

        {/* Configuration Header */}
        <div className="bg-card border border-border rounded-xl p-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            {/* Year Selector */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase">Planning Horizon</label>
              <div className="flex gap-2 flex-wrap">
                {years.map((y) => (
                  <div key={y} className="relative group flex items-center">
                    <button
                      onClick={() => setSelectedYear(y)}
                      className={`px-3 py-1.5 rounded-md text-sm transition-all ${
                        selectedYear === y
                          ? "bg-primary text-primary-foreground font-semibold"
                          : "bg-accent hover:bg-accent/80 text-accent-foreground"
                      } ${years.length > 1 && y !== "Year 1" ? "pr-6" : ""}`}
                    >
                      {y}
                    </button>
                    {y !== "Year 1" && years.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteYear(y);
                        }}
                        className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity text-primary-foreground hover:text-red-300"
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  onClick={handleAddYear}
                  className="p-1.5 rounded-md bg-accent text-accent-foreground border border-dashed border-border hover:border-primary"
                >
                  <Plus className="size-4" />
                </button>
              </div>
            </div>

            {/* Method Selector */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase">Forecasting Method</label>
              <div className="relative">
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  className="appearance-none bg-accent border border-border rounded-md px-3 py-1.5 text-sm pr-8 focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  {forecastingMethods.map(m => (
                    <option key={m.id} value={m.name}>{m.name}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={handleGenesysSync}
              disabled={isSyncing}
              className={`bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors shadow-sm ${isSyncing ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <Phone className={`size-4 ${isSyncing ? "animate-pulse" : ""}`} />
              {isSyncing ? "Syncing..." : "Sync Genesys"}
            </button>
            <button
              onClick={handleGenerate}
              className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2"
            >
              <LineChart className="size-4" />
              Generate Forecast
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
        <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
          <div className="p-4 border-b border-border bg-muted/30 flex items-center gap-2">
            <TableIcon className="size-4 text-muted-foreground" />
            <h3 className="font-semibold">{selectedYear} - Monthly Actual Volume Input</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-muted/50">
                  {months.map(m => (
                    <th key={m} className="p-3 text-xs font-bold text-muted-foreground border-r border-border last:border-0 uppercase tracking-wider text-center">
                      {m}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {months.map((m, index) => (
                    <td key={m} className="p-0 border-r border-border last:border-0">
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
                        className="w-full p-4 text-center bg-transparent focus:bg-primary/5 focus:outline-none transition-colors font-medium text-lg"
                      />
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Forecast Output Table */}
        <div className="mt-8 p-6 bg-blue-50/50 dark:bg-blue-900/10 rounded-xl border-l-4 border-l-primary border border-border shadow-md">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary text-white rounded-lg shadow-sm">
                <LineChart className="size-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 leading-none">
                  {projectionLabel}
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Calculated via {method.split("(")[0]}
                </p>
              </div>
            </div>
            <div className="bg-white dark:bg-slate-800 px-3 py-1 rounded-full border border-blue-200 dark:border-blue-800 shadow-sm">
              <span className="text-[10px] font-black text-primary uppercase tracking-widest">System Generated</span>
            </div>
          </div>
          <div className="grid grid-cols-12 gap-3">
            {monthsShort.map((month, idx) => (
              <div key={month} className="flex flex-col items-center py-5 px-2 rounded-xl bg-white dark:bg-slate-800 border border-blue-100 dark:border-blue-900 shadow-sm transition-transform hover:scale-105 hover:shadow-md hover:border-primary/40">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">{month}</span>
                <span className="text-2xl font-mono font-extrabold text-primary leading-none">
                  {forecastResults[idx]?.toLocaleString() || 0}
                </span>
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