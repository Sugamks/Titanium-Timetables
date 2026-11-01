import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const CX = 88;
const CY = 88;
const R = 62;

function parseValue(value?: string | null) {
 const [h, m] = (value || "08:00").split(":").map(Number);
 const hour24 = Number.isFinite(h) ? Math.min(23, Math.max(0, h)) : 8;
 const raw = Number.isFinite(m) ? m : 0;
 const minute = Math.min(55, Math.round(raw / 5) * 5);
 return { hour24, minute };
}

function formatValue(hour24: number, minute: number) {
 return `${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function formatLabel(value?: string | null) {
 const { hour24, minute } = parseValue(value);
 const suffix = hour24 < 12 ? "AM" : "PM";
 return `${hour24 % 12 || 12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function point(index: number, radius = R) {
 const angle = (index / 12) * Math.PI * 2 - Math.PI / 2;
 return { x: CX + radius * Math.cos(angle), y: CY + radius * Math.sin(angle) };
}

export default function ClockPicker({
 value,
 onChange,
 label,
}: {
 value?: string | null;
 onChange: (next: string) => void;
 label: string;
}) {
 const [open, setOpen] = useState(false);
 const [mode, setMode] = useState<"hour" | "minute">("hour");
 const [hour24, setHour24] = useState(8);
 const [minute, setMinute] = useState(0);
 const btnRef = useRef<HTMLButtonElement>(null);
 const popRef = useRef<HTMLDivElement>(null);
 const [pos, setPos] = useState({ top: 0, left: 0 });

 function syncFromValue() {
 const parts = parseValue(value);
 setHour24(parts.hour24);
 setMinute(parts.minute);
 }

 function place() {
 const box = btnRef.current?.getBoundingClientRect();
 if (!box) return;
 const width = 200;
 const height = 280;
 const left = Math.min(Math.max(8, box.left), window.innerWidth - width - 8);
 const top = box.bottom + 8 + height > window.innerHeight
 ? Math.max(8, box.top - height - 8)
 : box.bottom + 8;
 setPos({ top, left });
 }

 useLayoutEffect(() => {
 if (!open) return;
 place();
 }, [open]);

 useEffect(() => {
 if (!open) return;
 function onDoc(e: MouseEvent) {
 const t = e.target as Node;
 if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
 setOpen(false);
 }
 function onKey(e: KeyboardEvent) {
 if (e.key === "Escape") setOpen(false);
 }
 window.addEventListener("mousedown", onDoc);
 window.addEventListener("resize", place);
 window.addEventListener("scroll", place, true);
 window.addEventListener("keydown", onKey);
 return () => {
 window.removeEventListener("mousedown", onDoc);
 window.removeEventListener("resize", place);
 window.removeEventListener("scroll", place, true);
 window.removeEventListener("keydown", onKey);
 };
 }, [open]);

 function commit(nextHour: number, nextMinute: number) {
 const next = formatValue(nextHour, nextMinute);
 if (next !== (value || "").slice(0, 5)) onChange(next);
 }

 function pickHour(h12: number) {
 const pm = hour24 >= 12;
 const next = h12 === 12 ? (pm ? 12 : 0) : h12 + (pm ? 12 : 0);
 setHour24(next);
 setMode("minute");
 }

 function pickMinute(m: number) {
 setMinute(m);
 commit(hour24, m);
 setOpen(false);
 setMode("hour");
 }

 function toggleMeridiem(pm: boolean) {
 const h12 = hour24 % 12;
 const next = pm ? (h12 === 0 ? 12 : h12 + 12) : h12;
 setHour24(next);
 commit(next, minute);
 }

 const selectedIndex = mode === "hour" ? hour24 % 12 : minute / 5;
 const hand = point(selectedIndex, 46);

 return (
 <>
 <button
 ref={btnRef}
 type="button"
 title={`Set ${label}`}
 className="min-w-[4.75rem] text-left border border-slate-200 dark:border-slate-600 rounded-md px-2 py-1 bg-white dark:bg-[var(--app-input)] hover:border-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/50"
 onClick={() => {
 syncFromValue();
 setMode("hour");
 setOpen((v) => !v);
 }}
 >
 <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
 <div className="text-xs font-semibold tabular-nums text-slate-800">{formatLabel(value)}</div>
 </button>
 {open &&
 createPortal(
 <div
 ref={popRef}
 className="fixed z-[90] w-[200px] rounded-2xl border border-slate-200 dark:border-[var(--app-border)] bg-white dark:bg-[var(--app-card)] shadow-xl p-3"
 style={{ top: pos.top, left: pos.left }}
 >
 <div className="flex items-center justify-between mb-2">
 <div className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
 {hour24 % 12 || 12}:{String(minute).padStart(2, "0")}
 </div>
 <div className="flex rounded-md overflow-hidden border border-slate-200 dark:border-[var(--app-border)] text-[11px]">
 <button
 type="button"
 className={`px-2 py-0.5 ${hour24 < 12 ? "bg-indigo-600 text-white" : "bg-white text-slate-600 dark:bg-[var(--app-input)] dark:text-slate-300"}`}
 onClick={() => toggleMeridiem(false)}
 >
 AM
 </button>
 <button
 type="button"
 className={`px-2 py-0.5 ${hour24 >= 12 ? "bg-indigo-600 text-white" : "bg-white text-slate-600 dark:bg-[var(--app-input)] dark:text-slate-300"}`}
 onClick={() => toggleMeridiem(true)}
 >
 PM
 </button>
 </div>
 </div>
 <div className="flex justify-center gap-2 mb-2 text-[11px]">
 <button
 type="button"
 className={`px-2 py-0.5 rounded-full ${mode === "hour" ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-200" : "text-slate-500"}`}
 onClick={() => setMode("hour")}
 >
 Hour
 </button>
 <button
 type="button"
 className={`px-2 py-0.5 rounded-full ${mode === "minute" ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-200" : "text-slate-500"}`}
 onClick={() => setMode("minute")}
 >
 Minute
 </button>
 </div>
 <svg viewBox="0 0 176 176" className="w-full">
 <circle cx={CX} cy={CY} r="80" fill="var(--clock-face)" stroke="var(--clock-face-stroke)" />
 <line x1={CX} y1={CY} x2={hand.x} y2={hand.y} stroke="var(--clock-accent)" strokeWidth="3" strokeLinecap="round" />
 <circle cx={CX} cy={CY} r="4" fill="var(--clock-accent)" />
 {Array.from({ length: 12 }, (_, i) => {
 const p = point(i);
 const numeralLabel = mode === "hour" ? (i === 0 ? 12 : i) : i * 5;
 const active = i === selectedIndex;
 return (
 <g key={i} className="cursor-pointer" onClick={() => (mode === "hour" ? pickHour(i === 0 ? 12 : i) : pickMinute(i * 5))}>
 <circle cx={p.x} cy={p.y} r={active ? 13 : 11} fill={active ? "var(--clock-accent)" : "var(--clock-dot)"} stroke={active ? "var(--clock-accent)" : "var(--clock-dot-stroke)"} />
 <text
 x={p.x}
 y={p.y + 4}
 textAnchor="middle"
 fontSize="10"
 fontWeight="600"
 fill={active ? "#fff" : "var(--clock-numeral)"}
 >
 {mode === "minute" ? String(numeralLabel).padStart(2, "0") : numeralLabel}
 </text>
 </g>
 );
 })}
 </svg>
 <p className="text-[10px] text-center text-slate-400 mt-1">
 {mode === "hour" ? "Click an hour, then a minute" : "5-minute steps · click to set"}
 </p>
 </div>,
 document.body
 )}
 </>
 );
}
