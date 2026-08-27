---
name: backend-development
description: >
  # Responsibility
  Facade/orchestrator for all backend code work. Splits generation into two strictly
  separated cognitive stages so each runs in a small, self-contained context (ideal for
  local models with small context windows):
    * backend-plan     - PLANNER: reads event modeling docs + GWT files + existing src,
                         decides what is missing, and writes a precise machine-readable
                         diff-spec to target/backend-spec.json. Holds NO code templates.
    * backend-generate - EXECUTOR: reads ONLY the diff-spec + its own code templates and
                         transcribes the files, never re-reading docs or GWT, never
                         inventing patterns.
  Finishes with backend-code-reviewer.
  # When to use
  Use when there is a need to change backend code, generate backend code, implement
  business logic based on GWT scenarios, or add/update a command, event or read model.
  This facade decides the pipeline and wires the handoff.
  # **Important** This skill is parametrized
  * parameters: <docs>, <eventModel> are passed from outside. You have to know them before staring this skill execution. Don't ever execute this skill without exactly knowing those params.
---

# Flow
This facade does NOT hold the instructions. It wires two strict stages. The stages are:
* `backend-plan`     - writes `target/backend-spec.json` (the diff of everything to create/change).
* `backend-generate` - reads the spec + templates, writes the actual Java/Groovy files.

Read both worker SKILL.md files when invoked, then run the pipeline:

1. **Plan** -> delegate to `backend-plan`. It reads `<docs>/commands.md`, `<docs>/events.md`,
   `<docs>/readmodels.md`, `<docs>/uis.md`, all `glob <docs>/gwt-*.md`, and the existing `src/`,
   then writes `target/backend-spec.json`.
2. **Review the spec (optional but recommended)**: read `target/backend-spec.json`. The user can
   adjust it before generation. The spec is the contract - generation follows it literally.
3. **Generate** -> delegate to `backend-generate`. It transcribes every spec entry from its
   templates into `src/main/java` / `src/test/java` and runs `mvn clean verify`.
4. **Reconcile** (only if the executor reported a spec defect): escalate to the user (or a big model)
   to fix `target/backend-spec.json`, then re-run generate. Never have the executor "fix" logic, and
   never patch pre-existing code (e.g. add `@Transient` scaffolding to `DomainEventEntity`) to make a
   test pass — if serialization/handler-emit/projection isn't generated, treat that as a spec/coverage
   gap and route it back to the planner rather than inventing it here.
5. **Code review** -> delegate to `backend-code-reviewer`. Add this as the last point of TODO list.

# Delegation vs. inline execution
Delegating each stage to a separate subagent is preferred (keeps contexts small and clean), but it is a
means, not a goal. If a delegated stage executor is unavailable (provider/endpoint failure, context
limits), the orchestrator may run that stage inline — **without collapsing the two phases**: plan first
(produce the spec), then generate from the spec, each in its own step, with `target/backend-spec.json`
as the handoff. Do not create the code in the same pass that reasons about what to build. If a "generate
inline" reconciler is tempted to improve/complete generated code, that is a spec defect — stop and
escalate per step 4.

# Low-context invariant
Find ONE clean handoff document between planner and executor: `target/backend-spec.json`.
The planner's context = docs + GWT + src (no templates). The executor's context = spec + its
templates (no docs/GWT). Do NOT collapse them into one session - that defeats the split.

# Event modeling notation mapping
Applied by the planner when building the spec. Key rule for the record: `{aggregateName}:Id`
names the aggregate id concept only (a separate declaration, not a reference to a bulleted
field); bracketed `[field]` on a READ MODEL are system-generated/calculated at projection and
have no upstream passthrough. See backend-plan SKILL.md.

# Boundaries
Never edit the event-modelling docs (`<eventModel>/commands.md`, `<eventModel>/events.md`,
`<eventModel>/readmodels.md`, `<eventModel>/uis.md`), the generated diagram
(`<eventModel>/eventmodel.html`), or the diagram generator (`scripts/generate.js`) - owned by the
architect. If generation surfaces a mismatch or gap in the event-modelling docs, stop and escalate
to the architect (or ask the user) instead of editing those files directly. Only read them as input.
