import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invitesApi } from "../api/endpoints.js";
import { useAuth } from "./AuthProvider.js";
import { ApiError, setToken } from "../api/client.js";

export default function InvitePage() {
  const { token = "" } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { setSessionFromToken } = useAuth();
  const qc = useQueryClient();

  const lookup = useQuery({
    queryKey: ["invite", token],
    queryFn: () => invitesApi.lookup(token),
    enabled: Boolean(token),
    retry: false,
  });

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const accept = useMutation({
    mutationFn: () => invitesApi.accept(token, name.trim(), password),
    onSuccess: async (r) => {
      setToken(r.token);
      await setSessionFromToken(r.token);
      qc.clear();
      navigate(`/app/${r.organization.slug}/dashboard`, { replace: true });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not accept invite."),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    accept.mutate();
  }

  useEffect(() => {
    if (lookup.error) setError((lookup.error as ApiError).message);
  }, [lookup.error]);

  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-paper">
      <div className="w-full max-w-md">
        <p className="font-mono text-xs uppercase tracking-widest text-ink/60 mb-3">Relay · invite</p>

        {lookup.isLoading && <p className="text-ink/70">Checking your invite…</p>}

        {lookup.data && (
          <>
            <h1 className="font-display text-3xl mb-2">Join {lookup.data.organization.name}</h1>
            <p className="text-ink/70 mb-6">
              You've been invited as <strong>{lookup.data.role.toLowerCase()}</strong>. The invite was sent to{" "}
              <span className="font-mono">{lookup.data.email}</span>.
            </p>
            <form onSubmit={submit} className="space-y-4">
              <label className="block">
                <span className="text-sm font-medium">Your name</span>
                <input
                  required value={name} onChange={(e) => setName(e.target.value)}
                  className="mt-1 block w-full rounded-xl border border-ink/15 bg-white px-4 py-3 focus:outline-none focus:ring-2 focus:ring-ink/20"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium">Choose a password</span>
                <input
                  type="password" required minLength={8} value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 block w-full rounded-xl border border-ink/15 bg-white px-4 py-3 focus:outline-none focus:ring-2 focus:ring-ink/20"
                />
              </label>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                type="submit" disabled={accept.isPending || !name.trim() || password.length < 8}
                className="w-full rounded-full bg-ink text-lime font-medium px-5 py-3 disabled:opacity-50"
              >
                {accept.isPending ? "Joining…" : `Join ${lookup.data.organization.name}`}
              </button>
            </form>
          </>
        )}

        {!lookup.isLoading && lookup.error && (
          <>
            <h1 className="font-display text-3xl mb-2">Invite not valid</h1>
            <p className="text-ink/70">{(lookup.error as ApiError).message}</p>
          </>
        )}
      </div>
    </div>
  );
}
