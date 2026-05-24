import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider.js";
import { cx } from "../lib/cx.js";
import type { Role } from "../types.js";

interface NavItem {
  to: string;
  label: string;
  allow: Role[];
}

const nav: NavItem[] = [
  { to: "dashboard",  label: "Dashboard",  allow: ["EMPLOYEE", "AGENT", "ADMIN"] },
  { to: "tickets",    label: "Tickets",    allow: ["EMPLOYEE", "AGENT", "ADMIN"] },
  { to: "knowledge",  label: "Knowledge",  allow: ["EMPLOYEE", "AGENT", "ADMIN"] },
  { to: "remote",     label: "Remote",     allow: ["AGENT", "ADMIN"] },
  { to: "assets",     label: "Assets",     allow: ["AGENT", "ADMIN"] },
  { to: "detections", label: "Detections", allow: ["AGENT", "ADMIN"] },
  { to: "threat",     label: "Threat intel", allow: ["AGENT", "ADMIN"] },
  { to: "defender",   label: "Defender",   allow: ["AGENT", "ADMIN"] },
  { to: "attack",     label: "ATT&CK",     allow: ["AGENT", "ADMIN"] },
  { to: "workflows",  label: "Workflows",  allow: ["AGENT", "ADMIN"] },
  { to: "ml",         label: "ML Models",  allow: ["ADMIN"] },
  { to: "users",      label: "Users",      allow: ["ADMIN"] },
  { to: "incidents",  label: "Incidents",  allow: ["ADMIN"] },
  { to: "reports",    label: "Reports",    allow: ["ADMIN"] },
  { to: "settings",   label: "Organization", allow: ["ADMIN"] },
];

export function Sidebar() {
  const { user, org, logout } = useAuth();
  const location = useLocation();
  if (!user || !org) return null;

  const onPlatform = location.pathname.startsWith("/platform");
  const base = `/app/${org.slug}`;

  const navItemClass = (isActive: boolean) =>
    cx(
      "flex items-center px-3 py-2 rounded-xl text-sm transition-colors duration-fast ease-snap motion-reduce:transition-none",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40 focus-visible:ring-offset-1 focus-visible:ring-offset-paper",
      isActive ? "bg-ink text-lime" : "text-ink/80 hover:bg-ink/5",
    );

  return (
    <aside
      aria-label="Primary navigation"
      className="w-60 shrink-0 border-r border-ink/10 bg-paper min-h-screen flex flex-col sticky top-0"
    >
      <div className="px-6 pt-8 pb-6">
        <p className="font-display text-2xl leading-none">Relay</p>
        <p className="font-mono text-[10px] uppercase tracking-widest text-ink/50 mt-1">{org.slug}</p>
      </div>

      <nav aria-label="Sections" className="flex-1 px-3 space-y-0.5 overflow-y-auto">
        {nav.filter(n => n.allow.includes(user.role)).map(item => (
          <NavLink
            key={item.to}
            to={`${base}/${item.to}`}
            className={({ isActive }) => navItemClass(isActive && !onPlatform)}
          >
            {item.label}
          </NavLink>
        ))}

        {user.isPlatformAdmin && (
          <>
            <div className="border-t border-ink/10 my-3" />
            <NavLink
              to="/platform"
              className={({ isActive }) => navItemClass(isActive)}
            >
              Platform
            </NavLink>
          </>
        )}
      </nav>

      <div className="px-6 py-6 border-t border-ink/10">
        <p className="text-sm font-medium truncate" title={user.name}>{user.name}</p>
        <p className="text-xs text-ink/60 truncate" title={user.email}>{user.email}</p>
        <p className="font-mono text-[10px] uppercase tracking-widest text-ink/50 mt-2">
          {user.role}{user.isPlatformAdmin ? " · PLATFORM" : ""}
        </p>
        <button
          onClick={logout}
          className="mt-4 text-sm text-ink/70 hover:text-ink underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40 rounded"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
