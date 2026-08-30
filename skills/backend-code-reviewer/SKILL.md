---
name: backend-code-reviewer
description: >
  # Responsibility
  Reviews backend work in a project where scaffolding is generated deterministically
  (backend-development) and only business logic is hand-written (backend-implement).
  Most structural correctness is guaranteed by the generator, so this review targets the
  narrow band where a human or an agent can still get it wrong.
  # When to use
  Use after backend-development / backend-implement changed any backend code.
---

# What you do NOT need to check
The generator guarantees these by construction — do not spend context re-verifying them:
naming and packaging, events carrying `aggregateId`, read-model brackets not leaking
upstream, on-demand vs persisting projector choice, serde/enum/state-projector wiring,
ability DSL shape, passthrough field mapping. If any of these is wrong, the generator or
the model is wrong, not the code.

# What you DO check

## 1. Ownership was respected (the top failure mode)
- No file with `// GENERATED ... DO NOT EDIT` was modified. Verify with
  `node .opencode/skills/backend-development/scripts/codegen --check` — it must report `up to date`. A drifted generated file means
  someone hand-edited it; that work is about to be silently destroyed.
- Hand-written logic appears ONLY in `*Decider` classes (and Spock tests). Logic found in
  a handler, projector, event, read model or ability is a defect.
- No hand-written scaffolding was added alongside the generated tree (a stray command,
  event, read model, projector, repository or ability). Regenerate and diff if unsure.

## 2. Deciders
- Every implemented decider method traces to a GWT scenario, ideally by a comment naming it.
- No decider still throws `UnsupportedOperationException` for a field that a GWT scenario
  covers.
- A decider that throws with NO scenario is correct and expected — do not flag it, and do
  not ask for a mock or placeholder value. Loud-and-unimplemented is the intended state.
- Logic is scenario-scoped: no validation, error handling, persistence or generality the
  scenario does not exercise. Flag gold-plating.
- The decider still has a no-argument constructor (generated abilities instantiate it).

## 3. Tests
- One Spock test per `gwt-*.md` scenario; test method names match the scenario headings
  verbatim. No invented "happy path" tests.
- given/when/then map 1:1 to the GWT file — no extra steps, no weakened assertions.
- Tests use only generated ability DSLs. Any direct `new` of a handler, projector,
  repository, event or command in a test is a defect.
- `reset_event_stream()` is called in `setup()` (abilities share a static stream; without
  it, tests leak into each other and pass or fail by ordering).

## 4. Model defects were escalated, not patched
If the work involved a missing field or an unmappable event, the correct response was to
escalate to the architect. Code that works around a model gap is a defect even if green.

## 5. Gates
- `mvn clean verify` GREEN (clean — stale classes give phantom Lombok failures).
- `node .opencode/skills/backend-development/scripts/codegen --check` reports up to date.

# Notes
- Lombok LSP/jdtls errors are false positives; only `mvn` is authoritative.
- Report findings to backend-development for correction. Prefer "change the model" or
  "change the decider" over any fix that edits generated code.
