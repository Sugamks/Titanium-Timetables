import { useEffect, useMemo, useState } from "react";
import { api } from "../api";

function SearchSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
  allowEmpty,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  allowEmpty?: boolean;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const matches = needle
      ? options.filter((o) => o.label.toLowerCase().includes(needle))
      : options;
    const sliced = matches.slice(0, 200);
    if (value && !sliced.some((o) => o.value === value)) {
      const current = options.find((o) => o.value === value);
      if (current) return [current, ...sliced];
    }
    return sliced;
  }, [options, q, value]);
  return (
    <label className="text-sm">
      {label}
      <input
        className="mt-1 w-full border rounded px-2 py-1 text-sm"
        placeholder={placeholder || "Search…"}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <select className="mt-1 w-full border rounded px-2 py-1" value={value} onChange={(e) => onChange(e.target.value)}>
        {allowEmpty && <option value="">None</option>}
        {filtered.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

const YEAR_KEY = "sched_year_id";

function pickDefaultYear(years: any[], sections: any[]): string {
  const withSections = new Set((sections || []).map((s: any) => s.academic_year_id).filter(Boolean));
  const now = new Date();
  const start = now.getMonth() >= 5 ? now.getFullYear() : now.getFullYear() - 1;
  const label = `${start}-${String(start + 1).slice(-2)}`;
  const byName = (years || []).find((y: any) => y.name === label && withSections.has(y.id));
  if (byName) return byName.id;
  const sorted = [...(years || [])].filter((y: any) => withSections.has(y.id)).sort((a: any, b: any) => String(b.name).localeCompare(String(a.name)));
  return sorted[0]?.id || years?.[0]?.id || "";
}

export default function SchedulingPage() {
  const [catalog, setCatalog] = useState<any>(null);
  const [lessons, setLessons] = useState<any[]>([]);
  const [workload, setWorkload] = useState<any[]>([]);
  const [yearId, setYearId] = useState("");
  const [form, setForm] = useState({
    subject_id: "",
    section_id: "",
    teacher_resource_id: "",
    frequency_per_week: 5,
    duration_periods: 1,
  });
  const [err, setErr] = useState("");
  const [syncMsg, setSyncMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [importingSubjects, setImportingSubjects] = useState(false);

  async function load() {
    const [c, l, w] = await Promise.all([api("/v1/catalog"), api("/v1/lessons"), api("/v1/workload")]);
    setCatalog(c);
    setLessons(l);
    setWorkload(w);
    setYearId((prev) => {
      const years = c.academic_years || [];
      const sections = c.sections || [];
      const withData = new Set(sections.map((s: any) => s.academic_year_id).filter(Boolean));
      for (const s of c.subjects || []) {
        for (const yid of s.academic_year_ids || []) withData.add(yid);
      }
      if (prev && withData.has(prev)) return prev;
      const stored = localStorage.getItem(YEAR_KEY) || "";
      if (stored && withData.has(stored)) return stored;
      return pickDefaultYear(years, sections);
    });
    setForm((f) => ({
      ...f,
      teacher_resource_id: f.teacher_resource_id || c.teachers[0]?.resource_id || "",
    }));
  }

  useEffect(() => {
    load().catch((e) => setErr(e.message));
  }, []);

  const years = catalog?.academic_years || [];
  const yearSections = useMemo(() => {
    const all = catalog?.sections || [];
    if (!yearId) return all;
    return all.filter((s: any) => s.academic_year_id === yearId);
  }, [catalog, yearId]);
  const yearSubjects = useMemo(() => {
    const all = catalog?.subjects || [];
    if (!yearId) return all;
    const linked = all.filter((s: any) => (s.academic_year_ids || []).includes(yearId));
    return linked.length ? linked : all;
  }, [catalog, yearId]);
  const yearLessons = useMemo(() => {
    if (!yearId) return lessons;
    const ids = new Set(yearSections.map((s: any) => s.id));
    return lessons.filter((l) => l.section_id && ids.has(l.section_id));
  }, [lessons, yearId, yearSections]);
  const yearWorkload = useMemo(() => {
    if (!yearId) return workload;
    const names = new Set(yearLessons.flatMap((l) => l.teachers || []));
    return workload.filter((w) => names.has(w.name));
  }, [workload, yearId, yearLessons]);

  useEffect(() => {
    if (yearId) localStorage.setItem(YEAR_KEY, yearId);
    setForm((f) => ({
      ...f,
      subject_id: yearSubjects.some((s: any) => s.id === f.subject_id) ? f.subject_id : yearSubjects[0]?.id || "",
      section_id: yearSections.some((s: any) => s.id === f.section_id) ? f.section_id : yearSections[0]?.id || "",
    }));
  }, [yearId, yearSubjects, yearSections]);

  async function createLesson(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (!form.subject_id || !form.section_id || !form.teacher_resource_id) {
      setErr("Choose a subject, section, and teacher.");
      return;
    }
    setSaving(true);
    try {
      const grid = catalog?.time_grids?.[0];
      await api("/v1/lessons", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          time_grid_id: grid?.id,
          week_pattern_id: catalog.week_patterns.find((p: any) => p.code === "ALL")?.id,
        }),
      });
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function removeLesson(id: string) {
    if (!window.confirm("Remove this lesson from the scheduling database? This does not change ERP.")) return;
    setErr("");
    try {
      await api(`/v1/lessons/${id}`, { method: "DELETE" });
      await load();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function syncErp() {
    setErr("");
    setSyncMsg("Syncing from ERP MySQL…");
    try {
      const r = await api("/v1/sync/erp/pull", { method: "POST" });
      if (!r.ok) {
        setSyncMsg("");
        setErr(r.error || "ERP sync failed");
        return;
      }
      const t = r.totals || {};
      const f = r.fetched || {};
      setSyncMsg(
        `Pulled from ${r.source}: ${f.teachers ?? 0} staff, ${f.sections ?? 0} sections, ${f.subjects ?? 0} subjects. ` +
          `Saved totals: ${t.teachers ?? 0} teachers, ${t.sections ?? 0} sections, ${t.subjects ?? 0} subjects ` +
          `(${r.created?.teachers ?? 0} new teachers).`
      );
      await load();
    } catch (e: any) {
      setSyncMsg("");
      setErr(e.message);
    }
  }

  async function importSubjects() {
    setErr("");
    setSyncMsg("Importing subjects from ERP…");
    setImportingSubjects(true);
    try {
      const r = await api("/v1/sync/erp/subjects", { method: "POST" });
      if (!r.ok) {
        setSyncMsg("");
        setErr(r.error || "Subject import failed");
        return;
      }
      setSyncMsg(
        `Imported subjects from ${r.source}.${r.source_table}: fetched ${r.fetched ?? 0}, ` +
          `${r.created ?? 0} new, ${r.updated ?? 0} updated, total ${r.total ?? 0}` +
          (r.year_links != null ? `, ${r.year_links} year links.` : ".")
      );
      await load();
    } catch (e: any) {
      setSyncMsg("");
      setErr(e.message);
    } finally {
      setImportingSubjects(false);
    }
  }

  const subjectOpts = yearSubjects.map((s: any) => ({ value: s.id, label: s.name }));
  const sectionOpts = yearSections.map((s: any) => ({ value: s.id, label: s.name }));
  const teacherOpts = (catalog?.teachers || []).map((s: any) => ({ value: s.resource_id, label: s.name }));
  const yearName = years.find((y: any) => y.id === yearId)?.name || "";
  const yearsForFilter = years.filter(
    (y: any) =>
      y.id === yearId ||
      yearSections.some((s: any) => s.academic_year_id === y.id) ||
      (catalog?.sections || []).some((s: any) => s.academic_year_id === y.id) ||
      (catalog?.subjects || []).some((s: any) => (s.academic_year_ids || []).includes(y.id))
  );
  const yearOptions = yearsForFilter.length ? yearsForFilter : years;

  return (
    <div className="space-y-6">
      <header className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-semibold">Scheduling</h1>
          <p className="text-slate-500 text-sm">
            Filter by academic year so classes and subjects stay separate. Lessons stay in the scheduling database.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center justify-end">
          <button
            className="text-sm bg-indigo-600 text-white rounded px-3 py-1 disabled:opacity-50"
            onClick={importSubjects}
            disabled={importingSubjects}
          >
            {importingSubjects ? "Importing…" : "Import subjects from ERP"}
          </button>
          <button className="text-sm border rounded px-3 py-1" onClick={syncErp}>
            Sync ERP master data
          </button>
        </div>
      </header>
      {err && <p className="text-red-600 text-sm">{err}</p>}
      {syncMsg && <p className="text-emerald-700 text-sm">{syncMsg}</p>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ["Classes", yearSections.length],
          ["Subjects", yearSubjects.length],
          ["Teachers", catalog?.teachers?.length],
        ].map(([label, n]) => (
          <div key={String(label)} className="bg-white border rounded-lg p-3">
            <div className="text-xs text-slate-500">{label}</div>
            <div className="text-2xl font-semibold">{n ?? 0}</div>
          </div>
        ))}
      </div>

      <form onSubmit={createLesson} className="bg-white border rounded-lg p-4 grid md:grid-cols-6 gap-3 items-end">
        <SearchSelect
          label="Subject"
          value={form.subject_id}
          onChange={(subject_id) => setForm({ ...form, subject_id })}
          options={subjectOpts}
          placeholder="Search subjects"
        />
        <SearchSelect
          label="Section"
          value={form.section_id}
          onChange={(section_id) => setForm({ ...form, section_id })}
          options={sectionOpts}
          placeholder="Search sections"
        />
        <SearchSelect
          label="Teacher"
          value={form.teacher_resource_id}
          onChange={(teacher_resource_id) => setForm({ ...form, teacher_resource_id })}
          options={teacherOpts}
          placeholder="Search teachers"
        />
        <label className="text-sm">
          Periods / week
          <input
            type="number"
            min={1}
            className="mt-1 w-full border rounded px-2 py-1"
            value={form.frequency_per_week}
            onChange={(e) => setForm({ ...form, frequency_per_week: Number(e.target.value) })}
          />
        </label>
        <label className="text-sm">
          Duration
          <input
            type="number"
            min={1}
            className="mt-1 w-full border rounded px-2 py-1"
            value={form.duration_periods}
            onChange={(e) => setForm({ ...form, duration_periods: Number(e.target.value) })}
          />
        </label>
        <button disabled={saving} className="bg-indigo-600 text-white rounded px-3 py-2 text-sm disabled:opacity-50">
          {saving ? "Saving…" : "Add lesson"}
        </button>
      </form>

      <div className="grid lg:grid-cols-2 gap-6">
        <section className="bg-white border rounded-lg overflow-hidden">
          <h2 className="px-4 py-3 font-medium border-b">Lessons{yearName ? ` · ${yearName}` : ""}</h2>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="p-2">Subject</th>
                <th className="p-2">Section</th>
                <th className="p-2">Teacher</th>
                <th className="p-2">Freq</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {yearLessons.length === 0 ? (
                <tr>
                  <td className="p-3 text-slate-500" colSpan={5}>No lessons for this academic year. Add one above.</td>
                </tr>
              ) : (
                yearLessons.map((l) => (
                  <tr key={l.id} className="border-t">
                    <td className="p-2">{l.subject}</td>
                    <td className="p-2">{l.section}</td>
                    <td className="p-2">{l.teachers?.join(", ")}</td>
                    <td className="p-2">{l.frequency_per_week}×{l.duration_periods}</td>
                    <td className="p-2 text-right">
                      <button className="text-red-600 text-xs" onClick={() => removeLesson(l.id)}>Remove</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
        <section className="bg-white border rounded-lg overflow-hidden">
          <h2 className="px-4 py-3 font-medium border-b">Teacher workload{yearName ? ` · ${yearName}` : ""}</h2>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="p-2">Teacher</th>
                <th className="p-2">Teaching</th>
                <th className="p-2">Contract</th>
                <th className="p-2">Util</th>
              </tr>
            </thead>
            <tbody>
              {yearWorkload.length === 0 ? (
                <tr>
                  <td className="p-3 text-slate-500" colSpan={4}>Workload appears after you add lessons for this year.</td>
                </tr>
              ) : (
                yearWorkload.map((w) => (
                  <tr key={w.resource_id} className="border-t">
                    <td className="p-2">{w.name}</td>
                    <td className="p-2">{w.teaching}</td>
                    <td className="p-2">{w.contract}</td>
                    <td className="p-2">{w.utilization}%</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
