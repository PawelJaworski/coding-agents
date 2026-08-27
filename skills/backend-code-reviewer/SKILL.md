---
name: backend-code-reviewer
description: >
  # Responsibility
  Responsible for checking if code generated with the backend pipeline (backend-plan ->
  backend-generate via the backend-development facade) complies with the worker skills'
  instructions, and that generated code matches the backend-spec.json contract.
  # When to use
  Use when backend-development (or its workers backend-plan / backend-generate) generates/changes any code.
---

# Flow
1. Validate that generation respected the two-stage contract:
   - The executor (backend-generate) transcribed ONLY from `target/backend-spec.json` + templates.
   - The planner (backend-plan) produced a spec that is complete and explicit.
2. Check generated files comply with the rules below.
3. Invoke backend-development skill to apply all remarks.

# Things to check:
## Contract & scope
1. Generated files must trace 1:1 to `target/backend-spec.json` targets (no stray files, none missing).
2. The executor followed TEST-FIRST: every `test` entry COMPILES on its own (a red-but-compiling test
   is fine at stage 3a). Any runtime logic beyond template + spec substitutions must be a MINIMAL
   implementation sketch the spec's `implementationSketch` describes (e.g. handler event emission,
   projector `apply` building the read model, ordinal/serial logic) - not invented production logic or
   gold-plating. Flag any sketch that adds validation/error-handling/generality the scenarios don't
   exercise.
3. No domain attributes beyond what the event modeling docs / spec declares (ask the architect about docs-level gaps rather than silently adding).
4. Use code templates as much as possible; do not invent patterns that a template already covers.
5. The planner produced a spec where every entry is explicit (no "derive from context" language).
6. The spec artifact (`target/backend-spec.json`) is the single handoff; executor did not re-read docs/GWT.
7. **No pre-existing file was edited unless it was a spec `target`** (the `serde-wiring` /
   `state-projector` entries legitimately target `DomainEventSerdeWrapper`, `DomainEventEntity`,
   `DomainEventType`, `StateProjector`). The executor must not have added bypass scaffolding (e.g. a
   `@Transient` carry-around field on `DomainEventEntity`, commented-out payloads, or a shim). A
   MINIMAL sketch on a spec target is expected; scaffolding on a non-target is a defect - flag it.

## Structural correctness
8. Events carry `aggregateId` as their own field/value, NOT aliased to a business attribute.
9. Read-model bracket fields (`[x]`) were NOT pushed upstream onto command/event.
10. Command handlers exist in a package matching the command name; events live in `domain.events`.
11. On-demand projector used when read model has an aggregate id; persisting projector (+ entity/repo)
    used when it does not.

## Tests (behavior)
12. Test classes exist ONLY for read models with a `gwt-{readmodel-id}.md` file.
13. Test names match the GWT scenario names exactly (no generic "happy path" names).
14. Test bodies (given/when/then) match the GWT file exactly; the executor pasted the planner-provided body verbatim.
15. Every test COMPILES (test-first gate) AND the full `mvn clean verify` suite is GREEN at the end
    (the minimal implementation sketch made each failing GWT test pass).
16. A `<project root>/REPORT.md` exists, written last, capturing the biggest problems met in the
    conversation (plain bullet points).

# Notes
- Lombok LSP noise is a false positive; trust `mvn clean verify`.
- A failing behavioral GWT test at the 3a (compile-only) stage is EXPECTED - it is test-first. Only a
  failure at the FINAL green gate is a defect. When a test is red at the end, check whether the
  minimal implementation sketch was written/literal to the spec's `implementationSketch` vs. a
  transcribing mistake vs. the sketch being gold-plated or under-specified.
