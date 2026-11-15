import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Viewport-fixed overlay. Portals to body so main/screen-in scroll + transform cannot trap it. */
export default function Modal({
  open,
  onClose,
  children,
  align = "start",
  className = "",
}: {
  open: boolean;
  onClose?: () => void;
  children: ReactNode;
  align?: "start" | "center";
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const main = document.querySelector("main");
    const prevBody = document.body.style.overflow;
    const prevMain = main instanceof HTMLElement ? main.style.overflow : "";
    document.body.style.overflow = "hidden";
    if (main instanceof HTMLElement) main.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevBody;
      if (main instanceof HTMLElement) main.style.overflow = prevMain;
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const alignCls = align === "center" ? "items-center" : "items-start";
  return createPortal(
    <div
      className={`fixed inset-0 z-[80] scrim flex ${alignCls} justify-center p-4 overflow-auto ${className}`}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
