import React, { useEffect, useMemo, useState } from "react";
import { CalendarDays, CheckCircle2, Clock3, Layers3, Send, Table2, TrendingUp } from "lucide-react";
import { PageLayout } from "../components/PageLayout";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { CHANNEL_OPTIONS, type ChannelKey, useLOB } from "../lib/lobContext";
import { apiUrl } from "../lib/api";

type StaffingMode = "dedicated" | "blended";

interface LobSettings {
  channels_enabled?: Partial<Record<ChannelKey, boolean>>;
  pooling_mode?: StaffingMode | string;
}

const DEFAULT_ENABLED_CHANNELS: Record<ChannelKey, boolean> = {
  voice: true,
  email: false,
  chat: false,
  cases: false,
};

const CHANNEL_SELECT_OPTIONS = [
  { value: "voice", label: "Voice" },
  { value: "email", label: "Email" },
  { value: "chat", label: "Chat" },
  { value: "cases", label: "Cases" },
] as const satisfies ReadonlyArray<{ value: ChannelKey; label: string }>;

const PLACEHOLDER_SECTIONS = [
  {
    title: "Monthly Volume Source",
    description: "Selected-channel demand source and future manual monthly override.",
    icon: TrendingUp,
  },
  {
    title: "Week Allocation",
    description: "Future month-to-week distribution for the selected scope.",
    icon: CalendarDays,
  },
  {
    title: "Day Allocation",
    description: "Future week-to-day distribution for the selected scope.",
    icon: Table2,
  },
  {
    title: "Interval Allocation",
    description: "Future day-to-interval volume shaping. This is volume, not FTE.",
    icon: Clock3,
  },
  {
    title: "Output Preview",
    description: "Future scoped weekly and interval output preview before publishing.",
    icon: Layers3,
  },
  {
    title: "Publish / Commit",
    description: "Future publish step for approved downstream outputs.",
    icon: Send,
  },
];

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function normalizeStaffingMode(value?: string): StaffingMode {
  return value === "blended" ? "blended" : "dedicated";
}

function normalizeEnabledChannels(settings?: LobSettings | null): Record<ChannelKey, boolean> {
  return {
    voice: settings?.channels_enabled?.voice ?? DEFAULT_ENABLED_CHANNELS.voice,
    email: settings?.channels_enabled?.email ?? DEFAULT_ENABLED_CHANNELS.email,
    chat: settings?.channels_enabled?.chat ?? DEFAULT_ENABLED_CHANNELS.chat,
    cases: settings?.channels_enabled?.cases ?? DEFAULT_ENABLED_CHANNELS.cases,
  };
}

export function IntradayForecastV2() {
  const { lobs, activeLob, setActiveLob, activeChannel } = useLOB();
  const [selectedLobId, setSelectedLobId] = useState<number | null>(activeLob?.id ?? null);
  const [selectedChannel, setSelectedChannel] = useState<ChannelKey>(activeChannel);
  const [staffingMode, setStaffingMode] = useState<StaffingMode>("dedicated");
  const [monthKey, setMonthKey] = useState(currentMonthKey);
  const [lobSettings, setLobSettings] = useState<LobSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);

  useEffect(() => {
    if (activeLob?.id && !selectedLobId) setSelectedLobId(activeLob.id);
  }, [activeLob?.id, selectedLobId]);

  useEffect(() => {
    if (!selectedLobId) {
      setLobSettings(null);
      return;
    }

    let cancelled = false;
    setSettingsLoading(true);
    fetch(apiUrl(`/api/lob-settings?lob_id=${selectedLobId}`))
      .then((r) => (r.ok ? r.json() : null))
      .then((settings: LobSettings | null) => {
        if (cancelled) return;
        setLobSettings(settings);
        setStaffingMode(normalizeStaffingMode(settings?.pooling_mode));
      })
      .catch(() => {
        if (!cancelled) setLobSettings(null);
      })
      .finally(() => {
        if (!cancelled) setSettingsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedLobId]);

  const enabledChannels = useMemo(() => normalizeEnabledChannels(lobSettings), [lobSettings]);
  const channelOptions = useMemo(
    () => CHANNEL_SELECT_OPTIONS.filter((option) => enabledChannels[option.value]),
    [enabledChannels]
  );

  useEffect(() => {
    if (channelOptions.length === 0) return;
    if (!channelOptions.some((option) => option.value === selectedChannel)) {
      setSelectedChannel(channelOptions[0].value);
    }
  }, [channelOptions, selectedChannel]);

  const selectedLob = useMemo(
    () => lobs.find((lob) => lob.id === selectedLobId) ?? activeLob ?? null,
    [activeLob, lobs, selectedLobId]
  );

  const activeChannelLabel = CHANNEL_OPTIONS.find((option) => option.value === selectedChannel)?.label ?? "Voice";
  const scopeLabel = `${selectedLob?.lob_name ?? "No LOB"} / ${activeChannelLabel} / ${staffingMode} / ${monthKey}`;

  return (
    <PageLayout>
      <div className="py-6 space-y-6">
        <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-950 px-6 py-7 text-white shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <Badge className="mb-3 border-cyan-300/30 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/10">
                Parallel build
              </Badge>
              <h1 className="text-3xl font-semibold tracking-tight">Intraday Forecast v2</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-cyan-50/80">
                Shape monthly demand into week, day, and interval patterns with strict LOB, channel,
                staffing mode, and month scoping.
              </p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-xs text-cyan-50/85 backdrop-blur">
              <div className="font-mono uppercase tracking-[0.18em] text-cyan-200/80">Active shell scope</div>
              <div className="mt-1 font-medium text-white">{scopeLabel}</div>
            </div>
          </div>
        </section>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100 pb-5">
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="size-4 text-cyan-600" />
              Scope Bar
            </CardTitle>
            <CardDescription>
              Phase 2 shell only. These controls define the future planning scope; no planning data is saved.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 pt-5 md:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">LOB</span>
              <Select
                value={selectedLobId ? String(selectedLobId) : ""}
                onValueChange={(value) => {
                  const nextLob = lobs.find((lob) => lob.id === Number(value));
                  if (!nextLob) return;
                  setSelectedLobId(nextLob.id);
                  setActiveLob(nextLob);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select LOB" />
                </SelectTrigger>
                <SelectContent>
                  {lobs.map((lob) => (
                    <SelectItem key={lob.id} value={String(lob.id)}>
                      {lob.lob_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Month</span>
              <Input type="month" value={monthKey} onChange={(e) => setMonthKey(e.target.value || currentMonthKey())} />
            </label>

            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Channel</span>
              <Select value={selectedChannel} onValueChange={(value) => setSelectedChannel(value as ChannelKey)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select channel" />
                </SelectTrigger>
                <SelectContent>
                  {channelOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-slate-500">
                {settingsLoading ? "Loading enabled channels..." : "Options reflect enabled LOB channels when available."}
              </p>
            </label>

            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Staffing Mode</span>
              <Select value={staffingMode} onValueChange={(value) => setStaffingMode(value as StaffingMode)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select staffing mode" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dedicated">Dedicated</SelectItem>
                  <SelectItem value="blended">Blended</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-slate-500">Defaults from LOB settings when available.</p>
            </label>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          {PLACEHOLDER_SECTIONS.map((section) => {
            const Icon = section.icon;
            return (
              <Card key={section.title} className="border-dashed border-slate-300 bg-white/80 shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <span className="rounded-lg bg-cyan-50 p-2 text-cyan-700">
                      <Icon className="size-4" />
                    </span>
                    {section.title}
                  </CardTitle>
                  <CardDescription>{section.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600">
                    Phase 2 shell only — not wired yet.
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </PageLayout>
  );
}
