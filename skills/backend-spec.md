# backend-spec.json — the planner→executor contract

`backend-plan` writes this file; `backend-generate` reads it and transcribes. It is the
**single handoff** between the two stages. The executor must never need anything else
(no docs, no GWT, no business definitions, no judgment).

- Path: `target/backend-spec.json` (project-relative Maven build dir; gitignored).
- It is a **diff** of everything to create/change — the planner overwrites it with the
  full desired end state, so the executor can process it top to bottom.
- Every field is explicit. No "same as above", no "derive from context".

## Top-level shape

```json
{
  "meta": {
    "schemaVersion": 1,
    "basePackage": "pl.pjaworski.insurance_company",
    "description": "human summary"
  },
  "targets": [ /* one object per file/artifact to produce */ ]
}
```

## Target kinds (the `kind` field)

| kind                | template file(s)                  | purpose |
|---------------------|-----------------------------------|---------|
| `command`           | DoSomethingOnFooCmd.java          | a command record |
| `command-handler`   | DoSomethingOnFooHandler.java      | an HTTP command handler |
| `event`             | FooEvent.java                     | a domain event record |
| `event-serde`       | FooEventSerdeWrapper.java         | one serde wrapper per event (in `infrastructure`) |
| `serde-wiring`      | (wires `DomainEventSerdeWrapper`/`DomainEventEntity`) | register wrappers + `serialize()` switch |
| `event-type`        | (append to DomainEventType)        | enum constants |
| `state-projector`   | StateProjector.java               | the shared state projector switch |
| `read-model`        | (plain record)                    | the read-model record |
| `projector`         | FooOnDemandProjector / FooPersistingProjector | read-model projector |
| `entity`            | FooReadModelEntity.java           | JPA entity (persisting projector only) |
| `repository`        | FooRepository / InMemory / Jpa    | repository triad (persisting projector only) |
| `ability`           | FooAbility.java                   | test DSL per Spring component |
| `test`              | ReadModelUnitTest.groovy          | Spock test for one read model with a GWT file (COMPILES first, may still fail) |
| `implementation-sketch` | (attached to command-handler / projector / state-projector) | the minimal-but-functional behavior outline that makes the test green |

## Required fields per kind (the fields the executor reads)

- **command**: `className`, `package`, `recordComponents[{type,name}]`
- **command-handler**: `className`, `package`, `commandClassName`, `postMapping`
- **event**: `className`, `package`, `aggregateId`, `eventTypeEnum`, `otherAttributes[{type,name}]`
- **event-serde**: `className`, `package`, `eventClassName`, `eventTypeEnum` (wraps the event for the event store)
- **serde-wiring**: `package`, `addSerdeWrappers[{eventTypeEnum, wrapperClassName, eventClassName}...]`
- **event-type**: `package`, `appendToEnum[string...]`
- **state-projector**: `package`, `addEventCases[{eventTypeEnum, eventClassName}...]`
- **read-model**: `className`, `package`, `aggregateIdPresent(bool)`, `fields[{type,name}]`
- **projector**: `className`, `package`, `template`, `readModelClassName`, (+`entityClassName`/`repositoryClassName` when persisting)
- **entity**: `className`, `package`, `fields[{type,name}]`
- **repository**: `interfaceName`, `implName`, `jpaName`, `package`, `entityClassName`
- **ability**: `className`, `package`, `clazz` (wrapped component), `dsl[{name, kind}]`
- **test**: `className`, `package`, `implements[abilities]`, `body` (fully-resolved Spock method text,
  must COMPILE), optionally `implementationSketch` (the minimal behavior outline)
- **implementation-sketch** (on command-handler / event / state-projector / projector): an explicit
  minimal rule - e.g. "handler injects EventStream, appends <Event> and returns the new aggregate id",
  "`apply(PolicyIssuedEvent)` builds the read model", "policy number = `P-` + per-policy sequential
  counter". This is the LOWER bound of behavior the executor transcribes; keep it scenario-scoped.

## Notation rules the planner applies (so the executor never re-derives them)

- `{aggregateName}:Id` on a bullet list names the **aggregate id** concept only — a separate
  `aggregateId` field, never aliased to a business attribute.
- `[bracket]` fields on a **read model** are projection-time generated — they must **not** be
  pushed upstream onto command/event.
- A bracketed field on an **event** (e.g. `[policy number]`) is where the aggregate seeds/decides
  that value — it appears on the event, not the command.

## Resolution - test-first + minimal sketch

Generation is TEST-FIRST for every GWT scenario:
1. The executor writes a COMPILING unit test (may legitimately fail at runtime at this stage).
2. The executor then writes a **minimal implementation sketch** - the few lines of real behavior the
   spec's `implementationSketch` outlines (handler event emission, projector/state `apply` building
   the read model, ordinal/serial rule) - just enough to make the test green.
3. The full suite must end GREEN (`mvn clean verify`).

The sketch is the LOWER bound of behavior, never a license to gold-plate (no validation, error
handling, or generality the scenarios don't exercise). A genuinely ambiguous business rule that no
sketch can bridge is escalated to the user/architect - it is never guessed.

The executor writes exactly the `targets` in this file and edits nothing outside spec targets (except
the minimal sketch those targets describe). Pre-existing files that are not `targets` (infrastructure,
`eventstream/`, serde, config, and any existing entity/repo) are off-limits - never add scaffolding
(e.g. a `@Transient` carry-around field) or shims to make a test pass. The pipeline ends with a
`<project root>/REPORT.md` capturing the biggest problems met in the conversation.
