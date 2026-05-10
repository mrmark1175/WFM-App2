import { PageLayout } from "../components/PageLayout";
import { Link } from "react-router-dom";
import {
  LineChart, Layers, TrendingUp,
  Users,
  CalendarDays, Calendar, UserCheck, Clock, Scale,
  Monitor,
  BarChart3,
  ChevronRight,
} from "lucide-react";
import React from "react";

interface SubTool {
  label: string;
  path: string;
  icon: React.ElementType;
}

interface CycleStep {
  step: string;
  title: string;
  description: string;
  icon: React.ElementType;
  tools: SubTool[];
  placeholder?: true;
}

const CYCLE_STEPS: CycleStep[] = [
  {
    step: "01",
    title: "Forecasting",
    description:
      "Predict future contact volumes and handle-time patterns using historical data and statistical models — the foundation of every WFM cycle.",
    icon: LineChart,
    tools: [
      { label: "Demand Forecasting", path: "/wfm/long-term-forecasting-demand", icon: LineChart },
      { label: "Shrinkage Planning",  path: "/wfm/shrinkage",                   icon: Layers },
      { label: "Intraday Forecast",   path: "/wfm/intraday",                    icon: TrendingUp },
      { label: "Intraday Forecast v2", path: "/wfm/intraday-v2",                icon: TrendingUp },
    ],
  },
  {
    step: "02",
    title: "Capacity Management",
    description:
      "Translate forecasted demand into required staffing headcount using Erlang C queuing models and multi-channel pooling scenarios.",
    icon: Users,
    tools: [
      { label: "Workforce Planning", path: "/wfm/capacity", icon: Users },
    ],
  },
  {
    step: "03",
    title: "Scheduling",
    description:
      "Build and publish agent schedules that match required staffing patterns while respecting labor laws, shift preferences, and coverage targets.",
    icon: CalendarDays,
    tools: [
      { label: "Scheduling Hub",   path: "/scheduling",          icon: CalendarDays },
      { label: "Schedule Editor",  path: "/scheduling/schedule", icon: Calendar },
      { label: "Agent Roster",     path: "/scheduling/agents",   icon: UserCheck },
      { label: "Shift Templates",  path: "/scheduling/shifts",   icon: Clock },
      { label: "Labor Law Rules",  path: "/scheduling/labor-laws", icon: Scale },
    ],
  },
  {
    step: "04",
    title: "RTA & Traffic Management",
    description:
      "Monitor real-time queue activity, agent adherence, and live SLA performance — and intervene when volumes or staffing deviate from plan.",
    icon: Monitor,
    tools: [
      { label: "Real Time Management", path: "/wfm/real-time-management", icon: Monitor },
    ],
  },
  {
    step: "05",
    title: "Reporting, Analysing & Advising",
    description:
      "Measure WFM outcomes against targets, identify root causes of gaps, and advise leadership on corrective actions and strategic improvements.",
    icon: BarChart3,
    placeholder: true,
    tools: [],
  },
];

export function WFM() {
  return (
    <PageLayout title="Workforce Management">
      {/* Cycle legend */}
      <div className="px-6 pt-4 pb-2">
        <p className="text-xs text-muted-foreground tracking-wide uppercase font-mono">
          WFM Cycle &nbsp;·&nbsp; 5 Steps
        </p>
      </div>

      <div className="px-6 pb-8 grid md:grid-cols-3 gap-6">
        {CYCLE_STEPS.map((step) => {
          const Icon = step.icon;
          const isPlaceholder = step.placeholder === true;

          return (
            <div
              key={step.step}
              className={`relative bg-card border rounded-xl p-6 flex flex-col gap-4 h-full
                ${isPlaceholder
                  ? "border-dashed border-border opacity-60"
                  : "border-border hover:shadow-md hover:border-primary/30 transition-shadow"
                }`}
            >
              {/* Step number + icon */}
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] font-bold tracking-[.16em] text-muted-foreground">
                  STEP {step.step}
                </span>
                <div className={`p-2.5 rounded-lg ${isPlaceholder ? "bg-muted" : "bg-primary/10"}`}>
                  <Icon className={`size-5 ${isPlaceholder ? "text-muted-foreground" : "text-primary"}`} />
                </div>
              </div>

              {/* Title + description */}
              <div>
                <h2 className={`text-lg font-semibold mb-1.5 ${isPlaceholder ? "text-muted-foreground" : "text-card-foreground"}`}>
                  {step.title}
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {step.description}
                </p>
              </div>

              {/* Sub-tools or Coming Soon */}
              {isPlaceholder ? (
                <div className="mt-auto">
                  <span className="inline-flex items-center text-[11px] font-mono px-2.5 py-1 rounded border border-dashed border-border text-muted-foreground bg-muted">
                    Coming Soon
                  </span>
                </div>
              ) : (
                <div className="mt-auto flex flex-col gap-1.5">
                  {step.tools.map((tool) => {
                    const ToolIcon = tool.icon;
                    return (
                      <Link
                        key={tool.path}
                        to={tool.path}
                        className="group flex items-center gap-2.5 px-3 py-2 rounded-md bg-accent/60 hover:bg-accent text-sm text-accent-foreground hover:text-primary transition-colors"
                      >
                        <ToolIcon className="size-3.5 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
                        <span className="flex-1">{tool.label}</span>
                        <ChevronRight className="size-3.5 opacity-0 group-hover:opacity-100 text-primary transition-opacity" />
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </PageLayout>
  );
}
