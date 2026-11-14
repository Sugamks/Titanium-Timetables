import { useEffect, useState } from "react";
import { api } from "../api";
import ErrorBanner from "../ui/ErrorBanner";
import { Field, inputClass } from "../ui/SearchSelect";
import { formatDateTime } from "../ui/dates";

type AuditRow = {
  id: string;
  entity: string;
  reason?: string | null;
  created_at?: string | null;
};

const KINDS = [
  ["", "All"],
  ["teacher", "Teachers"],
  ["class", "Classes"],
  ["subject", "Subjects"],
  ["lesson", "Lessons"],
  ["card", "Cards"],
  ["constraint", "Constraints"],
  ["template", "Templates"],
  ["bell", "Bell times"],
  ["publish", "Publish"],
];

const STORED_LABEL: Record<string, string> = {
  teacher: "Teachers",
  teachers: "Teachers",
  class: "Classes",
  sections: "Classes",
  subject: "Subjects",
  subjects: "Subjects",
  lesson: "Lessons",
  lessons: "Lessons",
  lesson_allocation: "Cards",
  designer: "Cards",
  allocations: "Cards",
  constraint: "Constraints",
  constraints: "Constraints",
  timetable: "Templates",
  timetables: "Templates",
  period: "Bell times",
  periods: "Bell times",
  timetable_version: "Publish",
  document: "File",
};

export default function AuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [err, setErr] = useState("");
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams({ limit: "500" });
    if (kind) params.set("kind", kind);
    if (q.trim()) params.set("q", q.trim());
    if (since) params.set("since", since);
    if (until) params.set("until", until);
    const handle = window.setTimeout(() => {
      setLoading(true);
      api<AuditRow[]>(`/v1/audit?${params.toString()}`)
        .then(setRows)
        .catch((e: any) => setErr(e.message))
        .finally(() => setLoading(false));
    }, 200);
    return () => window.clearTimeout(handle);
  }, [kind, q, since, until]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">Audit log</h1>
        <p className="text-muted text-sm">What changed in this timetable file. The log does not name who was signed in.</p>
      </header>
      <ErrorBanner message={err} onClear={() => setErr("")} />
      <div className="bg-paper-3 border border-rule rounded-xl p-3 flex flex-wrap gap-3 items-end">
        <div className="w-44">
          <Field label="Kind">
            <select className={`${inputClass} h-10`} value={kind} onChange={(e) => setKind(e.target.value)}>
              {KINDS.map(([value, label]) => (
                <option key={value || "all"} value={value}>{label}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="w-40">
          <Field label="From">
            <input type="date" className={`${inputClass} h-10`} value={since} onChange={(e) => setSince(e.target.value)} />
          </Field>
        </div>
        <div className="w-40">
          <Field label="To">
            <input type="date" className={`${inputClass} h-10`} value={until} onChange={(e) => setUntil(e.target.value)} />
          </Field>
        </div>
        <div className="flex-1 min-w-[12rem]">
          <Field label="Search">
            <input className={`${inputClass} h-10`} value={q} placeholder="Subject, class, teacher" onChange={(e) => setQ(e.target.value)} />
          </Field>
        </div>
      </div>
      <div className="bg-paper-3 border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-paper-2 text-left text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">When</th>
              <th className="px-3 py-2 font-medium">Kind</th>
              <th className="px-3 py-2 font-medium">What happened</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-muted">
                  {loading ? "Loading…" : "No matching changes. Make a change, or clear a filter."}
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-3 py-2 whitespace-nowrap text-muted tabular-nums">
                  {formatDateTime(row.created_at)}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-muted">
                  {STORED_LABEL[row.entity] || row.entity}
                </td>
                <td className="px-3 py-2 break-words">{row.reason || row.entity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
