import { useEffect, useMemo, useState } from "react";
import { api, getToken } from "../../api";
import { chipStyle } from "../../ui/colors";
import { cardFullTitle, cardShortLabel } from "../../ui/lessonMarks";
import { isTeachingPeriod, periodTypeLabel } from "../../periods";
import { IconButton } from "../../ui/icons";
import ErrorBanner from "../../ui/ErrorBanner";
import SearchSelect from "../../ui/SearchSelect";

type View = "section" | "teacher" | "subject" | "unplaced" | "teacher_load" | "class_load";

const VIEWS: { id: View; label: string }[] = [
    { id: "section", label: "Class" },
    { id: "teacher", label: "Teacher" },
    { id: "subject", label: "Subject" },
    { id: "unplaced", label: "Unplaced" },
    { id: "teacher_load", label: "Teacher load" },
    { id: "class_load", label: "Class load" },
];

const TEMPLATE_KEY = "construct-template-id";

export default function ReportsPanel({ yearId, tts }: { yearId: string; tts: any[] }) {
    const [data, setData] = useState<any>(null);
    const [view, setView] = useState<View>("section");
    const [entity, setEntity] = useState("");
    const [err, setErr] = useState("");
    const [downloading, setDownloading] = useState(false);
    const [lane, setLane] = useState<"WEEK_A" | "WEEK_B">("WEEK_A");
    const [timetableId, setTimetableId] = useState(() => {
        try {
            return sessionStorage.getItem(TEMPLATE_KEY) || "";
        } catch {
            return "";
        }
    });
    const [versionId, setVersionId] = useState("");

    useEffect(() => {
        if (!tts.length) return;
        setTimetableId((prev) => (prev && tts.some((t) => t.id === prev) ? prev : tts[0]?.id || ""));
    }, [tts]);

    useEffect(() => {
        try {
            if (timetableId) sessionStorage.setItem(TEMPLATE_KEY, timetableId);
        } catch {
            /* ignore */
        }
    }, [timetableId]);

    const selectedTemplate = tts.find((t) => t.id === timetableId);
    const versionOptions = useMemo(() => {
        const rows = [...(selectedTemplate?.versions || [])].sort((a: any, b: any) => (b.number || 0) - (a.number || 0));
        return rows.map((v: any) => ({
            value: v.id,
            label: `v${v.number} · ${v.status || "draft"}${v.label ? ` · ${v.label}` : ""}`,
        }));
    }, [selectedTemplate]);

    useEffect(() => {
        if (!versionOptions.length) {
            setVersionId("");
            return;
        }
        setVersionId((prev) => (prev && versionOptions.some((v) => v.value === prev) ? prev : versionOptions[0].value));
    }, [timetableId, versionOptions]);

    const separateWeeks = Boolean(data?.separate_weeks);

    function cellOk(c: any) {
        if (!separateWeeks) return true;
        const code = c.week_code || "ALL";
        return code === "ALL" || code === lane;
    }

    async function load() {
        setErr("");
        if (!versionId) {
            setData({ ok: false, error: "Pick a template with a generated timetable." });
            return;
        }
        const q = new URLSearchParams();
        q.set("version_id", versionId);
        if (yearId) q.set("academic_year_id", yearId);
        try {
            const r = await api(`/v1/reports/timetable?${q.toString()}`);
            setData(r);
            setEntity("");
            if (r?.separate_weeks) setLane((prev) => prev || "WEEK_A");
        } catch (e: any) {
            setErr(e.message);
        }
    }

    useEffect(() => {
        load();
    }, [yearId, versionId]);

    const groups = useMemo(() => {
        if (!data) return [];
        const map: Record<string, any[]> = {
            section: data.sections || [],
            teacher: data.teachers || [],
            subject: data.subjects || [],
        };
        const raw = map[view] || [];
        if (!separateWeeks) return raw;
        return raw.map((g: any) => {
            const cells: Record<string, any[]> = {};
            for (const [slot, list] of Object.entries(g.cells || {})) {
                const kept = (list as any[]).filter(cellOk);
                if (kept.length) cells[slot] = kept;
            }
            return { ...g, cells, placed: Object.values(cells).reduce((n, list) => n + list.length, 0) };
        });
    }, [data, view, separateWeeks, lane]);

    const shown = entity ? groups.filter((g: any) => g.name === entity) : groups;

    const unplacedRows = useMemo(() => {
        if (!data) return [];
        if (separateWeeks) return data.unplaced_lanes?.[lane] || data.unplaced || [];
        return data.unplaced || [];
    }, [data, separateWeeks, lane]);

    const loadRows = useMemo(() => {
        if (!data) return [];
        if (view !== "teacher_load" && view !== "class_load") return [];
        if (separateWeeks) {
            const map = view === "class_load" ? data.class_load_lanes : data.teacher_load_lanes;
            return map?.[lane] || data[view] || [];
        }
        return data[view] || [];
    }, [data, view, separateWeeks, lane]);

    async function downloadExcel() {
        const q = new URLSearchParams();
        if (versionId) q.set("version_id", versionId);
        if (yearId) q.set("academic_year_id", yearId);
        q.set("view", view);
        if (entity) q.set("entity", entity);
        if (separateWeeks) q.set("week_lane", lane);
        setDownloading(true);
        try {
            const token = getToken();
            const res = await fetch(`/v1/reports/timetable.xlsx?${q.toString()}`, {
                headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            if (!res.ok) {
                const ex = await res.text();
                throw new Error(ex || "Download failed");
            }
            const blob = await res.blob();
            const match = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "");
            const name = match?.[1] || "timetable.xlsx";
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = name;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e: any) {
            setErr(e.message || "Download failed");
        } finally {
            setDownloading(false);
        }
    }

    if (err) return <ErrorBanner message={err} onClear={() => setErr("")} />;
    if (!tts.length) {
        return <div className="bg-paper-3 border rounded-xl p-8 text-sm text-muted text-center">Create a template first.</div>;
    }
    if (!data) return <div className="text-muted text-sm">Loading reports…</div>;
    if (!data.ok) {
        return <div className="bg-paper-3 border rounded-xl p-8 text-sm text-muted text-center">{data.error}</div>;
    }

    const days = data.days || [];
    const periods = data.periods || [];

    return (
        <div className="report-print flex-1 min-h-0 flex flex-col gap-4">
            <div className="shrink-0 flex gap-1 border-b border-rule print:hidden">
                {VIEWS.map((v) => (
                    <button
                        key={v.id}
                        type="button"
                        onClick={() => {
                            setView(v.id);
                            setEntity("");
                        }}
                        className={`tab-link px-4 py-2 text-sm ${
                            view === v.id
                                ? "bg-paper-3 border border-b-paper-3 border-rule -mb-px font-medium text-ink"
                                : "text-muted hover:text-ink"
                        }`}
                    >
                        {v.label}
                    </button>
                ))}
            </div>

            <div className="shrink-0 flex flex-wrap gap-2 items-center print:hidden">
                <div className="w-56">
                    <SearchSelect
                        value={timetableId}
                        onChange={(id) => {
                            setTimetableId(id);
                            setVersionId("");
                        }}
                        options={tts.map((t) => ({ value: t.id, label: t.name }))}
                        placeholder="Search template"
                    />
                </div>
                {versionOptions.length > 0 ? (
                    <div className="w-52">
                        <SearchSelect
                            value={versionId}
                            onChange={setVersionId}
                            options={versionOptions}
                            placeholder="Search version"
                        />
                    </div>
                ) : null}
                {groups.length > 0 && (
                    <select className="border rounded-lg px-2 py-1.5 text-sm bg-paper-3" value={entity} onChange={(e) => setEntity(e.target.value)}>
                        <option value="">All</option>
                        {groups.map((g: any) => (
                            <option key={g.name} value={g.name}>
                                {g.name}
                            </option>
                        ))}
                    </select>
                )}
                {separateWeeks ? (
                    <>
                        {(["WEEK_A", "WEEK_B"] as const).map((code) => (
                            <button
                                key={code}
                                type="button"
                                onClick={() => {
                                    if (code === lane) return;
                                    setLane(code);
                                }}
                                className={`text-sm px-3 py-1.5 rounded-lg ${lane === code ? "bg-accent text-accent-ink" : "bg-paper-2"}`}
                            >
                                {code === "WEEK_A" ? "Odd week" : "Even week"}
                            </button>
                        ))}
                    </>
                ) : null}
                <div className="ml-auto">
                    <IconButton
                        icon="download"
                        label={downloading ? "Downloading…" : "Download"}
                        variant="bordered"
                        disabled={downloading || !versionId}
                        onClick={downloadExcel}
                    />
                </div>
            </div>

            <div key={`${timetableId}-${view}`} className="motion-swap flex-1 min-h-0 overflow-y-auto space-y-4">
                <div key={separateWeeks ? lane : "all"} className={separateWeeks ? "motion-week space-y-4" : "space-y-4"}>
                    {view === "unplaced" && (
                        <section className="bg-paper-3 border rounded-xl overflow-hidden">
                            <table className="w-full text-sm">
                                <thead className="bg-paper-2 text-left">
                                    <tr>
                                        <th className="p-3">Subject</th>
                                        <th className="p-3">Class</th>
                                        <th className="p-3">Teacher</th>
                                        <th className="p-3">Missing cards</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {unplacedRows.length === 0 ? (
                                        <tr>
                                            <td className="p-6 text-muted" colSpan={4}>
                                                Every lesson card is placed
                                                {separateWeeks ? ` on ${lane === "WEEK_A" ? "Odd week" : "Even week"}` : ""}.
                                            </td>
                                        </tr>
                                    ) : (
                                        unplacedRows.map((u: any) => (
                                            <tr key={u.id} className="border-t">
                                                <td className="p-3">{u.subject}</td>
                                                <td className="p-3">{u.section}</td>
                                                <td className="p-3">{u.teacher}</td>
                                                <td className="p-3">{u.missing}</td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </section>
                    )}

                    {(view === "teacher_load" || view === "class_load") && (
                        <section className="bg-paper-3 border rounded-xl overflow-hidden">
                            <table className="w-full text-sm">
                                <thead className="bg-paper-2 text-left">
                                    <tr>
                                        <th className="p-3">Name</th>
                                        <th className="p-3">Placed</th>
                                        <th className="p-3">Required</th>
                                        <th className="p-3">Free slots</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {loadRows.map((r: any) => (
                                        <tr key={r.name} className="border-t">
                                            <td className="p-3">{r.name}</td>
                                            <td className="p-3">{r.placed}</td>
                                            <td className="p-3">{r.required}</td>
                                            <td className="p-3">{r.free}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </section>
                    )}

                    {["section", "teacher", "subject"].includes(view) && (
                        <div className="space-y-6">
                            {shown.length === 0 && (
                                <div className="bg-paper-3 border rounded-xl p-8 text-sm text-muted text-center">
                                    Nothing placed for this template yet. Generate a timetable first.
                                </div>
                            )}
                            {shown.map((g: any) => (
                                <section key={g.name} className="bg-paper-3 border rounded-xl overflow-hidden break-inside-avoid">
                                    <h2 className="px-4 py-3 font-semibold border-b bg-paper-2">{g.name}</h2>
                                    <table className="w-full text-xs border-collapse">
                                        <thead>
                                            <tr>
                                                <th className="p-2 border bg-paper-3">Period</th>
                                                {days.map((d: any) => (
                                                    <th key={d.id} className="p-2 border">
                                                        {d.name.slice(0, 3)}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {periods.map((p: any) => (
                                                <tr key={p.id} className={!isTeachingPeriod(p) ? "bg-warn-well" : ""}>
                                                    <td className="p-2 border font-medium bg-paper-2">
                                                        {p.name}
                                                        {p.start_time && <div className="text-xs text-muted">{p.start_time}</div>}
                                                    </td>
                                                    {!isTeachingPeriod(p) ? (
                                                        <td className="p-2 border text-center italic text-warn" colSpan={days.length}>
                                                            {periodTypeLabel(p.period_type)}
                                                        </td>
                                                    ) : (
                                                        days.map((d: any) => (
                                                            <td key={d.id} className="p-1 border align-top h-14">
                                                                {(g.cells?.[`${d.id}|${p.id}`] || []).map((c: any, i: number) => (
                                                                    <div key={i} className="period-card" style={chipStyle(c.color)} title={cardFullTitle(c)}>
                                                                        {cardShortLabel(c)}
                                                                    </div>
                                                                ))}
                                                            </td>
                                                        ))
                                                    )}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </section>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
