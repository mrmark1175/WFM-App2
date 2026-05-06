export type IntradayChannel = "voice" | "email" | "chat" | "cases";
export type IntradayStaffingMode = "dedicated" | "blended";

export const LEGACY_INTRADAY_PREFS_KEY = "intraday_forecast";
export const LEGACY_INTRADAY_FTE_PREFS_KEY = "intraday_fte";

export function normalizeIntradayStaffingMode(value: unknown): IntradayStaffingMode {
  return String(value).toLowerCase() === "blended" ? "blended" : "dedicated";
}

export function normalizeIntradayChannel(value: unknown): IntradayChannel {
  const channel = String(value).toLowerCase();
  return channel === "email" || channel === "chat" || channel === "cases" ? channel : "voice";
}

export function buildIntradayBaselineKey({
  organizationId = "default",
  lobId,
  lobName,
  channel,
  staffingMode,
}: {
  organizationId?: string | number | null;
  lobId?: string | number | null;
  lobName?: string | null;
  channel: IntradayChannel;
  staffingMode: IntradayStaffingMode;
}): string {
  const scope = lobId != null && lobId !== "" ? `lob:${lobId}` : `lob:${lobName ?? "default"}`;
  return `org:${organizationId ?? "default"}:${scope}:channel:${channel}:staffing:${staffingMode}`;
}

export function buildIntradayPrefsPageKey(channel: IntradayChannel, staffingMode: IntradayStaffingMode): string {
  return `${LEGACY_INTRADAY_PREFS_KEY}:${channel}:${staffingMode}`;
}

export function buildIntradayFtePrefsPageKey(channel: IntradayChannel, staffingMode: IntradayStaffingMode): string {
  return `${LEGACY_INTRADAY_FTE_PREFS_KEY}:${channel}:${staffingMode}`;
}
