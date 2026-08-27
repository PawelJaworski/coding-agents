---
name: backend-plan
description: >
  # Responsibility
  The PLANNER stage of backend code generation. It reads the event modeling docs
  (commands.md, events.md, readmodels.md), the GWT scenario files (gwt-*.md) and the
  existing source tree, decides what code is missing, and writes a compact, precise,
  machine-readable diff-spec to a fixed artifact path (target/backend-spec.json).
  It performs ALL reasoning. It does NOT write any code and holds NO code templates.
  For each GWT scenario the planner emits a COMPILING unit test (it may still fail at this
  stage, but it MUST compile) plus the outline of a SIMPLE, minimal-but-functional
  implementation sketch the executor fills in to make the test green.
  # When to use
  Use when there is a need to change backend code and a precise plan of what to
  create/change must be produced before any file is generated. The EXECUTOR stage
  (backend-generate) consumes the spec it produces.
  # **Important** This skill is parametrized
  * parameters: <docs>, <eventModel> are passed from outside. You have to know them before staring this skill execution. Don't ever execute this skill without exactly knowing those params.
---

# Role: PLANNER (decide), not EXECUTOR (transcribe)
You analyze and produce a spec. You do NOT write Java/Groovy files, and you do NOT
know (or need to know) the code templates. The executor does that. Your output is a
single JSON diff-spec. Keep every entry explicit and self-contained so the executor
never has to infer anything.

# Output artifact - fixed path
Write the spec to: `target/backend-spec.json` (project-relative, i.e. the Maven
build dir). It is gitignored and writable. The facade hands the same path to the
executor. If the file already exists, OVERWRITE it with the full desired end state
(the spec is a diff of everything to (re)create/change, not an incremental patch).

# Inputs to read (in one parallel batch)
* `<docs>/commands.md`
* `<docs>/events.md`
* `<docs>/readmodels.md`
* `<docs>/uis.md` (if present)
* `glob <docs>/gwt-*.md` and read every GWT file found
* `glob src/main/java/**/*.java` and `glob src/test/java/**/*.java` to learn what already exists (so the spec only lists truly missing/changed elements)
* `<docs>/business-definitions-raw.md` for attribute/type resolution

# Deciding what goes in the spec - core reasoning rules
For each element declared in the docs, compare against what already exists in `src/`:
* If a command/event/read model (and its handler/projector) does NOT exist in src, add
  a target entry to the spec.
* If it exists but its attributes changed, add an entry that (re)declares its current
  full attribute set (the executor regenerates the file).
* If it exists unchanged, omit it.

## Command -> spec entry (kind: "command")
A command entry produces a `{Pascal}Cmd` in a package named after the command (lowercase
kebab -> no separator, e.g. `issue-policy` -> `issuepolicy`; `create-proposal` -> `createproposal`).
For each bulleted field on the command, emit one `recordComponent` with the business type + name.
* Skip any field that the command does not actually supply (bracketed fields on the READ
  MODEL are projection-only - see notation mapping below). Commands generally carry all
  non-bracket source fields.

## Command handler -> spec entry (kind: "command-handler")
One per command. Sets className, package (same as command), commandClassName, and the
POST mapping (the kebab-case command id).

## Event -> spec entry (kind: "event")
* `aggregateId`: the aggregate concept named by the `{x}:Id` line (e.g. `policy:Id` -> "policy").
  The record gets a `UUID aggregateId` component whose value is supplied downstream; do NOT
  alias it to a business attribute. See notation mapping below.
* `otherAttributes`: every bulleted field on the event declaration (bracket or not - the event
  is where the field is produced; read-model brackets are a different thing). Note: an event can
  carry a bracketed `[policy number]` because the NUMBER is decided when issuing (policy.Number
  is the POLICY's own unique identifier, seeded here).
* `eventTypeEnum`: the SCREAMING_SNAKE of the aggregate + action (e.g. `policy-issued` ->
  `POLICY_ISSUED`, `proposal-created` -> `PROPOSAL_CREATED`).

## DomainEventType enum -> spec entry (kind: "event-type")
Collect every distinct eventTypeEnum across all events and pass them as one `appendToEnum` array on
a single entry. The executor appends them to the enum.

## StateProjector -> spec entry (kind: "state-projector")
Collect every (eventTypeEnum, eventClassName) pair across all events into one entry's `addEventCases`.
The executor wires each case's `apply` switch.

## Event serde -> spec entries (kinds: "event-serde" and "serde-wiring")
Every declared event must be serializable by the event store. Emit TWO things:
1. One (kind: "event-serde") target PER event -> a `{Pascal}EventSerdeWrapper` file
   (template `FooEventSerdeWrapper.java`) in `{base}.infrastructure`. Fields:
   `className` (`{Pascal}EventSerdeWrapper`), `package` (`{base}.infrastructure`),
   `eventClassName` (`{Pascal}Event`), `eventTypeEnum`.
2. ONE (kind: "serde-wiring") entry collecting ALL events into `addSerdeWrappers`:
   each element is `{eventTypeEnum, wrapperClassName, eventClassName}`. The executor uses it to
   register each wrapper in `DomainEventSerdeWrapper`'s `@JsonSubTypes` and to wire the
   `serialize()` switch in `DomainEventEntity` (which are existing infrastructure files that the
   planner DOES target for this wiring). The `@Transient` carry-around field must be removed —
   serialization is the one true path.

## Read model -> spec entry (kind: "read-model")
* `aggregateIdPresent`: true if the read model declares an `{x}:Id` line (on-demand projector), false
  otherwise (persisting projector). On-demand: fetch all events by aggregate id; persisting: needs an
  entity + repository triad.
* `fields`: the READ MODEL's own projected fields. Bracketed `[field]` fields on the read model are
  system-generated/calculated AT PROJECTION (e.g. `[policy number]` on policy-document read model) - they
  must NOT be copied onto the event/command; they exist only on the read model.
* For a read model WITHOUT aggregate id, add the entity + repository targets too (see below).

## Projector -> spec entry (kind: "projector")
* If `aggregateIdPresent` is true -> template `FooOnDemandProjector.java`.
* Else -> template `FooPersistingProjector.java`, plus (kind: "entity") and (kind: "repository")
  entries if the entity/repo don't already exist.

## Ability -> spec entry (kind: "ability")
One per Spring component (every @Component/@RestController/@Service in the slice). The planner emits
the DSL helpers the tests will need (command-issue DSL + projector DSL). See capacity - if computing the
full generated ability body is too heavy for the planner context, emit the component name + which DSLs
are needed and let the executor assemble from the FooAbility template.

## Test -> spec entry (kind: "test") - HYBRID + TEST-FIRST
The test is the one artifact where real logic lives (given/when/then -> assertions). The planner MUST
produce a CONCRETE, fully-resolved body and attach it as `body` (Java String) so the executor writes it
verbatim without re-reading the GWT file. The test MUST COMPILE at the time it is written, even though
it may not pass yet (test-first). Emit one test entry PER read model that has a gwt-*.md file:
* `methodName` from the GWT scenario heading (e.g. "when issue policy then policy number has next ordinal").
* `body`: the complete Spock `def "..."() { }` method text with concrete ability DSL calls and assertions
  matching the GWT given/when/then EXACTLY. Do not emit generic happy paths. Keep the assertions driving
  only what the scenario checks, so the minimal sketch can satisfy them.
* `implementationSketch`: a short, explicit outline of the SIMPLE, minimal-but-functional logic the
  executor writes to make this test green (for example: handler appends its produced event into the
  event stream and returns the new aggregate id; projector `apply(PolicyIssuedEvent)` builds the read
  model; ordinal/serial is a monotonically derived value). Give the concrete rule (e.g. "policy number =
  `P-` + sequential counter incremented per issued policy"). This is the LOWER bound of behavior - keep
  it minimal and scenario-scoped; do not design production-grade complexity here.
Only emit tests for read models WITH a GWT file.

## Implementation sketch -> spec entry (kind: "implementation-sketch")
Optionally the planner can also attach the same minimal-sketch outline to the affected
`command-handler` / `projector` / `event` / `state-projector` entries so the executor has the concrete
behavior to transcribe (e.g. "handler injects EventStream, appends <Event>, returns the generated id").
Where the outline is emitted on the `test` entry, mirror it to the relevant component entries so the
executor follows it literally without re-deriving it.

# Event modeling notation mapping (apply when building the spec)
1. `{aggregateName}:Id` on an event/command/read model names the AGGREGATE ID concept only - a separate
   declaration, NOT a reference to one of the `*` attribute bullets.
2. Every `* field name` (including `[bracketed]` ones) is a plain payload attribute.
   `[brackets]` mean "system-generated or calculated, no direct upstream passthrough" - this signals
   the READ-MODEL projection computes it. The COMMAND does not supply it; on the EVENT it is seeded/deduced
   where the aggregate creates it.
3. Never alias `aggregateId()` to a business attribute.

# Rule of precision
Every field you emit MUST be unambiguous to an executor that has never seen the docs. If you find
yourself leaving a placeholder, a "same as above", or a "derive from context" directive - STOP and
make it explicit. The spec is the contract; the executor follows it literally.

# Boundaries
Never edit the event-modelling docs (`<eventModel>/commands.md`, `<eventModel>/events.md`,
`<eventModel>/readmodels.md`, `<eventModel>/uis.md`), the generated diagram, or the diagram generator -
owned by the architect. Never write code into `src/` - that is the executor's job.
