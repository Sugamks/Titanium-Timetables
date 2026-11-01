import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { withBusy } from "../ui/busy";
import { useToast } from "../ui/Toast";
import { currentYearId, notifyCatalog, onYearChange, setCurrentYearId, timetablesUrl } from "../year";
import CatalogPanel from "./workspace/CatalogPanel";
import GridPanel from "./workspace/GridPanel";
import LessonsPanel from "./workspace/LessonsPanel";
import SchoolLists from "./workspace/SchoolLists";
import PageHelp from "../ui/PageHelp";
import ErrorBanner from "../ui/ErrorBanner";
import SaveFileButton from "../ui/TimetableFile";
const TEMPLATE_KEY = "construct-template-id";

type Tab = "teachers" | "classes" | "subjects" | "lessons" | "grid";

function pickDefaultYear(years: any[], sections: any[]): string {
 const withSections = new Set((sections || []).map((s: any) => s.academic_year_id).filter(Boolean));
 const now = new Date();
 const start = now.getMonth() >= 5 ? now.getFullYear() : now.getFullYear() - 1;
 const label = `${start}-${String(start + 1).slice(-2)}`;
 const byName = (years || []).find((y: any) => y.name === label && withSections.has(y.id));
 if (byName) return byName.id;
 const sorted = [...(years || [])]
 .filter((y: any) => withSections.has(y.id))
 .sort((a: any, b: any) => String(b.name).localeCompare(String(a.name)));
 return sorted[0]?.id || years?.[0]?.id || "";
}

export default function WorkspacePage() {
 const [tab, setTab] = useState<Tab>("teachers");
 const [catalog, setCatalog] = useState<any>(null);
 const [lessons, setLessons] = useState<any[]>([]);
 const [workload, setWorkload] = useState<any[]>([]);
 const [tts, setTts] = useState<any[]>([]);
 const [yearId, setYearId] = useState(() => currentYearId());
 const [err, setErr] = useState("");
 const [templateId, setTemplateId] = useState(() => {
 try {
 return sessionStorage.getItem(TEMPLATE_KEY) || "";
 } catch {
 return "";
 }
 });
 const toast = useToast();

 function applyLesson(updated: any) {
 if (!updated?.id) return;
 setLessons((prev) => prev.map((l) => (l.id === updated.id ? { ...l, ...updated } : l)));
 }

 async function load() {
 const [c, l, t] = await withBusy("Loading timetable…", () =>
 Promise.all([
 api("/v1/catalog"),
 api("/v1/lessons"),
 api<any[]>(timetablesUrl()),
 ])
 );
 setCatalog(c);
 setLessons(l);
 setWorkload([]);
 setTts(t);
 notifyCatalog();
 setYearId((prev) => {
 const years = c.academic_years || [];
 const sections = c.sections || [];
 const ids = new Set(years.map((y: any) => y.id));
 if (prev && ids.has(prev)) return prev;
 const stored = currentYearId();
 if (stored && ids.has(stored)) return stored;
 return pickDefaultYear(years, sections);
 });
 }

 useEffect(() => {
 load().catch((e) => setErr(e.message));
 return onYearChange(() => {
 setYearId(currentYearId());
 load().catch((e) => setErr(e.message));
 });
 }, []);

 useEffect(() => {
 if (yearId && yearId !== currentYearId()) setCurrentYearId(yearId);
 }, [yearId]);

 const years = catalog?.academic_years || [];
 const yearSections = useMemo(() => {
 const all = catalog?.sections || [];
 if (!yearId) return all;
 return all.filter((s: any) => s.academic_year_id === yearId);
 }, [catalog, yearId]);
 const yearTemplates = useMemo(
 () => (tts || []).filter((t: any) => !yearId || t.academic_year_id === yearId),
 [tts, yearId]
 );
 useEffect(() => {
 if (!yearTemplates.length) {
 if (templateId) setTemplateId("");
 return;
 }
 if (yearTemplates.some((t: any) => t.id === templateId)) return;
 setTemplateId(yearTemplates[0].id);
 }, [yearTemplates, templateId]);
 useEffect(() => {
 try {
 if (templateId) sessionStorage.setItem(TEMPLATE_KEY, templateId);
 } catch {
 /* ignore */
 }
 }, [templateId]);
 const selectedTemplate = yearTemplates.find((t: any) => t.id === templateId);
 const templateGridId = selectedTemplate?.time_grid_id || "";
 const yearSubjects = catalog?.subjects || [];
 const yearLessons = useMemo(() => {
 const ids = new Set(yearSections.map((s: any) => s.id));
 return lessons.filter((l) => {
 if (templateGridId && l.time_grid_id !== templateGridId) return false;
 if (yearId && ids.size && !(l.section_ids || [l.section_id]).some((sid: string) => sid && ids.has(sid))) {
 return false;
 }
 return true;
 });
 }, [lessons, yearId, yearSections, templateGridId]);
 const yearWorkload = useMemo(() => {
 const teachers = catalog?.teachers || [];
 const byRes = new Map<string, any>(teachers.map((t: any) => [t.resource_id, t]));
 const byName = new Map<string, any>(teachers.map((t: any) => [t.name, t]));
 const by = new Map<string, { resource_id: string; name: string; teaching: number; contract: number }>();
 for (const l of yearLessons) {
 const load = (Number(l.frequency_per_week) || 0) * (Number(l.duration_periods) || 1);
 const ids: string[] = l.teacher_resource_ids?.length ? l.teacher_resource_ids : [];
 const names: string[] = l.teachers || [];
 const people = ids.length
 ? ids.map((id: string, i: number) => ({ id, name: names[i] || byRes.get(id)?.name || id }))
 : names.map((name: string) => ({ id: byName.get(name)?.resource_id || name, name }));
 for (const p of people) {
 if (!p.name) continue;
 const rec = by.get(p.id) || {
 resource_id: p.id,
 name: p.name,
 teaching: 0,
 contract: byRes.get(p.id)?.contract_periods || byName.get(p.name)?.contract_periods || 28,
 };
 rec.teaching += load;
 by.set(p.id, rec);
 }
 }
 return [...by.values()]
 .map((r) => ({ ...r, utilization: Math.round((1000 * r.teaching) / Math.max(1, r.contract)) / 10 }))
 .sort((a, b) => a.name.localeCompare(b.name));
 }, [yearLessons, catalog]);

 const yearName = years.find((y: any) => y.id === yearId)?.name || "";
 const placedHint = yearLessons.reduce((n, l) => n + (l.frequency_per_week || 0), 0);

 if (!catalog) {
 return <div className="text-slate-500 py-16 text-center">Loading timetable…</div>;
 }

 const tabs: { id: Tab; label: string }[] = [
 { id: "teachers", label: "Teachers" },
 { id: "classes", label: "Class section" },
 { id: "subjects", label: "Subjects" },
 { id: "lessons", label: "Lessons" },
 { id: "grid", label: "Construction" },
 ];

 return (
 <div className="h-full min-h-0 flex flex-col gap-4">
 <header className="shrink-0 flex flex-wrap justify-between gap-4 items-start">
 <div className="min-w-0 flex-1">
 <div className="flex items-center gap-2">
 <h1 className="text-2xl font-semibold text-slate-900">Timetable</h1>
 <PageHelp page="workspace" />
 </div>
 <p className="text-slate-500 text-sm mt-1 max-w-2xl">
 Teachers, classes, and subjects stay in this app. Save writes year-template.ttl with that template's bell times, constraints, and rules.
 </p>
 <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-sm text-slate-600">
 <span><strong className="text-slate-900">{yearSections.length}</strong> classes</span>
 <span><strong className="text-slate-900">{yearSubjects.length}</strong> subjects</span>
 <span><strong className="text-slate-900">{catalog?.teachers?.length ?? 0}</strong> teachers</span>
 <span><strong className="text-slate-900">{yearLessons.length}</strong> lessons</span>
 <span><strong className="text-slate-900">{placedHint}</strong> weekly cards</span>
 {yearName && <span className="text-slate-400">{yearName}</span>}
 </div>
 </div>
 <SaveFileButton yearId={yearId} templateId={templateId} />
 </header>

 <ErrorBanner className="shrink-0" message={err} onClear={() => setErr("")} />

 <div className="shrink-0 flex gap-1 border-b border-slate-200">
 {tabs.map((t) => (
 <button
 key={t.id}
 onClick={() => setTab(t.id)}
 className={`px-4 py-2 text-sm rounded-t-lg ${
 tab === t.id ? "bg-white border border-b-white border-slate-200 -mb-px font-medium text-slate-900" : "text-slate-500 hover:text-slate-800"
 }`}
 >
 {t.label}
 </button>
 ))}
 </div>

 <div className="flex-1 min-h-0 overflow-y-auto">
 {tab === "teachers" && (
 <SchoolLists part="teachers" catalog={catalog} yearId={yearId} onChanged={load} />
 )}
 {tab === "classes" && (
 <SchoolLists part="classes" catalog={catalog} yearId={yearId} onChanged={load} />
 )}
 {tab === "subjects" && (
 <CatalogPanel catalog={catalog} yearId={yearId} onChanged={load} onError={setErr} />
 )}
 {tab === "lessons" && (
 <LessonsPanel
 catalog={catalog}
 yearId={yearId}
 timeGridId={templateGridId}
 templates={yearTemplates}
 templateId={templateId}
 onTemplateChange={setTemplateId}
 yearSections={yearSections}
 yearSubjects={yearSubjects}
 yearLessons={yearLessons}
 yearWorkload={yearWorkload}
 onChanged={load}
 onLessonUpdated={applyLesson}
 onError={setErr}
 onMessage={toast}
 />
 )}
 {tab === "grid" && (
 <div className="h-full min-h-0">
 <GridPanel
 tts={yearTemplates}
 timetableId={templateId}
 onTimetableChange={setTemplateId}
 yearLessons={yearLessons}
 onChanged={load}
 onError={setErr}
 onMessage={toast}
 />
 </div>
 )}
 </div>
 </div>
 );
}
