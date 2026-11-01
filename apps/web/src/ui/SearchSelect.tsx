import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { CalendarIcon } from "./icons";
import { dmyToIso, isoToDmy } from "./dates";

export type SelectOption = { value: string; label: string; short?: string };

const field =
 "w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white text-left hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-400";

const fieldCompact =
 "w-full min-w-0 border border-transparent hover:border-slate-200 rounded-lg px-2 py-1 text-sm bg-white text-left focus:outline-none focus:ring-2 focus:ring-indigo-500";

const fieldCompactFit =
 "w-auto max-w-none border border-transparent hover:border-slate-200 rounded-lg px-2 py-1 text-sm bg-white text-left focus:outline-none focus:ring-2 focus:ring-indigo-500";

const rowBtn =
 "w-full min-w-0 flex items-center gap-1 text-left px-3 py-1.5 hover:bg-indigo-50";

const oneLine = "block min-w-0 truncate whitespace-nowrap";

type MenuPos = { top: number; left: number; width: number; maxH: number; flip: boolean };

function usePicker() {
 const [open, setOpen] = useState(false);
 const [q, setQ] = useState("");
 const [pos, setPos] = useState<MenuPos>({ top: 0, left: 0, width: 220, maxH: 224, flip: false });
 const wrap = useRef<HTMLDivElement>(null);
 const inputRef = useRef<HTMLInputElement>(null);
 const menuRef = useRef<HTMLUListElement>(null);

 useEffect(() => {
 function onDoc(e: MouseEvent) {
 const t = e.target as Node;
 if (wrap.current?.contains(t) || menuRef.current?.contains(t)) return;
 setOpen(false);
 }
 document.addEventListener("mousedown", onDoc);
 return () => document.removeEventListener("mousedown", onDoc);
 }, []);

 useEffect(() => {
 if (open) {
 setQ("");
 requestAnimationFrame(() => inputRef.current?.focus());
 }
 }, [open]);

 useLayoutEffect(() => {
 if (!open || !wrap.current) return;
 function place() {
 const trigger = (wrap.current?.querySelector("input,button") as HTMLElement | null) || wrap.current;
 if (!trigger) return;
 const r = trigger.getBoundingClientRect();
 const gap = 4;
 const spaceBelow = window.innerHeight - r.bottom - gap;
 const spaceAbove = r.top - gap;
 const flip = spaceBelow < 160 && spaceAbove > spaceBelow;
 const maxH = Math.min(224, Math.max(120, flip ? spaceAbove : spaceBelow));
 setPos({
 top: flip ? r.top - gap : r.bottom + gap,
 left: r.left,
 width: Math.max(r.width, 200),
 maxH,
 flip,
 });
 }
 place();
 window.addEventListener("scroll", place, true);
 window.addEventListener("resize", place);
 return () => {
 window.removeEventListener("scroll", place, true);
 window.removeEventListener("resize", place);
 };
 }, [open, q]);

 return { open, setOpen, q, setQ, wrap, inputRef, menuRef, pos };
}

function filterOptions(options: SelectOption[], q: string) {
 const needle = q.trim().toLowerCase();
 if (!needle) return options;
 return options.filter((o) =>
 `${o.label} ${o.short || ""}`.toLowerCase().includes(needle)
 );
}

function OptionText({ o }: { o: SelectOption }) {
 return (
 <>
 <span className={oneLine}>{o.label}</span>
 {o.short ? <span className="shrink-0 text-xs text-slate-400">{o.short}</span> : null}
 </>
 );
}

function Menu({
 menuRef,
 pos,
 children,
}: {
 menuRef: RefObject<HTMLUListElement | null>;
 pos: MenuPos;
 children: ReactNode;
}) {
 return createPortal(
 <ul
 ref={menuRef}
 className="fixed z-[80] overflow-auto bg-white border border-slate-200 rounded-lg shadow-lg py-1"
 style={{
 top: pos.flip ? undefined : pos.top,
 bottom: pos.flip ? window.innerHeight - pos.top : undefined,
 left: pos.left,
 width: pos.width,
 maxHeight: pos.maxH,
 }}
 >
 {children}
 </ul>,
 document.body
 );
}

export default function SearchSelect({
 label,
 hint,
 value,
 onChange,
 options,
 placeholder = "Search…",
 allowEmpty,
 emptyLabel = "None",
 compact,
 fit,
}: {
 label?: string;
 hint?: string;
 value: string;
 onChange: (v: string) => void;
 options: SelectOption[];
 placeholder?: string;
 allowEmpty?: boolean;
 emptyLabel?: string;
 compact?: boolean;
 /** Size the closed control to the label instead of filling and ellipsizing. */
 fit?: boolean;
}) {
 const { open, setOpen, q, setQ, wrap, inputRef, menuRef, pos } = usePicker();
 const selected = options.find((o) => o.value === value);
 const filtered = useMemo(() => filterOptions(options, q), [options, q]);
 const box = compact ? (fit ? fieldCompactFit : fieldCompact) : field;
 const labelClass = fit ? "whitespace-nowrap" : oneLine;

 function pick(v: string) {
 onChange(v);
 setOpen(false);
 }

 return (
 <div className={`text-sm ${fit ? "w-max max-w-none" : "min-w-0"}`} ref={wrap}>
 {label ? <div className="font-medium text-slate-700">{label}</div> : null}
 {hint && <p className="text-xs text-slate-500 mt-0.5 leading-snug">{hint}</p>}
 <div className={label || hint ? "mt-1" : ""}>
 {open ? (
 <input
 ref={inputRef}
 className={`${box} ring-2 ring-indigo-100 border-indigo-400`}
 placeholder={placeholder}
 value={q}
 onChange={(e) => setQ(e.target.value)}
 onKeyDown={(e) => {
 if (e.key === "Escape") setOpen(false);
 if (e.key === "Enter") {
 e.preventDefault();
 if (allowEmpty && !q.trim()) pick("");
 else if (filtered[0]) pick(filtered[0].value);
 }
 }}
 />
 ) : (
 <button type="button" className={`${box} ${fit ? "" : "overflow-hidden"}`} onClick={() => setOpen(true)}>
 <span
 className={`${labelClass} ${selected || (allowEmpty && !value) ? "text-slate-900" : "text-slate-400"}`}
 title={selected?.label || ""}
 >
 {selected?.label || (allowEmpty ? emptyLabel : placeholder)}
 </span>
 </button>
 )}
 {open && (
 <Menu menuRef={menuRef} pos={pos}>
 {allowEmpty && (
 <li>
 <button type="button" className={`${rowBtn} text-slate-500 hover:bg-slate-50`} onClick={() => pick("")}>
 <span className={oneLine}>{emptyLabel}</span>
 </button>
 </li>
 )}
 {filtered.map((o) => (
 <li key={o.value}>
 <button
 type="button"
 title={o.short ? `${o.label} (${o.short})` : o.label}
 className={`${rowBtn} ${o.value === value ? "bg-indigo-50 text-indigo-800 font-medium" : "text-slate-800"}`}
 onClick={() => pick(o.value)}
 >
 <OptionText o={o} />
 </button>
 </li>
 ))}
 {filtered.length === 0 && q.trim() ? <li className="px-3 py-2 text-slate-400">No matches</li> : null}
 </Menu>
 )}
 </div>
 </div>
 );
}

export function MultiSearchSelect({
 label,
 hint,
 values,
 onChange,
 options,
 placeholder = "Search…",
 compact,
}: {
 label?: string;
 hint?: string;
 values: string[];
 onChange: (v: string[]) => void;
 options: SelectOption[];
 placeholder?: string;
 compact?: boolean;
}) {
 const { open, setOpen, q, setQ, wrap, inputRef, menuRef, pos } = usePicker();
 const selected = options.filter((o) => values.includes(o.value));
 const filtered = useMemo(() => filterOptions(options, q), [options, q]);
 const box = compact ? fieldCompact : field;

 function toggle(v: string) {
 onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);
 }

 const summary = selected.length === 0
 ? placeholder
 : selected.length <= 2
 ? selected.map((o) => o.label).join(", ")
 : `${selected.length} selected`;

 return (
 <div className="text-sm min-w-0" ref={wrap}>
 {label ? <div className="font-medium text-slate-700">{label}</div> : null}
 {hint && <p className="text-xs text-slate-500 mt-0.5 leading-snug">{hint}</p>}
 <div className={label || hint ? "mt-1" : ""}>
 {open ? (
 <input
 ref={inputRef}
 className={`${box} ring-2 ring-indigo-100 border-indigo-400`}
 placeholder={placeholder}
 value={q}
 onChange={(e) => setQ(e.target.value)}
 onKeyDown={(e) => {
 if (e.key === "Escape") setOpen(false);
 if (e.key === "Enter") {
 e.preventDefault();
 if (filtered[0]) toggle(filtered[0].value);
 }
 }}
 />
 ) : (
 <button type="button" className={`${box} overflow-hidden`} onClick={() => setOpen(true)}>
 <span className={`${oneLine} ${selected.length ? "text-slate-900" : "text-slate-400"}`} title={summary}>
 {summary}
 </span>
 </button>
 )}
 {open && (
 <Menu menuRef={menuRef} pos={pos}>
 {filtered.map((o) => {
 const on = values.includes(o.value);
 return (
 <li key={o.value}>
 <button
 type="button"
 title={o.short ? `${o.label} (${o.short})` : o.label}
 className={`${rowBtn} ${on ? "bg-indigo-50 text-indigo-800 font-medium" : "text-slate-800"}`}
 onClick={() => toggle(o.value)}
 >
 <span className="w-4 shrink-0 text-center">{on ? "✓" : ""}</span>
 <OptionText o={o} />
 </button>
 </li>
 );
 })}
 {filtered.length === 0 && q.trim() ? <li className="px-3 py-2 text-slate-400">No matches</li> : null}
 </Menu>
 )}
 </div>
 </div>
 );
}

export function Field({
 label,
 hint,
 children,
}: {
 label: string;
 hint?: string;
 children: ReactNode;
}) {
 return (
 <label className="text-sm block min-w-0">
 <span className="font-medium text-slate-700">{label}</span>
 {hint && <span className="block text-xs text-slate-500 mt-0.5 leading-snug">{hint}</span>}
 <div className="mt-1">{children}</div>
 </label>
 );
}

export const inputClass = field;

export function DateInput({
 value,
 onChange,
 className = field,
}: {
 value: string;
 onChange: (iso: string) => void;
 className?: string;
}) {
 const [text, setText] = useState(() => isoToDmy(value));
 useEffect(() => {
 setText(isoToDmy(value));
 }, [value]);

 return (
 <div className="relative min-w-0">
 <input
 type="text"
 inputMode="numeric"
 placeholder="dd/mm/yyyy"
 className={`${className} w-full pr-9`}
 value={text}
 onChange={(e) => {
 const next = e.target.value;
 setText(next);
 const iso = dmyToIso(next);
 if (iso) onChange(iso);
 }}
 onBlur={() => setText(isoToDmy(value))}
 />
 <span className="pointer-events-none absolute inset-y-0 right-0 w-9 flex items-center justify-center text-slate-400">
 <CalendarIcon className="w-4 h-4" />
 </span>
 <input
 type="date"
 lang="en-GB"
 title="Pick date"
 className="absolute inset-y-0 right-0 w-9 opacity-0 cursor-pointer"
 value={value || ""}
 onChange={(e) => {
 if (e.target.value) onChange(e.target.value);
 }}
 />
 </div>
 );
}
