import React, { createContext, useContext, useMemo, useState } from "react";

const THEME_KEY = "sched_dark";

export function resolveDark(stored: string | null): boolean {
 return stored === "1";
}

function readStoredDark(): boolean {
 try {
 return resolveDark(localStorage.getItem(THEME_KEY));
 } catch {
 return false;
 }
}

function applyDark(dark: boolean) {
 document.documentElement.classList.toggle("dark", dark);
 try {
 localStorage.setItem(THEME_KEY, dark ? "1" : "0");
 } catch {
 /* ignore */
 }
}

if (typeof document !== "undefined") {
 applyDark(readStoredDark());
}

type ThemeState = {
 isDark: boolean;
 toggleDark: () => void;
};

const Ctx = createContext<ThemeState>({ isDark: false, toggleDark: () => undefined });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
 const [isDark, setDark] = useState(readStoredDark);
 const value = useMemo(
 () => ({
 isDark,
 toggleDark: () => {
 setDark((prev) => {
 const next = !prev;
 applyDark(next);
 return next;
 });
 },
 }),
 [isDark]
 );
 return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme() {
 return useContext(Ctx);
}
