import { Children, type KeyboardEvent, type ReactNode } from "react";
import { IconButton } from "./icons";

export function DataList({ children, className = "" }: { children: ReactNode; className?: string }) {
 const items = Children.toArray(children);
 const left = items.filter((_, i) => i % 2 === 0);
 const right = items.filter((_, i) => i % 2 === 1);
 return (
 <div className={`mt-4 grid grid-cols-2 items-start gap-x-8 text-sm ${className}`}>
 <ul className="min-w-0">{left}</ul>
 <ul className="min-w-0">{right}</ul>
 </div>
 );
}

export function DataPill({ children }: { children: ReactNode }) {
 return (
 <span className="inline-flex max-w-full items-center truncate rounded-lg border border-[var(--app-border)] px-3 py-1 text-xs text-[var(--app-muted)]">
 {children}
 </span>
 );
}

export function DataRow({
 name,
 short,
 color,
 badge,
 onDelete,
 deleteLabel = "Delete",
 open = false,
 onToggle,
 editor,
}: {
 name: string;
 short?: string | null;
 color?: string | null;
 badge?: ReactNode;
 onDelete?: () => void;
 deleteLabel?: string;
 open?: boolean;
 onToggle?: () => void;
 editor?: ReactNode;
}) {
 const label = short ? `${name} (${short})` : name;

 function onKey(e: KeyboardEvent<HTMLDivElement>) {
 if (!onToggle) return;
 if (e.key === "Enter" || e.key === " ") {
 e.preventDefault();
 onToggle();
 }
 }

 return (
 <li className="min-w-0 border-t border-[var(--app-border)]">
 <div
 className={`grid grid-cols-[minmax(0,1fr)_auto_2.5rem] items-center gap-2 py-2 ${onToggle ? "cursor-pointer" : ""}`}
 onClick={onToggle}
 onKeyDown={onKey}
 role={onToggle ? "button" : undefined}
 tabIndex={onToggle ? 0 : undefined}
 aria-expanded={onToggle ? open : undefined}
 >
 <span className="flex min-w-0 items-center gap-3">
 {color ? <span className="h-4 w-4 shrink-0 rounded-lg" style={{ background: color }} /> : null}
 <span className="truncate font-medium ">{label}</span>
 </span>
 <span className="min-w-0 justify-self-start">{badge}</span>
 <span className="justify-self-end" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
 {onDelete ? <IconButton icon="trash" label={deleteLabel} variant="danger" onClick={onDelete} /> : null}
 </span>
 </div>
 {open && editor ? <div className="min-w-0 pb-3">{editor}</div> : null}
 </li>
 );
}
