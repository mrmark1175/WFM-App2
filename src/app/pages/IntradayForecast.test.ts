import { describe, expect, it } from "vitest";
import {
  buildIntradayBaselineKey,
  buildIntradayFtePrefsPageKey,
  buildIntradayPrefsPageKey,
  normalizeIntradayChannel,
  normalizeIntradayStaffingMode,
} from "./intraday-scope";

function sumSelectedMonthlyVolumes(
  forecastVolumesByChannel: Record<"voice" | "email" | "chat" | "cases", number[]>,
  selectedChannels: Record<"voice" | "email" | "chat" | "cases", boolean>
) {
  const included = (["voice", "email", "chat", "cases"] as const).filter((channel) => selectedChannels[channel]);
  const maxLength = Math.max(0, ...included.map((channel) => forecastVolumesByChannel[channel]?.length ?? 0));
  return Array.from({ length: maxLength }, (_, monthIndex) =>
    included.reduce((sum, channel) => sum + (forecastVolumesByChannel[channel]?.[monthIndex] ?? 0), 0)
  );
}

describe("Intraday baseline scoping", () => {
  it("saves separate baselines for LOB, channel, and staffing mode", () => {
    const lobA = { organizationId: 1, lobId: 10, lobName: "LOB A" };
    const voiceDedicated = buildIntradayBaselineKey({ ...lobA, channel: "voice", staffingMode: "dedicated" });
    const emailDedicated = buildIntradayBaselineKey({ ...lobA, channel: "email", staffingMode: "dedicated" });
    const emailBlended = buildIntradayBaselineKey({ ...lobA, channel: "email", staffingMode: "blended" });
    const lobBEmail = buildIntradayBaselineKey({ organizationId: 1, lobId: 20, lobName: "LOB B", channel: "email", staffingMode: "dedicated" });

    expect(new Set([voiceDedicated, emailDedicated, emailBlended, lobBEmail]).size).toBe(4);
  });

  it("uses different preference keys when switching Voice to Email", () => {
    expect(buildIntradayPrefsPageKey("voice", "dedicated"))
      .not.toBe(buildIntradayPrefsPageKey("email", "dedicated"));
  });

  it("uses different preference keys when switching Dedicated Email to Blended Email", () => {
    expect(buildIntradayPrefsPageKey("email", "dedicated"))
      .not.toBe(buildIntradayPrefsPageKey("email", "blended"));
  });

  it("uses the same scoped key shape for scheduling FTE consumption", () => {
    expect(buildIntradayFtePrefsPageKey("email", "dedicated")).toBe("intraday_fte:email:dedicated");
    expect(buildIntradayFtePrefsPageKey("email", "blended")).toBe("intraday_fte:email:blended");
  });

  it("normalizes unknown legacy values without creating a global channel", () => {
    expect(normalizeIntradayChannel("email")).toBe("email");
    expect(normalizeIntradayChannel("unknown")).toBe("voice");
    expect(normalizeIntradayStaffingMode("blended")).toBe("blended");
    expect(normalizeIntradayStaffingMode("anything else")).toBe("dedicated");
  });

  it("uses the Demand Output total for blended monthly volume", () => {
    const totals = sumSelectedMonthlyVolumes(
      {
        voice: [1000, 1100],
        chat: [300, 330],
        email: [200, 220],
        cases: [50, 55],
      },
      { voice: true, chat: true, email: true, cases: false }
    );

    expect(totals).toEqual([1500, 1650]);
  });
});
