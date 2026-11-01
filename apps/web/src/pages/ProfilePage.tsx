import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { profileFromMe, useAuth, type AuthUser } from "../auth";
import { useToast } from "../ui/Toast";

function initial(name?: string) {
  return (name || "?").trim().charAt(0).toUpperCase() || "?";
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-3 items-center py-1.5">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="min-w-0 text-sm font-medium">{children}</div>
    </div>
  );
}

export default function ProfilePage() {
  const { setUser, user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const first = !user?.username;
  const [name, setName] = useState(user?.name && user.name !== "Staff" ? user.name : "");
  const [email, setEmail] = useState(user?.email || "");
  const [username, setUsername] = useState(user?.username || "");
  const [institution, setInstitution] = useState(user?.institution || "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const shown = name || user?.name || "Add profile";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const profile = await api<AuthUser>("/v1/profile", {
        method: "PUT",
        body: JSON.stringify({ name, email, username, institution }),
      });
      const me = await api("/v1/me", {}, { busy: false });
      setUser(profileFromMe({ ...me, ...profile, institution: profile.institution || undefined, email: profile.email || undefined }));
      toast("Saved");
      if (first) nav("/timetable");
    } catch (ex: any) {
      setErr(ex.message || "Could not save the profile");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-xl">
      <header>
        <h1 className="text-2xl font-semibold">Profile</h1>
        <p className="text-slate-500 text-sm mt-1">This profile stays on this computer. The timetable file stores the username only.</p>
      </header>
      <form onSubmit={save} className="border rounded-lg p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-indigo-500 text-white flex items-center justify-center text-lg font-semibold">
            {initial(shown)}
          </div>
          <div className="font-semibold truncate">{shown}</div>
        </div>
        <div>
          <Row label="Institution">
            <input value={institution} onChange={(e) => setInstitution(e.target.value)} className="w-full bg-transparent border-0 p-0 font-medium border rounded-lg px-2 py-1" placeholder="School name" />
          </Row>
          <Row label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-transparent border-0 p-0 font-medium border rounded-lg px-2 py-1" required />
          </Row>
          <Row label="Email">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full bg-transparent border-0 p-0 font-medium border rounded-lg px-2 py-1" />
          </Row>
          <Row label="Username">
            <input value={username} onChange={(e) => setUsername(e.target.value)} className="w-full bg-transparent border-0 p-0 font-medium border rounded-lg px-2 py-1" required />
          </Row>
        </div>
        {err && <p className="text-sm text-rose-600">{err}</p>}
        <button type="submit" disabled={busy} className="bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-50">
          {user?.username ? "Save profile" : "Add profile"}
        </button>
      </form>
    </div>
  );
}
