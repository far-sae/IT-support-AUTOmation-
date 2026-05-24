import type { ReactNode } from "react";
import { Navigate, useLocation, useParams } from "react-router-dom";
import { useAuth } from "./AuthProvider.js";
import type { Role } from "../types.js";

interface Props {
  children: ReactNode;
  allow?: Role[];
  /** Require the path's `:orgSlug` to match the user's current org. */
  matchOrgSlug?: boolean;
  /** Require the user to be a platform admin. */
  platformOnly?: boolean;
}

export function ProtectedRoute({ children, allow, matchOrgSlug, platformOnly }: Props) {
  const { user, org, status } = useAuth();
  const location = useLocation();
  const params = useParams<{ orgSlug?: string }>();

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center text-ink/60">
        Loading session…
      </div>
    );
  }

  if (!user || !org) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (platformOnly && !user.isPlatformAdmin) {
    return <Forbidden />;
  }

  if (matchOrgSlug && params.orgSlug && params.orgSlug !== org.slug) {
    return <Navigate to={`/app/${org.slug}/dashboard`} replace />;
  }

  if (allow && !allow.includes(user.role)) {
    return <Forbidden />;
  }

  return <>{children}</>;
}

function Forbidden() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-ink/60 mb-3">403</p>
        <h1 className="font-display text-3xl mb-2">You don't have access to that page.</h1>
        <p className="text-ink/70">Ask an admin if you think this is a mistake.</p>
      </div>
    </div>
  );
}
