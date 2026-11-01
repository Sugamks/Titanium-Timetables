import { useState } from "react";
import { api } from "../../api";
import SearchSelect, { DateInput, Field, inputClass } from "../../ui/SearchSelect";
import { isoToDmy } from "../../ui/dates";
import { IconButton } from "../../ui/icons";

type Exemption = {
 id: string;
 teacher_id: string;
 kind: string;
 from_date?: string | null;
 to_date?: string | null;
 name?: string | null;
};

export default function ExemptionsPanel({
 teachers,
 exemptions,
 onChanged,
 onError,
 onMessage,
}: {
 teachers: { id: string; name: string }[];
 exemptions: Exemption[];
 onChanged: () => Promise<void> | void;
 onError: (m: string) => void;
 onMessage: (m: string) => void;
}) {
 const [teacherId, setTeacherId] = useState(teachers[0]?.id || "");
 const [kind, setKind] = useState("full");
 const [fromDate, setFromDate] = useState("");
 const [toDate, setToDate] = useState("");
 const [saving, setSaving] = useState(false);

 async function add() {
 if (!teacherId) return;
 setSaving(true);
 try {
 await api("/v1/operations/exemptions", {
 method: "POST",
 body: JSON.stringify({
 teacher_id: teacherId,
 kind,
 from_date: fromDate || null,
 to_date: toDate || null,
 }),
 });
 onMessage("Teacher exempted");
 setFromDate("");
 setToDate("");
 await onChanged();
 } catch (e: any) {
 onError(e.message);
 } finally {
 setSaving(false);
 }
 }

 async function remove(id: string) {
 try {
 await api(`/v1/operations/exemptions/${id}`, { method: "DELETE" });
 onMessage("Exemption removed");
 await onChanged();
 } catch (e: any) {
 onError(e.message);
 }
 }

 return (
 <div className="space-y-4">
 <section className="bg-white border rounded-lg p-4">
 <h2 className="font-medium mb-3">Add exemption</h2>
 <div className="grid md:grid-cols-5 gap-3 items-end">
 <SearchSelect
 label="Teacher"
 value={teacherId}
 onChange={setTeacherId}
 options={teachers.map((t) => ({ value: t.id, label: t.name }))}
 />
 <Field label="Type">
 <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value)}>
 <option value="full">Full exemption</option>
 <option value="partial">Partial exemption</option>
 </select>
 </Field>
 <Field label="From date">
 <DateInput value={fromDate} onChange={setFromDate} />
 </Field>
 <Field label="To date">
 <DateInput value={toDate} onChange={setToDate} />
 </Field>
 <button
 type="button"
 disabled={saving || !teacherId}
 onClick={add}
 className="bg-slate-900 text-white rounded-lg px-3 py-2 text-sm disabled:opacity-50"
 >
 Exemp teacher
 </button>
 </div>
 </section>
 <section className="bg-white border rounded-lg overflow-hidden">
 <table className="w-full text-sm">
 <thead className="bg-slate-50 text-left text-slate-500">
 <tr>
 <th className="px-3 py-2 font-medium">Staff</th>
 <th className="px-3 py-2 font-medium">Type</th>
 <th className="px-3 py-2 font-medium">From</th>
 <th className="px-3 py-2 font-medium">To</th>
 <th className="px-3 py-2 font-medium w-12"></th>
 </tr>
 </thead>
 <tbody>
 {exemptions.map((row) => (
 <tr key={row.id} className="border-t">
 <td className="px-3 py-2">{row.name}</td>
 <td className="px-3 py-2 capitalize">{row.kind}</td>
 <td className="px-3 py-2">{isoToDmy(row.from_date) || "—"}</td>
 <td className="px-3 py-2">{isoToDmy(row.to_date) || "—"}</td>
 <td className="px-3 py-2">
 <IconButton icon="close" label="Remove exemption" onClick={() => remove(row.id)} />
 </td>
 </tr>
 ))}
 {exemptions.length === 0 && (
 <tr>
 <td colSpan={5} className="px-3 py-8 text-center text-slate-400">
 No exempted staff
 </td>
 </tr>
 )}
 </tbody>
 </table>
 </section>
 </div>
 );
}
