import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import { isTeachingPeriod, periodTypeLabel } from "../../periods";
import { withBusy } from "../../ui/busy";
import { chipStyle } from "../../ui/colors";
import { CloseIcon, IconButton } from "../../ui/icons";
import { cardFullTitle, cardShortLabel, classListOf, isJoinedLesson, joinedShort } from "../../ui/lessonMarks";
import SearchSelect, { MultiSearchSelect } from "../../ui/SearchSelect";
import NeedTemplate from "../../ui/NeedTemplate";

function weekLaneLabel(code: string) {
  if (code === "WEEK_A") return "Odd week";
  if (code === "WEEK_B") return "Even week";
  return "Both weeks";
}

type GroupMember = { lesson_id: string; subject: string; name: string; joined: boolean; sections: string[] };

type View = "section" | "teacher";

export default function GridPanel({
  tts,
  timetableId,
  onTimetableChange,
  yearLessons,
  onChanged,
  onError,
  onMessage,
}: {
  tts: any[];
  timetableId?: string;
  onTimetableChange?: (id: string) => void;
  yearLessons: any[];
  onChanged: () => Promise<void> | void;
  onError: (m: string) => void;
  onMessage: (m: string) => void;
}) {
  const [versionId, setVersionId] = useState("");
  const [grid, setGrid] = useState<any>(null);
  const [mode, setMode] = useState("balanced");
  const [sliceIds, setSliceIds] = useState<string[]>([]);
  const classOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of yearLessons) {
      const ids: string[] = l.section_ids || [];
      ids.forEach((id, i) => {
        const names = Array.isArray(l.sections) ? l.sections : [];
        const label = names[i] || (ids.length === 1 ? l.section : "") || id;
        if (!map.has(id)) map.set(id, String(label));
      });
    }
    return [...map.entries()].map(([value, label]) => ({ value, label }));
  }, [yearLessons]);
  const [job, setJob] = useState<any>(null);
  const [solutions, setSolutions] = useState<any[]>([]);
  const [view, setView] = useState<View>("section");
  const [filter, setFilter] = useState("");
  const filterDefaulted = useRef(false);
  const [dragging, setDragging] = useState<any>(null);
  const [running, setRunning] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [previewing, setPreviewing] = useState("");
  const [lane, setLane] = useState("ALL");
  const [slotMap, setSlotMap] = useState<Record<string, any>>({});
  const [undoStack, setUndoStack] = useState<any[]>([]);
  const [swapOn, setSwapOn] = useState(false);
  const [swapA, setSwapA] = useState<any>(null);
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const [groupCell, setGroupCell] = useState<{ day: any; period: any; name: string; members: GroupMember[] } | null>(null);
  const [savingGroup, setSavingGroup] = useState(false);
  const [groupInfo, setGroupInfo] = useState<{
    name: string;
    day: string;
    period: string;
    items: any[];
  } | null>(null);
  const [sameDayAsk, setSameDayAsk] = useState<{
    title: string;
    detail: string;
    day: any;
    period: any;
    stackWithShift: boolean;
    card: any;
  } | null>(null);

  const versions = tts.flatMap((t) => (t.versions || []).map((v: any) => ({ ...v, timetable: t.name, tid: t.id })));
  const forTemplate = timetableId ? versions.filter((v) => v.tid === timetableId) : versions;
  const versionChoices = forTemplate.length ? forTemplate : versions;

  useEffect(() => {
    // Do not clear the week while templates reload after Use / Save.
    if (!versionChoices.length) return;
    setVersionId((prev) => (prev && versionChoices.some((v) => v.id === prev) ? prev : versionChoices.slice(-1)[0]?.id || ""));
  }, [tts, timetableId]);

  async function loadGrid(id: string) {
    if (!id) {
      setGrid(null);
      return;
    }
    const g = await api(`/v1/designer/versions/${id}`);
    setGrid(g);
  }

  useEffect(() => {
    setUndoStack([]);
    setSlotMap({});
    setSwapOn(false);
    setSwapA(null);
    loadGrid(versionId).catch((e) => onError(e.message));
  }, [versionId]);

  useEffect(() => {
    if (!dragging) return;
    const onDragOver = (e: DragEvent) => {
      const el = gridScrollRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const edge = 56;
      const step = 28;
      if (e.clientY < rect.top + edge) el.scrollTop -= step;
      else if (e.clientY > rect.bottom - edge) el.scrollTop += step;
      if (e.clientX < rect.left + edge) el.scrollLeft -= step;
      else if (e.clientX > rect.right - edge) el.scrollLeft += step;
    };
    document.addEventListener("dragover", onDragOver);
    return () => document.removeEventListener("dragover", onDragOver);
  }, [dragging]);

  const display = preview || grid;

  const allUnplaced = useMemo(() => {
    const counts: Record<string, number> = {};
    (display?.allocations || []).forEach((a: any) => {
      counts[a.lesson_id] = (counts[a.lesson_id] || 0) + 1;
    });
    return yearLessons.filter((l) => {
      const needed =
        Array.isArray(l.blocks) && l.blocks.length
          ? l.blocks.length
          : Number(l.frequency_per_week) || 0;
      return (counts[l.id] || 0) < needed;
    });
  }, [yearLessons, display]);

  const unplaced = useMemo(() => {
    if (!filter) return allUnplaced;
    if (view === "section") {
      return allUnplaced.filter((l) => classListOf(l).includes(filter));
    }
    return allUnplaced.filter((l) => (l.teachers || []).includes(filter));
  }, [allUnplaced, filter, view]);

  const otherUnplacedNote = useMemo(() => {
    if (!filter || view !== "section") return "";
    const byClass = new Map<string, number>();
    for (const l of allUnplaced) {
      for (const name of classListOf(l)) {
        if (name === filter) continue;
        byClass.set(name, (byClass.get(name) || 0) + 1);
      }
    }
    const rows = [...byClass.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    if (!rows.length) return "";
    return rows.map(([name, n]) => `${name}: ${n}`).join(" · ");
  }, [allUnplaced, filter, view]);

  async function poll(id: string) {
    const j = await api(`/v1/jobs/${id}`);
    setJob(j);
    if (j.status === "completed" || j.status === "failed") {
      const sols = [...((await api(`/v1/jobs/${id}/solutions`)) || [])].sort(
        (a: any, b: any) =>
          (b.score || 0) - (a.score || 0) || (a.metrics?.hard_violations || 0) - (b.metrics?.hard_violations || 0)
      );
      setSolutions(sols);
      setRunning(false);
      if (sols[0]?.id) {
        const p = await api(`/v1/jobs/${id}/solutions/${sols[0].id}/preview`);
        setPreview(p);
        setPreviewing(sols[0].id);
      }
      return;
    }
    setTimeout(() => poll(id), 700);
  }

  async function ensureVersion(): Promise<string> {
    if (versionId) return versionId;
    const first = (timetableId && tts.find((t) => t.id === timetableId)) || tts[0];
    if (!first) {
      throw new Error("Create a template first (Templates in the sidebar), then generate.");
    }
    if (first.versions?.length) return first.versions.slice(-1)[0].id;
    const v = await api<{ id: string }>(`/v1/timetables/${first.id}/versions`, { method: "POST" });
    await onChanged();
    setVersionId(v.id);
    return v.id;
  }

  function weekFrozen() {
    return grid?.version?.status === "published" || grid?.version?.status === "archived";
  }

  async function run() {
    if (weekFrozen()) {
      onError("This week is published. Open a draft to change it.");
      return;
    }
    onError("");
    onMessage("");
    setSolutions([]);
    setPreview(null);
    setPreviewing("");
    setRunning(true);
    try {
      const vid = await ensureVersion();
      const r = await api<{ job_id: string }>("/v1/generate", {
        method: "POST",
        body: JSON.stringify({ version_id: vid, mode, section_ids: sliceIds }),
      });
      poll(r.job_id);
    } catch (e: any) {
      setRunning(false);
      onError(e.message);
    }
  }

  async function apply(solId: string) {
    if (weekFrozen()) {
      onError("This week is published. Open a draft to change it.");
      return;
    }
    if (!job?.id) return;
    const r = await api<{ version_id: string }>(`/v1/jobs/${job.id}/apply`, {
      method: "POST",
      body: JSON.stringify({ solution_id: solId }),
    });
    setPreview(null);
    setPreviewing("");
    setVersionId(r.version_id);
    await loadGrid(r.version_id);
    onMessage("Timetable applied. You can still change teacher or periods on the Lessons tab.");
    await onChanged();
  }

  async function openDraft() {
    const picked = versionChoices.find((v) => v.id === versionId);
    if (!picked?.tid) {
      onError("Pick a template first.");
      return;
    }
    setPublishing(true);
    onError("");
    try {
      const draft = await api<{ id: string }>(`/v1/timetables/${picked.tid}/fork-edit`, { method: "POST" });
      await onChanged();
      setVersionId(draft.id);
      await loadGrid(draft.id);
      onMessage("Draft opened. The published week is unchanged.");
    } catch (e: any) {
      onError(e.message);
    } finally {
      setPublishing(false);
    }
  }

  async function publish() {
    if (weekFrozen()) {
      onError("This week is published. Open a draft to change it.");
      return;
    }
    const vid = versionId || (await ensureVersion());
    const picked = versionChoices.find((v) => v.id === vid) || versionChoices.find((v) => v.tid === timetableId);
    if (!picked?.tid) {
      onError("Pick a template first.");
      return;
    }
    setPublishing(true);
    onError("");
    try {
      await api(`/v1/go-live/${vid}`, { method: "POST" });
      const draft = await api<{ id: string }>(`/v1/timetables/${picked.tid}/fork-edit`, { method: "POST" });
      await onChanged();
      setVersionId(draft.id);
      await loadGrid(draft.id);
      onMessage("Published. A new draft is open. The published week stays as it was until you publish again.");
    } catch (e: any) {
      onError(e.message);
    } finally {
      setPublishing(false);
    }
  }

  function setCardLock(cardId: string, level: string) {
    setGrid((g: typeof grid) => {
      if (!g?.allocations) return g;
      return {
        ...g,
        allocations: g.allocations.map((row: any) => (row.id === cardId ? { ...row, lock_level: level } : row)),
      };
    });
  }

  function cardLocked(card: { lock_level?: string }) {
    return card.lock_level === "full" || card.lock_level === "lesson";
  }

  async function cycleLock(card: any) {
    if (weekFrozen()) {
      onError("This week is published. Open a draft to change it.");
      return;
    }
    const current = cardLocked(card) ? card.lock_level : "none";
    const next = current === "none" ? "full" : "none";
    setCardLock(card.id, next);
    try {
      await api(`/v1/designer/allocations/${card.id}/lock`, {
        method: "POST",
        body: JSON.stringify({ lock_level: next }),
      });
    } catch (e: any) {
      setCardLock(card.id, current);
      onError(e.message);
    }
  }

  async function previewSol(id: string) {
    if (!job?.id) return;
    onError("");
    setPreviewing(id);
    try {
      const p = await api(`/v1/jobs/${job.id}/solutions/${id}/preview`);
      setPreview(p);
    } catch (e: any) {
      onError(e.message);
    }
  }

  async function rememberSlots(item: any) {
    const id = item?.lesson_id || item?.id;
    if (!versionId || !id || weekFrozen()) return;
    try {
      const r = await api<any>(`/v1/designer/possible-slots?version_id=${versionId}&lesson_id=${id}`, undefined, { busy: false });
      const map: Record<string, any> = {};
      for (const s of r.slots || []) map[`${s.day_id}|${s.period_id}`] = s;
      setSlotMap(map);
    } catch {
      setSlotMap({});
    }
  }

  async function undoMove() {
    const step = undoStack[undoStack.length - 1];
    if (!step || !versionId) return;
    if (weekFrozen()) {
      onError("This week is published. Open a draft to change it.");
      return;
    }
    setUndoStack((stack) => stack.slice(0, -1));
    try {
      if (step.restore) {
        await api("/v1/designer/allocations", { method: "POST", body: JSON.stringify({ ...step.restore, version_id: step.version_id }) });
      } else if (step.before?.allocation_id) {
        await api("/v1/designer/allocations", { method: "POST", body: JSON.stringify({ ...step.before, version_id: step.version_id }) });
      } else if (step.created) {
        await api(`/v1/designer/allocations/${step.created}`, { method: "DELETE" });
      }
      await loadGrid(versionId);
      onMessage("Undid the last move.");
    } catch (e: any) {
      onError(e.message);
    }
  }

  async function deallocate(card: any) {
    if (!versionId || !card?.id) return;
    if (weekFrozen()) {
      onError("This week is published. Open a draft to change it.");
      return;
    }
    if (preview || String(card.id || "").startsWith("preview-")) {
      onError("This is a preview. Click Use this timetable first.");
      return;
    }
    if (cardLocked(card)) {
      onError("This card is locked. Unlock it before removing it.");
      return;
    }
    const name = card.short || card.subject || "The lesson";
    const aid = card.id;
    const prevGrid = grid;
    setDragging(null);
    setSlotMap({});
    setGrid((g: typeof grid) => {
      if (!g?.allocations) return g;
      return { ...g, allocations: g.allocations.filter((row: any) => row.id !== aid) };
    });
    setUndoStack((stack) => [
      ...stack,
      {
        restore: {
          lesson_id: card.lesson_id,
          day_id: card.day_id,
          period_id: card.block_start || card.period_id,
          room_resource_id: card.room_resource_id,
          occurrence_index: card.occurrence_index || 0,
        },
        version_id: versionId,
      },
    ]);
    onMessage(`Moved ${name} back to Unplaced.`);
    try {
      await api(`/v1/designer/allocations/${aid}`, { method: "DELETE" }, { busy: false });
    } catch (e: any) {
      setGrid(prevGrid);
      setUndoStack((stack) => stack.slice(0, -1));
      onError(e.message || "Could not unplace that card.");
    }
  }

  async function swapWith(card: any) {
    if (!versionId || weekFrozen() || !swapOn) return;
    if (!swapA) {
      setSwapA(card);
      onMessage(`Swap: selected ${card.short || card.subject || "first card"}. Click the second card.`);
      return;
    }
    if (swapA.id === card.id) {
      setSwapA(null);
      onMessage("Swap: click the first card again.");
      return;
    }
    const first = swapA;
    const second = card;
    try {
      await withBusy("Swapping…", async () => {
        await api("/v1/designer/allocations", {
          method: "POST",
          body: JSON.stringify({
            version_id: versionId,
            allocation_id: first.id,
            lesson_id: first.lesson_id,
            day_id: second.day_id,
            period_id: second.period_id,
            room_resource_id: first.room_resource_id,
            stack: false,
          }),
        });
        setUndoStack((stack) => [
          ...stack,
          {
            before: {
              allocation_id: first.id,
              lesson_id: first.lesson_id,
              day_id: first.day_id,
              period_id: first.period_id,
              room_resource_id: first.room_resource_id,
            },
            created: null,
            version_id: versionId,
          },
        ]);
        setSwapA(null);
        setSwapOn(false);
        await loadGrid(versionId);
      });
      onMessage(`Swapped ${first.short || "the first lesson"} with ${second.short || "the second lesson"}.`);
    } catch (e: any) {
      onError(e.message);
    }
  }

  async function commitDrop(card: any, day: any, period: any, stackWithShift: boolean) {
    if (!versionId || !card) return;
    const placedName = card.short || card.subject || "The lesson";
    const body = {
      version_id: versionId,
      lesson_id: card.lesson_id || card.id,
      day_id: day.id,
      period_id: period.id,
      room_resource_id: card.room_resource_id || card.room_resource_ids?.[0],
      allocation_id: card.allocation_id,
      occurrence_index: card.occurrence_index || 0,
      stack: stackWithShift,
    };
    try {
      const before = card.allocation_id
        ? {
            allocation_id: card.allocation_id,
            lesson_id: body.lesson_id,
            day_id: card.day_id,
            period_id: card.period_id,
            room_resource_id: card.room_resource_id,
          }
        : null;
      await withBusy("Updating timetable…", async () => {
        const placed = await api<any>("/v1/designer/allocations", { method: "POST", body: JSON.stringify(body) });
        setUndoStack((stack) => [...stack, { before, created: before ? null : placed.id, version_id: versionId }]);
        setDragging(null);
        setSlotMap({});
        setSameDayAsk(null);
        await loadGrid(versionId);
      });
      onMessage(
        stackWithShift
          ? `Stacked ${placedName} in ${period.name}. Save as a group if these are language options.`
          : `Placed ${placedName} on ${day.name}, ${period.name}.`
      );
    } catch (e: any) {
      onError(e.message);
    }
  }

  async function drop(day: any, period: any, stackWithShift: boolean) {
    if (!dragging || !versionId) return;
    if (swapOn) {
      setDragging(null);
      setSlotMap({});
      return;
    }
    const slot = slotMap[`${day.id}|${period.id}`];
    if (Object.keys(slotMap).length && slot && slot.ok === false) {
      onError((slot.reasons || []).join(", ") || "That period is blocked for this lesson.");
      return;
    }
    if (weekFrozen()) {
      onError("This week is published. Open a draft to change it.");
      setDragging(null);
      setSlotMap({});
      return;
    }
    if (cardLocked(dragging)) {
      onError("This card is locked. Unlock it before moving it.");
      setDragging(null);
      setSlotMap({});
      return;
    }
    if (preview || String(dragging.allocation_id || dragging.id || "").startsWith("preview-")) {
      onError("This is a preview. Click Use this timetable first, then you can swap periods.");
      setDragging(null);
      setSlotMap({});
      return;
    }
    const placedName = dragging.short || dragging.subject || "The lesson";
    const dragClasses = classListOf(dragging);
    if (view === "section" && filter && dragClasses.length && !dragClasses.includes(filter)) {
      onError(`You are viewing ${filter}. Switch to ${dragClasses.join(" / ")} (or Both) before placing this card.`);
      setDragging(null);
      setSlotMap({});
      return;
    }
    const dragLessonId = dragging.lesson_id || dragging.id;
    const dragMeta = yearLessons.find((l) => l.id === dragLessonId);
    const dragSubjectId = dragging.subject_id || dragMeta?.subject_id || "";
    const dragSubjectName = String(dragging.subject || dragMeta?.subject || dragging.short || "").toLowerCase();
    const sameDayHits = (display?.allocations || []).filter((a: any) => {
      if (a.day_id !== day.id) return false;
      if (a.block_offset) return false;
      if (dragging.allocation_id && a.id === dragging.allocation_id) return false;
      const aMeta = yearLessons.find((l) => l.id === a.lesson_id);
      const aSubjectId = a.subject_id || aMeta?.subject_id || "";
      const sameSubject =
        (dragSubjectId && aSubjectId && dragSubjectId === aSubjectId) ||
        (!!dragSubjectName && String(a.subject || aMeta?.subject || a.short || "").toLowerCase() === dragSubjectName);
      if (!sameSubject) return false;
      if (dragClasses.length && !classListOf(a).some((c) => dragClasses.includes(c))) return false;
      return true;
    });
    if (sameDayHits.length) {
      const periodsLabel = sameDayHits
        .map((a: any) => a.period || display?.periods?.find((p: any) => p.id === a.period_id)?.name || "a period")
        .join(", ");
      setSameDayAsk({
        title: "Same subject that day",
        detail: `${placedName} is already on ${day.name} (${periodsLabel}). Place another period that day anyway?`,
        day,
        period,
        stackWithShift,
        card: dragging,
      });
      setSlotMap({});
      return;
    }
    await commitDrop(dragging, day, period, stackWithShift);
  }

  function openGroup(day: any, period: any, cells: any[]) {
    const seen = new Map<string, GroupMember>();
    for (const a of cells) {
      if (seen.has(a.lesson_id)) continue;
      seen.set(a.lesson_id, {
        lesson_id: a.lesson_id,
        subject: a.subject || a.short || "Lesson",
        name: (a.groups && a.groups[0]) || a.subject || a.short || "",
        joined: isJoinedLesson(a),
        sections: classListOf(a),
      });
    }
    const existing = cells.find((a: any) => a.band_name)?.band_name || "";
    setGroupCell({ day, period, name: existing, members: [...seen.values()] });
  }

  function weeklyForMembers(members: GroupMember[]) {
    const ids = new Set(members.map((m) => m.lesson_id));
    const fromCards = Math.max(
      1,
      ...members.map((m) => Number(yearLessons.find((x) => x.id === m.lesson_id)?.frequency_per_week) || 1)
    );
    const slots = new Set<string>();
    for (const a of display?.allocations || []) {
      if (ids.has(a.lesson_id) && !a.block_offset) slots.add(`${a.day_id}|${a.period_id}`);
    }
    return Math.max(fromCards, slots.size);
  }

  async function saveGroup(applyAll: boolean) {
    if (!groupCell || !versionId) return;
    if (weekFrozen()) {
      onError("This week is published. Open a draft to change it.");
      return;
    }
    if (groupCell.members.length < 2) {
      onError("Stack at least two different lessons in this period first.");
      return;
    }
    if (!groupCell.name.trim()) {
      onError("Give this group a name (for example II Language).");
      return;
    }
    setSavingGroup(true);
    onError("");
    try {
      const r = await api<{ sections: number; weekly: number; slots: number; apply_all: boolean; subjects: string[]; band_name?: string }>(
        "/v1/designer/cell-group",
        {
          method: "POST",
          body: JSON.stringify({
            version_id: versionId,
            day_id: groupCell.day.id,
            period_id: groupCell.period.id,
            apply_all: applyAll,
            band_name: groupCell.name.trim(),
            members: groupCell.members.map((m) => ({
              lesson_id: m.lesson_id,
              group_name: m.subject || m.name.trim(),
            })),
          }),
        }
      );
      setGroupCell(null);
      await onChanged();
      await loadGrid(versionId);
      const label = r.band_name || groupCell.name.trim();
      if (r.apply_all) {
        onMessage(`${label} saved on all ${r.slots || r.weekly} periods${r.sections > 1 ? `, including related classes` : ""}.`);
      } else {
        onMessage(`${label} saved for this period${r.sections > 1 ? ` on ${r.sections} classes` : ""}.`);
      }
    } catch (e: any) {
      onError(e.message);
    } finally {
      setSavingGroup(false);
    }
  }

  const cellMap: Record<string, any[]> = {};
  (display?.allocations || []).forEach((a: any) => {
    const k = `${a.day_id}|${a.period_id}`;
    (cellMap[k] ||= []).push(a);
  });

  function weekOk(a: any) {
    const code = a.week_code || "ALL";
    if (lane === "ALL") return true;
    return code === "ALL" || code === lane;
  }

  function visible(a: any) {
    if (!weekOk(a)) return false;
    if (!filter) return true;
    if (view === "section") return classListOf(a).includes(filter);
    return a.teacher === filter;
  }

  const filterOptions = useMemo(() => {
    const names = new Set<string>();
    for (const l of yearLessons) {
      if (view === "section") {
        String(l.section || "")
          .split(",")
          .map((s: string) => s.trim())
          .filter(Boolean)
          .forEach((s: string) => names.add(s));
      } else {
        (l.teachers || []).forEach((t: string) => t && names.add(t));
      }
    }
    for (const a of display?.allocations || grid?.allocations || []) {
      if (view === "section") classListOf(a).forEach((n) => names.add(n));
      else if (a.teacher) names.add(a.teacher);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [yearLessons, grid, display, view]);

  useEffect(() => {
    if (!filterOptions.length) return;
    if (!filterDefaulted.current || (filter && !filterOptions.includes(filter))) {
      setFilter(filterOptions[0]);
      filterDefaulted.current = true;
    }
  }, [filterOptions, filter]);

  if (!tts.length) return <NeedTemplate what="Construction" />;

  return (
    <div className="space-y-3">
      <div className="bg-paper-3 border border-rule rounded-xl px-3 py-2 space-y-2">
        <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="min-w-[14rem]">
          <SearchSelect
            label="Template"
            value={versionId}
            onChange={(id) => {
              setVersionId(id);
              const picked = versions.find((v) => v.id === id);
              if (picked?.tid && onTimetableChange) onTimetableChange(picked.tid);
            }}
            options={versionChoices.map((v) => ({
              value: v.id,
              label: `${v.timetable} · v${v.number} (${v.status})`,
            }))}
            placeholder="Search template"
            allowEmpty={versions.length === 0}
            emptyLabel="No template yet"
          />
        </div>
        <div className="flex items-center gap-3 flex-nowrap">
          {(["fast", "balanced", "best"] as const).map((m) => (
            <label key={m} className="text-sm flex items-center gap-1" title={m === "fast" ? "3 quick variants" : m === "best" ? "Slower CP-SAT plus variants" : "4 quick variants"}>
              <input type="radio" checked={mode === m} onChange={() => setMode(m)} /> {m}
            </label>
          ))}
          <div className="w-56">
            <MultiSearchSelect
              label="These classes only"
              values={sliceIds}
              onChange={setSliceIds}
              options={classOptions}
              placeholder="Whole timetable"
            />
          </div>
          <button onClick={run} disabled={running || weekFrozen()} className="bg-accent hover:bg-accent text-accent-ink rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-55">
            {running ? "Generating…" : "Generate"}
          </button>
          {weekFrozen() ? (
            <button onClick={openDraft} disabled={publishing || !versionId} className="bg-success hover:bg-success text-accent-ink rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-55">
              {publishing ? "Opening…" : "New draft"}
            </button>
          ) : (
            <button onClick={publish} disabled={publishing || !versionId} className="bg-success hover:bg-success text-accent-ink rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-55">
              {publishing ? "Publishing…" : "Publish"}
            </button>
          )}
        </div>
        </div>
        {weekFrozen() && (
          <p className="text-sm text-muted">
            This week is published. My timetable and the class week read this copy. New draft copies it so you can edit. Locked cards stay put when you generate, and they cannot be dragged.
          </p>
        )}
        {running && job && (
          <div className="flex items-center gap-2 text-xs text-muted">
            <div className="flex-1 h-1.5 bg-paper-2 rounded">
              <div className="h-1.5 bg-accent rounded" style={{ width: `${job.progress || 0}%` }} />
            </div>
            <span className="shrink-0">{job.progress || 0}%</span>
          </div>
        )}
        {solutions[0]?.explanation?.summary && (
          <p className="text-sm text-warn">{solutions[0].explanation.summary}</p>
        )}
        {solutions.length > 0 && (
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
            {solutions.map((s) => {
              const hard = s.metrics?.hard_violations ?? 0;
              const gaps = s.metrics?.teacher_gaps ?? 0;
              const missing =
                s.metrics?.incomplete_lessons ??
                s.metrics?.incomplete ??
                0;
              const ok = hard === 0 && missing === 0;
              const issues = ok
                ? gaps
                  ? `${gaps} gaps`
                  : "ok"
                : [hard ? `${hard} hard` : null, missing ? `${missing} miss` : null, gaps ? `${gaps} gaps` : null]
                    .filter(Boolean)
                    .join(" · ");
              const active = previewing === s.id;
              return (
                <div
                  key={s.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => previewSol(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      previewSol(s.id);
                    }
                  }}
                  className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-sm cursor-pointer ${
                    active
                      ? "border-accent bg-paper-2 ring-1 ring-accent"
                      : "border-rule bg-paper-2 hover:border-accent hover:bg-paper-2"
                  }`}
                  title="Hard = teacher/class/room clashes. Miss = lessons still in Unplaced. Gaps = idle holes in a teacher’s day between their first and last lesson."
                >
                  <div className="min-w-0 flex items-baseline gap-2">
                    <span className="font-semibold text-ink">{s.label}</span>
                    <span className={`truncate ${ok ? "text-success" : "text-warn"}`}>
                      {issues}
                      {s.explanation?.broken?.length ? ` · ${s.explanation.broken.slice(0, 2).map((b: any) => b.label).join(", ")}` : ""}
                    </span>
                  </div>
                  <button
                    className="shrink-0 px-2.5 py-1 rounded-md text-xs font-semibold bg-accent text-accent-ink hover:bg-accent"
                    onClick={(e) => {
                      e.stopPropagation();
                      apply(s.id);
                    }}
                  >
                    Use
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex gap-4 min-h-[28rem]">
        <aside
          className={`w-52 shrink-0 bg-paper-3 border rounded-xl p-3 overflow-auto ${
            dragging?.allocation_id && !weekFrozen() ? "ring-2 ring-accent border-accent" : ""
          }`}
          onDragOver={(e) => {
            if (!dragging?.allocation_id || weekFrozen()) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (!dragging?.allocation_id || weekFrozen()) return;
            deallocate(dragging);
          }}
        >
          <h2 className="font-medium text-sm mb-2">
            Unplaced ({unplaced.length})
            {view === "section" && filter ? ` · ${filter}` : ""}
          </h2>
          {dragging?.allocation_id && !weekFrozen() && (
            <p className="text-[11px] text-accent mb-2 font-medium">Drop here to unplace</p>
          )}
          {otherUnplacedNote && (
            <p className="text-[11px] text-muted mb-2 leading-snug">
              Still unplaced in other classes — {otherUnplacedNote}
            </p>
          )}
          {unplaced.map((l) => (
            <div
              key={l.id}
              draggable={!weekFrozen()}
              onDragStart={() => {
                if (weekFrozen()) return;
                setDragging(l);
                rememberSlots(l);
              }}
              onDragEnd={() => {
                setDragging(null);
                setSlotMap({});
              }}
              className={`mb-2 rounded-lg border px-2 py-1 text-xs cursor-grab ${isJoinedLesson(l) ? "border-accent bg-paper-2" : ""}`}
              style={{ borderLeft: `4px solid ${l.color || "var(--color-muted)"}` }}
            >
              <div className="font-medium">{l.subject}</div>
              <div className="text-muted">{isJoinedLesson(l) ? joinedShort(l) : l.section} · {l.teachers?.[0]}</div>
              {isJoinedLesson(l) ? <div className="text-xs text-accent font-semibold">Shared classes</div> : null}
            </div>
          ))}
          {unplaced.length === 0 && !dragging?.allocation_id && (
            <p className="text-xs text-muted">
              {filter && view === "section"
                ? `All cards for ${filter} are placed.`
                : "All cards placed, or add lessons first."}
            </p>
          )}
        </aside>
        <section className="flex-1 min-w-0 bg-paper-3 border rounded-xl overflow-hidden flex flex-col">
          <div className="shrink-0 px-3 py-2 border-b flex flex-wrap items-center gap-2">
            {(["section", "teacher"] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => {
                  setView(v);
                  filterDefaulted.current = false;
                  setFilter("");
                }}
                className={`text-sm px-2 py-1 rounded ${view === v ? "bg-accent text-accent-ink" : "bg-paper-2"}`}
              >
                {v === "section" ? "Class" : "Teacher"}
              </button>
            ))}
            <div className="w-52">
              <SearchSelect
                value={filter}
                onChange={setFilter}
                options={filterOptions.map((o: any) => ({ value: o, label: o }))}
                placeholder={view === "section" ? "Search class" : "Search teacher"}
                allowEmpty
                emptyLabel="All"
              />
            </div>
            {(["ALL", "WEEK_A", "WEEK_B"] as const).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLane(code)}
                className={`text-sm px-2 py-1 rounded ${lane === code ? "bg-accent text-accent-ink" : "bg-paper-2"}`}
              >
                {weekLaneLabel(code)}
              </button>
            ))}
            <button type="button" className="text-sm px-2 py-1 rounded border" disabled={!undoStack.length || weekFrozen()} onClick={undoMove}>
              Undo
            </button>
            <button
              type="button"
              className={`text-sm px-2 py-1 rounded border ${swapOn ? "bg-warn-well ring-1 ring-warn" : ""}`}
              disabled={weekFrozen()}
              onClick={() => {
                setSwapOn((v) => !v);
                setSwapA(null);
                setDragging(null);
                setSlotMap({});
              }}
            >
              {swapOn ? "Cancel swap" : "Swap"}
            </button>
            {swapOn ? (
              <span className="text-xs text-warn font-medium">
                {swapA ? "Step 2 · click the other card" : "Step 1 · click the first card"}
              </span>
            ) : (
              <p className="text-xs text-muted">
                Green border = can drop. Hold Shift while dropping onto a filled cell to stack. Drag near edges to scroll.
              </p>
            )}
          </div>
          {preview && (
            <div className="shrink-0 px-3 py-1 text-xs bg-paper-2 text-accent border-b font-bold">
              Preview {preview.label} · not saved until Use
            </div>
          )}
          <div key={`${view}-${lane}`} ref={gridScrollRef} className="motion-swap flex-1 overflow-auto">
          {!display?.days?.length ? (
            <div className="p-8 text-sm text-muted text-center">
              Generate a timetable, or create a template if none exists.
            </div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr>
                  <th className="p-2 border bg-paper-2">Period</th>
                  {display.days.map((d: any) => (
                    <th key={d.id} className="p-2 border bg-paper-2">{d.name.slice(0, 3)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {display.periods.map((p: any) => {
                  if (!isTeachingPeriod(p)) {
                    return (
                      <tr key={p.id} className="bg-warn-well text-warn">
                        <td className="p-2 border font-medium">{p.name}</td>
                        <td className="p-2 border text-center italic" colSpan={display.days.length}>{periodTypeLabel(p.period_type)}</td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={p.id}>
                      <td className="p-2 border font-medium bg-paper-2">{p.name}</td>
                      {display.days.map((d: any) => {
                        const cells = (cellMap[`${d.id}|${p.id}`] || []).filter(visible);
                        const uniqueLessons = new Set(cells.map((a: any) => a.lesson_id));
                        const bands = new Map<string, { id: string; name: string; items: any[] }>();
                        const rest: any[] = [];
                        const seen = new Set<string>();
                        for (const a of cells) {
                          if (a.band_id) {
                            const b = bands.get(a.band_id) || { id: a.band_id, name: a.band_name || "Group", items: [] as any[] };
                            if (!b.items.some((x) => x.lesson_id === a.lesson_id)) b.items.push(a);
                            bands.set(a.band_id, b);
                          } else if (!seen.has(a.lesson_id)) {
                            seen.add(a.lesson_id);
                            rest.push(a);
                          }
                        }
                        const grouped = [...bands.values()];
                        const allGrouped = grouped.length === 1 && rest.length === 0 && uniqueLessons.size > 1;
                        const slotKey = `${d.id}|${p.id}`;
                        const hint = slotMap[slotKey];
                        const slotsReady = !!dragging && !swapOn && Object.keys(slotMap).length > 0;
                        const canDrop = !slotsReady || hint?.ok === true;
                        const dropClass = slotsReady
                          ? hint?.ok
                            ? "ring-2 ring-inset ring-success"
                            : "opacity-35"
                          : "";
                        return (
                          <td
                            key={d.id}
                            className={`p-1 border h-16 align-top ${dropClass}`}
                            title={hint?.ok === false ? (hint.reasons || []).join(", ") : hint?.ok ? "Drop here" : undefined}
                            onDragOver={(e) => {
                              if (!canDrop) return;
                              e.preventDefault();
                              e.dataTransfer.dropEffect = "move";
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              if (!canDrop) return;
                              drop(d, p, e.shiftKey && cells.length > 0);
                            }}
                          >
                            {grouped.map((b) => {
                              const tip = `${b.name} — ${b.items.map((x) => [x.subject || x.short, x.teacher].filter(Boolean).join(" · ")).join("; ")}${b.items[0]?.sections?.length ? ` · ${b.items[0].sections.join(" + ")}` : ""}`;
                              return (
                                <button
                                  key={b.id}
                                  type="button"
                                  title={tip}
                                  onClick={() => setGroupInfo({ name: b.name, day: d.name, period: p.name, items: b.items })}
                                  className="w-full text-left rounded px-1.5 py-1 mb-1 text-xs text-accent-ink bg-accent hover:bg-accent"
                                >
                                  <div className="font-semibold truncate">{b.name}</div>
                                  <div className="text-xs   opacity-90">{b.items.length} subjects</div>
                                </button>
                              );
                            })}
                            {rest.map((a: any) => (
                              <div
                                key={`${a.id}-${a.period_id}`}
                                draggable={!weekFrozen() && !cardLocked(a) && !swapOn}
                                onClick={(e) => {
                                  if (!swapOn) return;
                                  e.preventDefault();
                                  e.stopPropagation();
                                  swapWith(a);
                                }}
                                onDragStart={(e) => {
                                  if (swapOn) {
                                    e.preventDefault();
                                    return;
                                  }
                                  if ((e.target as HTMLElement).closest("button")) {
                                    e.preventDefault();
                                    return;
                                  }
                                  if (weekFrozen() || cardLocked(a)) return;
                                  setDragging({ ...a, allocation_id: a.id });
                                  rememberSlots(a);
                                }}
                                onDragEnd={() => {
                                  setDragging(null);
                                  setSlotMap({});
                                }}
                                className={`period-card group ${swapOn ? "cursor-pointer" : cardLocked(a) ? "cursor-default" : "cursor-grab"} ${swapOn && swapA?.id === a.id ? "ring-2 ring-accent" : ""} ${swapOn && swapA && swapA.id !== a.id ? "ring-1 ring-dashed ring-warn" : ""}`}
                                style={chipStyle(a.color)}
                                title={cardFullTitle(
                                  a,
                                  swapOn
                                    ? swapA?.id === a.id
                                      ? "First card selected. Click another card to swap."
                                      : swapA
                                        ? "Click to swap with the first card."
                                        : "Click to select as first card."
                                    : cardLocked(a)
                                      ? "Locked. Generate will not move it, and it cannot be dragged."
                                      : isJoinedLesson(a)
                                        ? "Shared classes."
                                        : "Drag to Unplaced to remove."
                                )}
                              >
                                <div className="grid grid-cols-[1.25rem_minmax(0,1fr)_1.25rem] items-center gap-0.5">
                                  <span aria-hidden="true" />
                                  <div className="min-w-0 truncate text-center">{cardShortLabel(a)}</div>
                                  <div className="flex items-center justify-end">
                                    {!preview && !weekFrozen() && !cardLocked(a) && !swapOn ? (
                                      <button
                                        type="button"
                                        draggable={false}
                                        className="period-card-x inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-paper-3 text-ink shadow-sm opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-error-well hover:text-error"
                                        title="Remove from this period (back to Unplaced)"
                                        aria-label="Remove from this period"
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onDragStart={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                        }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          deallocate(a);
                                        }}
                                      >
                                        <CloseIcon className="w-3 h-3" />
                                      </button>
                                    ) : (
                                      <span aria-hidden="true" className="inline-block h-5 w-5" />
                                    )}
                                  </div>
                                </div>
                                {!preview && (
                                  <button
                                    type="button"
                                    draggable={false}
                                    className="text-[10px] underline"
                                    disabled={weekFrozen()}
                                    title={
                                      cardLocked(a)
                                        ? "Locked. Generate leaves this card here, and you cannot drag it. Click to clear the lock."
                                        : "Pin. Generate may move this card. Click to lock it in this period."
                                    }
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onDragStart={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                    }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      cycleLock(a);
                                    }}
                                  >
                                    {cardLocked(a) ? "Locked" : "Pin"}
                                  </button>
                                )}
                              </div>
                            ))}
                            {uniqueLessons.size > 1 && !preview && !allGrouped && (
                              <button
                                type="button"
                                onClick={() => openGroup(d, p, cells)}
                                className="mt-0.5 w-full rounded border border-dashed border-accent bg-paper-2 text-xs font-semibold text-accent py-0.5 hover:bg-paper-2"
                              >
                                Save group
                              </button>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          </div>
        </section>
      </div>

      {groupInfo && (
        <div className="fixed inset-0 z-40 flex items-center justify-center scrim p-4" onClick={() => setGroupInfo(null)}>
          <div className="w-full max-w-sm rounded-xl bg-paper-3 border border-rule p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <h2 className="font-semibold text-ink">{groupInfo.name}</h2>
                <p className="text-xs text-muted mt-0.5">
                  {groupInfo.day} · {groupInfo.period}
                </p>
              </div>
              <IconButton icon="close" label="Close" onClick={() => setGroupInfo(null)} />
            </div>
            <ul className="space-y-2">
              {groupInfo.items.map((a: any) => (
                <li key={a.lesson_id} className="rounded-lg border border-rule bg-paper-2 px-3 py-2 text-sm">
                  <div className="font-medium text-ink">{a.subject || a.short}</div>
                  <div className="text-xs text-muted">
                    {[a.teacher, (a.sections || []).join(" + ") || a.section].filter(Boolean).join(" · ")}
                  </div>
                  {isJoinedLesson(a) ? <div className="text-xs text-accent font-semibold mt-0.5">Shared classes</div> : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {sameDayAsk && (
        <div
          className="fixed inset-0 z-50 scrim flex items-start justify-center p-4"
          onClick={() => {
            setSameDayAsk(null);
            setDragging(null);
            setSlotMap({});
          }}
        >
          <div
            className="bg-paper-3 rounded-xl border border-rule w-full max-w-md mt-24 p-5 space-y-3"
            role="dialog"
            aria-labelledby="same-day-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 id="same-day-title" className="text-lg font-semibold text-ink">
                {sameDayAsk.title}
              </h2>
              <IconButton
                icon="close"
                label="Close"
                onClick={() => {
                  setSameDayAsk(null);
                  setDragging(null);
                  setSlotMap({});
                }}
              />
            </div>
            <p className="text-sm text-muted">{sameDayAsk.detail}</p>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                className="h-9 px-3 rounded-lg border border-rule text-sm"
                onClick={() => {
                  setSameDayAsk(null);
                  setDragging(null);
                  setSlotMap({});
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="h-9 px-3 rounded-lg bg-accent text-accent-ink text-sm font-medium"
                onClick={() => commitDrop(sameDayAsk.card, sameDayAsk.day, sameDayAsk.period, sameDayAsk.stackWithShift)}
              >
                Place anyway
              </button>
            </div>
          </div>
        </div>
      )}
      {groupCell && (
        <div className="fixed inset-0 z-40 flex items-center justify-center scrim p-4">
          <div className="w-full max-w-md rounded-xl bg-paper-3 border border-rule p-4">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <h2 className="font-semibold text-ink">Save as group</h2>
                <p className="text-xs text-muted mt-1">
                  {groupCell.day.name} · {groupCell.period.name}. This name is what appears on the timetable. Hover or click the cell later for the subjects inside.
                </p>
              </div>
              <IconButton icon="close" label="Close" onClick={() => setGroupCell(null)} />
            </div>
            <label className="block mb-3">
              <span className="text-xs font-medium text-ink">Group name</span>
              <input
                className="mt-0.5 w-full border border-rule rounded-lg px-2 py-1.5 text-sm"
                value={groupCell.name}
                placeholder="II Language"
                autoFocus
                onChange={(e) => setGroupCell({ ...groupCell, name: e.target.value.toUpperCase() })}
              />
            </label>
            <ul className="text-xs text-muted space-y-1 mb-1">
              {groupCell.members.map((m) => (
                <li key={m.lesson_id}>
                  {m.subject}
                  {m.joined ? <span className="ml-1 text-accent font-semibold">Shared · {m.sections.join(" + ")}</span> : null}
                </li>
              ))}
            </ul>
            {weeklyForMembers(groupCell.members) > 1 && (
              <p className="mt-3 text-sm text-ink bg-paper-2 border border-accent rounded-lg px-3 py-2">
                {groupCell.members.map((m) => m.subject).join(" and ")} run{" "}
                <strong>{weeklyForMembers(groupCell.members)} times</strong> this week (including shared classes). Apply this
                group to all of them, or only this period?
              </p>
            )}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" className="h-9 px-3 rounded-lg border border-rule text-sm" onClick={() => setGroupCell(null)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={savingGroup || !groupCell.name.trim()}
                className="h-9 px-3 rounded-lg border border-rule text-sm disabled:opacity-55"
                onClick={() => saveGroup(false)}
              >
                {savingGroup ? "Saving…" : "This period only"}
              </button>
              {weeklyForMembers(groupCell.members) > 1 && (
                <button
                  type="button"
                  disabled={savingGroup || !groupCell.name.trim()}
                  className="h-9 px-3 rounded-lg bg-accent text-accent-ink text-sm font-medium disabled:opacity-55"
                  onClick={() => saveGroup(true)}
                >
                  {savingGroup ? "Saving…" : `Yes, all ${weeklyForMembers(groupCell.members)} periods`}
                </button>
              )}
              {weeklyForMembers(groupCell.members) <= 1 && (
                <button
                  type="button"
                  disabled={savingGroup || !groupCell.name.trim()}
                  className="h-9 px-3 rounded-lg bg-accent text-accent-ink text-sm font-medium disabled:opacity-55"
                  onClick={() => saveGroup(false)}
                >
                  {savingGroup ? "Saving…" : "Save group"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
