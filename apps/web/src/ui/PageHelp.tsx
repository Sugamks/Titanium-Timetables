import { useEffect, useState } from "react";
import { CloseIcon } from "./icons";
import Modal from "./Modal";
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
 aria-label={`About ${help.title}`}
 title="Wha this page can do"
 onClick={() => setOpen(true)}
 className="inline-flex items-center justify-center w-6 h-6 rounded-full border border-rule text-muted text-xs font-bold italic hover:bg-paper-2 hover:text-accent hover:border-accent shrink-0"
 >
 i
 </button>
 <Modal open={open} onClose={() => setOpen(false)} className="pt-16">
 <div
 className="pop-in bg-paper-3 rounded-xl border border-rule max-w-lg w-full max-h-[80vh] overflow-auto p-5"
 onClick={(e) => e.stopPropagation()}
 role="dialog"
 aria-labelledby={`help-${page}`}
 >
 <div className="flex items-start justify-between gap-3 mb-3">
 <h2 id={`help-${page}`} className="text-lg font-semibold">
 About {help.title}
 </h2>
 <button type="button" className="text-muted hover:text-ink" aria-label="Close" onClick={() => setOpen(false)}>
 <CloseIcon />
 </button>
 </div>
 {help.intro && <p className="text-sm text-muted mb-4">{help.intro}</p>}
 {help.sections.map((s) => (
 <section key={s.heading} className="mb-4">
 <h3 className="text-sm font-semibold text-ink">{s.heading}</h3>
 <ul className="mt-1 list-disc pl-5 text-sm text-muted space-y-1">
 {s.items.map((item) => (
 <li key={item}>{item}</li>
 ))}
 </ul>
 </section>
 ))}
 </div>
 </Modal>
 </>
 );
}
