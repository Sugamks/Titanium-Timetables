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

export function periodTypeTone(kind: string) {
  if (kind === "lunch_break") {
    return {
      strip: "period-fill-lunch hover:brightness-110 border-orange-200 dark:border-orange-700",
      title: "text-orange-950 dark:text-orange-100",
      time: "text-orange-800 dark:text-orange-200",
      fill: "period-fill-lunch",
      bar: "period-bar-lunch",
    };
  }
  if (kind === "prayer_break") {
    return {
      strip: "bg-violet-100 hover:bg-violet-200 border-violet-200 dark:bg-violet-950/60 dark:hover:bg-violet-900/70 dark:border-violet-800",
      title: "text-violet-950 dark:text-violet-100",
      time: "text-violet-800 dark:text-violet-200",
      fill: "bg-violet-100 dark:bg-violet-950/45",
      bar: "bg-violet-400",
    };
  }
  if (kind === "short_break") {
    return {
      strip: "period-fill-short hover:brightness-110 border-amber-200 dark:border-amber-600",
      title: "text-amber-950 dark:text-amber-100",
      time: "text-amber-800 dark:text-amber-200",
      fill: "period-fill-short",
      bar: "period-bar-short",
    };
  }
  if (kind === "all_teachers") {
    return {
      strip: "bg-rose-100 hover:bg-rose-200 border-rose-200 dark:bg-rose-950/60 dark:hover:bg-rose-900/70 dark:border-rose-800",
      title: "text-rose-950 dark:text-rose-100",
      time: "text-rose-800 dark:text-rose-200",
      fill: "bg-rose-100 dark:bg-rose-950/45",
      bar: "bg-rose-400",
    };
  }
  if (kind === "assembly") {
    return {
      strip: "bg-teal-100 hover:bg-teal-200 border-teal-200 dark:bg-teal-950/60 dark:hover:bg-teal-900/70 dark:border-teal-800",
      title: "text-teal-950 dark:text-teal-100",
      time: "text-teal-800 dark:text-teal-200",
      fill: "bg-teal-100 dark:bg-teal-950/45",
      bar: "bg-teal-400",
    };
  }
  return {
    strip: "bg-indigo-50 hover:bg-indigo-100 border-indigo-100 dark:bg-indigo-950/45 dark:hover:bg-indigo-900/55 dark:border-indigo-800",
    title: "text-indigo-950 dark:text-indigo-100",
    time: "text-indigo-700 dark:text-indigo-300",
    fill: "bg-white dark:bg-transparent",
    bar: "bg-indigo-500 dark:bg-indigo-400",
  };
}

export function periodTypeLabel(ptype?: string) {
  const found = PERIOD_TYPES.find((t) => t.value === ptype);
  if (found) return found.label;
  if (ptype === "break") return "Break";
  if (ptype === "assembly") return "Assembly";
  if (ptype === "all_teachers") return "All teachers";
  return ptype || "Teaching";
}
