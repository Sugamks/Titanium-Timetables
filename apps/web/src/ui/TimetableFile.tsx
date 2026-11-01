import { useState } from "react";
import { api } from "../api";
import { IconButton } from "./icons";
import { useToast } from "./Toast";
import { currentYearId } from "../year";

const TEMPLATE_KEY = "construct-template-id";

export default function SaveFileButton({ yearId, templateId }: { yearId: string; templateId?: string }) {
  const toast = useToast();
  const [path, setPath] = useState("");
  const [showPath, setShowPath] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      let picked = templateId || "";
      if (!picked) {
        try {
          picked = sessionStorage.getItem(TEMPLATE_KEY) || "";
        } catch {
          picked = "";
        }
      }
      const r = await api<{ cancelled?: boolean; path?: string }>("/v1/document/pick", {
        method: "POST",
        body: JSON.stringify({
          kind: "save",
          academic_year_id: yearId || currentYearId(),
          template_id: picked || null,
        }),
      });
      if (r.cancelled || !r.path) return;
      setPath(r.path);
      setShowPath(false);
      toast("Saved");
    } catch (err: any) {
      toast(err.message || "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex shrink-0 items-center gap-1">
      <button
        type="button"
        className="h-10 px-3 bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-50"
        disabled={busy}
        title="Choose where to write year-template.ttl"
        onClick={save}
      >
        {busy ? "Saving…" : "Save file"}
      </button>
      {path && (
        <IconButton
          icon="view"
          label={showPath ? "Hide file location" : "Show file location"}
          onClick={() => setShowPath((open) => !open)}
        />
      )}
      {showPath && path && (
        <p className="absolute right-0 top-full z-20 mt-1 w-64 break-all rounded-lg border bg-white px-2 py-1 text-xs text-slate-700 shadow">
          {path}
        </p>
      )}
    </div>
  );
}
