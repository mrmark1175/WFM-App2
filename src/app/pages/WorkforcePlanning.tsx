import { useState } from "react";
import { PageLayout } from "../components/PageLayout";
import { 
  TrendingUp, 
  Plus, 
  LineChart, 
  ChevronDown, 
  Settings2,
  Table as TableIcon
} from "lucide-react";

export function WorkforcePlanning() {
  const [selectedYear, setSelectedYear] = useState("Year 1");
  const [method, setMethod] = useState("Holt-Winters");

  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", 
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ];

  const forecastingMethods = [
    { id: "holt-winters", name: "Holt-Winters (Triple Exponential Smoothing)" },
    { id: "decomposition", name: "Seasonal Decomposition" },
    { id: "arima", name: "ARIMA (Auto-Regressive Integrated Moving Average)" },
    { id: "linear", name: "Linear Regression" }
  ];

  return (
    <PageLayout title="Workforce Planning">
      <div className="space-y-6">
        
        {/* Configuration Header */}
        <div className="bg-card border border-border rounded-xl p-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            {/* Year Selector */}
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

          <button className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 hover:opacity-90">
            <LineChart className="size-4" />
            Generate Forecast
          </button>
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
                  {months.map(m => (
                    <td key={m} className="p-0 border-r border-border last:border-0">
                      <input 
                        type="number"
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

        {/* Forecast Visualization Placeholder */}
        <div className="grid md:grid-cols-3 gap-6">
          <div className="md:col-span-2 bg-card border border-border rounded-xl p-6 h-[300px] flex flex-col items-center justify-center text-center">
            <TrendingUp className="size-12 text-muted-foreground/20 mb-3" />
            <p className="text-muted-foreground font-medium">Forecast Graph Visualization</p>
            <p className="text-xs text-muted-foreground/60 max-w-xs">Entering monthly data will populate the comparison between actuals and the {method} projection.</p>
          </div>

          <div className="bg-card border border-border rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Settings2 className="size-4 text-primary" />
              <h4 className="font-semibold">Model Parameters</h4>
            </div>
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Confidence Level (80-95%)</label>
                <input type="range" className="w-full accent-primary" />
              </div>
              <div className="space-y-1 text-sm">
                <p className="text-muted-foreground italic">Note: Holt-Winters requires at least 24 months of data for optimal seasonality detection.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}