// Ported from app.js's rawJson(): the full capability payload, byte for
// byte, folded behind a summary line so the structured view (or nothing)
// can stand in front of it. Pure/presentational — no hook, no directive.
export function RawJson({ data, label = "raw payload" }: { data: unknown; label?: string }) {
  return (
    <details className="collapse collapse-arrow rounded-none border-t border-base-300">
      <summary className="collapse-title min-h-0 px-3.5 py-2.5 text-[12px] text-base-content/60">{label}</summary>
      <div className="collapse-content px-0">
        <pre className="max-h-[460px] overflow-x-auto whitespace-pre bg-base-100 px-3.5 py-3 font-mono text-[12px] leading-normal">{JSON.stringify(data, null, 2)}</pre>
      </div>
    </details>
  );
}
