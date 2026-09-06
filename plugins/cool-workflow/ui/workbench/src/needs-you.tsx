import { C } from "./classes";
import { actionFacts } from "./inspection";
import type { WorkbenchRunView } from "./api";

// The three facts a person needs first, from three panels of the one
// payload already fetched: no new request. Only graph's nextAction
// counts; the coordinator payload carries one too and it is dropped.
// Ported from app.js's NEEDS_YOU + renderNeedsYou().
const NEEDS_YOU: { key: string; group: string; panel: string; label: string; tone: string }[] = [
  { key: "problems", group: "candidate", panel: "summary", label: "problems", tone: "border-error text-error" },
  { key: "missingEvidence", group: "blackboard", panel: "coordinator", label: "missing evidence", tone: "" },
  { key: "nextAction", group: "graph", panel: "compact", label: "next action", tone: "border-accent" },
];

// Pure/presentational — no hook, no directive; used inside run-panel.tsx's
// client island.
export function NeedsYou({ view }: { view: WorkbenchRunView }) {
  return (
    <section className="grid grid-cols-1 gap-3 md:grid-cols-3" aria-label="what needs you">
      {NEEDS_YOU.map(({ key, group, panel: panelName, label, tone: someTone }) => {
        const panel = view.panels?.[group]?.[panelName];
        const fact = panel && panel.status === "present" ? actionFacts(panel.data).find((f) => f.key === key) : undefined;
        const none = !fact || fact.items[0] === "none";
        const tone = key === "nextAction" ? someTone : none ? "" : someTone;
        return (
          <div key={key} className={`${C.card} ${tone}`}>
            <div className="card-body">
              <span className={`${C.label} ${key === "nextAction" ? "text-accent" : ""}`}>{label}</span>
              {none ? (
                <span className="text-success">none</span>
              ) : key === "nextAction" ? (
                <code className={C.cmd}>{fact!.items[0]}</code>
              ) : (
                <ul className={C.items}>
                  {fact!.items.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}
