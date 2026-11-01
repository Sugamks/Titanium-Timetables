import { useEffect, useMemo, useState, type FormEvent } from "react";

type LessonDraft = {
  id: string;
  section_ids: string[];
  subject_id: string;
  teacher_resource_ids: string[];
  room_resource_id: string;
  frequency_per_week: number;
  duration_periods: number;
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
  };
}

function sameDraft(a: LessonDraft, b: LessonDraft) {
  return JSON.stringify(a) === JSON.stringify(b);
}
import { Link } from "react-router-dom";
import { api } from "../../api";
import { withBusy } from "../../ui/busy";
import SearchSelect, { Field, inputClass, MultiSearchSelect, type SelectOption } from "../../ui/SearchSelect";
import { IconButton } from "../../ui/icons";
import { isJoinedLesson, joinedShort } from "../../ui/lessonMarks";

export default function LessonsPanel({
  catalog,
  yearId,
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
    teacher_resource_ids: catalog?.teachers?.[0]?.resource_id ? [catalog.teachers[0].resource_id] : [] as string[],
    room_resource_id: "",
    frequency_per_week: 5,
    duration_periods: 1,
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

  const subjectOpts: SelectOption[] = yearSubjects.map((s: any) => ({
    value: s.id,
    label: s.name,
    short: s.short_name || "",
  }));
  const sectionOpts: SelectOption[] = yearSections.map((s: any) => ({ value: s.id, label: s.name }));
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
  const teacherOpts: SelectOption[] = (catalog?.teachers || []).map((s: any) => ({ value: s.resource_id, label: s.name }));
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
    return /^#[0-9a-fA-F]{6}$/.test(l.color || "") ? l.color : "#64748b";
  }

  const yearTemplates = useMemo(
    () => (catalog?.timetables || []).filter((t: any) => !yearId || t.academic_year_id === yearId),
    [catalog, yearId]
  );
  const hasTemplate = yearTemplates.length > 0;

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
    setSaving(true);
    try {
      const grid =
        catalog?.time_grids?.find((g: any) => yearTemplates.some((t: any) => t.time_grid_id === g.id)) ||
        catalog?.time_grids?.find((g: any) => g.academic_year_id === yearId);
      await api("/v1/lessons", {
        method: "POST",
        body: JSON.stringify({
          subject_id: form.subject_id,
          section_ids: form.section_ids,
          teacher_resource_ids: form.teacher_resource_ids,
          room_resource_id: form.room_resource_id || null,
          frequency_per_week: form.frequency_per_week,
          duration_periods: form.duration_periods,
          time_grid_id: grid?.id,
          week_pattern_id: catalog?.week_patterns?.find((p: any) => p.code === "ALL")?.id,
        }),
      });
      await onChanged();
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
    setBusyId(edit.id);
    onError("");
    try {
      await api(`/v1/lessons/${edit.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          section_ids: edit.section_ids,
          subject_id: edit.subject_id,
          teacher_resource_ids: edit.teacher_resource_ids,
          room_resource_id: edit.room_resource_id || null,
          frequency_per_week: edit.frequency_per_week,
          duration_periods: edit.duration_periods,
        }),
      });
      await onChanged();
      const name = yearSubjects.find((s: any) => s.id === edit.subject_id)?.name || openLesson?.subject || "Lesson";
      const teachers = edit.teacher_resource_ids
        .map((id) => teacherOpts.find((o) => o.value === id)?.label)
        .filter(Boolean);
      onMessage(`Saved ${name}${teachers.length ? ` · ${teachers.join(", ")}` : ""}.`);
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
        const bits = [`Cloned ${r.created || 0} lesson${r.created === 1 ? "" : "s"}.`];
        if (r.skipped_existing) bits.push(`${r.skipped_existing} already existed.`);
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
    await cloneLessons({ source_section_id: source });
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
      await api(`/v1/lessons/${id}`, { method: "DELETE" });
      if (openId === id) setOpenId("");
      await onChanged();
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusyId("");
    }
  }

  if (!hasTemplate) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 shadow-sm text-center">
        <h2 className="font-semibold text-slate-900">Create a template first</h2>
        <p className="text-sm text-slate-500 mt-2 max-w-lg mx-auto">
          Lessons need a timetable template (bell times and periods) for this year. Add one under Templates, then come back here.
        </p>
        <Link
          to="/timetable"
          className="inline-block mt-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-4 py-2 text-sm font-medium"
        >
          Go to Templates
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-8">
      <form onSubmit={addLesson} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
        <div className="flex flex-wrap justify-between gap-2 mb-3">
          <div>
            <h2 className="font-semibold text-slate-900">Add lesson</h2>
            <p className="text-xs text-slate-500">
              One class is the usual case. Pick several classes only when whole classes share the same period.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[10rem]">
            <MultiSearchSelect
              label="Classes"
              values={form.section_ids}
              onChange={(section_ids) => setForm({ ...form, section_ids })}
              options={sectionOpts}
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
              onChange={(teacher_resource_ids) => setForm({ ...form, teacher_resource_ids })}
              options={teacherOpts}
              placeholder="Select teachers"
            />
          </div>
          <div className="w-24 shrink-0">
            <Field label="Periods / week">
              <input type="number" min={1} className={inputClass} value={form.frequency_per_week} onChange={(e) => setForm({ ...form, frequency_per_week: Number(e.target.value) })} />
            </Field>
          </div>
          <div className="w-20 shrink-0">
            <Field label="Length">
              <input type="number" min={1} className={inputClass} value={form.duration_periods} onChange={(e) => setForm({ ...form, duration_periods: Number(e.target.value) })} />
            </Field>
          </div>
          <div className="shrink-0">
            <Field label={"\u00a0"}>
              <button disabled={saving} className="h-[42px] px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium disabled:opacity-50">
                {saving ? "Adding…" : "Add lesson"}
              </button>
            </Field>
          </div>
        </div>
      </form>

      <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold text-slate-900">Lesson cards</h2>
            <div className="flex items-center gap-2">
              <input className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm w-36" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
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
                options={sectionOpts.filter((o) => o.value !== sourceId)}
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
              className="h-[38px] px-3 text-sm rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-50"
            >
              {replacing ? "Replacing…" : "Replace"}
            </button>
          </div>
        </div>
        {classRows.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">No lessons yet. Add one above, then open Timetable to generate.</div>
        ) : (
          <div className="max-h-[min(36rem,65vh)] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500 sticky top-0 z-10">
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
                    <tr key={row.section.id} className={`border-t border-slate-100 align-top ${busyId === row.section.id ? "opacity-60" : ""}`}>
                      <td className="p-3 text-slate-400">{idx + 1}</td>
                      <td className="p-3 font-medium text-slate-900 whitespace-nowrap">{row.section.name}</td>
                      <td className="p-3">
                        {row.lessons.length === 0 ? (
                          <span className="text-slate-400">Not applied</span>
                        ) : (
                          <>
                            <div className="flex flex-wrap gap-1.5">
                              {row.lessons.map((l) => {
                                const color = subjectColor(l);
                                const on = openId === l.id;
                                return (
                                  <button
                                    key={l.id}
                                    type="button"
                                    title={`${l.subject}${isJoinedLesson(l) ? ` · shared ${joinedShort(l)}` : ""}${l.teachers?.length ? ` · ${l.teachers.join(", ")}` : ""}`}
                                    onClick={() => toggleOpen(l.id)}
                                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium border ${on ? "ring-2 ring-indigo-400" : ""} ${isJoinedLesson(l) ? "ring-1 ring-violet-400" : ""}`}
                                    style={{ background: `${color}22`, borderColor: isJoinedLesson(l) ? "#7c3aed" : color, color: "var(--app-text)" }}
                                  >
                                    {l.subject}: {lessonLoad(l)}
                                    {isJoinedLesson(l) ? <span className="text-violet-700 font-semibold">shared</span> : null}
                                    {l.groups?.length ? <span className="text-slate-500 font-normal">· {l.groups[0]}</span> : null}
                                    {l.duration_periods > 1 ? <span className="text-slate-500 font-normal">×{l.duration_periods}</span> : null}
                                  </button>
                                );
                              })}
                            </div>
                            <div className="mt-2 text-xs text-slate-600">
                              <strong>Total workload: {total}</strong>
                            </div>
                            {rowOpen && (
                              <div className="mt-3 p-3 rounded-lg border border-slate-200 bg-slate-50 space-y-3">
                                <div className="flex flex-wrap gap-2 items-end">
                                  <div className="flex-1 min-w-[8rem]">
                                    <MultiSearchSelect
                                      compact
                                      label="Classes"
                                      values={rowOpen.section_ids}
                                      onChange={(section_ids) => setEdit({ ...rowOpen, section_ids })}
                                      options={sectionOpts}
                                      placeholder="Classes"
                                    />
                                  </div>
                                  <div className="flex-1 min-w-[8rem]">
                                    <SearchSelect
                                      compact
                                      label="Subject"
                                      value={rowOpen.subject_id}
                                      onChange={(subject_id) => setEdit({ ...rowOpen, subject_id })}
                                      options={subjectOpts}
                                      placeholder="Subject"
                                    />
                                  </div>
                                  <div className="flex-1 min-w-[9rem]">
                                    <MultiSearchSelect
                                      compact
                                      label="Teachers"
                                      values={rowOpen.teacher_resource_ids}
                                      onChange={(teacher_resource_ids) => setEdit({ ...rowOpen, teacher_resource_ids })}
                                      options={teacherOpts}
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
                                        onChange={(e) => setEdit({ ...rowOpen, frequency_per_week: Number(e.target.value) || 1 })}
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
                                </div>
                                <div className="flex items-center justify-end gap-2">
                                  {dirty && <span className="text-xs text-amber-700 mr-auto">Unsaved changes</span>}
                                  <button
                                    type="button"
                                    disabled={!dirty || busyId === rowOpen.id}
                                    onClick={saveEdit}
                                    className="h-8 px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium disabled:opacity-40"
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

      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <h2 className="px-4 py-3 font-semibold border-b border-slate-100">Teacher load</h2>
        {yearWorkload.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">Load appears after you add lessons.</div>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500 sticky top-0">
                <tr>
                  <th className="p-3 font-medium">Teacher</th>
                  <th className="p-3 font-medium">Periods</th>
                  <th className="p-3 font-medium">Util</th>
                </tr>
              </thead>
              <tbody>
                {yearWorkload.map((w) => (
                  <tr key={w.resource_id} className="border-t border-slate-100">
                    <td className="p-3">{w.name}</td>
                    <td className="p-3 text-slate-600">{w.teaching}{w.contract ? ` / ${w.contract}` : ""}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div className={`h-full ${w.utilization > 100 ? "bg-red-500" : "bg-indigo-500"}`} style={{ width: `${Math.min(100, w.utilization)}%` }} />
                        </div>
                        <span className="text-xs text-slate-500 w-9 text-right">{w.utilization}%</span>
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
