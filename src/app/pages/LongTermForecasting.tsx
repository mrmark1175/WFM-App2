import React, { useState, useEffect } from "react";
import { PageLayout } from "../components/PageLayout";
import {
  TrendingUp,
  Users,
  Clock,
  AlertCircle,
  DollarSign,
  Settings2,
  Table as TableIcon,
  ChevronRight,
  ChevronDown,
  LayoutDashboard,
  Filter,
  Save,
  Plus,
  Loader2
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Area,
  ComposedChart
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Badge } from "../components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";

// --- Data Models & Interfaces ---

export interface Assumptions {
  aht: number;
  shrinkage: number;
  slTarget: number;
  occupancy: number;
  growthRate: number;
}

export interface ForecastData {
  month: string;
  volume: number;
  aht: number;
  shrinkage: number;
  requiredFTE: number;
  scheduledFTE: number;
  gap: number;
}

export interface Scenario {
  id: string;
  name: string;
  assumptions: Assumptions;
  data: ForecastData[];
}

export interface KPIData {
  totalVolume: number;
  avgAHT: number;
  requiredFTE: number;
  staffingGap: number;
  estimatedCost: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const DEFAULT_ASSUMPTIONS: Assumptions = {
  aht: 300,
  shrinkage: 25,
  slTarget: 80,
  occupancy: 85,
  growthRate: 5,
};

// --- Calculation Logic ---

/**
 * Calculates Required FTE using the formula:
 * FTE = (Volume * AHT) / (WorkSecondsInMonth * occupancy * (1 - shrinkage))
 * Note: We use 160 hours (576,000s) as a standard monthly work base per FTE.
 */
export const calculateFTE = (
  volume: number,
  aht: number,
  shrinkage: number,
  occupancy: number
): number => {
  if (volume === 0) return 0;
  const workSecondsInMonth = 160 * 3600; // 160 hours
  const occupancyFactor = occupancy / 100;
  const shrinkageFactor = 1 - (shrinkage / 100);
  
  const fte = (volume * aht) / (workSecondsInMonth * occupancyFactor * shrinkageFactor);
  return Number(fte.toFixed(1));
};

export const calculateStaffingGap = (requiredFTE: number, scheduledFTE: number): number => {
  return Number((scheduledFTE - requiredFTE).toFixed(1));
};

export default function LongTermForecasting() {
  const [isAssumptionsOpen, setIsAssumptionsOpen] = useState(true);
  const [selectedScenario, setSelectedScenario] = useState("base");
  const [loading, setLoading] = useState(true);
  
  // State for our forecast data
  const [forecastData, setForecastData] = useState<ForecastData[]>([]);
  const [assumptions, setAssumptions] = useState<Assumptions>(DEFAULT_ASSUMPTIONS);

  // ── Recalculate Logic ─────────────────────────────────────────────────────
  const handleRecalculate = () => {
    setForecastData(prev => prev.map(d => {
      const reqFTE = calculateFTE(d.volume, assumptions.aht, assumptions.shrinkage, assumptions.occupancy);
      // For mock purposes, scheduled FTE remains proportionally adjusted
      const schedFTE = Math.round(reqFTE * 1.05); 
      
      return {
        ...d,
        aht: assumptions.aht,
        shrinkage: assumptions.shrinkage,
        requiredFTE: reqFTE,
        scheduledFTE: schedFTE,
        gap: calculateStaffingGap(reqFTE, schedFTE)
      };
    }));
  };

  // ── Reactive Updates ──────────────────────────────────────────────────────
  // Automatically recalculate whenever assumptions change
  useEffect(() => {
    if (forecastData.length > 0) {
      handleRecalculate();
    }
  }, [assumptions.aht, assumptions.shrinkage, assumptions.occupancy, assumptions.growthRate]);
  
  // ── Step 2: Fetch Mock Data from Genesys API ──────────────────────────────
  useEffect(() => {
    const fetchMockData = async () => {
      setLoading(true);
      try {
        const response = await fetch("http://localhost:5000/api/genesys/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            queueId: "mock-queue-id",
            interval: "2026-01-01/2026-12-31"
          }),
        });
        const result = await response.json();
        
        if (result.success && Array.isArray(result.data)) {
          const mappedData: ForecastData[] = MONTHS.map((month, idx) => {
            const volume = result.data[idx] || 0;
            const reqFTE = calculateFTE(volume, assumptions.aht, assumptions.shrinkage, assumptions.occupancy);
            const schedFTE = Math.round(reqFTE * 1.05);

            return {
              month,
              volume,
              aht: assumptions.aht,
              shrinkage: assumptions.shrinkage,
              requiredFTE: reqFTE,
              scheduledFTE: schedFTE,
              gap: calculateStaffingGap(reqFTE, schedFTE),
            };
          });
          setForecastData(mappedData);
        }
      } catch (error) {
        console.error("Error fetching mock data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchMockData();
  }, []); // Run only on mount

  // Calculate KPIs based on forecastData
  const kpis: KPIData = {
    totalVolume: forecastData.reduce((sum, d) => sum + d.volume, 0),
    avgAHT: forecastData.length > 0 ? Math.round(forecastData.reduce((sum, d) => sum + d.aht, 0) / forecastData.length) : 0,
    requiredFTE: forecastData.length > 0 ? Number((forecastData.reduce((sum, d) => sum + d.requiredFTE, 0) / forecastData.length).toFixed(1)) : 0,
    staffingGap: Number(forecastData.reduce((sum, d) => sum + d.gap, 0).toFixed(1)),
    estimatedCost: forecastData.length > 0 ? Number(((forecastData.reduce((sum, d) => sum + d.requiredFTE, 0) / forecastData.length) * 45000).toFixed(0)) : 0,
  };

  if (loading) {
    return (
      <PageLayout title="Long-Term Forecasting">
        <div className="h-[60vh] flex flex-col items-center justify-center gap-4">
          <Loader2 className="size-12 text-primary animate-spin" />
          <p className="text-muted-foreground font-medium">Loading Genesys Mock Data...</p>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout title="Long-Term Forecasting">
      <div className="flex flex-col gap-8 pb-12">
        
        {/* Sticky Header: Scenario & KPI Bar */}
        <div className="sticky top-0 z-30 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 -mx-4 px-4 py-4 space-y-4 border-b border-border shadow-sm mb-2 transition-all">
          
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex flex-col gap-1">
                <Label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Active Planning Scenario</Label>
                <Select value={selectedScenario} onValueChange={setSelectedScenario}>
                  <SelectTrigger className="w-[220px] h-10 border-primary/20 bg-primary/5 font-bold text-primary focus:ring-primary/20">
                    <SelectValue placeholder="Select Scenario" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="base" className="font-medium">Base Case (Steady)</SelectItem>
                    <SelectItem value="scenario-a" className="font-medium">Scenario A (High Growth)</SelectItem>
                    <SelectItem value="scenario-b" className="font-medium">Scenario B (Efficiency)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button variant="outline" size="sm" className="h-10 mt-5 gap-2 font-semibold border-dashed hover:border-primary hover:text-primary transition-all">
                <Plus className="size-4" />
                New Scenario
              </Button>
            </div>
            <div className="flex items-center gap-3 mt-5">
              <Button variant="ghost" size="sm" className="h-10 gap-2 text-muted-foreground hover:text-foreground">
                <Filter className="size-4" />
                Filters
              </Button>
              <Button variant="default" size="sm" className="h-10 gap-2 px-6 font-bold shadow-lg shadow-primary/20">
                <Save className="size-4" />
                Save Scenario
              </Button>
            </div>
          </div>

          {/* 1. Top KPI Summary Bar (Part of Sticky Header) */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Card className="bg-slate-50 dark:bg-slate-900 border-none shadow-none rounded-lg">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <TrendingUp className="size-5 text-primary" />
                </div>
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Forecast Vol</p>
                  <h3 className="text-lg font-black tracking-tight">{kpis.totalVolume.toLocaleString()}</h3>
                </div>
              </CardContent>
            </Card>
            
            <Card className="bg-slate-50 dark:bg-slate-900 border-none shadow-none rounded-lg">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="p-2 bg-indigo-100 dark:bg-indigo-900/40 rounded-lg">
                  <Clock className="size-5 text-indigo-600 dark:text-indigo-400" />
                </div>
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Avg. AHT</p>
                  <h3 className="text-lg font-black tracking-tight">{kpis.avgAHT}s</h3>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-slate-50 dark:bg-slate-900 border-none shadow-none rounded-lg">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="p-2 bg-amber-100 dark:bg-amber-900/40 rounded-lg">
                  <Users className="size-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Req. FTE</p>
                  <h3 className="text-lg font-black tracking-tight">{kpis.requiredFTE}</h3>
                </div>
              </CardContent>
            </Card>

            <Card className={`border-none shadow-none rounded-lg ${kpis.staffingGap < 0 ? "bg-rose-50 dark:bg-rose-950/20" : "bg-emerald-50 dark:bg-emerald-950/20"}`}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className={`p-2 rounded-lg ${kpis.staffingGap < 0 ? "bg-rose-100 dark:bg-rose-900/40" : "bg-emerald-100 dark:bg-emerald-900/40"}`}>
                  <AlertCircle className={`size-5 ${kpis.staffingGap < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`} />
                </div>
                <div>
                  <p className={`text-[10px] font-bold uppercase tracking-widest ${kpis.staffingGap < 0 ? "text-rose-600" : "text-emerald-600"}`}>Gap</p>
                  <h3 className={`text-lg font-black tracking-tight ${kpis.staffingGap < 0 ? "text-rose-700 dark:text-rose-300" : "text-emerald-700 dark:text-emerald-300"}`}>
                    {kpis.staffingGap > 0 ? `+${kpis.staffingGap}` : kpis.staffingGap}
                  </h3>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-slate-50 dark:bg-slate-900 border-none shadow-none rounded-lg">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="p-2 bg-slate-200 dark:bg-slate-800 rounded-lg">
                  <DollarSign className="size-5 text-slate-600 dark:text-slate-400" />
                </div>
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Est. Cost</p>
                  <h3 className="text-lg font-black tracking-tight">${(kpis.estimatedCost / 1000000).toFixed(1)}M</h3>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* 2. Main Forecast Chart Section */}
          <div className="lg:col-span-3 space-y-8">
            <Card className="border border-border/50 shadow-lg shadow-slate-200/50 dark:shadow-none overflow-hidden">
              <CardHeader className="bg-slate-50/50 dark:bg-slate-900/50 border-b border-border/50 flex flex-row items-center justify-between py-4">
                <div>
                  <CardTitle className="text-base font-black flex items-center gap-2">
                    <LayoutDashboard className="size-4 text-primary" />
                    Resource Capacity Forecast
                  </CardTitle>
                  <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Historical Actuals vs. Projected Demands</p>
                </div>
                <div className="flex items-center gap-2">
                   <Badge variant="outline" className="text-[10px] font-black uppercase tracking-widest bg-white dark:bg-slate-800 border-primary/20 text-primary">Live Projection</Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="h-[400px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={forecastData} margin={{ top: 20, right: 30, left: 10, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorVol" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.15}/>
                          <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.5} />
                      <XAxis 
                        dataKey="month" 
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))', fontWeight: 700 }}
                        dy={10}
                      />
                      <YAxis 
                        yAxisId="left"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 10, fill: 'hsl(var(--primary))', fontWeight: 800 }}
                        tickFormatter={(value) => value >= 1000 ? `${(value / 1000).toFixed(0)}k` : value}
                      />
                      <YAxis 
                        yAxisId="right" 
                        orientation="right" 
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 10, fill: '#f59e0b', fontWeight: 800 }}
                      />
                      <Tooltip 
                        cursor={{ stroke: 'hsl(var(--primary))', strokeWidth: 1, strokeDasharray: '4 4' }}
                        content={({ active, payload, label }) => {
                          if (active && payload && payload.length) {
                            return (
                              <div className="bg-white dark:bg-slate-900 border border-border/80 p-4 rounded-xl shadow-2xl min-w-[200px] backdrop-blur-md">
                                <div className="flex items-center justify-between mb-3 border-b border-border pb-2">
                                  <p className="text-xs font-black uppercase tracking-widest text-slate-800 dark:text-slate-100">{label} 2026</p>
                                  <Badge variant="outline" className="text-[9px] font-black">{selectedScenario.toUpperCase()}</Badge>
                                </div>
                                <div className="space-y-2">
                                  {payload.map((entry, index) => (
                                    <div key={index} className="flex items-center justify-between gap-6">
                                      <div className="flex items-center gap-2">
                                        <div className="size-2 rounded-full" style={{ backgroundColor: entry.color }} />
                                        <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-tight">{entry.name}</span>
                                      </div>
                                      <span className="text-[12px] font-black tabular-nums" style={{ color: entry.color }}>
                                        {entry.value?.toLocaleString()}
                                      </span>
                                    </div>
                                  ))}
                                  <div className="pt-2 border-t border-border mt-1">
                                    <div className="flex items-center justify-between">
                                       <span className="text-[10px] font-black text-muted-foreground uppercase">Staffing Gap</span>
                                       <span className={`text-[11px] font-black tabular-nums ${payload[1].value > payload[2].value ? 'text-rose-600' : 'text-emerald-600'}`}>
                                         {Number(payload[2].value - payload[1].value).toFixed(1)} FTE
                                       </span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Legend 
                        verticalAlign="top" 
                        align="right"
                        height={40}
                        iconType="circle"
                        wrapperStyle={{ paddingTop: '0px', paddingBottom: '30px', fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}
                      />
                      <Area 
                        yAxisId="left"
                        type="monotone" 
                        dataKey="volume" 
                        name="Volume"
                        stroke="hsl(var(--primary))" 
                        fillOpacity={1} 
                        fill="url(#colorVol)" 
                        strokeWidth={4}
                        dot={{ r: 3, fill: 'hsl(var(--background))', strokeWidth: 2, stroke: 'hsl(var(--primary))' }}
                        activeDot={{ r: 6, strokeWidth: 0 }}
                      />
                      <Line 
                        yAxisId="right"
                        type="monotone" 
                        dataKey="requiredFTE" 
                        name="Required"
                        stroke="#f59e0b" 
                        strokeWidth={4}
                        dot={{ r: 3, fill: 'hsl(var(--background))', strokeWidth: 2, stroke: '#f59e0b' }}
                        activeDot={{ r: 6, strokeWidth: 0 }}
                      />
                      <Line 
                        yAxisId="right"
                        type="monotone" 
                        dataKey="scheduledFTE" 
                        name="Available"
                        stroke="#10b981" 
                        strokeWidth={2}
                        strokeDasharray="6 4"
                        dot={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* 4. Forecast Table (bottom) */}
            <Card className="border border-border/50 shadow-md">
              <CardHeader className="flex flex-row items-center justify-between py-4 border-b border-border/50 bg-slate-50/30">
                <div>
                  <CardTitle className="text-sm font-black uppercase tracking-widest">Statistical Breakdown</CardTitle>
                </div>
                <Button variant="ghost" size="sm" className="h-8 gap-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  <TableIcon className="size-3" />
                  Export Data
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-slate-50/80 dark:bg-slate-900/80">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-[120px] text-[10px] font-black uppercase tracking-widest pl-6">Timeline</TableHead>
                      <TableHead className="text-right text-[10px] font-black uppercase tracking-widest">Proj Volume</TableHead>
                      <TableHead className="text-right text-[10px] font-black uppercase tracking-widest">AHT</TableHead>
                      <TableHead className="text-right text-[10px] font-black uppercase tracking-widest">Shrinkage</TableHead>
                      <TableHead className="text-right text-[10px] font-black uppercase tracking-widest">Req FTE</TableHead>
                      <TableHead className="text-right text-[10px] font-black uppercase tracking-widest">Avail FTE</TableHead>
                      <TableHead className="text-right text-[10px] font-black uppercase tracking-widest pr-6">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {forecastData.map((row) => (
                      <TableRow key={row.month} className="group hover:bg-slate-50/50 dark:hover:bg-slate-900/50 transition-colors">
                        <TableCell className="font-bold text-xs pl-6">{row.month} 2026</TableCell>
                        <TableCell className="text-right font-mono text-xs font-bold text-primary">{row.volume.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{row.aht}s</TableCell>
                        <TableCell className="text-right font-mono text-xs">{row.shrinkage}%</TableCell>
                        <TableCell className="text-right font-mono text-xs font-bold text-amber-600">{row.requiredFTE}</TableCell>
                        <TableCell className="text-right font-mono text-xs text-emerald-600">{row.scheduledFTE}</TableCell>
                        <TableCell className="text-right pr-6">
                          <Badge 
                            variant={row.gap >= 0 ? "default" : "destructive"} 
                            className={`font-black text-[10px] tracking-tight min-w-[50px] justify-center ${row.gap >= 0 ? "bg-emerald-500 hover:bg-emerald-600 border-none" : ""}`}
                          >
                            {row.gap > 0 ? `+${row.gap}` : row.gap}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          {/* 3. Assumptions Panel (right side) */}
          <div className="lg:col-span-1">
            <div className="sticky top-[200px] space-y-6">
              <Card className="border border-border/80 shadow-xl overflow-hidden">
                <CardHeader className="border-b border-border/50 bg-slate-900 text-white py-4">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xs font-black flex items-center gap-2 uppercase tracking-[0.2em]">
                      <Settings2 className="size-4 text-blue-400" />
                      Plan Parameters
                    </CardTitle>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="size-6 text-white hover:bg-white/10"
                      onClick={() => setIsAssumptionsOpen(!isAssumptionsOpen)}
                    >
                      {isAssumptionsOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    </Button>
                  </div>
                </CardHeader>
                {isAssumptionsOpen && (
                  <CardContent className="pt-6 space-y-6 bg-white dark:bg-slate-950">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="aht" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Average AHT</Label>
                        <span className="text-[11px] font-black bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded text-primary">{assumptions.aht}s</span>
                      </div>
                      <Input id="aht" type="number" value={assumptions.aht} onChange={(e) => updateActiveScenario({...assumptions, aht: Number(e.target.value)})} className="h-10 font-bold focus-visible:ring-primary/20" />
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="shrinkage" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Total Shrinkage</Label>
                        <span className="text-[11px] font-black bg-rose-50 dark:bg-rose-900/20 px-2 py-1 rounded text-rose-600">{assumptions.shrinkage}%</span>
                      </div>
                      <Input id="shrinkage" type="number" value={assumptions.shrinkage} onChange={(e) => updateActiveScenario({...assumptions, shrinkage: Number(e.target.value)})} className="h-10 font-bold focus-visible:ring-rose-500/10" />
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="occupancy" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Max Occupancy</Label>
                        <span className="text-[11px] font-black bg-indigo-50 dark:bg-indigo-900/20 px-2 py-1 rounded text-indigo-600">{assumptions.occupancy}%</span>
                      </div>
                      <Input id="occupancy" type="number" value={assumptions.occupancy} onChange={(e) => updateActiveScenario({...assumptions, occupancy: Number(e.target.value)})} className="h-10 font-bold" />
                    </div>

                    <div className="space-y-3 border-t border-border pt-6 mt-6">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="growth" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Annual Growth</Label>
                        <Badge className="bg-emerald-500 font-black tracking-tight">+{assumptions.growthRate}%</Badge>
                      </div>
                      <Input id="growth" type="number" value={assumptions.growthRate} onChange={(e) => updateActiveScenario({...assumptions, growthRate: Number(e.target.value)})} className="h-10 font-bold border-emerald-200" />
                    </div>

                    <Button 
                      className="w-full h-11 font-black uppercase tracking-widest text-[10px] mt-4 shadow-lg shadow-primary/20"
                      onClick={() => updateActiveScenario(assumptions)}
                    >
                      <LayoutDashboard className="size-4 mr-2" />
                      Run Simulation
                    </Button>
                  </CardContent>
                )}
              </Card>

              <Card className="bg-gradient-to-br from-slate-900 to-slate-800 text-white border-none shadow-2xl">
                <CardHeader className="pb-2">
                  <CardTitle className="text-[10px] font-black flex items-center gap-2 uppercase tracking-[0.2em] text-blue-400">
                    <TrendingUp className="size-4" />
                    Modeling Insights
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6 pt-2">
                  <div className="space-y-2">
                    <p className="text-[9px] text-slate-400 uppercase font-black tracking-[0.15em]">Peak Seasonality</p>
                    <div className="flex items-end justify-between">
                      <p className="text-xs font-bold">December 2026</p>
                      <span className="text-[10px] font-black bg-white/10 px-2 py-0.5 rounded text-blue-300">MAX VOLUME</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-[9px] text-slate-400 uppercase font-black tracking-[0.15em]">Recruitment Need</p>
                    <p className="text-xs font-medium leading-relaxed">
                      To offset the <span className="text-rose-400 font-bold">-{Math.abs(kpis.staffingGap)} FTE</span> gap, you need <span className="text-emerald-400 font-bold">1 training class</span> of 10-12 agents by Q3.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
