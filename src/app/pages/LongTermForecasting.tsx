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
  isFuture: boolean;
  volume: number;
  actualSeries: number | null;
  forecastSeries: number | null;
  confidenceBand: [number, number] | null;
  understaffedRange: [number, number] | null;
  overstaffedRange: [number, number] | null;
  historicalVolume: number; // SDLY for comparison
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

const getTimeline = (startDateStr: string, monthsPast: number = 0, monthsFuture: number = 12): { month: string, year: string, isFuture: boolean }[] => {
  const start = new Date(startDateStr);
  const timeline = [];
  
  // Past months
  for (let i = monthsPast; i > 0; i--) {
    const d = new Date(start.getFullYear(), start.getMonth() - i, 1);
    timeline.push({
      month: MONTH_NAMES[d.getMonth()],
      year: d.getFullYear().toString(),
      isFuture: false
    });
  }
  
  // Future months
  for (let i = 0; i < monthsFuture; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    timeline.push({
      month: MONTH_NAMES[d.getMonth()],
      year: d.getFullYear().toString(),
      isFuture: true
    });
  }
  
  return timeline;
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

import { 
  calculateYoY, 
  calculateMovingAverage, 
  calculateLinearRegression, 
  calculateHoltWinters, 
  calculateDecomposition, 
  calculateARIMA,
  generateInsights,
  calculateHiringPlan
} from "./forecasting-logic";

const FORECAST_METHODS = [
  { key: "holtwinters", label: "Holt-Winters (Triple Exponential Smoothing)" },
  { key: "arima", label: "ARIMA (simplified version)" },
  { key: "decomposition", label: "Decomposition (Trend + Seasonality)" },
  { key: "ma", label: "Moving Average (baseline fallback)" },
  { key: "genesys", label: "Direct Genesys Sync" },
  { key: "yoy", label: "Year-over-Year Growth" },
  { key: "regression", label: "Linear Regression" }
];

export default function LongTermForecasting() {
  const [isAssumptionsOpen, setIsAssumptionsOpen] = useState(true);
  const [isSupplyOpen, setIsSupplyOpen] = useState(true);
  const [isFinancialsOpen, setIsFinancialsOpen] = useState(false);
  const [selectedScenarioId, setSelectedScenarioId] = useState("base");
  const [loading, setLoading] = useState(true);
  const [forecastMethod, setForecastMethod] = useState("holtwinters");
  
  // Forecasting Parameters State
  const [hwParams, setHwParams] = useState({ alpha: 0.3, beta: 0.1, gamma: 0.3, seasonLength: 12 });
  const [arimaParams, setArimaParams] = useState({ p: 1, d: 1, q: 1 });
  const [decompParams, setDecompParams] = useState({ trendStrength: 1.0, seasonalityStrength: 1.0 });

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
  const [historicalData, setHistoricalData] = useState<number[]>([]);
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

  const calculatedVolumes = useMemo(() => {
    if (historicalData.length === 0) return Array(12).fill(0);
    
    switch (forecastMethod) {
      case "yoy":
        return calculateYoY(historicalData, assumptions.growthRate);
      case "ma":
        return calculateMovingAverage(historicalData, 3);
      case "regression":
        return calculateLinearRegression(historicalData);
      case "holtwinters":
        return calculateHoltWinters(
          historicalData, 
          hwParams.alpha, 
          hwParams.beta, 
          hwParams.gamma, 
          hwParams.seasonLength
        );
      case "decomposition":
        return calculateDecomposition(
          historicalData, 
          decompParams.trendStrength, 
          decompParams.seasonalityStrength
        );
      case "arima":
        return calculateARIMA(
          historicalData, 
          arimaParams.p, 
          arimaParams.d, 
          arimaParams.q
        );
      case "genesys":
      default:
        return historicalData;
    }
  }, [forecastMethod, historicalData, assumptions.growthRate, hwParams, arimaParams, decompParams]);

  const handleRecalculate = () => {
    if (historicalData.length === 0) return;

    // Generate a 24-month timeline: 12 months past + 12 months future
    const timeline = getTimeline(assumptions.startDate, 12, 12);
    
    // Past: First 12 months of historicalData
    const actualsPast = historicalData.slice(0, 12);
    // Future SDLY Reference: Last 12 months of historicalData (which is Sameday Last Year for the future)
    const futureSdly = historicalData.slice(-12);

    const mappedData: ForecastData[] = timeline.map((time, idx) => {
      let volume = 0;
      let historicalVolume = 0;
      let isFuture = time.isFuture;

      if (!isFuture) {
        // Use actuals for past
        volume = actualsPast[idx] || 0;
        historicalVolume = volume; // Past volume is its own reference
      } else {
        // Use forecasted volumes for future
        const forecastIdx = idx - 12;
        volume = calculatedVolumes[forecastIdx] || 0;
        historicalVolume = futureSdly[forecastIdx] || 0;
      }

      // Supply logic only applies to future
      const supplyIdx = isFuture ? idx - 12 : -1;
      const supply = supplyIdx >= 0 ? supplyResults[supplyIdx] : null;
      const monthlyAHT = supply?.weightedAHT || assumptions.aht;
      const reqFTE = calculateFTE(volume, monthlyAHT, assumptions.shrinkage, assumptions.occupancy, assumptions.safetyMargin, assumptions.fteMonthlyHours);
      const availFTE = supply?.effectiveHeadcount ?? 0;

      // Series for visualization: 
      // actualSeries includes up to the first future month for connection
      // forecastSeries starts from the last past month for connection
      const actualSeries = idx <= 12 ? (idx === 12 ? (calculatedVolumes[0] || 0) : volume) : null;
      const forecastSeries = idx >= 11 ? (idx === 11 ? (actualsPast[11] || 0) : volume) : null;
      const confidenceBand: [number, number] | null = isFuture ? [Math.round(volume * 0.9), Math.round(volume * 1.1)] : null;

      // Calculate ranges for shading: 
      // understaffedRange: shades red when Req > Avail
      // overstaffedRange: shades green when Avail > Req
      const understaffedRange: [number, number] | null = isFuture ? [availFTE, Math.max(availFTE, reqFTE)] : null;
      const overstaffedRange: [number, number] | null = isFuture ? [reqFTE, Math.max(reqFTE, availFTE)] : null;

      return {
        month: time.month,
        year: time.year,
        isFuture,
        volume,
        actualSeries,
        forecastSeries,
        confidenceBand,
        understaffedRange,
        overstaffedRange,
        historicalVolume,
        aht: monthlyAHT,
        shrinkage: assumptions.shrinkage,
        requiredFTE: reqFTE,
        availableFTE: availFTE,
        headcount: supply?.headcount ?? 0,
        gap: calculateStaffingGap(reqFTE, availFTE),
      };
    });
    setForecastData(mappedData);
  };

  useEffect(() => {
    handleRecalculate();
  }, [calculatedVolumes, supplyResults, assumptions]);
  
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
          setHistoricalData(result.data);
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

  const insights = useMemo(() => generateInsights(forecastData), [forecastData]);
  const hiringPlan = useMemo(() => calculateHiringPlan(forecastData), [forecastData]);

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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {insights.length > 0 && (
                <Card className="border-primary/20 bg-primary/5 shadow-sm border-dashed">
                  <CardHeader className="py-3 px-6 border-b border-primary/10">
                    <CardTitle className="text-xs font-black flex items-center gap-2 uppercase tracking-widest text-primary">
                      <Info className="size-4" />
                      Key Planning Insights
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="py-4 px-6">
                    <ul className="space-y-3">
                      {insights.map((insight, idx) => {
                        const parts = insight.split(/(\d+(?:\.\d+)?%?)/);
                        return (
                          <li key={idx} className="flex items-start gap-2 text-[11px] font-medium text-slate-700 dark:text-slate-300">
                            <div className="mt-1.5 size-1.5 rounded-full bg-primary shrink-0" />
                            <span>
                              {parts.map((part, i) => 
                                /^\d+(?:\.\d+)?%?$/.test(part) ? <strong key={i} className="text-primary font-black">{part}</strong> : part
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {hiringPlan && (
                <Card className={`border-dashed shadow-sm transition-all ${hiringPlan.totalHires > 0 ? "border-amber-400 bg-amber-50/50 dark:bg-amber-950/10 ring-1 ring-amber-400/20" : "border-emerald-200 bg-emerald-50/30"}`}>
                  <CardHeader className="py-3 px-6 border-b border-amber-100 dark:border-amber-900/50 flex flex-row items-center justify-between">
                    <CardTitle className={`text-xs font-black flex items-center gap-2 uppercase tracking-widest ${hiringPlan.totalHires > 0 ? "text-amber-700 dark:text-amber-400" : "text-emerald-700"}`}>
                      <Users className="size-4" />
                      Hiring Strategy
                    </CardTitle>
                    {hiringPlan.totalHires > 0 && <Badge className="bg-amber-500 font-black text-[8px] animate-pulse">ACTION REQUIRED</Badge>}
                  </CardHeader>
                  <CardContent className="py-4 px-6">
                    <div className="space-y-4">
                      <p className="text-[11px] font-bold text-slate-800 dark:text-slate-200 leading-relaxed">
                        {hiringPlan.summary.split(/(\d+)/).map((part, i) => 
                          /^\d+$/.test(part) ? <strong key={i} className="text-amber-700 dark:text-amber-400 font-black text-xs">{part}</strong> : part
                        )}
                      </p>
                      {hiringPlan.totalHires > 0 && (
                        <div className="flex items-center gap-4 p-3 bg-amber-100/50 rounded-lg border border-amber-200/50">
                          <div>
                            <p className="text-[10px] font-bold text-amber-800 uppercase tracking-wider">Target</p>
                            <p className="text-lg font-black text-amber-900">+{hiringPlan.totalHires} <span className="text-[10px] font-bold text-amber-700">New Hires</span></p>
                          </div>
                          <div className="h-8 w-px bg-amber-200" />
                          <div>
                            <p className="text-[10px] font-bold text-amber-800 uppercase tracking-wider">Rate</p>
                            <p className="text-lg font-black text-amber-900">{hiringPlan.monthlyHires} <span className="text-[10px] font-bold text-amber-700">/ Month</span></p>
                          </div>
                          <div className="h-8 w-px bg-amber-200" />
                          <div>
                            <p className="text-[10px] font-bold text-amber-800 uppercase tracking-wider">Start</p>
                            <p className="text-lg font-black text-amber-900">{hiringPlan.startMonth}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
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
                        <Area 
                          yAxisId="right"
                          dataKey="understaffedRange" 
                          name="Staffing Risk (Shortage)"
                          stroke="none"
                          fill="#f43f5e" 
                          fillOpacity={0.15} 
                          isAnimationActive={false}
                        />
                        <Area 
                          yAxisId="right"
                          dataKey="overstaffedRange" 
                          name="Staffing Surplus"
                          stroke="none"
                          fill="#10b981" 
                          fillOpacity={0.1} 
                          isAnimationActive={false}
                        />
                        <Tooltip 
                          cursor={{ stroke: 'hsl(var(--primary))', strokeWidth: 1, strokeDasharray: '4 4' }}
                          content={({ active, payload, label }) => {
                            if (active && payload && payload.length) {
                              const data = payload[0].payload;
                              const gap = data.gap;
                              const status = gap < 0 ? "Understaffed" : "Overstaffed";
                              const statusColor = gap < 0 ? "text-rose-600" : "text-emerald-600";

                              return (
                                <div className="bg-white dark:bg-slate-900 border border-border/80 p-4 rounded-xl shadow-2xl min-w-[220px] backdrop-blur-md">
                                  <div className="flex items-center justify-between mb-3 border-b border-border pb-2">
                                    <p className="text-xs font-black uppercase tracking-widest text-slate-800 dark:text-slate-100">{label} {data.year}</p>
                                    {!data.isFuture ? (
                                      <Badge variant="secondary" className="text-[8px] h-4 font-black">ACTUAL</Badge>
                                    ) : (
                                      <Badge variant="outline" className="text-[8px] h-4 font-black border-primary/20 text-primary">FCST</Badge>
                                    )}
                                  </div>
                                  <div className="space-y-2">
                                    <div className="flex items-center justify-between gap-6">
                                      <span className="text-[10px] font-bold text-muted-foreground uppercase">Volume</span>
                                      <span className="text-[11px] font-black tabular-nums text-primary">{data.volume.toLocaleString()}</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-6">
                                      <span className="text-[10px] font-bold text-muted-foreground uppercase">Required FTE</span>
                                      <span className="text-[11px] font-black tabular-nums text-amber-600">{data.requiredFTE}</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-6">
                                      <span className="text-[10px] font-bold text-muted-foreground uppercase">Available FTE</span>
                                      <span className="text-[11px] font-black tabular-nums text-emerald-600">{data.availableFTE}</span>
                                    </div>
                                    
                                    <div className="pt-2 border-t border-border mt-1">
                                      <div className="flex items-center justify-between">
                                         <span className="text-[10px] font-black text-muted-foreground uppercase">{status}</span>
                                         <span className={`text-[11px] font-black tabular-nums ${statusColor}`}>
                                           {Math.abs(gap)} FTE
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
                          dataKey="confidenceBand" 
                          name="Confidence Band (±10%)"
                          stroke="none"
                          fill="hsl(var(--primary))" 
                          fillOpacity={0.05} 
                          isAnimationActive={false}
                        />
                        <Line 
                          yAxisId="left"
                          type="monotone" 
                          dataKey="actualSeries" 
                          name="Actual Volume"
                          stroke="hsl(var(--primary))" 
                          strokeWidth={4}
                          dot={{ r: 3, fill: 'hsl(var(--primary))' }}
                        />
                        <Line 
                          yAxisId="left"
                          type="monotone" 
                          dataKey="forecastSeries" 
                          name="Forecasted Volume"
                          stroke="hsl(var(--primary))" 
                          strokeWidth={4}
                          strokeDasharray="8 5"
                          dot={{ r: 3, fill: 'hsl(var(--background))', strokeWidth: 2, stroke: 'hsl(var(--primary))' }}
                        />
                        <Line 
                          yAxisId="left"
                          type="monotone" 
                          dataKey="historicalVolume" 
                          name="Historical Vol (SDLY)"
                          stroke="hsl(var(--muted-foreground))" 
                          strokeWidth={2}
                          strokeDasharray="5 5"
                          dot={false}
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
                        <TableRow key={idx} className={`group hover:bg-slate-50/50 dark:hover:bg-slate-900/50 transition-colors ${!row.isFuture ? "opacity-70 bg-slate-50/30" : ""}`}>
                          <TableCell className="font-bold text-sm pl-6 flex items-center gap-2">
                            {row.month} {row.year}
                            {!row.isFuture && <Badge variant="secondary" className="text-[8px] h-4 font-black">ACTUAL</Badge>}
                            {row.isFuture && <Badge variant="outline" className="text-[8px] h-4 font-black border-primary/20 text-primary">FCST</Badge>}
                          </TableCell>
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

                      {forecastMethod === 'holtwinters' && (
                        <div className="space-y-4 border-t border-border pt-6 mt-6">
                            <div className="flex items-center justify-between">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">HW Smoothing</Label>
                            <Badge className="bg-amber-500 font-black tracking-tight">Triple Exp</Badge>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-1">
                                <Label className="text-[9px] font-bold">Alpha (Level)</Label>
                                <Input type="number" step="0.1" min="0" max="1" value={hwParams.alpha} onChange={(e) => setHwParams({...hwParams, alpha: Number(e.target.value)})} className="h-8 text-xs" />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-[9px] font-bold">Beta (Trend)</Label>
                                <Input type="number" step="0.1" min="0" max="1" value={hwParams.beta} onChange={(e) => setHwParams({...hwParams, beta: Number(e.target.value)})} className="h-8 text-xs" />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-[9px] font-bold">Gamma (Season)</Label>
                                <Input type="number" step="0.1" min="0" max="1" value={hwParams.gamma} onChange={(e) => setHwParams({...hwParams, gamma: Number(e.target.value)})} className="h-8 text-xs" />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-[9px] font-bold">Season (Len)</Label>
                                <Input type="number" min="1" max="24" value={hwParams.seasonLength} onChange={(e) => setHwParams({...hwParams, seasonLength: Number(e.target.value)})} className="h-8 text-xs" />
                              </div>
                            </div>
                        </div>
                      )}

                      {forecastMethod === 'arima' && (
                        <div className="space-y-4 border-t border-border pt-6 mt-6">
                            <div className="flex items-center justify-between">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">ARIMA (Simplified)</Label>
                            <Badge className="bg-emerald-500 font-black tracking-tight">p d q</Badge>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                              <div className="space-y-1">
                                <Label className="text-[9px] font-bold">p (AR)</Label>
                                <Input type="number" min="0" max="12" value={arimaParams.p} onChange={(e) => setArimaParams({...arimaParams, p: Number(e.target.value)})} className="h-8 text-xs" />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-[9px] font-bold">d (Diff)</Label>
                                <Input type="number" min="0" max="2" value={arimaParams.d} onChange={(e) => setArimaParams({...arimaParams, d: Number(e.target.value)})} className="h-8 text-xs" />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-[9px] font-bold">q (MA)</Label>
                                <Input type="number" min="1" max="10" value={arimaParams.q} onChange={(e) => setArimaParams({...arimaParams, q: Number(e.target.value)})} className="h-8 text-xs" />
                              </div>
                            </div>
                        </div>
                      )}

                      {forecastMethod === 'decomposition' && (
                        <div className="space-y-4 border-t border-border pt-6 mt-6">
                            <div className="flex items-center justify-between">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Decomposition</Label>
                            <Badge className="bg-blue-500 font-black tracking-tight">Strengths</Badge>
                            </div>
                            <div className="space-y-3">
                              <div className="space-y-1">
                                <div className="flex justify-between">
                                  <Label className="text-[9px] font-bold">Trend Strength</Label>
                                  <span className="text-[10px] font-bold">{decompParams.trendStrength}x</span>
                                </div>
                                <Input type="number" step="0.1" min="0" max="3" value={decompParams.trendStrength} onChange={(e) => setDecompParams({...decompParams, trendStrength: Number(e.target.value)})} className="h-8 text-xs" />
                              </div>
                              <div className="space-y-1">
                                <div className="flex justify-between">
                                  <Label className="text-[9px] font-bold">Seasonality Strength</Label>
                                  <span className="text-[10px] font-bold">{decompParams.seasonalityStrength}x</span>
                                </div>
                                <Input type="number" step="0.1" min="0" max="3" value={decompParams.seasonalityStrength} onChange={(e) => setDecompParams({...decompParams, seasonalityStrength: Number(e.target.value)})} className="h-8 text-xs" />
                              </div>
                            </div>
                        </div>
                      )}

                      {forecastMethod === 'ma' && (
                        <div className="space-y-3 border-t border-border pt-6 mt-6">
                            <div className="flex items-center justify-between">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">MA Periods</Label>
                            <Badge className="bg-indigo-500 font-black tracking-tight">Last 3 Months</Badge>
                            </div>
                            <p className="text-[10px] text-muted-foreground italic">Moving average uses the most recent historical periods to project a baseline.</p>
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
