import React, { useState, useEffect, useMemo } from "react";
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
  Loader2,
  Briefcase,
  Info,
  ShieldAlert,
  Calendar,
  Wallet,
  Scale,
  Coins
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
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip";
import { toast } from "sonner";

// --- Data Models & Interfaces ---

export interface Assumptions {
  startDate: string; // YYYY-MM-DD
  aht: number;
  shrinkage: number;
  slTarget: number;
  occupancy: number;
  growthRate: number;
  safetyMargin: number; 
  // Financial & Labor Defs
  currency: string;
  annualSalary: number;
  onboardingCost: number;
  fteMonthlyHours: number;
}

export interface WorkforceSupplyInputs {
  startingHeadcount: number;
  tenuredAttritionRate: number;
  newHireAttritionProfile: number[]; 
  trainingYield: number;
  monthlyHiring: number;
  trainingMonths: number;
  nestingRamp: number[];         
  ahtRamp: number[];             
  shrinkage: number;             
}

export interface WorkforceSupplyResult {
  monthLabel: string;
  yearLabel: string;
  headcount: number;
  effectiveHeadcount: number;    
  weightedAHT: number;           
}

export interface ForecastData {
  month: string;
  year: string;
  volume: number;
  aht: number;         
  shrinkage: number;
  requiredFTE: number; 
  availableFTE: number; 
  headcount: number;
  gap: number;
}

export interface Scenario {
  id: string;
  name: string;
  assumptions: Assumptions;
  supplyInputs: WorkforceSupplyInputs;
}

export interface KPIData {
  totalVolume: number;
  avgAHT: number;
  requiredFTE: number;
  staffingGap: number;
  estimatedCost: number;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const CURRENCIES = [
  { code: "USD", symbol: "$", name: "US Dollar" },
  { code: "PHP", symbol: "₱", name: "Philippine Peso" },
  { code: "EUR", symbol: "€", name: "Euro" },
  { code: "GBP", symbol: "£", name: "British Pound" },
  { code: "AUD", symbol: "A$", name: "Australian Dollar" },
  { code: "CAD", symbol: "C$", name: "Canadian Dollar" },
  { code: "JPY", symbol: "¥", name: "Japanese Yen" },
  { code: "INR", symbol: "₹", name: "Indian Rupee" },
  { code: "SGD", symbol: "S$", name: "Singapore Dollar" }
];

const DEFAULT_ASSUMPTIONS: Assumptions = {
  startDate: "2026-01-01",
  aht: 300, 
  shrinkage: 25,
  slTarget: 80,
  occupancy: 85,
  growthRate: 5,
  safetyMargin: 5, 
  currency: "USD",
  annualSalary: 45000,
  onboardingCost: 5000,
  fteMonthlyHours: 166.67,
};

const DEFAULT_SUPPLY_INPUTS: WorkforceSupplyInputs = {
  startingHeadcount: 100,
  tenuredAttritionRate: 1.5,
  newHireAttritionProfile: [12.0, 8.0, 4.0], 
  trainingYield: 85,         
  monthlyHiring: 10,
  trainingMonths: 1,
  nestingRamp: [50, 75, 90],
  ahtRamp: [1.5, 1.25, 1.1], 
  shrinkage: 15,
};

// --- Helper Functions ---

const validateInput = (value: number, min: number = 0, max: number = Infinity): number => {
  return Math.max(min, Math.min(max, value));
};

const getTimeline = (startDateStr: string): { month: string, year: string }[] => {
  const start = new Date(startDateStr);
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    return {
      month: MONTH_NAMES[d.getMonth()],
      year: d.getFullYear().toString()
    };
  });
};

const formatCurrency = (amount: number, code: string) => {
  const currency = CURRENCIES.find(c => c.code === code) || CURRENCIES[0];
  if (amount >= 1000000) {
    return `${currency.symbol}${(amount / 1000000).toFixed(1)}M`;
  }
  return `${currency.symbol}${amount.toLocaleString()}`;
};

// --- Calculation Logic ---

export const calculateFTE = (
  volume: number,
  aht: number,
  shrinkage: number,
  targetOccupancy: number,
  safetyMargin: number,
  fteMonthlyHours: number
): number => {
  if (volume === 0) return 0;
  const workSecondsInMonth = fteMonthlyHours * 3600; 
  let achievableOccupancyCap = 0.90; 
  if (volume < 2000) achievableOccupancyCap = 0.65;
  else if (volume < 5000) achievableOccupancyCap = 0.75;
  else if (volume < 15000) achievableOccupancyCap = 0.82;
  else if (volume < 30000) achievableOccupancyCap = 0.86;

  const finalOccupancy = Math.min(targetOccupancy / 100, achievableOccupancyCap);
  const shrinkageFactor = 1 - (shrinkage / 100);
  if (finalOccupancy <= 0 || shrinkageFactor <= 0) return 9999.9;

  const workloadSeconds = volume * aht;
  const capacityPerFTE = workSecondsInMonth * finalOccupancy * shrinkageFactor;
  let baseFTE = workloadSeconds / capacityPerFTE;
  baseFTE = baseFTE * (1 + (safetyMargin / 100));
  return Number(baseFTE.toFixed(1));
};

export const calculateStaffingGap = (requiredFTE: number, availableFTE: number): number => {
  return Number((availableFTE - requiredFTE).toFixed(1));
};

export const calculateWorkforceSupply = (inputs: WorkforceSupplyInputs, baseAHT: number, startDate: string): WorkforceSupplyResult[] => {
  const results: WorkforceSupplyResult[] = [];
  const timeline = getTimeline(startDate);
  let cohorts = [inputs.startingHeadcount];

  for (let i = 0; i < 12; i++) {
    const { month, year } = timeline[i];
    cohorts = cohorts.map((size, ageIndex) => {
      let currentAttrRate = inputs.tenuredAttritionRate;
      if (ageIndex > 0) {
        const monthsInService = i - (ageIndex - 1);
        if (monthsInService >= 0 && monthsInService < inputs.newHireAttritionProfile.length) {
          currentAttrRate = inputs.newHireAttritionProfile[monthsInService];
        }
      }
      return size * (1 - (currentAttrRate / 100));
    });

    const successfulHires = inputs.monthlyHiring * (inputs.trainingYield / 100);
    cohorts.push(successfulHires);

    let totalHeadcount = 0;
    let totalEffective = 0;
    let totalWeightedAHTSeconds = 0;

    cohorts.forEach((size, ageIndex) => {
      totalHeadcount += size;
      if (ageIndex === 0) {
        totalEffective += size;
        totalWeightedAHTSeconds += size * baseAHT;
      } else {
        const monthsSinceHire = i - (ageIndex - 1);
        if (monthsSinceHire < inputs.trainingMonths) {
          totalEffective += 0;
          totalWeightedAHTSeconds += 0;
        } else {
          const nestingMonthIndex = monthsSinceHire - inputs.trainingMonths;
          const rampLevel = inputs.nestingRamp[nestingMonthIndex] ?? 100;
          const timingCoefficient = (monthsSinceHire === inputs.trainingMonths) ? 0.5 : 1.0;
          totalEffective += size * (rampLevel / 100) * timingCoefficient;
          const ahtMult = inputs.ahtRamp[nestingMonthIndex] ?? 1.0;
          totalWeightedAHTSeconds += size * (baseAHT * ahtMult);
        }
      }
    });

    const activeStaffCount = cohorts.reduce((acc, size, ageIndex) => {
       const monthsSinceHire = i - (ageIndex - 1);
       return (ageIndex === 0 || monthsSinceHire >= inputs.trainingMonths) ? acc + size : acc;
    }, 0);

    const weightedAHT = activeStaffCount > 0 ? (totalWeightedAHTSeconds / activeStaffCount) : baseAHT;

    results.push({
      monthLabel: month,
      yearLabel: year,
      headcount: Math.round(totalHeadcount),
      effectiveHeadcount: Number(totalEffective.toFixed(1)),
      weightedAHT: Math.round(weightedAHT)
    });
  }

  return results;
};

const FORECAST_METHODS = [
  { key: "genesys", label: "Historical Genesys Data" },
  { key: "yoy", label: "Year-over-Year Growth" }
];

export default function LongTermForecasting() {
  const [isAssumptionsOpen, setIsAssumptionsOpen] = useState(true);
  const [isSupplyOpen, setIsSupplyOpen] = useState(true);
  const [isFinancialsOpen, setIsFinancialsOpen] = useState(false);
  const [selectedScenarioId, setSelectedScenarioId] = useState("base");
  const [loading, setLoading] = useState(true);
  const [forecastMethod, setForecastMethod] = useState("genesys");

  const [scenarios, setScenarios] = useState<Record<string, Scenario>>({
    "base": {
      id: "base",
      name: "Base Case (Steady)",
      assumptions: DEFAULT_ASSUMPTIONS,
      supplyInputs: DEFAULT_SUPPLY_INPUTS
    },
    "scenario-a": {
      id: "scenario-a",
      name: "Scenario A (High Growth)",
      assumptions: { ...DEFAULT_ASSUMPTIONS, growthRate: 15 },
      supplyInputs: { ...DEFAULT_SUPPLY_INPUTS, monthlyHiring: 20, newHireAttritionProfile: [15, 10, 5] }
    },
    "scenario-b": {
      id: "scenario-b",
      name: "Scenario B (Efficiency)",
      assumptions: { ...DEFAULT_ASSUMPTIONS, occupancy: 90, safetyMargin: 3 },
      supplyInputs: { ...DEFAULT_SUPPLY_INPUTS, tenuredAttritionRate: 1.0, trainingYield: 95 }
    }
  });

  const [assumptions, setAssumptions] = useState<Assumptions>(DEFAULT_ASSUMPTIONS);
  const [supplyInputs, setSupplyInputs] = useState<WorkforceSupplyInputs>(DEFAULT_SUPPLY_INPUTS);
  const [forecastData, setForecastData] = useState<ForecastData[]>([]);

  const activeScenario = scenarios[selectedScenarioId];

  const updateActiveScenario = (updatedAssumptions: Assumptions, updatedSupplyInputs: WorkforceSupplyInputs) => {
    setScenarios(prev => ({
      ...prev,
      [selectedScenarioId]: {
        ...prev[selectedScenarioId],
        assumptions: updatedAssumptions,
        supplyInputs: updatedSupplyInputs,
      }
    }));
  };

  useEffect(() => {
    if (activeScenario) {
      setAssumptions(activeScenario.assumptions);
      setSupplyInputs(activeScenario.supplyInputs);
    }
  }, [selectedScenarioId, scenarios]);

  const handleSaveScenario = () => {
    updateActiveScenario(assumptions, supplyInputs);
    toast.success("Scenario saved successfully!");
  };

  const handleNewScenario = () => {
    const id = `scenario-${Date.now()}`;
    const name = `New Scenario ${Object.keys(scenarios).length + 1}`;
    const newScenario: Scenario = {
      id,
      name,
      assumptions: { ...assumptions },
      supplyInputs: { ...supplyInputs }
    };
    setScenarios(prev => ({ ...prev, [id]: newScenario }));
    setSelectedScenarioId(id);
    toast.success("New scenario created!");
  };

  const supplyResults = useMemo(() => {
    return calculateWorkforceSupply(supplyInputs, assumptions.aht, assumptions.startDate);
  }, [supplyInputs, assumptions.aht, assumptions.startDate]);

  const handleRecalculate = () => {
    setForecastData(prev => prev.map((d, i) => {
      const supply = supplyResults[i];
      const monthlyAHT = supply?.weightedAHT || assumptions.aht;
      const reqFTE = calculateFTE(d.volume, monthlyAHT, assumptions.shrinkage, assumptions.occupancy, assumptions.safetyMargin, assumptions.fteMonthlyHours);
      const availFTE = supply?.effectiveHeadcount ?? 0;
      
      return {
        ...d,
        month: supply?.monthLabel || d.month,
        year: supply?.yearLabel || d.year,
        aht: monthlyAHT,
        shrinkage: assumptions.shrinkage,
        requiredFTE: reqFTE,
        availableFTE: availFTE,
        headcount: supply?.headcount ?? 0,
        gap: calculateStaffingGap(reqFTE, availFTE)
      };
    }));
  };

  useEffect(() => {
    if (forecastData.length > 0) {
      handleRecalculate();
    }
  }, [assumptions, supplyResults]);
  
  useEffect(() => {
    const fetchMockData = async () => {
      setLoading(true);
      try {
        const response = await fetch("http://localhost:5000/api/genesys/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            queueId: "mock-queue-id",
            interval: `${assumptions.startDate}/2030-12-31`
          }),
        });
        const result = await response.json();
        
        if (result.success && Array.isArray(result.data)) {
          const timeline = getTimeline(assumptions.startDate);
          const mappedData: ForecastData[] = timeline.map(({ month, year }, idx) => {
            const volume = result.data[idx] || 0;
            const supply = supplyResults[idx];
            const monthlyAHT = supply?.weightedAHT || assumptions.aht;
            const reqFTE = calculateFTE(volume, monthlyAHT, assumptions.shrinkage, assumptions.occupancy, assumptions.safetyMargin, assumptions.fteMonthlyHours);
            const availFTE = supply?.effectiveHeadcount ?? 0;

            return {
              month,
              year,
              volume,
              aht: monthlyAHT,
              shrinkage: assumptions.shrinkage,
              requiredFTE: reqFTE,
              availableFTE: availFTE,
              headcount: supply?.headcount ?? 0,
              gap: calculateStaffingGap(reqFTE, availFTE),
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
  }, [assumptions.startDate]);

  const kpis: KPIData = {
    totalVolume: forecastData.reduce((sum, d) => sum + d.volume, 0),
    avgAHT: forecastData.length > 0 ? Math.round(forecastData.reduce((sum, d) => sum + d.aht, 0) / forecastData.length) : 0,
    requiredFTE: forecastData.length > 0 ? Number((forecastData.reduce((sum, d) => sum + d.requiredFTE, 0) / forecastData.length).toFixed(1)) : 0,
    staffingGap: forecastData.length > 0 ? Number((forecastData.reduce((sum, d) => sum + d.gap, 0) / forecastData.length).toFixed(1)) : 0,
    estimatedCost: forecastData.length > 0 ? Number(
      forecastData.reduce((total, d) => {
        const monthlyPayroll = d.headcount * (assumptions.annualSalary / 12);
        const monthlyHiringTax = supplyInputs.monthlyHiring * assumptions.onboardingCost;
        return total + monthlyPayroll + monthlyHiringTax;
      }, 0).toFixed(0)
    ) : 0,
  };

  const activeCurrency = CURRENCIES.find(c => c.code === assumptions.currency) || CURRENCIES[0];

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
    <TooltipProvider>
      <PageLayout title="Long-Term Forecasting">
        <div className="flex flex-col gap-8 pb-12">
          
          <div className="sticky top-0 z-30 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 -mx-4 px-4 py-4 space-y-4 border-b border-border shadow-sm mb-2 transition-all">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="flex flex-col gap-1">
                  <Label className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">Active Planning Scenario</Label>
                  <Select value={selectedScenarioId} onValueChange={setSelectedScenarioId}>
                    <SelectTrigger className="w-[220px] h-10 border-primary/20 bg-primary/5 font-bold text-primary focus:ring-primary/20">
                      <SelectValue placeholder="Select Scenario" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.values(scenarios).map(s => (
                        <SelectItem key={s.id} value={s.id} className="font-medium">{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button variant="outline" size="sm" className="h-10 mt-5 gap-2 font-semibold border-dashed hover:border-primary hover:text-primary transition-all" onClick={handleNewScenario}>
                  <Plus className="size-4" />
                  New Scenario
                </Button>
              </div>
              <div className="flex items-center gap-3 mt-5">
                <Button variant="ghost" size="sm" className="h-10 gap-2 text-muted-foreground hover:text-foreground">
                  <Filter className="size-4" />
                  Filters
                </Button>
                <Button variant="default" size="sm" className="h-10 gap-2 px-6 font-bold shadow-lg shadow-primary/20" onClick={handleSaveScenario}>
                  <Save className="size-4" />
                  Save Scenario
                </Button>
              </div>
            </div>

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
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">W. Avg AHT</p>
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
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Req. HC</p>
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
                    <h3 className="text-lg font-black tracking-tight">{formatCurrency(kpis.estimatedCost, assumptions.currency)}</h3>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            <div className="lg:col-span-3 space-y-8">
              <Card className="border border-border/50 shadow-lg shadow-slate-200/50 dark:shadow-none overflow-hidden">
                <CardHeader className="bg-slate-50/50 dark:bg-slate-900/50 border-b border-border/50 flex flex-row items-center justify-between py-4">
                  <div>
                    <CardTitle className="text-base font-black flex items-center gap-2">
                      <LayoutDashboard className="size-4 text-primary" />
                      Defensible Capacity Plan
                    </CardTitle>
                    <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Gross Requirements vs. Available Headcount</p>
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
                                    <p className="text-xs font-black uppercase tracking-widest text-slate-800 dark:text-slate-100">{label} {payload[0]?.payload?.year}</p>
                                    <Badge variant="outline" className="text-[9px] font-black">{selectedScenarioId.toUpperCase()}</Badge>
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
                          name="Req. HC (Gross)"
                          stroke="#f59e0b" 
                          strokeWidth={4}
                          dot={{ r: 3, fill: 'hsl(var(--background))', strokeWidth: 2, stroke: '#f59e0b' }}
                          activeDot={{ r: 6, strokeWidth: 0 }}
                        />
                        <Line 
                          yAxisId="right"
                          type="monotone" 
                          dataKey="availableFTE" 
                          name="Avail. HC (Gross)"
                          stroke="#10b981" 
                          strokeWidth={3}
                          strokeDasharray="6 4"
                          dot={{ r: 2, fill: '#10b981' }}
                        />
                        <Line 
                          yAxisId="right"
                          type="monotone" 
                          dataKey="headcount" 
                          name="Total Payroll HC"
                          stroke="#6366f1" 
                          strokeWidth={2}
                          strokeDasharray="3 3"
                          dot={false}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card className="border border-border/50 shadow-md">
                <CardHeader className="flex flex-row items-center justify-between py-4 border-b border-border/50 bg-slate-50/30">
                  <div>
                    <CardTitle className="text-base font-black uppercase tracking-widest">Statistical Breakdown</CardTitle>
                  </div>
                  <Button variant="ghost" size="sm" className="h-8 gap-2 text-xs font-black uppercase tracking-widest text-muted-foreground">
                    <TableIcon className="size-3" />
                    Export Data
                  </Button>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader className="bg-slate-50/80 dark:bg-slate-900/80">
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="w-[140px] text-xs font-black uppercase tracking-widest pl-6">Timeline</TableHead>
                        <TableHead className="text-right text-xs font-black uppercase tracking-widest">Proj Vol</TableHead>
                        <TableHead className="text-right text-xs font-black uppercase tracking-widest">Weighted AHT</TableHead>
                        <TableHead className="text-right text-xs font-black uppercase tracking-widest">Req. HC</TableHead>
                        <TableHead className="text-right text-xs font-black uppercase tracking-widest">Avail. HC</TableHead>
                        <TableHead className="text-right text-xs font-black uppercase tracking-widest pr-6">Gap Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {forecastData.map((row, idx) => (
                        <TableRow key={idx} className="group hover:bg-slate-50/50 dark:hover:bg-slate-900/50 transition-colors">
                          <TableCell className="font-bold text-sm pl-6">{row.month} {row.year}</TableCell>
                          <TableCell className="text-right font-mono text-sm font-bold text-primary">{row.volume.toLocaleString()}</TableCell>
                          <TableCell className="text-right font-mono text-sm text-indigo-600">{row.aht}s</TableCell>
                          <TableCell className="text-right font-mono text-sm font-bold text-amber-600">{row.requiredFTE}</TableCell>
                          <TableCell className="text-right font-mono text-sm text-emerald-600 font-bold">{row.availableFTE}</TableCell>
                          <TableCell className="text-right pr-6">
                            <Badge 
                              variant={row.gap >= 0 ? "default" : "destructive"} 
                              className={`font-black text-xs tracking-tight min-w-[60px] justify-center ${row.gap >= 0 ? "bg-emerald-500 hover:bg-emerald-600 border-none" : ""}`}
                            >
                              {row.gap > 0 ? `+${row.gap}` : row.gap}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>            </div>

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
                          <Label htmlFor="startDate" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Planning Start Date</Label>
                          <Calendar className="size-3.5 text-primary" />
                        </div>
                        <Input id="startDate" type="date" value={assumptions.startDate} onChange={(e) => setAssumptions({...assumptions, startDate: e.target.value})} className="h-10 font-bold" />
                      </div>

                      <div className="space-y-3 border-t border-border pt-4">
                         <div className="flex items-center justify-between">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Forecast Method</Label>
                            <TrendingUp className="size-3.5 text-primary" />
                         </div>
                         <Select value={forecastMethod} onValueChange={setForecastMethod}>
                            <SelectTrigger className="h-10 font-bold">
                                <SelectValue placeholder="Choose forecast method..." />
                            </SelectTrigger>
                            <SelectContent>
                                {FORECAST_METHODS.map(m => (
                                    <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>
                                ))}
                            </SelectContent>
                         </Select>
                      </div>
                      
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="aht" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Base Tenured AHT</Label>
                          <span className="text-[11px] font-black bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded text-primary">{assumptions.aht}s</span>
                        </div>
                        <Input id="aht" type="number" value={assumptions.aht} onChange={(e) => setAssumptions({...assumptions, aht: validateInput(Number(e.target.value))})} className="h-10 font-bold focus-visible:ring-primary/20" />
                      </div>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1">
                            <Label htmlFor="shrinkage" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Total Shrinkage</Label>
                            <UITooltip>
                              <TooltipTrigger asChild>
                                <Info className="size-3 text-muted-foreground cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="text-xs">Non-productive time (leaves, breaks, etc.)</p>
                              </TooltipContent>
                            </UITooltip>
                          </div>
                          <span className="text-[11px] font-black bg-rose-50 dark:bg-rose-900/20 px-2 py-1 rounded text-rose-600">{assumptions.shrinkage}%</span>
                        </div>
                        <Input id="shrinkage" type="number" value={assumptions.shrinkage} onChange={(e) => setAssumptions({...assumptions, shrinkage: validateInput(Number(e.target.value), 0, 100)})} className="h-10 font-bold focus-visible:ring-rose-500/10" />
                      </div>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="occupancy" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Max Occupancy</Label>
                          <span className="text-[11px] font-black bg-indigo-50 dark:bg-indigo-900/20 px-2 py-1 rounded text-indigo-600">{assumptions.occupancy}%</span>
                        </div>
                        <Input id="occupancy" type="number" value={assumptions.occupancy} onChange={(e) => setAssumptions({...assumptions, occupancy: validateInput(Number(e.target.value), 0, 100)})} className="h-10 font-bold" />
                      </div>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1">
                            <Label htmlFor="safetyMargin" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Safety Margin (%)</Label>
                            <UITooltip>
                              <TooltipTrigger asChild><ShieldAlert className="size-3 text-muted-foreground cursor-help" /></TooltipTrigger>
                              <TooltipContent><p className="text-xs">Staffing buffer for unplanned volume/AHT variance</p></TooltipContent>
                            </UITooltip>
                          </div>
                          <Badge variant="outline" className="font-black text-primary border-primary/20">{assumptions.safetyMargin}%</Badge>
                        </div>
                        <Input id="safetyMargin" type="number" value={assumptions.safetyMargin} onChange={(e) => setAssumptions({...assumptions, safetyMargin: validateInput(Number(e.target.value), 0, 20)})} className="h-10 font-bold" />
                      </div>

                      {forecastMethod === 'yoy' && (
                        <div className="space-y-3 border-t border-border pt-6 mt-6">
                            <div className="flex items-center justify-between">
                            <Label htmlFor="growth" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">YoY Growth Rate</Label>
                            <Badge className="bg-emerald-500 font-black tracking-tight">+{assumptions.growthRate}%</Badge>
                            </div>
                            <Input id="growth" type="number" value={assumptions.growthRate} onChange={(e) => setAssumptions({...assumptions, growthRate: validateInput(Number(e.target.value))})} className="h-10 font-bold border-emerald-200" />
                        </div>
                      )}

                      <Button 
                        className="w-full h-11 font-black uppercase tracking-widest text-[10px] mt-4 shadow-lg shadow-primary/20"
                        onClick={() => {
                            toast.info("Recalculating forecast and staffing...", { duration: 1500 })
                            // No need to call a function, the useEffects handle it
                        }}
                      >
                        <LayoutDashboard className="size-4 mr-2" />
                        Recalculate
                      </Button>
                    </CardContent>
                  )}
                </Card>

                <Card className="border border-border/80 shadow-xl overflow-hidden">
                  <CardHeader className="border-b border-border/50 bg-emerald-900 text-white py-4">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-xs font-black flex items-center gap-2 uppercase tracking-[0.2em]">
                        <Wallet className="size-4 text-emerald-400" />
                        Budget & Labor Definitions
                      </CardTitle>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="size-6 text-white hover:bg-white/10"
                        onClick={() => setIsFinancialsOpen(!isFinancialsOpen)}
                      >
                        {isFinancialsOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                      </Button>
                    </div>
                  </CardHeader>
                  {isFinancialsOpen && (
                    <CardContent className="pt-6 space-y-4 bg-white dark:bg-slate-950">
                      <div className="space-y-2">
                        <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Planning Currency</Label>
                        <Select value={assumptions.currency} onValueChange={(val) => setAssumptions({...assumptions, currency: val})}>
                          <SelectTrigger className="h-9 font-bold bg-slate-50">
                            <SelectValue placeholder="Currency" />
                          </SelectTrigger>
                          <SelectContent>
                            {CURRENCIES.map(c => (
                              <SelectItem key={c.code} value={c.code} className="font-medium">
                                {c.code} ({c.symbol}) - {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Avg Annual Salary ({activeCurrency.symbol})</Label>
                        <Input type="number" value={assumptions.annualSalary} onChange={(e) => setAssumptions({...assumptions, annualSalary: validateInput(Number(e.target.value))})} className="h-9 font-bold" />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Onboarding Cost/Hire ({activeCurrency.symbol})</Label>
                        <Input type="number" value={assumptions.onboardingCost} onChange={(e) => setAssumptions({...assumptions, onboardingCost: validateInput(Number(e.target.value))})} className="h-9 font-bold" />
                      </div>
                      <div className="space-y-2 pt-2 border-t border-border">
                        <div className="flex items-center gap-1">
                          <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">FTE Monthly Hours</Label>
                          <UITooltip>
                            <TooltipTrigger asChild><Scale className="size-3 text-muted-foreground" /></TooltipTrigger>
                            <TooltipContent><p className="text-xs">Work base for 1 FTE (e.g. 166.67 for 20.83 days)</p></TooltipContent>
                          </UITooltip>
                        </div>
                        <Input type="number" step="0.01" value={assumptions.fteMonthlyHours} onChange={(e) => setAssumptions({...assumptions, fteMonthlyHours: validateInput(Number(e.target.value), 1)})} className="h-9 font-bold bg-slate-50" />
                      </div>
                    </CardContent>
                  )}
                </Card>

                <Card className="border border-border/80 shadow-xl overflow-hidden">
                  <CardHeader className="border-b border-border/50 bg-indigo-900 text-white py-4">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-xs font-black flex items-center gap-2 uppercase tracking-[0.2em]">
                        <Briefcase className="size-4 text-indigo-400" />
                        Workforce Supply Factors
                      </CardTitle>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="size-6 text-white hover:bg-white/10"
                        onClick={() => setIsSupplyOpen(!isSupplyOpen)}
                      >
                        {isSupplyOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                      </Button>
                    </div>
                  </CardHeader>
                  {isSupplyOpen && (
                    <CardContent className="pt-6 space-y-4 bg-white dark:bg-slate-950">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Starting Headcount</Label>
                          <Input type="number" value={supplyInputs.startingHeadcount} onChange={(e) => setSupplyInputs({...supplyInputs, startingHeadcount: validateInput(Number(e.target.value))})} className="h-9 font-bold" />
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center gap-1">
                            <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Training Yield (%)</Label>
                            <UITooltip>
                              <TooltipTrigger asChild><Info className="size-2.5 text-muted-foreground" /></TooltipTrigger>
                              <TooltipContent><p className="text-xs">% of hires who graduate to the floor</p></TooltipContent>
                            </UITooltip>
                          </div>
                          <Input type="number" value={supplyInputs.trainingYield} onChange={(e) => setSupplyInputs({...supplyInputs, trainingYield: validateInput(Number(e.target.value), 0, 100)})} className="h-9 font-bold" />
                        </div>
                      </div>

                      <div className="space-y-3 pt-2 border-t border-border">
                        <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Infant Mortality (Attrition M1-M3)</Label>
                        <div className="grid grid-cols-3 gap-3">
                          {supplyInputs.newHireAttritionProfile.map((val, idx) => (
                            <div key={idx} className="space-y-1">
                              <Label className="text-[8px] font-bold text-muted-foreground uppercase">Month {idx + 1} %</Label>
                              <Input type="number" value={val} onChange={(e) => {
                                const newProfile = [...supplyInputs.newHireAttritionProfile];
                                newProfile[idx] = validateInput(Number(e.target.value), 0, 100);
                                setSupplyInputs({...supplyInputs, newHireAttritionProfile: newProfile});
                              }} className="h-8 text-xs font-bold border-rose-100" />
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border">
                        <div className="space-y-2">
                          <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Monthly Hiring</Label>
                          <Input type="number" value={supplyInputs.monthlyHiring} onChange={(e) => setSupplyInputs({...supplyInputs, monthlyHiring: validateInput(Number(e.target.value))})} className="h-9 font-bold" />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Training Duration (Months)</Label>
                          <Input type="number" value={supplyInputs.trainingMonths} onChange={(e) => setSupplyInputs({...supplyInputs, trainingMonths: validateInput(Number(e.target.value), 0, 12)})} className="h-9 font-bold" />
                        </div>
                      </div>

                      <div className="space-y-3 pt-2 border-t border-border">
                        <Label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">AHT Learning Multipliers</Label>
                        <div className="grid grid-cols-3 gap-3">
                          {supplyInputs.ahtRamp.map((val, idx) => (
                            <div key={idx} className="space-y-1">
                              <Label className="text-[8px] font-bold text-muted-foreground uppercase">M{idx + 1} AHT x</Label>
                              <Input type="number" step="0.1" value={val} onChange={(e) => {
                                const newRamp = [...supplyInputs.ahtRamp];
                                newRamp[idx] = validateInput(Number(e.target.value), 1);
                                setSupplyInputs({...supplyInputs, ahtRamp: newRamp});
                              }} className="h-8 text-xs font-bold bg-amber-50" />
                            </div>
                          ))}
                        </div>
                      </div>
                    </CardContent>
                  )}
                </Card>

                <Card className="bg-gradient-to-br from-slate-900 to-slate-800 text-white border-none shadow-2xl">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-[10px] font-black flex items-center gap-2 uppercase tracking-[0.2em] text-blue-400">
                      <TrendingUp className="size-4" />
                      WFM Insights
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6 pt-2">
                    <div className="space-y-2">
                      <p className="text-[9px] text-slate-400 uppercase font-black tracking-[0.15em]">Capacity Risk Warning</p>
                      <p className="text-xs font-medium leading-relaxed">
                        Achievable occupancy is capped at <span className="text-amber-300 font-bold">{(kpis.totalVolume < 5000 ? 75 : 86)}%</span> for your current volume profile. Reducing target occupancy below the cap improves SL predictability.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </PageLayout>
    </TooltipProvider>
  );
}
