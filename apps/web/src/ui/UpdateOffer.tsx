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
 // Server exits after staging; helper runs msiexec and relaunches the app.
 } catch (e: unknown) {
 // Process exit can drop the HTTP connection after a successful stage.
 const msg = e instanceof Error ? e.message : "";
 if (/failed to fetch|networkerror|load failed|aborted/i.test(msg) || msg === "") {
 return;
 }
 setPhase("error");
 setErr(msg || "The update could not be installed");
 }
 }

 return (
 <div className="fixed inset-0 z-[80] flex items-center justify-center scrim p-4">
 <div className="pop-in bg-paper-3 rounded-xl border border-rule max-w-md w-full p-5" role="dialog" aria-labelledby="update-title">
 <h2 id="update-title" className="text-lg font-semibold">
 Update available
 </h2>
 <p className="text-sm text-muted mt-2">
 An update is available. Version {info.version} replaces this copy ({info.current}). Update closes the app,
 installs the new version, and opens it again. Your timetable files stay in place.
 </p>
 {info.notes ? (
 <ul className="text-sm text-ink mt-3 max-h-48 overflow-y-auto space-y-1">
 {info.notes
 .split("\n")
 .map((line) => line.trim())
 .filter(Boolean)
 .map((line, i) => (
 <li
 key={`${i}-${line}`}
 className={line.startsWith("•") || line.startsWith("-") ? "pl-1" : "font-medium pt-1 first:pt-0"}
 >
 {line.replace(/^[-•]\s*/, "• ")}
 </li>
 ))}
 </ul>
 ) : null}
 {phase === "working" ? (
 <p className="text-sm text-muted mt-3">
 Downloading the update (~65 MB), then a Windows installer window appears. The app closes and
 reopens on the new version. Keep this window open until that happens.
 </p>
 ) : null}
 {phase === "error" ? <p className="text-sm text-error mt-3">{err}</p> : null}
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
 className="bg-ink text-accent-ink rounded-md px-3 py-1.5 text-sm disabled:opacity-55"
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
