export const BREAK_TYPES = [
  { value: "short_break", label: "Short Break", hint: "Recess / tea" },
  { value: "lunch_break", label: "Lunch Break", hint: "Midday" },
  { value: "prayer_break", label: "Prayer Break", hint: "Assembly / prayer" },
] as const;

export const PERIOD_TYPES = [
  { value: "teaching", label: "Teaching" },
  { value: "assembly", label: "Assembly" },
  { value: "all_teachers", label: "All teachers" },
  ...BREAK_TYPES,
];

export function isTeachingPeriod(p: { period_type?: string; is_teaching?: boolean } | null | undefined) {
  if (!p) return true;
  if (typeof p.is_teaching === "boolean") return p.is_teaching;
  return (p.period_type || "teaching") === "teaching";
}

export function periodTimeRange(p: { start_time?: string | null; end_time?: string | null } | null | undefined) {
  if (!p) return "";
  const start = p.start_time ? String(p.start_time).slice(0, 5) : "";
  const end = p.end_time ? String(p.end_time).slice(0, 5) : "";
  if (start && end) return `${start}–${end}`;
  return start || end;
}

export type DayClock = {
  id?: string;
  custom_times?: Record<string, { start_time?: string | null; end_time?: string | null }> | string | null;
};

export function dayCustomTimes(day?: DayClock | null): Record<string, { start_time?: string | null; end_time?: string | null }> {
  const raw = day?.custom_times;
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return raw;
}

export function periodOnDay<T extends { id?: string; start_time?: string | null; end_time?: string | null }>(
  period: T,
  day?: DayClock | null
): T {
  const over = dayCustomTimes(day)[period.id || ""];
  if (!over) return period;
  return {
    ...period,
    start_time: over.start_time ? String(over.start_time).slice(0, 5) : period.start_time,
    end_time: over.end_time ? String(over.end_time).slice(0, 5) : period.end_time,
  };
}

export function periodTypeKey(ptype?: string) {
  if (ptype === "break") return "short_break";
  return ptype || "teaching";
}

function tone(fill: string, bar: string) {
  return { strip: fill, title: "text-ink", time: "text-muted", fill, bar };
}

export function periodTypeTone(kind: string) {
  if (kind === "lunch_break") return tone("period-fill-lunch", "period-bar-lunch");
  if (kind === "prayer_break") return tone("period-fill-prayer", "period-bar-prayer");
  if (kind === "short_break") return tone("period-fill-short", "period-bar-short");
  if (kind === "all_teachers") return tone("period-fill-all", "period-bar-all");
  if (kind === "assembly") return tone("period-fill-assembly", "period-bar-assembly");
  return tone("period-fill-teaching", "period-bar-teaching");
}

export function periodTypeLabel(ptype?: string) {
  const found = PERIOD_TYPES.find((t) => t.value === ptype);
  if (found) return found.label;
  if (ptype === "break") return "Break";
  if (ptype === "assembly") return "Assembly";
  if (ptype === "all_teachers") return "All teachers";
  return ptype || "Teaching";
}
