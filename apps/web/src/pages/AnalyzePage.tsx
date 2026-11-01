import { useEffect, useState } from "react";
import { api } from "../api";
import { onYearChange, timetablesUrl } from "../year";
import PageHelp from "../ui/PageHelp";
function Bar({ label, value }: { label: string; value: number }) {
 return (
 <div>
 <div className="flex justify-between text-sm"><span>{label}</span><span>{value}%</span></div>
 <div className="h-2 bg-slate-100 rounded"><div className="h-2 bg-indigo-500 rounded" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>
 </div>
 );
}

export default function AnalyzePage() {
 const [q, setQ] = useState<any>(null);
 const [load, setLoad] = useState<any[]>([]);
 const [impact, setImpact] = useState<any>(null);
 const [tts, setTts] = useState<any[]>([]);
 const [versionId, setVersionId] = useState("");
 const [catalog, setCatalog] = useState<any>(null);

 function loadTimetables() {
 api<any[]>(timetablesUrl()).then((t) => {
 setTts(t);
 setVersionId(t[0]?.versions?.slice(-1)[0]?.id || "");
 });
 }

 useEffect(() => {
 api("/v1/analytics/quality").then(setQ);
 api("/v1/analytics/substitution-load").then(setLoad);
 api("/v1/catalog").then(setCatalog);
 loadTimetables();
 return onYearChange(loadTimetables);
 }, []);

 const m = q?.metrics || {};

 return (
 <div className="space-y-6 max-w-4xl">
 <div className="flex flex-wrap justify-between gap-3 items-start">
 <div className="flex items-center gap-2">
 <h1 className="text-2xl font-semibold">Timetable quality</h1>
 <PageHelp page="analyze" />
 </div>
 </div>
 <div className="bg-white border rounded-lg p-4 space-y-3">
 <Bar label="Hard constraints" value={m.hard_constraints || 0} />
 <Bar label="Teacher gaps" value={m.teacher_gaps || 0} />
 <Bar label="Preference score" value={m.preference_score || 0} />
 <Bar label="Overall" value={m.overall || 0} />
 <p className="text-sm text-slate-500">{q?.hard_ok ? "Ready o publish" : "Hard validation failed — publish is blocked"}</p>
 </div>
 <section className="bg-white border rounded-lg p-4">
 <h2 className="font-medium mb-2">Teacher gaps</h2>
 {(q?.teacher_gap_details || []).map((g: any, i: number) => (
 <div key={i} className="text-sm">{g.teacher}: {g.gaps}</div>
 ))}
 </section>
 <section className="bg-white border rounded-lg p-4">
 <h2 className="font-medium mb-2">Substitution load</h2>
 {load.map((r) => <div key={r.teacher_id} className="text-sm">{r.name}: {r.covers}</div>)}
 </section>
 <section className="bg-white border rounded-lg p-4 space-y-2">
 <h2 className="font-medium">Change impact</h2>
 <select className="border rounded px-2 py-1 text-sm" onChange={async (e) => {
 const r = await api("/v1/impact", { method: "POST", body: JSON.stringify({ version_id: versionId, teacher_resource_id: e.target.value }) });
 setImpact(r.result || r);
 }}>
 <option value="">Teacher unavailable…</option>
 {catalog?.teachers?.map((t: any) => <option key={t.resource_id} value={t.resource_id}>{t.name}</option>)}
 </select>
 {impact && <pre className="text-xs bg-slate-50 p-2 overflow-auto">{JSON.stringify(impact, null, 2)}</pre>}
 </section>
 </div>
 );
}
