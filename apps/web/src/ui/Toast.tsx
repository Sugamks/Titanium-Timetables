import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { IconButton } from "./icons";

type ToastItem = { id: number; text: string };

const ToastCtx = createContext<(text: string) => void>(() => undefined);

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const push = useCallback((text: string) => {
    const value = (text || "").trim();
    if (!value) return;
    const id = nextId.current++;
    setItems((prev) => [...prev, { id, text: value }]);
  }, []);

  function clear(id: number) {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }

  function clearAll() {
    setItems([]);
  }

  return (
    <ToastCtx.Provider value={push}>
      {children}
      {items.length > 0 && (
        <div className="fixed top-4 right-4 z-[80] w-80 max-w-[calc(100vw-2rem)] space-y-2 pointer-events-none">
          {items.map((item) => (
            <ToastCard key={item.id} text={item.text} onClear={() => clear(item.id)} />
          ))}
          {items.length > 1 && (
            <button
              type="button"
              className="pointer-events-auto w-full text-xs text-slate-500 hover:text-slate-800 bg-white/90 border border-slate-200 rounded-lg px-2 py-1 shadow-sm"
              onClick={clearAll}
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </ToastCtx.Provider>
  );
}

function ToastCard({ text, onClear }: { text: string; onClear: () => void }) {
  const onClearRef = useRef(onClear);
  onClearRef.current = onClear;
  useEffect(() => {
    const timer = window.setTimeout(() => onClearRef.current(), 3000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="pointer-events-auto flex items-start gap-2 rounded-xl border border-emerald-200 bg-white shadow-lg px-3 py-2 text-sm text-emerald-800">
      <p className="flex-1 min-w-0">{text}</p>
      <IconButton icon="close" label="Clear" onClick={onClear} />
    </div>
  );
}
