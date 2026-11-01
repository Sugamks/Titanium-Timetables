import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { profileFromMe, useAuth } from "../auth";
import ErrorBanner from "../ui/ErrorBanner";
import UpdateOffer from "../ui/UpdateOffer";

export default function LoginPage() {
  const { setToken, setUser } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [institution, setInstitution] = useState("");
  const [allowDev, setAllowDev] = useState(false);

  useEffect(() => {
    api<{ institution?: string; poc_mode?: boolean }>("/health", {}, { busy: false })
      .then((h) => {
        setInstitution(h.institution || "");
        setAllowDev(!!h.poc_mode);
      })
      .catch(() => undefined);
  }, []);

  async function enter(token: string, roles?: string[]) {
    setToken(token);
    const me = await api<{
      can_construct?: boolean;
      name?: string;
      email?: string;
      username?: string;
      roles?: string[];
    }>("/v1/me");
    setUser(profileFromMe(me, roles));
    nav(me.can_construct ? "/timetable" : "/mine");
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const r = await api<{ token: string; roles?: string[] }>("/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      await enter(r.token, r.roles);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <UpdateOffer />
    <div className="min-h-full grid place-items-center bg-slate-100">
      <div className="bg-white rounded-xl shadow-sm border p-8 w-full max-w-md">
        <h1 className="text-2xl font-semibold">Scheduling Platform</h1>
        {institution && <p className="text-sm font-medium text-slate-800 mt-1">{institution}</p>}
        <p className="text-slate-500 mt-1 text-sm">Sign in with your username and password.</p>
        <form onSubmit={signIn} className="mt-6 space-y-3">
          <label className="block text-sm">
            Username
            <input
              className="mt-1 w-full border rounded-md px-3 py-2"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label className="block text-sm">
            Password
            <input
              type="password"
              className="mt-1 w-full border rounded-md px-3 py-2"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <button disabled={busy} className="w-full bg-slate-900 text-white rounded-md py-2 disabled:opacity-50">
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        {allowDev && (
          <button
            type="button"
            disabled={busy}
            className="mt-3 w-full border rounded-md py-2 text-sm text-slate-600"
            onClick={async () => {
              setErr("");
              setBusy(true);
              try {
                const r = await api<{ token: string; roles?: string[] }>("/v1/auth/dev-login", {
                  method: "POST",
                  body: JSON.stringify({ name: "POC Admin", role: "scheduler_admin" }),
                });
                await enter(r.token, r.roles);
              } catch (e: any) {
                setErr(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Dev sign in
          </button>
        )}
        <ErrorBanner className="mt-3" message={err} onClear={() => setErr("")} />
      </div>
    </div>
    </>
  );
}
