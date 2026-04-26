import { Link, useLocation } from "react-router-dom";
import { Home, ChevronRight, User, Settings, TrendingUp, Calendar, Users, Clock, Building2, LineChart, Layers, CalendarDays, UserCheck, Scale, BarChart3 } from "lucide-react";
import React, { useEffect, useState } from "react";
import { Toaster } from "./ui/sonner";
import { LOBSelector } from "./LOBSelector";
import { WhatIfSelector } from "./WhatIfSelector";
import { WFMAssistant } from "./WFMAssistant";
import { useWFMPageData } from "../lib/WFMPageDataContext";
import logo from "../../assets/logo-new.jpg";

interface PageLayoutProps {
  children: React.ReactNode;
  title?: string; // now optional — pages own their own headers
}

const NAV: { group: string; items: { to: string; label: string; icon: React.ElementType; badge?: string }[] }[] = [
  { group: "Forecasting", items: [
    { to: "/wfm/long-term-forecasting-demand", label: "Demand Forecasting", icon: LineChart },
    { to: "/wfm/shrinkage",                    label: "Shrinkage Planning", icon: Layers },
    { to: "/wfm/intraday",                     label: "Intraday Forecast",  icon: TrendingUp },
  ]},
  { group: "Capacity Management", items: [
    { to: "/wfm/capacity",                     label: "Workforce Planning", icon: Users },
  ]},
  { group: "Scheduling", items: [
    { to: "/scheduling",                       label: "Scheduling Hub",     icon: CalendarDays },
    { to: "/scheduling/schedule",              label: "Schedule Editor",    icon: Calendar },
    { to: "/scheduling/agents",                label: "Agent Roster",       icon: UserCheck },
    { to: "/scheduling/shifts",                label: "Shift Templates",    icon: Clock },
    { to: "/scheduling/labor-laws",            label: "Labor Law Rules",    icon: Scale },
  ]},
  { group: "RTA & Traffic", items: [
    { to: "/wfm", label: "Coming Soon", icon: BarChart3, badge: "Soon" },
  ]},
  { group: "Settings", items: [
    { to: "/configuration",                    label: "Configuration",      icon: Settings },
    { to: "/configuration/lob-management",     label: "LOB Management",     icon: Building2 },
    { to: "/my-account",                       label: "My Account",         icon: User },
  ]},
];

const CRUMB_NAMES: Record<string, string> = {
  wfm: "Workforce Management",
  "long-term-forecasting-demand": "Demand Forecasting",
  capacity: "Workforce Planning",
  intraday: "Intraday Forecast",
  shrinkage: "Shrinkage Planning",
  "my-account": "My Account",
  configuration: "Configuration",
  "lob-management": "LOB Management",
  scheduling: "Scheduling",
  schedule: "Schedule Editor",
  agents: "Agent Roster",
  shifts: "Shift Templates",
  "labor-laws": "Labor Law Rules",
};

export function PageLayout({ children, title }: PageLayoutProps) {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const { registerOpenAssistant } = useWFMPageData();
  useEffect(() => { registerOpenAssistant(() => setAssistantOpen(true)); }, []);
  const pathnames = location.pathname.split("/").filter(Boolean);

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <Toaster richColors position="top-right" />

      {/* ── Topbar (44px, near-black) ── */}
      <header className="sticky top-0 z-40 h-11 bg-[#1111D4] text-white border-b border-[#0a0aa8] flex items-center px-3 gap-3">
        <div className={`flex items-center ${collapsed ? "w-[52px]" : "w-[208px]"} transition-[width] overflow-hidden`}>
          <div className="bg-white rounded-md px-2 py-0.5 shrink-0">
            <img src={logo} alt="Exordium WFM" className="h-[28px] w-auto" />
          </div>
        </div>

        <nav className="flex items-center gap-1.5 text-[12px] text-white/85">
          <Home className="size-3.5 opacity-85" />
          <Link to="/" className="hover:text-white">Home</Link>
          {pathnames.map((seg, i) => {
            const last = i === pathnames.length - 1;
            const to = "/" + pathnames.slice(0, i + 1).join("/");
            const name = CRUMB_NAMES[seg] || seg;
            return (
              <React.Fragment key={to}>
                <ChevronRight className="size-3 text-white/60" />
                {last
                  ? <span className="text-white font-medium">{name}</span>
                  : <Link to={to} className="hover:text-white">{name}</Link>}
              </React.Fragment>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <LOBSelector />
          <WhatIfSelector />
        </div>
      </header>

      <div className="grid min-h-[calc(100vh-44px)] transition-[grid-template-columns]"
        style={{ gridTemplateColumns: `${collapsed ? "56px" : "220px"} 1fr${assistantOpen ? " 320px" : ""}` }}>
        <aside className="sticky top-11 h-[calc(100vh-44px)] bg-[#1111D4] text-white border-r border-[#0a0aa8] py-3 px-2 overflow-y-auto self-start">
          {NAV.map(g => (
            <div key={g.group} className="mt-3 first:mt-0">
              <div className={`font-mono text-[10px] text-white/70 uppercase tracking-[.14em] px-2.5 pb-1.5 ${collapsed ? "invisible h-0 p-0" : ""}`}>{g.group}</div>
              {g.items.map(it => {
                const Icon = it.icon;
                const active = location.pathname === it.to;
                return (
                  <Link key={it.to} to={it.to}
                    className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded text-[12.5px] ${active
                      ? "bg-white/20 text-white shadow-[inset_2px_0_0_#ffffff]"
                      : "text-white/85 hover:bg-white/12 hover:text-white"}`}>
                    <Icon className="size-3.5 shrink-0 opacity-85" />
                    {!collapsed && <span>{it.label}</span>}
                    {!collapsed && it.badge && (
                      <span className="ml-auto font-mono text-[10px] text-white/90 bg-white/15 border border-white/25 px-1.5 py-[1px] rounded">{it.badge}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
          <button onClick={() => setCollapsed(!collapsed)}
            className="mt-2 w-full h-[22px] flex items-center justify-center text-white/80 font-mono text-[10px] border border-dashed border-white/40 rounded hover:text-white tracking-wider">
            {collapsed ? "»" : "« collapse"}
          </button>
        </aside>

        <main className="bg-canvas overflow-auto pl-6">
          {title && (
            <div className="px-[18px] py-4 border-b border-hairline">
              <h1 className="text-[20px] font-semibold tracking-tight text-ink">{title}</h1>
            </div>
          )}
          {children}
        </main>

        {/* WFM Assistant — sticky right panel (always rendered; collapsed tab is position:fixed) */}
        {assistantOpen && (
          <div className="sticky top-11 h-[calc(100vh-44px)] self-start">
            <WFMAssistant open={true} onToggle={() => setAssistantOpen(false)} />
          </div>
        )}
      </div>

      {/* Collapsed tab — rendered outside the grid so position:fixed works */}
      {!assistantOpen && (
        <WFMAssistant open={false} onToggle={() => setAssistantOpen(true)} />
      )}
    </div>
  );
}
