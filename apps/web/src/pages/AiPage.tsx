import { useState } from "react";
import { api } from "../api";
import PageHelp from "../ui/PageHelp";

export default function AiPage() {
 const [prompt, setPrompt] = useState("Don' schedule Physics on Friday.");
 const [result, setResult] = useState<any>(null);
 const [msg, setMsg] = useState("");

 async function run(e: React.FormEvent) {
 e.preventDefault();
 setMsg("");
 const r = await api("/v1/ai/commands", { method: "POST", body: JSON.stringify({ prompt }) });
 setResult(r);
 }

 async function apply() {
 if (!result?.id) return;
 const r = await api(`/v1/ai/commands/${result.id}/apply`, { method: "POST" });
 setMsg(JSON.stringify(r));
 }

 return (
 <div className="max-w-2xl space-y-4">
 <div className="flex items-center gap-2">
 <h1 className="text-2xl font-semibold">Timetable AI</h1>
 <PageHelp page="ai" />
 </div>
 <p className="text-slate-500 text-sm">Natural language becomes a structured command. Nothing is written until you apply.</p>
 <form onSubmit={run} className="space-y-3">
 <textarea className="w-full border rounded-lg p-3 h-28" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
 <button className="bg-indigo-600 text-white rounded px-4 py-2 text-sm">Preview command</button>
 </form>
 {result && (
 <div className="bg-white border rounded-lg p-4 text-sm space-y-2">
 <div className="font-medium">{result.structured?.summary}</div>
 <pre className="text-xs bg-slate-50 p-2 overflow-auto">{JSON.stringify(result.structured, null, 2)}</pre>
 {result.structured?.kind === "add_constraint" && (
 <button onClick={apply} className="bg-slate-900 text-white rounded px-3 py-1">Apply constraint</button>
 )}
 </div>
 )}
 {msg && <p className="text-sm">{msg}</p>}
 </div>
 );
}
