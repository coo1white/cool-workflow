import { moveTab, type TabKey } from "./navigation";

// Same seven tabs, same order and names, as app.js's PANEL_GROUPS: which
// panels (of the one already-fetched run view) each tab shows.
export const PANEL_GROUPS: { key: TabKey; label: string; panels: string[] }[] = [
  { key: "graph", label: "Run graph", panels: ["operator", "multiAgent", "compact", "criticalPath"] },
  { key: "blackboard", label: "Blackboard", panels: ["coordinator", "digest", "graph"] },
  { key: "worker", label: "Worker logs", panels: ["summary"] },
  { key: "candidate", label: "Candidate compare", panels: ["summary", "reasoning"] },
  { key: "audit", label: "Audit timeline", panels: ["summary", "multiAgent", "policy", "judge"] },
  { key: "metrics", label: "Metrics & cost", panels: ["report"] },
  { key: "collaboration", label: "Review & collaboration", panels: ["review", "comments"] },
];

// Ported from app.js's tab markup + navigation.js's moveTab: a real
// role="tablist" of role="tab" buttons, aria-controls pointing at the
// matching tabpanel id, tabindex 0 on the active tab only, and
// Left/Right/Home/End moving both focus and selection the same way
// navigation.js's moveTab did. Rendered only inside run-panel.tsx's
// client island; no directive of its own needed.
export function Tabs({ activeTab, onSelect }: { activeTab: TabKey; onSelect: (tab: TabKey, options?: { focus?: boolean }) => void }) {
  return (
    <div className="tabs tabs-border" role="tablist">
      {PANEL_GROUPS.map((group) => {
        const active = activeTab === group.key;
        return (
          <button
            key={group.key}
            id={`workbench-tab-${group.key}`}
            type="button"
            className={`tab text-[13px] font-semibold ${active ? "tab-active" : ""}`}
            role="tab"
            aria-controls={`workbench-panel-${group.key}`}
            aria-selected={active ? "true" : "false"}
            tabIndex={active ? 0 : -1}
            onClick={(event) => onSelect(group.key, { focus: event.detail === 0 })}
            onKeyDown={(event) => {
              const next = moveTab(activeTab, event.key);
              if (next === activeTab && !["Home", "End", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
              event.preventDefault();
              onSelect(next, { focus: true });
            }}
          >
            {group.label}
          </button>
        );
      })}
    </div>
  );
}
