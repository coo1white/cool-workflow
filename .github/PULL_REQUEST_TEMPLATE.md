<!-- The four heads below mirror the release-notes shape in AGENTS.md.
     Keep each short; one clear sentence beats a list of ten. -->

## Capability

What can a user do now that they could not before? (For a fix: what wrong
behavior is gone?)

## Implementation

The shape of the change and why this way. Name the key files.

## Tests

Which new or changed test fails before this change and passes after it.
Paste the `npm test` summary line.

## Risk

What could this break, and what keeps that from happening (gate, smoke,
conformance case).

---

- [ ] `npm run build` clean and `npm test` green (run from `plugins/cool-workflow/`)
- [ ] No new runtime dependency, no model SDK, no network call from the control plane
- [ ] Docs updated if a documented surface moved (`docs/*.7.md` are the contract)
- [ ] No TODO/FIXME added without a linked issue
