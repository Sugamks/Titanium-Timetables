import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { isTeachingPeriod } from "../periods";
import SearchSelect, { MultiSearchSelect } from "../ui/SearchSelect";
import { IconButton } from "../ui/icons";
import { currentYearId, onYearChange } from "../year";

const TEMPLATE_KEY = "construct-template-id";
import ConstraintGrid, { type PaintMode } from "./constraints/TimeOffGrid";
import PageHelp from "../ui/PageHelp";
import ErrorBanner from "../ui/ErrorBanner";
type Tab = "global" | "staff" | "class";

const PAINTED_TYPES = new Set([
 "TeacherUnavailable",
 "ClassUnavailable",
 "ForbidCategoryInPeriods",
 "ClassTeacherOnlyInPeriods",
 "NotClassTeacherInPeriods",
]);

const STAFF_MODES: PaintMode[] = [
 { id: "available", label: "Can each", className: "paint-cell bg-emerald-500 border-emerald-600 hover:bg-emerald-600 text-white", title: "Clear / can each" },
 { id: "unavailable", label: "No available", className: "paint-cell bg-slate-600 border-slate-700 hover:bg-slate-700 text-white", title: "Staff no available" },
];

const CLASS_MODES: PaintMode[] = [
 { id: "open", label: "Open", className: "paint-cell bg-emerald-500 border-emerald-600 hover:bg-emerald-600 text-white", title: "Any subject can be placed" },
 { id: "nocp", label: "No core", className: "paint-cell bg-amber-400 border-amber-500 hover:bg-amber-500 text-[#0f172a]", title: "No scholastic core (NOCP)" },
 { id: "nosl", label: "No language", className: "paint-cell bg-violet-600 border-violet-700 hover:bg-violet-700 text-white", title: "No scholastic language (NOSL)" },
 { id: "nopa", label: "No PE", className: "paint-cell bg-teal-600 border-teal-700 hover:bg-teal-700 text-white", title: "No physical activity (NOPA)" },
 { id: "cton", label: "Class teacher", className: "paint-cell bg-red-600 border-red-700 hover:bg-red-700 text-white", title: "Class teacher only (CTON)" },
 { id: "ncton", label: "No class teacher", className: "paint-cell bg-blue-600 border-blue-700 hover:bg-blue-700 text-white", title: "No class teacher (NCTON)" },
];

function ModePills({
 modes,
 value,
 onChange,
}: {
 modes: PaintMode[];
 value: string;
 onChange: (id: string) => void;
}) {
 return (
 <div className="flex flex-wrap gap-1.5">
 {modes.map((m) => (
 <button
 key={m.id}
 type="button"
 title={m.title}
 onClick={() => onChange(m.id)}
 className={`text-xs rounded-full px-2.5 py-1 border ${
            value === m.id ? "ring-2 ring-offset-1 ring-slate-800 dark:ring-indigo-300 dark:ring-offset-[#16192b]" : ""
          } ${m.className}`}
 >
 {m.label}
 </button>
 ))}
 </div>
 );
}

export default function ConstraintsPage() {
 const [resources, setResources] = useState<any>(null);
 const [yearId, setYearId] = useState(() => currentYearId());
 const [err, setErr] = useState("");
 const [tab, setTab] = useState<Tab>("global");
 const [teacherId, setTeacherId] = useState("");
 const [sectionId, setSectionId] = useState("");
 const [cells, setCells] = useState<Record<string, string>>({});
 const [classTeacherName, setClassTeacherName] = useState<string | null>(null);
 const [staffPaint, setStaffPaint] = useState("unavailable");
 const [classPaint, setClassPaint] = useState("nosl");
 const [typeCatalog, setTypeCatalog] = useState<any[]>([]);
 const [items, setItems] = useState<any[]>([]);
 const [form, setForm] = useState({
 type_code: "MaxTeacherLessonsPerDay",
 severity: "soft",
 weight: 80,
 scope: "teacher",
 scope_id: "",
 day_ids: [] as string[],
 period_ids: [] as string[],
 max: 5,
 });
 const [templateId, setTemplateId] = useState(() => {
 try {
 return sessionStorage.getItem(TEMPLATE_KEY) || "";
 } catch {
 return "";
 }
 });
 const [pin, setPin] = useState({ subject_id: "", day_id: "", period_id: "" });
 const [staffMax, setStaffMax] = useState({ consecutive: 3, perDay: 6 });
 const [presetBusy, setPresetBusy] = useState("");
 const [cloneFrom, setCloneFrom] = useState("");
 const [cloneInto, setCloneInto] = useState<string[]>([]);
 const [cloneBusy, setCloneBusy] = useState(false);

 async function loadAll() {
 const [cat, types, rows] = await Promise.all([
 api("/v1/catalog"),
 api("/v1/constraints/catalog"),
 api("/v1/constraints"),
 ]);
 setResources(cat);
 setTypeCatalog(types || []);
 setItems(rows || []);
 setTeacherId((prev) => prev || cat.teachers[0]?.resource_id || "");
 setForm((f) => ({ ...f, scope_id: f.scope_id || cat.teachers[0]?.resource_id || "" }));
 const tts = (cat.timetables || []).filter((t: any) => !yearId || t.academic_year_id === yearId);
 setTemplateId((prev) => (prev && tts.some((t: any) => t.id === prev) ? prev : tts[0]?.id || ""));
 setPin((p) => ({ ...p, subject_id: p.subject_id || cat.subjects?.[0]?.id || "" }));
 const secs = (cat.sections || []).filter((s: any) => !yearId || s.academic_year_id === yearId);
 setSectionId((prev) => prev || secs[0]?.id || "");
 }

 useEffect(() => {
 loadAll().catch((e) => setErr(e.message));
 return onYearChange(() => setYearId(currentYearId()));
 }, []);

 const sections = useMemo(() => {
 const all = resources?.sections || [];
 return yearId ? all.filter((s: any) => s.academic_year_id === yearId) : all;
 }, [resources, yearId]);
 const teachers = resources?.teachers || [];
 const templates = useMemo(
 () => (resources?.timetables || []).filter((t: any) => !yearId || t.academic_year_id === yearId),
 [resources, yearId]
 );
 useEffect(() => {
 if (!templates.length) {
 if (templateId) setTemplateId("");
 return;
 }
 if (templates.some((t: any) => t.id === templateId)) return;
 setTemplateId(templates[0].id);
 }, [templates, templateId]);
 useEffect(() => {
 try {
 if (templateId) sessionStorage.setItem(TEMPLATE_KEY, templateId);
 } catch {
 /* ignore */
 }
 }, [templateId]);
 const selectedTemplate = templates.find((t: any) => t.id === templateId);
 const grid = useMemo(() => {
 const grids = resources?.time_grids || [];
 const gridId = selectedTemplate?.time_grid_id;
 if (gridId) {
 const hit = grids.find((g: any) => g.id === gridId);
 if (hit) return hit;
 }
 return grids.find((g: any) => g.academic_year_id === yearId) || grids[0];
 }, [resources, yearId, selectedTemplate]);
 const days = grid?.days || [];
 const allPeriods = grid?.periods || [];
 const periods = allPeriods.filter((p: any) => isTeachingPeriod(p));
 const otherTypes = typeCatalog.filter((t) => !PAINTED_TYPES.has(t.code));
 const subjects = resources?.subjects || [];
 const globalItems = items.filter((i) => !i.timetable_id);
 const templateItems = items.filter((i) => i.timetable_id && (!templateId || i.timetable_id === templateId));
 const otherItems = tab === "global" ? globalItems : templateItems.filter((i) => !PAINTED_TYPES.has(i.type_code));
 const typeName = (code: string) => otherTypes.find((t) => t.code === code)?.name || code;

 useEffect(() => {
 if (!sections.length) return;
 if (!sections.some((s: any) => s.id === sectionId)) {
 setSectionId(sections[0].id);
 }
 }, [sections, sectionId]);
 useEffect(() => {
 setPin((p) => ({
 ...p,
 day_id: days.some((d: any) => d.id === p.day_id) ? p.day_id : "",
 period_id: allPeriods.some((x: any) => x.id === p.period_id) ? p.period_id : "",
 }));
 }, [grid?.id]);

 useEffect(() => {
 if (tab !== "staff" || !teacherId) {
 return;
 }
 api(`/v1/constraints/grid?kind=teacher&target_id=${encodeURIComponent(teacherId)}`)
 .then((r) => setCells(r.cells || {}))
 .catch((e) => setErr(e.message));
 }, [tab, teacherId]);

 useEffect(() => {
 if (tab !== "class" || !sectionId) {
 return;
 }
 api(`/v1/constraints/grid?kind=section&target_id=${encodeURIComponent(sectionId)}`)
 .then((r) => {
 setCells(r.cells || {});
 setClassTeacherName(r.class_teacher_name || null);
 })
 .catch((e) => setErr(e.message));
 }, [tab, sectionId]);

 async function paint(dayId: string, periodId: string, mode: string) {
 setErr("");
 const kind = tab === "staff" ? "teacher" : "section";
 const id = tab === "staff" ? teacherId : sectionId;
 if (!id) return;
 const key = `${dayId}:${periodId}`;
 const prev = cells[key];
 setCells((c) => {
 const next = { ...c };
 if (mode === "available" || mode === "open") delete next[key];
 else next[key] = mode;
 return next;
 });
 try {
 await api("/v1/constraints/paint", {
 method: "POST",
 body: JSON.stringify({ kind, id, day_id: dayId, period_id: periodId, mode }),
 });
 } catch (e: any) {
 setCells((c) => {
 const next = { ...c };
 if (!prev || prev === "available" || prev === "open") delete next[key];
 else next[key] = prev;
 return next;
 });
 setErr(e.message);
 }
 }

 async function applyPreset(code: string, extra: Record<string, unknown> = {}) {
 setErr("");
 setPresetBusy(code);
 try {
 await api("/v1/constraints/presets", {
 method: "POST",
 body: JSON.stringify({
 code,
 timetable_id: templateId || null,
 academic_year_id: yearId || null,
 section_id: sectionId || null,
 teacher_resource_id: teacherId || null,
 ...extra,
 }),
 });
 setItems((await api("/v1/constraints")) || []);
 if (tab === "class" && sectionId) {
 const g = await api(`/v1/constraints/grid?kind=section&target_id=${encodeURIComponent(sectionId)}`);
 setCells(g.cells || {});
 }
 } catch (e: any) {
 setErr(e.message);
 } finally {
 setPresetBusy("");
 }
 }

 async function saveOther(e: React.FormEvent) {
 e.preventDefault();
 setErr("");
 const params: any = {};
 if (form.type_code.includes("Unavailable") || form.type_code.startsWith("Preferred")) {
 params.day_ids = form.day_ids;
 params.period_ids = form.period_ids;
 }
 if (form.type_code.startsWith("Max") || form.type_code.startsWith("Min") || form.type_code === "ContractHours") {
 params.max = form.max;
 }
 try {
 await api("/v1/constraints", {
 method: "POST",
 body: JSON.stringify({
 type_code: form.type_code,
 severity: form.severity,
 weight: form.weight,
 scope: form.scope,
 scope_id: form.scope_id || null,
 timetable_id: form.scope === "global" ? null : templateId || null,
 params,
 }),
 });
 setItems((await api("/v1/constraints")) || []);
 } catch (e: any) {
 setErr(e.message);
 }
 }

 function dayNames(ids: string[] = []) {
 if (!ids.length) return "";
 return ids.map((id) => days.find((d: any) => d.id === id)?.name?.slice(0, 3) || id).join(", ");
 }

 const modes = tab === "staff" ? STAFF_MODES : CLASS_MODES;
 const paintMode = tab === "staff" ? staffPaint : classPaint;

 return (
 <div className="h-full min-h-0 flex flex-col gap-3">
 <header className="shrink-0 flex flex-wrap justify-between gap-3 items-start">
 <div>
 <div className="flex items-center gap-2">
 <h1 className="text-2xl font-semibold">Constraints</h1>
 <PageHelp page="constraints" />
 </div>
 <p className="text-slate-500 text-sm mt-1">
 Global rules apply to every template. Class and staff rules belong to the selected template.
 </p>
 </div>
 </header>

 <ErrorBanner className="shrink-0" message={err} onClear={() => setErr("")} />

 <div className="shrink-0 flex gap-1 border-b border-slate-200">
 {([
 { id: "global" as const, label: "Global", hint: "Firs period, pinned subjects" },
 { id: "class" as const, label: "Class", hint: "Template · CT, PE, last period" },
 { id: "staff" as const, label: "Staff", hint: "Template · availability and load" },
 ]).map((t) => (
 <button
 key={t.id}
 onClick={() => {
 setTab(t.id);
 setCells({});
 }}
 className={`px-4 py-2 text-sm rounded-t-lg ${
              tab === t.id ? "bg-white border border-b-white border-slate-200 -mb-px font-medium text-slate-900" : "text-slate-500 hover:text-slate-800"
            }`}
 >
 {t.label}
 <span className="hidden sm:inline text-slate-400 font-normal"> · {t.hint}</span>
 </button>
 ))}
 </div>

 <div className="flex-1 min-h-0 bg-white border rounded-xl p-4 shadow-sm flex flex-col gap-3 overflow-auto">
 {tab === "global" ? (
 <>
 {templates.length > 0 && (
 <div className="w-64">
 <SearchSelect
 label="Template"
 value={templateId}
 onChange={setTemplateId}
 options={templates.map((t: any) => ({ value: t.id, label: t.name }))}
 placeholder="Template"
 />
 </div>
 )}
 <div className="flex flex-wrap gap-2">
 <button
 type="button"
 disabled={!!presetBusy}
 onClick={() => applyPreset("first_period_class_teacher")}
 className="text-sm rounded-lg border border-slate-200 bg-white px-3 py-2 hover:bg-slate-50 disabled:opacity-50"
 >
 {presetBusy === "first_period_class_teacher" ? "Saving…" : "All first periods = class teacher"}
 </button>
 <button
 type="button"
 disabled={!!presetBusy}
 onClick={() => applyPreset("second_period_non_class_teacher")}
 className="text-sm rounded-lg border border-slate-200 bg-white px-3 py-2 hover:bg-slate-50 disabled:opacity-50"
 >
 {presetBusy === "second_period_non_class_teacher" ? "Saving…" : "All second periods = no class teacher"}
 </button>
 </div>
 <div className="flex flex-wrap items-end gap-2 p-3 rounded-lg border border-slate-200 bg-slate-50">
 <div className="w-52">
 <SearchSelect
 label="Pin subject"
 value={pin.subject_id}
 onChange={(subject_id) => setPin({ ...pin, subject_id })}
 options={subjects.map((s: any) => ({ value: s.id, label: s.name }))}
 placeholder="Subject"
 />
 </div>
 <div className="w-36">
 <SearchSelect
 label="Day"
 value={pin.day_id}
 onChange={(day_id) => setPin({ ...pin, day_id })}
 options={days.map((d: any) => ({ value: d.id, label: d.name }))}
 placeholder="Day"
 />
 </div>
 <div className="w-36">
 <SearchSelect
 label="Period"
 value={pin.period_id}
 onChange={(period_id) => setPin({ ...pin, period_id })}
 options={periods.map((p: any) => ({ value: p.id, label: p.name }))}
 placeholder="Period"
 />
 </div>
 <button
 type="button"
 disabled={!!presetBusy}
 onClick={() => applyPreset("pin_subject", pin)}
 className="h-10 px-3 bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-50"
 >
 {presetBusy === "pin_subject" ? "Saving…" : "Pin"}
 </button>
 </div>
 <form onSubmit={saveOther} className="space-y-3">
 <div className="grid md:grid-cols-3 gap-3">
 <SearchSelect
 label="Type"
 value={form.type_code}
 onChange={(type_code) => setForm({ ...form, type_code })}
 options={otherTypes.map((c) => ({ value: c.code, label: c.name }))}
 placeholder="Search type"
 />
 <SearchSelect
 label="Strength"
 value={form.severity}
 onChange={(severity) => setForm({ ...form, severity })}
 options={[
 { value: "hard", label: "Must" },
 { value: "soft", label: "Prefer" },
 ]}
 placeholder="Strength"
 />
 <label className="text-sm">Weight
 <input type="number" className="mt-1 w-full border rounded-lg px-2 py-1.5" value={form.weight} onChange={(e) => setForm({ ...form, weight: Number(e.target.value) })} />
 </label>
 </div>
 <div className="grid md:grid-cols-3 gap-3">
 <SearchSelect
 label="Applies o"
 value={form.scope}
 onChange={(scope) => setForm({ ...form, scope, scope_id: "" })}
 options={[
 { value: "teacher", label: "Teacher" },
 { value: "section", label: "Class" },
 { value: "global", label: "Whole school" },
 ]}
 placeholder="Scope"
 />
 {form.scope === "teacher" && (
 <SearchSelect
 label="Teacher"
 value={form.scope_id}
 onChange={(scope_id) => setForm({ ...form, scope_id })}
 options={teachers.map((t: any) => ({ value: t.resource_id, label: t.name }))}
 placeholder="Search staff"
 />
 )}
 {form.scope === "section" && (
 <SearchSelect
 label="Class"
 value={form.scope_id}
 onChange={(scope_id) => setForm({ ...form, scope_id })}
 options={sections.map((s: any) => ({ value: s.id, label: s.name }))}
 placeholder="Search class"
 />
 )}
 {(form.type_code.startsWith("Max") || form.type_code.startsWith("Min") || form.type_code === "ContractHours") && (
 <label className="text-sm">Max / min
 <input type="number" className="mt-1 w-full border rounded-lg px-2 py-1.5" value={form.max} onChange={(e) => setForm({ ...form, max: Number(e.target.value) })} />
 </label>
 )}
 </div>
 <div className="flex flex-wrap gap-2 text-sm">
 {days.map((d: any) => (
 <label key={d.id} className="border rounded-lg px-2 py-1">
 <input
 type="checkbox"
 checked={form.day_ids.includes(d.id)}
 onChange={(e) =>
 setForm({
 ...form,
 day_ids: e.target.checked ? [...form.day_ids, d.id] : form.day_ids.filter((x) => x !== d.id),
 })
 }
 />{" "}
 {d.name.slice(0, 3)}
 </label>
 ))}
 </div>
 <div className="flex flex-wrap gap-2 text-sm">
 {periods.map((p: any) => (
 <label key={p.id} className="border rounded-lg px-2 py-1">
 <input
 type="checkbox"
 checked={form.period_ids.includes(p.id)}
 onChange={(e) =>
 setForm({
 ...form,
 period_ids: e.target.checked ? [...form.period_ids, p.id] : form.period_ids.filter((x) => x !== p.id),
 })
 }
 />{" "}
 {p.name}
 </label>
 ))}
 </div>
 <button className="bg-indigo-600 text-white rounded-lg px-3 py-2 text-sm">Save constraint</button>
 </form>
 <ul className="border rounded-xl divide-y">
 {otherItems.length === 0 && <li className="p-3 text-sm text-slate-500">No extra constraints yet.</li>}
 {otherItems.map((i) => (
 <li key={i.id} className="p-3 flex justify-between gap-3 text-sm">
 <span>
 {typeName(i.type_code)} · {i.severity === "hard" ? "must" : "prefer"} · w{i.weight}
 {dayNames(i.params?.day_ids) ? ` · ${dayNames(i.params.day_ids)}` : ""}
 </span>
 <IconButton
 icon="trash"
 label="Delete constraint"
 variant="danger"
 onClick={async () => {
 await api(`/v1/constraints/${i.id}`, { method: "DELETE" });
 setItems((rows) => rows.filter((r) => r.id !== i.id));
 }}
 />
 </li>
 ))}
 </ul>
 </>
 ) : (
 <>
 <div className="flex flex-wrap items-end gap-3">
 {templates.length > 0 && (
 <div className="w-64">
 <SearchSelect
 label="Template"
 value={templateId}
 onChange={setTemplateId}
 options={templates.map((t: any) => ({ value: t.id, label: t.name }))}
 placeholder="Template"
 />
 </div>
 )}
 {tab === "staff" ? (
 <div className="w-72">
 <SearchSelect
 label="Teacher"
 value={teacherId}
 onChange={(id) => {
 setTeacherId(id);
 setCells({});
 }}
 options={teachers.map((t: any) => ({ value: t.resource_id, label: t.name }))}
 placeholder="Search staff"
 />
 </div>
 ) : (
 <div className="w-72">
 <SearchSelect
 label="Class"
 value={sectionId}
 onChange={(id) => {
 setSectionId(id);
 setCells({});
 }}
 options={sections.map((s: any) => ({ value: s.id, label: s.name }))}
 placeholder="Search class"
 />
 </div>
 )}
 <div className="flex-1 min-w-[16rem]">
 <div className="text-xs text-slate-500 mb-1">Paint</div>
 <ModePills
 modes={modes}
 value={paintMode}
 onChange={(id) => (tab === "staff" ? setStaffPaint(id) : setClassPaint(id))}
 />
 </div>
 </div>
 {tab === "class" && (
 <div className="flex flex-wrap items-end gap-2 p-3 rounded-lg border border-slate-200 bg-slate-50">
 <div className="w-56">
 <SearchSelect
 label="Clone from"
 value={cloneFrom || sectionId}
 onChange={setCloneFrom}
 options={sections.map((s: any) => ({ value: s.id, label: s.name }))}
 placeholder="Source class"
 />
 </div>
 <div className="flex-1 min-w-[12rem]">
 <MultiSearchSelect
 label="Into"
 values={cloneInto}
 onChange={setCloneInto}
 options={sections
 .filter((s: any) => s.id !== (cloneFrom || sectionId))
 .map((s: any) => ({ value: s.id, label: s.name }))}
 placeholder="Other classes"
 />
 </div>
 <button
 type="button"
 disabled={cloneBusy || !cloneInto.length}
 className="h-10 px-3 bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-50"
 onClick={async () => {
 setErr("");
 setCloneBusy(true);
 try {
 const into = [...cloneInto];
 await api("/v1/constraints/clone-class", {
 method: "POST",
 body: JSON.stringify({
 source_section_id: cloneFrom || sectionId,
 target_section_ids: into,
 replace: true,
 }),
 });
 setCloneInto([]);
 if (sectionId && into.includes(sectionId)) {
 const g = await api(`/v1/constraints/grid?kind=section&target_id=${encodeURIComponent(sectionId)}`);
 setCells(g.cells || {});
 }
 setItems((await api("/v1/constraints")) || []);
 } catch (e: any) {
 setErr(e.message);
 } finally {
 setCloneBusy(false);
 }
 }}
 >
 {cloneBusy ? "Copying…" : "Clone painted cells"}
 </button>
 <p className="w-full text-xs text-slate-500">
 Replaces painted class rules on the target classes (NA, NOSL, CTON, and the rest). Does not change staff constraints.
 </p>
 </div>
 )}
 {tab === "class" && (
 <div className="flex flex-wrap items-center gap-2">
 <p className="text-sm text-slate-600 mr-auto">
 Class teacher: <strong>{classTeacherName || "no set"}</strong>
 </p>
 <button
 type="button"
 disabled={!!presetBusy}
 className="text-xs rounded-lg border px-2 py-1 hover:bg-slate-50"
 onClick={() => applyPreset("no_pe_after_lunch")}
 >
 {presetBusy === "no_pe_after_lunch" ? "Saving…" : "No PE after lunch"}
 </button>
 <button
 type="button"
 disabled={!!presetBusy}
 className="text-xs rounded-lg border px-2 py-1 hover:bg-slate-50"
 onClick={() => applyPreset("no_core_last")}
 >
 {presetBusy === "no_core_last" ? "Saving…" : "No core last period"}
 </button>
 <button
 type="button"
 disabled={!!presetBusy}
 className="text-xs rounded-lg border px-2 py-1 hover:bg-slate-50"
 onClick={() => applyPreset("no_pe_after_lunch", { apply_all: true })}
 >
 Apply PE rule o all classes
 </button>
 <button
 type="button"
 disabled={!!presetBusy}
 className="text-xs rounded-lg border px-2 py-1 hover:bg-slate-50"
 onClick={() => applyPreset("no_core_last", { apply_all: true })}
 >
 Apply last-period rule o all classes
 </button>
 </div>
 )}
 {tab === "staff" && (
 <div className="flex flex-wrap items-end gap-2">
 <label className="text-xs text-slate-600">
 Max consecutive
 <input
 type="number"
 min={1}
 className="mt-1 block w-20 border rounded-lg px-2 py-1"
 value={staffMax.consecutive}
 onChange={(e) => setStaffMax({ ...staffMax, consecutive: Number(e.target.value) || 1 })}
 />
 </label>
 <button
 type="button"
 className="text-xs rounded-lg border px-2 py-1.5"
 disabled={!!presetBusy}
 onClick={() => applyPreset("max_consecutive", { max: staffMax.consecutive })}
 >
 This staff
 </button>
 <button
 type="button"
 className="text-xs rounded-lg border px-2 py-1.5"
 disabled={!!presetBusy}
 onClick={() => applyPreset("max_consecutive", { max: staffMax.consecutive, apply_all: true })}
 >
 All staff
 </button>
 <label className="text-xs text-slate-600 ml-3">
 Max periods / day
 <input
 type="number"
 min={1}
 className="mt-1 block w-20 border rounded-lg px-2 py-1"
 value={staffMax.perDay}
 onChange={(e) => setStaffMax({ ...staffMax, perDay: Number(e.target.value) || 1 })}
 />
 </label>
 <button
 type="button"
 className="text-xs rounded-lg border px-2 py-1.5"
 disabled={!!presetBusy}
 onClick={() => applyPreset("max_per_day", { max: staffMax.perDay })}
 >
 This staff
 </button>
 <button
 type="button"
 className="text-xs rounded-lg border px-2 py-1.5"
 disabled={!!presetBusy}
 onClick={() => applyPreset("max_per_day", { max: staffMax.perDay, apply_all: true })}
 >
 All staff
 </button>
 </div>
 )}
 <ConstraintGrid
 days={days}
 periods={allPeriods}
 cells={cells}
 modes={modes}
 paintMode={paintMode}
 onPaint={paint}
 />
 </>
 )}
 </div>
 </div>
 );
}
