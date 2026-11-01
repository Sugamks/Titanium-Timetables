import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { isTeachingPeriod, periodTypeLabel } from "../../periods";
import SearchSelect, { DateInput, Field, inputClass } from "../../ui/SearchSelect";
import { formatDateTime } from "../../ui/dates";
import ClockPicker from "../../ui/ClockPicker";
import { IconButton } from "../../ui/icons";
import { chipStyle } from "../../ui/colors";

type Cover = {
 id: string;
 allocation_id: string;
 period_id: string;
 period: string;
 start_time: string;
 end_time: string;
 subject: string;
 short?: string;
 color?: string;
 section: string;
 section_ids: string[];
 status: string;
 cover_teacher_ids: string[];
 cover_teachers: string[];
 updated_at?: string | null;
 updated_by?: string;
 action_note?: string;
 action?: string;
};

type Period = {
 id: string;
 name: string;
 start_time: string;
 end_time: string;
 period_type?: string;
};

type Absentee = {
 absence_id: string;
 teacher_id: string;
 teacher: string;
 source: string;
 leave_for: string;
 time_in: string;
 time_out: string;
 pending: number;
 done: number;
 ignored: number;
 total: number;
 covers: Cover[];
};

type DayPayload = {
 id: string;
 on_date: string;
 status: string;
 weekday?: string;
 teaching_day?: string | null;
 version_label?: string;
 version_status?: string;
 pending: number;
 done: number;
 ignored: number;
 absentees: Absentee[];
 covers?: Cover[];
 periods?: Period[];
 day_grid?: { section_id: string; section: string; cells: Record<string, any> }[];
};

type Candidate = {
 teacher_id: string;
 name: string;
 score: number;
 blocked: boolean;
 free?: boolean;
 same_subject?: boolean;
 same_department?: boolean;
 teaches_class: boolean;
 department?: string;
 daily: number;
 weekly: number;
 monthly: number;
 daily_cap: number;
 weekly_cap: number;
 monthly_cap: number;
 reasons: { ok: boolean; ext: string }[];
};

function sourceLabel(source: string) {
 if (source === "leave") return "Leave";
 if (source === "attendance") return "Attendance";
 return "Ad-hoc";
}

function whenLabel(iso?: string | null) {
 return formatDateTime(iso);
}

export default function SubstitutionDayPanel({
 date,
 onDate,
 templates,
 templateId,
 onTemplate,
 teachers,
 day,
 onChanged,
 onError,
 onMessage,
}: {
 date: string;
 onDate: (v: string) => void;
 templates: { id: string; name: string }[];
 templateId: string;
 onTemplate: (v: string) => void;
 teachers: { id: string; name: string }[];
 day: DayPayload | null;
 onChanged: () => Promise<void> | void;
 onError: (m: string) => void;
 onMessage: (m: string) => void;
}) {
 const [selectedId, setSelectedId] = useState("");
 const [showAdhoc, setShowAdhoc] = useState(false);
 const [assignCover, setAssignCover] = useState<Cover | null>(null);
 const [candidates, setCandidates] = useState<Candidate[]>([]);
 const [picked, setPicked] = useState<string[]>([]);
 const [showBusy, setShowBusy] = useState(false);
 const [multi, setMulti] = useState(false);
 const [staffQuery, setStaffQuery] = useState("");
 const [focus, setFocus] = useState<"suggested" | "subject" | "class" | "all">("suggested");
 const [busy, setBusy] = useState("");
 const [view, setView] = useState<"teacher" | "school">("teacher");
 const [loadingCandidates, setLoadingCandidates] = useState(false);

 const selected = useMemo(
 () => day?.absentees.find((a) => a.teacher_id === selectedId) || day?.absentees[0] || null,
 [day, selectedId]
 );

 useEffect(() => {
 if (!day?.absentees.length) {
 setSelectedId("");
 return;
 }
 if (!day.absentees.some((a) => a.teacher_id === selectedId)) {
 setSelectedId(day.absentees[0].teacher_id);
 }
 }, [day, selectedId]);

 async function publish() {
 if (!day) return;
 setBusy("publish");
 try {
 await api(`/v1/operations/substitutions/${day.id}/publish`, { method: "POST" });
 onMessage("Substitution day published");
 await onChanged();
 } catch (e: any) {
 onError(e.message);
 } finally {
 setBusy("");
 }
 }

 async function removeAbsentee(absenceId: string) {
 setBusy(absenceId);
 try {
 await api(`/v1/operations/absences/${absenceId}`, { method: "DELETE" });
 onMessage("Absentee removed");
 await onChanged();
 } catch (e: any) {
 onError(e.message);
 } finally {
 setBusy("");
 }
 }

 async function openAssign(cover: Cover) {
 if (!day || cover.status === "ignored") return;
 setAssignCover(cover);
 setPicked(cover.cover_teacher_ids || []);
 setMulti((cover.cover_teacher_ids || []).length > 1);
 setStaffQuery("");
 setFocus("suggested");
 setLoadingCandidates(true);
 try {
 const rows = await api<Candidate[]>(
 `/v1/operations/substitutions/${day.id}/candidates?cover_id=${cover.id}`,
 { method: "POST" }
 );
 setCandidates(rows);
 } catch (e: any) {
 onError(e.message);
 } finally {
 setLoadingCandidates(false);
 }
 }

 async function assignIds(ids: string[]) {
 if (!day || !assignCover) return;
 setBusy("assign");
 try {
 await api(`/v1/operations/substitutions/${day.id}/cover`, {
 method: "POST",
 body: JSON.stringify({
 cover_id: assignCover.id,
 cover_teacher_ids: ids,
 status: "covered",
 }),
 });
 setPicked(ids);
 onMessage(ids.length ? "Cover assigned" : "Cover cleared");
 await onChanged();
 } catch (e: any) {
 onError(e.message);
 } finally {
 setBusy("");
 }
 }

 function clickCandidate(id: string) {
 if (multi) {
 const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
 assignIds(next);
 return;
 }
 assignIds(picked[0] === id ? [] : [id]);
 }

 useEffect(() => {
 if (!assignCover || !day) return;
 const fresh = (day.covers || []).find((c: Cover) => c.id === assignCover.id)
 || day.absentees.flatMap((a) => a.covers).find((c) => c.id === assignCover.id);
 if (fresh) setAssignCover(fresh);
 }, [day]);

 async function clearCover(cover: Cover) {
 if (!day) return;
 try {
 await api(`/v1/operations/substitutions/${day.id}/cover/clear`, {
 method: "POST",
 body: JSON.stringify({ cover_id: cover.id }),
 });
 onMessage("Cover removed");
 await onChanged();
 } catch (e: any) {
 onError(e.message);
 }
 }

 async function toggleIgnore(cover: Cover, reason?: string) {
 if (!day) return;
 const ignoring = cover.status !== "ignored";
 try {
 await api(`/v1/operations/substitutions/${day.id}/ignore`, {
 method: "POST",
 body: JSON.stringify({
 cover_id: cover.id,
 ignored: ignoring,
 reason: ignoring ? (reason || "No substitute needed") : null,
 }),
 });
 onMessage(ignoring ? "Period marked: no substitute needed" : "Period needs cover again");
 await onChanged();
 } catch (e: any) {
 onError(e.message);
 }
 }

 const visibleCandidates = useMemo(() => {
 const q = staffQuery.trim().toLowerCase();
 return candidates.filter((c) => {
 if (!showBusy && c.blocked) return false;
 if (q && !c.name.toLowerCase().includes(q)) return false;
 if (focus === "subject" && !c.same_subject) return false;
 if (focus === "class" && !c.teaches_class) return false;
 if (focus === "suggested" && !c.blocked && !c.same_subject && !c.teaches_class) return false;
 return true;
 });
 }, [candidates, showBusy, staffQuery, focus]);
 const suggested = visibleCandidates.filter((c) => !c.blocked && (c.same_subject || c.teaches_class));
 const otherFree = visibleCandidates.filter((c) => !c.blocked && !c.same_subject && !c.teaches_class);
 const busyStaff = visibleCandidates.filter((c) => c.blocked);
 const freeCount = candidates.filter((c) => !c.blocked).length;
 const subjectCount = candidates.filter((c) => !c.blocked && c.same_subject).length;
 const classCount = candidates.filter((c) => !c.blocked && c.teaches_class).length;
 const periods = day?.periods || [];
 const coverByPeriod = useMemo(() => {
 const map: Record<string, Cover> = {};
 (selected?.covers || []).forEach((c) => {
 if (c.period_id) map[c.period_id] = c;
 });
 return map;
 }, [selected]);

 return (
 <div className="space-y-4">
 <div className="bg-white border rounded-lg p-4 flex flex-wrap items-end justify-between gap-3">
 <div className="flex flex-wrap items-end gap-3">
 <div className="w-56 shrink-0">
 <SearchSelect
 label="Template"
 value={templateId}
 onChange={onTemplate}
 options={templates.map((t) => ({ value: t.id, label: t.name }))}
 placeholder="Select template"
 />
 </div>
 <Field label="Date">
 <DateInput value={date} onChange={onDate} />
 </Field>
 {day && (
 <div className="text-sm text-slate-500 pb-2">
 <span className={`inline-flex px-2 py-0.5 rounded-lg text-xs font-medium ${day.status === "published" ? "bg-emerald-50 text-emerald-700" : "bg-slate-50 text-slate-500"}`}>
 {day.status === "published" ? "Published" : "Draft"}
 </span>
 <span className="ml-2">{day.weekday}</span>
 {day.teaching_day ? <span className="ml-2">{day.pending} pending · {day.done} covered · {day.ignored} ignored</span> : <span className="ml-2 text-amber-700">No teaching day in the template</span>}
 </div>
 )}
 </div>
 <div className="flex flex-wrap gap-2">
 <button type="button" className="border rounded-lg px-3 py-2 text-sm" onClick={() => setShowAdhoc(true)}>
 Add absence
 </button>
 <button
 type="button"
 className="bg-indigo-600 text-white text-white rounded-lg px-3 py-2 text-sm disabled:opacity-50"
 disabled={!day || busy === "publish"}
 onClick={publish}
 >
 Publish day
 </button>
 </div>
 </div>

 {!day && <p className="text-sm text-slate-500">Publish or save a timetable first, then open this date.</p>}

 {day && (
 <div className={`grid gap-4 items-start ${assignCover ? "xl:grid-cols-[13rem_1fr_22rem]" : "xl:grid-cols-[13rem_1fr]"}`}>
 <aside className="bg-white border rounded-lg overflow-hidden">
 <div className="px-3 py-2 text-xs text-slate-500 border-b">Absentees</div>
 {day.absentees.length === 0 && <p className="px-3 py-6 text-sm text-slate-500">None for this template</p>}
 {day.absentees.map((a) => (
 <div
 key={a.teacher_id}
 role="button"
 tabIndex={0}
 onClick={() => { setSelectedId(a.teacher_id); setAssignCover(null); }}
 onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setSelectedId(a.teacher_id); }}
 className={`w-full text-left px-3 py-2 border-b last:border-b-0 cursor-pointer ${selected?.teacher_id === a.teacher_id ? "bg-slate-50" : "hover:bg-slate-50"}`}
 >
 <div className="flex items-start justify-between gap-2">
 <div className="min-w-0">
 <div className="font-medium truncate">{a.teacher}</div>
 <div className="text-xs text-slate-500">
 {sourceLabel(a.source)} · {a.time_in}–{a.time_out}
 </div>
 </div>
 {a.absence_id && (
 <IconButton icon="close" label="Remove absentee" onClick={(e) => { e.stopPropagation(); removeAbsentee(a.absence_id); }} />
 )}
 </div>
 <div className="mt-1 flex gap-1 text-xs">
 <span className="px-1.5 rounded bg-amber-50 text-amber-700">{a.pending} pending</span>
 <span className="px-1.5 rounded bg-emerald-50 text-emerald-700">{a.done} done</span>
 {a.ignored > 0 && <span className="px-1.5 rounded bg-slate-50 text-slate-500">{a.ignored} ignored</span>}
 </div>
 </div>
 ))}
 </aside>

 <section className="bg-white border rounded-lg p-3 min-h-[20rem] overflow-auto">
 <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
 <div>
 <h2 className="font-medium">{view === "teacher" ? (selected?.teacher || "Select an absentee") : `${day.weekday} · all classes`}</h2>
 <p className="text-xs text-slate-500">
 {view === "teacher"
 ? "Click a period on their day o assign a free teacher."
 : "Click a highlighted period (absent teacher) o assign cover."}
 </p>
 </div>
 <div className="flex rounded-lg border p-0.5 text-xs">
 <button type="button" className={`px-2.5 py-1 rounded-lg ${view === "teacher" ? "bg-indigo-600 text-white text-white" : "text-slate-500"}`} onClick={() => setView("teacher")}>
 Teacher day
 </button>
 <button type="button" className={`px-2.5 py-1 rounded-lg ${view === "school" ? "bg-indigo-600 text-white text-white" : "text-slate-500"}`} onClick={() => setView("school")}>
 School day
 </button>
 </div>
 </div>

 {view === "teacher" && !selected && <p className="text-sm text-slate-500">Select an absentee.</p>}
 {view === "teacher" && selected && periods.length === 0 && (
 <p className="text-sm text-slate-500">{day.teaching_day ? "No periods on this template." : `${day.weekday} is not a teaching day.`}</p>
 )}
 {view === "teacher" && selected && periods.length > 0 && (
 <table className="w-full text-xs border-collapse min-w-[36rem]">
 <thead>
 <tr>
 {periods.map((p) => (
 <th key={p.id} className="p-1.5 border bg-slate-50 font-medium">
 <div>{p.name}</div>
 {p.start_time && <div className="text-xs text-slate-500 font-normal">{p.start_time}{p.end_time ? `–${p.end_time}` : ""}</div>}
 </th>
 ))}
 </tr>
 </thead>
 <tbody>
 <tr>
 {periods.map((p) => {
 if (!isTeachingPeriod(p)) {
 return (
 <td key={p.id} className="p-2 border bg-amber-50 text-center italic text-amber-800">
 {periodTypeLabel(p.period_type)}
 </td>
 );
 }
 const c = coverByPeriod[p.id];
 if (!c) {
 return <td key={p.id} className="p-2 border bg-slate-50/60 text-slate-300 text-center">Free</td>;
 }
 const covered = c.status !== "ignored" && (c.cover_teacher_ids || []).length > 0;
 const selectedCell = assignCover?.id === c.id;
 return (
 <td key={p.id} className="p-1 border align-top">
 <button
 type="button"
 onClick={() => openAssign(c)}
 className={`w-full text-left rounded-lg px-1.5 py-1.5 min-h-[4.5rem] ${selectedCell ? "ring-2 ring-indigo-600 ring-offset-1" : ""}`}
 style={{ ...chipStyle(c.color), opacity: c.status === "ignored" ? 0.45 : 1 }}
 >
 <div className="font-semibold leading-tight">{c.short || c.subject}</div>
 <div className="opacity-90">{c.section}</div>
 {c.status === "ignored" ? (
 <div className="mt-1 text-xs leading-tight">
 No substitute
 {c.action_note ? <div className="opacity-90">{c.action_note}</div> : null}
 {whenLabel(c.updated_at) ? <div className="opacity-80">{whenLabel(c.updated_at)}</div> : null}
 </div>
 ) : covered ? (
 <div className="mt-1 text-xs bg-white/20 rounded px-1 py-0.5 leading-tight">
 {c.cover_teachers.join(", ")}
 {whenLabel(c.updated_at) ? <div>{whenLabel(c.updated_at)}</div> : null}
 </div>
 ) : (
 <div className="mt-1 text-xs bg-amber-400/90 text-amber-950 rounded px-1 py-0.5">Needs cover</div>
 )}
 </button>
 </td>
 );
 })}
 </tr>
 </tbody>
 </table>
 )}

 {view === "school" && (
 <table className="w-full text-xs border-collapse min-w-[40rem]">
 <thead>
 <tr>
 <th className="p-1.5 border bg-slate-50 text-left sticky left-0">Class</th>
 {periods.map((p) => (
 <th key={p.id} className="p-1.5 border bg-slate-50">{p.name}</th>
 ))}
 </tr>
 </thead>
 <tbody>
 {(day.day_grid || []).map((row) => (
 <tr key={row.section_id}>
 <td className="p-1.5 border font-medium bg-slate-50 sticky left-0 whitespace-nowrap">{row.section}</td>
 {periods.map((p) => {
 if (!isTeachingPeriod(p)) {
 return <td key={p.id} className="p-1 border bg-amber-50" />;
 }
 const cell = row.cells?.[p.id];
 if (!cell) return <td key={p.id} className="p-1 border" />;
 const cover = cell.cover_id
 ? (day.covers || []).find((c) => c.id === cell.cover_id) || selected?.covers.find((c) => c.id === cell.cover_id)
 : null;
 const selectedCell = cover && assignCover?.id === cover.id;
 return (
 <td key={p.id} className="p-0.5 border align-top">
 <button
 type="button"
 disabled={!cover}
 onClick={() => cover && openAssign(cover)}
 className={`w-full text-left rounded px-1 py-1 min-h-[3.5rem] disabled:cursor-default ${selectedCell ? "ring-2 ring-indigo-600" : ""} ${cover ? "" : "opacity-80"}`}
 style={chipStyle(cell.color)}
 >
 <div className="font-semibold">{cell.short || cell.subject}</div>
 <div className="opacity-90 truncate">{cover ? cell.absent_teacher : cell.teacher}</div>
 {cover?.status === "ignored" ? (
 <div className="text-xs">No substitute{whenLabel(cover.updated_at) ? ` · ${whenLabel(cover.updated_at)}` : ""}</div>
 ) : cover && (cover.cover_teachers || []).length ? (
 <div className="text-xs bg-white/20 rounded px-1">
 → {cover.cover_teachers.join(", ")}
 {whenLabel(cover.updated_at) ? ` · ${whenLabel(cover.updated_at)}` : ""}
 </div>
 ) : cover ? (
 <div className="text-xs bg-amber-400/90 text-amber-950 rounded px-1">Needs cover</div>
 ) : null}
 </button>
 </td>
 );
 })}
 </tr>
 ))}
 </tbody>
 </table>
 )}
 </section>

 {assignCover && (
 <aside className="bg-white border rounded-lg overflow-hidden sticky top-4 max-h-[calc(100vh-8rem)] flex flex-col">
 <div className="px-3 py-2 border-b flex items-start justify-between gap-2 shrink-0">
 <div>
 <div className="font-medium text-sm">{assignCover.period} · {assignCover.short || assignCover.subject}</div>
 <div className="text-xs text-slate-500">{assignCover.section}</div>
 {assignCover.status === "ignored" && (
 <p className="text-xs text-slate-500 mt-1">
 No substitute{assignCover.action_note ? ` · ${assignCover.action_note}` : ""}.
 {whenLabel(assignCover.updated_at) ? ` ${whenLabel(assignCover.updated_at)}` : ""}
 </p>
 )}
 {assignCover.status !== "ignored" && (assignCover.cover_teachers || []).length > 0 && (
 <p className="text-xs text-emerald-700 mt-1">
 {assignCover.cover_teachers.join(", ")}
 {whenLabel(assignCover.updated_at) ? ` · ${whenLabel(assignCover.updated_at)}` : ""}
 </p>
 )}
 </div>
 <IconButton icon="close" label="Close" onClick={() => { setAssignCover(null); setCandidates([]); }} />
 </div>
 <div className="px-3 py-2 border-b shrink-0 space-y-2">
 <input
 className="w-full border rounded-lg px-2.5 py-1.5 text-sm"
 placeholder="Search staff…"
 value={staffQuery}
 onChange={(e) => setStaffQuery(e.target.value)}
 />
 <div className="flex flex-wrap gap-1">
 {(
 [
 ["suggested", `Suggested (${subjectCount + classCount})`],
 ["subject", `Same subject (${subjectCount})`],
 ["class", `This class (${classCount})`],
 ["all", `All free (${freeCount})`],
 ] as const
 ).map(([id, label]) => (
 <button
 key={id}
 type="button"
 onClick={() => setFocus(id)}
 className={`text-xs px-2 py-1 rounded-lg border ${focus === id ? "bg-indigo-600 text-white text-white border-indigo-600" : "bg-white text-slate-500"}`}
 >
 {label}
 </button>
 ))}
 </div>
 <div className="flex flex-wrap gap-3 text-xs text-slate-500">
 <label className="flex items-center gap-1">
 <input type="checkbox" checked={showBusy} onChange={(e) => setShowBusy(e.target.checked)} />
 Include busy
 </label>
 <label className="flex items-center gap-1">
 <input type="checkbox" checked={multi} onChange={(e) => { setMulti(e.target.checked); if (!e.target.checked) setPicked((p) => p.slice(0, 1)); }} />
 Two staff
 </label>
 <button type="button" className="underline" onClick={() => toggleIgnore(assignCover, assignCover.status === "ignored" ? undefined : "No substitute needed")}>
 {assignCover.status === "ignored" ? "Needs cover again" : "Skip period"}
 </button>
 {(assignCover.cover_teacher_ids || []).length > 0 && (
 <button type="button" className="underline" onClick={() => clearCover(assignCover)}>Clear cover</button>
 )}
 </div>
 </div>
 <div className="overflow-auto flex-1">
 {loadingCandidates && <p className="px-3 py-4 text-sm text-slate-500">Finding free staff…</p>}
 {!loadingCandidates && focus === "suggested" && suggested.length === 0 && (
 <div className="px-3 py-4 text-sm text-slate-500">
 No free teacher of this subject or class.
 <button type="button" className="block mt-2 text-slate-900" onClick={() => setFocus("all")}>
 Show {freeCount} other free staff
 </button>
 </div>
 )}
 {suggested.length > 0 && (
 <section className="px-3 py-2">
 <h3 className="text-xs text-slate-500 mb-1.5">Best match</h3>
 <div className="space-y-1.5">
 {suggested.map((c) => (
 <CandidateRow key={c.teacher_id} c={c} picked={picked} busy={busy === "assign"} onPick={clickCandidate} />
 ))}
 </div>
 </section>
 )}
 {otherFree.length > 0 && (
 <section className="px-3 py-2 border-t">
 <h3 className="text-xs text-slate-500 mb-1.5">Other free staff</h3>
 <div className="space-y-1.5">
 {otherFree.map((c) => (
 <CandidateRow key={c.teacher_id} c={c} picked={picked} busy={busy === "assign"} onPick={clickCandidate} compact />
 ))}
 </div>
 </section>
 )}
 {busyStaff.length > 0 && (
 <section className="px-3 py-2 border-t">
 <h3 className="text-xs text-slate-500 mb-1.5">Busy this period</h3>
 <div className="space-y-1.5">
 {busyStaff.map((c) => (
 <CandidateRow key={c.teacher_id} c={c} picked={picked} busy={busy === "assign"} onPick={clickCandidate} compact />
 ))}
 </div>
 </section>
 )}
 </div>
 </aside>
 )}
 </div>
 )}

 {showAdhoc && (
 <AdhocModal
 date={date}
 teachers={teachers}
 existingIds={(day?.absentees || []).map((a) => a.teacher_id)}
 onClose={() => setShowAdhoc(false)}
 onError={onError}
 onSaved={async () => {
 setShowAdhoc(false);
 onMessage("Absence added");
 await onChanged();
 }}
 />
 )}

 </div>
 );
}

function CandidateRow({
 c,
 picked,
 busy,
 onPick,
 compact,
}: {
 c: Candidate;
 picked: string[];
 busy: boolean;
 onPick: (id: string) => void;
 compact?: boolean;
}) {
 const on = picked.includes(c.teacher_id);
 const tags: string[] = [];
 if (c.same_subject) tags.push("Same subject");
 if (c.teaches_class) tags.push("This class");
 if (c.same_department) tags.push("Same dept");
 if (c.blocked) tags.push("Busy");
 else tags.push("Free");
 return (
 <button
 type="button"
 disabled={busy}
 onClick={() => onPick(c.teacher_id)}
 className={`w-full text-left rounded-lg border px-2.5 py-2 ${on ? "border-emerald-400 bg-emerald-50" : "border-slate-200 hover:border-slate-400 hover:bg-slate-50/40"} ${c.blocked ? "opacity-60" : ""}`}
 >
 <div className="flex items-start justify-between gap-2">
 <div className="min-w-0">
 <div className="font-medium text-sm truncate">{c.name}</div>
 {!compact && tags.length > 0 && (
 <div className="flex flex-wrap gap-1 mt-1">
 {tags.map((t) => (
 <span
 key={t}
 className={`text-xs px-1.5 py-0.5 rounded-lg ${
 t === "Free" || t === "Same subject" || t === "This class"
 ? "bg-emerald-100 text-emerald-800"
 : t === "Busy"
 ? "bg-amber-100 text-amber-800"
 : "bg-slate-50 text-slate-500"
 }`}
 >
 {t}
 </span>
 ))}
 </div>
 )}
 {compact && (
 <div className="text-xs text-slate-500 mt-0.5">{tags.filter((t) => t !== "Free").join(" · ") || "Available"}</div>
 )}
 </div>
 <span className={`shrink-0 text-xs font-medium ${on ? "text-emerald-700" : "text-slate-900"}`}>
 {on ? "Assigned" : "Use"}
 </span>
 </div>
 </button>
 );
}

function AdhocModal({
 date,
 teachers,
 existingIds,
 onClose,
 onSaved,
 onError,
}: {
 date: string;
 teachers: { id: string; name: string }[];
 existingIds: string[];
 onClose: () => void;
 onSaved: () => Promise<void> | void;
 onError: (m: string) => void;
}) {
 const available = teachers.filter((t) => !existingIds.includes(t.id));
 const [teacherId, setTeacherId] = useState(available[0]?.id || "");
 const [leaveFor, setLeaveFor] = useState("fullday");
 const [timeIn, setTimeIn] = useState("07:30");
 const [timeOut, setTimeOut] = useState("17:00");
 const [saving, setSaving] = useState(false);

 async function save() {
 if (!teacherId) return;
 setSaving(true);
 try {
 await api("/v1/operations/absences", {
 method: "POST",
 body: JSON.stringify({
 teacher_id: teacherId,
 on_date: date,
 leave_for: leaveFor,
 source: "adhoc",
 time_in: leaveFor === "custom" ? timeIn : null,
 time_out: leaveFor === "custom" ? timeOut : null,
 }),
 });
 await onSaved();
 } catch (e: any) {
 onError(e.message);
 } finally {
 setSaving(false);
 }
 }

 return (
 <div className="fixed inset-0 z-40 bg-indigo-600 text-white/40 flex items-center justify-center p-4" onClick={onClose}>
 <div className="bg-white rounded-lg shadow-none w-full max-w-md p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
 <div className="flex items-center justify-between">
 <h3 className="font-medium">Add absence</h3>
 <IconButton icon="close" label="Close" onClick={onClose} />
 </div>
 <SearchSelect
 label="Teacher"
 value={teacherId}
 onChange={setTeacherId}
 options={available.map((t) => ({ value: t.id, label: t.name }))}
 />
 <Field label="Window">
 <select className={inputClass} value={leaveFor} onChange={(e) => setLeaveFor(e.target.value)}>
 <option value="fullday">Full day</option>
 <option value="morning">Morning</option>
 <option value="noon">Afternoon</option>
 <option value="custom">Custom times</option>
 </select>
 </Field>
 {leaveFor === "custom" && (
 <div className="grid grid-cols-2 gap-3">
 <ClockPicker label="From" value={timeIn} onChange={setTimeIn} />
 <ClockPicker label="To" value={timeOut} onChange={setTimeOut} />
 </div>
 )}
 <button type="button" disabled={saving || !teacherId} onClick={save} className="w-full bg-indigo-600 text-white text-white rounded-lg py-2 text-sm disabled:opacity-50">
 Add o substitution day
 </button>
 </div>
 </div>
 );
}
