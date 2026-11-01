import { useEffect, useState } from "react";
import { busySnapshot, subscribeBusy } from "./busy";

export default function BusyOverlay() {
 const [state, setState] = useState(busySnapshot);

 useEffect(() => subscribeBusy(() => setState(busySnapshot())), []);

 if (!state.visible) return null;

 return (
 <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/45" role="status" aria-live="polite" aria-busy="true">
 <div className="flex items-center gap-3 rounded-xl bg-white px-5 py-4 shadow-xl border border-slate-200">
 <span className="h-6 w-6 shrink-0 rounded-full border-2 border-indigo-200 border-t-indigo-600 animate-spin" />
 <div>
 <p className="text-sm font-medium text-slate-900">{state.label}</p>
 <p className="text-xs text-slate-500">Please wait…</p>
 </div>
 </div>
 </div>
 );
}
