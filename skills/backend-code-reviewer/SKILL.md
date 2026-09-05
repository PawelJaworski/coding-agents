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

# Never "sync" a file because of an ADVISORY
`codegen --check` may print an `ADVISORY` listing hand-owned files that diverge from the
model. It is not a task to align them, and `--check` still exits `up to date` — that IS
the pass. Reviewing is reading. Judge an edit by intent:

- **Rewriting an existing member's body to match the model = defect.** That is destroying
  the developer's logic. Flag it, revert it, do not do it yourself.
- **Adding a member the model has and the file lacks** (new event, new field) is legitimate
  when it was needed to compile or to satisfy a test.
- **A minimal edit that restores compilation** after a model change (new constructor
  argument, renamed type) is legitimate. Anything broader than the compile fix is not.

Your only valid action is to report the drift.

# What you do NOT need to checkThe generator guarantees these by construction — do not spend context re-verifying them:
naming and packaging, events carrying `aggregateId`, read-model brackets not leaking
upstream, on-demand vs persisting projector choice, serde/enum/state-projector wiring,
ability DSL shape, passthrough field mapping. If any of these is wrong, the generator or
the model is wrong, not the code.

# What you DO check

## 1. Contract was respected (the top failure mode)
- `node .opencode/skills/backend-development/scripts/codegen --check` must report
  `up to date`. Added members and rewritten bodies do not disturb it; a changed
  **contract** (public API shape, class hierarchy, architecture) or an edited `*Ability`
  will.
- No **contract** of a `// GENERATED ... DO NOT EDIT` file was changed: class signature,
  public method names/signatures, implemented interfaces, package structure. Changing
  these breaks the generated `*Ability`, Spring wiring, and serde wrappers.
- **Method body rewrites** in generated files are allowed — the agent owns the
  implementation inside the skeleton. Verify the rewrite compiles and passes tests.
- **Added private members** on generated files are allowed and survive regeneration.
  Verify they don't introduce unused imports or dead code.
- **Added** members on a generated projector/repository are NOT a defect when they back an
  ad-hoc extension (a search endpoint, a derived query over fields the read model already
  has). The merge is add-only precisely so these survive. See
  `.opencode/skills/backend-development/reference/ad-hoc-extensions.md`.
- No edit to `<docs>/*.md`, the diagram, or `scripts/codegen/*` for work that was ad-hoc.

## 2. Tests
- One Spock test per `gwt-*.md` scenario; test method names match the scenario headings
  verbatim. No invented "happy path" tests.
- given/when/then map 1:1 to the GWT file — no extra steps, no weakened assertions.
- An **ad-hoc extension** has no GWT file, so a descriptively-named spec is correct, not
  an "invented" test. What IS a defect is an ad-hoc change shipped with no spec at all.
- Tests use only generated ability DSLs. Any direct `new` of a handler, projector,
  repository, event or command in a test is a defect. (Calling a projector through the
  ability's accessor — `getPolicyListProjector().searchPolicyList(...)` — is fine for a
  capability the DSL does not cover.)
- `reset_event_stream()` is called in `setup()` (abilities share a static stream; without
  it, tests leak into each other and pass or fail by ordering).
- If a `*Decider` holds state (a sequence, a counter), EVERY spec exercising that slice
  also resets it in `setup()` — `reset_event_stream()` does not. Missing resets show up
  as order-dependent failures, so a currently-green suite does not prove this.

## 3. Model defects were escalated, not patched
If the work involved a missing field or an unmappable event, the correct response was to
escalate to the architect. Code that works around a model gap is a defect even if green.
A missing *query* over fields that already exist is NOT a model gap — that is ad-hoc.

## 4. Gates
- `mvn clean verify` GREEN (clean — stale classes give phantom Lombok failures).
- `node .opencode/skills/backend-development/scripts/codegen --check` reports up to date.
- `api/openapi.json` was regenerated if any route or parameter changed, and left
  uncommitted in the working tree.

# Notes
- Lombok LSP/jdtls errors are false positives; only `mvn` is authoritative.
- Report findings to backend-development for correction. Prefer "change the model" or
  "change the decider" over any fix that changes a generated file's contract.
