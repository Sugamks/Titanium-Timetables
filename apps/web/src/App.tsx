import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./layout/AppShell";
import MyTimetablePage from "./pages/MyTimetablePage";
import ReportsPage from "./pages/ReportsPage";
import WorkspacePage from "./pages/WorkspacePage";
import SchedulingPage from "./pages/SchedulingPage";
import DesignerPage from "./pages/DesignerPage";
import ConstraintsPage from "./pages/ConstraintsPage";
import GeneratePage from "./pages/GeneratePage";
import TimetablePage from "./pages/TimetablePage";
import OperationsPage from "./pages/OperationsPage";
import AnalyzePage from "./pages/AnalyzePage";
import AiPage from "./pages/AiPage";
import ClassTimetablePage from "./pages/ClassTimetablePage";
import GroupsPage from "./pages/GroupsPage";
import AuditPage from "./pages/AuditPage";
import ProfilePage from "./pages/ProfilePage";

function Private({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function LoginOrSkip() {
  return <Navigate to="/timetable" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginOrSkip />} />
      <Route path="/launch" element={<LoginOrSkip />} />
      <Route
        path="/"
        element={
          <Private>
            <AppShell />
          </Private>
        }
      >
        <Route index element={<Navigate to="/timetable" replace />} />
        <Route path="construct" element={<WorkspacePage />} />
        <Route path="groups" element={<GroupsPage />} />
        <Route path="mine" element={<MyTimetablePage />} />
        <Route path="class" element={<ClassTimetablePage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="lessons" element={<SchedulingPage />} />
        <Route path="designer" element={<DesignerPage />} />
        <Route path="constraints" element={<ConstraintsPage />} />
        <Route path="generate" element={<GeneratePage />} />
        <Route path="timetable" element={<TimetablePage />} />
        <Route path="operations" element={<OperationsPage />} />
        <Route path="analyze" element={<AnalyzePage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="ai" element={<AiPage />} />
      </Route>
    </Routes>
  );
}
