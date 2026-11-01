import { useEffect, useState, FormEvent } from "react";
import { api } from "../api";
import { isTeachingPeriod, periodOnDay, periodTimeRange, periodTypeLabel } from "../periods";
import { currentYearId, notifyCatalog, onYearChange, setCurrentYearId, timetablesUrl } from "../year";
import { IconButton } from "../ui/icons";
import { useToast } from "../ui/Toast";
import BellTimesEditor from "./timetable/BellTimesEditor";
import PageHelp from "../ui/PageHelp";
import ErrorBanner from "../ui/ErrorBanner";
import { chipStyle } from "../ui/colors";
import { inputClass } from "../ui/SearchSelect";
import { shortFromName } from "../ui/shortName";

function apiError(e: any): string {
  const d = e?.detail;
  if (typeof d === "string") return d;
  if (d && typeof d.detail === "string") return d.detail;
  return e?.message || "Request failed";
}

const emptyEdit = {
  name: "",
  description: "",
  status: "inactive",
  is_disabled: false,
  template_type: "weekly",
  period_count: 8,
  include_saturday: false,
  include_sunday: false,
};

export default function TimetablePage() {
  const [tts, setTts] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [versionId, setVersionId] = useState("");
  const [grid, setGrid] = useState<any>(null);
  const toast = useToast();
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [periodBusy, setPeriodBusy] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [newYear, setNewYear] = useState("");
  const [yearShort, setYearShort] = useState("");
  const [yearShortTouched, setYearShortTouched] = useState(false);
  const [yearSaving, setYearSaving] = useState(false);
  const [years, setYears] = useState<any[]>([]);
  const [form, setForm] = useState({
    name: "",
    description: "",
    period_count: 8,
    include_saturday: false,
    include_sunday: false,
  });
  const [edit, setEdit] = useState(emptyEdit);
  const [previewReady, setPreviewReady] = useState(false);
  const [savingTimes, setSavingTimes] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: "delete" | "purge" | "clone"; id: string; name: string } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [clonePlan, setClonePlan] = useState(false);
  const [check, setCheck] = useState<any>(null);
  const [checkBusy, setCheckBusy] = useState("");

  const selected = tts.find((t) => t.id === selectedId);
  const deleted = !!selected?.is_deleted;

  async function loadTemplates() {
    const t = await api<any[]>(timetablesUrl(undefined, showDeleted));
    setTts(t);
    setSelectedId((prev) => {
      if (prev && t.some((x) => x.id === prev)) return prev;
      return t.find((x) => !x.is_deleted)?.id || t[0]?.id || "";
    });
  }

  async function loadYears() {
    const catalog = await api<{ academic_years?: any[] }>("/v1/catalog");
    setYears(catalog.academic_years || []);
  }

  useEffect(() => {
    loadTemplates();
    loadYears().catch((e) => setErr(apiError(e)));
    return onYearChange(() => {
      loadTemplates();
      loadYears().catch(() => undefined);
    });
  }, [showDeleted]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!updating) setEditOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [updating]);

  useEffect(() => {
    setPreviewReady(false);
    setGrid(null);
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setVersionId("");
      return;
    }
    const t = tts.find((x) => x.id === selectedId);
    const pub = t?.versions?.find((v: any) => v.status === "published");
    const next = pub?.id || t?.versions?.slice(-1)[0]?.id || "";
    setVersionId(next);
  }, [selectedId, tts]);

  useEffect(() => {
    if (versionId && !deleted && previewReady) {
      api(`/v1/designer/versions/${versionId}`).then(setGrid).catch(() => setGrid(null));
    } else if (!previewReady) {
      setGrid(null);
    }
  }, [versionId, deleted, previewReady]);

  async function createTemplate(e: React.FormEvent) {
    e.preventDefault();
    const yearId = currentYearId();
    if (!yearId) {
      setErr("Select an academic year first.");
      return;
    }
    if (!form.name.trim()) {
      setErr("Enter a template name.");
      return;
    }
    setSaving(true);
    setErr("");
    try {
      const created = await api("/v1/timetables", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim() || null,
          academic_year_id: yearId,
          period_count: Number(form.period_count) || 8,
          include_saturday: form.include_saturday,
          include_sunday: form.include_sunday,
        }),
      });
      setForm({ name: "", description: "", period_count: 8, include_saturday: false, include_sunday: false });
      await loadTemplates();
      setSelectedId(created.id);
      toast(`Created template “${created.name}”.`);
    } catch (e: any) {
      setErr(apiError(e));
    } finally {
      setSaving(false);
    }
  }

  async function saveTemplate(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || deleted) return;
    if (!edit.name.trim()) {
      setErr("Enter a template name.");
      return;
    }
    setUpdating(true);
    setErr("");
    try {
      const saved = await api(`/v1/timetables/${selectedId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: edit.name.trim(),
          description: edit.description.trim() || null,
          status: edit.status,
          is_disabled: edit.is_disabled,
          template_type: edit.template_type,
          period_count: Number(edit.period_count) || 1,
          include_saturday: edit.include_saturday,
          include_sunday: edit.include_sunday,
        }),
      });
      setEditOpen(false);
      setPreviewReady(false);
      await loadTemplates();
      toast("Template saved.");
    } catch (e: any) {
      setErr(apiError(e));
    } finally {
      setUpdating(false);
    }
  }

  function openEdit(t: any) {
    setSelectedId(t.id);
    setEdit({
      name: t.name || "",
      description: t.description || "",
      status: t.status || "inactive",
      is_disabled: !!t.is_disabled,
      template_type: t.template_type || "weekly",
      period_count: t.teaching_count ?? t.period_count ?? 8,
      include_saturday: !!t.include_saturday,
      include_sunday: !!t.include_sunday,
    });
    setEditOpen(true);
    setErr("");
  }

  function askDelete(id: string) {
    const row = tts.find((t) => t.id === id);
    if (!row || row.is_deleted) return;
    setConfirm({ kind: "delete", id, name: row.name });
  }

  function askPurge(id: string) {
    const row = tts.find((t) => t.id === id);
    if (!row) return;
    setConfirm({ kind: "purge", id, name: row.name });
  }

  function askClone(id: string) {
    const row = tts.find((t) => t.id === id);
    if (!row || row.is_deleted) return;
    setClonePlan(false);
    setConfirm({ kind: "clone", id, name: row.name });
  }

  async function runConfirm() {
    if (!confirm) return;
    setConfirmBusy(true);
    setErr("");
    try {
      if (confirm.kind === "delete") {
        await api(`/v1/timetables/${confirm.id}`, { method: "DELETE" });
        setEditOpen(false);
        if (!showDeleted && selectedId === confirm.id) setSelectedId("");
        await loadTemplates();
        toast(`Deleted “${confirm.name}”. Restore it with Show deleted.`);
      } else if (confirm.kind === "purge") {
        await api(`/v1/timetables/${confirm.id}/purge`, { method: "DELETE" });
        if (selectedId === confirm.id) setSelectedId("");
        await loadTemplates();
        toast(`Permanently removed “${confirm.name}”.`);
      } else {
        const created = await api(`/v1/timetables/${confirm.id}/clone`, {
          method: "POST",
          body: JSON.stringify({ include_plan: clonePlan }),
        });
        await loadTemplates();
        setSelectedId(created.id);
        toast(`Cloned as “${created.name}”.`);
      }
      setConfirm(null);
    } catch (e: any) {
      setErr(apiError(e));
    } finally {
      setConfirmBusy(false);
    }
  }

  async function runCheck(id: string) {
    setCheckBusy(id);
    setErr("");
    try {
      setCheck(await api(`/v1/timetables/${id}/integrity`));
    } catch (e: any) {
      setErr(apiError(e));
    } finally {
      setCheckBusy("");
    }
  }

  async function restoreTemplate(id?: string) {
    const tid = id || selectedId;
    const row = tts.find((t) => t.id === tid);
    if (!tid || !row) return;
    setErr("");
    try {
      await api(`/v1/timetables/${tid}/restore`, { method: "POST" });
      await loadTemplates();
      setSelectedId(tid);
      toast(`Restored “${row.name}”.`);
    } catch (e: any) {
      setErr(apiError(e));
    }
  }

  async function refreshTemplate() {
    await loadTemplates();
  }

  async function saveTimes() {
    if (!selectedId || deleted) return;
    setSavingTimes(true);
    setErr("");
    try {
      await refreshTemplate();
      setPreviewReady(true);
      toast("Times saved. The weekly timetable is below.");
    } catch (e: any) {
      setErr(apiError(e));
    } finally {
      setSavingTimes(false);
    }
  }

  async function insertBreak(afterPeriodId: string | null, periodType: string) {
    if (!selectedId) return;
    setPeriodBusy(periodType + (afterPeriodId || "end"));
    setErr("");
    try {
      await api(`/v1/timetables/${selectedId}/periods`, {
        method: "POST",
        body: JSON.stringify({ period_type: periodType, after_period_id: afterPeriodId }),
      });
      setPreviewReady(false);
      await refreshTemplate();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setPeriodBusy("");
    }
  }

  async function patchPeriod(pid: string, body: Record<string, string>) {
    setErr("");
    try {
      await api(`/v1/periods/${pid}`, { method: "PATCH", body: JSON.stringify(body) });
      setPreviewReady(false);
      await refreshTemplate();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function patchDayTimes(dayId: string, periodId: string, body: { start_time?: string; end_time?: string }) {
    setErr("");
    try {
      await api(`/v1/days/${dayId}/times`, {
        method: "PATCH",
        body: JSON.stringify({ times: { [periodId]: body } }),
      });
      await refreshTemplate();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function removePeriod(pid: string) {
    if (!window.confirm("Remove this period from the template? Lessons cannot sit on it after it is gone.")) return;
    setErr("");
    try {
      await api(`/v1/periods/${pid}`, { method: "DELETE" });
      setPreviewReady(false);
      await refreshTemplate();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function saveTimetable() {
    try {
      await api(`/v1/save/${versionId}`, { method: "POST" });
      toast("Saved in this timetable file.");
      loadTemplates();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  const cellMap: Record<string, any[]> = {};
  (grid?.allocations || []).forEach((a: any) => {
    (cellMap[`${a.day_id}|${a.period_id}`] ||= []).push(a);
  });

  async function addYear(e: FormEvent) {
    e.preventDefault();
    const name = newYear.trim();
    if (!name) return;
    setErr("");
    setYearSaving(true);
    try {
      const created = await api<{ id: string }>("/v1/years", {
        method: "POST",
        body: JSON.stringify({ name, short_name: yearShort, is_current: years.length === 0 }),
      });
      setNewYear("");
      setYearShort("");
      setYearShortTouched(false);
      if (created?.id) setCurrentYearId(created.id);
      notifyCatalog();
      await loadYears();
    } catch (error: any) {
      setErr(error.message || "Could not add year");
    } finally {
      setYearSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-64 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold whitespace-nowrap">Timetable templates</h1>
            <PageHelp page="templates" />
          </div>
          <p className="text-slate-500 text-sm mt-1 max-w-xl">
            Create bell-time templates here. Deleting a template hides it from Construct; it can be restored.
          </p>
        </div>
        <form onSubmit={addYear} className="flex shrink-0 gap-2 items-end">
            <label className="text-xs text-slate-500 w-36 shrink-0">
              New academic year
              <input
                className={`${inputClass} mt-1 h-10`}
                value={newYear}
                placeholder="2026-27"
                aria-label="New academic year"
                onChange={(e) => {
                  const name = e.target.value.toUpperCase();
                  setNewYear(name);
                  if (!yearShortTouched) setYearShort(shortFromName(name, years.map((y: any) => y.short_name)));
                }}
                required
              />
            </label>
            <label className="text-xs text-slate-500 w-28 shrink-0">
              Short
              <input
                className={`${inputClass} mt-1 h-10`}
                value={yearShort}
                placeholder="Short"
                aria-label="Academic year short name"
                maxLength={16}
                onChange={(e) => {
                  setYearShortTouched(true);
                  setYearShort(e.target.value.toUpperCase());
                }}
              />
            </label>
            <button
              type="submit"
              disabled={yearSaving}
              className="h-10 px-3 bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-50"
            >
              Add year
            </button>
        </form>
      </header>
      <ErrorBanner message={err} onClear={() => setErr("")} />

      <form onSubmit={createTemplate} className="bg-white border rounded-lg p-4 grid gap-3 md:grid-cols-6 items-end">
        <label className="text-sm md:col-span-2">
          New template
          <input
            className="mt-1 w-full border rounded px-2 py-1"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Main school"
          />
        </label>
        <label className="text-sm md:col-span-2">
          Description
          <input
            className="mt-1 w-full border rounded px-2 py-1"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </label>
        <label className="text-sm">
          Periods
          <input
            type="number"
            min={1}
            max={20}
            className="mt-1 w-full border rounded px-2 py-1"
            value={form.period_count}
            onChange={(e) => setForm({ ...form, period_count: Number(e.target.value) })}
          />
        </label>
        <div className="flex flex-col gap-1 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.include_saturday}
              onChange={(e) => setForm({ ...form, include_saturday: e.target.checked })}
            />
            Saturday
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.include_sunday}
              onChange={(e) => setForm({ ...form, include_sunday: e.target.checked })}
            />
            Sunday
          </label>
        </div>
        <button type="submit" disabled={saving} className="border rounded px-3 py-1.5 text-sm md:col-span-6 justify-self-start">
          {saving ? "Creating…" : "Create template"}
        </button>
      </form>

      <section className="bg-white border rounded-lg overflow-auto">
        <div className="flex items-center justify-between px-3 py-2 border-b bg-slate-50">
          <span className="text-sm font-medium text-slate-700">Templates</span>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
            Show deleted
          </label>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="p-2">Name</th>
              <th className="p-2">Source</th>
              <th className="p-2">Status</th>
              <th className="p-2">Days</th>
              <th className="p-2">Periods</th>
              <th className="p-2">Versions</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {tts.length === 0 && (
              <tr>
                <td className="p-3 text-slate-500" colSpan={7}>
                  {showDeleted
                    ? "No templates (including deleted) for this year."
                    : "No templates for this year yet. Create one above."}
                </td>
              </tr>
            )}
            {tts.map((t) => (
              <tr
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className={`border-t cursor-pointer ${selectedId === t.id ? "bg-indigo-50" : "hover:bg-slate-50"} ${t.is_deleted ? "text-slate-400" : ""}`}
              >
                <td className="p-2">
                  <div className={`font-medium ${t.is_deleted ? "line-through" : ""}`}>{t.name}</div>
                  {t.description && <div className="text-xs text-slate-500">{t.description}</div>}
                </td>
                <td className="p-2 text-xs uppercase">{t.source}</td>
                <td className="p-2">
                  {t.is_deleted ? (
                    <span className="text-xs bg-red-100 text-red-800 rounded px-1.5 py-0.5">Deleted</span>
                  ) : (
                    <>
                      {t.status}
                      {t.is_disabled ? " · disabled" : ""}
                    </>
                  )}
                </td>
                <td className="p-2">{t.day_count}</td>
                <td className="p-2">
                  {t.teaching_count ?? t.period_count}
                  {(t.break_count || 0) > 0 ? <span className="text-slate-500"> + {t.break_count} breaks</span> : ""}
                </td>
                <td className="p-2">{t.versions?.length || 0}</td>
                <td className="p-1 text-right whitespace-nowrap w-36" onClick={(e) => e.stopPropagation()}>
                  {t.is_deleted ? (
                    <div className="inline-flex">
                      <IconButton icon="restore" label="Restore template" onClick={() => restoreTemplate(t.id)} />
                      <IconButton icon="trash" label="Delete permanently" variant="danger" onClick={() => askPurge(t.id)} />
                    </div>
                  ) : (
                    <div className="inline-flex">
                      <IconButton icon="edit" label="Template settings" onClick={() => openEdit(t)} />
                      <IconButton icon="copy" label="Clone template" onClick={() => askClone(t.id)} />
                      <IconButton icon="check" label="Integrity check" onClick={() => runCheck(t.id)} disabled={checkBusy === t.id} />
                      <IconButton icon="trash" label="Delete template" variant="danger" onClick={() => askDelete(t.id)} />
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {editOpen && selected && !deleted && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-auto" onClick={() => !updating && setEditOpen(false)}>
          <form
            onSubmit={saveTemplate}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-xl shadow-xl border w-full max-w-lg mt-16 p-5 space-y-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Template settings</h2>
                <p className="text-sm text-slate-500">Name, days, and teaching period count. Breaks stay as they are.</p>
              </div>
              <IconButton icon="close" label="Close" onClick={() => setEditOpen(false)} />
            </div>
            <ErrorBanner message={err} onClear={() => setErr("")} />
            <label className="block text-sm">
              Name
              <input
                className="mt-1 w-full border rounded-lg px-3 py-2"
                value={edit.name}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              />
            </label>
            <label className="block text-sm">
              Description
              <input
                className="mt-1 w-full border rounded-lg px-3 py-2"
                value={edit.description}
                onChange={(e) => setEdit({ ...edit, description: e.target.value })}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">
                Status
                <select
                  className="mt-1 w-full border rounded-lg px-3 py-2"
                  value={edit.status}
                  onChange={(e) => setEdit({ ...edit, status: e.target.value })}
                >
                  <option value="inactive">Inactive</option>
                  <option value="active">Active</option>
                  <option value="draft">Draft</option>
                </select>
              </label>
              <label className="text-sm">
                Type
                <select
                  className="mt-1 w-full border rounded-lg px-3 py-2"
                  value={edit.template_type}
                  onChange={(e) => setEdit({ ...edit, template_type: e.target.value })}
                >
                  <option value="weekly">Weekly</option>
                  <option value="cycle">Cycle</option>
                </select>
              </label>
            </div>
            <div className="border rounded-lg p-3">
              <div className="text-sm font-medium">Teaching periods</div>
              <p className="text-xs text-slate-500 mt-0.5 mb-2">Increase appends a new period at the end of the day. Decrease removes the last teaching period if it has no lessons.</p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="w-9 h-9 border rounded-lg text-lg hover:bg-slate-50 disabled:opacity-40"
                  disabled={edit.period_count <= 1}
                  onClick={() => setEdit({ ...edit, period_count: Math.max(1, edit.period_count - 1) })}
                  aria-label="Decrease periods"
                >
                  −
                </button>
                <input
                  type="number"
                  min={1}
                  max={20}
                  className="w-16 text-center border rounded-lg px-2 py-1.5"
                  value={edit.period_count}
                  onChange={(e) => setEdit({ ...edit, period_count: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })}
                />
                <button
                  type="button"
                  className="w-9 h-9 border rounded-lg text-lg hover:bg-slate-50 disabled:opacity-40"
                  disabled={edit.period_count >= 20}
                  onClick={() => setEdit({ ...edit, period_count: Math.min(20, edit.period_count + 1) })}
                  aria-label="Increase periods"
                >
                  +
                </button>
                {(selected.break_count || 0) > 0 && (
                  <span className="text-xs text-slate-500">+ {selected.break_count} break{selected.break_count === 1 ? "" : "s"} kept</span>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={edit.include_saturday}
                  onChange={(e) => setEdit({ ...edit, include_saturday: e.target.checked })}
                />
                Saturday
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={edit.include_sunday}
                  onChange={(e) => setEdit({ ...edit, include_sunday: e.target.checked })}
                />
                Sunday
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={edit.is_disabled}
                  onChange={(e) => setEdit({ ...edit, is_disabled: e.target.checked })}
                />
                Disabled (hidden from default grid pick)
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="border rounded-lg px-3 py-1.5 text-sm" onClick={() => setEditOpen(false)}>
                Cancel
              </button>
              <button type="submit" disabled={updating} className="bg-indigo-600 text-white rounded-lg px-3 py-1.5 text-sm disabled:opacity-60">
                {updating ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </div>
      )}

      {confirm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4" onClick={() => !confirmBusy && setConfirm(null)}>
          <div className="bg-white rounded-xl shadow-xl border w-full max-w-md mt-24 p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold">
                {confirm.kind === "clone" ? "Clone template" : confirm.kind === "purge" ? "Delete permanently" : "Delete template"}
              </h2>
              <IconButton icon="close" label="Close" onClick={() => setConfirm(null)} />
            </div>
            {confirm.kind === "clone" ? (
              <>
                <p className="text-sm text-slate-600">
                  Creates “{confirm.name} copy” with the same days and bell times. The original stays as it is.
                </p>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={clonePlan} onChange={(e) => setClonePlan(e.target.checked)} />
                  Also copy the latest placements onto the new template
                </label>
              </>
            ) : confirm.kind === "purge" ? (
              <p className="text-sm text-slate-600">
                Permanently remove “{confirm.name}” and its drafts. This cannot be undone.
              </p>
            ) : (
              <p className="text-sm text-slate-600">
                Hide “{confirm.name}” from Construct. You can restore it later from Show deleted.
              </p>
            )}
            <ErrorBanner message={err} onClear={() => setErr("")} />
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="border rounded-lg px-3 py-1.5 text-sm" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={confirmBusy}
                className={`rounded-lg px-3 py-1.5 text-sm text-white disabled:opacity-60 ${confirm.kind === "clone" ? "bg-indigo-600" : "bg-red-600"}`}
                onClick={runConfirm}
              >
                {confirmBusy
                  ? "Working…"
                  : confirm.kind === "clone"
                    ? "Clone"
                    : confirm.kind === "purge"
                      ? "Delete permanently"
                      : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {check && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4" onClick={() => setCheck(null)}>
          <div className="bg-white rounded-xl shadow-xl border w-full max-w-lg mt-24 p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Integrity check</h2>
                <p className="text-sm text-slate-500">
                  {check.template_name}
                  {check.version_label ? ` · ${check.version_label}` : ""}
                </p>
              </div>
              <IconButton icon="close" label="Close" onClick={() => setCheck(null)} />
            </div>
            <div className={`rounded-lg border px-3 py-2 text-sm ${check.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>
              {check.ok ? (check.warn_count ? "No hard errors. Review the warnings." : "No clashes or missing setup.") : check.summary}
            </div>
            {(check.issues || []).length === 0 ? (
              <p className="text-sm text-slate-500">Bells, lessons, and placements look consistent.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {check.issues.map((i: any, idx: number) => (
                  <li key={`${i.code}-${idx}`} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                    <span className={`text-[10px] uppercase font-semibold mr-2 ${i.severity === "error" ? "text-red-700" : "text-amber-700"}`}>
                      {i.severity}
                    </span>
                    {i.message}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end">
              <button type="button" className="border rounded-lg px-3 py-1.5 text-sm" onClick={() => setCheck(null)}>
                Clear
              </button>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <>
          {deleted && (
            <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg px-4 py-3 text-sm flex items-center justify-between gap-3">
              <span>This template is deleted. Restore it to edit periods or use it in Designer and Generate.</span>
              <IconButton icon="restore" label="Restore template" variant="bordered" className="bg-white border-red-200 text-red-800 hover:bg-red-50" onClick={() => restoreTemplate()} />
            </div>
          )}
          <header>
            <h2 className="text-lg font-semibold">{selected.name}</h2>
            <p className="text-slate-500 text-sm">
              {previewReady
                ? "Draft → approve → publish. Substitutions bind to the published version."
                : "Set period times and breaks first, then save to open the weekly timetable."}
            </p>
          </header>

          {!deleted && (
            <BellTimesEditor
              periods={selected.periods || []}
              days={selected.days || []}
              periodBusy={periodBusy}
              savingTimes={savingTimes}
              onSaveTimes={saveTimes}
              onPatchPeriod={patchPeriod}
              onPatchDayTimes={patchDayTimes}
              onRemovePeriod={removePeriod}
            />
          )}

          {previewReady && (
            <>
          <header className="flex justify-between items-center">
            <div>
              <h3 className="text-base font-semibold">Weekly timetable</h3>
              <p className="text-slate-500 text-sm">Draft → approve → publish. Substitutions bind to the published version.</p>
            </div>
            <div className="flex gap-2">
              <select className="border rounded px-2 py-1 text-sm" value={versionId} onChange={(e) => setVersionId(e.target.value)} disabled={deleted}>
                {(selected.versions || []).map((v: any) => (
                  <option key={v.id} value={v.id}>{selected.name} v{v.number} ({v.status})</option>
                ))}
              </select>
              <button disabled={deleted} onClick={() => api(`/v1/versions/${versionId}/approve`, { method: "POST" })} className="border rounded px-3 py-1 text-sm disabled:opacity-50">Approve</button>
              <button disabled={deleted} onClick={saveTimetable} className="bg-indigo-600 text-white rounded px-3 py-1 text-sm disabled:opacity-50">Save</button>
              <button disabled={deleted || !selectedId} onClick={() => runCheck(selectedId)} className="border rounded px-3 py-1 text-sm disabled:opacity-50">Check</button>
              <IconButton icon="view" label="View timetable" variant="bordered" href={`/v1/reports/timetable.html?version_id=${versionId}`} target="_blank" rel="noreferrer" />
              <IconButton icon="print" label="Print" variant="bordered" href={`/v1/reports/timetable.html?version_id=${versionId}`} target="_blank" rel="noreferrer" />
            </div>
          </header>
          <div className="bg-white border rounded-lg overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th className="p-2 border">Period</th>
                  {grid?.days?.map((d: any) => <th key={d.id} className="p-2 border">{d.name.slice(0, 3)}</th>)}
                </tr>
              </thead>
              <tbody>
                {grid?.periods?.map((p: any) => {
                  const teaching = isTeachingPeriod(p);
                  if (!teaching) {
                    return (
                      <tr key={p.id} className="bg-amber-50">
                        <td className="p-2 border bg-amber-50 font-medium text-amber-900">{p.name}</td>
                        {grid.days.map((d: any) => (
                          <td key={d.id} className="p-2 border text-center text-amber-800 italic align-top">
                            <div className="text-[11px] font-semibold tabular-nums not-italic text-amber-800">
                              {periodTimeRange(periodOnDay(p, d))}
                            </div>
                            {periodTypeLabel(p.period_type)} · not allocated
                          </td>
                        ))}
                      </tr>
                    );
                  }
                  return (
                    <tr key={p.id}>
                      <td className="p-2 border bg-slate-50">{p.name}</td>
                      {grid.days.map((d: any) => (
                        <td key={d.id} className="p-1 border align-top">
                          {periodTimeRange(periodOnDay(p, d)) && (
                            <div className="text-[10px] font-semibold tabular-nums text-slate-600 mb-0.5">
                              {periodTimeRange(periodOnDay(p, d))}
                            </div>
                          )}
                          {(cellMap[`${d.id}|${p.id}`] || []).map((a: any) => (
                            <div key={a.id} className="rounded px-1 mb-1" style={chipStyle(a.color)}>{a.short} {a.section}</div>
                          ))}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
