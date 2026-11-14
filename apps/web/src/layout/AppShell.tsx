import { useEffect, useState } from "react";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { profileFromMe, useAuth } from "../auth";
import { useTheme } from "../theme";
import FirstVisit from "../ui/FirstVisit";
import SearchSelect from "../ui/SearchSelect";
import UpdateOffer from "../ui/UpdateOffer";
import { IconButton, icons, type ActionIcon } from "../ui/icons";
import { currentYearId, onYearChange, setCurrentYearId } from "../year";

const SIDEBAR_KEY = "sidebar-collapsed";

type NavItem = { to: string; label: string; icon: ActionIcon; hint?: string };
type NavGroup = { heading: string; items: NavItem[] };

export default function AppShell() {
  const { setUser, user } = useAuth();
  const { isDark, toggleDark } = useTheme();
  const [academicYearId, setAcademicYearId] = useState(currentYearId);
  const [academicYears, setAcademicYears] = useState<{ id: string; name: string }[]>([]);
  const [narrowOpen, setNarrowOpen] = useState(false);
  const [guideNonce, setGuideNonce] = useState(0);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === "1";
    } catch {
      return false;
    }
  });
  const location = useLocation();
  const navTo = useNavigate();
  const needsProfile = !user?.username;
  const canConstruct = user?.can_construct !== false && (user?.can_construct || !user);

  const nav: NavGroup[] = canConstruct
    ? [
        {
          heading: "Timetable",
          items: [
            { to: "/timetable", label: "Templates", icon: "calendar", hint: "Settings, bell times & breaks" },
            { to: "/construct", label: "Construct", icon: "grid", hint: "Lessons, generate, save" },
            { to: "/reports", label: "Reports", icon: "chart", hint: "Class, staff, subject" },
            { to: "/mine", label: "My timetable", icon: "user", hint: "Staff week" },
            { to: "/class", label: "Class timetable", icon: "users", hint: "Parent / class week" },
          ],
        },
        {
          heading: "Advanced",
          items: [
            { to: "/operations", label: "Substitution", icon: "calendar", hint: "Absence and cover" },
            { to: "/rooms", label: "Rooms", icon: "grid", hint: "Rooms the generator can assign" },
            { to: "/constraints", label: "Constraints", icon: "sliders", hint: "Staff, class, other" },
            { to: "/analyze", label: "Quality", icon: "chart", hint: "Hard checks and score" },
            { to: "/audit", label: "Audit", icon: "view", hint: "What changed" },
          ],
        },
      ]
    : [
        {
          heading: "Timetable",
          items: [
            { to: "/mine", label: "My timetable", icon: "user", hint: "Your published week" },
            { to: "/class", label: "Class timetable", icon: "users", hint: "Class week" },
          ],
        },
      ];

  useEffect(() => {
    api("/v1/me")
      .then((m) => setUser(profileFromMe(m)))
      .catch(() => undefined);
    api("/v1/catalog")
      .then((c) => {
        const years = c.academic_years || [];
        const withData = new Set((c.sections || []).map((s: { academic_year_id?: string }) => s.academic_year_id).filter(Boolean));
        for (const s of c.subjects || []) {
          for (const yid of s.academic_year_ids || []) withData.add(yid);
        }
        const useful = years.filter((y: { id: string }) => withData.has(y.id));
        const list = useful.length ? useful : years;
        setAcademicYears(list);
        const stored = currentYearId();
        const next =
          (stored && list.some((y: { id: string }) => y.id === stored) && stored) ||
          list[0]?.id ||
          "";
        setAcademicYearId(next);
        if (next && next !== stored) setCurrentYearId(next);
      })
      .catch(() => undefined);
    return onYearChange(() => setAcademicYearId(currentYearId()));
  }, []);

  useEffect(() => {
    setNarrowOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const open = () => setNarrowOpen(true);
    window.addEventListener("tt-open-menu", open);
    return () => window.removeEventListener("tt-open-menu", open);
  }, []);

  function changeYear(id: string) {
    setAcademicYearId(id);
    setCurrentYearId(id);
  }

  function toggleSidebar() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const compact = collapsed && !narrowOpen;

  return (
    <div className="h-screen overflow-hidden flex app-canvas">
      <UpdateOffer />
      <FirstVisit nonce={guideNonce} />
      <aside
        className={`${compact ? "w-16" : "w-56"} shrink-0 h-full app-sidebar flex flex-col${narrowOpen ? " is-open" : ""}`}
      >
        <div className={`border-b app-sidebar-line ${collapsed ? "px-1.5 py-3" : "px-4 py-5"}`}>
          <div className={`flex items-start ${collapsed ? "flex-col items-center gap-2" : "justify-between gap-2"}`}>
            {!collapsed && (
              <div className="min-w-0">
                <div className="font-semibold text-sm leading-tight whitespace-nowrap">TITANIUM TIMETABLES</div>
                <div className="mt-0.5 text-xs leading-tight whitespace-nowrap app-sidebar-muted">
                  Powered by <a href="https://nextelement.in/" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 text-accent text-accent hover:text-accent">Next Element</a>
                </div>
              </div>
            )}
            <IconButton
              icon={collapsed ? "chevronRight" : "chevronLeft"}
              label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="app-sidebar-icon shrink-0"
              onClick={toggleSidebar}
            />
          </div>
        </div>
        {!collapsed && (
          <div className="px-3 pt-3 pb-2 text-xs app-sidebar-muted">
            Academic year
            <div className="mt-1">
              <SearchSelect
                value={academicYearId}
                onChange={changeYear}
                allowEmpty={!academicYearId}
                emptyLabel="Select year"
                placeholder="Search year…"
                options={academicYears.map((y) => ({ value: y.id, label: y.name }))}
              />
            </div>
          </div>
        )}
        <nav className="sidebar-nav flex-1 p-2 space-y-1">
          {nav.map((group, gi) => (
            <div
              key={group.heading}
              className={gi > 0 ? "pt-2 mt-2 border-t app-sidebar-line mx-1" : ""}
            >
              {!compact && (
                <div className="px-3 mb-1 text-xs app-sidebar-muted">{group.heading}</div>
              )}
              <div className="space-y-0.5">
                {group.items.map((l) => {
                  const Icon = icons[l.icon];
                  return (
                    <NavLink
                      key={l.to}
                      to={l.to}
                      end={l.to === "/construct" || l.to === "/timetable"}
                      data-tour={
                        l.to === "/timetable" ? "templates"
                        : l.to === "/construct" ? "construct"
                        : l.to === "/rooms" ? "rooms"
                        : l.to === "/constraints" ? "constraints"
                        : undefined
                      }
                      title={compact ? `${l.label}${l.hint ? `: ${l.hint}` : ""}` : undefined}
                      className={({ isActive }) =>
                        `flex items-center rounded-md text-sm ${
                          compact ? "justify-center px-0 py-2.5" : "px-3 py-2"
                        } ${isActive ? "bg-accent text-accent-ink" : "app-sidebar-link"}`
                      }
                    >
                      {compact ? (
                        <Icon className="w-[18px] h-[18px]" />
                      ) : (
                        <span>
                          <div>{l.label}</div>
                          {l.hint && <div className="text-xs opacity-70 leading-tight">{l.hint}</div>}
                        </span>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="flex-shrink-0 border-t app-sidebar-line p-2.5">
            <button
              type="button"
              onClick={() => navTo("/profile")}
              title={user?.name || "Profile"}
              className={`w-full flex items-center gap-2.5 rounded-lg text-left transition-colors ${
                compact ? "justify-center min-h-10" : "px-1.5 py-1.5"
              } ${location.pathname === "/profile" ? "bg-accent text-accent-ink" : "app-sidebar-link"}`}
            >
              <span className="w-8 h-8 rounded-full flex-shrink-0 app-sidebar-avatar flex items-center justify-center overflow-hidden">
                <span className="font-semibold text-sm">
                  {(user?.name || user?.username || "?").trim().charAt(0).toUpperCase() || "?"}
                </span>
              </span>
              {!compact && (
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold leading-tight">{user?.name || "Add profile"}</span>
                  <span className="block truncate text-xs leading-tight app-sidebar-muted">{user?.username || ""}</span>
                </span>
              )}
            </button>
            <div className={`mt-1.5 flex gap-1 ${compact ? "flex-col items-center" : ""}`}>
              <button
                type="button"
                onClick={toggleDark}
                data-tour="theme"
                className={`flex items-center justify-center gap-2 min-h-10 text-sm app-sidebar-chip ${
                  compact ? "w-10" : "flex-1 px-2"
                }`}
                title={isDark ? "Switch to light mode" : "Switch to dark mode"}
                aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
              >
                {isDark ? <icons.sun className="w-3.5 h-3.5" /> : <icons.moon className="w-3.5 h-3.5" />}
                {!compact && <span>{isDark ? "Light" : "Dark"}</span>}
              </button>
              <button
                type="button"
                onClick={() => setGuideNonce((n) => n + 1)}
                className={`flex items-center justify-center min-h-10 text-sm app-sidebar-chip ${compact ? "px-1 text-xs" : "flex-1"}`}
                aria-label="Guide"
              >
                Guide
              </button>
            </div>
        </div>
      </aside>
      <main className="flex-1 min-h-0 min-w-0 overflow-auto p-6">
        <button type="button" className="shell-menu" onClick={() => setNarrowOpen(true)}>Menu</button>
        <button type="button" className={`shell-scrim${narrowOpen ? " is-open" : ""}`} aria-label="Close menu" onClick={() => setNarrowOpen(false)} />
        <div key={location.pathname} className="screen-in">
          {needsProfile && location.pathname !== "/profile" ? <Navigate to="/profile" replace /> : <Outlet />}
        </div>
      </main>
    </div>
  );
}
