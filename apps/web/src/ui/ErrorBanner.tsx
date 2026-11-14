import { IconButton } from "./icons";

export default function ErrorBanner({
 message,
 onClear,
 className = "",
}: {
 message?: string | null;
 onClear: () => void;
 className?: string;
}) {
 if (!message) return null;
 return (
 <div
 role="alert"
 className={`pop-in flex items-center gap-2 rounded-lg border border-error bg-error-well px-3 py-2.5 text-sm text-error ${className}`}
 >
 <p className="flex-1 min-w-0 leading-snug m-0">{message}</p>
 <IconButton icon="close" label="Clear" variant="danger" onClick={onClear} />
 </div>
 );
}
