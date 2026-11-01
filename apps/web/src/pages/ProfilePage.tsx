import { useState } from "react";
import { api } from "../api";
import { profileFromMe, useAuth, type AuthUser } from "../auth";

function initial(name?: string) {
 return (name || "?").trim().charAt(0).toUpperCase() || "?";
}

export default function ProfilePage() {
 const { setUser, user } = useAuth();
 const [name, setName] = useState(user?.name && user.name !== "Staff" ? user.name : "");
 const [email, setEmail] = useState(user?.email || "");
 const [username, setUsername] = useState(user?.username || "");
 const [institution, setInstitution] = useState(user?.institution || "");
 const [err, setErr] = useState("");
 const [saved, setSaved] = useState("");
 const [busy, setBusy] = useState(false);
 const shown = user?.username ? user.name || user.username : "Add profile";

 async function save(e: React.FormEvent) {
 e.preventDefault();
 setErr("");
 setSaved("");
 setBusy(true);
 try {
 const profile = await api<AuthUser>("/v1/profile", {
 method: "PUT",
 body: JSON.stringify({
 name,
 email,
 username,
 institution,
 }),
 });
 const me = await api("/v1/me", {}, { busy: false });
 setUser(profileFromMe({ ...me, ...profile, institution: profile.institution || undefined, email: profile.email || undefined }));
 setSaved("Saved. The timetable file stores the username only.");
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
 <p className="text-slate-500 text-sm">
 {user?.username
 ? "Name, email, and institution stay on this computer. The timetable file stores the username only."
 : "Please enter your name and username o begin. The timetable will open after you save this profile."}
 </p>
 </header>
 <div className="bg-white border rounded-lg p-5 space-y-4">
 <div className="flex items-center gap-3">
 <div className="w-12 h-12 rounded-lg bg-slate-50 text-slate-900 flex items-center justify-center text-lg font-semibold">
 {initial(shown)}
 </div>
 <div className="min-w-0">
 <div className="font-semibold truncate">{shown}</div>
 {user?.institution && <div className="text-sm text-slate-500 truncate">{user.institution}</div>}
 {user?.username && <div className="text-sm text-slate-500 truncate">{user.username}</div>}
 </div>
 </div>
 <form onSubmit={save} className="space-y-3">
 <label className="block text-sm">
 <span className="text-slate-500">Name</span>
 <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2" required />
 </label>
 <label className="block text-sm">
 <span className="text-slate-500">Email</span>
 <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2" />
 </label>
 <label className="block text-sm">
 <span className="text-slate-500">Username</span>
 <input value={username} onChange={(e) => setUsername(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2" required />
 </label>
 <label className="block text-sm">
 <span className="text-slate-500">Institution</span>
 <input value={institution} onChange={(e) => setInstitution(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2" placeholder="School name" />
 </label>
 {err && <p className="text-sm text-rose-600">{err}</p>}
 {saved && <p className="text-sm text-emerald-700">{saved}</p>}
 <button type="submit" disabled={busy} className="bg-indigo-600 text-white text-white rounded-lg px-4 py-2 text-sm disabled:opacity-50">
 {user?.username ? "Save profile" : "Add profile"}
 </button>
 </form>
 </div>
 </div>
 );
}
