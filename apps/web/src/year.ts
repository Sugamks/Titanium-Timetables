export const YEAR_KEY = "sched_year_id";
export const YEAR_EVENT = "sched-year-change";

export function currentYearId(): string {
  return localStorage.getItem(YEAR_KEY) || "";
}

export function setCurrentYearId(id: string) {
  if (id) localStorage.setItem(YEAR_KEY, id);
  else localStorage.removeItem(YEAR_KEY);
  window.dispatchEvent(new Event(YEAR_EVENT));
}

export function onYearChange(cb: () => void) {
  window.addEventListener(YEAR_EVENT, cb);
  return () => window.removeEventListener(YEAR_EVENT, cb);
}

export const CATALOG_EVENT = "sched-catalog-change";

export function notifyCatalog() {
  window.dispatchEvent(new Event(CATALOG_EVENT));
}

export function onCatalogChange(cb: () => void) {
  window.addEventListener(CATALOG_EVENT, cb);
  return () => window.removeEventListener(CATALOG_EVENT, cb);
}

export function timetablesUrl(yearId?: string, includeDeleted = false) {
  const id = yearId ?? currentYearId();
  const params = new URLSearchParams();
  if (id) params.set("academic_year_id", id);
  if (includeDeleted) params.set("include_deleted", "true");
  const q = params.toString();
  return q ? `/v1/timetables?${q}` : "/v1/timetables";
}
