import { Link, useLocation } from "react-router-dom";
import {
  Home,
  ChevronRight,
  LineChart,
  Layers,
  TrendingUp,
  BarChart2,
  Grid,
  Users,
  BarChart3,
  CalendarDays,
  UserCheck,
  Clock,
  Scale,
  UserCog,
  Database,
  Settings,
  User,
  Building2,
  PanelLeftOpen,
  PanelLeftClose,
  LogOut,
  KeyRound,
  Eye,
  EyeOff,
} from "lucide-react";
import logo from "../../assets/logo.svg";
import React, { useState } from "react";
import { Toaster } from "./ui/sonner";
import { LOBSelector } from "./LOBSelector";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { apiUrl } from "../lib/api";
import { toast } from "sonner";

// ── Types ────────────────────────────────────────────────────────────────────

interface NavItem {
  label: string;
  icon: React.ElementType;
  path: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

interface PageLayoutProps {
  children: React.ReactNode;
  title: string;
}

// ── Nav structure ────────────────────────────────────────────────────────────

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Forecasting",
    items: [
      { label: "Demand Forecasting",  icon: LineChart,    path: "/wfm/long-term-forecasting-demand" },
      { label: "Shrinkage Planning",  icon: Layers,       path: "/wfm/shrinkage" },
      { label: "Intraday Forecast",   icon: TrendingUp,   path: "/wfm/intraday" },
      { label: "Arrival Analysis",    icon: BarChart2,    path: "/wfm/arrival-analysis" },
      { label: "Interaction Arrival", icon: Grid,         path: "/wfm/interaction-arrival" },
    ],
  },
  {
    label: "Planning",
    items: [
      { label: "Workforce Planning",    icon: Users,     path: "/wfm/capacity" },
      { label: "Performance Analytics", icon: BarChart3, path: "/wfm/performance-analytics" },
    ],
  },
  {
    label: "Scheduling",
    items: [
      { label: "Scheduling Hub",   icon: CalendarDays, path: "/scheduling" },
      { label: "Schedule Editor",  icon: Grid,         path: "/scheduling/schedule" },
      { label: "Agent Roster",     icon: UserCheck,    path: "/scheduling/agents" },
      { label: "Shift Templates",  icon: Clock,        path: "/scheduling/shifts" },
      { label: "Labor Law Rules",  icon: Scale,        path: "/scheduling/labor-laws" },
    ],
  },
  {
    label: "Data",
    items: [
      { label: "Employee Roster",     icon: UserCog,  path: "/wfm/roster" },
      { label: "Telephony Raw Data",  icon: Database, path: "/wfm/telephony-raw" },
    ],
  },
  {
    label: "Settings",
    items: [
      { label: "Configuration",   icon: Settings,   path: "/configuration" },
      { label: "LOB Management",  icon: Building2,  path: "/configuration/lob-management" },
      { label: "My Account",      icon: User,       path: "/my-account" },
    ],
  },
];

const BREADCRUMB_NAMES: Record<string, string> = {
  wfm:                          "Workforce Management",
  roster:                       "Employee Roster",
  forecasting:                  "Forecasting",
  capacity:                     "Workforce Planning",
  shrinkage:                    "Shrinkage Planning",
  intraday:                     "Intraday Forecast",
  "my-account":                 "My Account",
  configuration:                "Configuration",
  scheduling:                   "Scheduling",
  agents:                       "Agent Roster",
  shifts:                       "Shift Templates",
  "labor-laws":                 "Labor Law Rules",
  "long-term-forecasting-demand": "Demand Forecasting",
  "arrival-analysis":           "Arrival Analysis",
  "interaction-arrival":        "Interaction Arrival",
  "performance-analytics":      "Performance Analytics",
  "telephony-raw":              "Telephony Raw Data",
  "lob-management":             "LOB Management",
  "lob-settings":               "LOB Settings",
};

const SIDEBAR_KEY = "wfm_sidebar_expanded";

// ── Sub-components ───────────────────────────────────────────────────────────

function SideNavItem({
  item,
  expanded,
  active,
}: {
  item: NavItem;
  expanded: boolean;
  active: boolean;
}) {
  const Icon = item.icon;
  const linkClass = [
    "flex items-center gap-3 rounded-md px-2 py-2 text-sm font-medium transition-colors",
    active
      ? "bg-primary/10 text-primary"
      : "text-muted-foreground hover:bg-accent hover:text-foreground",
    !expanded && "justify-center",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link to={item.path} className={linkClass}>
          <span className="flex items-center justify-center size-6 rounded-md bg-blue-700 dark:bg-blue-600 shrink-0">
            <Icon className="size-3.5 text-white" />
          </span>
          {expanded && <span className="truncate leading-none">{item.label}</span>}
        </Link>
      </TooltipTrigger>
      {!expanded && (
        <TooltipContent side="right" sideOffset={8}>
          {item.label}
        </TooltipContent>
      )}
    </Tooltip>
  );
}

// ── Main layout ──────────────────────────────────────────────────────────────

export function PageLayout({ children, title }: PageLayoutProps) {
  const location = useLocation();

  const [expanded, setExpanded] = useState<boolean>(() => {
    const stored = localStorage.getItem(SIDEBAR_KEY);
    return stored === null ? true : stored === "true";
  });

  // ── Account menu state ───────────────────────────────────────────────────────
  const [accountOpen, setAccountOpen] = useState(false);
  const [changePwOpen, setChangePwOpen] = useState(false);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showCur, setShowCur] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pwLoading, setPwLoading] = useState(false);

  function openChangePw() { setChangePwOpen(true); setAccountOpen(false); setCurPw(""); setNewPw(""); setConfirmPw(""); setPwError(""); }

  async function handleChangePw(e: React.FormEvent) {
    e.preventDefault();
    setPwError("");
    if (newPw !== confirmPw) { setPwError("Passwords do not match"); return; }
    if (newPw.length < 6) { setPwError("Password must be at least 6 characters"); return; }
    setPwLoading(true);
    try {
      const res = await fetch(apiUrl("/api/auth/change-password"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: curPw, newPassword: newPw }),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) { setPwError(data.error || "Failed to change password"); return; }
      setChangePwOpen(false);
      toast.success("Password changed successfully");
    } catch {
      setPwError("Could not reach server");
    } finally {
      setPwLoading(false);
    }
  }

  async function handleLogout() {
    await fetch(apiUrl("/api/auth/logout"), { method: "POST", credentials: "include" });
    window.location.reload();
  }

  const toggle = () => {
    setExpanded((v) => {
      localStorage.setItem(SIDEBAR_KEY, String(!v));
      return !v;
    });
  };

  // Active: exact match or prefix match (so /scheduling is active on /scheduling/agents)
  const isActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(path + "/");

  const pathnames = location.pathname.split("/").filter(Boolean);

  return (
    <TooltipProvider delayDuration={100}>
      <div className="min-h-screen bg-background flex">
        <Toaster richColors position="top-right" />

        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <aside
          className={[
            "fixed top-0 left-0 h-full z-40 bg-card border-r border-border",
            "flex flex-col overflow-hidden",
            "transition-[width] duration-300 ease-in-out",
            expanded ? "w-60" : "w-14",
          ].join(" ")}
        >
          {/* Header: logo + toggle */}
          <div className="flex items-center h-16 px-3 border-b border-border shrink-0 gap-2">
            {expanded && (
              <Link to="/" className="flex-1 min-w-0">
                <img src={logo} alt="Exordium WFM" className="h-10 w-auto" />
              </Link>
            )}
            <button
              onClick={toggle}
              className={[
                "p-1.5 rounded-md hover:bg-accent transition-colors shrink-0",
                !expanded && "mx-auto",
              ].join(" ")}
              aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
            >
              {expanded ? (
                <PanelLeftClose className="size-4 text-muted-foreground" />
              ) : (
                <PanelLeftOpen className="size-4 text-muted-foreground" />
              )}
            </button>
          </div>

          {/* Home link */}
          <div className="px-2 pt-3 pb-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  to="/"
                  className={[
                    "flex items-center gap-3 rounded-md px-2 py-2 text-sm font-medium transition-colors",
                    location.pathname === "/"
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    !expanded && "justify-center",
                  ].join(" ")}
                >
                  <span className="flex items-center justify-center size-6 rounded-md bg-blue-700 dark:bg-blue-600 shrink-0">
                    <Home className="size-3.5 text-white" />
                  </span>
                  {expanded && <span className="truncate leading-none">Home</span>}
                </Link>
              </TooltipTrigger>
              {!expanded && (
                <TooltipContent side="right" sideOffset={8}>Home</TooltipContent>
              )}
            </Tooltip>
          </div>

          {/* Nav groups */}
          <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 pb-4 space-y-4">
            {NAV_GROUPS.map((group) => (
              <div key={group.label}>
                {expanded && (
                  <p className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 select-none">
                    {group.label}
                  </p>
                )}
                {!expanded && (
                  <div className="my-1 border-t border-border/60" />
                )}
                <div className="space-y-0.5">
                  {group.items.map((item) => (
                    <SideNavItem
                      key={item.path}
                      item={item}
                      expanded={expanded}
                      active={isActive(item.path)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        {/* ── Main area ───────────────────────────────────────────────────── */}
        <div
          className={[
            "flex flex-col min-w-0 flex-1",
            "transition-[margin-left] duration-300 ease-in-out",
            expanded ? "ml-60" : "ml-14",
          ].join(" ")}
        >
          {/* Top bar */}
          <header className="sticky top-0 z-30 bg-card border-b border-border px-6 h-16 flex items-center justify-between shrink-0">
            {/* Breadcrumbs */}
            <nav className="flex items-center gap-1.5 text-sm text-muted-foreground min-w-0">
              <Link
                to="/"
                className="hover:text-primary flex items-center gap-1 transition-colors shrink-0"
              >
                <Home className="size-3.5" />
                <span>Home</span>
              </Link>
              {pathnames.map((value, index) => {
                const last = index === pathnames.length - 1;
                const to = `/${pathnames.slice(0, index + 1).join("/")}`;
                const name =
                  BREADCRUMB_NAMES[value] ||
                  value.charAt(0).toUpperCase() + value.slice(1);
                return (
                  <React.Fragment key={to}>
                    <ChevronRight className="size-3.5 opacity-40 shrink-0" />
                    {last ? (
                      <span className="font-medium text-foreground truncate">{name}</span>
                    ) : (
                      <Link to={to} className="hover:text-primary transition-colors shrink-0">
                        {name}
                      </Link>
                    )}
                  </React.Fragment>
                );
              })}
            </nav>

            <div className="flex items-center gap-3 shrink-0 ml-4">
              <LOBSelector />

              {/* Account dropdown trigger */}
              <div className="relative">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setAccountOpen(v => !v)}
                      className="p-1.5 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                    >
                      <User className="size-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Account</TooltipContent>
                </Tooltip>

                {accountOpen && (
                  <>
                    {/* Backdrop */}
                    <div className="fixed inset-0 z-40" onClick={() => setAccountOpen(false)} />
                    {/* Dropdown */}
                    <div className="absolute right-0 top-full mt-1 w-44 bg-popover border border-border rounded-lg shadow-lg z-50 py-1 overflow-hidden">
                      <button
                        onClick={openChangePw}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors text-left"
                      >
                        <KeyRound className="size-3.5 text-muted-foreground" />
                        Change password
                      </button>
                      <div className="h-px bg-border mx-2 my-1" />
                      <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors text-left text-destructive"
                      >
                        <LogOut className="size-3.5" />
                        Sign out
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </header>

          {/* Change Password dialog */}
          <Dialog open={changePwOpen} onOpenChange={setChangePwOpen}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <KeyRound className="size-4 text-muted-foreground" />
                  Change password
                </DialogTitle>
              </DialogHeader>
              <form onSubmit={handleChangePw} className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label>Current password</Label>
                  <div className="relative">
                    <Input
                      type={showCur ? "text" : "password"}
                      value={curPw}
                      onChange={e => setCurPw(e.target.value)}
                      placeholder="Current password"
                      className="pr-10"
                      required
                    />
                    <button type="button" onClick={() => setShowCur(v => !v)} className="absolute inset-y-0 right-2.5 flex items-center text-muted-foreground hover:text-foreground" tabIndex={-1}>
                      {showCur ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>New password</Label>
                  <div className="relative">
                    <Input
                      type={showNew ? "text" : "password"}
                      value={newPw}
                      onChange={e => setNewPw(e.target.value)}
                      placeholder="New password (min 6 chars)"
                      className="pr-10"
                      required
                    />
                    <button type="button" onClick={() => setShowNew(v => !v)} className="absolute inset-y-0 right-2.5 flex items-center text-muted-foreground hover:text-foreground" tabIndex={-1}>
                      {showNew ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Confirm new password</Label>
                  <Input
                    type="password"
                    value={confirmPw}
                    onChange={e => setConfirmPw(e.target.value)}
                    placeholder="Confirm new password"
                    required
                  />
                </div>
                {pwError && <p className="text-sm text-destructive">{pwError}</p>}
                <DialogFooter>
                  <Button type="button" variant="outline" size="sm" onClick={() => setChangePwOpen(false)}>Cancel</Button>
                  <Button type="submit" size="sm" disabled={pwLoading}>
                    {pwLoading ? "Saving…" : "Save"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          {/* Page content */}
          <main className="flex-1 w-full max-w-[1920px] mx-auto px-8 py-8">
            <h1 className="text-3xl mb-8 text-foreground font-bold tracking-tight">
              {title}
            </h1>
            {children}
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
