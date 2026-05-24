import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "./AuthProvider.js";
import { authApi } from "../api/endpoints.js";
import { ApiError } from "../api/client.js";

export default function LoginPage() {
  const { login, user, org } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { orgSlug: orgFromUrl } = useParams<{ orgSlug?: string }>();

  const [orgSlug, setOrgSlug] = useState(orgFromUrl ?? "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState({ google: false, microsoft: false });

  const from = (location.state as { from?: string } | null)?.from;

  useEffect(() => {
    if (user && org) navigate(from ?? `/app/${org.slug}/dashboard`, { replace: true });
  }, [user, org, navigate, from]);

  useEffect(() => {
    authApi.providers().then(setProviders).catch(() => {});
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await login(orgSlug.trim(), email, password);
      navigate(from ?? `/app/${r.orgSlug}/dashboard`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign in failed.");
    } finally {
      setBusy(false);
    }
  }

  function ssoHref(provider: "google" | "microsoft"): string {
    return `/api/auth/${provider}?org=${encodeURIComponent(orgSlug.trim())}`;
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-paper">
      <div className="w-full max-w-md">
        <p className="font-mono text-xs uppercase tracking-widest text-ink/60 mb-3">Relay</p>
        <h1 className="font-display text-4xl mb-2">Sign in</h1>
        <p className="text-ink/70 mb-8">
          Use your work email or single sign-on. Need a new workspace? <Link to="/register" className="underline">Create one</Link>.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium">Organization slug</span>
            <input
              type="text" required value={orgSlug} placeholder="acme"
              onChange={(e) => setOrgSlug(e.target.value)}
              className="mt-1 block w-full rounded-xl border border-ink/15 bg-white px-4 py-3 font-mono focus:outline-none focus:ring-2 focus:ring-ink/20"
            />
            <span className="text-xs text-ink/60 mt-1 block">The short name your admin gave you. Try <code>acme</code> or <code>globex</code>.</span>
          </label>

          <label className="block">
            <span className="text-sm font-medium">Email</span>
            <input
              type="email" autoComplete="email" required value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded-xl border border-ink/15 bg-white px-4 py-3 focus:outline-none focus:ring-2 focus:ring-ink/20"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">Password</span>
            <input
              type="password" autoComplete="current-password" required value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full rounded-xl border border-ink/15 bg-white px-4 py-3 focus:outline-none focus:ring-2 focus:ring-ink/20"
            />
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit" disabled={busy || !orgSlug.trim()}
            className="w-full rounded-full bg-ink text-lime font-medium px-5 py-3 disabled:opacity-50"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {(providers.google || providers.microsoft) && (
          <>
            <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-widest text-ink/40">
              <span className="flex-1 h-px bg-ink/10" /> or <span className="flex-1 h-px bg-ink/10" />
            </div>
            <div className="space-y-2">
              {providers.google && (
                <a
                  href={orgSlug.trim() ? ssoHref("google") : "#"}
                  aria-disabled={!orgSlug.trim()}
                  className={`block text-center rounded-full border border-ink/15 px-5 py-3 ${orgSlug.trim() ? "hover:bg-ink/5" : "opacity-40 cursor-not-allowed"}`}
                >
                  Continue with Google
                </a>
              )}
              {providers.microsoft && (
                <a
                  href={orgSlug.trim() ? ssoHref("microsoft") : "#"}
                  aria-disabled={!orgSlug.trim()}
                  className={`block text-center rounded-full border border-ink/15 px-5 py-3 ${orgSlug.trim() ? "hover:bg-ink/5" : "opacity-40 cursor-not-allowed"}`}
                >
                  Continue with Microsoft
                </a>
              )}
            </div>
            {!orgSlug.trim() && (providers.google || providers.microsoft) && (
              <p className="text-xs text-ink/50 mt-2">Enter your org slug first to enable SSO.</p>
            )}
          </>
        )}

        <p className="mt-8 text-xs text-ink/50">
          Seeded logins for the demo (password <code>relay1234</code>):<br/>
          <code>acme</code> · admin@relay.io · agent@relay.io · employee@relay.io<br/>
          <code>globex</code> · admin@globex.io · agent@globex.io · employee@globex.io<br/>
          <code>relay</code> · platform@relay.io (platform admin)
        </p>
      </div>
    </div>
  );
}
