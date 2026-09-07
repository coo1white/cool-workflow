"use client";

import { AppHeader } from "./header-controls";
import { AppSidebar } from "./nav-links";

// The drawer checkbox is the open state, so the side panel opens with no JS.
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="drawer lg:drawer-open">
      <input id="shell-drawer" type="checkbox" className="drawer-toggle" />
      <div className="drawer-content flex h-screen flex-col bg-base-100 font-sans text-[14px] leading-[1.45] text-base-content">
        <a href="#main" className="sr-only focus:not-sr-only">
          Skip to content
        </a>
        <div className="navbar min-h-[56px] justify-between gap-4 border-b border-base-300 px-5">
          <div className="flex items-center gap-3">
            <label htmlFor="shell-drawer" className="btn btn-ghost btn-sm lg:hidden" aria-label="menu">
              ☰
            </label>
            <span className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-primary text-base-100" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 7h9" />
                <path d="M4 12h6" />
                <path d="M12 15l3 3 6-7" />
              </svg>
            </span>
            <h1 className="font-display text-[14px] font-extrabold uppercase tracking-[.12em]">
              Cool Workflow <span className="text-[13px] font-normal normal-case tracking-normal text-base-content/60">Workbench</span>
            </h1>
          </div>
          <div className="flex items-center gap-4">
            {/* Both client islands (src/run-list.tsx, src/run-panel.tsx)
                listen for "cw:refresh" and re-derive from disk on it. */}
            <button
              id="refresh"
              type="button"
              className="btn btn-outline btn-sm gap-1.5 font-normal normal-case"
              title="Re-derive from disk"
              onClick={() => window.dispatchEvent(new Event("cw:refresh"))}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-3-6.7" />
                <path d="M21 3v6h-6" />
              </svg>
              Refresh
            </button>
            <AppHeader />
          </div>
        </div>
        <main id="main" className="min-h-0 flex-1 overflow-hidden">
          {children}
        </main>
        <footer className="border-t border-base-300 px-5 py-1.5 font-mono text-[11px] uppercase tracking-[.08em] text-base-content/60">
          Cool Workflow · read-only · localhost · re-derived from <code className="text-base-content">.cw/</code> on every refresh
        </footer>
      </div>
      <div className="drawer-side">
        <label htmlFor="shell-drawer" className="drawer-overlay" aria-label="close menu" />
        <nav className="min-h-full w-56 border-r border-base-300 bg-base-200 p-3">
          <AppSidebar />
        </nav>
      </div>
    </div>
  );
}
