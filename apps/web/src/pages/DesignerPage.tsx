import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { withBusy } from "../ui/busy";
import { isTeachingPeriod, periodTypeLabel } from "../periods";
import { onYearChange, timetablesUrl } from "../year";
import ErrorBanner from "../ui/ErrorBanner";
import { useToast } from "../ui/Toast";
import { chipStyle } from "../ui/colors";

type View = "section" | "teacher";

export default function DesignerPage() {
 const [tts, setTts] = useState<any[]>([]);
 const [versionId, setVersionId] = useState("");
 const [grid, setGrid] = useState<any>(null);
 const [lessons, setLessons] = useState<any[]>([]);
 const [view, setView] = useState<View>("section");
 const [filter, setFilter] = useState("");
 const [dragging, setDragging] = useState<any>(null);
 const [preview, setPreview] = useState<any>(null);
 const [msg, setMsg] = useState("");
 const toast = useToast();
 const [slotHint, setSlotHint] = useState<any>(null);

 async function loadVersions() {
 const t = await api<any[]>(timetablesUrl());
 setTts(t);
 const v = t[0]?.versions?.slice(-1)[0]?.id;
 setVersionId(v || "");
 }

 async function loadGrid(id: string) {
 const [g, l] = await Promise.all([api(`/v1/designer/versions/${id}`), api("/v1/lessons")]);
 setGrid(g);
 setLessons(l);
 }

 useEffect(() => {
 loadVersions();
 return onYearChange(loadVersions);
 }, []);

 useEffect(() => {
 if (versionId) loadGrid(versionId);
 }, [versionId]);

 const unplaced = useMemo(() => {
 const counts: Record<string, number> = {};
 (grid?.allocations || []).forEach((a: any) => {
 counts[a.lesson_id] = (counts[a.lesson_id] || 0) + 1;
 });
 return lessons.filter((l) => (counts[l.id] || 0) < l.frequency_per_week);
 }, [lessons, grid]);

 async function onCellDragOver(e: React.DragEvent, day: any, period: any) {
 e.preventDefault();
 if (!dragging) return;
 const body = {
 version_id: versionId,
 lesson_id: dragging.lesson_id || dragging.id,
 day_id: day.id,
 period_id: period.id,
 room_resource_id: dragging.room_resource_id || dragging.room_resource_ids?.[0],
 allocation_id: dragging.allocation_id,
 };
 try {
 const r = await api("/v1/designer/preview", { method: "POST", body: JSON.stringify(body) }, { busy: false });
 setPreview({ ...r, day: day.name, period: period.name });
 } catch {
 /* ignore */
 }
 }

 async function drop(day: any, period: any) {
 if (!dragging) return;
 const body = {
 version_id: versionId,
 lesson_id: dragging.lesson_id || dragging.id,
 day_id: day.id,
 period_id: period.id,
 room_resource_id: dragging.room_resource_id || dragging.room_resource_ids?.[0],
 allocation_id: dragging.allocation_id,
 occurrence_index: dragging.occurrence_index || 0,
 };
 try {
 await withBusy("Updating timetable…", async () => {
 await api("/v1/designer/allocations", { method: "POST", body: JSON.stringify(body) });
 setMsg("");
 setDragging(null);
 setPreview(null);
 await loadGrid(versionId);
 });
 toast("Saved");
 } catch (e: any) {
 setMsg(e.message);
 }
 }

 const cellMap: Record<string, any[]> = {};
 (grid?.allocations || []).forEach((a: any) => {
 const k = `${a.day_id}|${a.period_id}`;
 (cellMap[k] ||= []).push(a);
 });

 function classNamesOf(a: any): string[] {
 if (Array.isArray(a.sections) && a.sections.length) return a.sections;
 return String(a.section || "")
 .split(",")
 .map((s: string) => s.trim())
 .filter(Boolean);
 }

 function visible(a: any) {
 if (!filter) return true;
 if (view === "section") return classNamesOf(a).includes(filter);
 return a.teacher === filter;
 }

 const filterOptions = Array.from(
 new Set(
 (grid?.allocations || []).flatMap((a: any) =>
 view === "section" ? classNamesOf(a) : [a.teacher]
 ).filter(Boolean)
 )
 );

 return (
 <div className="flex gap-4 h-[calc(100vh-4rem)]">
 <aside className="w-56 shrink-0 bg-white border rounded-lg p-3 overflow-auto">
 <h2 className="font-medium text-sm mb-2">Unplaced lessons</h2>
 {unplaced.map((l) => (
 <div
 key={l.id}
 draggable
 onDragStart={() => setDragging(l)}
 className="mb-2 rounded border px-2 py-1 text-xs cursor-grab"
 style={{ borderLeft: `4px solid ${l.color || "#64748b"}` }}
 >
 <div className="font-medium">{l.subject}</div>
 <div className="text-slate-500">{l.section} · {l.teachers?.[0]} {l.duration_periods > 1 ? `· ${l.duration_periods}p` : ""}</div>
 {versionId && (
 <button
 className="text-[10px] text-indigo-600 mt-1"
 onClick={async (e) => {
 e.stopPropagation();
 const r = await api(`/v1/designer/possible-slots?version_id=${versionId}&lesson_id=${l.id}`);
 setSlotHint({ lesson: l.subject, ...r });
 }}
 >
 Find slots
 </button>
 )}
 </div>
 ))}
 </aside>
 <section className="flex-1 bg-white border rounded-lg overflow-auto">
 <div className="flex items-center gap-3 p-3 border-b">
 <select className="border rounded px-2 py-1 text-sm" value={versionId} onChange={(e) => setVersionId(e.target.value)}>
 {tts.flatMap((t) => t.versions.map((v: any) => (
 <option key={v.id} value={v.id}>{t.name} · v{v.number} ({v.status})</option>
 )))}
 </select>
 {(["section", "teacher"] as View[]).map((v) => (
 <button key={v} onClick={() => { setView(v); setFilter(""); }} className={`text-sm px-2 py-1 rounded ${view === v ? "bg-indigo-600 text-white" : "bg-slate-100"}`}>
 {v}
 </button>
 ))}
 <select className="border rounded px-2 py-1 text-sm" value={filter} onChange={(e) => setFilter(e.target.value)}>
 <option value="">All</option>
 {filterOptions.map((o: any) => (
 <option key={o} value={o}>{o}</option>
 ))}
 </select>
 {grid?.health && (
 <span className={`text-xs ${grid.health.ok ? "text-emerald-600" : "text-amber-600"}`}>
 {grid.health.ok ? "No hard conflicts" : "Conflicts present"}
 </span>
 )}
 </div>
 <ErrorBanner className="mx-3 mb-2" message={msg} onClear={() => setMsg("")} />
 <table className="w-full text-xs border-collapse">
 <thead>
 <tr>
 <th className="p-2 border bg-slate-50">Period</th>
 {grid?.days?.map((d: any) => (
 <th key={d.id} className="p-2 border bg-slate-50">{d.name.slice(0, 3)}</th>
 ))}
 </tr>
 </thead>
 <tbody>
 {grid?.periods?.map((p: any) => {
 const teaching = isTeachingPeriod(p);
 if (!teaching) {
 return (
 <tr key={p.id} className="bg-amber-50 text-amber-900">
 <td className="p-2 border font-medium bg-amber-50">
 {p.name}
 {p.start_time && <div className="text-[10px] text-amber-700">{p.start_time}</div>}
 </td>
 <td className="p-2 border text-center italic text-xs" colSpan={grid.days.length}>
 {periodTypeLabel(p.period_type)} · cannot place lessons
 </td>
 </tr>
 );
 }
 return (
 <tr key={p.id}>
 <td className="p-2 border font-medium bg-slate-50">{p.name}</td>
 {grid.days.map((d: any) => {
 const cells = (cellMap[`${d.id}|${p.id}`] || []).filter(visible);
 return (
 <td
 key={d.id}
 className="p-1 border h-16 align-top"
 onDragOver={(e) => onCellDragOver(e, d, p)}
 onDrop={() => drop(d, p)}
 >
 {cells.map((a: any) => (
 <div
 key={a.id}
 draggable
 onDragStart={() => setDragging({ ...a, allocation_id: a.id })}
 className="rounded px-1 py-0.5 mb-1 text-[11px] cursor-grab"
 style={chipStyle(a.color)}
 title={a.lock_level}
 >
 {a.short} {a.section}
 {a.lock_level !== "none" ? " 🔒" : ""}
 </div>
 ))}
 </td>
 );
 })}
 </tr>
 );
 })}
 </tbody>
 </table>
 </section>
 <aside className="w-64 shrink-0 bg-white border rounded-lg p-3 text-sm">
 <h2 className="font-medium mb-2">Inspector</h2>
 {slotHint && (
 <div className="mb-3 text-xs">
 <div className="font-medium">{slotHint.lesson}</div>
 <div className="text-slate-500">Available {slotHint.available} · Preferred {slotHint.preferred} · Blocked {slotHint.blocked}</div>
 <ul className="mt-1 max-h-28 overflow-auto">
 {(slotHint.slots || []).filter((s: any) => s.ok).slice(0, 12).map((s: any) => (
 <li key={`${s.day_id}-${s.period_id}`}>{s.day} {s.period}</li>
 ))}
 </ul>
 </div>
 )}
 {preview ? (
 <div>
 <div className="text-slate-500">{preview.day} {preview.period}</div>
 <ul className="mt-2 space-y-1">
 {preview.issues?.map((i: any) => (
 <li key={i.code} className={i.ok ? "text-emerald-600" : "text-error"}>
 {i.ok ? "✓" : "✗"} {i.label}
 </li>
 ))}
 </ul>
 {preview.explanation && <p className="mt-3 text-slate-600">{preview.explanation.summary}</p>}
 {preview.issues?.find((i: any) => i.alternatives)?.alternatives?.map((r: any) => (
 <div key={r.id} className="text-xs">{r.name} {r.ok ? "✓" : "✗"}</div>
 ))}
 </div>
 ) : (
 <p className="text-slate-400">Drag a lesson onto a cell o preview conflicts.</p>
 )}
 {dragging?.id && dragging.allocation_id && (
 <button
 className="mt-4 text-xs border rounded px-2 py-1"
 onClick={async () => {
 await api(`/v1/designer/allocations/${dragging.allocation_id}/lock`, { method: "POST", body: JSON.stringify({ lock_level: dragging.lock_level === "lesson" ? "none" : "lesson" }) });
 loadGrid(versionId);
 toast("Saved");
 }}
 >
 Toggle lesson lock
 </button>
 )}
 </aside>
 </div>
 );
}
