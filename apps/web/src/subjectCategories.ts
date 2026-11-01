export const SUBJECT_CATEGORIES = [
  { value: "core", label: "Scholastic · Core" },
  { value: "language", label: "Scholastic · Language" },
  { value: "physical", label: "Physical activity" },
  { value: "activity", label: "Activity" },
  { value: "other", label: "Other" },
] as const;

export function categoryLabel(value?: string | null) {
  return SUBJECT_CATEGORIES.find((c) => c.value === value)?.label || "Other";
}
