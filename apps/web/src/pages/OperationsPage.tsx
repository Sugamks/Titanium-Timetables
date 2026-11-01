import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { currentYearId, onYearChange, timetablesUrl } from "../year";
import { todayIso } from "../ui/dates";
import { useToast } from "../ui/Toast";
import PageHelp from "../ui/PageHelp";
import ErrorBanner from "../ui/ErrorBanner";
import SubstitutionDayPanel from "./operations/SubstitutionDayPanel";
import ExemptionsPanel from "./operations/ExemptionsPanel";

const TEMPLATE_KEY = "construct-template-id";

type Tab = "day" | "exemptions";

export default function OperationsPage() {
 const toast = useToast();
 const [tab, setTab] = useState<Tab>("day");
 const [catalog, setCatalog] = useState<any>(null);
 const [exemptions, setExemptions] = useState<any[]>([]);
 const [templates, setTemplates] = useState<any[]>([]);
 const [templateId, setTemplateId] = useState(() => {
 try {
 return sessionStorage.getItem(TEMPLATE_KEY) || "";
 } catch {
 return "";
 }
 });
 const [day, setDay] = useState<any>(null);
 const [date, setDate] = useState(todayIso);
 const [err, setErr] = useState("");
 const [yearId, setYearId] = useState(() => currentYearId());

 const teachers = (catalog?.teachers || []).map((t: any) => ({ id: t.id, name: t.name }));
 const yearTemplates = useMemo(
 () => (templates || []).filter((t: any) => !yearId || t.academic_year_id === yearId),
 [templates, yearId]
 );

 const listsReady = catalog !== null;

 useEffect(() => {
 if (!listsReady) return;
 if (!yearTemplates.length) {
 if (templateId) setTemplateId("");
 return;
 }
 if (yearTemplates.some((t: any) => t.id === templateId)) return;
 setTemplateId(yearTemplates[0].id);
 }, [listsReady, yearTemplates, templateId]);

 useEffect(() => {
 try {
 if (templateId) sessionStorage.setItem(TEMPLATE_KEY, templateId);
 } catch {
 /* ignore */
 }
 }, [templateId]);

 async function loadDay(nextDate = date, nextTemplate = templateId) {
 if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate || "")) {
 setDay(null);
 return;
 }
 setErr("");
 try {
 const q = new URLSearchParams({ on_date: nextDate });
 if (nextTemplate) q.set("timetable_id", nextTemplate);
 const row = await api(`/v1/operations/day?${q.toString()}`);
 if (row?.error && !row.id) {
 setDay(null);
 setErr(row.error);
 return;
 }
 setDay(row);
 } catch (e: any) {
 setDay(null);
 setErr(e.message);
 }
 }

 async function loadLists(year = currentYearId()) {
 setErr("");
 try {
 setYearId(year);
 const [c, e, t] = await Promise.all([
 api("/v1/catalog"),
 api("/v1/operations/exemptions"),
 api<any[]>(timetablesUrl(year)),
 ]);
 setCatalog(c);
 setExemptions(e);
 setTemplates(t || []);
 } catch (e: any) {
 setErr(e.message);
 }
 }

 async function refresh() {
 await loadLists();
 await loadDay(date, templateId);
 }

 useEffect(() => {
 loadLists();
 return onYearChange(() => loadLists(currentYearId()));
 // eslint-disable-ntext-line react-hooks/exhaustive-deps
 }, []);

 useEffect(() => {
 if (!listsReady) return;
 if (yearTemplates.length > 0 && !yearTemplates.some((t: any) => t.id === templateId)) return;
 loadDay(date, templateId);
 // eslint-disable-ntext-line react-hooks/exhaustive-deps
 }, [date, templateId, listsReady]);

 return (
 <div className="space-y-6">
 <header className="flex flex-wrap items-start justify-between gap-3">
 <div>
 <div className="flex items-center gap-2">
 <h1 className="text-2xl font-semibold">Substitution</h1>
 <PageHelp page="operations" />
 </div>
 <p className="text-slate-500 text-sm">Cover absences against the saved or published week.</p>
 </div>
 <div className="flex flex-wrap items-center gap-2">
 <div className="flex rounded-lg border bg-white p-0.5 text-sm">
 <button
 type="button"
 className={`px-3 py-1.5 rounded-md ${tab === "day" ? "bg-indigo-600 text-white" : "text-slate-600"}`}
 onClick={() => setTab("day")}
 >
 Substitution day
 </button>
 <button
 type="button"
 className={`px-3 py-1.5 rounded-md ${tab === "exemptions" ? "bg-indigo-600 text-white" : "text-slate-600"}`}
 onClick={() => setTab("exemptions")}
 >
 Exemptions
 </button>
 </div>
 </div>
 </header>
 <ErrorBanner message={err} onClear={() => setErr("")} />
 {tab === "day" ? (
 <SubstitutionDayPanel
 date={date}
 onDate={setDate}
 templates={yearTemplates}
 templateId={templateId}
 onTemplate={setTemplateId}
 teachers={teachers}
 day={day}
 onChanged={() => loadDay()}
 onError={setErr}
 onMessage={toast}
 />
 ) : (
 <ExemptionsPanel
 teachers={teachers}
 exemptions={exemptions}
 onChanged={() => loadLists()}
 onError={setErr}
 onMessage={toast}
 />
 )}
 </div>
 );
}
