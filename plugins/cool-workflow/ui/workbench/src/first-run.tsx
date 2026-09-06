import { C } from "./classes";

const STEPS = ["ask", "plan and dispatch", "verify", "report"];

// Ported from app.js's renderFirstRun(): the empty state shown before any
// run has been made, with the one command that starts the loop. Pure/
// presentational — no hook, no directive.
export function FirstRun() {
  return (
    <div className="mx-auto mt-[10vh] flex max-w-[620px] flex-col gap-3.5">
      <span className={`${C.label} text-primary`}>first run</span>
      <h2 className="text-[26px] font-extrabold leading-[1.2] tracking-[-.01em]">Ask one question. Get a saved, cited report.</h2>
      <p className="text-base-content/60">Run this in a repo. The report opens by itself when the run ends, and it shows up here.</p>
      <code className={`${C.cmd} block border-primary px-4 py-3 text-[14px]`}>{'cw -q "<question>"'}</code>
      <ol className="grid list-none grid-cols-2 gap-2.5 p-0 md:grid-cols-4">
        {STEPS.map((step, i) => (
          <li key={step} className="card card-border card-sm bg-base-200 px-3.5 py-3 text-[13px] font-semibold">
            <span className={`${C.label} mb-1 block`}>{i + 1}</span>
            {step}
          </li>
        ))}
      </ol>
    </div>
  );
}
