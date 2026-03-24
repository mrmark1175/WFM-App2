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
  Trash2,
  Layers
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
import { Switch } from "../components/ui/switch";
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip";
import { toast } from "sonner";
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

// --- Data Models & Interfaces ---

export interface ChannelSettings {
  isActive: boolean;
  aht: number;
  occupancy: number;
  concurrency?: number; // For chat
  // ── NEW: per-channel SLA targets ──────────────────────────────────────────
  slaTarget: number;   // e.g. 80  → 80% of contacts answered within asaTarget
  asaTarget: number;   // seconds. Voice/Chat: e.g. 20 s. Email: e.g. 14400 s (4 h)
}

export interface Assumptions {
  startDate: string; // YYYY-MM-DD
  shrinkage: number;
  slTarget: number;
  growthRate: number;
  safetyMargin: number; 
  blendingEfficiency: number; // New: Blending Efficiency
  
  channels: {
    voice: ChannelSettings;
    email: ChannelSettings;
    chat: ChannelSettings;
  };

  // Financial & Labor Defs
  currency: string;
  annualSalary: number;
  onboardingCost: number;
  fteMonthlyHours: number;
  // Manual Entry Support
  useManualVolume: boolean;
  manualHistoricalData: number[];
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
  availableFTE: number | null; 
  headcount: number | null;
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
  shrinkage: 25,
  slTarget: 80,
  growthRate: 5,
  safetyMargin: 5, 
  blendingEfficiency: 5, // Default 5% blending gain
  channels: {
    // slaTarget = % contacts answered within asaTarget seconds
    voice: { isActive: true,  aht: 300, occupancy: 85, slaTarget: 80, asaTarget: 20   },
    email: { isActive: false, aht: 600, occupancy: 100, slaTarget: 90, asaTarget: 14400 }, // 4 h
    chat:  { isActive: false, aht: 450, occupancy: 85, concurrency: 2, slaTarget: 80, asaTarget: 30 }
  },
  currency: "USD",
  annualSalary: 45000,
  onboardingCost: 5000,
  fteMonthlyHours: 166.67,
  useManualVolume: false,
  manualHistoricalData: new Array(12).fill(10000),
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

const FORECAST_METHODS = [
  { key: "holtwinters", label: "Holt-Winters (Triple Exponential Smoothing)" },
  { key: "arima", label: "ARIMA (simplified version)" },
  { key: "decomposition", label: "Decomposition (Trend + Seasonality)" },
  { key: "ma", label: "Moving Average (baseline fallback)" },
  { key: "genesys", label: "Direct Genesys Sync" },
  { key: "yoy", label: "Year-over-Year Growth" },
  { key: "regression", label: "Linear Regression" }
];

// --- Helper Functions ---

const validateInput = (value: number, min: number = 0, max: number = Infinity): number => {
  return Math.max(min, Math.min(max, value));
};

const getTimeline = (startDateStr: string, monthsPast: number = 0, monthsFuture: number = 12): { month: string, year: string, isFuture: boolean }[] => {
  const start = new Date(startDateStr);
  const timeline: { month: string, year: string, isFuture: boolean }[] = [];
  
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

// --- Erlang C Engine ---
// ─────────────────────────────────────────────────────────────────────────────
// Erlang C gives the probability that an arriving contact must wait in queue
// before an agent is available.
//
//   A  = traffic intensity in Erlangs = (contacts_per_interval × AHT) / interval_duration
//   N  = number of agents (integer ≥ ceil(A)+1 for a stable system)
//
//   P(C) = [A^N / N! × N/(N-A)]
//          ─────────────────────────────────────────────────────
//          Σ_{k=0}^{N-1}(A^k / k!) + [A^N / N! × N/(N-A)]
//
//   P(wait > t) = P(C) × exp(−(N−A) × t / AHT)
//
//   SLA        = 1 − P(wait > ASA)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns Erlang-C probability P(C): probability an arriving contact waits.
 * Uses an iterative approach to avoid factorial overflow for large N.
 */
const erlangCProbability = (N: number, A: number): number => {
  if (N <= 0 || A <= 0) return 0;
  if (A >= N) return 1; // Unstable – traffic exceeds capacity

  // Build running sum  Σ_{k=0}^{N-1} A^k / k!  iteratively
  let term = 1;        // A^0 / 0! = 1
  let sumTerms = 1;
  for (let k = 1; k <= N - 1; k++) {
    term = (term * A) / k;
    sumTerms += term;
  }
  // Last term for k = N: (term × A / N) × N / (N − A)
  const lastTerm = ((term * A) / N) * (N / (N - A));
  return lastTerm / (sumTerms + lastTerm);
};

/**
 * Returns the service level (0–1) achievable with N agents
 * given traffic A, target answer speed asaSeconds, and AHT in seconds.
 */
const getSLAFromAgents = (
  N: number,
  A: number,
  asaSeconds: number,
  ahtSeconds: number
): number => {
  if (N <= 0 || A <= 0) return 1;
  if (A >= N) return 0; // System unstable
  const pc = erlangCProbability(N, A);
  const probWaitExceedsASA = pc * Math.exp(-(N - A) * asaSeconds / ahtSeconds);
  return 1 - probWaitExceedsASA;
};

/**
 * Finds the minimum integer number of agents required so that
 *   SLA(N, A, ASA) ≥ targetSLA   (targetSLA expressed as 0–1)
 *
 * @param contactsPerInterval  Average contacts arriving in one interval
 * @param ahtSeconds           Average Handle Time in seconds
 * @param asaSeconds           Target speed-of-answer in seconds
 * @param targetSLA            Required service level as a fraction (e.g. 0.80)
 * @param intervalSeconds      Length of the planning interval in seconds (default 1800 = 30 min)
 */
const findMinAgentsForSLA = (
  contactsPerInterval: number,
  ahtSeconds: number,
  asaSeconds: number,
  targetSLA: number,
  intervalSeconds: number = 1800
): number => {
  if (contactsPerInterval <= 0) return 0;

  // Traffic intensity A (Erlangs) for this interval
  const A = (contactsPerInterval * ahtSeconds) / intervalSeconds;

  if (A <= 0) return 0;

  // Minimum stable N is ceil(A) + 1
  let N = Math.ceil(A) + 1;
  const maxSearch = Math.ceil(A) + 500; // Safety cap

  while (N <= maxSearch) {
    if (getSLAFromAgents(N, A, asaSeconds, ahtSeconds) >= targetSLA) {
      return N;
    }
    N++;
  }

  return maxSearch; // Fallback – should not be reached in normal operation
};

// --- Calculation Logic ---

export const calculateFTE = (
  volume: number,
  channelSettings: ChannelSettings,
  shrinkage: number,
  safetyMargin: number,
  fteMonthlyHours: number
): number => {
  if (volume === 0 || !channelSettings.isActive) return 0;

  const shrinkageFactor = 1 - (shrinkage / 100);
  if (shrinkageFactor <= 0) return 9999.9;

  // Resolve SLA parameters (fall back to legacy global values if absent)
  const slaTarget  = ((channelSettings.slaTarget  ?? 80)  ) / 100; // fraction
  const asaTarget  = channelSettings.asaTarget  ?? 20;              // seconds

  // ─── Email (asynchronous) ──────────────────────────────────────────────────
  // Email does not form an Erlang-C queue; it uses a workload / occupancy model.
  // A per-channel SLA is recorded but does not change the staffing formula here
  // because email response windows are measured in hours, not seconds.
  // ──────────────────────────────────────────────────────────────────────────
  const EMAIL_ASA_THRESHOLD_SECONDS = 3600; // ≥ 1 h → treat as async
  const isEmailLike = asaTarget >= EMAIL_ASA_THRESHOLD_SECONDS;

  if (isEmailLike) {
    const workSecondsInMonth = fteMonthlyHours * 3600;

    // Dynamic occupancy cap (same logic as original)
    let achievableOccupancyCap = 0.90;
    if (volume < 2000)        achievableOccupancyCap = 0.65;
    else if (volume < 5000)   achievableOccupancyCap = 0.75;
    else if (volume < 15000)  achievableOccupancyCap = 0.82;
    else if (volume < 30000)  achievableOccupancyCap = 0.86;

    const finalOccupancy = Math.min(channelSettings.occupancy / 100, achievableOccupancyCap);
    if (finalOccupancy <= 0) return 9999.9;

    const capacityPerFTE = workSecondsInMonth * finalOccupancy * shrinkageFactor;
    let baseFTE = (volume * channelSettings.aht) / capacityPerFTE;
    baseFTE = baseFTE * (1 + safetyMargin / 100);
    return Number(baseFTE.toFixed(1));
  }

  // ─── Voice & Chat – Erlang C ───────────────────────────────────────────────
  // 1. Convert monthly volume to average contacts per 30-min planning interval
  const intervalSeconds   = 1800; // 30-min intervals
  const intervalsPerMonth = (fteMonthlyHours * 3600) / intervalSeconds;

  let effectiveAHT      = channelSettings.aht;
  let effectiveContacts = volume / intervalsPerMonth;

  // Chat concurrency: each agent handles `c` simultaneous sessions.
  // We model this by reducing effective contacts per agent (divide by concurrency).
  if (channelSettings.concurrency && channelSettings.concurrency > 1) {
    effectiveContacts = effectiveContacts / channelSettings.concurrency;
  }

  // 2. Find minimum net (on-floor) agents per interval to meet the SLA
  const minAgents = findMinAgentsForSLA(
    effectiveContacts,
    effectiveAHT,
    asaTarget,
    slaTarget,
    intervalSeconds
  );

  // 3. Gross FTE = net agents ÷ shrinkage factor  (shrinkage raises headcount need)
  let grossFTE = minAgents / shrinkageFactor;

  // 4. Apply safety margin
  grossFTE = grossFTE * (1 + safetyMargin / 100);

  return Number(grossFTE.toFixed(1));
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

export default function LongTermForecastingBlended() {
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
  const [expandedYears, setExpandedYears] = useState<Record<string, boolean>>({});

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
      assumptions: { ...DEFAULT_ASSUMPTIONS, blendingEfficiency: 10, safetyMargin: 3 },
      supplyInputs: { ...DEFAULT_SUPPLY_INPUTS, tenuredAttritionRate: 1.0, trainingYield: 95 }
    }
  });

  const [assumptions, setAssumptions] = useState<Assumptions>(DEFAULT_ASSUMPTIONS);
  const [supplyInputs, setSupplyInputs] = useState<WorkforceSupplyInputs>(DEFAULT_SUPPLY_INPUTS);
  const [historicalData, setHistoricalData] = useState<number[]>([]);
  const [forecastData, setForecastData] = useState<ForecastData[]>([]);

  const activeScenario = scenarios[selectedScenarioId];

  // Load scenarios from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("lt_forecast_scenarios");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && Object.keys(parsed).length > 0) {
          setScenarios(parsed);
          // If current selection is invalid, switch to first available
          if (!parsed[selectedScenarioId]) {
            const firstId = Object.keys(parsed)[0];
            setSelectedScenarioId(firstId);
          }
        }
      } catch (e) {
        console.error("Failed to parse scenarios", e);
      }
    }
  }, []);

  useEffect(() => {
    if (activeScenario) {
      setAssumptions(activeScenario.assumptions);
      setSupplyInputs(activeScenario.supplyInputs);
    }
  }, [selectedScenarioId]);

  useEffect(() => {
    const savedInputs = localStorage.getItem("lt_forecast_user_inputs");
    if (savedInputs) {
      try {
        const parsed = JSON.parse(savedInputs);
        if (parsed.planParameters) {
          const { forecastMethod: fm, hwParams: hw, arimaParams: ar, decompParams: dp, ...rest } = parsed.planParameters;
          setAssumptions(prev => ({ 
            ...prev, 
            ...rest, 
            ...(parsed.budget || {}), 
            ...(parsed.laborDefinitions || {}) 
          }));
          if (fm) setForecastMethod(fm);
          if (hw) setHwParams(hw);
          if (ar) setArimaParams(ar);
          if (dp) setDecompParams(dp);
        }
        if (parsed.workforceSupplyFactors) {
          setSupplyInputs(prev => ({ ...prev, ...parsed.workforceSupplyFactors }));
        }
      } catch (e) {
        console.error("Failed to load user inputs", e);
      }
    }
  }, []);

  useEffect(() => {
    const dataToSave = {
      planParameters: {
        ...assumptions,
        forecastMethod,
        hwParams,
        arimaParams,
        decompParams
      },
      budget: { ...assumptions },
      laborDefinitions: { ...assumptions },
      workforceSupplyFactors: { ...supplyInputs }
    };
    localStorage.setItem("lt_forecast_user_inputs", JSON.stringify(dataToSave));
  }, [assumptions, supplyInputs, forecastMethod, hwParams, arimaParams, decompParams]);

  const saveScenariosToStorage = (updatedScenarios: Record<string, Scenario>) => {
    localStorage.setItem("lt_forecast_scenarios", JSON.stringify(updatedScenarios));
  };

  const handleSaveScenario = () => {
    const name = window.prompt("Enter scenario name:", activeScenario?.name || "New Scenario");
    if (!name || name.trim() === "") return;

    const newId = `scenario-${Date.now()}`;
    const newScenario: Scenario = {
      id: newId,
      name: name.trim(),
      assumptions: { ...assumptions },
      supplyInputs: { ...supplyInputs }
    };

    const updated = { ...scenarios, [newId]: newScenario };
    setScenarios(updated);
    saveScenariosToStorage(updated);
    setSelectedScenarioId(newId);
    toast.success("Scenario saved successfully!");
  };

  const handleDeleteScenario = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this scenario?")) return;

    const updated = { ...scenarios };
    delete updated[id];

    if (Object.keys(updated).length === 0) {
       // Restore default if all deleted
       const defaultScenario: Scenario = {
          id: "base",
          name: "Base Case (Steady)",
          assumptions: DEFAULT_ASSUMPTIONS,
          supplyInputs: DEFAULT_SUPPLY_INPUTS
       };
       updated["base"] = defaultScenario;
    }

    setScenarios(updated);
    saveScenariosToStorage(updated);
    
    if (id === selectedScenarioId || !updated[selectedScenarioId]) {
        setSelectedScenarioId(Object.keys(updated)[0]);
    }
    toast.success("Scenario deleted");
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
    const updated = { ...scenarios, [id]: newScenario };
    setScenarios(updated);
    saveScenariosToStorage(updated);
    setSelectedScenarioId(id);
    toast.success("New scenario created!");
  };

  const supplyResults = useMemo(() => {
    return calculateWorkforceSupply(supplyInputs, assumptions.channels.voice.aht, assumptions.startDate);
  }, [supplyInputs, assumptions.channels.voice.aht, assumptions.startDate]);

  const effectiveHistoricalData = useMemo(() => {
    if (assumptions.useManualVolume) {
      // Pad to 24 months for statistical stability if manual is only 12
      return [...assumptions.manualHistoricalData, ...assumptions.manualHistoricalData];
    }
    return historicalData;
  }, [assumptions.useManualVolume, assumptions.manualHistoricalData, historicalData]);

  const calculatedVolumes = useMemo(() => {
    if (effectiveHistoricalData.length === 0) return Array(12).fill(0);
    
    switch (forecastMethod) {
      case "yoy":
        return calculateYoY(effectiveHistoricalData.slice(-12), assumptions.growthRate);
      case "ma":
        return calculateMovingAverage(effectiveHistoricalData, 3);
      case "regression":
        return calculateLinearRegression(effectiveHistoricalData);
      case "holtwinters":
        return calculateHoltWinters(
          effectiveHistoricalData, 
          hwParams.alpha, 
          hwParams.beta, 
          hwParams.gamma, 
          hwParams.seasonLength
        );
      case "decomposition":
        return calculateDecomposition(
          effectiveHistoricalData, 
          decompParams.trendStrength, 
          decompParams.seasonalityStrength
        );
      case "arima":
        return calculateARIMA(
          effectiveHistoricalData, 
          arimaParams.p, 
          arimaParams.d, 
          arimaParams.q
        );
      case "genesys":
      default:
        return effectiveHistoricalData.slice(-12); // Always take the most recent 12
    }
  }, [forecastMethod, effectiveHistoricalData, assumptions.growthRate, hwParams, arimaParams, decompParams]);

  const handleRecalculate = () => {
    if (effectiveHistoricalData.length === 0) return;

    // Generate a 36-month timeline: 24 months past + 12 months future
    const timeline = getTimeline(assumptions.startDate, 24, 12);
    
    // Future SDLY Reference: Last 12 months of historical data source (indices 12-23)
    const futureSdly = effectiveHistoricalData.slice(-12);

    const mappedData: ForecastData[] = timeline.map((time, idx) => {
      let volume = 0;
      let historicalVolume = 0;
      let isFuture = time.isFuture;

      if (!isFuture) {
        // Use actuals for past (idx 0-23)
        volume = effectiveHistoricalData[idx] || 0;
        historicalVolume = volume; // Past volume is its own reference
      } else {
        // Use forecasted volumes for future (idx 24-35)
        const forecastIdx = idx - 24;
        volume = calculatedVolumes[forecastIdx] || 0;
        historicalVolume = futureSdly[forecastIdx] || 0;
      }

      // Supply logic only applies to future
      const supplyIdx = isFuture ? idx - 24 : -1;
      const supply = supplyIdx >= 0 ? supplyResults[supplyIdx] : null;
      const monthlyAHT = supply?.weightedAHT || assumptions.channels.voice.aht;

      // --- Multi-Channel Blended FTE Calculation ---
      
      let rawTotalFTE = 0;

      // 1. Voice
      if (assumptions.channels.voice.isActive) {
        rawTotalFTE += calculateFTE(
            volume, 
            { ...assumptions.channels.voice, aht: monthlyAHT }, // Use ramped AHT for voice
            assumptions.shrinkage, 
            assumptions.safetyMargin, 
            assumptions.fteMonthlyHours
        );
      }

      // 2. Email (Assume volume is a % of voice or direct input - here simplifying to same volume base for demo unless split)
      // *In a real app, you'd likely have separate volumes per channel. Here we assume volume applies to the primary channel mix*
      if (assumptions.channels.email.isActive) {
        // Simplified: Assuming Email volume is ~20% of Voice for this blended view
        const emailVol = volume * 0.2; 
        rawTotalFTE += calculateFTE(
            emailVol, 
            assumptions.channels.email, 
            assumptions.shrinkage, 
            assumptions.safetyMargin, 
            assumptions.fteMonthlyHours
        );
      }

      // 3. Chat
      if (assumptions.channels.chat.isActive) {
        // Simplified: Assuming Chat volume is ~30% of Voice for this blended view
        const chatVol = volume * 0.3;
        rawTotalFTE += calculateFTE(
            chatVol, 
            assumptions.channels.chat, 
            assumptions.shrinkage, 
            assumptions.safetyMargin, 
            assumptions.fteMonthlyHours
        );
      }

      // Apply Blending Efficiency Factor
      const blendingFactor = 1 - (assumptions.blendingEfficiency / 100);
      const reqFTE = Number((rawTotalFTE * blendingFactor).toFixed(1));

      // ---------------------------------------------
      
      const availFTE = isFuture ? (supply?.effectiveHeadcount ?? 0) : null;
      const headcount = isFuture ? (supply?.headcount ?? 0) : null;

      const actualSeries = idx <= 24 ? (idx === 24 ? (calculatedVolumes[0] || 0) : volume) : null;
      const forecastSeries = idx >= 23 ? (idx === 23 ? (effectiveHistoricalData[23] || 0) : volume) : null;
      const confidenceBand: [number, number] | null = isFuture ? [Math.round(volume * 0.9), Math.round(volume * 1.1)] : null;

      const understaffedRange: [number, number] | null = isFuture ? [availFTE || 0, Math.max(availFTE || 0, reqFTE)] : null;
      const overstaffedRange: [number, number] | null = isFuture ? [reqFTE, Math.max(reqFTE, availFTE || 0)] : null;

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
        headcount: headcount,
        gap: isFuture ? calculateStaffingGap(reqFTE, availFTE || 0) : 0,
      };
    });
    
    setForecastData(mappedData);
    
    if (timeline.length > 0) {
        const forecastYear = timeline[timeline.length - 1].year;
        setExpandedYears(prev => ({ ...prev, [forecastYear]: true }));
    }
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
    totalVolume: forecastData.filter(d => d.isFuture).reduce((sum, d) => sum + d.volume, 0),
    avgAHT: forecastData.filter(d => d.isFuture).length > 0 ? Math.round(forecastData.filter(d => d.isFuture).reduce((sum, d) => sum + d.aht, 0) / forecastData.filter(d => d.isFuture).length) : 0,
    requiredFTE: forecastData.filter(d => d.isFuture).length > 0 ? Number((forecastData.filter(d => d.isFuture).reduce((sum, d) => sum + d.requiredFTE, 0) / forecastData.filter(d => d.isFuture).length).toFixed(1)) : 0,
    staffingGap: forecastData.filter(d => d.isFuture).length > 0 ? Number((forecastData.filter(d => d.isFuture).reduce((sum, d) => sum + d.gap, 0) / forecastData.filter(d => d.isFuture).length).toFixed(1)) : 0,
    estimatedCost: forecastData.filter(d => d.isFuture).length > 0 ? Number(
      forecastData.filter(d => d.isFuture).reduce((total, d) => {
        const monthlyPayroll = (d.headcount || 0) * (assumptions.annualSalary / 12);
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
          
          {/* Header Controls */}
          <div className="sticky top-0 z-30 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 -mx-4 px-4 py-4 space-y-4 border-b border-border shadow-sm mb-2 transition-all">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="flex flex-col gap-1">
                  <Label className="text-xs font-black uppercase text-muted-foreground tracking-widest">Active Planning Scenario</Label>
                  <Select value={selectedScenarioId} onValueChange={setSelectedScenarioId}>
                    <SelectTrigger className="w-[220px] h-10 border-primary/20 bg-primary/5 font-bold text-primary focus:ring-primary/20">
                      <span className="truncate">{scenarios[selectedScenarioId]?.name || "Select Scenario"}</span>
                    </SelectTrigger>
                    <SelectContent>
                      {Object.values(scenarios).map(s => (
                        <SelectItem key={s.id} value={s.id} className="font-medium group">
                            <div className="flex items-center justify-between w-full min-w-[200px] gap-2">
                                <span className="truncate">{s.name}</span>
                                {s.id !== 'base' && (
                                    <div
                                        role="button"
                                        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/10 hover:text-destructive rounded transition-all shrink-0 z-50"
                                        onClick={(e) => handleDeleteScenario(e, s.id)}
                                        title="Delete Scenario"
                                    >
                                        <Trash2 className="size-3.5" />
                                    </div>
                                )}
                            </div>
                        </SelectItem>
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
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Forecast Vol</p>
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
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">W. Avg AHT</p>
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
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Req. HC (Blended)</p>
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
                    <p className={`text-xs font-bold uppercase tracking-widest ${kpis.staffingGap < 0 ? "text-rose-600" : "text-emerald-600"}`}>Gap</p>
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
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Est. Cost</p>
                    <h3 className="text-lg font-black tracking-tight">{formatCurrency(kpis.estimatedCost, assumptions.currency)}</h3>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Insights & Hiring Plan (Unchanged) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {insights.length > 0 && (
                <Card className="border-primary/20 bg-primary/5 shadow-sm border-dashed">
                  <CardHeader className="py-3 px-6 border-b border-primary/10">
                    <CardTitle className="text-sm font-black flex items-center gap-2 uppercase tracking-widest text-primary">
                      <Info className="size-4" />
                      Key Planning Insights
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="py-4 px-6">
                    <ul className="space-y-3">
                      {insights.map((insight, idx) => {
                        const parts = insight.split(/(\d+(?:\.\d+)?%?)/);
                        return (
                          <li key={idx} className="flex items-start gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
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
                    <CardTitle className={`text-sm font-black flex items-center gap-2 uppercase tracking-widest ${hiringPlan.totalHires > 0 ? "text-amber-700 dark:text-amber-400" : "text-emerald-700"}`}>
                      <Users className="size-4" />
                      Hiring Strategy
                    </CardTitle>
                    {hiringPlan.totalHires > 0 && <Badge className="bg-amber-500 font-black text-xs animate-pulse">ACTION REQUIRED</Badge>}
                  </CardHeader>
                  <CardContent className="py-4 px-6">
                    <div className="space-y-4">
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-200 leading-relaxed">
                        {hiringPlan.summary.split(/(\d+)/).map((part, i) => 
                          /^\d+$/.test(part) ? <strong key={i} className="text-amber-700 dark:text-amber-400 font-black text-sm">{part}</strong> : part
                        )}
                      </p>
                      {hiringPlan.totalHires > 0 && (
                        <div className="flex items-center gap-4 p-3 bg-amber-100/50 rounded-lg border border-amber-200/50">
                          <div>
                            <p className="text-xs font-bold text-amber-800 uppercase tracking-wider">Target</p>
                            <p className="text-lg font-black text-amber-900">+{hiringPlan.totalHires} <span className="text-xs font-bold text-amber-700">New Hires</span></p>
                          </div>
                          <div className="h-8 w-px bg-amber-200" />
                          <div>
                            <p className="text-xs font-bold text-amber-800 uppercase tracking-wider">Rate</p>
                            <p className="text-lg font-black text-amber-900">{hiringPlan.monthlyHires} <span className="text-xs font-bold text-amber-700">/ Month</span></p>
                          </div>
                          <div className="h-8 w-px bg-amber-200" />
                          <div>
                            <p className="text-xs font-bold text-amber-800 uppercase tracking-wider">Start</p>
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
            {/* Charts & Tables */}
            <div className="lg:col-span-3 space-y-8">
              <Card className="border border-border/50 shadow-lg shadow-slate-200/50 dark:shadow-none overflow-hidden">
                <CardHeader className="bg-slate-50/50 dark:bg-slate-900/50 border-b border-border/50 flex flex-row items-center justify-between py-4">
                  <div>
                    <CardTitle className="text-base font-black flex items-center gap-2">
                      <LayoutDashboard className="size-4 text-primary" />
                      Defensible Capacity Plan
                    </CardTitle>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Gross Requirements vs. Available Headcount</p>
                  </div>
                  <div className="flex items-center gap-2">
                     <Badge variant="outline" className="text-xs font-black uppercase tracking-widest bg-white dark:bg-slate-800 border-primary/20 text-primary">Live Projection</Badge>
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
                          tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))', fontWeight: 700 }}
                          dy={10}
                        />
                        <YAxis 
                          yAxisId="left"
                          axisLine={false}
                          tickLine={false}
                          tick={{ fontSize: 12, fill: 'hsl(var(--primary))', fontWeight: 800 }}
                          tickFormatter={(value) => value >= 1000 ? `${(value / 1000).toFixed(0)}k` : value}
                        />
                        <YAxis 
                          yAxisId="right" 
                          orientation="right" 
                          axisLine={false}
                          tickLine={false}
                          tick={{ fontSize: 12, fill: '#f59e0b', fontWeight: 800 }}
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
                                      <Badge variant="secondary" className="text-xs h-4 font-black">ACTUAL</Badge>
                                    ) : (
                                      <Badge variant="outline" className="text-xs h-4 font-black border-primary/20 text-primary">FCST</Badge>
                                    )}
                                  </div>
                                  <div className="space-y-2">
                                    <div className="flex items-center justify-between gap-6">
                                      <span className="text-xs font-bold text-muted-foreground uppercase">Volume</span>
                                      <span className="text-sm font-black tabular-nums text-primary">{data.volume.toLocaleString()}</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-6">
                                      <span className="text-xs font-bold text-muted-foreground uppercase">Required FTE</span>
                                      <span className="text-sm font-black tabular-nums text-amber-600">{data.requiredFTE}</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-6">
                                      <span className="text-xs font-bold text-muted-foreground uppercase">Available FTE</span>
                                      <span className="text-sm font-black tabular-nums text-emerald-600">{data.availableFTE}</span>
                                    </div>
                                    
                                    <div className="pt-2 border-t border-border mt-1">
                                      <div className="flex items-center justify-between">
                                         <span className="text-xs font-black text-muted-foreground uppercase">{status}</span>
                                         <span className={`text-sm font-black tabular-nums ${statusColor}`}>
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
                          wrapperStyle={{ paddingTop: '0px', paddingBottom: '30px', fontSize: '12px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}
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
                          name="Req. HC (Blended)"
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
                        <TableHead className="w-[140px] text-sm font-black uppercase tracking-widest pl-6">Timeline</TableHead>
                        <TableHead className="text-right text-sm font-black uppercase tracking-widest">Proj Vol</TableHead>
                        <TableHead className="text-right text-sm font-black uppercase tracking-widest">Weighted AHT</TableHead>
                        <TableHead className="text-right text-sm font-black uppercase tracking-widest">Req. HC</TableHead>
                        <TableHead className="text-right text-sm font-black uppercase tracking-widest">Avail. HC</TableHead>
                        <TableHead className="text-right text-sm font-black uppercase tracking-widest pr-6">Gap Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.entries(forecastData.reduce((acc, row) => {
                        if (!acc[row.year]) acc[row.year] = [];
                        acc[row.year].push(row);
                        return acc;
                      }, {} as Record<string, ForecastData[]>)).map(([year, rows]) => (
                        <React.Fragment key={year}>
                          <TableRow className="bg-muted/30 hover:bg-muted/50 cursor-pointer" onClick={() => setExpandedYears(prev => ({ ...prev, [year]: !prev[year] }))}>
                            <TableCell colSpan={6} className="py-2 pl-4">
                              <div className="flex items-center gap-2 font-bold text-sm uppercase tracking-widest text-muted-foreground">
                                {expandedYears[year] ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                                {year} ({rows.length} Months)
                                {rows.some(r => r.isFuture) && <Badge variant="outline" className="text-xs h-4 ml-2 border-primary/20 text-primary">FORECAST YEAR</Badge>}
                              </div>
                            </TableCell>
                          </TableRow>
                          {expandedYears[year] && rows.map((row, idx) => (
                            <TableRow key={`${year}-${idx}`} className={`group hover:bg-slate-50/50 dark:hover:bg-slate-900/50 transition-colors ${!row.isFuture ? "opacity-70 bg-slate-50/30" : ""}`}>
                              <TableCell className="font-bold text-sm pl-6 flex items-center gap-2">
                                {row.month}
                                {!row.isFuture && <Badge variant="secondary" className="text-xs h-4 font-black">ACTUAL</Badge>}
                                {row.isFuture && <Badge variant="outline" className="text-xs h-4 font-black border-primary/20 text-primary">FCST</Badge>}
                              </TableCell>
                              <TableCell className="text-right font-mono text-sm font-bold text-primary">{row.volume.toLocaleString()}</TableCell>
                              <TableCell className="text-right font-mono text-sm text-indigo-600">{row.aht}s</TableCell>
                              <TableCell className="text-right font-mono text-sm font-bold text-amber-600">{row.requiredFTE}</TableCell>
                              <TableCell className="text-right font-mono text-sm text-emerald-600 font-bold">{row.availableFTE?.toLocaleString() ?? "-"}</TableCell>
                              <TableCell className="text-right pr-6">
                                <Badge 
                                  variant={row.gap >= 0 ? "default" : "destructive"} 
                                  className={`font-black text-xs tracking-tight min-w-[60px] justify-center ${row.gap >= 0 ? "bg-emerald-500 hover:bg-emerald-600 border-none" : ""}`}
                                >
                                  {row.isFuture ? (row.gap > 0 ? `+${row.gap}` : row.gap) : "-"}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </React.Fragment>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>

            <div className="lg:col-span-1">
              <div className="sticky top-[200px] space-y-6">
                <Card className="border border-border/80 shadow-xl overflow-hidden">
                  <CardHeader className="border-b border-border/50 bg-slate-900 text-white py-4">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-black flex items-center gap-2 uppercase tracking-[0.2em]">
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
                      
                      {/* START: Multi-Channel Settings */}
                      <div className="space-y-4 border-b border-border pb-6">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Multi-Channel Mix</Label>
                          <Badge variant="outline" className="text-[10px] uppercase font-bold text-primary">Blended FTE</Badge>
                        </div>
                        
                        {/* ── Voice ── */}
                        <div className="space-y-2 p-2 rounded-md bg-slate-50 dark:bg-slate-900 border border-border/50">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs font-bold flex items-center gap-2">
                              <span className={`size-2 rounded-full ${assumptions.channels.voice.isActive ? "bg-green-500" : "bg-slate-300"}`} />
                              Voice
                            </Label>
                            <Switch 
                                checked={assumptions.channels.voice.isActive}
                                onCheckedChange={(c) => setAssumptions({
                                    ...assumptions, 
                                    channels: { ...assumptions.channels, voice: { ...assumptions.channels.voice, isActive: c } }
                                })}
                            />
                          </div>
                          {assumptions.channels.voice.isActive && (
                            <>
                              {/* Row 1: AHT + Occ % */}
                              <div className="grid grid-cols-2 gap-2 mt-2">
                                <div>
                                  <Label className="text-[10px] text-muted-foreground font-bold">Base AHT</Label>
                                  <Input 
                                    type="number" 
                                    className="h-7 text-xs" 
                                    value={assumptions.channels.voice.aht} 
                                    onChange={(e) => setAssumptions({
                                        ...assumptions, 
                                        channels: { ...assumptions.channels, voice: { ...assumptions.channels.voice, aht: Number(e.target.value) } }
                                    })}
                                  />
                                </div>
                                <div>
                                  <Label className="text-[10px] text-muted-foreground font-bold">Occ %</Label>
                                  <Input 
                                    type="number" 
                                    className="h-7 text-xs" 
                                    value={assumptions.channels.voice.occupancy} 
                                    onChange={(e) => setAssumptions({
                                        ...assumptions, 
                                        channels: { ...assumptions.channels, voice: { ...assumptions.channels.voice, occupancy: Number(e.target.value) } }
                                    })}
                                  />
                                </div>
                              </div>
                              {/* Row 2: SLA Target % + ASA (s) — NEW */}
                              <div className="grid grid-cols-2 gap-2 mt-1">
                                <div>
                                  <div className="flex items-center gap-1">
                                    <Label className="text-[10px] text-muted-foreground font-bold">SLA Target %</Label>
                                    <UITooltip>
                                      <TooltipTrigger asChild><Info className="size-2.5 text-muted-foreground cursor-help" /></TooltipTrigger>
                                      <TooltipContent><p className="text-xs">% of calls answered within ASA (Erlang C)</p></TooltipContent>
                                    </UITooltip>
                                  </div>
                                  <Input 
                                    type="number" 
                                    className="h-7 text-xs border-green-200 bg-green-50 dark:bg-green-950/20" 
                                    value={assumptions.channels.voice.slaTarget} 
                                    onChange={(e) => setAssumptions({
                                        ...assumptions, 
                                        channels: { ...assumptions.channels, voice: { ...assumptions.channels.voice, slaTarget: validateInput(Number(e.target.value), 1, 100) } }
                                    })}
                                  />
                                </div>
                                <div>
                                  <div className="flex items-center gap-1">
                                    <Label className="text-[10px] text-muted-foreground font-bold">ASA (s)</Label>
                                    <UITooltip>
                                      <TooltipTrigger asChild><Info className="size-2.5 text-muted-foreground cursor-help" /></TooltipTrigger>
                                      <TooltipContent><p className="text-xs">Target speed of answer in seconds (e.g. 20)</p></TooltipContent>
                                    </UITooltip>
                                  </div>
                                  <Input 
                                    type="number" 
                                    className="h-7 text-xs border-green-200 bg-green-50 dark:bg-green-950/20" 
                                    value={assumptions.channels.voice.asaTarget} 
                                    onChange={(e) => setAssumptions({
                                        ...assumptions, 
                                        channels: { ...assumptions.channels, voice: { ...assumptions.channels.voice, asaTarget: validateInput(Number(e.target.value), 1) } }
                                    })}
                                  />
                                </div>
                              </div>
                            </>
                          )}
                        </div>

                        {/* ── Email ── */}
                        <div className="space-y-2 p-2 rounded-md bg-slate-50 dark:bg-slate-900 border border-border/50">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs font-bold flex items-center gap-2">
                              <span className={`size-2 rounded-full ${assumptions.channels.email.isActive ? "bg-blue-500" : "bg-slate-300"}`} />
                              Email
                            </Label>
                            <Switch 
                                checked={assumptions.channels.email.isActive}
                                onCheckedChange={(c) => setAssumptions({
                                    ...assumptions, 
                                    channels: { ...assumptions.channels, email: { ...assumptions.channels.email, isActive: c } }
                                })}
                            />
                          </div>
                          {assumptions.channels.email.isActive && (
                            <>
                              {/* Row 1: AHT + Occ % */}
                              <div className="grid grid-cols-2 gap-2 mt-2">
                                <div>
                                  <Label className="text-[10px] text-muted-foreground font-bold">AHT</Label>
                                  <Input 
                                    type="number" 
                                    className="h-7 text-xs" 
                                    value={assumptions.channels.email.aht} 
                                    onChange={(e) => setAssumptions({
                                        ...assumptions, 
                                        channels: { ...assumptions.channels, email: { ...assumptions.channels.email, aht: Number(e.target.value) } }
                                    })}
                                  />
                                </div>
                                <div>
                                  <Label className="text-[10px] text-muted-foreground font-bold">Occ %</Label>
                                  <Input 
                                    type="number" 
                                    className="h-7 text-xs" 
                                    disabled
                                    value={assumptions.channels.email.occupancy} 
                                  />
                                </div>
                              </div>
                              {/* Row 2: SLA Target % + ASA (s) — NEW */}
                              <div className="grid grid-cols-2 gap-2 mt-1">
                                <div>
                                  <div className="flex items-center gap-1">
                                    <Label className="text-[10px] text-muted-foreground font-bold">SLA Target %</Label>
                                    <UITooltip>
                                      <TooltipTrigger asChild><Info className="size-2.5 text-muted-foreground cursor-help" /></TooltipTrigger>
                                      <TooltipContent><p className="text-xs">% of emails responded within ASA window</p></TooltipContent>
                                    </UITooltip>
                                  </div>
                                  <Input 
                                    type="number" 
                                    className="h-7 text-xs border-blue-200 bg-blue-50 dark:bg-blue-950/20" 
                                    value={assumptions.channels.email.slaTarget} 
                                    onChange={(e) => setAssumptions({
                                        ...assumptions, 
                                        channels: { ...assumptions.channels, email: { ...assumptions.channels.email, slaTarget: validateInput(Number(e.target.value), 1, 100) } }
                                    })}
                                  />
                                </div>
                                <div>
                                  <div className="flex items-center gap-1">
                                    <Label className="text-[10px] text-muted-foreground font-bold">ASA (s)</Label>
                                    <UITooltip>
                                      <TooltipTrigger asChild><Info className="size-2.5 text-muted-foreground cursor-help" /></TooltipTrigger>
                                      <TooltipContent><p className="text-xs">Response window in seconds (e.g. 14400 = 4 h). Email uses workload model.</p></TooltipContent>
                                    </UITooltip>
                                  </div>
                                  <Input 
                                    type="number" 
                                    className="h-7 text-xs border-blue-200 bg-blue-50 dark:bg-blue-950/20" 
                                    value={assumptions.channels.email.asaTarget} 
                                    onChange={(e) => setAssumptions({
                                        ...assumptions, 
                                        channels: { ...assumptions.channels, email: { ...assumptions.channels.email, asaTarget: validateInput(Number(e.target.value), 1) } }
                                    })}
                                  />
                                </div>
                              </div>
                            </>
                          )}
                        </div>

                        {/* ── Chat ── */}
                        <div className="space-y-2 p-2 rounded-md bg-slate-50 dark:bg-slate-900 border border-border/50">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs font-bold flex items-center gap-2">
                              <span className={`size-2 rounded-full ${assumptions.channels.chat.isActive ? "bg-amber-500" : "bg-slate-300"}`} />
                              Chat
                            </Label>
                            <Switch 
                                checked={assumptions.channels.chat.isActive}
                                onCheckedChange={(c) => setAssumptions({
                                    ...assumptions, 
                                    channels: { ...assumptions.channels, chat: { ...assumptions.channels.chat, isActive: c } }
                                })}
                            />
                          </div>
                          {assumptions.channels.chat.isActive && (
                            <>
                              {/* Row 1: AHT + Occ % + Conc. */}
                              <div className="grid grid-cols-3 gap-2 mt-2">
                                <div className="col-span-1">
                                  <Label className="text-[10px] text-muted-foreground font-bold">AHT</Label>
                                  <Input 
                                    type="number" 
                                    className="h-7 text-xs" 
                                    value={assumptions.channels.chat.aht} 
                                    onChange={(e) => setAssumptions({
                                        ...assumptions, 
                                        channels: { ...assumptions.channels, chat: { ...assumptions.channels.chat, aht: Number(e.target.value) } }
                                    })}
                                  />
                                </div>
                                <div className="col-span-1">
                                  <Label className="text-[10px] text-muted-foreground font-bold">Occ %</Label>
                                  <Input 
                                    type="number" 
                                    className="h-7 text-xs" 
                                    value={assumptions.channels.chat.occupancy} 
                                    onChange={(e) => setAssumptions({
                                        ...assumptions, 
                                        channels: { ...assumptions.channels, chat: { ...assumptions.channels.chat, occupancy: Number(e.target.value) } }
                                    })}
                                  />
                                </div>
                                <div className="col-span-1">
                                  <Label className="text-[10px] text-muted-foreground font-bold">Conc.</Label>
                                  <Input 
                                    type="number" 
                                    className="h-7 text-xs" 
                                    value={assumptions.channels.chat.concurrency} 
                                    onChange={(e) => setAssumptions({
                                        ...assumptions, 
                                        channels: { ...assumptions.channels, chat: { ...assumptions.channels.chat, concurrency: Number(e.target.value) } }
                                    })}
                                  />
                                </div>
                              </div>
                              {/* Row 2: SLA Target % + ASA (s) — NEW */}
                              <div className="grid grid-cols-2 gap-2 mt-1">
                                <div>
                                  <div className="flex items-center gap-1">
                                    <Label className="text-[10px] text-muted-foreground font-bold">SLA Target %</Label>
                                    <UITooltip>
                                      <TooltipTrigger asChild><Info className="size-2.5 text-muted-foreground cursor-help" /></TooltipTrigger>
                                      <TooltipContent><p className="text-xs">% of chats connected within ASA (Erlang C)</p></TooltipContent>
                                    </UITooltip>
                                  </div>
                                  <Input 
                                    type="number" 
                                    className="h-7 text-xs border-amber-200 bg-amber-50 dark:bg-amber-950/20" 
                                    value={assumptions.channels.chat.slaTarget} 
                                    onChange={(e) => setAssumptions({
                                        ...assumptions, 
                                        channels: { ...assumptions.channels, chat: { ...assumptions.channels.chat, slaTarget: validateInput(Number(e.target.value), 1, 100) } }
                                    })}
                                  />
                                </div>
                                <div>
                                  <div className="flex items-center gap-1">
                                    <Label className="text-[10px] text-muted-foreground font-bold">ASA (s)</Label>
                                    <UITooltip>
                                      <TooltipTrigger asChild><Info className="size-2.5 text-muted-foreground cursor-help" /></TooltipTrigger>
                                      <TooltipContent><p className="text-xs">Target connect speed in seconds (e.g. 30)</p></TooltipContent>
                                    </UITooltip>
                                  </div>
                                  <Input 
                                    type="number" 
                                    className="h-7 text-xs border-amber-200 bg-amber-50 dark:bg-amber-950/20" 
                                    value={assumptions.channels.chat.asaTarget} 
                                    onChange={(e) => setAssumptions({
                                        ...assumptions, 
                                        channels: { ...assumptions.channels, chat: { ...assumptions.channels.chat, asaTarget: validateInput(Number(e.target.value), 1) } }
                                    })}
                                  />
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                        
                        {/* Blending Efficiency */}
                        <div className="space-y-2 pt-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1">
                                <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Blending Eff. Gain</Label>
                                <UITooltip>
                                  <TooltipTrigger asChild><Layers className="size-3 text-muted-foreground cursor-help" /></TooltipTrigger>
                                  <TooltipContent><p className="text-xs">% Reduction in FTE due to multi-skilling</p></TooltipContent>
                                </UITooltip>
                              </div>
                              <span className="text-xs font-black bg-emerald-50 text-emerald-600 px-2 py-1 rounded">{assumptions.blendingEfficiency}%</span>
                            </div>
                            <Input 
                                type="number" 
                                value={assumptions.blendingEfficiency} 
                                onChange={(e) => setAssumptions({...assumptions, blendingEfficiency: validateInput(Number(e.target.value), 0, 50)})} 
                                className="h-9 font-bold border-emerald-200" 
                            />
                        </div>
                      </div>
                      {/* END: Multi-Channel Settings */}

                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="startDate" className="text-xs font-black uppercase tracking-widest text-muted-foreground">Planning Start Date</Label>
                          <Calendar className="size-3.5 text-primary" />
                        </div>
                        <Input id="startDate" type="date" value={assumptions.startDate} onChange={(e) => setAssumptions({...assumptions, startDate: e.target.value})} className="h-10 font-bold" />
                      </div>

                      <div className="space-y-3 border-t border-border pt-4">
                         <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Data Source</Label>
                              <Badge variant="outline" className="text-xs font-bold">{assumptions.useManualVolume ? "MANUAL" : "API"}</Badge>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-muted-foreground">Manual</span>
                              <Switch 
                                checked={assumptions.useManualVolume} 
                                onCheckedChange={(checked) => setAssumptions({...assumptions, useManualVolume: checked})} 
                              />
                            </div>
                         </div>
                         
                         {assumptions.useManualVolume && (
                           <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                             <div className="flex items-center justify-between">
                               <p className="text-xs font-bold text-muted-foreground uppercase">Monthly Actuals (Last 12m)</p>
                               {!loading && historicalData.length > 0 && (
                                 <Button 
                                   variant="ghost" 
                                   size="sm" 
                                   className="h-6 text-xs font-black border border-primary/20 text-primary uppercase"
                                   onClick={() => {
                                     setAssumptions({
                                       ...assumptions, 
                                       manualHistoricalData: historicalData.slice(-12)
                                     });
                                     toast.success("Copied latest API data to manual fields");
                                   }}
                                 >
                                   Copy from API
                                 </Button>
                               )}
                             </div>
                             <div className="grid grid-cols-3 gap-2">
                               {assumptions.manualHistoricalData.map((vol, i) => (
                                 <div key={i} className="space-y-1">
                                   <Label className="text-xs font-bold text-muted-foreground uppercase">{MONTH_NAMES[i]}</Label>
                                   <Input 
                                     type="number" 
                                     value={vol} 
                                     onChange={(e) => {
                                       const newData = [...assumptions.manualHistoricalData];
                                       newData[i] = Number(e.target.value);
                                       setAssumptions({...assumptions, manualHistoricalData: newData});
                                     }}
                                     className="h-8 text-xs font-bold"
                                   />
                                 </div>
                               ))}
                             </div>
                           </div>
                         )}
                      </div>

                      <div className="space-y-3 border-t border-border pt-4">
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
                          <div className="flex items-center gap-1">
                            <Label htmlFor="shrinkage" className="text-xs font-black uppercase tracking-widest text-muted-foreground">Total Shrinkage</Label>
                            <UITooltip>
                              <TooltipTrigger asChild>
                                <Info className="size-3 text-muted-foreground cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="text-xs">Non-productive time (leaves, breaks, etc.)</p>
                              </TooltipContent>
                            </UITooltip>
                          </div>
                          <span className="text-xs font-black bg-rose-50 dark:bg-rose-900/20 px-2 py-1 rounded text-rose-600">{assumptions.shrinkage}%</span>
                        </div>
                        <Input 
                          id="shrinkage" 
                          type="number" 
                          value={assumptions.shrinkage} 
                          onChange={(e) => setAssumptions({...assumptions, shrinkage: validateInput(Number(e.target.value), 0, 60)})} 
                          className="h-9 font-bold border-rose-100" 
                        />
                      </div>

                      {forecastMethod === 'yoy' && (
                        <div className="space-y-3 border-t border-border pt-6 mt-6">
                            <div className="flex items-center justify-between">
                            <Label htmlFor="growth" className="text-xs font-black uppercase tracking-widest text-muted-foreground">YoY Growth Rate</Label>
                            <Badge className="bg-emerald-500 font-black tracking-tight">+{assumptions.growthRate}%</Badge>
                            </div>
                            <Input id="growth" type="number" value={assumptions.growthRate} onChange={(e) => setAssumptions({...assumptions, growthRate: validateInput(Number(e.target.value))})} className="h-10 font-bold border-emerald-200" />
                        </div>
                      )}

                      {forecastMethod === 'holtwinters' && (
                        <div className="space-y-4 border-t border-border pt-6 mt-6">
                            <div className="flex items-center justify-between">
                            <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">HW Smoothing</Label>
                            <Badge className="bg-amber-500 font-black tracking-tight">Triple Exp</Badge>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-1">
                                <Label className="text-xs font-bold">Alpha (Level)</Label>
                                <Input type="number" step="0.1" min="0" max="1" value={hwParams.alpha} onChange={(e) => setHwParams({...hwParams, alpha: Number(e.target.value)})} className="h-8 text-xs" />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs font-bold">Beta (Trend)</Label>
                                <Input type="number" step="0.1" min="0" max="1" value={hwParams.beta} onChange={(e) => setHwParams({...hwParams, beta: Number(e.target.value)})} className="h-8 text-xs" />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs font-bold">Gamma (Season)</Label>
                                <Input type="number" step="0.1" min="0" max="1" value={hwParams.gamma} onChange={(e) => setHwParams({...hwParams, gamma: Number(e.target.value)})} className="h-8 text-xs" />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs font-bold">Season (Len)</Label>
                                <Input type="number" min="1" max="24" value={hwParams.seasonLength} onChange={(e) => setHwParams({...hwParams, seasonLength: Number(e.target.value)})} className="h-8 text-xs" />
                              </div>
                            </div>
                        </div>
                      )}

                      {forecastMethod === 'arima' && (
                        <div className="space-y-4 border-t border-border pt-6 mt-6">
                            <div className="flex items-center justify-between">
                            <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">ARIMA (Simplified)</Label>
                            <Badge className="bg-emerald-500 font-black tracking-tight">p d q</Badge>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                              <div className="space-y-1">
                                <Label className="text-xs font-bold">p (AR)</Label>
                                <Input type="number" min="0" max="12" value={arimaParams.p} onChange={(e) => setArimaParams({...arimaParams, p: Number(e.target.value)})} className="h-8 text-xs" />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs font-bold">d (Diff)</Label>
                                <Input type="number" min="0" max="2" value={arimaParams.d} onChange={(e) => setArimaParams({...arimaParams, d: Number(e.target.value)})} className="h-8 text-xs" />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs font-bold">q (MA)</Label>
                                <Input type="number" min="1" max="10" value={arimaParams.q} onChange={(e) => setArimaParams({...arimaParams, q: Number(e.target.value)})} className="h-8 text-xs" />
                              </div>
                            </div>
                        </div>
                      )}

                      {forecastMethod === 'decomposition' && (
                        <div className="space-y-4 border-t border-border pt-6 mt-6">
                            <div className="flex items-center justify-between">
                            <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Decomposition</Label>
                            <Badge className="bg-blue-500 font-black tracking-tight">Strengths</Badge>
                            </div>
                            <div className="space-y-3">
                              <div className="space-y-1">
                                <div className="flex justify-between">
                                  <Label className="text-xs font-bold">Trend Strength</Label>
                                  <span className="text-xs font-bold">{decompParams.trendStrength}x</span>
                                </div>
                                <Input type="number" step="0.1" min="0" max="3" value={decompParams.trendStrength} onChange={(e) => setDecompParams({...decompParams, trendStrength: Number(e.target.value)})} className="h-8 text-xs" />
                              </div>
                              <div className="space-y-1">
                                <div className="flex justify-between">
                                  <Label className="text-xs font-bold">Seasonality Strength</Label>
                                  <span className="text-xs font-bold">{decompParams.seasonalityStrength}x</span>
                                </div>
                                <Input type="number" step="0.1" min="0" max="3" value={decompParams.seasonalityStrength} onChange={(e) => setDecompParams({...decompParams, seasonalityStrength: Number(e.target.value)})} className="h-8 text-xs" />
                              </div>
                            </div>
                        </div>
                      )}

                      {forecastMethod === 'ma' && (
                        <div className="space-y-3 border-t border-border pt-6 mt-6">
                            <div className="flex items-center justify-between">
                            <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">MA Periods</Label>
                            <Badge className="bg-indigo-500 font-black tracking-tight">Last 3 Months</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground italic">Moving average uses the most recent historical periods to project a baseline.</p>
                        </div>
                      )}

                      <Button 
                        className="w-full h-11 font-black uppercase tracking-widest text-xs mt-4 shadow-lg shadow-primary/20"
                        onClick={() => {
                            toast.info("Recalculating forecast and staffing...", { duration: 1500 })
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
                      <CardTitle className="text-sm font-black flex items-center gap-2 uppercase tracking-[0.2em]">
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
                        <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Planning Currency</Label>
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
                        <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Avg Annual Salary ({activeCurrency.symbol})</Label>
                        <Input type="number" value={assumptions.annualSalary} onChange={(e) => setAssumptions({...assumptions, annualSalary: validateInput(Number(e.target.value))})} className="h-9 font-bold" />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Onboarding Cost/Hire ({activeCurrency.symbol})</Label>
                        <Input type="number" value={assumptions.onboardingCost} onChange={(e) => setAssumptions({...assumptions, onboardingCost: validateInput(Number(e.target.value))})} className="h-9 font-bold" />
                      </div>
                      <div className="space-y-2 pt-2 border-t border-border">
                        <div className="flex items-center gap-1">
                          <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">FTE Monthly Hours</Label>
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
                      <CardTitle className="text-sm font-black flex items-center gap-2 uppercase tracking-[0.2em]">
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
                          <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Starting Headcount</Label>
                          <Input type="number" value={supplyInputs.startingHeadcount} onChange={(e) => setSupplyInputs({...supplyInputs, startingHeadcount: validateInput(Number(e.target.value))})} className="h-9 font-bold" />
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center gap-1">
                            <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Training Yield (%)</Label>
                            <UITooltip>
                              <TooltipTrigger asChild><Info className="size-3 text-muted-foreground" /></TooltipTrigger>
                              <TooltipContent><p className="text-xs">% of hires who graduate to the floor</p></TooltipContent>
                            </UITooltip>
                          </div>
                          <Input type="number" value={supplyInputs.trainingYield} onChange={(e) => setSupplyInputs({...supplyInputs, trainingYield: validateInput(Number(e.target.value), 0, 100)})} className="h-9 font-bold" />
                        </div>
                      </div>

                      <div className="space-y-3 pt-2 border-t border-border">
                        <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Infant Mortality (Attrition M1-M3)</Label>
                        <div className="grid grid-cols-3 gap-3">
                          {supplyInputs.newHireAttritionProfile.map((val, idx) => (
                            <div key={idx} className="space-y-1">
                              <Label className="text-xs font-bold text-muted-foreground uppercase">Month {idx + 1} %</Label>
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
                          <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Monthly Hiring</Label>
                          <Input type="number" value={supplyInputs.monthlyHiring} onChange={(e) => setSupplyInputs({...supplyInputs, monthlyHiring: validateInput(Number(e.target.value))})} className="h-9 font-bold" />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Training Duration (Months)</Label>
                          <Input type="number" value={supplyInputs.trainingMonths} onChange={(e) => setSupplyInputs({...supplyInputs, trainingMonths: validateInput(Number(e.target.value), 0, 12)})} className="h-9 font-bold" />
                        </div>
                      </div>

                      <div className="space-y-3 pt-2 border-t border-border">
                        <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">AHT Learning Multipliers</Label>
                        <div className="grid grid-cols-3 gap-3">
                          {supplyInputs.ahtRamp.map((val, idx) => (
                            <div key={idx} className="space-y-1">
                              <Label className="text-xs font-bold text-muted-foreground uppercase">M{idx + 1} AHT x</Label>
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
