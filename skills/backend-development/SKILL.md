---
name: backend-development
description: >
  # Responsibility
  Facade/orchestrator for all backend code work.   Splits generation into two strictly
  separated cognitive stages so each runs in a small, self-contained context (ideal for
  local models with small context windows):
    * backend-plan     - PLANNER: reads event modeling docs + GWT files + existing src,
                         decides what is missing, and writes a precise machine-readable
                         diff-spec to target/backend-spec.json. Holds NO code templates.
    * backend-generate - EXECUTOR: transcribes the diff-spec into files. For every GWT
                         scenario it works TEST-FIRST: write a compiling unit test (it may
                         fail at this stage but MUST compile), then provide a simple,
                         minimal-but-functional implementation sketch that makes the test
                         green. Never re-reads docs or GWT.
  Finishes with backend-code-reviewer and a project-root `REPORT.md` of the biggest
  problems met in the conversation.
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
3. **Generate** -> delegate to `backend-generate`. For every GWT-driven test it follows the
   test-first / implementation-sketch flow, then verifies the whole suite:
   - **3a. Compiling test**: write the unit test from the spec's GWT body. It must COMPILE even
     if it does not yet pass. A red-but-compiling test at this stage is expected and fine.
   - **3b. Minimal implementation sketch**: write a SIMPLE, minimal-but-functional implementation
     (e.g. command handler emits its produced event into the event stream, projector `apply`
     builds the read model, ordinal/counter logic) just enough to make the test green. No
     gold-plating beyond the behavior the scenario exercises.
   - **3c. Verify**: run `mvn clean verify`; fix transcribing mistakes; the suite must end green.
4. **Report** -> once the code is done, the facade writes `<project root>/REPORT.md` with the
   biggest problems met during the conversation (flown to the reader in a few plain bullet points).
5. **Reconcile** (only if the executor reported a genuine spec defect that no minimal sketch can
   bridge — e.g. conflicting business rules): escalate to the user (or a big model) to clarify,
   then re-run generate. Do not silently invent behavior the skill is not allowed to shape; a minimal
   functional sketch IS allowed, but guessing at ambiguous business intent is not - ask first.
6. **Code review** -> delegate to `backend-code-reviewer`. Add this as the last point of TODO list.

# Delegation vs. inline execution
Delegating each stage to a separate subagent is preferred (keeps contexts small and clean), but it is a
means, not a goal. If a delegated stage executor is unavailable (provider/endpoint failure, context
limits), the orchestrator may run that stage inline — **without collapsing the two phases**: plan first
(produce the spec), then generate from the spec, each in its own step, with `target/backend-spec.json`
as the handoff. Do not create the code in the same pass that reasons about what to build. If a "generate
inline" reconciler is tempted to expand a minimal sketch into something elaborate, that is scope creep —
keep it minimal and escalate genuine business ambiguity per step 5.

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

The minimal implementation sketch is the LOWER bound for behavior (just enough to make the test
green), never a license to gold-plate. Keep it simple and scenario-scoped.
