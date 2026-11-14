import { useEffect, useState } from "react";
import { api } from "../../api";
import { useToast } from "../../ui/Toast";
import { Field, inputClass } from "../../ui/SearchSelect";

export function DutiesPanel({ teachers, onError }: { teachers: { id: string; name: string }[]; onError: (m: string) => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState({ teacher_id: teachers[0]?.id || "", on_date: "", period_id: "", title: "Duty" });

  async function load() {
    setRows(await api("/v1/operations/duties"));
  }
  useEffect(() => { load().catch((e: any) => onError(e.message)); }, []);

  return (
    <div className="space-y-3 bg-paper-3 border rounded-xl p-4">
      <p className="text-sm text-muted">A duty period cannot be used for cover.</p>
      <form className="flex flex-wrap gap-2 items-end" onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api("/v1/operations/duties", { method: "POST", body: JSON.stringify({ ...form, period_id: form.period_id || null }) });
          toast(`Added ${form.title || "duty"} on ${form.on_date}.`);
          await load();
        } catch (ex: any) { onError(ex.message); }
      }}>
        <Field label="Teacher">
          <select className={inputClass} value={form.teacher_id} onChange={(e) => setForm({ ...form, teacher_id: e.target.value })}>
            {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <Field label="Date">
          <input type="date" className={inputClass} value={form.on_date} onChange={(e) => setForm({ ...form, on_date: e.target.value })} required />
        </Field>
 <Field label="Name">
 <input className={inputClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
 </Field>
        <button className="h-[42px] px-3 bg-accent text-accent-ink rounded-lg text-sm">Add duty</button>
      </form>
      <ul className="divide-y text-sm">
        {rows.map((d) => (
          <li key={d.id} className="py-2 flex justify-between">
            <span>{d.on_date} · {d.title} · {teachers.find((t) => t.id === d.teacher_id)?.name || d.teacher_id}</span>
            <button className="text-error" onClick={async () => { await api(`/v1/operations/duties/${d.id}`, { method: "DELETE" }); await load(); }}>Delete</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WeightsPanel({ onError }: { onError: (m: string) => void }) {
  const toast = useToast();
  const [row, setRow] = useState<any>(null);
  useEffect(() => { api("/v1/operations/weights").then(setRow).catch((e: any) => onError(e.message)); }, []);
  if (!row) return null;
  const fields = [
    ["same_subject", "Same subject"],
    ["teaches_class", "Already teaches that class"],
    ["free", "Free, not only not busy"],
    ["under_cap", "Under the 1/3/12 cap"],
    ["not_exempt", "Not exempt"],
  ] as const;
  return (
    <form className="bg-paper-3 border rounded-xl p-4 space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      try {
        setRow(await api("/v1/operations/weights", { method: "PUT", body: JSON.stringify(row) }));
        toast("Saved the cover weights.");
      } catch (ex: any) { onError(ex.message); }
    }}>
      {fields.map(([key, label]) => (
        <label key={key} className="flex items-center justify-between gap-3 text-sm">
          {label}
          <input type="number" className="w-24 border rounded-lg px-2 py-1" value={row[key]} onChange={(e) => setRow({ ...row, [key]: Number(e.target.value) })} />
        </label>
      ))}
      <button className="px-3 py-2 bg-accent text-accent-ink rounded-lg text-sm">Save weights</button>
    </form>
  );
}

export function MonthPanel({ onError }: { onError: (m: string) => void }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    api<any>(`/v1/operations/month?year=${year}&month=${month}`).then((r) => setRows(r.rows || [])).catch((e: any) => onError(e.message));
  }, [year, month]);
  return (
    <div className="bg-paper-3 border rounded-xl p-4 space-y-3">
      <div className="flex gap-2">
        <input type="number" className="border rounded-lg px-2 py-1 w-24" value={year} onChange={(e) => setYear(Number(e.target.value))} />
        <input type="number" min={1} max={12} className="border rounded-lg px-2 py-1 w-20" value={month} onChange={(e) => setMonth(Number(e.target.value))} />
      </div>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-muted"><th>Teacher</th><th>Absences</th><th>Covers given</th><th>Covers received</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.teacher_id} className="border-t">
              <td className="py-1">{r.teacher}</td><td>{r.absences}</td><td>{r.covers_given}</td><td>{r.covers_received}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
