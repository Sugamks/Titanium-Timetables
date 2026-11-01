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
