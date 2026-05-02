import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageLayout } from "../components/PageLayout";
import { apiUrl } from "../lib/api";
import { Card, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import {
  Activity,
  ArrowRight,
  Building2,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock,
  Eye,
  FileCheck2,
  ListChecks,
  Scale,
  Send,
  Settings2,
  Users,
} from "lucide-react";
import { Button } from "../components/ui/button";

interface HubCounts { agents: number; shifts: number; laws: number; lawPresets: number; }

function PrereqCard({
  icon: Icon,
  title,
  description,
  href,
  count,
  countLabel,
  ready,
  color,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  href: string;
  count: number | string;
  countLabel: string;
  ready: boolean;
  color: string;
}) {
  return (
    <Link
      to={href}
      className="group relative bg-card border border-border rounded-xl p-6 hover:shadow-lg hover:border-primary/30 transition-all flex flex-col gap-4"
    >
      <div className="flex items-start justify-between">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${color}`}>
          <Icon className="size-6 text-white" />
        </div>
        {ready
          ? <Badge className="bg-emerald-500 text-white gap-1 text-[10px]"><CheckCircle2 className="size-3" />Ready</Badge>
          : <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground"><Circle className="size-3" />Setup</Badge>
        }
      </div>
      <div>
        <h3 className="font-bold text-base text-foreground group-hover:text-primary transition-colors">{title}</h3>
        <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{description}</p>
      </div>
      <div className="flex items-center justify-between mt-auto pt-3 border-t border-border/60">
        <span className="text-2xl font-black text-foreground">{count}</span>
        <span className="text-xs text-muted-foreground">{countLabel}</span>
        <ChevronRight className="size-4 text-muted-foreground group-hover:text-primary transition-colors ml-auto" />
      </div>
    </Link>
  );
}

function WorkflowCard({
  step,
  icon: Icon,
  title,
  description,
  href,
  action,
  ready,
  accent,
}: {
  step: number;
  icon: React.ElementType;
  title: string;
  description: string;
  href: string;
  action: string;
  ready?: boolean;
  accent: string;
}) {
  return (
    <Link
      to={href}
      className="group rounded-xl border border-border bg-card p-5 transition-all hover:border-primary/30 hover:shadow-md"
    >
      <div className="flex items-start gap-4">
        <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${accent}`}>
          <Icon className="size-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Step {step}</p>
              <h3 className="mt-1 font-bold text-foreground group-hover:text-primary">{title}</h3>
            </div>
            {ready !== undefined && (
              ready
                ? <Badge className="shrink-0 bg-emerald-500 text-white gap-1 text-[10px]"><CheckCircle2 className="size-3" />Ready</Badge>
                : <Badge variant="outline" className="shrink-0 gap-1 text-[10px] text-muted-foreground"><Circle className="size-3" />Setup</Badge>
            )}
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
          <div className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
            {action}<ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </div>
        </div>
      </div>
    </Link>
  );
}

export function SchedulingHub() {
  const [counts, setCounts] = useState<HubCounts>({ agents: 0, shifts: 0, laws: 0, lawPresets: 0 });

  useEffect(() => {
    fetch(apiUrl("/api/scheduling/counts"))
      .then((r) => r.json())
      .then((d) => { if (d && typeof d.agents === "number") setCounts(d); })
      .catch(() => {});
  }, []);

  const prerequisites = [
    {
      icon: Users,
      title: "Agent Roster",
      description: "Define agents, skills, LOB assignments, accommodation flags, weekly availability, teams, and linked logins.",
      href: "/scheduling/agents",
      count: counts.agents,
      countLabel: counts.agents === 1 ? "agent" : "agents",
      ready: counts.agents > 0,
      color: "bg-blue-500",
    },
    {
      icon: Clock,
      title: "Shift Templates",
      description: "Build reusable shift patterns with start/end times, channel coverage, break rules, and overnight flags.",
      href: "/scheduling/shifts",
      count: counts.shifts,
      countLabel: counts.shifts === 1 ? "template" : "templates",
      ready: counts.shifts > 0,
      color: "bg-violet-500",
    },
    {
      icon: Scale,
      title: "Labor Law Rules",
      description: "Use preset regional rules or add client-specific constraints before generating schedule drafts.",
      href: "/scheduling/labor-laws",
      count: counts.laws,
      countLabel: `${counts.lawPresets} preset${counts.lawPresets === 1 ? "" : "s"} / ${counts.laws - counts.lawPresets} custom`,
      ready: counts.laws > 0,
      color: "bg-amber-500",
    },
    {
      icon: Activity,
      title: "Demand Snapshot",
      description: "Approve required FTE from Intraday Forecast so Schedule Editor has a frozen demand input for generation.",
      href: "/wfm/intraday",
      count: "FTE",
      countLabel: "approved from Intraday",
      ready: true,
      color: "bg-emerald-500",
    },
  ];

  const completedCount = prerequisites.filter((p) => p.ready).length;
  const allReady = completedCount === prerequisites.length;

  const workflow = [
    {
      step: 1,
      icon: Building2,
      title: "Configure LOB Settings",
      description: "Confirm active channels, operating hours, AHT, SLA, concurrency, and timezone assumptions for the selected LOB.",
      href: "/configuration/lob-settings",
      action: "Open LOB Settings",
      accent: "bg-sky-600",
    },
    {
      step: 2,
      icon: Users,
      title: "Manage Agent Roster",
      description: "Import or maintain agents, skills, LOB assignments, availability windows, teams, and linked agent logins.",
      href: "/scheduling/agents",
      action: "Open Agent Roster",
      ready: counts.agents > 0,
      accent: "bg-blue-500",
    },
    {
      step: 3,
      icon: Activity,
      title: "Approve Demand Snapshot",
      description: "Use Intraday Forecast to commit required FTE and approve a demand snapshot for schedule generation.",
      href: "/wfm/intraday",
      action: "Open Intraday Forecast",
      accent: "bg-emerald-500",
    },
    {
      step: 4,
      icon: ListChecks,
      title: "Configure Scheduling Rules",
      description: "Set shift templates, generation rules, and labor-law constraints before generating drafts.",
      href: "/scheduling/scheduler-rules",
      action: "Open Scheduler Rules",
      ready: counts.shifts > 0 && counts.laws > 0,
      accent: "bg-violet-500",
    },
    {
      step: 5,
      icon: CalendarDays,
      title: "Generate Schedules",
      description: "Open Schedule Editor, choose an approved demand snapshot, and generate draft shifts for the planning horizon.",
      href: "/scheduling/schedule",
      action: "Open Schedule Editor",
      ready: allReady,
      accent: "bg-indigo-600",
    },
    {
      step: 6,
      icon: Eye,
      title: "Review And Edit Drafts",
      description: "Inspect generated coverage, adjust shifts and activities, and keep published schedules untouched until ready.",
      href: "/scheduling/schedule",
      action: "Review Drafts",
      accent: "bg-slate-600",
    },
    {
      step: 7,
      icon: Send,
      title: "Publish Schedules",
      description: "Publish drafts for the whole LOB, a team, or selected agents when the schedule is ready for use.",
      href: "/scheduling/schedule",
      action: "Publish In Schedule Editor",
      accent: "bg-teal-600",
    },
    {
      step: 8,
      icon: CalendarCheck,
      title: "Agents View Published Schedules",
      description: "Agents can open My Schedule to see published shifts and use manual punch status during pilot operations.",
      href: "/agent/today",
      action: "Open My Schedule",
      accent: "bg-amber-500",
    },
  ];

  return (
    <PageLayout title="Scheduling Hub">
      <div className="flex flex-col gap-8 pb-12">
        <section className="rounded-2xl bg-gradient-to-br from-slate-800 to-slate-700 px-6 py-6 shadow-lg">
          <div className="flex items-baseline gap-3 flex-wrap">
            <p className="text-[10px] uppercase tracking-[0.4em] text-slate-300 font-semibold shrink-0">Exordium WFM</p>
            <h1 className="font-bold text-xl md:text-2xl text-white leading-tight">Scheduling Workflow</h1>
          </div>
          <p className="mt-2 text-sm text-slate-200 max-w-2xl">
            Run the current scheduling flow from setup through published agent schedules. Start with LOB assumptions and roster data, approve demand from Intraday Forecast, then generate, review, edit, and publish drafts in Schedule Editor.
          </p>
          <div className="mt-4 flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 bg-white/10 rounded-lg px-4 py-2">
              <span className="text-2xl font-black text-white">{completedCount}</span>
              <span className="text-sm text-slate-300">of {prerequisites.length} readiness checks complete</span>
            </div>
            <div className="flex gap-1">
              {prerequisites.map((p, i) => (
                <div key={i} className={`w-8 h-2 rounded-full transition-colors ${p.ready ? "bg-emerald-400" : "bg-white/20"}`} />
              ))}
            </div>
            {allReady && (
              <Badge className="bg-emerald-500 text-white">Ready for schedule generation</Badge>
            )}
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link to="/scheduling/schedule">
              <Button className="gap-2 bg-white text-slate-900 hover:bg-slate-100">
                <CalendarDays className="size-4" />Open Schedule Editor
              </Button>
            </Link>
            <Link to="/wfm/intraday">
              <Button variant="outline" className="gap-2 border-white/40 bg-white/10 text-white hover:bg-white/20 hover:text-white">
                <FileCheck2 className="size-4" />Approve Demand Snapshot
              </Button>
            </Link>
          </div>
        </section>

        <div>
          <div className="flex items-center gap-3 mb-4">
            <p className="text-[11px] font-black uppercase tracking-widest text-foreground/50">Readiness Checks</p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {prerequisites.map((p) => (
              <PrereqCard key={p.href} {...p} />
            ))}
          </div>
        </div>

        <div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-black uppercase tracking-widest text-foreground/50">Pilot Scheduling Workflow</p>
              <p className="mt-1 text-sm text-muted-foreground">
                These links use the scheduling features already available in the app.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to="/scheduling/shifts">
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Clock className="size-3.5" />Shift Templates
                </Button>
              </Link>
              <Link to="/scheduling/labor-laws">
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Scale className="size-3.5" />Labor Laws
                </Button>
              </Link>
              <Link to="/scheduling/scheduler-rules">
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Settings2 className="size-3.5" />Rules
                </Button>
              </Link>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {workflow.map((item) => (
              <WorkflowCard key={`${item.step}-${item.href}-${item.title}`} {...item} />
            ))}
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
