import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { isTeachingPeriod } from "../periods";
import SearchSelect, { MultiSearchSelect } from "../ui/SearchSelect";
import { IconButton } from "../ui/icons";
import { currentYearId, onYearChange } from "../year";

const TEMPLATE_KEY = "construct-template-id";
const PAIR_TYPES = new Set(["LessonsTogether", "LessonsApart", "SameTime", "DifferentTime", "Before", "After", "Consecutive"]);
const ROOM_TYPES = new Set([
  "PreferredRoom",
  "SameRoom",
  "SameRoomAllWeek",
  "MinRoomTypeUses",
  "MaxRoomTypeUses",
  "DifferentRoom",
  "RoomUnavailable",
]);
const PERIOD_BOUND_TYPES = new Set(["StartAfter", "EndBefore"]);
const LOAD_DAY_TYPES = new Set(["MaxDaysPerWeek", "MinLessonsPerDay", "MinTeacherWindows", "LunchBreak"]);
import ConstraintGrid, { type PaintMode } from "./constraints/TimeOffGrid";
import PageHelp from "../ui/PageHelp";
import ErrorBanner from "../ui/ErrorBanner";
import { useToast } from "../ui/Toast";
import NeedTemplate from "../ui/NeedTemplate";
type Tab = "global" | "staff" | "class" | "subject" | "room";

const PAINTED_TYPES = new Set([
 "TeacherUnavailable",
 "ClassUnavailable",
 "ForbidCategoryInPeriods",
 "ClassTeacherOnlyInPeriods",
 "NotClassTeacherInPeriods",
]);

const STAFF_MODES: PaintMode[] = [
 { id: "available", label: "Can teach", className: "paint-cell bg-success border-success hover:bg-success text-accent-ink", title: "Clear, can teach" },
 { id: "unavailable", label: "Not available", className: "paint-cell bg-ink border-ink hover:bg-ink text-accent-ink", title: "Staff not available" },
];

const CLASS_MODES: PaintMode[] = [
 { id: "open", label: "Open", className: "paint-cell bg-success border-success hover:bg-success text-accent-ink", title: "Any subject can be placed" },
 { id: "nocp", label: "No core", className: "paint-cell bg-warn border-warn hover:bg-warn text-ink", title: "No scholastic core (NOCP)" },
 { id: "nosl", label: "No language", className: "paint-cell bg-accent border-accent hover:bg-accent text-accent-ink", title: "No scholastic language (NOSL)" },
 { id: "nopa", label: "No PE", className: "paint-cell bg-success border-success hover:bg-success text-accent-ink", title: "No physical activity (NOPA)" },
 { id: "cton", label: "Class teacher", className: "paint-cell bg-error border-error hover:bg-error text-accent-ink", title: "Class teacher only (CTON)" },
 { id: "ncton", label: "No class teacher", className: "paint-cell bg-accent border-accent hover:bg-accent text-accent-ink", title: "No class teacher (NCTON)" },
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
            value === m.id ? "ring-2 ring-offset-1 ring-ink ring-accent ring-offset-paper" : ""
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
 const toast = useToast();
 const [tab, setTab] = useState<Tab>("global");
 const [teacherId, setTeacherId] = useState("");
 const [sectionId, setSectionId] = useState("");
 const [subjectId, setSubjectId] = useState("");
 const [roomId, setRoomId] = useState("");
 const [lessonA, setLessonA] = useState("");
 const [lessonB, setLessonB] = useState("");
 const [cells, setCells] = useState<Record<string, string>>({});
 const [classTeacherName, setClassTeacherName] = useState<string | null>(null);
 const [staffPaint, setStaffPaint] = useState("unavailable");
 const [classPaint, setClassPaint] = useState("nosl");
 const [typeCatalog, setTypeCatalog] = useState<any[]>([]);
 const [items, setItems] = useState<any[]>([]);
 const [lessons, setLessons] = useState<any[]>([]);
 const [form, setForm] = useState({
 type_code: "MaxTeacherLessonsPerDay",
 severity: "soft",
 weight: 80,
 scope: "teacher",
 scope_id: "",
 day_ids: [] as string[],
 period_ids: [] as string[],
 period_id: "",
 max: 5,
 min: 2,
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
 const [cat, types, rows, cards] = await Promise.all([
 api("/v1/catalog"),
 api("/v1/constraints/catalog"),
 api("/v1/constraints"),
 api("/v1/lessons"),
 ]);
 setLessons(cards || []);
 setResources(cat);
 setTypeCatalog(types || []);
 setItems(rows || []);
 setTeacherId((prev) => prev || cat.teachers?.find((t: any) => t.is_active !== false)?.resource_id || "");
 setForm((f) => ({ ...f, scope_id: f.scope_id || cat.teachers?.find((t: any) => t.is_active !== false)?.resource_id || "" }));
 const tts = (cat.timetables || []).filter((t: any) => !yearId || t.academic_year_id === yearId);
 setTemplateId((prev) => (prev && tts.some((t: any) => t.id === prev) ? prev : tts[0]?.id || ""));
 setPin((p) => ({ ...p, subject_id: p.subject_id || cat.subjects?.[0]?.id || "" }));
 const secs = (cat.sections || []).filter((s: any) => !yearId || s.academic_year_id === yearId);
 setSectionId((prev) => prev || secs[0]?.id || "");
 setSubjectId((prev) => prev || cat.subjects?.[0]?.id || "");
 setRoomId((prev) => prev || cat.rooms?.[0]?.resource_id || "");
 }

 useEffect(() => {
 loadAll().catch((e) => setErr(e.message));
 return onYearChange(() => setYearId(currentYearId()));
 }, []);

 const sections = useMemo(() => {
 const all = resources?.sections || [];
 return yearId ? all.filter((s: any) => s.academic_year_id === yearId) : all;
 }, [resources, yearId]);
 const teachers = (resources?.teachers || []).filter((t: any) => t.is_active !== false);
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
 const otherTypes = typeCatalog.filter((t) => !PAINTED_TYPES.has(t.code) && !ROOM_TYPES.has(t.code));
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

 useEffect(() => {
 if (tab !== "subject" || !subjectId) return;
 api(`/v1/constraints/grid?kind=subject&target_id=${encodeURIComponent(subjectId)}`)
 .then((r) => setCells(r.cells || {}))
 .catch((e) => setErr(e.message));
 }, [tab, subjectId]);

 useEffect(() => {
 if (tab !== "room" || !roomId) return;
 api(`/v1/constraints/grid?kind=room&target_id=${encodeURIComponent(roomId)}`)
 .then((r) => setCells(r.cells || {}))
 .catch((e) => setErr(e.message));
 }, [tab, roomId]);

 async function paint(dayId: string, periodId: string, mode: string) {
 setErr("");
 const kind = tab === "staff" ? "teacher" : tab === "subject" ? "subject" : tab === "room" ? "room" : "section";
 const id = tab === "staff" ? teacherId : tab === "subject" ? subjectId : tab === "room" ? roomId : sectionId;
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
 toast(`Saved this period as ${mode.replace(/_/g, " ")}.`);
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
 const presetLine: Record<string, string> = {
 first_period_class_teacher: "First period is reserved for the class teacher.",
 second_period_non_class_teacher: "Second period stays off the class teacher.",
 pin_subject: "Pinned that subject to the chosen periods.",
 no_pe_after_lunch: extra.apply_all ? "PE after lunch is blocked for every class." : "PE after lunch is blocked for this class.",
 no_core_last: extra.apply_all ? "Core subjects stay off the last period for every class." : "Core subjects stay off the last period for this class.",
 max_consecutive: `Staff can teach at most ${extra.max} periods in a row${extra.apply_all ? ", across the school" : ""}.`,
 max_per_day: `Staff can teach at most ${extra.max} periods a day${extra.apply_all ? ", across the school" : ""}.`,
 };
 toast(presetLine[code] || "Saved that rule.");
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
 if (PERIOD_BOUND_TYPES.has(form.type_code)) {
 const pid = form.period_id || form.period_ids[0] || "";
 if (!pid) {
 setErr("Choose one period for this rule.");
 return;
 }
 params.period_id = pid;
 }
 if (form.type_code === "LunchBreak") {
 params.period_ids = form.period_ids;
 }
 if (form.type_code === "MaxDaysPerWeek") {
 params.max = form.max;
 } else if (form.type_code === "MinLessonsPerDay" || form.type_code === "MinTeacherWindows") {
 params.min = form.min;
 } else if (form.type_code.startsWith("Max") || form.type_code.startsWith("Min") || form.type_code === "ContractHours") {
 params.max = form.max;
 params.min = form.max;
 }
 if (PAIR_TYPES.has(form.type_code)) params.other_lesson_id = lessonB;
 try {
 await api("/v1/constraints", {
 method: "POST",
 body: JSON.stringify({
 type_code: form.type_code,
 severity: form.severity,
 weight: form.weight,
 scope: PAIR_TYPES.has(form.type_code) ? "lesson" : form.scope,
 scope_id: PAIR_TYPES.has(form.type_code) ? lessonA : form.scope_id || null,
 timetable_id: form.scope === "global" ? null : templateId || null,
 params,
 }),
 });
 setItems((await api("/v1/constraints")) || []);
 toast(`Added the ${typeName(form.type_code)} rule.`);
 } catch (e: any) {
 setErr(e.message);
 }
 }

 function dayNames(ids: string[] = []) {
 if (!ids.length) return "";
 return ids.map((id) => days.find((d: any) => d.id === id)?.name?.slice(0, 3) || id).join(", ");
 }

 const modes = tab === "class" ? CLASS_MODES : STAFF_MODES;
 const paintMode = tab === "class" ? classPaint : staffPaint;

 if (resources && templates.length === 0) return <NeedTemplate what="Constraints" />;

 return (
 <div className="h-full min-h-0 flex flex-col gap-3">
 <header className="shrink-0 flex flex-wrap justify-between gap-3 items-start">
 <div>
 <div className="flex items-center gap-2">
 <h1 className="text-2xl font-semibold">Constraints</h1>
 <PageHelp page="constraints" />
 </div>
 <p className="text-muted text-sm mt-1">
 Global rules apply to every template. Class and staff rules belong to the selected template.
 </p>
 </div>
 </header>

 <ErrorBanner className="shrink-0" message={err} onClear={() => setErr("")} />

 <div className="shrink-0 flex gap-1 border-b border-rule">
 {([
 { id: "global" as const, label: "Global", hint: "Firs period, pinned subjects" },
 { id: "class" as const, label: "Class", hint: "Template · CT, PE, last period" },
 { id: "staff" as const, label: "Staff", hint: "Template · availability and load" },
 { id: "subject" as const, label: "Subject", hint: "Subject time off" },
 { id: "room" as const, label: "Room", hint: "Room time off" },
 ]).map((t) => (
 <button
 key={t.id}
 onClick={() => {
 setTab(t.id);
 setCells({});
 }}
 className={`px-4 py-2 text-sm rounded-t-lg ${
              tab === t.id ? "bg-paper-3 border border-b-paper-3 border-rule -mb-px font-medium text-ink" : "text-muted hover:text-ink"
            }`}
 >
 {t.label}
 <span className="hidden sm:inline text-muted font-normal"> · {t.hint}</span>
 </button>
 ))}
 </div>

 <div key={tab} className="motion-swap flex-1 min-h-0 bg-paper-3 border rounded-xl p-4 flex flex-col gap-3 overflow-auto">
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
 className="text-sm rounded-lg border border-rule bg-paper-3 px-3 py-2 hover:bg-paper-2 disabled:opacity-55"
 >
 {presetBusy === "first_period_class_teacher" ? "Saving…" : "All first periods = class teacher"}
 </button>
 <button
 type="button"
 disabled={!!presetBusy}
 onClick={() => applyPreset("second_period_non_class_teacher")}
 className="text-sm rounded-lg border border-rule bg-paper-3 px-3 py-2 hover:bg-paper-2 disabled:opacity-55"
 >
 {presetBusy === "second_period_non_class_teacher" ? "Saving…" : "All second periods = no class teacher"}
 </button>
 </div>
 <div className="flex flex-wrap items-end gap-2 p-3 rounded-lg border border-rule bg-paper-2">
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
 className="h-10 px-3 bg-accent text-accent-ink rounded-lg text-sm disabled:opacity-55"
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
 {PAIR_TYPES.has(form.type_code) && (
 <div className="grid md:grid-cols-2 gap-3">
 <SearchSelect
 label="Lesson A"
 value={lessonA}
 onChange={setLessonA}
 options={lessons.map((l: any) => ({ value: l.id, label: `${l.subject || "Lesson"} · ${l.section || ""}` }))}
 placeholder="First lesson"
 />
 <SearchSelect
 label="Lesson B"
 value={lessonB}
 onChange={setLessonB}
 options={lessons.map((l: any) => ({ value: l.id, label: `${l.subject || "Lesson"} · ${l.section || ""}` }))}
 placeholder="Second lesson"
 />
 </div>
 )}
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
 {form.type_code === "MaxDaysPerWeek" && (
 <label className="text-sm">Max teaching days / week
 <input type="number" min={1} max={7} className="mt-1 w-full border rounded-lg px-2 py-1.5" value={form.max} onChange={(e) => setForm({ ...form, max: Number(e.target.value) })} />
 </label>
 )}
 {form.type_code === "MinLessonsPerDay" && (
 <label className="text-sm">Min lessons on a working day
 <input type="number" min={1} className="mt-1 w-full border rounded-lg px-2 py-1.5" value={form.min} onChange={(e) => setForm({ ...form, min: Number(e.target.value) })} />
 </label>
 )}
 {form.type_code === "MinTeacherWindows" && (
 <label className="text-sm">Min free gaps in a working day
 <input type="number" min={0} className="mt-1 w-full border rounded-lg px-2 py-1.5" value={form.min} onChange={(e) => setForm({ ...form, min: Number(e.target.value) })} />
 </label>
 )}
 {!LOAD_DAY_TYPES.has(form.type_code) && !PERIOD_BOUND_TYPES.has(form.type_code) && (form.type_code.startsWith("Max") || form.type_code.startsWith("Min") || form.type_code === "ContractHours") && (
 <label className="text-sm">Max / min
 <input type="number" className="mt-1 w-full border rounded-lg px-2 py-1.5" value={form.max} onChange={(e) => setForm({ ...form, max: Number(e.target.value) })} />
 </label>
 )}
 </div>
 {PERIOD_BOUND_TYPES.has(form.type_code) && (
 <div className="w-72">
 <SearchSelect
 label={form.type_code === "StartAfter" ? "No lessons before this period" : "No lessons after this period"}
 value={form.period_id}
 onChange={(period_id) => setForm({ ...form, period_id, period_ids: period_id ? [period_id] : [] })}
 options={periods.map((p: any) => ({ value: p.id, label: p.name }))}
 placeholder="Choose period"
 />
 </div>
 )}
 {form.type_code === "LunchBreak" && (
 <div className="space-y-1">
 <p className="text-xs text-muted">Optional: pick teaching periods that count as the lunch window. Leave empty to use periods beside the lunch break.</p>
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
 </div>
 )}
 {!PERIOD_BOUND_TYPES.has(form.type_code) && form.type_code !== "LunchBreak" && (
 <>
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
 </>
 )}
 <button className="bg-accent text-accent-ink rounded-lg px-3 py-2 text-sm">Save constraint</button>
 </form>
 <ul className="border rounded-xl divide-y">
 {otherItems.length === 0 && <li className="p-3 text-sm text-muted">No extra constraints yet.</li>}
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
 toast(`Removed the ${typeName(i.type_code)} rule.`);
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
 {tab === "staff" && (
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
 )}
 {tab === "class" && (
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
 {tab === "subject" && (
 <div className="w-72">
 <SearchSelect
 label="Subject"
 value={subjectId}
 onChange={(id) => { setSubjectId(id); setCells({}); }}
 options={(resources?.subjects || []).map((s: any) => ({ value: s.id, label: s.name }))}
 placeholder="Subject"
 />
 </div>
 )}
 {tab === "room" && (
 <div className="w-72">
 <SearchSelect
 label="Room"
 value={roomId}
 onChange={(id) => { setRoomId(id); setCells({}); }}
 options={(resources?.rooms || []).map((r: any) => ({ value: r.resource_id, label: r.name }))}
 placeholder="Room"
 />
 </div>
 )}
 <div className="flex-1 min-w-[16rem]">
 <div className="text-xs text-muted mb-1">Paint</div>
 <ModePills
 modes={modes}
 value={paintMode}
 onChange={(id) => (tab === "class" ? setClassPaint(id) : setStaffPaint(id))}
 />
 </div>
 </div>
 {tab === "class" && (
 <div className="flex flex-wrap items-end gap-2 p-3 rounded-lg border border-rule bg-paper-2">
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
 className="h-10 px-3 bg-accent text-accent-ink rounded-lg text-sm disabled:opacity-55"
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
 toast(`Copied this class's rules onto ${into.length} ${into.length === 1 ? "class" : "classes"}.`);
 } catch (e: any) {
 setErr(e.message);
 } finally {
 setCloneBusy(false);
 }
 }}
 >
 {cloneBusy ? "Copying…" : "Clone painted cells"}
 </button>
 <p className="w-full text-xs text-muted">
 Replaces painted class rules on the target classes (NA, NOSL, CTON, and the rest). Does not change staff constraints.
 </p>
 </div>
 )}
 {tab === "class" && (
 <div className="flex flex-wrap items-center gap-2">
 <p className="text-sm text-muted mr-auto">
 Class teacher: <strong>{classTeacherName || "no set"}</strong>
 </p>
 <button
 type="button"
 disabled={!!presetBusy}
 className="text-xs rounded-lg border px-2 py-1 hover:bg-paper-2"
 onClick={() => applyPreset("no_pe_after_lunch")}
 >
 {presetBusy === "no_pe_after_lunch" ? "Saving…" : "No PE after lunch"}
 </button>
 <button
 type="button"
 disabled={!!presetBusy}
 className="text-xs rounded-lg border px-2 py-1 hover:bg-paper-2"
 onClick={() => applyPreset("no_core_last")}
 >
 {presetBusy === "no_core_last" ? "Saving…" : "No core last period"}
 </button>
 <button
 type="button"
 disabled={!!presetBusy}
 className="text-xs rounded-lg border px-2 py-1 hover:bg-paper-2 whitespace-nowrap"
 onClick={() => applyPreset("no_pe_after_lunch", { apply_all: true })}
 >
 Apply PE rule to all classes
 </button>
 <button
 type="button"
 disabled={!!presetBusy}
 className="text-xs rounded-lg border px-2 py-1 hover:bg-paper-2 whitespace-nowrap"
 onClick={() => applyPreset("no_core_last", { apply_all: true })}
 >
 Apply last-period rule to all classes
 </button>
 </div>
 )}
 {tab === "staff" && (
 <div className="flex flex-wrap items-end gap-2">
 <label className="text-xs text-muted">
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
 <label className="text-xs text-muted ml-3">
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
