import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { IconButton } from "../ui/icons";
import PageHelp from "../ui/PageHelp";
import SearchSelect, { Field, inputClass, MultiSearchSelect } from "../ui/SearchSelect";
import { currentYearId, onYearChange, timetablesUrl } from "../year";
const TEMPLATE_KEY = "construct-template-id";

function onTemplate(item: { time_grid_id?: string; time_grid_ids?: string[] }, gridId: string) {
 if (!gridId) return true;
 if (item.time_grid_id && item.time_grid_id === gridId) return true;
 return (item.time_grid_ids || []).includes(gridId);
}

function missingFromError(err: any): string[] {
 const inner = err?.detail?.detail;
 if (inner && typeof inner === "object" && Array.isArray(inner.missing)) {
 return inner.missing.map((x: unknown) => String(x));
 }
 return [];
}

export default function GroupsPage() {
 const [catalog, setCatalog] = useState<any>(null);
 const [tts, setTts] = useState<any[]>([]);
 const [yearId, setYearId] = useState(() => currentYearId());
 const [templateId, setTemplateId] = useState(() => {
 try {
 return sessionStorage.getItem(TEMPLATE_KEY) || "";
 } catch {
 return "";
 }
 });
 const [err, setErr] = useState("");
 const [missing, setMissing] = useState<string[]>([]);
 const [saving, setSaving] = useState("");
 const [bandName, setBandName] = useState("");
 const [bandSubjects, setBandSubjects] = useState<string[]>([]);
 const [bandSections, setBandSections] = useState<string[]>([]);
 const [groupName, setGroupName] = useState("");
 const [groupSection, setGroupSection] = useState("");

 async function load() {
 const [c, t] = await Promise.all([api("/v1/catalog"), api<any[]>(timetablesUrl())]);
 setCatalog(c);
 setTts(t);
 }

 useEffect(() => {
 load().catch((e) => setErr(e.message));
 return onYearChange(() => setYearId(currentYearId()));
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
 const templateGridId = yearTemplates.find((t: any) => t.id === templateId)?.time_grid_id || "";

 if (!catalog) {
 return <div className="text-slate-500 py-16 text-center">Loading groups…</div>;
 }

 const sections = (catalog.sections || []).filter((s: any) => !yearId || s.academic_year_id === yearId);
 const yearSubjects = (catalog.subjects || []).filter(
 (s: any) => !yearId || !(s.academic_year_ids || []).length || (s.academic_year_ids || []).includes(yearId)
 );
 const subjectNames = new Set(
 (catalog.subjects || []).map((s: any) => String(s.name || "").trim().toLowerCase()).filter(Boolean)
 );
 const bands = (catalog.bands || []).filter((b: any) => {
 if (yearId && (b.academic_year_ids || []).length && !(b.academic_year_ids || []).includes(yearId)) return false;
 return onTemplate(b, templateGridId);
 });
 const splits = (catalog.groups || []).filter((g: any) => {
 if ((g.kind || "split") === "all") return false;
 if (yearId && g.academic_year_id && g.academic_year_id !== yearId) return false;
 if (subjectNames.has(String(g.name || "").trim().toLowerCase())) return false;
 return onTemplate(g, templateGridId);
 });

 return (
 <div className="max-w-6xl mx-auto space-y-4">
 <header className="flex flex-wrap justify-between gap-3 items-start">
 <div>
 <div className="flex items-center gap-2">
 <h1 className="text-2xl font-semibold text-slate-900">Groups</h1>
 <PageHelp page="groups" />
 </div>
 <p className="text-slate-500 text-sm mt-1 max-w-3xl">
 Period groups and class splits belong to a template, like lessons. Switch template to see only that plan.
 </p>
 </div>
 <div className="flex flex-wrap gap-2 items-start">
 <div className="w-64">
 <SearchSelect
 label="Template"
 value={templateId}
 onChange={setTemplateId}
 options={yearTemplates.map((t: any) => ({ value: t.id, label: t.name }))}
 placeholder="Select template"
 />
 </div>
 </div>
 </header>

 {(err || missing.length > 0) && (
 <div role="alert" className="rounded-xl border-2 border-red-400 bg-red-50 px-4 py-3 text-red-900">
 <div className="flex items-start justify-between gap-3">
 <div>
 <p className="font-semibold">{err || "This period group could no be created."}</p>
 {missing.length > 0 && (
 <>
 <p className="text-sm mt-1">Missing lesson cards — add these on Construct → Lessons first:</p>
 <ul className="mt-2 grid sm:grid-cols-2 gap-x-6 text-sm list-disc pl-5">
 {missing.map((row) => (
 <li key={row}>{row}</li>
 ))}
 </ul>
 <Link to="/construct" className="inline-block mt-3 text-sm font-medium text-indigo-700 underline">
 Open Construct o add lessons
 </Link>
 </>
 )}
 </div>
 <IconButton
 icon="close"
 label="Clear"
 variant="danger"
 onClick={() => {
 setErr("");
 setMissing([]);
 }}
 />
 </div>
 </div>
 )}

 <div className="grid lg:grid-cols-2 gap-4">
 <section className="bg-white border rounded-xl p-4 shadow-sm">
 <h2 className="font-semibold">Period group</h2>
 <p className="text-xs text-slate-500 mt-1 mb-3">
 Add the subject–class lessons first. Example: LANGUAGE = Hindi + Kannada + English for Grade II B and II C.
 </p>
 <form
 className="space-y-3"
 onSubmit={async (e) => {
 e.preventDefault();
 setErr("");
 setMissing([]);
 if (!templateGridId) {
 setErr("Select a template first, then create the period group.");
 return;
 }
 if (!bandName.trim() || bandSubjects.length < 2 || !bandSections.length) {
 setErr("Name the group, pick a least two subjects, and pick the classes.");
 return;
 }
 setSaving("band");
 try {
 await api("/v1/bands", {
 method: "POST",
 body: JSON.stringify({
 name: bandName.trim(),
 subject_ids: bandSubjects,
 section_ids: bandSections,
 time_grid_id: templateGridId,
 }),
 });
 setBandName("");
 setBandSubjects([]);
 setBandSections([]);
 await load();
 } catch (e: any) {
 setErr(e.message);
 setMissing(missingFromError(e));
 } finally {
 setSaving("");
 }
 }}
 >
 <Field label="Name">
 <input className={inputClass} value={bandName} onChange={(e) => setBandName(e.target.value)} placeholder="LANGUAGE" />
 </Field>
 <MultiSearchSelect
 label="Subjects"
 values={bandSubjects}
 onChange={setBandSubjects}
 options={yearSubjects.map((s: any) => ({ value: s.id, label: s.name }))}
 placeholder="Hindi, Kannada…"
 />
 <MultiSearchSelect
 label="Classes"
 values={bandSections}
 onChange={setBandSections}
 options={sections.map((s: any) => ({ value: s.id, label: s.name }))}
 placeholder="Classes"
 />
 <button disabled={saving === "band"} className="h-10 px-4 bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-50">
 {saving === "band" ? "Saving…" : "Create period group"}
 </button>
 </form>
 <ul className="mt-4 text-sm divide-y">
 {bands.map((b: any) => (
 <li key={b.id} className="py-2 flex justify-between gap-2">
 <span>
 <span className="font-medium">{b.name}</span>
 {b.subjects?.length ? <span className="text-slate-500"> · {b.subjects.join(", ")}</span> : null}
 {b.sections?.length ? <span className="text-slate-400"> · {b.sections.join(" + ")}</span> : null}
 </span>
 <IconButton
 icon="trash"
 label="Delete period group"
 variant="danger"
 onClick={async () => {
 try {
 await api(`/v1/bands/${b.id}`, { method: "DELETE" });
 await load();
 } catch (e: any) {
 setErr(e.message);
 }
 }}
 />
 </li>
 ))}
 {!bands.length && <li className="py-3 text-slate-400">No period groups on this template.</li>}
 </ul>
 </section>

 <section className="bg-white border rounded-xl p-4 shadow-sm">
 <h2 className="font-semibold">Class split</h2>
 <p className="text-xs text-slate-500 mt-1 mb-3">
 Part of one class only (French A). Not the same as LANGUAGE.
 </p>
 <form
 className="space-y-3"
 onSubmit={async (e) => {
 e.preventDefault();
 setErr("");
 setMissing([]);
 if (!templateGridId) {
 setErr("Select a template first, then create the class split.");
 return;
 }
 if (!groupSection || !groupName.trim()) {
 setErr("Choose a class and a split name.");
 return;
 }
 setSaving("split");
 try {
 await api("/v1/groups", {
 method: "POST",
 body: JSON.stringify({
 section_id: groupSection,
 name: groupName.trim(),
 kind: "split",
 time_grid_id: templateGridId,
 }),
 });
 setGroupName("");
 await load();
 } catch (e: any) {
 setErr(e.message);
 } finally {
 setSaving("");
 }
 }}
 >
 <SearchSelect
 label="Class"
 value={groupSection}
 onChange={setGroupSection}
 options={sections.map((s: any) => ({ value: s.id, label: s.name }))}
 placeholder="Class"
 />
 <Field label="Spli name">
 <input className={inputClass} value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="French A" />
 </Field>
 <button disabled={saving === "split"} className="h-10 px-4 bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-50">
 {saving === "split" ? "Saving…" : "Create split"}
 </button>
 </form>
 <ul className="mt-4 text-sm divide-y">
 {splits.map((g: any) => (
 <li key={g.id} className="py-2 flex justify-between gap-2">
 <span>{g.section} · {g.name}</span>
 <IconButton
 icon="trash"
 label="Delete split"
 variant="danger"
 onClick={async () => {
 try {
 await api(`/v1/groups/${g.id}`, { method: "DELETE" });
 await load();
 } catch (e: any) {
 setErr(e.message);
 }
 }}
 />
 </li>
 ))}
 {!splits.length && <li className="py-3 text-slate-400">No class splits on this template.</li>}
 </ul>
 </section>
 </div>
 </div>
 );
}
