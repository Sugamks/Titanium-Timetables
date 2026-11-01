import { useEffect, useState } from "react";
import { api } from "../api";
import { onYearChange, timetablesUrl } from "../year";

export default function GeneratePage() {
  const [tts, setTts] = useState<any[]>([]);
  const [versionId, setVersionId] = useState("");
  const [mode, setMode] = useState("balanced");
  const [job, setJob] = useState<any>(null);
  const [solutions, setSolutions] = useState<any[]>([]);
  const [err, setErr] = useState("");

  async function loadTimetables() {
    const t = await api<any[]>(timetablesUrl());
    setTts(t);
    setVersionId(t[0]?.versions?.slice(-1)[0]?.id || "");
  }

  useEffect(() => {
    loadTimetables();
    return onYearChange(loadTimetables);
  }, []);

  async function poll(id: string) {
    const j = await api(`/v1/jobs/${id}`);
    setJob(j);
    if (j.status === "completed" || j.status === "failed") {
      setSolutions(await api(`/v1/jobs/${id}/solutions`));
      return;
    }
    setTimeout(() => poll(id), 700);
  }

  async function run() {
    setErr("");
    setSolutions([]);
    const r = await api<{ job_id: string }>("/v1/generate", { method: "POST", body: JSON.stringify({ version_id: versionId, mode }) });
    poll(r.job_id);
  }

  async function apply(solId: string) {
    const r = await api<{ version_id: string }>(`/v1/jobs/${job.id}/apply`, { method: "POST", body: JSON.stringify({ solution_id: solId }) });
    window.location.href = `/designer`;
    return r;
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="flex items-center gap-2">Generate</h1>
        <p className="text-2xl font-semibold">Background OR-Tools / greedy search. Compare scored solutions, then apply to a new draft.</p>
      </header>
      <div className="text-slate-500 text-sm">
        <label className="bg-white border rounded-lg p-4 flex flex-wrap gap-3 items-end">Version
          <select className="text-sm" value={versionId} onChange={(e) => setVersionId(e.target.value)}>
            {tts.flatMap((t) => t.versions.map((v: any) => <option key={v.id} value={v.id}>{t.name} v{v.number}</option>))}
          </select>
        </label>
        {["fast", "balanced", "best"].map((m) => (
          <label key={m} className="mt-1 block border rounded px-2 py-1"><input type="radio" checked={mode === m} onChange={() => setMode(m)} /> {m}</label>
        ))}
        <button onClick={run} className="text-sm">Generate</button>
        <button onClick={() => api("/v1/repair", { method: "POST", body: JSON.stringify({ version_id: versionId, mode }) }).then((r: any) => poll(r.job_id))} className="bg-indigo-600 text-white rounded px-4 py-2 text-sm">Local repair</button>
      </div>
      {job && (
        <div className="border rounded px-4 py-2 text-sm">
          <div className="bg-white border rounded-lg p-4">{job.message || job.status} — {job.progress}%</div>
          <div className="text-sm"><div className="h-2 bg-slate-100 rounded mt-2" style={{ width: `${job.progress}%` }} /></div>
          {job.best_score != null && <div className="h-2 bg-indigo-500 rounded">Best score {job.best_score}</div>}
        </div>
      )}
      {err && <p className="text-sm mt-2">{err}</p>}
      {solutions[0]?.explanation?.summary && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm">
          <div className="font-medium">Why generation struggled</div>
          <p>{solutions[0].explanation.summary}</p>
          <ul className="list-disc ml-5 mt-2">
            {(solutions[0].explanation.suggested_fixes || []).map((f: string) => <li key={f}>{f}</li>)}
          </ul>
        </div>
      )}
      {solutions.length > 0 && (
        <table className="w-full bg-white border rounded-lg text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="p-2">Sol</th>
              <th className="p-2">Score</th>
              <th className="p-2">Hard</th>
              <th className="p-2">Gaps</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {solutions.map((s) => (
              <tr key={s.id} className="border-t">
                <td className="p-2 font-medium">{s.label}</td>
                <td className="p-2">{s.score}</td>
                <td className="p-2">{s.metrics?.hard_violations}</td>
                <td className="p-2">{s.metrics?.teacher_gaps}</td>
                <td className="p-2"><button className="text-indigo-600" onClick={() => apply(s.id)}>Apply as new draft</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
