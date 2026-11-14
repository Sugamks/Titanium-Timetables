import { useEffect, useState } from "react";
import { api } from "../api";
import { chipStyle } from "../ui/colors";
import { cardFullTitle, cardShortLabel } from "../ui/lessonMarks";
import { isTeachingPeriod, periodOnDay, periodTimeRange, periodTypeLabel } from "../periods";
import PageHelp from "../ui/PageHelp";
import ErrorBanner from "../ui/ErrorBanner";
import SearchSelect from "../ui/SearchSelect";
export default function MyTimetablePage() {
 const [teachers, setTeachers] = useState<{ id: string; name: string }[]>([]);
 const [teacherId, setTeacherId] = useState("");
 const [data, setData] = useState<any>(null);
 const [err, setErr] = useState("");

 useEffect(() => {
 api<any>("/v1/catalog")
 .then((catalog) => {
 const list = catalog.teachers || [];
 setTeachers(list);
 setTeacherId((prev) => (list.some((t: { id: string }) => t.id === prev) ? prev : list[0]?.id || ""));
 })
 .catch((e) => setErr(e.message));
 }, []);

 useEffect(() => {
 if (!teacherId) {
 setData(null);
 return;
 }
 api(`/v1/me/timetable?teacher_id=${encodeURIComponent(teacherId)}`)
 .then(setData)
 .catch((e) => setErr(e.message));
 }, [teacherId]);

 if (err) return <ErrorBanner message={err} onClear={() => setErr("")} />;

 const days = data?.days || [];
 const periods = data?.periods || [];
 const cellMap: Record<string, any[]> = {};
 (data?.cells || []).forEach((c: any) => {
 const k = `${c.day_id}|${c.period_id}`;
 (cellMap[k] ||= []).push(c);
 });

 return (
 <div className="space-y-4">
 <header>
 <div className="flex items-center gap-2">
 <h1 className="text-2xl font-semibold">My timetable</h1>
 <PageHelp page="mine" />
 </div>
 <p className="text-muted text-sm mt-1">Published week for one teacher.</p>
 </header>
 <div className="bg-paper-3 border rounded-lg p-3 w-64">
 <SearchSelect
 label="Teacher"
 value={teacherId}
 onChange={setTeacherId}
 options={teachers.map((t) => ({ value: t.id, label: t.name }))}
 placeholder="Select teacher"
 />
 </div>
 {!teacherId && <div className="bg-paper-3 border rounded-lg p-8 text-center text-sm text-muted">Add a teacher on the School tab first.</div>}
 {teacherId && !data && <div className="text-muted">Loading timetable…</div>}
 {data && !data.ok && (
 <div className="bg-paper-3 border rounded-lg p-8 text-center text-sm text-muted">
 {data.error || "No published timetable yet."}
 </div>
 )}
 {data?.ok && (
 <section className="bg-paper-3 border rounded-lg overflow-auto">
 <table className="w-full text-xs border-collapse">
 <thead>
 <tr>
 <th className="p-2 border bg-paper-2">Period</th>
 {days.map((d: any) => (
 <th key={d.id} className="p-2 border bg-paper-2">{d.name}</th>
 ))}
 </tr>
 </thead>
 <tbody>
 {periods.map((p: any) => (
 <tr key={p.id} className={!isTeachingPeriod(p) ? "bg-warn-well" : ""}>
 <td className="p-2 border font-medium bg-paper-2">{p.name}</td>
 {!isTeachingPeriod(p) ? (
 days.map((d: any) => (
 <td key={d.id} className="p-2 border text-center italic text-warn align-top">
 <div className="text-xs font-semibold tabular-nums not-italic">{periodTimeRange(periodOnDay(p, d))}</div>
 {periodTypeLabel(p.period_type)}
 </td>
 ))
 ) : (
 days.map((d: any) => (
 <td key={d.id} className="p-1 border align-top h-16">
 {periodTimeRange(periodOnDay(p, d)) && (
 <div className="text-xs font-semibold tabular-nums text-muted mb-0.5">
 {periodTimeRange(periodOnDay(p, d))}
 </div>
 )}
 {(cellMap[`${d.id}|${p.id}`] || []).map((c: any, i: number) => (
 <div key={i} className="period-card" style={chipStyle(c.color)} title={cardFullTitle(c)}>{cardShortLabel(c)}</div>
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
