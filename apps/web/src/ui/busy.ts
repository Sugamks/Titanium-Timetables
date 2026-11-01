const SHOW_AFTER_MS = 2000;

type Listener = () => void;

let depth = 0;
let label = "";
let visible = false;
let showTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((fn) => fn());
}

export function busyBegin(text?: string) {
  depth += 1;
  if (text) label = text;
  if (depth === 1) {
    clearTimeout(showTimer);
    showTimer = setTimeout(() => {
      if (depth > 0) {
        visible = true;
        emit();
      }
    }, SHOW_AFTER_MS);
  }
  emit();
}

export function busyEnd() {
  depth = Math.max(0, depth - 1);
  if (depth === 0) {
    clearTimeout(showTimer);
    showTimer = undefined;
    visible = false;
    label = "";
  }
  emit();
}

export async function withBusy<T>(text: string, fn: () => Promise<T>): Promise<T> {
  busyBegin(text);
  try {
    return await fn();
  } finally {
    busyEnd();
  }
}

export function subscribeBusy(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function busySnapshot() {
  return { active: depth > 0, visible: visible && depth > 0, label: label || "Working…" };
}
