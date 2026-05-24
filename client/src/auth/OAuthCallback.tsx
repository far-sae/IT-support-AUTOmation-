import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "./AuthProvider.js";

export default function OAuthCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { setSessionFromToken } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = params.get("token");
    const org = params.get("org");
    if (!token) {
      setError("Missing token in callback URL.");
      return;
    }
    setSessionFromToken(token)
      .then((r) => navigate(`/app/${org ?? r.orgSlug}/dashboard`, { replace: true }))
      .catch(() => setError("Could not establish a session — try signing in again."));
  }, [params, navigate, setSessionFromToken]);

  return (
    <div className="min-h-screen flex items-center justify-center text-ink/70 px-6 text-center">
      {error ? error : "Finishing sign-in…"}
    </div>
  );
}
