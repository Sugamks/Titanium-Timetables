export function hexColor(value: string | null | undefined, fallback = "#64748b") {
  return /^#[0-9a-fA-F]{6}$/.test(value || "") ? (value as string) : fallback;
}

export function luminance(hex: string): number {
  const n = hexColor(hex).slice(1);
  const toLin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * toLin(parseInt(n.slice(0, 2), 16)) + 0.7152 * toLin(parseInt(n.slice(2, 4), 16)) + 0.0722 * toLin(parseInt(n.slice(4, 6), 16));
}

export function inkOn(bg: string | null | undefined): string {
  return luminance(hexColor(bg)) > 0.45 ? "#0f172a" : "#ffffff";
}

export function chipStyle(color?: string | null): { background: string; color: string } {
  const background = hexColor(color);
  return { background, color: inkOn(background) };
}

const SUBJECT_SWATCHES = ["#2563eb", "#16a34a", "#ca8a04", "#dc2626", "#7c3aed", "#0d9488", "#db2777", "#ea580c", "#4f46e5", "#0891b2"];

function hslHex(h: number, s: number, l: number) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const ch = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${ch(r)}${ch(g)}${ch(b)}`;
}

export function nextSubjectColor(used: string[] = []) {
  const taken = new Set(used.filter(Boolean).map((c) => c.toLowerCase()));
  const free = SUBJECT_SWATCHES.find((c) => !taken.has(c.toLowerCase()));
  if (free) return free;
  for (let n = 0; n < 360; n += 1) {
    const color = hslHex((n * 137) % 360, 0.62, 0.42);
    if (!taken.has(color)) return color;
  }
  return SUBJECT_SWATCHES[0];
}
