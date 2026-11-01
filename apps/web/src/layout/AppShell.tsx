import { useEffect, useState } from "react";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { profileFromMe, useAuth } from "../auth";
import { useTheme } from "../theme";
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
            { to: "/constraints", label: "Constraints", icon: "sliders", hint: "Staff, class, other" },
            { to: "/analyze", label: "Quality", icon: "chart", hint: "Hard checks and score" },
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

  return (
    <div className="h-screen overflow-hidden flex app-canvas">
      <UpdateOffer />
      <aside
        className={`${collapsed ? "w-16" : "w-56"} shrink-0 h-full app-sidebar flex flex-col transition-[width] duration-200`}
      >
        <div className={`border-b app-sidebar-line ${collapsed ? "px-1.5 py-3" : "px-4 py-5"}`}>
          <div className={`flex items-start ${collapsed ? "flex-col items-center gap-2" : "justify-between gap-2"}`}>
            {!collapsed && (
              <div className="min-w-0">
                <div className="font-semibold text-[13px] leading-tight whitespace-nowrap">TITANIUM TIMETABLES</div>
                <div className="mt-0.5 text-[11px] leading-tight whitespace-nowrap app-sidebar-muted">
                  Powered by <a href="https://nextelement.in/" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 text-indigo-600 dark:text-indigo-300 hover:text-indigo-500">Next Element</a>
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
          <label className="px-3 pt-3 pb-2 text-xs app-sidebar-muted">
            Academic year
            <select
              className="mt-1 w-full app-sidebar-control rounded-lg px-2 py-1.5 text-sm"
              value={academicYearId}
              onChange={(e) => changeYear(e.target.value)}
              aria-label="Academic year"
            >
              {!academicYearId && <option value="">Select year</option>}
              {academicYears.map((y) => (
                <option key={y.id} value={y.id}>{y.name}</option>
              ))}
            </select>
          </label>
        )}
        <nav className="sidebar-nav flex-1 p-2 space-y-1">
          {nav.map((group, gi) => (
            <div
              key={group.heading}
              className={gi > 0 ? "pt-2 mt-2 border-t app-sidebar-line mx-1" : ""}
            >
              {!collapsed && (
                <div className="px-3 mb-1 text-[10px] uppercase tracking-wider app-sidebar-muted">{group.heading}</div>
              )}
              <div className="space-y-0.5">
                {group.items.map((l) => {
                  const Icon = icons[l.icon];
                  return (
                    <NavLink
                      key={l.to}
                      to={l.to}
                      end={l.to === "/construct" || l.to === "/timetable"}
                      title={collapsed ? `${l.label}${l.hint ? ` · ${l.hint}` : ""}` : undefined}
                      className={({ isActive }) =>
                        `flex items-center rounded-md text-sm ${
                          collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2"
                        } ${isActive ? "bg-indigo-500 text-white" : "app-sidebar-link"}`
                      }
                    >
                      {collapsed ? (
                        <Icon className="w-[18px] h-[18px]" />
                      ) : (
                        <span>
                          <div>{l.label}</div>
                          {l.hint && <div className="text-[11px] opacity-70 leading-tight">{l.hint}</div>}
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
                collapsed ? "justify-center h-10" : "px-1.5 py-1.5"
              } ${location.pathname === "/profile" ? "bg-indigo-500/15" : "app-sidebar-link"}`}
            >
              <span className="w-8 h-8 rounded-full flex-shrink-0 app-sidebar-avatar flex items-center justify-center overflow-hidden">
                <span className="font-semibold text-[13px]">
                  {(user?.name || user?.username || "?").trim().charAt(0).toUpperCase() || "?"}
                </span>
              </span>
              {!collapsed && (
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold leading-tight">{user?.name || "Add profile"}</span>
                  <span className="block truncate text-[11px] leading-tight app-sidebar-muted">{user?.username || ""}</span>
                </span>
              )}
            </button>
            <div className={`mt-1.5 flex gap-1 ${collapsed ? "flex-col items-center" : ""}`}>
              <button
                type="button"
                onClick={toggleDark}
                className={`flex items-center justify-center gap-2 rounded-lg h-8 text-[12px] font-medium app-sidebar-muted app-sidebar-icon transition-colors ${
                  collapsed ? "w-9" : "flex-1"
                }`}
                title={isDark ? "Switch to light mode" : "Switch to dark mode"}
                aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
              >
                {isDark ? <icons.sun className="w-3.5 h-3.5 text-amber-400" /> : <icons.moon className="w-3.5 h-3.5" />}
                {!collapsed && <span>{isDark ? "Light" : "Dark"}</span>}
              </button>
            </div>
        </div>
      </aside>
      <main className="flex-1 min-h-0 min-w-0 overflow-auto p-6">
        {needsProfile && location.pathname !== "/profile" ? <Navigate to="/profile" replace /> : <Outlet />}
      </main>
    </div>
  );
}
