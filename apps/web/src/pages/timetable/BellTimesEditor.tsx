import { useState } from "react";
import { BREAK_TYPES, dayCustomTimes, isTeachingPeriod, periodOnDay, periodTypeKey, periodTypeLabel, periodTypeTone } from "../../periods";
import ClockPicker from "../../ui/ClockPicker";
import { IconButton } from "../../ui/icons";

type Period = {
  id: string;
  name?: string;
  period_type?: string;
  start_time?: string | null;
  end_time?: string | null;
};

function minutes(value?: string | null) {
  if (!value) return null;
  const [h, m] = value.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function clock(value?: string | null) {
  const mins = minutes(value);
  if (mins == null) return "unset";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h < 12 ? "AM" : "PM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${suffix}`;
}

function duration(start?: string | null, end?: string | null) {
  const a = minutes(start);
  const b = minutes(end);
  if (a == null || b == null) return "";
  const d = Math.max(0, b - a);
  if (d >= 60) return `${Math.floor(d / 60)}h ${d % 60 ? `${d % 60}m` : ""}`.trim();
  return `${d}m`;
}

function typeKey(p: Period) {
  return periodTypeKey(p.period_type);
}

function isAutoPeriodName(name?: string) {
  const text = (name || "").trim();
  return !text || /^(p|period)\s*\d+$/i.test(text);
}

function displayName(p: Period, teachingNo: number) {
  if (isTeachingPeriod(p)) {
    return isAutoPeriodName(p.name) ? `Period ${teachingNo}` : p.name || `Period ${teachingNo}`;
  }
  if (isAutoPeriodName(p.name)) return periodTypeLabel(typeKey(p));
  return p.name || periodTypeLabel(typeKey(p));
}

function hhmm(value?: string | null) {
  return (value || "").slice(0, 5) || "unset";
}

export default function BellTimesEditor({
  periods,
  days = [],
  periodBusy,
  savingTimes,
  onSaveTimes,
  onPatchPeriod,
  onPatchDayTimes,
  onRemovePeriod,
}: {
  periods: Period[];
  days?: { id: string; name: string; custom_times?: Record<string, { start_time?: string | null; end_time?: string | null }> }[];
  periodBusy: string;
  savingTimes: boolean;
  onSaveTimes: () => void;
  onPatchPeriod: (id: string, body: Record<string, string>) => void;
  onPatchDayTimes?: (dayId: string, periodId: string, body: { start_time?: string; end_time?: string }) => void;
  onRemovePeriod: (id: string) => void;
}) {
  const [dayId, setDayId] = useState("");
  const selectedDay = days.find((d) => d.id === dayId);
  const shownPeriods = periods.map((p) => periodOnDay(p, selectedDay));
  const teaching = periods.filter((p) => isTeachingPeriod(p)).length;
  const breaks = periods.length - teaching;
  const first = shownPeriods[0]?.start_time;
  const last = shownPeriods[shownPeriods.length - 1]?.end_time;
  const span = duration(first, last);

  return (
    <section className="bg-paper-3 border rounded-xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-ink" data-tour="bells">Bell times &amp; breaks</h3>
          {periods.length > 0 && (
            <>
              <span className="text-xs rounded-full bg-paper-2 text-accent px-2 py-0.5">{teaching} teaching</span>
              <span className="text-xs rounded-full bg-warn-well text-warn px-2 py-0.5">{breaks} breaks</span>
              {span && (
                <span className="text-xs rounded-full bg-paper-2 text-muted px-2 py-0.5">
                  {clock(first)} to {clock(last)}, {span}
                </span>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {days.length > 0 && (
            <select
              className="border border-rule rounded-lg px-2 py-1.5 text-sm"
              value={dayId}
              onChange={(e) => setDayId(e.target.value)}
              title="Override times for one day"
            >
              <option value="">All days (default)</option>
              {days.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}{Object.keys(dayCustomTimes(d)).length ? ", custom times" : ""}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={onSaveTimes}
            disabled={savingTimes}
            className="bg-accent text-accent-ink rounded-lg px-3 py-1.5 text-sm disabled:opacity-60 shrink-0"
          >
            {savingTimes ? "Saving…" : "Save times"}
          </button>
        </div>
      </div>
      {selectedDay ? (
        <p className="text-sm text-accent bg-paper-2 border border-accent rounded-lg px-3 py-2 mb-3">
          Editing <strong>{selectedDay.name}</strong> only. Other days keep the default times. This day’s clocks are shown below.
        </p>
      ) : (
        <p className="text-xs text-muted mb-3">Default times for every day. Pick a day in the dropdown to set a different Friday (or other day).</p>
      )}

      {periods.length > 0 && (
        <div className="bell-strip mb-3">
          <div className="flex w-full border border-rule rounded-lg overflow-hidden">
            {(() => {
              let teachingNo = 0;
              return shownPeriods.map((p) => {
                const kind = typeKey(p);
                const tone = periodTypeTone(kind);
                if (isTeachingPeriod(p)) teachingNo += 1;
                const label = displayName(p, teachingNo);
                return (
                  <button
                    key={p.id}
                    type="button"
                    title={`${label}, ${hhmm(p.start_time)} to ${hhmm(p.end_time)}`}
                    className={`bell-chip text-center border-r border-rule last:border-r-0 ${tone.strip}`}
                    onClick={() => document.getElementById(`bell-${p.id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" })}
                  >
                    <div className={`bell-chip-name text-xs font-semibold ${tone.title}`}>{label}</div>
                    <div className={`bell-chip-time tabular-nums ${tone.time}`}>{hhmm(p.start_time)} to {hhmm(p.end_time)}</div>
                  </button>
                );
              });
            })()}
          </div>
        </div>
      )}

      {periods.length === 0 ? (
        <p className="text-sm text-muted py-6 text-center border border-dashed rounded-xl">This template has no periods yet.</p>
      ) : (
        <div className="bell-list border border-rule">
          {periods.map((p, idx) => {
            const day = days.find((d) => d.id === dayId);
            const over = day?.custom_times?.[p.id];
            const shown = {
              ...p,
              start_time: over?.start_time || p.start_time,
              end_time: over?.end_time || p.end_time,
            };
            const kind = typeKey(p);
            const tone = periodTypeTone(kind);
            const teachingNo = periods.slice(0, idx + 1).filter((x) => isTeachingPeriod(x)).length;
            const label = displayName(p, teachingNo);
            return (
              <div key={p.id} className="group">
                <div
                  id={`bell-${p.id}`}
                  className={`bell-row gap-2 pr-2 ${tone.fill} border-b border-b-rule`}
                >
                  <span className={`bell-bar self-stretch ${tone.bar}`} aria-hidden />
                  <div className="bell-name">
                    <input
                      className="input-ghost min-w-0 bg-transparent text-sm font-medium text-ink border-b border-transparent hover:border-rule focus:border-accent py-0.5"
                      defaultValue={label}
                      key={`${p.id}-name-${label}`}
                      onBlur={(e) => {
                        if (e.target.value.trim() && e.target.value.trim() !== label) {
                          onPatchPeriod(p.id, { name: e.target.value.trim() });
                        }
                      }}
                    />
                    <span className="bell-duration text-xs text-muted">{duration(shown.start_time, shown.end_time)}</span>
                  </div>
                  <select
                    className="border border-rule rounded-lg px-1.5 py-1 text-xs bg-paper-3 text-ink"
                    value={kind}
                    onChange={(e) => onPatchPeriod(p.id, { period_type: e.target.value })}
                  >
                    <option value="teaching">Teaching</option>
                    <option value="assembly">Assembly</option>
                    <option value="all_teachers">All teachers</option>
                    {BREAK_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                  <ClockPicker
                    label="Start"
                    value={shown.start_time}
                    onChange={(start_time) =>
                      dayId && onPatchDayTimes
                        ? onPatchDayTimes(dayId, p.id, { start_time, end_time: shown.end_time || undefined })
                        : onPatchPeriod(p.id, { start_time })
                    }
                  />
                  <ClockPicker
                    label="End"
                    value={shown.end_time}
                    onChange={(end_time) =>
                      dayId && onPatchDayTimes
                        ? onPatchDayTimes(dayId, p.id, { start_time: shown.start_time || undefined, end_time })
                        : onPatchPeriod(p.id, { end_time })
                    }
                  />
                  <div className="bell-actions">
                    {BREAK_TYPES.map((t) => (
                      <button
                        key={t.value}
                        type="button"
                        disabled={!!periodBusy}
                        title={`Make this row ${t.label}`}
                        className={`text-xs rounded-full border px-1.5 py-0.5 disabled:opacity-55 ${kind === t.value
                            ? "border-accent bg-paper-2 text-accent"
                            : "border-rule bg-paper-3 text-muted hover:border-accent hover:text-accent dark:bg-[var(--app-input)] border-rule text-muted"
                          }`}
                        onClick={() => onPatchPeriod(p.id, { period_type: t.value })}
                      >
                        {t.label.replace(" Break", "")}
                      </button>
                    ))}
                    <IconButton icon="trash" label="Delete period" variant="danger" onClick={() => onRemovePeriod(p.id)} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
