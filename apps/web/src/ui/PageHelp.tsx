import { useEffect, useState } from "react";
import { CloseIcon } from "./icons";
import { PAGE_HELP, type HelpPageId } from "./pageHelpContent";

export default function PageHelp({ page }: { page: HelpPageId }) {
 const help = PAGE_HELP[page];
 const [open, setOpen] = useState(false);

 useEffect(() => {
 if (!open) return;
 const onKey = (e: KeyboardEvent) => {
 if (e.key === "Escape") setOpen(false);
 };
 window.addEventListener("keydown", onKey);
 return () => window.removeEventListener("keydown", onKey);
 }, [open]);

 if (!help) return null;

 return (
 <>
 <button
 type="button"
 aria-label={`Abou ${help.title}`}
 title="Wha this page can do"
 onClick={() => setOpen(true)}
 className="inline-flex items-center justify-center w-6 h-6 rounded-full border border-slate-300 text-slate-500 text-xs font-bold italic hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-300 shrink-0"
 >
 i
 </button>
 {open && (
 <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-16 bg-black/30" onClick={() => setOpen(false)}>
 <div
 className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[80vh] overflow-auto p-5"
 onClick={(e) => e.stopPropagation()}
 role="dialog"
 aria-labelledby={`help-${page}`}
 >
 <div className="flex items-start justify-between gap-3 mb-3">
 <h2 id={`help-${page}`} className="text-lg font-semibold">
 Abou {help.title}
 </h2>
 <button type="button" className="text-slate-400 hover:text-slate-800" aria-label="Close" onClick={() => setOpen(false)}>
 <CloseIcon />
 </button>
 </div>
 {help.intro && <p className="text-sm text-slate-600 mb-4">{help.intro}</p>}
 {help.sections.map((s) => (
 <section key={s.heading} className="mb-4">
 <h3 className="text-sm font-semibold text-slate-900">{s.heading}</h3>
 <ul className="mt-1 list-disc pl-5 text-sm text-slate-600 space-y-1">
 {s.items.map((item) => (
 <li key={item}>{item}</li>
 ))}
 </ul>
 </section>
 ))}
 </div>
 </div>
 )}
 </>
 );
}
