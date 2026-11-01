export function shortFromName(name: string, used: string[] = []) {
  const words = name.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  if (!words.length) return "";
  const taken = new Set(used.filter(Boolean).map((s) => s.toUpperCase()));
  const base = words.length >= 2 ? words.map((w) => w[0]).join("").slice(0, 8) : (words[0] || "").slice(0, 3);
  if (base && !taken.has(base)) return base;
  if (words.length >= 2) {
    const last = words[words.length - 1].slice(0, 3);
    if (last && !taken.has(last)) return last;
  }
  const letters = words.join("");
  for (let n = 3; n <= Math.min(8, letters.length); n++) {
    const cand = letters.slice(0, n);
    if (cand && !taken.has(cand)) return cand;
  }
  const stem = base || "SUB";
  let i = 2;
  while (taken.has(`${stem}${i}`)) i += 1;
  return `${stem}${i}`;
}

/** Class initials plus the section, so GRADE 1 + A is G1A. */
export function shortFromClassSection(className: string, sectionName: string, used: string[] = []) {
  const section = sectionName.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean).join("");
  const classPart = shortFromName(className, []);
  if (!classPart && !section) return "";
  const taken = new Set(used.filter(Boolean).map((s) => s.toUpperCase()));
  const base = `${classPart}${section}`.slice(0, 16);
  if (base && !taken.has(base)) return base;
  const stem = (base || "SUB").slice(0, 14);
  let i = 2;
  while (taken.has(`${stem}${i}`.slice(0, 16))) i += 1;
  return `${stem}${i}`.slice(0, 16);
}
