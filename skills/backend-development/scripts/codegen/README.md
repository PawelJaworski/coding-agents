# Event-model codegen

Turns an event model (markdown) into Java scaffolding for a sliced, event-sourced
Spring Boot project. Domain-agnostic and reusable: the only project-specific input is
`codegen.config.json`.

```
node <skill>/scripts/codegen                 # regenerate
node <skill>/scripts/codegen --check         # CI gate: fail if generated code is stale
node <skill>/scripts/codegen --patch         # model -> code diff as .codegen/patch/*.json
node <skill>/scripts/codegen --json          # print the parsed model
node <skill>/scripts/codegen --accept-scaffold  # record once-files as reconciled with
                                             # their current template (marker only —
                                             # never rewrites the body)
node <skill>/scripts/codegen --project <dir> --model <dir>
node --test <skill>/scripts/codegen/*.test.js
```

The project root is found by searching upwards from the current directory for
`codegen.config.json`, so it runs from anywhere inside a project. A project needs no
wrapper script, no `package.json` and no install step — just that one config file.

## Why this is a script and not a prompt

The event model is a formal grammar and the target is a fixed set of templates, so
model -> code is a pure function. Asking an LLM to execute a pure function costs tokens
and reliability on every run and can never be unit-tested. Everything mechanical lives
here; the only thing left for an agent is business logic, entered through TDD.

The same argument applies to the *diff*. "What is missing in the code compared to the
model?" is also a pure function, so `--patch` computes it rather than asking an agent to.
An agent asked to diff will hallucinate members, miss others silently, and answer
differently every run — which would make `--check` useless as a CI gate.

## `--patch`: the diff as data

`--patch` is a dry run that writes one document per model category to
`.codegen/patch/` — `domain`, `events`, `commands`, `readmodels` and `gwt`. Each entry
names a file and carries exactly one verb:

| verb | meaning | `auto` |
|---|---|---|
| `CREATE` | the file does not exist. Pure addition, zero risk. | `true` — `codegen` writes it |
| `ADD` | the file exists and the model grew. Members are inserted; nothing already there is read, rewritten or removed. | `true`, except on hand-owned logic files |
| `UPDATE` | the file exists and its own logic conflicts with the model | `false` — always needs an agent |

`auto: true` entries are the generator's own work and need no agent at all. That is what
makes the patch worth reading: it isolates the small, dangerous `auto: false` subset —
in particular UPDATE, the only verb that can touch hand-written code, and therefore the
one restricted to the minimal edit that turns a red build green.

`.codegen/` is derived scratch. Never commit it.

## Files

| file | role |
|---|---|
| `naming.js` | every naming/packaging rule as a pure function. Replaces any "code index" — class names and packages are *computed* from the model, never looked up. |
| `parse.js` | model markdown -> normalised `model.json`, incl. value-object type resolution |
| `emit.js` | `model.json` -> Java sources |
| `runtime.js` | domain-independent event-sourcing runtime, scaffolded once per project |
| `merge.js` | add-only reconciliation of an existing `GENERATED` file. The only module that rewrites existing files, so it masks comments/literals before any structural scan and refuses to emit anything it cannot re-parse. |
| `advisory.js` | drift report for hand-owned logic files: what the model has that the file lacks, and what conflicts |
| `patch.js` | the model -> code diff as data: one entry per file, each carrying exactly one of CREATE / ADD / UPDATE |
| `next.js` | pending GWT scenarios and business rules, matched to the slice their spec must live in |
| `index.js` | CLI, config resolution, ownership-aware writing |
| `codegen.test.js` | unit tests for the grammar and naming rules |
| `merge.test.js` | unit tests for add-only reconciliation |
| `patch.test.js` | unit tests for the three verbs and their `auto` flag |

## Configuration

`<project root>/codegen.config.json`:

```json
{
  "basePackage": "com.example.myapp",
  "debugCodeGen": false,
  "modelDir": "docs/",
  "mainSourceRoot": "src/main/java",
  "testSourceRoot": "src/test/java"
}
```

Only `basePackage` is required. Set `debugCodeGen` to `true` to create
`.codegen/codegen-debug.log` when it does not exist and append every subsequent
invocation, codegen phase, selected workflow step, and exact prompt. Every
generated prompt (model errors, generator/verify failures, and each `GENERATE_*` /
`--prompt` step) is additionally logged verbatim, unescaped, in its own fenced
` ## PROMPT: <step> ` block — read that block, not the JSON `SELECT_STEP` entry, when
you need to see exactly what an agent was shown. Nested patch refreshes performed by
`--next` append to the same log. Setting it to `false` leaves any existing log untouched.

## Model grammar

Line-oriented, in `<modelDir>/{commands,events,readmodels}.md`:

```
## <kebab-id>            starts an element
Name: <human name>
Produces: <event-id>     (commands)
Subscribes: <e1>, <e2>   (read models)
<aggregate>:Id           on-demand projection: replayed from the stream per request
<aggregate>:Key          persisting projection: JPA table advanced on append
* field name             plain payload attribute (passthrough, wired by name)
* field name?            (read models only) DB-searchable field — see "search" below
* field name??           (read models only) search-only criterion, no stored value — see "??" below
* [field name]           a DECISION -> private handler/projector method that throws
* [field name]:uuid|now  system-generated by convention -> implemented for you
```

Field types resolve from `<modelDir>/business-definitions-raw.md`: a concept with
listed attributes becomes a value-object record; a concept without becomes `String`.

### Lists and nested payloads

Use `(List)` after a field name to declare a list and repeat `*` to indent child
attributes. A field with nested attributes declares a generated object named from
that field. This notation is valid in commands, events, and read models:

```markdown
* product (List)
* * name
* * description
```

generates:

```java
public record Product(String name, String description) {}
// in the command/event/read-model payload:
List<Product> productList
```

Nested objects may themselves carry a list:

```markdown
* insured parties (List)
* * name
* * addresses (List)
* * * street
```

The generated transport type is `List<InsuredParties>` (or
`InsuredParties` without `(List)`) for a nested field and `List<String>` for a
leaf list. A direct command→event passthrough requires the field name, `(list)`
marker, child order, and every nested child to be identical — a mismatch there
is a `MODEL ERROR` that stops generation, since a command must supply an event's
data exactly.

An event→read-model field is more forgiving: when it can't be derived
automatically (name/shape don't match, or the read model only wants to flatten
part of a nested/list event field), generation does **not** abort. The field is
delegated to the read model's `*ProjectionDecider` — same mechanism as a
`[bracketed]` field — and the generated decider method throws
`UnsupportedOperationException` explaining exactly which field/event it
couldn't map and why. Every other file, field, and read model is generated
normally; hand-implement that one method once the real flattening/filtering/
aggregation rule is known (a GWT scenario), same as any other projection
decision.

### The identity attribute is implicit

The `<aggregate>:Id|:Key` line is itself a read model attribute. Every read model
record starts with a first component `<aggregate>Id` (`:Id` models) or
`<aggregate>Key` (`:Key` models), type `UUID`, always equal to the event's
`aggregateId` — so it can never drift from the header. Never write `* policy id`
or `* policy key`: an explicit same-name line is absorbed (its `?`/`:Key` markers
merged), and a `[bracketed]` duplicate is a model error.

## File ownership

| header | ownership |
|---|---|
| `// GENERATED by ... DO NOT EDIT` | generator-owned, reconciled **add-only** on every run (see `merge.js`): members the model grew are inserted, everything already in the file — including hand edits — is kept verbatim. An existing member is never rewritten or removed. |
| `// SCAFFOLDED ONCE ... this file is YOURS` | project-owned, written only when absent |

Generated per run: value objects, events, `DomainEventType`, `StateProjector`, serde
wrappers + registry + `DomainEventSerde`, commands, handlers, read models, projectors,
and all test abilities.

Scaffolded once: the runtime (`DomainEvent`, `EventStream`, `DomainEventEntity`,
repositories, ...), plain `*Aggregate` state objects, and read-model `*ProjectionDecider`s.

## Where logic lives

Passthrough fields (command -> event -> read model) are wired automatically by name.
A `[bracketed]` command-event field has no upstream source, so the handler gets a private
method that throws `UnsupportedOperationException` naming the field and event. A
bracketed read-model field is delegated to its `*ProjectionDecider`. That throw is the
intended state until a GWT scenario drives it out.

One plain `<Name>Aggregate` is scaffolded from all events carrying `<name>:Id`. It is not
a Spring component and has no test ability. A handler constructs and hydrates it locally
with `hydrate(null, eventStream.findAllById(id))` only when a rule needs state from that
aggregate's history. Decisions using global or cross-aggregate state do not belong in
the aggregate; keep a one-off decision private in the handler or extract a domain
service when it needs collaborators or reuse.

Deliberately NOT a mock value: a plausible mock can make a GWT test pass with no
implementation, and a false green is worse than a missing one.

## Failure modes

The generator refuses to guess. It exits non-zero with a `MODEL ERROR` for an unknown
event reference, a missing `Produces:`/`Subscribes:`, an unknown `:convention`, or an
event field that no command supplies and that is not bracketed:

```
MODEL ERROR  Model gap: event "thing-happened" field "mystery field" is not supplied
by command "do-thing" and is not [bracketed]. Either add it to the command or bracket it.
```

Fix the model — never work around it in code.

## Projection strategy: `:Id` vs `:Key`

A read model must declare one or the other; the generator refuses to guess.

| | `<aggregate>:Id` | `<aggregate>:Key` |
|---|---|---|
| strategy | on-demand | persisting |
| identity attribute | `<aggregate>Id: UUID` | `<aggregate>Key: UUID` |
| storage | none | `<Name>Entity` + `<Name>Repository` / `...JpaRepository` |
| kept current by | replaying `findAllById` on each GET | `EventStream.append` pushing to `PersistingProjector.project` |
| endpoint | `GET <id>/{aggregateId}` -> one row | `GET <id>` -> `List<...>` |
| test DSL | `expect_x(aggregateId) { it.field() == ... }` | `expect_x { rows -> rows.size() == 1 }` |

Use `:Key` when the view spans aggregates (a list, a search, a report): the event stream
only offers `findAllById`, so such a view cannot be rebuilt on demand and must be
maintained. Use `:Id` for everything else — it has no table to keep in sync.

Both share the same `apply(state, event)` folds and the same `*ProjectionDecider` for
`[bracketed]` fields, so switching a read model between the two is a one-word model edit.

### Every component owns its own test utility

`EventStreamAbility` is domain-independent and must never name a slice. A persisting
projection wires *itself*: its sibling `<Name>ProjectorAbility` declares the in-memory
repository and registers the projector (plus its reset) via `EventStreamAbility.register`.
Adding or removing a `:Key` read model therefore touches only that slice.

Registration is safe because a class's superinterfaces that declare default methods are
initialised with it (JLS 12.4.1), so a spec `implements PolicyListProjectorAbility` has
registered before `setup()` runs. `EventStreamImpl` keeps the projector collection **by
reference** for the same reason — copying it would drop late registrations.

## Persisting projections: embeddables, composite keys and search

Persisting projections are keyed by their natural attributes or by `aggregateId`. A field on
a persisting read model can be marked with a trailing `:Key` (e.g. `* policy number:Key`):

- when `:Key` field(s) are present: the generator emits a `<Name>Key` `@Embeddable record`
  composed of those key fields. The entity uses `@EmbeddedId private <Name>Key id;`, and
  repositories/lookups operate on `<Name>Key` instead of `UUID aggregateId`. Multiple
  aggregates project into distinct rows identified by their business keys;
- when no field carries `:Key`: the entity falls back to `UUID aggregateId` as `@Id`.

A value-object field on the read model becomes:

- a scalar-only value object (all `String` attributes) -> the record is `@Embeddable` and the
  entity embeds it with `@Embedded` + `@AttributeOverrides`, flattening its attributes into
  prefixed columns (`policyHolder.name` -> `policy_holder_name`), so they are queryable;
- a value object carrying a list -> stored as JSON (`@JdbcTypeCode(SqlTypes.JSON)`), because a
  list cannot be an embeddable.

The persisting projector's `GET <id>` list endpoint accepts search params: every scalar
field of the read model (and every scalar attribute of an embedded value object) becomes a
`@RequestParam Map<String, String> search` key. `policy-list?policyHolder.name=oh` becomes a
server-side `LOWER(column) LIKE '%oh%'` predicate: the projector calls
`repository.findAllBySearch(search)`, and the JPA repository implements it with a
`JpaSpecificationExecutor` + `Specification` (`findAll(Specification)`), so filtering
happens in the database, not in memory. The in-memory test repository mirrors the same
AND-over-present-keys semantics, and the sibling `<Name>ProjectorAbility` exposes an
`expect_x(Map search, Predicate)` overload to drive the search from a spec.

### `??` — a search-only criterion with no stored value

`* field name??` (double `?`, read models only) declares a search key that is **not** a
field at all: no entity column, no record component, never part of the JSON response, and
not wired from any subscribed event. It's for a criterion whose match logic is more than a
plain `LIKE` over one column (the "hand-added criteria" case below) but that you still want
the generator to wire the query-param plumbing for, rather than hand-adding it entirely.

The generator:
- adds a `matches<Field>(String value, <ReadModel> entity)` stub to the read model's
  `*ProjectionDecider` (the same `once`-scaffolded, hand-owned class `[bracketed]` fields
  already use) — `once: true`, so it throws `UnsupportedOperationException` until you
  implement it, and is never overwritten afterward;
- wires the decider as a collaborator of the persisting projector even if no `[bracketed]`
  field needs one;
- in the projector's `GET <id>` method, applies an **additional Java `.filter(...)` step
  AFTER** `repository.findAllBySearch(search)` returns — i.e. in memory, over the already-
  fetched/DB-filtered result — calling `decider.matches<Field>(value, entity)` only when
  that key is present and non-blank in the incoming `search` map.

This never touches `readModelJpaRepository`/`readModelInMemoryRepository` — `??` keys are
simply not among the columns those know how to build a `Specification`/case for; the DB-level
search step runs exactly as it does today, unaffected.

**MODEL ERROR at parse time** if the criterion shares not one word with any of the read
model's own field labels or value-object attributes (the read model's own aggregate name is
excluded from this check, since a project's convention of prefixing every field with it would
otherwise make every field trivially "overlap"). The decider's `matches<Field>` gets no
collaborator beyond a no-arg constructor — it can only ever compute a match from data already
on this read model, so a criterion with zero shared vocabulary has no data path to a real
implementation. That is an architect decision (add the underlying field, or confirm the
criterion belongs on a different read model entirely), not something to guess in a decider
body — so the parser refuses the model outright instead of letting an agent discover the gap
only after already writing a stub decider full of invented state.

## Not supported yet

Composite keys and derived keys are not generated; DB-level search (`?`) is a `LIKE`
containment filter over a scalar String (or embedded scalar) field only — list-bearing JSON
value objects are not searchable that way (see `??` above for a criterion that needs more
than `LIKE`, once its projector-side implementation exists).

Hand-added criteria that need more than a plain `LIKE` and that you do NOT want the model to
declare at all (e.g. a one-off internal query, not part of the read model's public search
contract) still live in the slice as a hand-added member on the generated
projector/repository — the add-only merge exists to preserve exactly that. See
`../../reference/ad-hoc-extensions.md` for the recipe. Extending the model's vocabulary
(`?`/`??`) instead is a generator change, and a deliberate architect decision.
