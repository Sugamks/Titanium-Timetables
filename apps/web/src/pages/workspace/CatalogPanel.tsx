import { useState } from "react";
import { api } from "../../api";
import { SUBJECT_CATEGORIES, categoryLabel } from "../../subjectCategories";
import SearchSelect, { Field, inputClass } from "../../ui/SearchSelect";
import { DataList, DataPill, DataRow } from "../../ui/DataRow";
import ErrorBanner from "../../ui/ErrorBanner";
import { hexColor, nextSubjectColor } from "../../ui/colors";
import { useToast } from "../../ui/Toast";

function SubjectEditor({
  subject,
  subjects,
  saving,
  onSave,
}: {
  subject: any;
  subjects: any[];
  saving: boolean;
  onSave: (body: { name: string; short_name: string; color: string; category: string }) => Promise<void>;
}) {
  const [name, setName] = useState(subject.name || "");
  const [short, setShort] = useState(subject.short_name || "");
  const [shortTouched, setShortTouched] = useState(Boolean(subject.short_name));
  const [color, setColor] = useState(hexColor(subject.color));
  const [category, setCategory] = useState(subject.category || "other");

  function nextShort(value: string) {
    const words = value.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
    const taken = new Set(subjects.filter((row: any) => row.id !== subject.id).map((row: any) => String(row.short_name || "").toUpperCase()));
    const base = words.length >= 2 ? words.map((w) => w[0]).join("").slice(0, 8) : (words[0] || "").slice(0, 3);
    if (base && !taken.has(base)) return base;
    return short;
  }

  return (
    <form
      className="grid grid-cols-[minmax(0,1fr)_6rem_auto] gap-2 items-end"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ name, short_name: short, color, category });
      }}
    >
      <Field label="Subject">
        <input
          className={`${inputClass} h-10`}
          value={name}
          onChange={(e) => {
            const next = e.target.value.toUpperCase();
            setName(next);
            if (!shortTouched) setShort(nextShort(next));
          }}
          required
        />
      </Field>
      <Field label="Short">
        <input
          className={`${inputClass} h-10`}
          value={short}
          maxLength={16}
          onChange={(e) => {
            setShortTouched(true);
            setShort(e.target.value.toUpperCase());
          }}
          required
        />
      </Field>
      <Field label="Color">
        <input type="color" className="fill-color h-10 w-10 rounded-lg cursor-pointer" value={color} onChange={(e) => setColor(e.target.value)} />
      </Field>
      <div className="col-span-2 min-w-0">
        <SearchSelect
          label="Type"
          value={category}
          onChange={setCategory}
          options={SUBJECT_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
          placeholder="Type"
        />
      </div>
      <button disabled={saving} className="h-10 px-3 bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-50">
        Save
      </button>
    </form>
  );
}

export default function CatalogPanel({
  catalog,
  yearId,
  onChanged,
}: {
  catalog: any;
  yearId: string;
  onChanged: () => Promise<void> | void;
  onError: (m: string) => void;
}) {
  const toast = useToast();
  const [subject, setSubject] = useState(() => ({
    name: "",
    short_name: "",
    color: nextSubjectColor((catalog?.subjects || []).map((s: any) => s.color)),
    category: "other",
  }));
  const [shortTouched, setShortTouched] = useState(false);
  const [subjectError, setSubjectError] = useState("");
  const [saving, setSaving] = useState("");
  const [openSubjectId, setOpenSubjectId] = useState("");

  function shortFromName(name: string, used: string[] = []) {
    const words = name.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
    const taken = new Set(used.filter(Boolean).map((s) => s.toUpperCase()));
    const base = words.length >= 2 ? words.map((w) => w[0]).join("").slice(0, 8) : (words[0] || "").slice(0, 3);
    if (base && !taken.has(base)) return base;
    if (words.length >= 2) {
      const last = words[words.length - 1].slice(0, 3);
      if (last && !taken.has(last)) return last;
    }
    const letters = words.join("");
    for (let n = 3; n <= Math.min(8, letters.length); n++) {
      const cand = letters.slice(0, n);
      if (cand && !taken.has(cand)) return cand;
    }
    const stem = base || "SUB";
    let i = 2;
    while (taken.has(`${stem}${i}`)) i += 1;
    return `${stem}${i}`;
  }

  async function addSubject(e: React.FormEvent) {
    e.preventDefault();
    setSubjectError("");
    setSaving("subject");
    try {
      await api("/v1/subjects", {
        method: "POST",
        body: JSON.stringify({ ...subject }),
      });
      setSubject({
        name: "",
        short_name: "",
        color: nextSubjectColor([...(catalog?.subjects || []).map((s: any) => s.color), subject.color]),
        category: "other",
      });
      setShortTouched(false);
      await onChanged();
    } catch (err: any) {
      setSubjectError(err.message);
    } finally {
      setSaving("");
    }
  }

  return (
    <div className="h-full min-h-0">
      <section className="bg-white border rounded-xl p-4 shadow-sm flex flex-col min-h-0 overflow-hidden">
        <h2 className="font-semibold">Subjects</h2>
        <p className="text-xs text-slate-500 mt-1 mb-3">
          Subjects are global — one English for the whole school. Different teachers or templates are lessons, not new subjects.
        </p>
        <form onSubmit={addSubject} className="flex gap-2 items-end">
          <div className="w-full max-w-md min-w-0">
            <Field label="Name">
              <input
                className={`${inputClass} h-10`}
                value={subject.name}
                placeholder="Enter subject name"
                onChange={(e) => {
                  const name = e.target.value.toUpperCase();
                  if (subjectError) setSubjectError("");
                  setSubject({
                    ...subject,
                    name,
                    short_name: shortTouched
                      ? subject.short_name
                      : shortFromName(name, (catalog?.subjects || []).map((s: any) => s.short_name)),
                  });
                }}
                required
              />
            </Field>
          </div>
          <div className="w-80 shrink-0">
            <Field label="Short">
              <input
                className={`${inputClass} h-10`}
                value={subject.short_name}
                placeholder="Short name"
                maxLength={8}
                onChange={(e) => {
                  setShortTouched(true);
                  setSubject({ ...subject, short_name: e.target.value.toUpperCase() });
                }}
              />
            </Field>
          </div>
          <div className="w-44 shrink-0">
            <SearchSelect
              label="Type"
              value={subject.category}
              onChange={(category) => setSubject({ ...subject, category })}
              options={SUBJECT_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
              placeholder="Search type"
            />
          </div>
          <div className="shrink-0">
            <Field label="Color">
              <input
                type="color"
                className="fill-color h-10 w-10 rounded-lg cursor-pointer"
                value={hexColor(subject.color)}
                onChange={(e) => setSubject({ ...subject, color: e.target.value })}
                title="Change color"
              />
            </Field>
          </div>
          <div className="shrink-0">
            <Field label={"\u00a0"}>
              <button disabled={saving === "subject"} className="h-10 px-3 bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-50">
                Add
              </button>
            </Field>
          </div>
        </form>
        <ErrorBanner className="mt-2" message={subjectError} onClear={() => setSubjectError("")} />
        <DataList>
          {(catalog?.subjects || []).map((s: any) => (
            <DataRow
              key={s.id}
              name={s.name}
              short={s.short_name}
              color={hexColor(s.color)}
              badge={<DataPill>{categoryLabel(s.category)}</DataPill>}
              deleteLabel="Delete subject"
              open={openSubjectId === s.id}
              onToggle={() => setOpenSubjectId((id) => (id === s.id ? "" : s.id))}
              editor={
                <SubjectEditor
                  subject={s}
                  subjects={catalog?.subjects || []}
                  saving={saving === s.id}
                  onSave={async (body) => {
                    setSubjectError("");
                    setSaving(s.id);
                    try {
                      await api(`/v1/subjects/${s.id}`, { method: "PATCH", body: JSON.stringify(body) });
                      await onChanged();
                      toast("Saved");
                    } catch (err: any) {
                      setSubjectError(err.message);
                    } finally {
                      setSaving("");
                    }
                  }}
                />
              }
              onDelete={async () => {
                setSubjectError("");
                try {
                  await api(`/v1/subjects/${s.id}`, { method: "DELETE" });
                  if (openSubjectId === s.id) setOpenSubjectId("");
                  await onChanged();
                } catch (err: any) {
                  setSubjectError(err.message);
                }
              }}
            />
          ))}
        </DataList>
      </section>
    </div>
  );
}
