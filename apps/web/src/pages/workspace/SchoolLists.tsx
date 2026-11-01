import { useRef, useState } from "react";
import { api } from "../../api";
import { useToast } from "../../ui/Toast";
import { Field, inputClass } from "../../ui/SearchSelect";
import { DataList, DataPill, DataRow } from "../../ui/DataRow";
import ErrorBanner from "../../ui/ErrorBanner";
import { shortFromClassSection, shortFromName } from "../../ui/shortName";

function TeacherEditor({
  teacher,
  teachers,
  saving,
  onSave,
}: {
  teacher: any;
  teachers: any[];
  saving: boolean;
  onSave: (body: { name: string; short_name: string; department: string }) => Promise<void>;
}) {
  const [name, setName] = useState(teacher.name || "");
  const [short, setShort] = useState(teacher.short_name || "");
  const [shortTouched, setShortTouched] = useState(Boolean(teacher.short_name));
  const [department, setDepartment] = useState(teacher.department || "");

  return (
    <form
      className="grid grid-cols-[minmax(0,1fr)_7rem_minmax(0,1fr)_auto] gap-2 items-end"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ name, short_name: short, department });
      }}
    >
      <Field label="Teacher">
        <input
          className={`${inputClass} h-10`}
          value={name}
          onChange={(e) => {
            const next = e.target.value.toUpperCase();
            setName(next);
            if (!shortTouched) setShort(shortFromName(next, teachers.map((row: any) => row.short_name)));
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
        />
      </Field>
      <Field label="Department">
        <input className={`${inputClass} h-10`} value={department} onChange={(e) => setDepartment(e.target.value.toUpperCase())} />
      </Field>
      <button disabled={saving} className="h-10 px-3 bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-50">
        Save
      </button>
    </form>
  );
}

function ClassEditor({
  section,
  teachers,
  sections,
  saving,
  onSave,
}: {
  section: any;
  teachers: any[];
  sections: any[];
  saving: boolean;
  onSave: (body: { class_name: string; section_name: string; short_name: string; class_teacher_id: string | null }) => Promise<void>;
}) {
  const [className, setClassName] = useState(section.class_name || "");
  const [sectionName, setSectionName] = useState(section.section_name || "");
  const [short, setShort] = useState(section.short_name || "");
  const [shortTouched, setShortTouched] = useState(Boolean(section.short_name));
  const [classTeacherId, setClassTeacherId] = useState(section.class_teacher_id || "");

  function fillShort(nextClass: string, nextSection: string) {
    if (shortTouched) return;
    setShort(shortFromClassSection(nextClass, nextSection, sections.map((row: any) => row.short_name)));
  }

  return (
    <form
      className="grid grid-cols-[minmax(0,1fr)_5rem_6rem] gap-2 items-end"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          class_name: className,
          section_name: sectionName,
          short_name: short,
          class_teacher_id: classTeacherId || null,
        });
      }}
    >
      <Field label="Class">
        <input
          className={`${inputClass} h-10`}
          value={className}
          onChange={(e) => {
            const next = e.target.value.toUpperCase();
            setClassName(next);
            fillShort(next, sectionName);
          }}
          required
        />
      </Field>
      <Field label="Section">
        <input
          className={`${inputClass} h-10`}
          value={sectionName}
          onChange={(e) => {
            const next = e.target.value.toUpperCase();
            setSectionName(next);
            fillShort(className, next);
          }}
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
        />
      </Field>
      <div className="col-span-2 min-w-0">
        <Field label="Class teacher">
          <select className={`${inputClass} h-10`} value={classTeacherId} onChange={(e) => setClassTeacherId(e.target.value)}>
            <option value="">None</option>
            {teachers.map((t: any) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </Field>
      </div>
      <button disabled={saving} className="h-10 px-3 bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-50">
        Save
      </button>
    </form>
  );
}

export default function SchoolLists({
  catalog,
  yearId,
  part,
  onChanged,
}: {
  catalog: any;
  yearId: string;
  part: "teachers" | "classes";
  onChanged: () => Promise<void> | void;
}) {
  const toast = useToast();
  const [teacherName, setTeacherName] = useState("");
  const [teacherShort, setTeacherShort] = useState("");
  const [teacherShortTouched, setTeacherShortTouched] = useState(false);
  const [department, setDepartment] = useState("");
  const [className, setClassName] = useState("");
  const [sectionName, setSectionName] = useState("");
  const [classShort, setClassShort] = useState("");
  const [classShortTouched, setClassShortTouched] = useState(false);
  const [classTeacherId, setClassTeacherId] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState("");
  const [openTeacherId, setOpenTeacherId] = useState("");
  const [openClassId, setOpenClassId] = useState("");
  const classInputRef = useRef<HTMLInputElement>(null);
  const teachers = catalog?.teachers || [];
  const years = catalog?.academic_years || [];
  const sections = (catalog?.sections || []).filter((s: any) => !yearId || s.academic_year_id === yearId);

  function fillClassShort(nextClass: string, nextSection: string) {
    if (classShortTouched) return;
    setClassShort(shortFromClassSection(nextClass, nextSection, sections.map((s: any) => s.short_name)));
  }

  async function submit(kind: string, path: string, body: unknown, clear: () => void) {
    setError("");
    setSaving(kind);
    try {
      await api(path, { method: "POST", body: JSON.stringify(body) });
      clear();
      await onChanged();
      toast("Saved");
      if (kind === "class") classInputRef.current?.focus();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving("");
    }
  }

  if (part === "teachers") {
    return (
      <section className="bg-white border rounded-xl p-4 shadow-sm">
        <h2 className="font-semibold">Teachers</h2>
        <p className="text-xs text-slate-500 mt-1 mb-3">Teachers are stored in the open timetable file.</p>
        <ErrorBanner className="mb-3" message={error} onClear={() => setError("")} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit("teacher", "/v1/teachers", { name: teacherName, department, short_name: teacherShort }, () => {
              setTeacherName("");
              setTeacherShort("");
              setTeacherShortTouched(false);
              setDepartment("");
            });
          }}
          className="grid grid-cols-[minmax(0,1fr)_7rem_minmax(0,1fr)_auto] gap-2 items-end"
        >
          <div className="min-w-0">
            <Field label="Teacher">
              <input
                className={`${inputClass} h-10`}
                value={teacherName}
                placeholder="Teacher name"
                onChange={(e) => {
                  const name = e.target.value.toUpperCase();
                  setTeacherName(name);
                  if (!teacherShortTouched) setTeacherShort(shortFromName(name, teachers.map((t: any) => t.short_name)));
                }}
                required
              />
            </Field>
          </div>
          <div className="min-w-0">
            <Field label="Short">
              <input
                className={`${inputClass} h-10`}
                value={teacherShort}
                placeholder="Short"
                maxLength={16}
                onChange={(e) => {
                  setTeacherShortTouched(true);
                  setTeacherShort(e.target.value.toUpperCase());
                }}
              />
            </Field>
          </div>
          <div className="min-w-0">
            <Field label="Department">
              <input className={`${inputClass} h-10`} value={department} placeholder="Optional" onChange={(e) => setDepartment(e.target.value.toUpperCase())} />
            </Field>
          </div>
          <button disabled={saving === "teacher"} className="h-10 px-3 bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-50">
            Add teacher
          </button>
        </form>
        <DataList>
          {teachers.map((t: any) => (
            <DataRow
              key={t.id}
              name={t.name}
              short={t.short_name}
              deleteLabel="Delete teacher"
              badge={t.department ? <DataPill>{t.department}</DataPill> : null}
              open={openTeacherId === t.id}
              onToggle={() => setOpenTeacherId((id) => (id === t.id ? "" : t.id))}
              editor={
                <TeacherEditor
                  teacher={t}
                  teachers={teachers}
                  saving={saving === t.id}
                  onSave={async (body) => {
                    setError("");
                    setSaving(t.id);
                    try {
                      await api(`/v1/teachers/${t.id}`, { method: "PATCH", body: JSON.stringify(body) });
                      await onChanged();
                      toast("Saved");
                    } catch (err: any) {
                      setError(err.message);
                    } finally {
                      setSaving("");
                    }
                  }}
                />
              }
              onDelete={async () => {
                setError("");
                try {
                  await api(`/v1/teachers/${t.id}`, { method: "DELETE" });
                  if (openTeacherId === t.id) setOpenTeacherId("");
                  await onChanged();
                  toast("Saved");
                } catch (err: any) {
                  setError(err.message);
                }
              }}
            />
          ))}
        </DataList>
      </section>
    );
  }

  return (
    <section className="bg-white border rounded-xl p-4 shadow-sm">
      <h2 className="font-semibold">Class section</h2>
      <p className="text-xs text-slate-500 mt-1 mb-3">
        Classes use the academic year selected in the sidebar. Add a year from the box at the top of this page.
      </p>
      <ErrorBanner className="mb-3" message={error} onClear={() => setError("")} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(
            "class",
            "/v1/sections",
            {
              class_name: className,
              section_name: sectionName,
              academic_year_id: yearId,
              class_teacher_id: classTeacherId || null,
              short_name: classShort,
            },
            () => {
              setClassName("");
              setSectionName("");
              setClassShort("");
              setClassShortTouched(false);
              setClassTeacherId("");
            }
          );
        }}
        className="grid grid-cols-[minmax(0,1fr)_6rem_7rem_minmax(0,1fr)_auto] gap-2 items-end"
      >
        <div className="min-w-0">
          <Field label="Class">
            <input
              ref={classInputRef}
              className={`${inputClass} h-10`}
              value={className}
              placeholder="Grade 1"
              onChange={(e) => {
                const name = e.target.value.toUpperCase();
                setClassName(name);
                fillClassShort(name, sectionName);
              }}
              required
            />
          </Field>
        </div>
        <div className="min-w-0">
          <Field label="Section">
            <input
              className={`${inputClass} h-10`}
              value={sectionName}
              placeholder="A"
              onChange={(e) => {
                const name = e.target.value.toUpperCase();
                setSectionName(name);
                fillClassShort(className, name);
              }}
            />
          </Field>
        </div>
        <div className="min-w-0">
          <Field label="Short">
            <input
              className={`${inputClass} h-10`}
              value={classShort}
              placeholder="Short"
              maxLength={16}
              onChange={(e) => {
                setClassShortTouched(true);
                setClassShort(e.target.value.toUpperCase());
              }}
            />
          </Field>
        </div>
        <div className="min-w-0">
          <Field label="Class teacher">
            <select className={`${inputClass} h-10`} value={classTeacherId} onChange={(e) => setClassTeacherId(e.target.value)}>
              <option value="">None</option>
              {teachers.map((t: any) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </Field>
        </div>
        <button disabled={saving === "class" || !yearId} className="h-10 px-3 bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-50">
          Add class
        </button>
        {!yearId && <p className="text-xs text-slate-500">Add an academic year first.</p>}
      </form>
      <DataList>
        {sections.map((s: any) => (
          <DataRow
            key={s.id}
            name={s.name}
            short={s.short_name}
            badge={s.class_teacher_name ? <DataPill>{s.class_teacher_name}</DataPill> : null}
            open={openClassId === s.id}
            onToggle={() => setOpenClassId((id) => (id === s.id ? "" : s.id))}
            editor={
              <ClassEditor
                section={s}
                teachers={teachers}
                sections={sections}
                saving={saving === s.id}
                onSave={async (body) => {
                  setError("");
                  setSaving(s.id);
                  try {
                    await api(`/v1/sections/${s.id}`, { method: "PATCH", body: JSON.stringify(body) });
                    await onChanged();
                    toast("Saved");
                  } catch (err: any) {
                    setError(err.message);
                  } finally {
                    setSaving("");
                  }
                }}
              />
            }
            deleteLabel="Delete class"
            onDelete={async () => {
              setError("");
              try {
                await api(`/v1/sections/${s.id}`, { method: "DELETE" });
                if (openClassId === s.id) setOpenClassId("");
                await onChanged();
                toast("Saved");
              } catch (err: any) {
                setError(err.message);
              }
            }}
          />
        ))}
      </DataList>
    </section>
  );
}
