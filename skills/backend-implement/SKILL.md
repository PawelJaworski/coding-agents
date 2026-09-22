---
name: backend-implement
description: >
  # Responsibility
  Implements ONE GWT scenario, test-first, in a sliced event-sourced project where all
  scaffolding is already generated. Writes exactly two things: a Spock test transcribed
  from the GWT file, and the minimal production logic in the handler, aggregate, projector,
  or projection decider that makes it green.
  Touches nothing else.
  # When to use
  Use after scaffolding has been generated (see backend-development), when a
  `<docs>/gwt-*.md` scenario must be turned into working behavior. One invocation per
  scenario. Also use for a small ad-hoc implementation improvement that needs NO model
  change and has no GWT file — a search criterion, a repository query, an endpoint
  filter or sort over fields a read model already has.
  # **Important** This skill is parametrized
  * parameters: <docs> is passed from outside. You have to know it before starting.
---

# Rules
1. You may change an ability's `INSTANCE` creation — wire real collaborators (their
   ability's `INSTANCE`; no mocks, no anonymous overrides). Stamp the change
   `// PRESERVED-BY-HAND: <reason>` so `codegen --check` stays up to date.
2. Every Spring component has a corresponding ability. Tests use abilities only — never
   `new` a component, handler, projector or repository in a test.

# One test method per rule or scenario — verbatim, never merged
Write exactly one Spock test method per rule/scenario, named after its text
character-for-character. Never fold rules/scenarios into a single `@Unroll`/`where:`
method — `codegen --next` matches by exact spec method name, not semantically.

# Context you need — and nothing more
1. The single `<docs>/gwt-<read-model>.md` scenario — or the single business rule, quoted
   verbatim by the caller — you were asked to implement. Never go looking for, or writing,
   a `.md`.
2. The generated `*Ability` interfaces of the slices it mentions (`src/test/java/...`).
3. The handler/projector and, when relevant, its plain `*Aggregate` or
   `*ProjectionDecider` (`src/main/java/...`).

Do NOT read `commands.md`, `events.md`, `readmodels.md`, the whole `src/` tree, or any
other slice. The scaffolding is already correct by construction; re-deriving it wastes
context and risks contradicting the generator.

# Two kinds of work
| you were asked to | path |
|---|---|
| implement a `<docs>/gwt-*.md` scenario | the flow below — logic lands in the production handler, aggregate, projector, or projection decider |
| enforce a business rule quoted from `business-rules-raw.md` | the flow below — the guard lands in the command handler. Move it into a hydrated aggregate only if it depends exclusively on that aggregate's event history. The spec is named after the rule: a rule has no GWT file and you must NOT create one |
| add a query/filter/sort/search over fields a read model ALREADY has | **ad-hoc extension** — same red/green discipline, but logic lands in the slice's projector/repository. See `.opencode/skills/backend-development/reference/ad-hoc-extensions.md` |

An ad-hoc improvement has no GWT file, so its spec name is plainly descriptive instead
of a scenario heading, and it needs no `[bracketed]` field. It is still test-first.
Anything that would require a new *field* or a new *event* is a model change, not ad-hoc —
stop and report it back to the caller.

# Flow — red, then green, nothing else

## 1. Write the test (it must compile; it may fail)
`src/test/groovy/<base>/<readmodel-package>/<ReadModel>Spec.groovy` — for a business rule,
the command's own slice instead: `src/test/groovy/<base>/<command-package>/<Command>Spec.groovy`.

- The test method name is the GWT scenario heading verbatim, or the rule's own words.
- given/when/then map 1:1 onto the GWT lines. No extra steps, no invented happy paths.
- Use ONLY the generated ability DSLs (Rule 2). Never construct a handler, projector,
  repository or event yourself; never `new` a domain class in a test.
  - command DSL: `issue_policy { it.policyHolder("Alice") }` -> returns the aggregate id
  - projector DSL: `expect_policy_document(id) { it.policyNumber() == "P-1" }`
  - `reset_event_stream()` in `setup()` — abilities share a static in-memory stream.
- Groovy note: Lombok builders are fluent, so write `it.field("v")`, not `it.field = "v"`.

Mutable collaborators (sequences, repositories) also hold state across specs — reset
them via their ability in `setup()`, e.g. `PolicyNumberSequenceAbility`'s
`reset_policy_number_sequence()`.

Run it. It MUST compile. A red-but-compiling test here is the expected state.

## 2. Read the failure — it names your target
A correct red looks like:
```
UnsupportedOperationException: [policy number] on event 'policy-issued' is a
decision with no GWT scenario yet
    at IssuePolicyHandler.policyNumber(IssuePolicyHandler.java:34)
```
That stack trace IS the assignment. Open that handler method.

For a business rule there is no stub to throw, so the red is the command *succeeding*
when the rule says it must not — the spec fails on the assertion that no event was
appended. Your target is that command handler.

## 3. Implement the decision — at the correct boundary, minimally
Replace the `throw` with the simplest logic that satisfies the scenario. Add a comment
naming the GWT scenario that justifies it.

- A command handler is hand-owned logic. Its generated private decision method is the
  default home for a bracketed value that does not belong to aggregate state.
- A plain aggregate is constructed and hydrated locally from
  `eventStream.findAllById(aggregateId)` only when the rule needs state derived solely
  from that aggregate's events. It is never injected and never a Spring component.
- Cross-aggregate/global decisions stay in the handler or move to a dedicated domain
  service/repository when they need collaborators or reuse.
- Keep it scenario-scoped: no validation, error handling, persistence or generality the
  scenario does not exercise. That is scope creep, not implementation.
- A new collaborator arrives via its own ability (Rule 2); wire it into the handler
  ability's `INSTANCE` (Rule 1).

## 4. Verify
Iterate quickly during red/green with the project's single-spec path — never
`-Dtest=` (see `AGENTS.md` → Build / test). Finish with the full gate:
`./mvnw clean verify` green — always build clean once generated/Lombok classes changed,
stale `target/` classes produce phantom Lombok failures. Then
`node .opencode/skills/backend-development/scripts/codegen --check` must report
`up to date`.

# Hard boundaries
- **Never change the contract of a `// GENERATED ... DO NOT EDIT` file.** The contract is
  the public shape: class signature, public method names, method signatures, implemented
  interfaces, package structure. Changing these breaks the generated `*Ability`, Spring
  wiring, and serde wrappers. If the contract looks wrong, the MODEL is wrong — leave it
  alone and report it back to the caller.
- **Can rewrite method bodies.** The implementation inside any existing method — including
  `@Override` methods — is the agent's to change. The generator creates the skeleton; the
  agent owns the details. The agent is responsible for compilation.
- **Can add private members.** Private methods, private fields, and helper classes may be
  added to generated files. The add-only merge preserves them across regeneration.
- **Can create new files.** Private helper classes, services, or utilities the agent
  introduces are the agent's responsibility. They are not scaffolding — they are
  implementation details.
- **Never write scaffolding.** No new commands, events, read models, handlers, projectors,
  abilities or serde wrappers. A missing command/event/read model means the model is
  missing it — stop and report it back to the caller. (A missing *query* over existing
  fields is ad-hoc, not missing scaffolding.)
- **Abilities: INSTANCE wiring only** (Rule 1). No mock logic — no anonymous overrides or
  fakes standing in for production logic.
- **Never edit the event-modelling docs or the GWT files.**
- If the scenario cannot be satisfied in the handler/aggregate/projector — because it needs a field
  the model does not have, or the business intent is ambiguous — STOP, implement nothing for
  it, and report it back to the caller so it lands in `development-report.md`. Do not
  invent behavior, and do not weaken the test to make it pass.