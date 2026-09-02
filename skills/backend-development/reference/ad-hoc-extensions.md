# Ad-hoc extensions — improving a slice without changing the model

Some requests are not model changes. "Add a search criterion to the policy list",
"add a repository query", "let this endpoint filter/sort" are **implementation
improvements over fields the read model already has**. Nothing in the event model
changes, so nothing in `<docs>/*.md`, the diagram, or `scripts/codegen/*` is touched.

This file is the complete recipe. Read it instead of reverse-engineering
`scripts/codegen/merge.js`.

## Is it ad-hoc, or is it a model change?

| request | verdict |
|---|---|
| query/filter/sort/search over fields the read model ALREADY has | **ad-hoc** — implement it here |
| a new way to read existing data (extra endpoint, extra repository method) | **ad-hoc** |
| a new *field* on a command, event or read model | **model change** — skip it and report it |
| a new *event*, command or read model | **model change** — skip it and report it |
| a `[bracketed]` decision needs implementing | **not ad-hoc** — that is a GWT scenario, see `backend-implement` |

When in doubt: if you would have to add a line to `commands.md`, `events.md` or
`readmodels.md` to describe it, it is a model change. The model is frozen during
development — skip it and record it in `development-report.md` rather than guess.

## It is still TDD

Ad-hoc describes the *scope* of a change, never a licence to skip the test.

1. Write the Spock spec first, under `src/test/groovy/<base>/<slice>/`.
   There is no `gwt-*.md` file, so the test method name is plainly descriptive
   (`"search policy list by policy holder substring returns matching policies"`)
   rather than a scenario heading copied verbatim.
2. Run it. Watch it fail for the right reason.
3. Write the minimal code that makes it green.

Use the generated ability DSLs to arrange state (`issue_policy { ... }`). For a
capability the DSL does not cover yet, call the projector directly through the
ability's accessor — `getPolicyListProjector().searchPolicyList("Ali")` — rather than
constructing a projector, repository or event by hand.

## Where the code goes

A generated file is **add-only**: regeneration inserts the members the model grew and
keeps everything already in the file, including your hand edits, verbatim. So an added
member survives every future run, and the slice's own projector/repository is the
correct home for an ad-hoc capability.

For a new query on a persisting (`:Key`) read model, three layers:

| file | change |
|---|---|
| `<Name>Repository` | **declare** the query, e.g. `List<XEntity> findByPolicyHolderContaining(String policyHolder);` |
| `<Name>InMemoryRepository` (test) | **implement** it — this one is a real class, so it will not compile without the method |
| `<Name>JpaRepository` | **nothing**. Spring Data derives `findBy…Containing` → `LIKE %value%` from the method name |
| `<Name>Projector` | **add** the endpoint that exposes it |

Forgetting the in-memory implementation is the usual first compile error; forgetting
that the JPA one needs nothing is the usual wasted step.

## The merge contract, in one table

`mergeGenerated` matches existing members against freshly generated ones by an
identity key, and only ever **adds** what is missing. Knowing the key tells you exactly
what is safe:

| member kind | identity key | consequence |
|---|---|---|
| REST-mapped method (`@GetMapping` etc.) | the **mapping route** | adding `@RequestParam` to an existing `@GetMapping("policy-list")` is the SAME member — preserved, never duplicated. Spring rejects two methods on one route, and the merge respects that. |
| field | its **name** | a hand-edited initializer is never re-inserted as a duplicate declaration |
| any other method | return type + name + parameter TYPES | genuine overloads (one `apply` per subscribed event) stay distinct |

Two ways to add an endpoint, both valid:

- **extend the existing route** — add `@RequestParam(required = false) String policyHolder`
  to the generated getter. One route per read model; the merge keeps it.
- **add a new route** — a separate `@GetMapping("policy-list/search")` method. A
  different key, so simply a new member.

## Trap: modifying a signature breaks the generated caller

The merge tolerates a rewritten member. **`javac` does not.** Generated `*Ability`
classes call the generated methods with their generated signatures:

```java
// PolicyListProjectorAbility (GENERATED)
return testCase.test(getPolicyListProjector().getPolicyList());
```

Changing `getPolicyList()` to `getPolicyList(String)` produces, far from the edit:

```
method getPolicyList in class PolicyListProjector cannot be applied to given types;
  required: java.lang.String
  found:    no arguments
```

So when extending an existing route, keep the no-argument call site valid — give the
parameter a default-friendly form the ability can still call, or add a new member
instead of reshaping the old one. Never edit the ability to match; it is generated, and
that edit will fail `--check`.

## Trap: `*Decider` state leaks across specs

`reset_event_stream()` clears the event stream and the registered projections. It does
**not** reset `*Decider` state. A decider holding a sequence or counter is shared across
every spec through the static ability instance, so a new spec that issues commands
silently perturbs an already-green one, and the failure appears as test *ordering*:

```
Condition not satisfied:
expect_policy_details(firstId) { it.policyNumber() == "P-1" }   // got P-4
```

If a decider is stateful, give it an explicit reset and call it from `setup()` in
**every** spec that exercises that slice:

```groovy
def setup() {
    reset_event_stream()
    IssuePolicyDecider.reset()
}
```

The decider is scaffolded-once and yours, so adding the reset hook is allowed. The
generated handler calls `decider.policyNumber()` with no arguments — keep that
signature, or the generated caller breaks (see the trap above).

## Verify

Same gates as any other backend change:

```
mvn clean verify                                              # green
node .opencode/skills/backend-development/scripts/codegen --check   # up to date
```

`--check` MUST still report `up to date`. Added members do not disturb it; a *rewritten*
generated member or an edited ability will.

Re-run `mvn verify` whenever a route or parameter changed — it re-exports
`api/openapi.json` from the running controllers. Report that it changed and leave it in
the working tree; never commit it.

## Known quirk: `?` lines in `readmodels.md` are inert

`readmodels.md` may carry lines like:

```
? policy holder
```

The parser matches `## <id>`, `Prop: value`, `<aggregate>:Id|Key` and `* field` only. A
`?` line matches none of them and is skipped **silently** — no field, no warning, no
`MODEL ERROR`. Confirm with `codegen --json`: it is absent from the parsed model.

Do not read such a line as an implemented or half-implemented feature, and do not treat
it as authority to change the model. It is inert text. If a criterion must actually
exist, it is an ad-hoc extension — implement it as described above.
