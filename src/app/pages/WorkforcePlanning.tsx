import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Users, Clock, Phone, Mail, MessageSquare, ClipboardList, Loader2 } from "lucide-react";
import { useLOB } from "../lib/lobContext";
import { apiUrl } from "../lib/api";
import { Badge } from "../components/ui/badge";

type ChannelKey = "voice" | "email" | "chat" | "cases";

const CHANNEL_META: Record<ChannelKey, { label: string; Icon: React.FC<{ className?: string }>; colorClass: string; bgClass: string; borderClass: string }> = {
  voice: { label: "Voice",  Icon: Phone,          colorClass: "text-sky-700 dark:text-sky-400",       bgClass: "bg-sky-50 dark:bg-sky-950/40",       borderClass: "border-sky-200 dark:border-sky-800" },
  chat:  { label: "Chat",   Icon: MessageSquare,  colorClass: "text-amber-700 dark:text-amber-400",   bgClass: "bg-amber-50 dark:bg-amber-950/40",   borderClass: "border-amber-200 dark:border-amber-800" },
  email: { label: "Email",  Icon: Mail,           colorClass: "text-emerald-700 dark:text-emerald-400", bgClass: "bg-emerald-50 dark:bg-emerald-950/40", borderClass: "border-emerald-200 dark:border-emerald-800" },
  cases: { label: "Cases",  Icon: ClipboardList,  colorClass: "text-violet-700 dark:text-violet-400", bgClass: "bg-violet-50 dark:bg-violet-950/40", borderClass: "border-violet-200 dark:border-violet-800" },
};

const CHANNEL_ORDER: ChannelKey[] = ["voice", "chat", "email", "cases"];

const planningModules = [
  {
    title: "Capacity Planning",
    description: "Long-term staffing requirements and FTE calculations.",
    Icon: Users,
    iconClass: "text-blue-600",
    path: "/planning/capacity",
  },
  {
    title: "Intraday Forecast",
    description: "Real-time adjustments and interval-level volume tracking.",
    Icon: Clock,
    iconClass: "text-green-600",
    path: "/planning/intraday",
  },
];

const WorkforcePlanning = () => {
  const navigate = useNavigate();
  const { activeLob } = useLOB();
  const [channelsEnabled, setChannelsEnabled] = useState<Record<ChannelKey, boolean> | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activeLob) return;
    setLoading(true);
    fetch(apiUrl(`/api/lob-settings?lob_id=${activeLob.id}`))
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.channels_enabled) setChannelsEnabled(data.channels_enabled as Record<ChannelKey, boolean>);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeLob?.id]);

  const enabledChannels = channelsEnabled
    ? CHANNEL_ORDER.filter((ch) => channelsEnabled[ch])
    : [];

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-3xl font-bold mb-1">Workforce Planning</h1>
      <p className="text-gray-500 dark:text-muted-foreground mb-8">
        Select a module to optimize your resource allocation.
      </p>

      {/* ── Active LOB + Channels ─────────────────────────────────────────── */}
      {activeLob && (
        <div className="mb-8 rounded-xl border border-border bg-muted/30 px-5 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-black uppercase tracking-widest text-muted-foreground">
              Active LOB
            </span>
            <span className="text-sm font-bold">{activeLob.lob_name}</span>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-xs font-black uppercase tracking-widest text-muted-foreground">
              Channels
            </span>

            {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}

            {!loading && enabledChannels.length === 0 && channelsEnabled !== null && (
              <span className="text-xs text-muted-foreground italic">No channels configured</span>
            )}

            {!loading && enabledChannels.map((ch) => {
              const { label, Icon, colorClass, bgClass, borderClass } = CHANNEL_META[ch];
              return (
                <span
                  key={ch}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${colorClass} ${bgClass} ${borderClass}`}
                >
                  <Icon className="size-3.5" />
                  {label}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Module cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {planningModules.map(({ title, description, Icon, iconClass, path }) => (
          <div
            key={title}
            onClick={() => navigate(path)}
            className="p-6 bg-white dark:bg-card border border-gray-200 dark:border-border rounded-xl shadow-sm hover:shadow-md hover:border-blue-300 dark:hover:border-primary/50 cursor-pointer transition-all group"
          >
            <div className="mb-4">
              <Icon className={`w-8 h-8 ${iconClass}`} />
            </div>
            <h2 className="text-xl font-semibold group-hover:text-blue-600 dark:group-hover:text-primary transition-colors">
              {title}
            </h2>
            <p className="text-gray-500 dark:text-muted-foreground mt-2">{description}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default WorkforcePlanning;
