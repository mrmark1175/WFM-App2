import { Link, useLocation } from "react-router-dom";
import { Home, ChevronRight, Search, Bell, Share2, User, Settings, LayoutDashboard, TrendingUp, Calendar, Users, Clock, Database, Phone, Building2, Activity, ChevronLeft, LineChart } from "lucide-react";
import React, { useState } from "react";
import { Toaster } from "./ui/sonner";
import { LOBSelector } from "./LOBSelector";
import logo from "../../assets/logo.png";

interface PageLayoutProps {
  children: React.ReactNode;
  title?: string; // now optional — pages own their own headers
}

const NAV: { group: string; items: { to: string; label: string; icon: React.ElementType; badge?: string }[] }[] = [
  { group: "Forecasting", items: [
    { to: "/",                               label: "Home",                 icon: Home },
    { to: "/wfm/long-term-forecasting-demand", label: "Demand Forecasting",  icon: TrendingUp, badge: "12" },
    { to: "/wfm/long-term-forecasting",      label: "Strategic Planning",   icon: LayoutDashboard },
    { to: "/wfm/intraday",                   label: "Intraday Forecast",    icon: Activity },
    { to: "/wfm/arrival-analysis",           label: "Arrival Analysis",     icon: LineChart },
    { to: "/wfm/interaction-arrival",        label: "Interaction Arrival",  icon: Clock },
  ]},
  { group: "Planning", items: [
    { to: "/wfm/capacity",                   label: "Workforce Planning",   icon: Calendar },
    { to: "/wfm/performance-analytics",      label: "Performance Analytics", icon: Activity },
  ]},
  { group: "Data", items: [
    { to: "/wfm/roster",                     label: "Employee Roster",      icon: Users },
    { to: "/wfm/telephony-raw",              label: "Telephony Raw Data",   icon: Phone },
  ]},
  { group: "Settings", items: [
    { to: "/configuration",                  label: "Configuration",        icon: Settings },
    { to: "/my-account",                     label: "My Account",           icon: User },
  ]},
];

const CRUMB_NAMES: Record<string, string> = {
  wfm: "Workforce Management",
  "long-term-forecasting-demand": "Demand Forecasting",
  "long-term-forecasting": "Strategic Planning",
  "long-term-forecasting-blended": "Blended Forecast",
  capacity: "Workforce Planning",
  intraday: "Intraday Forecast",
  "interaction-arrival": "Interaction Arrival",
  "arrival-analysis": "Arrival Analysis",
  "telephony-raw": "Telephony Raw Data",
  "performance-analytics": "Performance Analytics",
  roster: "Employee Roster",
  "my-account": "My Account",
  configuration: "Configuration",
  forecasting: "Forecasting",
};

export function PageLayout({ children, title }: PageLayoutProps) {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const pathnames = location.pathname.split("/").filter(Boolean);

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <Toaster richColors position="top-right" />

      {/* ── Topbar (44px, near-black) ── */}
      <header className="sticky top-0 z-40 h-11 bg-shell text-[#dedbcf] border-b border-black flex items-center px-3 gap-3">
        <div className={`flex items-center gap-2 ${collapsed ? "w-[52px]" : "w-[208px]"} transition-[width]`}>
          <img src={logo} alt="Exordium" className="h-6 w-auto" />
          {!collapsed && (
            <>
              <span className="text-[13px] font-semibold text-[#ede9dc] tracking-tight">Exordium</span>
              <span className="ml-auto font-mono text-[10.5px] text-[#7a7b7a] uppercase tracking-wider">WFM</span>
            </>
          )}
        </div>

        <nav className="flex items-center gap-1.5 text-[12px] text-[#b6b3a8]">
          <Home className="size-3.5 opacity-75" />
          <Link to="/" className="hover:text-[#ede9dc]">Home</Link>
          {pathnames.map((seg, i) => {
            const last = i === pathnames.length - 1;
            const to = "/" + pathnames.slice(0, i + 1).join("/");
            const name = CRUMB_NAMES[seg] || seg;
            return (
              <React.Fragment key={to}>
                <ChevronRight className="size-3 text-[#4a4c50]" />
                {last
                  ? <span className="text-[#ede9dc] font-medium">{name}</span>
                  : <Link to={to} className="hover:text-[#ede9dc]">{name}</Link>}
              </React.Fragment>
            );
          })}
        </nav>

        <LOBSelector className="ml-auto" />

        <div className="flex items-center gap-1">
          <div className="font-mono text-[10.5px] tracking-wider uppercase text-[#c3b36a] border border-[#3d381e] bg-[#1b1811] px-1.5 py-0.5 rounded">
            Tier 1 · Prod
          </div>
          <button className="h-[26px] px-2.5 rounded inline-flex items-center gap-1.5 text-[12px] text-[#cfccbf] hover:bg-[#1a1c20] hover:text-[#f1eede]">
            <Search className="size-3.5" /> Search
            <span className="font-mono text-[11px] text-[#7c7d7a] border border-[#2a2c30] px-1 h-[22px] leading-[22px] rounded ml-1">⌘K</span>
          </button>
          <button className="h-[26px] px-2.5 rounded inline-flex items-center text-[#cfccbf] hover:bg-[#1a1c20]"><Bell className="size-3.5"/></button>
          <button className="h-[26px] px-2.5 rounded inline-flex items-center gap-1.5 text-[12px] text-[#cfccbf] hover:bg-[#1a1c20]"><Share2 className="size-3.5"/> Share</button>
          <div className="size-6 rounded-full bg-gradient-to-br from-[#b8b5a6] to-[#6e6b5f] text-[#0c0d10] text-[10.5px] font-semibold grid place-items-center ml-1">MK</div>
        </div>
      </header>

      <div className={`grid min-h-[calc(100vh-44px)] ${collapsed ? "grid-cols-[56px_1fr]" : "grid-cols-[220px_1fr]"} transition-[grid-template-columns]`}>
        <aside className="bg-shell text-[#a8a79b] border-r border-black py-3 px-2 overflow-auto">
          {NAV.map(g => (
            <div key={g.group} className="mt-3 first:mt-0">
              <div className={`font-mono text-[10px] text-[#55574f] uppercase tracking-[.14em] px-2.5 pb-1.5 ${collapsed ? "invisible h-0 p-0" : ""}`}>{g.group}</div>
              {g.items.map(it => {
                const Icon = it.icon;
                const active = location.pathname === it.to;
                return (
                  <Link key={it.to} to={it.to}
                    className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded text-[12.5px] ${active
                      ? "bg-[#1c1e22] text-[#ede9dc] shadow-[inset_2px_0_0_var(--indigo)]"
                      : "text-[#b5b3a5] hover:bg-[#17181c] hover:text-[#efecdf]"}`}>
                    <Icon className="size-3.5 shrink-0 opacity-85" />
                    {!collapsed && <span>{it.label}</span>}
                    {!collapsed && it.badge && (
                      <span className="ml-auto font-mono text-[10px] text-[#6e6f68] bg-[#17181c] border border-[#23252a] px-1.5 py-[1px] rounded">{it.badge}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
          <button onClick={() => setCollapsed(!collapsed)}
            className="mt-2 w-full h-[22px] flex items-center justify-center text-[#55574f] font-mono text-[10px] border border-dashed border-[#23252a] rounded hover:text-[#a8a79b] tracking-wider">
            {collapsed ? "»" : "« collapse"}
          </button>
        </aside>

        <main className="bg-canvas overflow-auto">
          {title && (
            <div className="px-[18px] py-4 border-b border-hairline">
              <h1 className="text-[20px] font-semibold tracking-tight text-ink">{title}</h1>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
