import { busyBegin, busyEnd } from "./ui/busy";

const TOKEN_KEY = "sched_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem("sched_user");
}

function errorMessage(detail: any): string {
  if (detail && typeof detail === "object" && "detail" in detail) {
    const inner = (detail as { detail: unknown }).detail;
    if (typeof inner === "string") return inner;
    if (inner && typeof inner === "object" && "message" in inner && typeof (inner as { message: unknown }).message === "string") {
      return (inner as { message: string }).message;
    }
    return JSON.stringify(inner);
  }
  return typeof detail === "string" ? detail : JSON.stringify(detail);
}

export async function api<T = any>(path: string, init: RequestInit = {}, opts?: { busy?: boolean }): Promise<T> {
  const track = opts?.busy !== false;
  if (track) busyBegin();
  try {
    return await apiOnce<T>(path, init);
  } finally {
    if (track) busyEnd();
  }
}

async function apiOnce<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string>),
  };
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    let detail: any = await res.text();
    try {
      detail = JSON.parse(detail);
    } catch {
      /* text */
    }
    if (res.status === 401) {
      clearToken();
    }
    const err = new Error(errorMessage(detail));
    (err as any).status = res.status;
    (err as any).detail = detail;
    throw err;
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("text/html")) return (await res.text()) as T;
  return res.json();
}
