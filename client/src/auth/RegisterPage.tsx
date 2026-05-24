import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider.js";
import { ApiError } from "../api/client.js";

export default function RegisterPage() {
  const { register, user, org } = useAuth();
  const navigate = useNavigate();

  const [organizationName, setOrganizationName] = useState("");
  const [organizationSlug, setOrganizationSlug] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user && org) navigate(`/app/${org.slug}/dashboard`, { replace: true });
  }, [user, org, navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await register({
        organizationName,
        organizationSlug: organizationSlug.trim() || undefined,
        name, email, password,
      });
      navigate(`/app/${r.orgSlug}/dashboard`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the workspace.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-paper py-12">
      <div className="w-full max-w-md">
        <p className="font-mono text-xs uppercase tracking-widest text-ink/60 mb-3">Relay</p>
        <h1 className="font-display text-4xl mb-2">Create a workspace</h1>
        <p className="text-ink/70 mb-8">You'll be the first ADMIN. Invite teammates afterwards.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium">Organization name</span>
            <input
              type="text" required value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              className="mt-1 block w-full rounded-xl border border-ink/15 bg-white px-4 py-3 focus:outline-none focus:ring-2 focus:ring-ink/20"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Organization slug <span className="text-ink/40">(optional)</span></span>
            <input
              type="text" value={organizationSlug} placeholder="auto-generated from name"
              onChange={(e) => setOrganizationSlug(e.target.value)}
              className="mt-1 block w-full rounded-xl border border-ink/15 bg-white px-4 py-3 font-mono focus:outline-none focus:ring-2 focus:ring-ink/20"
            />
            <span className="text-xs text-ink/60 mt-1 block">Lower-case letters, numbers and hyphens. Becomes your URL: /app/&lt;slug&gt;/...</span>
          </label>
          <label className="block">
            <span className="text-sm font-medium">Your name</span>
            <input
              type="text" autoComplete="name" required value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 block w-full rounded-xl border border-ink/15 bg-white px-4 py-3 focus:outline-none focus:ring-2 focus:ring-ink/20"
            />
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
              type="password" autoComplete="new-password" required minLength={8} value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full rounded-xl border border-ink/15 bg-white px-4 py-3 focus:outline-none focus:ring-2 focus:ring-ink/20"
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit" disabled={busy}
            className="w-full rounded-full bg-ink text-lime font-medium px-5 py-3 disabled:opacity-50"
          >
            {busy ? "Creating workspace…" : "Create workspace"}
          </button>
        </form>

        <p className="mt-8 text-sm text-ink/70">
          Already have an account? <Link to="/login" className="underline">Sign in</Link>.
        </p>
      </div>
    </div>
  );
}
