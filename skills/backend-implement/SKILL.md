---
name: backend-implement
description: >
  # Responsibility
  Implements ONE GWT scenario, test-first, in a sliced event-sourced project where all
  scaffolding is already generated. Writes exactly two things: a Spock test transcribed
  from the GWT file, and the minimal business logic inside a *Decider that makes it green.
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

# Context you need — and nothing more
1. The single `<docs>/gwt-<read-model>.md` scenario you were asked to implement.
2. The generated `*Ability` interfaces of the slices it mentions (`src/test/java/...`).
3. The `*Decider` class(es) in those slices (`src/main/java/...`).

Do NOT read `commands.md`, `events.md`, `readmodels.md`, the whole `src/` tree, or any
other slice. The scaffolding is already correct by construction; re-deriving it wastes
context and risks contradicting the generator.

# Two kinds of work
| you were asked to | path |
|---|---|
| implement a `<docs>/gwt-*.md` scenario | the flow below — logic lands in a `*Decider` |
| add a query/filter/sort/search over fields a read model ALREADY has | **ad-hoc extension** — same red/green discipline, but logic lands in the slice's projector/repository. See `.opencode/skills/backend-development/reference/ad-hoc-extensions.md` |

An ad-hoc improvement has no GWT file, so its spec name is plainly descriptive instead
of a scenario heading, and it needs no `[bracketed]` field and therefore no decider. It
is still test-first. Anything that would require a new *field* or a new *event* is a
model change, not ad-hoc — escalate.

# Flow — red, then green, nothing else

## 1. Write the test (it must compile; it may fail)
`src/test/groovy/<base>/<readmodel-package>/<ReadModel>Spec.groovy`

- The test method name is the GWT scenario heading, verbatim.
- given/when/then map 1:1 onto the GWT lines. No extra steps, no invented happy paths.
- Use ONLY the generated ability DSLs. Never construct a handler, projector, repository
  or event yourself; never `new` a domain class in a test.
  - command DSL: `issue_policy { it.policyHolder("Alice") }` -> returns the aggregate id
  - projector DSL: `expect_policy_document(id) { it.policyNumber() == "P-1" }`
  - `reset_event_stream()` in `setup()` — abilities share a static in-memory stream.
- Groovy note: Lombok builders are fluent, so write `it.field("v")`, not `it.field = "v"`.

### `reset_event_stream()` does NOT reset decider state
It clears the event stream and the registered projections — nothing else. A `*Decider`
holding a sequence or counter is shared across every spec via the static ability
instance, so a new spec that issues commands silently perturbs an already-green one and
the failure surfaces as test *ordering*:

```
Condition not satisfied:
expect_policy_details(firstId) { it.policyNumber() == "P-1" }   // got P-4
```

If a decider is stateful, give it an explicit reset (it is yours) and call it in
`setup()` in **every** spec exercising that slice:

```groovy
def setup() {
    reset_event_stream()
    IssuePolicyDecider.reset()
}
```

Run it. It MUST compile. A red-but-compiling test here is the expected state.

## 2. Read the failure — it names your target
A correct red looks like:
```
UnsupportedOperationException: [policy number] on event 'policy-issued' is a
business decision with no GWT scenario yet
    at IssuePolicyDecider.policyNumber(IssuePolicyDecider.java:12)
```
That stack trace IS the assignment. Open that decider, that method.

## 3. Implement the decision — in the decider, minimally
Replace the `throw` with the simplest logic that satisfies the scenario. Add a comment
naming the GWT scenario that justifies it.

- The decider is a `@Component` scaffolded once — it is yours, and regeneration preserves it.
- Keep it scenario-scoped: no validation, error handling, persistence or generality the
  scenario does not exercise. That is scope creep, not implementation.
- It must keep a no-argument constructor (the generated abilities instantiate it directly).

## 4. Verify
`mvn clean verify` green. Always build clean — stale `target/` classes produce phantom
Lombok failures. Then `node .opencode/skills/backend-development/scripts/codegen --check` must still report `up to date`.

# Hard boundaries
- **Never rewrite an existing member of a `// GENERATED ... DO NOT EDIT` file.** Changing
  a generated method's signature or body is not preserved intent — and it breaks the
  generated `*Ability` that calls it, far from your edit. If a generated member looks
  wrong, the MODEL is wrong — escalate to the architect.
  *Adding* a member to a generated projector/repository for an ad-hoc extension IS
  allowed and survives regeneration; see `reference/ad-hoc-extensions.md`.
- **Never write scaffolding.** No new commands, events, read models, handlers, projectors,
  abilities or serde wrappers. A missing command/event/read model means the model is
  missing it — escalate. (A missing *query* over existing fields is ad-hoc, not missing
  scaffolding.)
- **Never edit a generated `*Ability`.** That fails `--check`.
- **Never edit the event-modelling docs or the GWT files.**
- If the scenario cannot be satisfied by a decision in a decider — because it needs a field
  the model does not have, or the business intent is ambiguous — STOP and escalate. Do not
  invent behavior, and do not weaken the test to make it pass.
