import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageLayout } from "../components/PageLayout";
import { apiUrl } from "../lib/api";
import { Card, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Users, Clock, Scale, Activity, ChevronRight, Lock, CheckCircle2, Circle, CalendarDays } from "lucide-react";

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
          : <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground"><Circle className="size-3" />Pending</Badge>
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
      description: "Define your agents — skills (voice/chat/email), contract type, LOB assignments, accommodation flags, and weekly availability windows.",
      href: "/scheduling/agents",
      count: counts.agents,
      countLabel: counts.agents === 1 ? "agent" : "agents",
      ready: counts.agents > 0,
      color: "bg-blue-500",
    },
    {
      icon: Clock,
      title: "Shift Template Library",
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
      description: "Configure per-jurisdiction rules (Philippines DOLE, US FLSA, India, and custom). Preset templates are included — add your client's specific jurisdiction.",
      href: "/scheduling/labor-laws",
      count: counts.laws,
      countLabel: `${counts.lawPresets} preset${counts.lawPresets === 1 ? "" : "s"} · ${counts.laws - counts.lawPresets} custom`,
      ready: counts.laws > 0,
      color: "bg-amber-500",
    },
    {
      icon: Activity,
      title: "Coverage Requirements",
      description: "Required FTE per interval — already computed by the Intraday Forecast engine. This is the direct input feed to the scheduling solver.",
      href: "/wfm/intraday",
      count: "✓",
      countLabel: "powered by Intraday Forecast",
      ready: true,
      color: "bg-emerald-500",
    },
  ];

  const completedCount = prerequisites.filter((p) => p.ready).length;
  const allReady = completedCount === prerequisites.length;

  return (
    <PageLayout title="Scheduling Hub">
      <div className="flex flex-col gap-8 pb-12">
        {/* Hero */}
        <section className="rounded-2xl bg-gradient-to-br from-slate-800 to-slate-700 px-6 py-6 shadow-lg">
          <div className="flex items-baseline gap-3 flex-wrap">
            <p className="text-[10px] uppercase tracking-[0.4em] text-slate-300 font-semibold shrink-0">Exordium WFM</p>
            <h1 className="font-bold text-xl md:text-2xl text-white leading-tight">AI-Powered Schedule Generation</h1>
          </div>
          <p className="mt-2 text-sm text-slate-200 max-w-2xl">
            Build your scheduling prerequisites here. Once all four inputs are configured, the Exordium Scheduling Engine will generate constraint-compliant shifts using an optimization solver — respecting SLA targets, labor laws, agent restrictions, and accommodation requirements.
          </p>
          <div className="mt-4 flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 bg-white/10 rounded-lg px-4 py-2">
              <span className="text-2xl font-black text-white">{completedCount}</span>
              <span className="text-sm text-slate-300">of {prerequisites.length} prerequisites ready</span>
            </div>
            <div className="flex gap-1">
              {prerequisites.map((p, i) => (
                <div key={i} className={`w-8 h-2 rounded-full transition-colors ${p.ready ? "bg-emerald-400" : "bg-white/20"}`} />
              ))}
            </div>
            {allReady && (
              <Badge className="bg-emerald-500 text-white">All prerequisites met</Badge>
            )}
          </div>
        </section>

        {/* Prerequisites grid */}
        <div>
          <div className="flex items-center gap-3 mb-4">
            <p className="text-[11px] font-black uppercase tracking-widest text-foreground/50">Step 1 — Configure Prerequisites</p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {prerequisites.map((p) => (
              <PrereqCard key={p.href} {...p} />
            ))}
          </div>
        </div>

        {/* Scheduling Engine — locked card */}
        <div>
          <p className="text-[11px] font-black uppercase tracking-widest text-foreground/50 mb-4">Step 2 — Schedule Generation Engine</p>
          <div className={`rounded-xl border-2 border-dashed p-8 flex flex-col items-center text-center gap-4 transition-colors ${allReady ? "border-primary/40 bg-primary/5" : "border-border bg-muted/30"}`}>
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center ${allReady ? "bg-primary/10" : "bg-muted"}`}>
              {allReady
                ? <CalendarDays className="size-8 text-primary" />
                : <Lock className="size-8 text-muted-foreground" />
              }
            </div>
            <div>
              <h3 className="font-bold text-lg text-foreground">
                {allReady ? "Scheduling Engine Ready" : "Scheduling Engine"}
              </h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-md">
                {allReady
                  ? "All prerequisites are configured. The scheduling engine will be available in an upcoming release."
                  : `Complete all ${prerequisites.length} prerequisites above to unlock AI-powered schedule generation. The engine uses a constraint satisfaction solver to produce labor-law-compliant, SLA-optimized shift assignments.`
                }
              </p>
            </div>
            <Badge variant="outline" className="gap-1.5 text-xs">
              <Lock className="size-3" />
              Coming Soon — Scheduling Engine v1.0
            </Badge>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
