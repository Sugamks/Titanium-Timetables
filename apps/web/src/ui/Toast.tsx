import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { IconButton } from "./icons";

type ToastTone = "ok" | "error";
type ToastItem = { id: number; text: string; sticky?: boolean; tone: ToastTone };
type ToastOptions = { sticky?: boolean; tone?: ToastTone };
type ToastFn = ((text: string, opts?: ToastOptions) => void) & { clearErrors: () => void };

const ToastCtx = createContext<ToastFn>((() => undefined) as ToastFn);

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const clearErrors = useCallback(() => {
    setItems((prev) => prev.filter((item) => !(item.tone === "error" && item.sticky)));
  }, []);

  const push = useCallback(
    (text: string, opts?: ToastOptions) => {
      const value = (text || "").trim();
      const tone = opts?.tone || "ok";
      const sticky = Boolean(opts?.sticky);
      if (!value) {
        if (tone === "error" || sticky) clearErrors();
        return;
      }
      const id = nextId.current++;
      setItems((prev) => {
        const rest = sticky && tone === "error" ? prev.filter((item) => !(item.tone === "error" && item.sticky)) : prev;
        return [...rest, { id, text: value, sticky, tone }];
      });
    },
    [clearErrors]
  ) as ToastFn;
  push.clearErrors = clearErrors;

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
        <div className="toast-stack">
          {items.map((item) => (
            <ToastCard
              key={item.id}
              text={item.text}
              sticky={item.sticky}
              tone={item.tone}
              onClear={() => clear(item.id)}
            />
          ))}
          {items.length > 1 && (
            <button
              type="button"
              className="pointer-events-auto w-full text-xs text-muted hover:text-ink bg-paper-3 border border-rule px-2 py-1"
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

function ToastCard({
  text,
  sticky,
  tone,
  onClear,
}: {
  text: string;
  sticky?: boolean;
  tone: ToastTone;
  onClear: () => void;
}) {
  const onClearRef = useRef(onClear);
  const [out, setOut] = useState(false);
  onClearRef.current = onClear;
  useEffect(() => {
    if (sticky) return;
    const timer = window.setTimeout(() => setOut(true), 3000);
    return () => window.clearTimeout(timer);
  }, [sticky]);
  useEffect(() => {
    if (!out) return;
    const timer = window.setTimeout(() => onClearRef.current(), 420);
    return () => window.clearTimeout(timer);
  }, [out]);

  return (
    <div
      className={`toast-card text-sm${tone === "error" ? " is-error" : ""}${out ? " is-out" : ""}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <p>{text}</p>
      <IconButton icon="close" label="Clear" variant={tone === "error" ? "danger" : undefined} onClick={() => setOut(true)} />
    </div>
  );
}
