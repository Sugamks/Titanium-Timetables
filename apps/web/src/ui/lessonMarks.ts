export function classListOf(item: { sections?: string[]; section?: string; section_ids?: string[] }): string[] {
  if (Array.isArray(item.sections) && item.sections.length) return item.sections;
  return String(item.section || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isJoinedLesson(item: { sections?: string[]; section?: string; section_ids?: string[]; joined?: boolean }): boolean {
  if (item.joined) return true;
  if (Array.isArray(item.section_ids) && item.section_ids.length > 1) return true;
  return classListOf(item).length > 1;
}

export function joinedShort(item: { sections?: string[]; section?: string }): string {
  const names = classListOf(item);
  if (names.length < 2) return "";
  if (names.length <= 3) return names.join(" + ");
  return `${names.length} classes`;
}

type CardNames = {
  short?: string | null;
  subject?: string | null;
  teacher?: string | null;
  teacher_short?: string | null;
  section?: string | null;
  section_short?: string | null;
  section_shorts?: string[] | null;
  sections?: string[] | null;
};

export function cardShortLabel(item: CardNames): string {
  const teacher = (item.teacher_short || item.teacher || "").trim();
  const subject = (item.short || item.subject || "").trim();
  const section =
    (item.section_short || "").trim() ||
    (Array.isArray(item.section_shorts) && item.section_shorts.length ? item.section_shorts.join(" + ") : "") ||
    joinedShort(item) ||
    (item.section || "").trim();
  return [teacher, subject, section].filter(Boolean).join(" · ");
}

export function cardFullTitle(item: CardNames, extra?: string): string {
  const teacher = (item.teacher || "").trim();
  const subject = (item.subject || item.short || "").trim();
  const section = joinedShort(item) || (item.section || "").trim();
  const base = [teacher, subject, section].filter(Boolean).join(" · ");
  if (!extra) return base;
  if (!base) return extra;
  return `${base}. ${extra}`;
}
