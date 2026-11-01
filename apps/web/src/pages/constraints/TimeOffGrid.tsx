import { isTeachingPeriod, periodTimeRange, periodTypeKey, periodTypeLabel, periodTypeTone } from "../../periods";

export type PaintMode = {
 id: string;
 label: string;
 className: string;
 title?: string;
};

export default function ConstraintGrid({
 days,
 periods,
 cells,
 modes,
 paintMode,
 onPaint,
}: {
 days: { id: string; name: string }[];
 periods: { id: string; name: string; period_type?: string; start_time?: string | null; end_time?: string | null }[];
 cells: Record<string, string>;
 modes: PaintMode[];
 paintMode: string;
 onPaint: (dayId: string, periodId: string, mode: string) => void;
}) {
 const byId = Object.fromEntries(modes.map((m) => [m.id, m]));
 const fallback = modes[0];

 if (!days.length || !periods.length) {
 return <p className="text-sm text-slate-500">Create a template with bell times first.</p>;
 }

 return (
 <div className="overflow-auto">
 <table className="w-full table-fixed border-collapse">
 <thead>
 <tr>
 <th className="w-24 p-1 text-left text-xs font-medium text-slate-500"></th>
 {days.map((d) => (
 <th key={d.id} className="p-1 text-xs font-medium text-slate-600">
 {d.name.slice(0, 3)}
 </th>
 ))}
 </tr>
 </thead>
 <tbody>
 {periods.map((p) => {
 const clock = periodTimeRange(p);
 if (!isTeachingPeriod(p)) {
 const tone = periodTypeTone(periodTypeKey(p.period_type));
 return (
 <tr key={p.id}>
 <td className={`pr-2 py-1 text-xs whitespace-nowrap ${tone.fill} ${tone.title}`}>
 <div className="flex items-stretch gap-2">
 <span className={`w-1 shrink-0 rounded-sm ${tone.bar}`} aria-hidden />
 <div>
 <div className="font-medium">{p.name}</div>
 {clock && <div className={`tabular-nums text-[10px] ${tone.time}`}>{clock}</div>}
 </div>
 </div>
 </td>
 <td className={`p-1 text-center text-xs italic ${tone.fill} ${tone.time}`} colSpan={days.length}>
 {periodTypeLabel(p.period_type)}
 </td>
 </tr>
 );
 }
 return (
 <tr key={p.id}>
 <td className="pr-2 py-1 text-xs text-slate-500 whitespace-nowrap">
 <div>{p.name}</div>
 {clock && <div className="tabular-nums text-[10px] text-slate-400">{clock}</div>}
 </td>
 {days.map((d) => {
 const key = `${d.id}:${p.id}`;
 const modeId = cells[key] || fallback.id;
 const mode = byId[modeId] || fallback;
 return (
 <td key={key} className="p-1">
 <button
 type="button"
 title={mode.title || mode.label}
 className={`block w-full h-10 rounded-md border ${mode.className}`}
 onClick={() => onPaint(d.id, p.id, cells[key] === paintMode ? fallback.id : paintMode)}
 />
 </td>
 );
 })}
 </tr>
 );
 })}
 </tbody>
 </table>
 </div>
 );
}
