import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { isTeachingPeriod, periodTypeLabel } from "../../periods";
import { IconButton } from "../../ui/icons";
import { classListOf, isJoinedLesson, joinedShort } from "../../ui/lessonMarks";
import SearchSelect from "../../ui/SearchSelect";

type GroupMember = { lesson_id: string; subject: string; name: string; joined: boolean; sections: string[] };

type View = "section" | "teacher";

export default function GridPanel({
  tts,
  yearLessons,
  onChanged,
  onError,
  onMessage,
}: {
  tts: any[];
  yearLessons: any[];
  onChanged: () => Promise<void> | void;
  onError: (m: string) => void;
  onMessage: (m: string) => void;
}) {
  const [versionId, setVersionId] = useState("");
  const [grid, setGrid] = useState<any>(null);
  const [mode, setMode] = useState("balanced");
  const [job, setJob] = useState<any>(null);
  const [solutions, setSolutions] = useState<any[]>([]);
  const [view, setView] = useState<View>("section");
  const [filter, setFilter] = useState("");
  const [dragging, setDragging] = useState<any>(null);
  const [running, setRunning] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [previewing, setPreviewing] = useState("");
  const [groupCell, setGroupCell] = useState<{ day: any; period: any; name: string; members: GroupMember[] } | null>(null);
  const [savingGroup, setSavingGroup] = useState(false);
  const [groupInfo, setGroupInfo] = useState<{
    name: string;
    day: string;
    period: string;
    items: any[];
  } | null>(null);

  const versions = tts.flatMap((t) => (t.versions || []).map((v: any) => ({ ...v, timetable: t.name, tid: t.id })));

  useEffect(() => {
    const next = versions.slice(-1)[0]?.id || versions[0]?.id || "";
    setVersionId((prev) => (prev && versions.some((v) => v.id === prev) ? prev : next));
  }, [tts]);

  async function loadGrid(id: string) {
    if (!id) {
      setGrid(null);
      return;
    }
    const g = await api(`/v1/designer/versions/${id}`);
    setGrid(g);
  }

  useEffect(() => {
    loadGrid(versionId).catch((e) => onError(e.message));
  }, [versionId]);

  const display = preview || grid;

  const unplaced = useMemo(() => {
    const counts: Record<string, number> = {};
    (display?.allocations || []).forEach((a: any) => {
      counts[a.lesson_id] = (counts[a.lesson_id] || 0) + 1;
    });
    return yearLessons.filter((l) => (counts[l.id] || 0) < l.frequency_per_week);
  }, [yearLessons, display]);

  async function poll(id: string) {
    const j = await api(`/v1/jobs/${id}`);
    setJob(j);
    if (j.status === "completed" || j.status === "failed") {
      const sols = [...((await api(`/v1/jobs/${id}/solutions`)) || [])].sort(
        (a: any, b: any) =>
          (b.score || 0) - (a.score || 0) || (a.metrics?.hard_violations || 0) - (b.metrics?.hard_violations || 0)
      );
      setSolutions(sols);
      setRunning(false);
      if (sols[0]?.id) {
        const p = await api(`/v1/jobs/${id}/solutions/${sols[0].id}/preview`);
        setPreview(p);
        setPreviewing(sols[0].id);
      }
      return;
    }
    setTimeout(() => poll(id), 700);
  }

  async function ensureVersion(): Promise<string> {
    if (versionId) return versionId;
    const first = tts[0];
    if (!first) {
      throw new Error("Create a template first (Templates in the sidebar), then generate.");
    }
    if (first.versions?.length) return first.versions.slice(-1)[0].id;
    const v = await api<{ id: string }>(`/v1/timetables/${first.id}/versions`, { method: "POST" });
    await onChanged();
    setVersionId(v.id);
    return v.id;
  }

  async function run() {
    onError("");
    onMessage("");
    setSolutions([]);
    setPreview(null);
    setPreviewing("");
    setRunning(true);
    try {
      const vid = await ensureVersion();
      const r = await api<{ job_id: string }>("/v1/generate", {
        method: "POST",
        body: JSON.stringify({ version_id: vid, mode }),
      });
      poll(r.job_id);
    } catch (e: any) {
      setRunning(false);
      onError(e.message);
    }
  }

  async function apply(solId: string) {
    if (!job?.id) return;
    const r = await api<{ version_id: string }>(`/v1/jobs/${job.id}/apply`, {
      method: "POST",
      body: JSON.stringify({ solution_id: solId }),
    });
    setVersionId(r.version_id);
    setPreview(null);
    setPreviewing("");
    onMessage("Timetable applied. You can still change teacher or periods on the Lessons tab.");
    await onChanged();
    await loadGrid(r.version_id);
  }

  async function publish() {
    const vid = versionId || (await ensureVersion());
    setPublishing(true);
    onError("");
    try {
      await api(`/v1/publish/${vid}`, { method: "POST" });
      onMessage("Published. Staff can now see this timetable under My timetable.");
      await onChanged();
      await loadGrid(vid);
    } catch (e: any) {
      onError(e.message);
    } finally {
      setPublishing(false);
    }
  }

  async function previewSol(id: string) {
    if (!job?.id) return;
    onError("");
    setPreviewing(id);
    try {
      const p = await api(`/v1/jobs/${job.id}/solutions/${id}/preview`);
      setPreview(p);
    } catch (e: any) {
      onError(e.message);
    }
  }

  async function drop(day: any, period: any, occupied: boolean) {
    if (!dragging || !versionId) return;
    if (preview || String(dragging.allocation_id || dragging.id || "").startsWith("preview-")) {
      onError("This is a preview. Click Use this timetable first, then you can swap periods.");
      setDragging(null);
      return;
    }
    try {
      await api("/v1/designer/allocations", {
        method: "POST",
        body: JSON.stringify({
          version_id: versionId,
          lesson_id: dragging.lesson_id || dragging.id,
          day_id: day.id,
          period_id: period.id,
          room_resource_id: dragging.room_resource_id || dragging.room_resource_ids?.[0],
          allocation_id: dragging.allocation_id,
          occurrence_index: dragging.occurrence_index || 0,
          stack: occupied,
        }),
      });
      setDragging(null);
      await loadGrid(versionId);
      onMessage(occupied ? "Stacked in one period. Save as a group if these are language options." : "Saved");
    } catch (e: any) {
      onError(e.message);
    }
  }

  function openGroup(day: any, period: any, cells: any[]) {
    const seen = new Map<string, GroupMember>();
    for (const a of cells) {
      if (seen.has(a.lesson_id)) continue;
      seen.set(a.lesson_id, {
        lesson_id: a.lesson_id,
        subject: a.subject || a.short || "Lesson",
        name: (a.groups && a.groups[0]) || a.subject || a.short || "",
        joined: isJoinedLesson(a),
        sections: classListOf(a),
      });
    }
    const existing = cells.find((a: any) => a.band_name)?.band_name || "";
    setGroupCell({ day, period, name: existing, members: [...seen.values()] });
  }

  function weeklyForMembers(members: GroupMember[]) {
    const ids = new Set(members.map((m) => m.lesson_id));
    const fromCards = Math.max(
      1,
      ...members.map((m) => Number(yearLessons.find((x) => x.id === m.lesson_id)?.frequency_per_week) || 1)
    );
    const slots = new Set<string>();
    for (const a of display?.allocations || []) {
      if (ids.has(a.lesson_id) && !a.block_offset) slots.add(`${a.day_id}|${a.period_id}`);
    }
    return Math.max(fromCards, slots.size);
  }

  async function saveGroup(applyAll: boolean) {
    if (!groupCell || !versionId) return;
    if (groupCell.members.length < 2) {
      onError("Stack at least two different lessons in this period first.");
      return;
    }
    if (!groupCell.name.trim()) {
      onError("Give this group a name (for example II Language).");
      return;
    }
    setSavingGroup(true);
    onError("");
    try {
      const r = await api<{ sections: number; weekly: number; slots: number; apply_all: boolean; subjects: string[]; band_name?: string }>(
        "/v1/designer/cell-group",
        {
          method: "POST",
          body: JSON.stringify({
            version_id: versionId,
            day_id: groupCell.day.id,
            period_id: groupCell.period.id,
            apply_all: applyAll,
            band_name: groupCell.name.trim(),
            members: groupCell.members.map((m) => ({
              lesson_id: m.lesson_id,
              group_name: m.subject || m.name.trim(),
            })),
          }),
        }
      );
      setGroupCell(null);
      await onChanged();
      await loadGrid(versionId);
      const label = r.band_name || groupCell.name.trim();
      if (r.apply_all) {
        onMessage(`${label} saved on all ${r.slots || r.weekly} periods${r.sections > 1 ? `, including related classes` : ""}.`);
      } else {
        onMessage(`${label} saved for this period${r.sections > 1 ? ` on ${r.sections} classes` : ""}.`);
      }
    } catch (e: any) {
      onError(e.message);
    } finally {
      setSavingGroup(false);
    }
  }

  const cellMap: Record<string, any[]> = {};
  (display?.allocations || []).forEach((a: any) => {
    const k = `${a.day_id}|${a.period_id}`;
    (cellMap[k] ||= []).push(a);
  });

  function visible(a: any) {
    if (!filter) return true;
    if (view === "section") return classListOf(a).includes(filter);
    return a.teacher === filter;
  }

  const filterOptions = useMemo(() => {
    const names = new Set<string>();
    for (const l of yearLessons) {
      if (view === "section") {
        String(l.section || "")
          .split(",")
          .map((s: string) => s.trim())
          .filter(Boolean)
          .forEach((s: string) => names.add(s));
      } else {
        (l.teachers || []).forEach((t: string) => t && names.add(t));
      }
    }
    for (const a of display?.allocations || grid?.allocations || []) {
      if (view === "section") classListOf(a).forEach((n) => names.add(n));
      else if (a.teacher) names.add(a.teacher);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [yearLessons, grid, display, view]);

  return (
    <div className="space-y-3">
      <div className="bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-sm space-y-2">
        <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="min-w-[14rem]">
          <SearchSelect
            label="Template"
            value={versionId}
            onChange={setVersionId}
            options={versions.map((v) => ({
              value: v.id,
              label: `${v.timetable} · v${v.number} (${v.status})`,
            }))}
            placeholder="Search template"
            allowEmpty={versions.length === 0}
            emptyLabel="No template yet"
          />
        </div>
        <div className="flex items-center gap-3 flex-nowrap">
          {(["fast", "balanced", "best"] as const).map((m) => (
            <label key={m} className="text-sm flex items-center gap-1" title={m === "fast" ? "3 quick variants" : m === "best" ? "Slower CP-SAT plus variants" : "4 quick variants"}>
              <input type="radio" checked={mode === m} onChange={() => setMode(m)} /> {m}
            </label>
          ))}
          <button onClick={run} disabled={running} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
            {running ? "Generating…" : "Generate"}
          </button>
          <button onClick={publish} disabled={publishing || !versionId} className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
            {publishing ? "Publishing…" : grid?.version?.status === "published" ? "Published" : "Publish"}
          </button>
        </div>
        </div>
        {running && job && (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <div className="flex-1 h-1.5 bg-slate-100 rounded">
              <div className="h-1.5 bg-indigo-500 rounded" style={{ width: `${job.progress || 0}%` }} />
            </div>
            <span className="shrink-0">{job.progress || 0}%</span>
          </div>
        )}
        {solutions.length > 0 && (
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
            {solutions.map((s) => {
              const hard = s.metrics?.hard_violations ?? 0;
              const gaps = s.metrics?.teacher_gaps ?? 0;
              const missing = s.metrics?.incomplete ?? 0;
              const ok = hard === 0 && missing === 0;
              const issues = ok
                ? gaps
                  ? `${gaps} gaps`
                  : "ok"
                : [hard ? `${hard} hard` : null, missing ? `${missing} miss` : null, gaps ? `${gaps} gaps` : null]
                    .filter(Boolean)
                    .join(" · ");
              const active = previewing === s.id;
              return (
                <div
                  key={s.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => previewSol(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      previewSol(s.id);
                    }
                  }}
                  className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-sm cursor-pointer ${
                    active
                      ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-300"
                      : "border-slate-200 bg-slate-50 hover:border-indigo-200 hover:bg-indigo-50/60"
                  }`}
                  title="Click to preview. Sorted by score, best first. Hard = clashes and missing cards. Gaps = idle periods in a teacher’s day."
                >
                  <div className="min-w-0 flex items-baseline gap-2">
                    <span className="font-semibold text-slate-900">{s.label}</span>
                    <span className={`truncate ${ok ? "text-emerald-700" : "text-amber-800"}`}>{issues}</span>
                  </div>
                  <button
                    className="shrink-0 px-2.5 py-1 rounded-md text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700"
                    onClick={(e) => {
                      e.stopPropagation();
                      apply(s.id);
                    }}
                  >
                    Use
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex gap-4 min-h-[28rem]">
        <aside className="w-52 shrink-0 bg-white border rounded-xl p-3 overflow-auto">
          <h2 className="font-medium text-sm mb-2">Unplaced ({unplaced.length})</h2>
          {unplaced.map((l) => (
            <div
              key={l.id}
              draggable
              onDragStart={() => setDragging(l)}
              className={`mb-2 rounded border px-2 py-1 text-xs cursor-grab ${isJoinedLesson(l) ? "border-violet-300 bg-violet-50" : ""}`}
              style={{ borderLeft: `4px solid ${l.color || "#64748b"}` }}
            >
              <div className="font-medium">{l.subject}</div>
              <div className="text-slate-500">{isJoinedLesson(l) ? joinedShort(l) : l.section} · {l.teachers?.[0]}</div>
              {isJoinedLesson(l) ? <div className="text-[10px] text-violet-700 font-semibold">Shared classes</div> : null}
            </div>
          ))}
          {unplaced.length === 0 && <p className="text-xs text-slate-400">All cards placed, or add lessons first.</p>}
        </aside>
        <section className="flex-1 min-w-0 bg-white border rounded-xl overflow-hidden flex flex-col">
          <div className="shrink-0 px-3 py-2 border-b flex flex-wrap items-center gap-2">
            {(["section", "teacher"] as View[]).map((v) => (
              <button key={v} onClick={() => { setView(v); setFilter(""); }} className={`text-sm px-2 py-1 rounded ${view === v ? "bg-indigo-600 text-white" : "bg-slate-100"}`}>
                {v === "section" ? "Class" : "Teacher"}
              </button>
            ))}
            <div className="w-52">
              <SearchSelect
                value={filter}
                onChange={setFilter}
                options={filterOptions.map((o: any) => ({ value: o, label: o }))}
                placeholder={view === "section" ? "Search class" : "Search teacher"}
                allowEmpty
                emptyLabel="All"
              />
            </div>
            <p className="text-[11px] text-slate-500">
              Shared classes have a violet mark. Stack two cards in one cell, then save a group. Generate again keeps saved groups.
            </p>
          </div>
          {preview && (
            <div className="shrink-0 px-3 py-1 text-xs bg-indigo-50 text-indigo-900 border-b font-bold">
              Preview {preview.label} · not saved until Use
            </div>
          )}
          <div className="flex-1 overflow-auto">
          {!display?.days?.length ? (
            <div className="p-8 text-sm text-slate-500 text-center">
              Generate a timetable, or create a template if none exists.
            </div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr>
                  <th className="p-2 border bg-slate-50">Period</th>
                  {display.days.map((d: any) => (
                    <th key={d.id} className="p-2 border bg-slate-50">{d.name.slice(0, 3)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {display.periods.map((p: any) => {
                  if (!isTeachingPeriod(p)) {
                    return (
                      <tr key={p.id} className="bg-amber-50 text-amber-900">
                        <td className="p-2 border font-medium">{p.name}</td>
                        <td className="p-2 border text-center italic" colSpan={display.days.length}>{periodTypeLabel(p.period_type)}</td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={p.id}>
                      <td className="p-2 border font-medium bg-slate-50">{p.name}</td>
                      {display.days.map((d: any) => {
                        const cells = (cellMap[`${d.id}|${p.id}`] || []).filter(visible);
                        const uniqueLessons = new Set(cells.map((a: any) => a.lesson_id));
                        const bands = new Map<string, { id: string; name: string; items: any[] }>();
                        const rest: any[] = [];
                        const seen = new Set<string>();
                        for (const a of cells) {
                          if (a.band_id) {
                            const b = bands.get(a.band_id) || { id: a.band_id, name: a.band_name || "Group", items: [] };
                            if (!b.items.some((x) => x.lesson_id === a.lesson_id)) b.items.push(a);
                            bands.set(a.band_id, b);
                          } else if (!seen.has(a.lesson_id)) {
                            seen.add(a.lesson_id);
                            rest.push(a);
                          }
                        }
                        const grouped = [...bands.values()];
                        const allGrouped = grouped.length === 1 && rest.length === 0 && uniqueLessons.size > 1;
                        return (
                          <td key={d.id} className="p-1 border h-16 align-top" onDragOver={(e) => e.preventDefault()} onDrop={() => drop(d, p, cells.length > 0)}>
                            {grouped.map((b) => {
                              const tip = `${b.name} — ${b.items.map((x) => [x.subject || x.short, x.teacher].filter(Boolean).join(" · ")).join("; ")}${b.items[0]?.sections?.length ? ` · ${b.items[0].sections.join(" + ")}` : ""}`;
                              return (
                                <button
                                  key={b.id}
                                  type="button"
                                  title={tip}
                                  onClick={() => setGroupInfo({ name: b.name, day: d.name, period: p.name, items: b.items })}
                                  className="w-full text-left rounded px-1.5 py-1 mb-1 text-[11px] text-white bg-violet-700 hover:bg-violet-800"
                                >
                                  <div className="font-semibold truncate">{b.name}</div>
                                  <div className="text-[9px] uppercase tracking-wide opacity-90">{b.items.length} subjects</div>
                                </button>
                              );
                            })}
                            {rest.map((a: any) => (
                              <div
                                key={`${a.id}-${a.period_id}`}
                                draggable
                                onDragStart={() => setDragging({ ...a, allocation_id: a.id })}
                                className={`rounded px-1 py-0.5 mb-1 text-[11px] cursor-grab text-white ${isJoinedLesson(a) ? "ring-2 ring-white/80 ring-offset-1 ring-offset-violet-600" : ""}`}
                                style={{ background: a.color || "#64748b" }}
                                title={isJoinedLesson(a) ? `Shared: ${joinedShort(a)}` : a.section}
                              >
                                <div className="flex items-center justify-between gap-1">
                                  <span>
                                    {a.short} {view === "teacher" ? a.section : a.teacher ? `· ${a.teacher.split(" ")[0]}` : ""}
                                  </span>
                                  {a.lock_level && a.lock_level !== "none" ? <span className="opacity-80">•</span> : null}
                                </div>
                                {isJoinedLesson(a) ? <div className="text-[9px] font-semibold uppercase tracking-wide opacity-90">Shared · {joinedShort(a)}</div> : null}
                              </div>
                            ))}
                            {uniqueLessons.size > 1 && !preview && !allGrouped && (
                              <button
                                type="button"
                                onClick={() => openGroup(d, p, cells)}
                                className="mt-0.5 w-full rounded border border-dashed border-violet-400 bg-violet-50 text-[10px] font-semibold text-violet-800 py-0.5 hover:bg-violet-100"
                              >
                                Save group
                              </button>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          </div>
        </section>
      </div>

      {groupInfo && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setGroupInfo(null)}>
          <div className="w-full max-w-sm rounded-xl bg-white shadow-xl border border-slate-200 p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <h2 className="font-semibold text-slate-900">{groupInfo.name}</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {groupInfo.day} · {groupInfo.period}
                </p>
              </div>
              <IconButton icon="close" label="Close" onClick={() => setGroupInfo(null)} />
            </div>
            <ul className="space-y-2">
              {groupInfo.items.map((a: any) => (
                <li key={a.lesson_id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                  <div className="font-medium text-slate-900">{a.subject || a.short}</div>
                  <div className="text-xs text-slate-600">
                    {[a.teacher, (a.sections || []).join(" + ") || a.section].filter(Boolean).join(" · ")}
                  </div>
                  {isJoinedLesson(a) ? <div className="text-[11px] text-violet-700 font-semibold mt-0.5">Shared classes</div> : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {groupCell && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl border border-slate-200 p-4">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <h2 className="font-semibold text-slate-900">Save as group</h2>
                <p className="text-xs text-slate-500 mt-1">
                  {groupCell.day.name} · {groupCell.period.name}. This name is what appears on the timetable. Hover or click the cell later for the subjects inside.
                </p>
              </div>
              <IconButton icon="close" label="Close" onClick={() => setGroupCell(null)} />
            </div>
            <label className="block mb-3">
              <span className="text-xs font-medium text-slate-700">Group name</span>
              <input
                className="mt-0.5 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
                value={groupCell.name}
                placeholder="II Language"
                autoFocus
                onChange={(e) => setGroupCell({ ...groupCell, name: e.target.value.toUpperCase() })}
              />
            </label>
            <ul className="text-xs text-slate-600 space-y-1 mb-1">
              {groupCell.members.map((m) => (
                <li key={m.lesson_id}>
                  {m.subject}
                  {m.joined ? <span className="ml-1 text-violet-700 font-semibold">Shared · {m.sections.join(" + ")}</span> : null}
                </li>
              ))}
            </ul>
            {weeklyForMembers(groupCell.members) > 1 && (
              <p className="mt-3 text-sm text-slate-700 bg-violet-50 border border-violet-100 rounded-lg px-3 py-2">
                {groupCell.members.map((m) => m.subject).join(" and ")} run{" "}
                <strong>{weeklyForMembers(groupCell.members)} times</strong> this week (including shared classes). Apply this
                group to all of them, or only this period?
              </p>
            )}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" className="h-9 px-3 rounded-lg border border-slate-200 text-sm" onClick={() => setGroupCell(null)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={savingGroup || !groupCell.name.trim()}
                className="h-9 px-3 rounded-lg border border-slate-300 text-sm disabled:opacity-50"
                onClick={() => saveGroup(false)}
              >
                {savingGroup ? "Saving…" : "This period only"}
              </button>
              {weeklyForMembers(groupCell.members) > 1 && (
                <button
                  type="button"
                  disabled={savingGroup || !groupCell.name.trim()}
                  className="h-9 px-3 rounded-lg bg-violet-700 text-white text-sm font-medium disabled:opacity-50"
                  onClick={() => saveGroup(true)}
                >
                  {savingGroup ? "Saving…" : `Yes, all ${weeklyForMembers(groupCell.members)} periods`}
                </button>
              )}
              {weeklyForMembers(groupCell.members) <= 1 && (
                <button
                  type="button"
                  disabled={savingGroup || !groupCell.name.trim()}
                  className="h-9 px-3 rounded-lg bg-violet-700 text-white text-sm font-medium disabled:opacity-50"
                  onClick={() => saveGroup(false)}
                >
                  {savingGroup ? "Saving…" : "Save group"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
