export function getUTCOffsetMinutes(timezone: string, date: Date): number {
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' });
  const tzStr  = date.toLocaleString('en-US', { timeZone: timezone });
  return (new Date(tzStr).getTime() - new Date(utcStr).getTime()) / 60000;
}

export function isDSTActive(timezone: string, date: Date): boolean {
  const jan = getUTCOffsetMinutes(timezone, new Date(date.getFullYear(), 0, 1));
  return getUTCOffsetMinutes(timezone, date) !== jan;
}

export function getDSTDeltaMinutes(timezone: string, date: Date): number {
  const jan = getUTCOffsetMinutes(timezone, new Date(date.getFullYear(), 0, 1));
  return getUTCOffsetMinutes(timezone, date) - jan;
}

export function getTZLabel(timezone: string, date: Date): string {
  return (
    new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'short' })
      .formatToParts(date)
      .find(p => p.type === 'timeZoneName')?.value ?? timezone
  );
}

export type DSTWarning = {
  transitionType: 'spring_forward' | 'fall_back';
  demandLabel: string;
  shiftHours: number;
  bannerMessage: string;
  suggestion: string;
} | null;

export function getDSTWarning(
  demandTZ: string,
  supplyTZ: string,
  weekStartDate: Date
): DSTWarning {
  for (let d = 0; d < 7; d++) {
    const day  = new Date(weekStartDate); day.setDate(day.getDate() + d);
    const next = new Date(weekStartDate); next.setDate(next.getDate() + d + 1);
    const offA = getUTCOffsetMinutes(demandTZ, day);
    const offB = getUTCOffsetMinutes(demandTZ, next);
    if (offA === offB) continue;

    // delta > 0 → clocks fall back (offset increases); delta < 0 → spring forward
    const delta = offB - offA;
    const type: 'spring_forward' | 'fall_back' = delta < 0 ? 'spring_forward' : 'fall_back';
    const shiftHours = delta / 60;
    const demandLabel = getTZLabel(demandTZ, next);
    const action = type === 'spring_forward' ? 'spring forward' : 'fall back';
    const direction =
      shiftHours > 0
        ? `${shiftHours}h later in agent time`
        : `${Math.abs(shiftHours)}h earlier in agent time`;

    return {
      transitionType: type,
      demandLabel,
      shiftHours,
      bannerMessage: `DST transition this week: customer clocks ${action}. Customer hours now start ${direction}.`,
      suggestion:
        shiftHours > 0
          ? `Consider shifting opening agent shifts ${Math.abs(shiftHours)}h later this week.`
          : `Consider shifting opening agent shifts ${Math.abs(shiftHours)}h earlier this week.`,
    };
  }
  return null;
}

export const TIMEZONE_OPTIONS = [
  // North America
  { value: 'America/New_York',    label: 'US Eastern (ET)' },
  { value: 'America/Chicago',     label: 'US Central (CT)' },
  { value: 'America/Denver',      label: 'US Mountain (MT)' },
  { value: 'America/Los_Angeles', label: 'US Pacific (PT)' },
  { value: 'America/Phoenix',     label: 'US Arizona (no DST)' },
  { value: 'America/Toronto',     label: 'Canada Eastern (ET)' },
  { value: 'America/Vancouver',   label: 'Canada Pacific (PT)' },
  // Australia
  { value: 'Australia/Sydney',    label: 'Australia Sydney (AEST/AEDT)' },
  { value: 'Australia/Melbourne', label: 'Australia Melbourne (AEST/AEDT)' },
  { value: 'Australia/Brisbane',  label: 'Australia Brisbane (no DST)' },
  { value: 'Australia/Perth',     label: 'Australia Perth (AWST)' },
  { value: 'Australia/Adelaide',  label: 'Australia Adelaide (ACST/ACDT)' },
  // Europe
  { value: 'Europe/London',       label: 'UK London (GMT/BST)' },
  { value: 'Europe/Paris',        label: 'Europe Central (CET/CEST)' },
  // Asia / Pacific
  { value: 'Asia/Manila',         label: 'Philippines (PHT, no DST)' },
  { value: 'Asia/Singapore',      label: 'Singapore (SGT, no DST)' },
  { value: 'Asia/Kolkata',        label: 'India (IST, no DST)' },
  { value: 'Asia/Dubai',          label: 'UAE (GST, no DST)' },
  { value: 'Asia/Tokyo',          label: 'Japan (JST, no DST)' },
];
