import { useEffect, useState } from "react";
import { busySnapshot, subscribeBusy } from "./busy";

export default function BusyOverlay() {
 const [state, setState] = useState(busySnapshot);

 useEffect(() => subscribeBusy(() => setState(busySnapshot())), []);

 if (!state.visible) return null;

 return (
 <div className="fixed inset-0 z-[100] flex items-center justify-center scrim" role="status" aria-live="polite" aria-busy="true">
 <div className="pop-in flex items-center gap-3 rounded-xl bg-paper-3 px-5 py-4 border border-rule">
 <span className="h-6 w-6 shrink-0 rounded-full border-2 border-accent border-t-accent animate-spin" />
 <div>
 <p className="text-sm font-medium text-ink">{state.label}</p>
 <p className="text-xs text-muted">Please wait…</p>
 </div>
 </div>
 </div>
 );
}
