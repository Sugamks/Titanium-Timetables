import { useEffect, useState } from "react";
import { api } from "../api";
import ErrorBanner from "../ui/ErrorBanner";
import { formatDateTime } from "../ui/dates";

type AuditRow = {
 id: string;
 entity: string;
 entity_id?: string | null;
 actor?: string | null;
 reason?: string | null;
 new_value?: { username?: string } | null;
 created_at?: string | null;
};

export default function AuditPage() {
 const [rows, setRows] = useState<AuditRow[]>([]);
 const [err, setErr] = useState("");

 useEffect(() => {
 api<AuditRow[]>("/v1/audit?limit=200")
 .then(setRows)
 .catch((e: any) => setErr(e.message));
 }, []);

 return (
 <div className="space-y-4">
 <header>
 <h1 className="text-2xl font-semibold">Audit log</h1>
 <p className="text-slate-500 text-sm">Every change in this timetable file, and who did it.</p>
 </header>
 <ErrorBanner message={err} onClear={() => setErr("")} />
 <div className="bg-white border rounded-xl overflow-hidden">
 <table className="w-full text-sm">
 <thead className="bg-slate-50 text-left text-slate-600">
 <tr>
 <th className="px-3 py-2 font-medium">When</th>
 <th className="px-3 py-2 font-medium">Who</th>
 <th className="px-3 py-2 font-medium">Action</th>
 <th className="px-3 py-2 font-medium">Area</th>
 </tr>
 </thead>
 <tbody className="divide-y">
 {rows.length === 0 && (
 <tr>
 <td colSpan={4} className="px-3 py-6 text-slate-500">
 No actions recorded yet. Make a change and it will show up here.
 </td>
 </tr>
 )}
 {rows.map((row) => (
 <tr key={row.id}>
 <td className="px-3 py-2 whitespace-nowrap text-slate-500 tabular-nums">
 {formatDateTime(row.created_at)}
 </td>
 <td className="px-3 py-2">
 <div>{row.actor || "Unknown"}</div>
 {row.new_value?.username && (
 <div className="text-xs text-slate-400">{row.new_value.username}</div>
 )}
 </td>
 <td className="px-3 py-2">{row.reason || row.entity}</td>
 <td className="px-3 py-2 text-slate-500">{row.entity}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </div>
 );
}
