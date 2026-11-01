SUBJECT_CATEGORIES = ("core", "language", "physical", "activity", "other")

CATEGORY_LABELS = {
    "core": "Scholastic · Core",
    "language": "Scholastic · Language",
    "physical": "Physical activity",
    "activity": "Activity",
    "other": "Other",
}


def normalize_category(value: str | None) -> str:
    key = (value or "other").strip().lower()
    aliases = {
        "scholastic-core": "core",
        "scholastic_core": "core",
        "scholastic-language": "language",
        "scholastic_language": "language",
        "pe": "physical",
        "physical_activity": "physical",
    }
    key = aliases.get(key, key)
    return key if key in SUBJECT_CATEGORIES else "other"


def category_label(value: str | None) -> str:
    return CATEGORY_LABELS.get(normalize_category(value), "Other")
