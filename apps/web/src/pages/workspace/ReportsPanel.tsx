import { useEffect, useMemo, useState } from "react";
import { api, getToken } from "../../api";
import { isTeachingPeriod, periodTypeLabel } from "../../periods";
import { IconButton } from "../../ui/icons";
import ErrorBanner from "../../ui/ErrorBanner";
import { chipStyle } from "../../ui/colors";

type View = "section" | "teacher" | "subject" | "unplaced" | "teacher_load" | "class_load";

const VIEWS: { id: View; label: string }[] = [
 { id: "section", label: "Class" },
 { id: "teacher", label: "Teacher" },
 { id: "subject", label: "Subject" },
 { id: "unplaced", label: "Unplaced" },
 { id: "teacher_load", label: "Teacher load" },
 { id: "class_load", label: "Class load" },
];

export default function ReportsPanel({ yearId, tts }: { yearId: string; tts: any[] }) {
 const [data, setData] = useState<any>(null);
 const [view, setView] = useState<View>("section");
 const [entity, setEntity] = useState("");
 const [err, setErr] = useState("");
 const [downloading, setDownloading] = useState(false);

 const versionId = tts[0]?.versions?.slice(-1)[0]?.id || "";

 async function load() {
 setErr("");
 const q = new URLSearchParams();
 if (versionId) q.set("version_id", versionId);
 if (yearId) q.set("academic_year_id", yearId);
 try {
 const r = await api(`/v1/reports/timetable?${q.toString()}`);
 setData(r);
 setEntity("");
 } catch (e: any) {
 setErr(e.message);
 }
 }

 useEffect(() => {
 load();
 }, [yearId, versionId]);

 const groups = useMemo(() => {
 if (!data) return [];
 const map: Record<string, any[]> = {
 section: data.sections || [],
 teacher: data.teachers || [],
 subject: data.subjects || [],
 };
 return map[view] || [];
 }, [data, view]);

 const shown = entity ? groups.filter((g: any) => g.name === entity) : groups;

 async function downloadExcel() {
 const q = new URLSearchParams();
 if (versionId) q.set("version_id", versionId);
 if (yearId) q.set("academic_year_id", yearId);
 q.set("view", view);
 if (entity) q.set("entity", entity);
 setDownloading(true);
 try {
 const token = getToken();
 const res = await fetch(`/v1/reports/timetable.xlsx?${q.toString()}`, {
 headers: token ? { Authorization: `Bearer ${token}` } : {},
 });
 if (!res.ok) {
 const ex = await res.text();
 throw new Error(ex || "Download failed");
 }
 const blob = await res.blob();
 const match = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "");
 const name = match?.[1] || "timetable.xlsx";
 const url = URL.createObjectURL(blob);
 const a = document.createElement("a");
 a.href = url;
 a.download = name;
 a.click();
 URL.revokeObjectURL(url);
 } catch (e: any) {
 setErr(e.message || "Download failed");
 } finally {
 setDownloading(false);
 }
 }

 if (err) return <ErrorBanner message={err} onClear={() => setErr("")} />;
 if (!data) return <div className="text-slate-500 text-sm">Loading reports…</div>;
 if (!data.ok) {
 return <div className="bg-white border rounded-xl p-8 text-sm text-slate-500 text-center">{data.error}</div>;
 }

 const days = data.days || [];
 const periods = data.periods || [];

 return (
 <div className="space-y-4 report-print">
 <div className="bg-white border rounded-xl p-4 flex flex-wrap gap-2 items-center print:hidden">
 {VIEWS.map((v) => (
 <button
 key={v.id}
 onClick={() => { setView(v.id); setEntity(""); }}
 className={`text-sm px-3 py-1.5 rounded-lg ${view === v.id ? "bg-indigo-600 text-white" : "bg-slate-100"}`}
 >
 {v.label}
 </button>
 ))}
 {groups.length > 0 && (
 <select className="border rounded-lg px-2 py-1.5 text-sm" value={entity} onChange={(e) => setEntity(e.target.value)}>
 <option value="">All</option>
 {groups.map((g: any) => (
 <option key={g.name} value={g.name}>{g.name}</option>
 ))}
 </select>
 )}
 <div className="ml-auto">
 <IconButton
 icon="download"
 label={downloading ? "Downloading…" : "Download"}
 variant="bordered"
 disabled={downloading}
 onClick={downloadExcel}
 />
 </div>
 </div>

 {view === "unplaced" && (
 <section className="bg-white border rounded-xl overflow-hidden">
 <table className="w-full text-sm">
 <thead className="bg-slate-50 text-left">
 <tr>
 <th className="p-3">Subject</th>
 <th className="p-3">Class</th>
 <th className="p-3">Teacher</th>
 <th className="p-3">Missing cards</th>
 </tr>
 </thead>
 <tbody>
 {(data.unplaced || []).length === 0 ? (
 <tr><td className="p-6 text-slate-500" colSpan={4}>Every lesson card is placed.</td></tr>
 ) : (
 data.unplaced.map((u: any) => (
 <tr key={u.id} className="border-t">
 <td className="p-3">{u.subject}</td>
 <td className="p-3">{u.section}</td>
 <td className="p-3">{u.teacher}</td>
 <td className="p-3">{u.missing}</td>
 </tr>
 ))
 )}
 </tbody>
 </table>
 </section>
 )}

 {(view === "teacher_load" || view === "class_load") && (
 <section className="bg-white border rounded-xl overflow-hidden">
 <table className="w-full text-sm">
 <thead className="bg-slate-50 text-left">
 <tr>
 <th className="p-3">Name</th>
 <th className="p-3">Placed</th>
 <th className="p-3">Required</th>
 <th className="p-3">Free slots</th>
 </tr>
 </thead>
 <tbody>
 {(data[view] || []).map((r: any) => (
 <tr key={r.name} className="border-t">
 <td className="p-3">{r.name}</td>
 <td className="p-3">{r.placed}</td>
 <td className="p-3">{r.required}</td>
 <td className="p-3">{r.free}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </section>
 )}

 {["section", "teacher", "subject"].includes(view) && (
 <div className="space-y-6">
 {shown.length === 0 && <div className="bg-white border rounded-xl p-8 text-sm text-slate-500 text-center">Nothing placed for this view yet. Generate a timetable first.</div>}
 {shown.map((g: any) => (
 <section key={g.name} className="bg-white border rounded-xl overflow-hidden break-inside-avoid">
 <h2 className="px-4 py-3 font-semibold border-b bg-slate-50">{g.name}</h2>
 <table className="w-full text-xs border-collapse">
 <thead>
 <tr>
 <th className="p-2 border bg-white">Period</th>
 {days.map((d: any) => (
 <th key={d.id} className="p-2 border">{d.name.slice(0, 3)}</th>
 ))}
 </tr>
 </thead>
 <tbody>
 {periods.map((p: any) => (
 <tr key={p.id} className={!isTeachingPeriod(p) ? "bg-amber-50" : ""}>
 <td className="p-2 border font-medium bg-slate-50">
 {p.name}
 {p.start_time && <div className="text-[10px] text-slate-400">{p.start_time}</div>}
 </td>
 {!isTeachingPeriod(p) ? (
 <td className="p-2 border text-center italic text-amber-800" colSpan={days.length}>{periodTypeLabel(p.period_type)}</td>
 ) : (
 days.map((d: any) => (
 <td key={d.id} className="p-1 border align-top h-14">
 {(g.cells?.[`${d.id}|${p.id}`] || []).map((c: any, i: number) => (
 <div key={i} className="rounded px-1 py-0.5 mb-0.5 leading-tight" style={chipStyle(c.color)}>
 <div className="font-semibold">{c.short}</div>
 {view === "teacher" && c.section ? <div className="opacity-90">{c.section}</div> : null}
 {view === "section" && c.teacher ? <div className="opacity-90">{c.teacher}</div> : null}
 {view !== "teacher" && view !== "section" && c.section ? <div className="opacity-90">{c.section}</div> : null}
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
 ))}
 </div>
 )}
 </div>
 );
}
