import React, { useState, useEffect } from "react";
import { PageLayout } from "../components/PageLayout";
import { 
  TrendingUp, 
  Plus, 
  LineChart, 
  ChevronDown, 
  Settings2,
  Table as TableIcon
} from "lucide-react";
import {
  ComposedChart,
  Line,
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
  const [method, setMethod] = useState("Holt-Winters (Triple Exponential Smoothing)");
  const [forecastResults, setForecastResults] = useState<number[]>(Array(12).fill(0));
  const [alpha, setAlpha] = useState(0.3);
  const [beta, setBeta] = useState(0.1);
  const [gamma, setGamma] = useState(0.2);

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthsShort = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

  useEffect(() => {
    const fetchYearData = async () => {
      try {
        const response = await fetch(`http://localhost:5000/api/forecasts/${selectedYear}`);
        const data = await response.json();
        if (data && data.monthly_volumes) {
          setVolumes(data.monthly_volumes);
          setMethod(data.forecast_method);
        } else {
          setVolumes(Array(12).fill(0));
        }
      } catch (error) {
        console.error("❌ Error fetching from server:", error);
        setVolumes(Array(12).fill(0));
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

  const handleSaveToDatabase = async () => {
    const payload = {
      year_label: selectedYear,
      forecast_method: method,
      monthly_volumes: volumes,
      total_volume: totalVolume,
      peak_volume: peakVolume
    };
    try {
      const response = await fetch('http://localhost:5000/api/forecasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (response.ok) {
        alert("✅ Forecast saved to pgAdmin successfully!");
      } else {
        alert("❌ Server responded with an error.");
      }
    } catch (error) {
      console.error("Save Error:", error);
      alert("❌ Could not connect to server. Is server.cjs running?");
    }
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

  const handleGenerate = async () => {
    let dataToBasis: number[] = [];
    try {
      if (selectedYear === "Year 2") {
        const res = await fetch('http://localhost:5000/api/forecasts/Year 1');
        const data = await res.json();
        dataToBasis = data?.monthly_volumes || [];
      } else if (selectedYear === "Year 3") {
        const [res1, res2] = await Promise.all([
          fetch('http://localhost:5000/api/forecasts/Year 1'),
          fetch('http://localhost:5000/api/forecasts/Year 2')
        ]);
        const d1 = await res1.json();
        const d2 = await res2.json();
        dataToBasis = [...(d1?.monthly_volumes || []), ...(d2?.monthly_volumes || [])];
      } else {
        dataToBasis = [...volumes];
      }

      if (!dataToBasis.length || dataToBasis.every(v => v === 0)) {
        alert(`Please save ${selectedYear === "Year 3" ? "Year 2" : "Year 1"} data before generating this forecast.`);
        return;
      }

      let result: number[] = [];
      if (method.includes("Holt-Winters")) {
        result = generateHoltWintersForecast(dataToBasis, alpha, beta, gamma);
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
    <PageLayout title="Workforce Planning">
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
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase">Planning Horizon</label>
              <div className="flex gap-2">
                {["Year 1", "Year 2", "Year 3"].map((y) => (
                  <button
                    key={y}
                    onClick={() => setSelectedYear(y)}
                    className={`px-3 py-1.5 rounded-md text-sm transition-all ${
                      selectedYear === y
                        ? "bg-primary text-primary-foreground font-semibold"
                        : "bg-accent hover:bg-accent/80 text-accent-foreground"
                    }`}
                  >
                    {y}
                  </button>
                ))}
                <button className="p-1.5 rounded-md bg-accent text-accent-foreground border border-dashed border-border hover:border-primary">
                  <Plus className="size-4" />
                </button>
              </div>
            </div>

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

          <div className="flex items-center gap-3">
            <button
              onClick={handleGenerate}
              className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2"
            >
              <LineChart className="size-4" />
              Generate Forecast
            </button>
            <button
              onClick={handleSaveToDatabase}
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors shadow-sm"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <polyline points="17 21 17 13 7 13 7 21"/>
                <polyline points="7 3 7 8 15 8"/>
              </svg>
              Save to DB
            </button>
          </div>
        </div>

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
                  {selectedYear} Projection
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Calculated via {method.split('(')[0]}
                </p>
              </div>
            </div>
            <div className="bg-white dark:bg-slate-800 px-3 py-1 rounded-full border border-blue-200 dark:border-blue-800 shadow-sm">
              <span className="text-[10px] font-black text-primary uppercase tracking-widest">System Generated</span>
            </div>
          </div>

          <div className="grid grid-cols-12 gap-2">
            {monthsShort.map((month, idx) => (
              <div key={month} className="flex flex-col items-center p-2 rounded-lg bg-white dark:bg-slate-800 border border-blue-100 dark:border-blue-900 shadow-sm transition-transform hover:scale-105">
                <span className="text-[9px] font-bold text-slate-400 mb-1">{month}</span>
                <span className="text-sm font-mono font-bold text-primary">
                  {forecastResults[idx]?.toLocaleString() || 0}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Chart + Model Parameters */}
        <div className="grid md:grid-cols-3 gap-6">
          {/* Forecast Chart */}
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

                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))", fontWeight: 600 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
                    width={40}
                  />
                  <Tooltip content={<CustomTooltip />} />

                  {/* Actual bars */}
                  {hasActuals && (
                    <Bar
                      dataKey="actual"
                      name="Actual"
                      fill="hsl(var(--muted-foreground))"
                      fillOpacity={0.35}
                      radius={[3, 3, 0, 0]}
                      maxBarSize={28}
                    />
                  )}

                  {/* Forecast line + area */}
                  {hasForecast && (
                    <Area
                      type="monotone"
                      dataKey="forecast"
                      name="Forecast"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2.5}
                      fill="url(#forecastFill)"
                      dot={{ r: 4, fill: "hsl(var(--primary))", strokeWidth: 2, stroke: "white" }}
                      activeDot={{ r: 6 }}
                      connectNulls={false}
                    />
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
                    type="range"
                    min={0.01}
                    max={0.99}
                    step={0.01}
                    value={value}
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