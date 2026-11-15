import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { chipStyle } from "../ui/colors";
import { withBusy } from "../ui/busy";
import { isTeachingPeriod, periodTypeLabel } from "../periods";
import { onYearChange, timetablesUrl } from "../year";
import ErrorBanner from "../ui/ErrorBanner";
import { useToast } from "../ui/Toast";
import PageHelp from "../ui/PageHelp";
import { cardFullTitle, cardShortLabel } from "../ui/lessonMarks";

type View = "section" | "teacher";

export default function DesignerPage() {
 const [tts, setTts] = useState<any[]>([]);
 const [versionId, setVersionId] = useState("");
 const [grid, setGrid] = useState<any>(null);
 const [lessons, setLessons] = useState<any[]>([]);
 const [view, setView] = useState<View>("section");
 const [filter, setFilter] = useState("");
 const filterDefaulted = useRef(false);
 const [dragging, setDragging] = useState<any>(null);
 const [preview, setPreview] = useState<any>(null);
 const [msg, setMsg] = useState("");
 const toast = useToast();
 const [slotHint, setSlotHint] = useState<any>(null);
 const [slotMap, setSlotMap] = useState<Record<string, any>>({});
 const [undoStack, setUndoStack] = useState<any[]>([]);
 const [lane, setLane] = useState("ALL");
 const [swapA, setSwapA] = useState<any>(null);
 const [swapOn, setSwapOn] = useState(false);

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

 async function rememberSlots(item: any) {
 const id = item?.lesson_id || item?.id;
 if (!versionId || !id) return;
 try {
 const r = await api<any>(`/v1/designer/possible-slots?version_id=${versionId}&lesson_id=${id}`, undefined, { busy: false });
 const map: Record<string, any> = {};
 for (const s of r.slots || []) map[`${s.day_id}|${s.period_id}`] = s;
 setSlotMap(map);
 } catch {
 setSlotMap({});
 }
 }

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
 const placedName = dragging.short || dragging.subject || "The lesson";
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
 const before = dragging.allocation_id
 ? { allocation_id: dragging.allocation_id, lesson_id: body.lesson_id, day_id: dragging.day_id, period_id: dragging.period_id, room_resource_id: dragging.room_resource_id }
 : null;
 await withBusy("Updating timetable…", async () => {
 const placed = await api<any>("/v1/designer/allocations", { method: "POST", body: JSON.stringify(body) });
 setUndoStack((stack) => [...stack, { before, created: before ? null : placed.id, version_id: versionId }]);
 setMsg("");
 setDragging(null);
 setPreview(null);
 setSlotMap({});
 await loadGrid(versionId);
 });
 toast(`Placed ${placedName} on ${day.name}, ${period.name}.`);
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

 async function undo() {
 const step = undoStack[undoStack.length - 1];
 if (!step) return;
 setUndoStack((stack) => stack.slice(0, -1));
 if (step.before?.allocation_id) {
 await api("/v1/designer/allocations", { method: "POST", body: JSON.stringify({ ...step.before, version_id: step.version_id }) });
 } else if (step.created) {
 await api(`/v1/designer/allocations/${step.created}`, { method: "DELETE" });
 }
 await loadGrid(versionId);
 toast("Undid the last move.");
 }

 async function swapWith(card: any) {
 if (!swapOn) return;
 if (!swapA) {
 setSwapA(card);
 return;
 }
 if (swapA.id === card.id) {
 setSwapA(null);
 return;
 }
 const first = swapA;
 await api("/v1/designer/allocations", {
 method: "POST",
 body: JSON.stringify({
 version_id: versionId,
 allocation_id: first.id,
 lesson_id: first.lesson_id,
 day_id: card.day_id,
 period_id: card.period_id,
 room_resource_id: first.room_resource_id,
 stack: false,
 }),
 });
 setSwapA(null);
 setSwapOn(false);
 await loadGrid(versionId);
 toast(`Swapped ${first.short || "the first lesson"} with ${card.short || "the second lesson"}.`);
 }

 function weekOk(a: any) {
 const code = a.week_code || "ALL";
 if (lane === "ALL") return true;
 return code === "ALL" || code === lane;
 }

 function visible(a: any) {
 if (!weekOk(a)) return false;
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
 ).sort((a, b) => String(a).localeCompare(String(b)));

 useEffect(() => {
 if (!filterOptions.length) return;
 if (!filterDefaulted.current || (filter && !filterOptions.includes(filter))) {
 setFilter(filterOptions[0]);
 filterDefaulted.current = true;
 }
 }, [filterOptions, filter]);

 return (
 <div className="flex gap-4 h-[calc(100vh-4rem)]">
 <aside className="w-56 shrink-0 bg-paper-3 border rounded-lg p-3 overflow-auto">
 <h2 className="font-medium text-sm mb-2">Unplaced lessons</h2>
 {unplaced.map((l) => (
 <div
 key={l.id}
 draggable
 onDragStart={() => { setDragging(l); rememberSlots(l); }}
 className="mb-2 rounded border px-2 py-1 text-xs cursor-grab"
 style={{ borderLeft: `4px solid ${l.color || "var(--color-muted)"}` }}
 >
 <div className="font-medium">{l.subject}</div>
 <div className="text-muted">{l.section} · {l.teachers?.[0]} {l.duration_periods > 1 ? `· ${l.duration_periods}p` : ""}</div>
 {versionId && (
 <button
 className="text-xs text-accent mt-1"
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
 <section className="flex-1 bg-paper-3 border rounded-lg overflow-auto">
 <div className="flex items-center gap-3 p-3 border-b">
 <PageHelp page="designer" />
 <select className="border rounded px-2 py-1 text-sm" value={versionId} onChange={(e) => setVersionId(e.target.value)}>
 {tts.flatMap((t) => t.versions.map((v: any) => (
 <option key={v.id} value={v.id}>{t.name} · v{v.number} ({v.status})</option>
 )))}
 </select>
 {(["section", "teacher"] as View[]).map((v) => (
 <button
 key={v}
 onClick={() => {
 setView(v);
 filterDefaulted.current = false;
 setFilter("");
 }}
 className={`text-sm px-2 py-1 rounded ${view === v ? "bg-accent text-accent-ink" : "bg-paper-2"}`}
 >
 {v}
 </button>
 ))}
 <select className="border rounded px-2 py-1 text-sm" value={filter} onChange={(e) => setFilter(e.target.value)}>
 <option value="">All</option>
 {filterOptions.map((o: any) => (
 <option key={o} value={o}>{o}</option>
 ))}
 </select>
 {(["ALL", "WEEK_A", "WEEK_B"] as const).map((code) => (
 <button
 key={code}
 type="button"
 onClick={() => {
 if (code === lane) return;
 setLane(code);
 }}
 className={`text-sm px-2 py-1 rounded ${lane === code ? "bg-accent text-accent-ink" : "bg-paper-2"}`}
 >
 {code === "ALL" ? "Both weeks" : code === "WEEK_A" ? "Odd week" : "Even week"}
 </button>
 ))}
 <button type="button" className="text-sm px-2 py-1 rounded border" disabled={!undoStack.length} onClick={undo}>Undo</button>
 <button type="button" className={`text-sm px-2 py-1 rounded border ${swapOn ? "bg-warn-well" : ""}`} onClick={() => { setSwapOn((v) => !v); setSwapA(null); }}>
 {swapOn ? "Cancel swap" : "Swap"}
 </button>
 {swapOn && (
 <span className="text-xs text-warn font-medium">{swapA ? "Step 2 · click the other card" : "Step 1 · click the first card"}</span>
 )}
 {grid?.health && (
 <span className={`text-xs ${grid.health.ok ? "text-success" : "text-warn"}`}>
 {grid.health.ok ? "No hard conflicts" : "Conflicts present"}
 </span>
 )}
 </div>
 <ErrorBanner className="mx-3 mb-2" message={msg} onClear={() => setMsg("")} />
 <div key={`${view}-${lane}`} className="motion-week">
 <table className="w-full text-xs border-collapse">
 <thead>
 <tr>
 <th className="p-2 border bg-paper-2">Period</th>
 {grid?.days?.map((d: any) => (
 <th key={d.id} className="p-2 border bg-paper-2">{d.name.slice(0, 3)}</th>
 ))}
 </tr>
 </thead>
 <tbody>
 {grid?.periods?.map((p: any) => {
 const teaching = isTeachingPeriod(p);
 if (!teaching) {
 return (
 <tr key={p.id} className="bg-warn-well text-warn">
 <td className="p-2 border font-medium bg-warn-well">
 {p.name}
 {p.start_time && <div className="text-xs text-warn">{p.start_time}</div>}
 </td>
 <td className="p-2 border text-center italic text-xs" colSpan={grid.days.length}>
 {periodTypeLabel(p.period_type)} · cannot place lessons
 </td>
 </tr>
 );
 }
 return (
 <tr key={p.id}>
 <td className="p-2 border font-medium bg-paper-2">{p.name}</td>
 {grid.days.map((d: any) => {
 const cells = (cellMap[`${d.id}|${p.id}`] || []).filter(visible);
 return (
 <td
 key={d.id}
 className={`p-1 border h-16 align-top ${
 slotMap[`${d.id}|${p.id}`]
 ? slotMap[`${d.id}|${p.id}`].ok
 ? "ring-2 ring-inset ring-success"
 : "opacity-35"
 : ""
 }`}
 title={(slotMap[`${d.id}|${p.id}`]?.reasons || []).join(", ")}
 onDragOver={(e) => {
 if (slotMap[`${d.id}|${p.id}`] && !slotMap[`${d.id}|${p.id}`].ok) return;
 onCellDragOver(e, d, p);
 }}
 onDrop={() => {
 if (slotMap[`${d.id}|${p.id}`] && !slotMap[`${d.id}|${p.id}`].ok) return;
 drop(d, p);
 }}
 >
 {cells.map((a: any) => (
 <div
 key={a.id}
 draggable
 onClick={() => { if (swapOn) swapWith(a); }}
 onDragStart={() => { setDragging({ ...a, allocation_id: a.id }); rememberSlots(a); }}
 className="period-card cursor-grab"
 style={chipStyle(a.color)}
 title={cardFullTitle(a, a.lock_level && a.lock_level !== "none" ? "Locked." : undefined)}
 >
 {cardShortLabel(a)}
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
 </div>
 </section>
 <aside className="w-64 shrink-0 bg-paper-3 border rounded-lg p-3 text-sm">
 <h2 className="font-medium mb-2">Inspector</h2>
 {slotHint && (
 <div className="mb-3 text-xs">
 <div className="font-medium">{slotHint.lesson}</div>
 <div className="text-muted">Available {slotHint.available}, preferred {slotHint.preferred}, blocked {slotHint.blocked}</div>
 <ul className="mt-1 max-h-28 overflow-auto">
 {(slotHint.slots || []).filter((s: any) => s.ok).slice(0, 12).map((s: any) => (
 <li key={`${s.day_id}-${s.period_id}`}>{s.day} {s.period}</li>
 ))}
 </ul>
 </div>
 )}
 {preview ? (
 <div>
 <div className="text-muted">{preview.day} {preview.period}</div>
 <ul className="mt-2 space-y-1">
 {preview.issues?.map((i: any) => (
 <li key={i.code} className={i.ok ? "text-success" : "text-error"}>
 {i.ok ? "✓" : "✗"} {i.label}
 </li>
 ))}
 </ul>
 {preview.explanation && <p className="mt-3 text-muted">{preview.explanation.summary}</p>}
 {preview.issues?.find((i: any) => i.alternatives)?.alternatives?.map((r: any) => (
 <div key={r.id} className="text-xs">{r.name} {r.ok ? "✓" : "✗"}</div>
 ))}
 </div>
 ) : (
 <p className="text-muted">Drag a lesson onto a cell o preview conflicts.</p>
 )}
 {dragging?.id && dragging.allocation_id && (
 <button
 className="mt-4 text-xs border rounded px-2 py-1"
 onClick={async () => {
 const locking = dragging.lock_level !== "full" && dragging.lock_level !== "lesson";
 await api(`/v1/designer/allocations/${dragging.allocation_id}/lock`, { method: "POST", body: JSON.stringify({ lock_level: locking ? "full" : "none" }) });
 loadGrid(versionId);
 toast(locking ? "Locked that lesson on this period." : "Unlocked that lesson.");
 }}
 >
 Toggle lesson lock
 </button>
 )}
 </aside>
 </div>
 );
}
