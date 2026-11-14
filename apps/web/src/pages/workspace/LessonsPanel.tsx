import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api } from "../../api";
import { withBusy } from "../../ui/busy";
import SearchSelect, { Field, inputClass, MultiSearchSelect, type SelectOption } from "../../ui/SearchSelect";
import { IconButton } from "../../ui/icons";
import { isJoinedLesson, joinedShort } from "../../ui/lessonMarks";
import NeedTemplate from "../../ui/NeedTemplate";

type LessonDraft = {
  id: string;
  section_ids: string[];
  subject_id: string;
  teacher_resource_ids: string[];
  room_resource_id: string;
  frequency_per_week: number;
  duration_periods: number;
  blocks: string;
  week_pattern_id: string;
  allowed_room_ids: string[];
};

function lessonDraft(l: any): LessonDraft {
  return {
    id: l.id,
    section_ids: l.section_ids?.length ? [...l.section_ids] : l.section_id ? [l.section_id] : [],
    subject_id: l.subject_id || "",
    teacher_resource_ids: [...(l.teacher_resource_ids || [])],
    room_resource_id: l.room_resource_ids?.[0] || "",
    frequency_per_week: Number(l.frequency_per_week) || 1,
    duration_periods: Number(l.duration_periods) || 1,
    blocks: Array.isArray(l.blocks) && l.blocks.length ? l.blocks.join(",") : "",
    week_pattern_id: l.week_pattern_id || "",
    allowed_room_ids: [...(l.allowed_room_ids || [])],
  };
}

function parseBlocks(text: string): number[] | null {
  const parts = text.split(/[^0-9]+/).map((n) => Number(n)).filter((n) => n > 0);
  return parts.length ? parts : null;
}

function sameDraft(a: LessonDraft, b: LessonDraft) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Spread weekly cards across staff (e.g. 5 → 3+2). */
function splitLoads(teacherIds: string[], total: number): Record<string, number> {
  const n = teacherIds.length;
  if (!n) return {};
  const base = Math.floor(total / n);
  const rem = total % n;
  const out: Record<string, number> = {};
  teacherIds.forEach((id, i) => {
    out[id] = base + (i < rem ? 1 : 0);
  });
  return out;
}

export default function LessonsPanel({
  catalog,
  yearId,
  templates,
  templateId,
  timeGridId,
  onLessonUpdated,
  yearSections,
  yearSubjects,
  yearLessons,
  yearWorkload,
  onChanged,
  onError,
  onMessage,
}: {
  catalog: any;
  yearId: string;
  templates?: any[];
  templateId?: string;
  onTemplateChange?: (id: string) => void;
  timeGridId?: string;
  onLessonUpdated?: (lesson: any) => void;
  yearSections: any[];
  yearSubjects: any[];
  yearLessons: any[];
  yearWorkload: any[];
  onChanged: () => Promise<void> | void;
  onError: (m: string) => void;
  onMessage: (m: string) => void;
}) {
  const [form, setForm] = useState({
    subject_id: yearSubjects[0]?.id || "",
    section_ids: yearSections[0]?.id ? [yearSections[0].id] : [] as string[],
    teacher_resource_ids: (catalog?.teachers || []).find((t: any) => t.is_active !== false)?.resource_id
      ? [(catalog?.teachers || []).find((t: any) => t.is_active !== false).resource_id]
      : [] as string[],
    room_resource_id: "",
    frequency_per_week: 5,
    duration_periods: 1,
    blocks: "",
    week_pattern_id: "",
    allowed_room_ids: [] as string[],
  });
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [busyId, setBusyId] = useState("");
  const [cloneFrom, setCloneFrom] = useState("");
  const [cloneTo, setCloneTo] = useState<string[]>([]);
  const [cloning, setCloning] = useState(false);
  const [replaceFrom, setReplaceFrom] = useState("");
  const [replaceTo, setReplaceTo] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [openId, setOpenId] = useState("");
  const [edit, setEdit] = useState<LessonDraft | null>(null);
  const [splitStaff, setSplitStaff] = useState(false);
  const [staffLoads, setStaffLoads] = useState<Record<string, number>>({});
  const [editSplit, setEditSplit] = useState(false);
  const [editLoads, setEditLoads] = useState<Record<string, number>>({});

  const subjectOpts: SelectOption[] = yearSubjects
    .filter((s: any) => s.is_active !== false)
    .map((s: any) => ({
      value: s.id,
      label: s.name,
      short: s.short_name || "",
    }));
  const sectionOpts: SelectOption[] = yearSections.map((s: any) => ({ value: s.id, label: s.name }));
  const activeSectionOpts: SelectOption[] = yearSections
    .filter((s: any) => s.is_active !== false)
    .map((s: any) => ({ value: s.id, label: s.name }));
  const lessonSectionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const l of yearLessons) {
      const list = l.section_ids?.length ? l.section_ids : l.section_id ? [l.section_id] : [];
      for (const id of list) if (id) ids.add(id);
    }
    return ids;
  }, [yearLessons]);
  const cloneSourceOpts = sectionOpts.filter((o) => lessonSectionIds.has(o.value));
  const sourceId = lessonSectionIds.has(cloneFrom) ? cloneFrom : lessonSectionIds.has(classFilter) ? classFilter : "";
  const teacherOpts: SelectOption[] = (catalog?.teachers || [])
    .filter((s: any) => s.is_active !== false)
    .map((s: any) => ({ value: s.resource_id, label: s.name }));
  function keepCurrent(options: SelectOption[], rows: any[], ids: string[], key: string): SelectOption[] {
    const have = new Set(options.map((o) => o.value));
    const extra = rows
      .filter((row) => ids.includes(row[key]) && !have.has(row[key]))
      .map((row) => ({ value: row[key], label: row.name, short: row.short_name || "" }));
    return extra.length ? [...options, ...extra] : options;
  }
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return yearLessons.filter((l) => {
      const ids = l.section_ids || [l.section_id];
      if (classFilter && !ids.includes(classFilter)) return false;
      if (!q) return true;
      const shorts = yearSubjects
        .filter((s: any) => s.id === l.subject_id)
        .map((s: any) => s.short_name || "");
      const hay = [l.subject, l.section, ...shorts, ...(l.teachers || [])].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [yearLessons, query, classFilter, yearSubjects]);

  const classRows = useMemo(() => {
    const map = new Map<string, { section: any; lessons: any[] }>();
    for (const s of yearSections) map.set(s.id, { section: s, lessons: [] });
    for (const l of visible) {
      const ids = l.section_ids?.length ? l.section_ids : l.section_id ? [l.section_id] : [];
      for (const id of ids) map.get(id)?.lessons.push(l);
    }
    let rows = [...map.values()].filter((r) => r.lessons.length > 0);
    if (classFilter) rows = rows.filter((r) => r.section.id === classFilter);
    return rows.sort((a, b) => String(a.section.name).localeCompare(String(b.section.name)));
  }, [yearSections, visible, classFilter, query]);

  function lessonLoad(l: any) {
    return (Number(l.frequency_per_week) || 0) * (Number(l.duration_periods) || 1);
  }

  function subjectColor(l: any) {
    return /^#[0-9a-fA-F]{6}$/.test(l.color || "") ? l.color : "var(--color-muted)";
  }

  const yearTemplates = useMemo(
    () => templates ?? (catalog?.timetables || []).filter((t: any) => !yearId || t.academic_year_id === yearId),
    [templates, catalog, yearId]
  );
  const hasTemplate = yearTemplates.length > 0;

  function resolveGridId() {
    const chosen = yearTemplates.find((t: any) => t.id === templateId);
    const grid =
      (timeGridId && { id: timeGridId }) ||
      (chosen?.time_grid_id && { id: chosen.time_grid_id }) ||
      catalog?.time_grids?.find((g: any) => yearTemplates.some((t: any) => t.time_grid_id === g.id)) ||
      catalog?.time_grids?.find((g: any) => g.academic_year_id === yearId);
    return grid?.id as string | undefined;
  }

  async function addLesson(e: FormEvent) {
    e.preventDefault();
    onError("");
    if (!hasTemplate) {
      onError("Create a timetable template first (Templates), then add lessons.");
      return;
    }
    if (!form.subject_id || !form.section_ids.length || !form.teacher_resource_ids.length) {
      onError("Choose a subject, at least one class, and at least one teacher.");
      return;
    }
    const doSplit = splitStaff && form.teacher_resource_ids.length > 1;
    const loads = form.teacher_resource_ids.map((id) => ({ id, n: Number(staffLoads[id]) || 0 }));
    if (doSplit) {
      const sum = loads.reduce((a, row) => a + row.n, 0);
      if (sum !== form.frequency_per_week) {
        onError(`Staff periods must add up to ${form.frequency_per_week} (now ${sum}).`);
        return;
      }
      if (loads.some((row) => row.n < 1)) {
        onError("Each staff share must be at least 1, or remove that teacher.");
        return;
      }
    }
    setSaving(true);
    try {
      const gridId = resolveGridId();
      const weekId = form.week_pattern_id || catalog?.week_patterns?.find((p: any) => p.code === "ALL")?.id;
      const base = {
        subject_id: form.subject_id,
        section_ids: form.section_ids,
        room_resource_id: form.room_resource_id || null,
        duration_periods: form.duration_periods,
        blocks: parseBlocks(form.blocks),
        allowed_room_ids: form.allowed_room_ids,
        time_grid_id: gridId,
        week_pattern_id: weekId,
      };
      if (doSplit) {
        for (const row of loads) {
          await api("/v1/lessons", {
            method: "POST",
            body: JSON.stringify({
              ...base,
              teacher_resource_ids: [row.id],
              frequency_per_week: row.n,
            }),
          });
        }
      } else {
        await api("/v1/lessons", {
          method: "POST",
          body: JSON.stringify({
            ...base,
            teacher_resource_ids: form.teacher_resource_ids,
            frequency_per_week: form.frequency_per_week,
          }),
        });
      }
      const subjectName = yearSubjects.find((s) => s.id === form.subject_id)?.name || "the lesson";
      await onChanged();
      onMessage(
        doSplit
          ? `Added ${subjectName} split across ${loads.length} staff (${loads.map((r) => r.n).join(" + ")}).`
          : `Added ${subjectName}, ${form.frequency_per_week} times a week.`
      );
    } catch (e: any) {
      onError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const openLesson = yearLessons.find((l) => l.id === openId);
  const dirty = !!(edit && openLesson && !sameDraft(edit, lessonDraft(openLesson)));

  useEffect(() => {
    if (!openId) {
      setEdit(null);
      return;
    }
    const l = yearLessons.find((x) => x.id === openId);
    if (!l) {
      setOpenId("");
      setEdit(null);
      return;
    }
    setEdit((prev) => {
      if (!prev || prev.id !== openId) return lessonDraft(l);
      const next = lessonDraft(l);
      return sameDraft(prev, next) ? next : prev;
    });
  }, [openId, yearLessons]);

  function discardIfDirty() {
    if (dirty && !window.confirm("Discard unsaved changes?")) return false;
    return true;
  }

  function toggleOpen(id: string) {
    if (openId === id) {
      if (!discardIfDirty()) return;
      setOpenId("");
      setEdit(null);
      return;
    }
    if (!discardIfDirty()) return;
    setOpenId(id);
    const l = yearLessons.find((x) => x.id === id);
    setEdit(l ? lessonDraft(l) : null);
  }

  async function saveEdit() {
    if (!edit) return;
    if (!edit.section_ids.length || !edit.subject_id || !edit.teacher_resource_ids.length) {
      onError("Choose a subject, at least one class, and at least one teacher.");
      return;
    }
    const doSplit = editSplit && edit.teacher_resource_ids.length > 1;
    const loads = edit.teacher_resource_ids.map((id) => ({ id, n: Number(editLoads[id]) || 0 }));
    if (doSplit) {
      const sum = loads.reduce((a, row) => a + row.n, 0);
      if (sum !== edit.frequency_per_week) {
        onError(`Staff periods must add up to ${edit.frequency_per_week} (now ${sum}).`);
        return;
      }
      if (loads.some((row) => row.n < 1)) {
        onError("Each staff share must be at least 1, or remove that teacher.");
        return;
      }
    }
    setBusyId(edit.id);
    onError("");
    try {
      if (doSplit) {
        const gridId = resolveGridId();
        const first = loads[0];
        await api(`/v1/lessons/${edit.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            section_ids: edit.section_ids,
            subject_id: edit.subject_id,
            teacher_resource_ids: [first.id],
            frequency_per_week: first.n,
            duration_periods: edit.duration_periods,
            blocks: parseBlocks(edit.blocks),
            allowed_room_ids: edit.allowed_room_ids,
            week_pattern_id: edit.week_pattern_id || null,
          }),
        });
        for (const row of loads.slice(1)) {
          await api("/v1/lessons", {
            method: "POST",
            body: JSON.stringify({
              subject_id: edit.subject_id,
              section_ids: edit.section_ids,
              teacher_resource_ids: [row.id],
              frequency_per_week: row.n,
              duration_periods: edit.duration_periods,
              blocks: parseBlocks(edit.blocks),
              allowed_room_ids: edit.allowed_room_ids,
              time_grid_id: gridId,
              week_pattern_id: edit.week_pattern_id || catalog?.week_patterns?.find((p: any) => p.code === "ALL")?.id,
            }),
          });
        }
        await onChanged();
        setOpenId("");
        setEdit(null);
        setEditSplit(false);
        onMessage(`Split into ${loads.length} lessons (${loads.map((r) => r.n).join(" + ")}).`);
        return;
      }
      const updated = await api(`/v1/lessons/${edit.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          section_ids: edit.section_ids,
          subject_id: edit.subject_id,
          teacher_resource_ids: edit.teacher_resource_ids,
          room_resource_id: edit.room_resource_id || null,
          frequency_per_week: edit.frequency_per_week,
          duration_periods: edit.duration_periods,
          blocks: parseBlocks(edit.blocks),
          allowed_room_ids: edit.allowed_room_ids,
          week_pattern_id: edit.week_pattern_id || null,
        }),
      });
      if (updated) onLessonUpdated?.(updated);
      await onChanged();
      const name = yearSubjects.find((s: any) => s.id === edit.subject_id)?.name || openLesson?.subject || "Lesson";
      const teachers = edit.teacher_resource_ids
        .map((id) => teacherOpts.find((o) => o.value === id)?.label)
        .filter(Boolean);
      onMessage(teachers.length ? `Saved ${name} with ${teachers.join(", ")}.` : `Saved ${name}.`);
      setEdit({ ...edit });
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusyId("");
    }
  }

  async function cloneLessons(body: Record<string, unknown>, targets?: string[]) {
    onError("");
    const source = String(body.source_section_id || "");
    const into = (targets && targets.length ? targets : cloneTo).filter((id) => id && id !== source);
    if (!into.length) {
      onError("Choose one or more classes to clone into.");
      return;
    }
    setCloning(true);
    try {
      await withBusy("Cloning lessons…", async () => {
        const r = await api("/v1/lessons/clone", { method: "POST", body: JSON.stringify({ ...body, target_section_ids: into }) });
        await onChanged();
        const bits: string[] = [];
        if (r.created) bits.push(`Added ${r.created} lesson${r.created === 1 ? "" : "s"}.`);
        if (r.updated) bits.push(`Updated staff on ${r.updated} existing lesson${r.updated === 1 ? "" : "s"}.`);
        if (r.removed) bits.push(`Replaced ${r.removed} old lesson${r.removed === 1 ? "" : "s"}.`);
        if (!bits.length) bits.push("Nothing to clone.");
        if (r.skipped_joined) bits.push(`${r.skipped_joined} shared (multi-class) cards were left as-is.`);
        onMessage(bits.join(" "));
      });
    } catch (e: any) {
      onError(e.message);
    } finally {
      setCloning(false);
    }
  }

  async function clonePlan(picked?: string) {
    const source = picked || (lessonSectionIds.has(cloneFrom) ? cloneFrom : lessonSectionIds.has(classFilter) ? classFilter : "");
    if (!source) {
      onError("Choose a class to clone from.");
      return;
    }
    await cloneLessons({ source_section_id: source, time_grid_id: resolveGridId() || undefined });
  }

  async function replaceStaff() {
    onError("");
    if (!replaceFrom || !replaceTo) {
      onError("Choose the staff to replace and the new staff.");
      return;
    }
    setReplacing(true);
    try {
      const r = await api<{ updated?: number }>("/v1/lessons/replace-staff", {
        method: "POST",
        body: JSON.stringify({
          from_resource_id: replaceFrom,
          to_resource_id: replaceTo,
          section_id: classFilter || null,
        }),
      });
      await onChanged();
      onMessage(`Replaced staff on ${r.updated || 0} lesson${r.updated === 1 ? "" : "s"}. Generate again to reshuffle the week.`);
    } catch (e: any) {
      onError(e.message);
    } finally {
      setReplacing(false);
    }
  }

  async function deleteClassPlan(sectionId: string, name: string) {
    const lessons = yearLessons.filter((l) => (l.section_ids || [l.section_id]).includes(sectionId));
    if (!lessons.length) return;
    if (!window.confirm(`Remove all lessons for ${name}? Shared cards will only drop this class.`)) return;
    onError("");
    setBusyId(sectionId);
    try {
      await withBusy("Clearing lessons…", async () => {
        for (const l of lessons) {
          const ids = (l.section_ids?.length ? l.section_ids : [l.section_id]).filter(Boolean);
          if (ids.length > 1) {
            await api(`/v1/lessons/${l.id}`, {
              method: "PATCH",
              body: JSON.stringify({ section_ids: ids.filter((id: string) => id !== sectionId) }),
            });
          } else {
            await api(`/v1/lessons/${l.id}`, { method: "DELETE" });
          }
        }
        await onChanged();
        onMessage(`Cleared lessons for ${name}.`);
      });
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusyId("");
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Remove this lesson? Placed cards for it will also be removed.")) return;
    setBusyId(id);
    try {
      const gone = yearLessons.find((l) => l.id === id);
      await api(`/v1/lessons/${id}`, { method: "DELETE" });
      if (openId === id) setOpenId("");
      await onChanged();
      onMessage(`Removed ${gone?.subject || gone?.short || "that lesson"}.`);
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusyId("");
    }
  }

  if (!hasTemplate) return <NeedTemplate what="Lessons" />;

  return (
    <div className="space-y-4 pb-8">
      <form onSubmit={addLesson} className="bg-paper-3 border border-rule rounded-xl p-4">
        <div className="flex flex-wrap justify-between gap-2 mb-3">
          <div>
            <h2 className="font-semibold text-ink">Add lesson</h2>
            <p className="text-xs text-muted">
              One class is the usual case. Pick several classes only when whole classes share the same period. To split 5 periods as 3+2, pick two teachers and turn on Split load.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[10rem]">
            <MultiSearchSelect
              label="Classes"
              values={form.section_ids}
              onChange={(section_ids) => setForm({ ...form, section_ids })}
              options={activeSectionOpts}
              placeholder="Select classes"
            />
          </div>
          <div className="flex-1 min-w-[9rem]">
            <SearchSelect label="Subject" value={form.subject_id} onChange={(subject_id) => setForm({ ...form, subject_id })} options={subjectOpts} placeholder="Subject" />
          </div>
          <div className="flex-1 min-w-[10rem]">
            <MultiSearchSelect
              label="Teachers"
              values={form.teacher_resource_ids}
              onChange={(teacher_resource_ids) => {
                setForm({ ...form, teacher_resource_ids });
                if (teacher_resource_ids.length > 1) {
                  setSplitStaff(true);
                  setStaffLoads(splitLoads(teacher_resource_ids, form.frequency_per_week));
                } else {
                  setSplitStaff(false);
                  setStaffLoads({});
                }
              }}
              options={teacherOpts}
              placeholder="Select teachers"
            />
          </div>
          <div className="w-24 shrink-0">
            <Field label="Periods / week">
              <input
                type="number"
                min={1}
                className={inputClass}
                value={form.frequency_per_week}
                onChange={(e) => {
                  const frequency_per_week = Number(e.target.value);
                  setForm({ ...form, frequency_per_week });
                  if (splitStaff && form.teacher_resource_ids.length > 1) {
                    setStaffLoads(splitLoads(form.teacher_resource_ids, frequency_per_week));
                  }
                }}
              />
            </Field>
          </div>
          <div className="w-20 shrink-0">
            <Field label="Length">
              <input type="number" min={1} className={inputClass} value={form.duration_periods} onChange={(e) => setForm({ ...form, duration_periods: Number(e.target.value) })} />
            </Field>
          </div>
          <div className="w-36 shrink-0">
            <Field label="Blocks">
              <input className={inputClass} placeholder="2,1,1,1" value={form.blocks} onChange={(e) => setForm({ ...form, blocks: e.target.value })} />
            </Field>
          </div>
          <div className="w-36 shrink-0">
            <SearchSelect
              label="Week"
              value={form.week_pattern_id}
              onChange={(week_pattern_id) => setForm({ ...form, week_pattern_id })}
              options={(catalog?.week_patterns || []).map((p: any) => ({
                value: p.id,
                label: p.code === "WEEK_A" ? "Odd week" : p.code === "WEEK_B" ? "Even week" : p.name || "Every week",
              }))}
              placeholder="Every week"
            />
          </div>
          <div className="shrink-0">
            <Field label={"\u00a0"}>
              <button disabled={saving} className="h-[42px] px-4 bg-accent hover:bg-accent text-accent-ink rounded-lg text-sm font-medium disabled:opacity-55">
                {saving ? "Adding…" : "Add lesson"}
              </button>
            </Field>
          </div>
        </div>
        {form.teacher_resource_ids.length > 1 && (
          <div className="mt-3 space-y-2">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={splitStaff}
                onChange={(e) => {
                  const on = e.target.checked;
                  setSplitStaff(on);
                  if (on) setStaffLoads(splitLoads(form.teacher_resource_ids, form.frequency_per_week));
                }}
              />
              Split load — each teacher gets their own cards (e.g. 3 + 2). Off means they co-teach every card.
            </label>
            {splitStaff && (
              <div className="flex flex-wrap gap-3">
                {form.teacher_resource_ids.map((id) => {
                  const name = teacherOpts.find((t) => t.value === id)?.label || id;
                  return (
                    <Field key={id} label={name}>
                      <input
                        type="number"
                        min={1}
                        className={`${inputClass} w-20`}
                        value={staffLoads[id] ?? 0}
                        onChange={(e) => setStaffLoads({ ...staffLoads, [id]: Number(e.target.value) || 0 })}
                      />
                    </Field>
                  );
                })}
                <p className="text-xs text-muted self-end pb-2">
                  Sum {Object.values(staffLoads).reduce((a, n) => a + (Number(n) || 0), 0)} / {form.frequency_per_week}
                </p>
              </div>
            )}
          </div>
        )}
      </form>

      <section className="bg-paper-3 border border-rule rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-rule space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold text-ink">Lesson cards</h2>
            <div className="flex items-center gap-2">
              <input className="border border-rule rounded-lg px-2 py-1.5 text-sm w-36" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
              <div className="w-44">
                <SearchSelect
                  value={classFilter}
                  onChange={setClassFilter}
                  options={sectionOpts}
                  placeholder="Search class"
                  allowEmpty
                  emptyLabel="All classes"
                />
              </div>
            </div>
          </div>
          <div className="flex items-end gap-2">
            <div className="w-52 shrink-0">
              <SearchSelect
                label="Clone from"
                value={sourceId}
                onChange={(id) => {
                  setCloneFrom(id);
                  setCloneTo((prev) => prev.filter((x) => x !== id));
                }}
                options={cloneSourceOpts}
                placeholder="Source class"
              />
            </div>
            <div className="w-56 shrink-0">
              <MultiSearchSelect
                label="Into"
                values={cloneTo.filter((id) => id !== sourceId)}
                onChange={(ids) => setCloneTo(ids.filter((id) => id !== sourceId))}
                options={activeSectionOpts.filter((o) => o.value !== sourceId)}
                placeholder="Target classes"
              />
            </div>
            <IconButton
              icon="copy"
              label={cloning ? "Cloning…" : "Clone lessons. Copies can be edited on their own."}
              variant="bordered"
              className="h-[38px] w-[38px] shrink-0"
              disabled={cloning}
              onClick={() => clonePlan()}
            />
            <div className="w-44 shrink-0">
              <SearchSelect
                label="Replace staff"
                value={replaceFrom}
                onChange={setReplaceFrom}
                options={teacherOpts}
                placeholder="Current staff"
              />
            </div>
            <div className="w-44 shrink-0">
              <SearchSelect
                label="With"
                value={replaceTo}
                onChange={setReplaceTo}
                options={teacherOpts}
                placeholder="New staff"
              />
            </div>
            <button
              type="button"
              disabled={replacing}
              onClick={replaceStaff}
              className="h-[38px] px-3 text-sm rounded-lg border border-rule hover:bg-paper-2 disabled:opacity-55"
            >
              {replacing ? "Replacing…" : "Replace"}
            </button>
          </div>
        </div>
        {classRows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted">No lessons yet. Add one above, then open Timetable to generate.</div>
        ) : (
          <div className="max-h-[min(36rem,65vh)] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-paper-2 text-left text-muted sticky top-0 z-10">
                <tr>
                  <th className="p-3 font-medium w-10">#</th>
                  <th className="p-3 font-medium w-44">Class</th>
                  <th className="p-3 font-medium">Subjects</th>
                  <th className="p-3 font-medium whitespace-nowrap text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {classRows.map((row, idx) => {
                  const total = row.lessons.reduce((n, l) => n + lessonLoad(l), 0);
                  const rowOpen = edit && row.lessons.some((l) => l.id === edit.id) ? edit : null;
                  return (
                    <tr key={row.section.id} className={`border-t border-rule align-top ${busyId === row.section.id ? "opacity-60" : ""}`}>
                      <td className="p-3 text-muted">{idx + 1}</td>
                      <td className="p-3 font-medium text-ink whitespace-nowrap">{row.section.name}</td>
                      <td className="p-3">
                        {row.lessons.length === 0 ? (
                          <span className="text-muted">Not applied</span>
                        ) : (
                          <>
                            <div className="flex flex-wrap gap-1.5">
                              {(() => {
                                const groups = new Map<string, any[]>();
                                for (const l of row.lessons) {
                                  const key = String(l.subject_id || l.subject || l.id);
                                  const list = groups.get(key) || [];
                                  list.push(l);
                                  groups.set(key, list);
                                }
                                return [...groups.values()].map((group) => {
                                  const head = group[0];
                                  const color = subjectColor(head);
                                  const on = group.some((l) => openId === l.id);
                                  const joined = group.some((l) => isJoinedLesson(l));
                                  const loads = group.map((l) => lessonLoad(l));
                                  const label =
                                    group.length > 1 ? `${head.subject}: ${loads.join(" + ")}` : `${head.subject}: ${loads[0]}`;
                                  const tip = group
                                    .map((l) => {
                                      const who = (l.teachers || []).join(", ") || "no staff";
                                      return `${lessonLoad(l)} · ${who}`;
                                    })
                                    .join("; ");
                                  return (
                                    <button
                                      key={group.map((l) => l.id).join("-")}
                                      type="button"
                                      title={`${head.subject}${joined ? ` · shared ${joinedShort(head)}` : ""} · ${tip}`}
                                      onClick={() => {
                                        const openInGroup = group.find((l) => l.id === openId);
                                        if (openInGroup) {
                                          const i = group.indexOf(openInGroup);
                                          const next = group[(i + 1) % group.length];
                                          if (next.id === openInGroup.id) toggleOpen(openInGroup.id);
                                          else toggleOpen(next.id);
                                          return;
                                        }
                                        toggleOpen(head.id);
                                      }}
                                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium border ${on ? "ring-2 ring-accent" : ""} ${joined ? "ring-1 ring-accent" : ""}`}
                                      style={{ background: `${color}22`, borderColor: joined ? "var(--color-accent)" : color, color: "var(--app-text)" }}
                                    >
                                      {label}
                                      {joined ? <span className="text-accent font-semibold">shared</span> : null}
                                      {head.groups?.length ? <span className="text-muted font-normal">· {head.groups[0]}</span> : null}
                                      {group.length === 1 && head.duration_periods > 1 ? (
                                        <span className="text-muted font-normal">×{head.duration_periods}</span>
                                      ) : null}
                                    </button>
                                  );
                                });
                              })()}
                            </div>
                            <div className="mt-2 text-xs text-muted">
                              <strong>Total workload: {total}</strong>
                            </div>
                            {rowOpen && (
                              <div className="mt-3 p-3 rounded-lg border border-rule bg-paper-2 space-y-3">
                                <div className="flex flex-wrap gap-2 items-end">
                                  <div className="flex-1 min-w-[8rem]">
                                    <MultiSearchSelect
                                      compact
                                      label="Classes"
                                      values={rowOpen.section_ids}
                                      onChange={(section_ids) => setEdit({ ...rowOpen, section_ids })}
                                      options={keepCurrent(activeSectionOpts, yearSections, rowOpen.section_ids || [], "id")}
                                      placeholder="Classes"
                                    />
                                  </div>
                                  <div className="flex-1 min-w-[8rem]">
                                    <SearchSelect
                                      compact
                                      label="Subject"
                                      value={rowOpen.subject_id}
                                      onChange={(subject_id) => setEdit({ ...rowOpen, subject_id })}
                                      options={keepCurrent(subjectOpts, yearSubjects, rowOpen.subject_id ? [rowOpen.subject_id] : [], "id")}
                                      placeholder="Subject"
                                    />
                                  </div>
                                  <div className="flex-1 min-w-[9rem]">
                                    <MultiSearchSelect
                                      compact
                                      label="Teachers"
                                      values={rowOpen.teacher_resource_ids}
                                      onChange={(teacher_resource_ids) => {
                                        setEdit({ ...rowOpen, teacher_resource_ids });
                                        if (teacher_resource_ids.length > 1) {
                                          setEditSplit(true);
                                          setEditLoads(splitLoads(teacher_resource_ids, rowOpen.frequency_per_week));
                                        } else {
                                          setEditSplit(false);
                                          setEditLoads({});
                                        }
                                      }}
                                      options={keepCurrent(teacherOpts, catalog?.teachers || [], rowOpen.teacher_resource_ids || [], "resource_id")}
                                      placeholder="Teachers"
                                    />
                                  </div>
                                  <div className="w-20">
                                    <Field label="Periods">
                                      <input
                                        type="number"
                                        min={1}
                                        className={`${inputClass} py-1`}
                                        value={rowOpen.frequency_per_week}
                                        onChange={(e) => {
                                          const frequency_per_week = Number(e.target.value) || 1;
                                          setEdit({ ...rowOpen, frequency_per_week });
                                          if (editSplit && rowOpen.teacher_resource_ids.length > 1) {
                                            setEditLoads(splitLoads(rowOpen.teacher_resource_ids, frequency_per_week));
                                          }
                                        }}
                                      />
                                    </Field>
                                  </div>
                                  <div className="w-16">
                                    <Field label="Length">
                                      <input
                                        type="number"
                                        min={1}
                                        className={`${inputClass} py-1`}
                                        value={rowOpen.duration_periods}
                                        onChange={(e) => setEdit({ ...rowOpen, duration_periods: Number(e.target.value) || 1 })}
                                      />
                                    </Field>
                                  </div>
                                  <div className="w-36">
                                    <Field label="Blocks">
                                      <input className={`${inputClass} py-1`} placeholder="2,1,1,1" value={rowOpen.blocks} onChange={(e) => setEdit({ ...rowOpen, blocks: e.target.value })} />
                                    </Field>
                                  </div>
                                  <div className="w-40">
                                    <SearchSelect
                                      label="Week"
                                      value={rowOpen.week_pattern_id}
                                      onChange={(week_pattern_id) => setEdit({ ...rowOpen, week_pattern_id })}
                                      options={(catalog?.week_patterns || []).map((p: any) => ({
                value: p.id,
                label: p.code === "WEEK_A" ? "Odd week" : p.code === "WEEK_B" ? "Even week" : p.name || "Every week",
              }))}
                                      placeholder="Every week"
                                    />
                                  </div>
                                  <div className="min-w-[12rem] flex-1">
                                    <MultiSearchSelect
                                      label="Allowed rooms"
                                      values={rowOpen.allowed_room_ids}
                                      onChange={(allowed_room_ids) => setEdit({ ...rowOpen, allowed_room_ids })}
                                      options={keepCurrent(
                                        (catalog?.rooms || []).filter((r: any) => r.is_active !== false).map((r: any) => ({ value: r.resource_id, label: r.name })),
                                        catalog?.rooms || [],
                                        rowOpen.allowed_room_ids || [],
                                        "resource_id",
                                      )}
                                      placeholder="Home room and type"
                                    />
                                  </div>
                                </div>
                                {rowOpen.teacher_resource_ids.length > 1 && (
                                  <div className="space-y-2">
                                    <label className="flex items-center gap-2 text-sm text-ink">
                                      <input
                                        type="checkbox"
                                        checked={editSplit}
                                        onChange={(e) => {
                                          const on = e.target.checked;
                                          setEditSplit(on);
                                          if (on) setEditLoads(splitLoads(rowOpen.teacher_resource_ids, rowOpen.frequency_per_week));
                                        }}
                                      />
                                      Split load into separate lessons (e.g. 3 + 2)
                                    </label>
                                    {editSplit && (
                                      <div className="flex flex-wrap gap-3">
                                        {rowOpen.teacher_resource_ids.map((id) => {
                                          const name = teacherOpts.find((t) => t.value === id)?.label || id;
                                          return (
                                            <Field key={id} label={name}>
                                              <input
                                                type="number"
                                                min={1}
                                                className={`${inputClass} w-20 py-1`}
                                                value={editLoads[id] ?? 0}
                                                onChange={(e) => setEditLoads({ ...editLoads, [id]: Number(e.target.value) || 0 })}
                                              />
                                            </Field>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                )}
                                <div className="flex items-center justify-end gap-2">
                                  {dirty && <span className="text-xs text-warn mr-auto">Unsaved changes</span>}
                                  <button
                                    type="button"
                                    disabled={!dirty || busyId === rowOpen.id}
                                    onClick={saveEdit}
                                    className="h-8 px-3 bg-accent hover:bg-accent text-accent-ink rounded-lg text-sm font-medium disabled:opacity-55"
                                  >
                                    {busyId === rowOpen.id ? "Saving…" : "Save"}
                                  </button>
                                  <IconButton icon="trash" label="Delete this subject" variant="danger" onClick={() => remove(rowOpen.id)} />
                                  <IconButton icon="close" label="Close" onClick={() => toggleOpen(rowOpen.id)} />
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </td>
                      <td className="p-3 whitespace-nowrap align-middle">
                        <div className="inline-flex flex-nowrap items-center gap-1">
                          <IconButton icon="trash" label="Delete all" variant="dangerSolid" onClick={() => deleteClassPlan(row.section.id, row.section.name)} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="bg-paper-3 border border-rule rounded-xl overflow-hidden">
        <h2 className="px-4 py-3 font-semibold border-b border-rule">Teacher load</h2>
        {yearWorkload.length === 0 ? (
          <div className="p-6 text-sm text-muted">Load appears after you add lessons.</div>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-paper-2 text-left text-muted sticky top-0">
                <tr>
                  <th className="p-3 font-medium">Teacher</th>
                  <th className="p-3 font-medium">Periods</th>
                  <th className="p-3 font-medium">Util</th>
                </tr>
              </thead>
              <tbody>
                {yearWorkload.map((w) => (
                  <tr key={w.resource_id} className="border-t border-rule">
                    <td className="p-3">{w.name}</td>
                    <td className="p-3 text-muted">{w.teaching}{w.contract ? ` / ${w.contract}` : ""}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-paper-2 overflow-hidden">
                          <div className={`h-full ${w.utilization > 100 ? "bg-error" : "bg-accent"}`} style={{ width: `${Math.min(100, w.utilization)}%` }} />
                        </div>
                        <span className="text-xs text-muted w-9 text-right">{w.utilization}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
