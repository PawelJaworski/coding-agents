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
2. No code was added beyond template + spec substitutions (no invented beans, helpers, services).
3. No domain attributes beyond what the event modeling docs / spec declares (ask the architect about docs-level gaps rather than silently adding).
4. Use code templates as much as possible; do not invent patterns that a template already covers.
5. The planner produced a spec where every entry is explicit (no "derive from context" language).
6. The spec artifact (`target/backend-spec.json`) is the single handoff; executor did not re-read docs/GWT.
7. **No pre-existing file was edited unless it was a spec `target`.** In particular the executor must not
   have added scaffolding to pre-existing infrastructure (e.g. a `@Transient` carry-around field on
   `DomainEventEntity`, commented-out payloads, or a shim to make a GWT test pass). If such a change
   exists, it is a spec/coverage defect the executor should have reported, not improvised — flag it.

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
15. Tests were run (`mvn clean verify`) and pass.

# Notes
- Lombok LSP noise is a false positive; trust `mvn clean verify`.
- A failing behavioral GWT test is NOT proof the executor invented code — check first whether
  serialization/handler-emit logic is simply a spec/coverage gap (report/escalate) vs. a transcribing mistake.
