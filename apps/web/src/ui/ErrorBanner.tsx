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
 className={`flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 ${className}`}
 >
 <p className="flex-1 min-w-0">{message}</p>
 <IconButton icon="close" label="Clear" variant="danger" onClick={onClear} />
 </div>
 );
}
