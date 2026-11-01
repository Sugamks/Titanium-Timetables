import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api";
import { currentYearId } from "../year";

const TEMPLATE_KEY = "construct-template-id";
const FILES_EVENT = "ttl-files";

export function LibraryFiles() {
  const [files, setFiles] = useState<{ name: string }[] | null>(null);

  useEffect(() => {
    const load = () => {
      api<{ mode?: string; files?: { name: string }[] }>("/v1/document", {}, { busy: false })
        .then((doc) => setFiles(doc.mode === "library" ? doc.files || [] : []))
        .catch(() => setFiles([]));
    };
    load();
    window.addEventListener(FILES_EVENT, load);
    return () => window.removeEventListener(FILES_EVENT, load);
  }, []);

  if (!files?.length) return null;
  return (
    <div className="mr-auto min-w-0 text-xs text-slate-600">
      <div className="font-medium text-slate-800">Files</div>
      {files.map((file) => (
        <div key={file.name} className="truncate" title={file.name}>{file.name}</div>
      ))}
    </div>
  );
}

export default function SaveTimetable({ yearId, leading }: { yearId: string; leading?: ReactNode }) {
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setError("");
    setSaved("");
    setBusy(true);
    try {
      let templateId = "";
      try {
        templateId = sessionStorage.getItem(TEMPLATE_KEY) || "";
      } catch {
        templateId = "";
      }
      const r = await api<{ name?: string }>("/v1/document/pick", {
        method: "POST",
        body: JSON.stringify({
          kind: "save",
          academic_year_id: yearId || currentYearId(),
          template_id: templateId || null,
        }),
      });
      setSaved(r.name || "");
      window.dispatchEvent(new Event(FILES_EVENT));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-64 flex-1">
        <h2 className="text-2xl font-semibold whitespace-nowrap">Timetable file</h2>
        <p className="text-slate-500 text-sm mt-1 max-w-xl">
          Writes template-year.ttl for the selected year.
        </p>
        {leading}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <button
          type="button"
          className="h-10 px-3 bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-50"
          disabled={busy}
          title="Write this year's template to a .ttl file"
          onClick={save}
        >
          {busy ? "Saving…" : "Save file"}
        </button>
        {saved && <p className="text-right text-xs text-slate-500">{saved}</p>}
        {error && <p className="text-right text-sm text-red-600">{error}</p>}
      </div>
    </header>
  );
}
