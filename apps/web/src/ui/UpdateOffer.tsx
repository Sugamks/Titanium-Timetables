import { useEffect, useState } from "react";
import { api } from "../api";

type UpdateInfo = {
 current: string;
 configured?: boolean;
 available?: boolean;
 version?: string;
 notes?: string;
};

export default function UpdateOffer() {
 const [info, setInfo] = useState<UpdateInfo | null>(null);
 const [hidden, setHidden] = useState(false);
 const [phase, setPhase] = useState<"ask" | "working" | "error">("ask");
 const [err, setErr] = useState("");

 useEffect(() => {
 api<UpdateInfo>("/v1/app/update", {}, { busy: false })
 .then((row) => setInfo(row))
 .catch(() => setInfo(null));
 }, []);

 if (!info?.available || hidden) return null;

 async function install() {
 setPhase("working");
 setErr("");
 try {
 await api("/v1/app/update/install", { method: "POST" }, { busy: false });
 } catch (e: unknown) {
 setPhase("error");
 setErr(e instanceof Error ? e.message : "The update could not be installed");
 }
 }

 return (
 <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/45 p-4">
 <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5" role="dialog" aria-labelledby="update-title">
 <h2 id="update-title" className="text-lg font-semibold">
 Update available
 </h2>
 <p className="text-sm text-slate-600 mt-2">
 An update is available. Version {info.version} replaces this copy ({info.current}). Update closes the app,
 installs the new version, and opens it again. Your timetable files stay in place.
 </p>
 {info.notes ? <p className="text-sm text-slate-700 mt-3 whitespace-pre-wrap">{info.notes}</p> : null}
 {phase === "working" ? (
 <p className="text-sm text-slate-500 mt-3">
 Downloading and checking the update. This window closes when the app is ready to restart.
 </p>
 ) : null}
 {phase === "error" ? <p className="text-sm text-red-600 mt-3">{err}</p> : null}
 <div className="mt-4 flex justify-end gap-2">
 <button
 type="button"
 className="border rounded-md px-3 py-1.5 text-sm"
 onClick={() => setHidden(true)}
 disabled={phase === "working"}
 >
 Later
 </button>
 <button
 type="button"
 className="bg-slate-900 text-white rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
 onClick={install}
 disabled={phase === "working"}
 >
 {phase === "working" ? "Installing…" : "Update"}
 </button>
 </div>
 </div>
 </div>
 );
}
