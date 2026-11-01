import { useEffect, useState } from "react";
import { api } from "../api";
import { currentYearId, onYearChange, timetablesUrl } from "../year";
import ReportsPanel from "./workspace/ReportsPanel";
import PageHelp from "../ui/PageHelp";
import ErrorBanner from "../ui/ErrorBanner";
export default function ReportsPage() {
 const [yearId, setYearId] = useState(() => currentYearId());
 const [tts, setTts] = useState<any[]>([]);
 const [err, setErr] = useState("");

 async function load() {
 const id = currentYearId();
 setYearId(id);
 try {
 const list = await api<any[]>(timetablesUrl(id));
 setTts(list);
 } catch (e: any) {
 setErr(e.message);
 }
 }

 useEffect(() => {
 load();
 return onYearChange(load);
 }, []);

 return (
 <div className="space-y-4">
 <header className="flex flex-wrap justify-between gap-3 items-start">
 <div>
 <div className="flex items-center gap-2">
 <h1 className="text-2xl font-semibold text-slate-900">Reports</h1>
 <PageHelp page="reports" />
 </div>
 <p className="text-slate-500 text-sm mt-1">
 Class, teacher, subject, unplaced, and load views. Download Excel for class and staff sheets.
 </p>
 </div>
 </header>
 <ErrorBanner message={err} onClear={() => setErr("")} />
 <ReportsPanel yearId={yearId} tts={tts} />
 </div>
 );
}
