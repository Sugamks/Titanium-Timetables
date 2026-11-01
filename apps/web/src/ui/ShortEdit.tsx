export default function ShortEdit({
 value,
 label,
 onSave,
 onError,
}: {
 value: string;
 label: string;
 onSave: (next: string) => Promise<void>;
 onError: (message: string) => void;
}) {
 return (
 <input
 className="h-8 w-28 shrink-0 border border-slate-200 rounded-lg px-2 text-sm uppercase bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
 aria-label={label}
 defaultValue={value}
 maxLength={16}
 onBlur={async (e) => {
 const next = e.target.value.toUpperCase().trim();
 e.currentTarget.value = next;
 if (next === (value || "").toUpperCase()) return;
 try {
 await onSave(next);
 } catch (err: any) {
 onError(err.message || "Could not save short name");
 e.currentTarget.value = value || "";
 }
 }}
 />
 );
}
