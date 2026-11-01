import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { currentYearId, onYearChange, timetablesUrl } from "../year";
import { isTeachingPeriod, periodOnDay, periodTimeRange, periodTypeLabel } from "../periods";
import PageHelp from "../ui/PageHelp";
import ErrorBanner from "../ui/ErrorBanner";
import SearchSelect from "../ui/SearchSelect";
import { chipStyle } from "../ui/colors";

const TEMPLATE_KEY = "construct-template-id";

export default function ClassTimetablePage() {
 const [yearId, setYearId] = useState(() => currentYearId());
 const [sections, setSections] = useState<any[]>([]);
 const [sectionId, setSectionId] = useState("");
 const [tts, setTts] = useState<any[]>([]);
 const [templateId, setTemplateId] = useState(() => {
 try {
 return sessionStorage.getItem(TEMPLATE_KEY) || "";
 } catch {
 return "";
 }
 });
 const [data, setData] = useState<any>(null);
 const [err, setErr] = useState("");

 async function loadLists(id = currentYearId()) {
 const [c, t] = await Promise.all([api<any>("/v1/catalog"), api<any[]>(timetablesUrl(id))]);
 const list = (c.sections || []).filter((s: any) => !id || s.academic_year_id === id);
 setSections(list);
 setSectionId((prev) => (list.some((s: any) => s.id === prev) ? prev : list[0]?.id || ""));
 setTts(t || []);
 }

 useEffect(() => {
 function loadCatalog() {
 const id = currentYearId();
 setYearId(id);
 loadLists(id).catch((e) => setErr(e.message));
 }
 loadCatalog();
 return onYearChange(loadCatalog);
 }, []);

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

 useEffect(() => {
 if (!sectionId) return;
 setErr("");
 const q = new URLSearchParams();
 q.set("section_id", sectionId);
 if (yearId) q.set("academic_year_id", yearId);
 if (templateId) q.set("timetable_id", templateId);
 api(`/v1/class-timetable?${q.toString()}`)
 .then(setData)
 .catch((e) => setErr(e.message));
 }, [sectionId, yearId, templateId]);

 const days = data?.days || [];
 const periods = data?.periods || [];
 const cellMap: Record<string, any[]> = {};
 (data?.cells || []).forEach((c: any) => {
 const k = `${c.day_id}|${c.period_id}`;
 (cellMap[k] ||= []).push(c);
 });

 return (
 <div className="space-y-4">
 <header className="flex flex-wrap justify-between gap-3 items-start">
 <div>
 <div className="flex items-center gap-2">
 <h1 className="text-2xl font-semibold">Class timetable</h1>
 <PageHelp page="class" />
 </div>
 <p className="text-slate-500 text-sm mt-1">
 The saved week for a class — same view a parent would see.
 </p>
 </div>
 </header>
 <ErrorBanner message={err} onClear={() => setErr("")} />
 <div className="bg-white border rounded-xl p-3 flex items-end gap-3">
 <div className="w-56 shrink-0">
 <SearchSelect
 label="Template"
 value={templateId}
 onChange={setTemplateId}
 options={yearTemplates.map((t: any) => ({ value: t.id, label: t.name }))}
 placeholder="Select template"
 />
 </div>
 <div className="w-64 shrink-0">
 <SearchSelect
 label="Class"
 value={sectionId}
 onChange={setSectionId}
 options={sections.map((s: any) => ({ value: s.id, label: s.name }))}
 placeholder="Search class"
 />
 </div>
 {data?.published_at ? (
 <div className="shrink-0 text-sm">
 <div className="font-medium text-slate-700">Saved</div>
 <div className="mt-1 h-[42px] flex items-center text-slate-500 tabular-nums">{String(data.published_at).slice(0, 10)}</div>
 </div>
 ) : null}
 </div>
 {!data ? (
 <div className="text-slate-500 text-sm">Loading class timetable…</div>
 ) : !data.ok ? (
 <div className="bg-white border rounded-xl p-8 text-center text-sm text-slate-500">{data.error}</div>
 ) : (
 <section className="bg-white border rounded-xl overflow-auto">
 <table className="w-full text-xs border-collapse">
 <thead>
 <tr>
 <th className="p-2 border bg-slate-50">Period</th>
 {days.map((d: any) => (
 <th key={d.id} className="p-2 border bg-slate-50">{d.name}</th>
 ))}
 </tr>
 </thead>
 <tbody>
 {periods.map((p: any) => (
 <tr key={p.id} className={!isTeachingPeriod(p) ? "bg-amber-50" : ""}>
 <td className="p-2 border font-medium bg-slate-50">{p.name}</td>
 {!isTeachingPeriod(p) ? (
 days.map((d: any) => (
 <td key={d.id} className="p-2 border text-center italic text-amber-800 align-top">
 <div className="text-[11px] font-semibold tabular-nums not-italic">{periodTimeRange(periodOnDay(p, d))}</div>
 {periodTypeLabel(p.period_type)}
 </td>
 ))
 ) : (
 days.map((d: any) => (
 <td key={d.id} className="p-1 border align-top h-16">
 {periodTimeRange(periodOnDay(p, d)) && (
 <div className="text-[10px] font-semibold tabular-nums text-slate-600 mb-0.5">
 {periodTimeRange(periodOnDay(p, d))}
 </div>
 )}
 {(cellMap[`${d.id}|${p.id}`] || []).map((c: any, i: number) => (
 <div key={i} className="rounded px-1 py-0.5 mb-0.5" style={chipStyle(c.color)}>
 <div className="font-semibold">{c.short || c.subject}</div>
 {c.teacher ? <div className="opacity-90">{c.teacher}</div> : null}
 </div>
 ))}
 </td>
 ))
 )}
 </tr>
 ))}
 </tbody>
 </table>
 </section>
 )}
 </div>
 );
}
