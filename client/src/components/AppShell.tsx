import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar.js";

/**
 * Phase 23 — Adds:
 *   • A skip-to-main link (only visible to keyboard focus) so screen-reader
 *     + keyboard users can bypass the sidebar.
 *   • An explicit `<main id="main">` landmark + page-transition animation.
 */
export function AppShell() {
  return (
    <div className="min-h-screen flex bg-paper">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2 focus:bg-ink focus:text-lime focus:rounded-full"
      >
        Skip to content
      </a>
      <Sidebar />
      <main
        id="main"
        className="flex-1 px-6 md:px-10 py-8 max-w-[1400px] mx-auto w-full animate-fade-in"
      >
        <Outlet />
      </main>
    </div>
  );
}
