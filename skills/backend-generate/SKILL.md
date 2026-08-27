---
name: backend-generate
description: >
  # Responsibility
  The EXECUTOR stage of backend code generation. It reads a single precise diff-spec
  (target/backend-spec.json written by backend-plan), and for every entry transcribes the
  file from the corresponding code template. It works TEST-FIRST: write a compiling unit
  test (it may fail but MUST compile), then provide a simple, minimal-but-functional
  implementation sketch that makes the test green. It follows the spec LITERALLY, never
  re-reads the event modeling docs, never reads GWT files, and never consults business
  definitions.
  # When to use
  Use when a backend-spec.json already exists (produced by backend-plan) and the actual
  Java/Groovy files must be generated from it.
  # **Important** This skill is parametrized
  * parameters: <docs>, <eventModel> are passed from outside (used only to locate the
    project root / target dir). You have to know them before staring this skill execution.
---

# Role: EXECUTOR (transcribe), not PLANNER (decide)
You never decide WHAT to build - only HOW to write it from the spec. Your only inputs are
`target/backend-spec.json` and the code templates in `templates/` next to this file. If a
spec entry leaves any doubt about what to write, DO NOT guess - treat the spec as
incomplete and stop/escalate rather than invent. (The planner was told to be fully explicit,
so any ambiguity is a spec defect, not a gap for you to fill.)

# Hard rule: write spec targets + a MINIMAL implementation sketch, never gold-plate
You write EXACTLY the files the spec lists as `targets`, and nothing else. When a target's
behavior is what makes a GWT test green, you write a SIMPLE, minimal-but-functional
implementation (a "sketch") from the spec's `implementationSketch` / mirrored outlines:
- **Compiling test first**: transcribe each `test` entry's `body` verbatim. At this point the
  test MUST compile (it may legitimately still fail at runtime - that is test-first).
- **Then make it green with a minimal sketch**: give the handler/projector/state the few lines
  of real behavior needed to pass the test (e.g. handler injects `EventStream`, appends its
  produced event and returns the new aggregate id; projector `apply(<Event>)` builds the read
  model; a counter yields the next ordinal). Follow the spec's `implementationSketch` LITERALLY,
  never re-deriving a rule the planner already gave you.
- **Blue-pencil, don't gold-plate**: if you find yourself adding production-grade structure,
  validation, error handling, or generality that the scenario does not exercise - STOP. That is
  scope creep, not a sketch. The sketch is the LOWER bound of behavior, not a design.
- **Pre-existing files NOT named as a spec `target` are off-limits**, with ONE exception: the
  spec's `serde-wiring` / `state-projector` entries explicitly target the existing
  infrastructure (`DomainEventSerdeWrapper`, `DomainEventEntity`, `DomainEventType`,
  `StateProjector`) for wiring. You may READ other pre-existing files (e.g. `EventStream`,
  `EventStreamImpl`, `DomainEventInMemoryRepository`) to wire the minimal sketch, but you must not
  add bypass scaffolding to them (no `@Transient` carry-around fields, no commented-out payloads,
  no shims).
- If a test cannot be made green even with a minimal sketch because the spec is missing intent
  (e.g. conflicting business rules) or a genuine defect, that is a **spec defect** - STOP, report
  it back to the facade/planner, and do NOT invent behavior to force a pass.

# Inputs
* Spec: `target/backend-spec.json` (project-relative). Must exist; if missing, you have
  nothing to do - report it.
* Templates: `templates/*` (all under this skill). Read a template ONLY when an entry needs it.

# General transcribing rules
1. Copy the named template verbatim, then apply ONLY the substitutions the spec entry provides.
2. Replace `{base}` with `basePackage` from spec `meta`.
3. Replace every `Foo`/`SomethingHappenToFoo`/`do-something-on-foo`/`SOMETHING_HAPPEN_TO_FOO`
   placeholder with the concrete names the entry gives.
4. Replace `/**attributes**/` / `/**other attributes**/` / record-components with the entry's
   actual list, comma-separated, `Type name` per component. Do NOT add anything else.
5. Add missing imports ONLY when a substituted field/type requires them. Do not add imports for
   unused things.
6. Add attributes/beans/logic ONLY when the spec entry provides them - either directly or through
   an `implementationSketch` (a minimal behavior outline). Never add production-grade logic a sketch
   does not describe.
7. Write every file to the package path derived from its `package` field: `src/main/java/<pkg>
   (dots->/)/<ClassName>.java`, except abilities/tests which go under `src/test/java/`.
8. Batch writes in 2-3 parallel groups (commands+handlers, events+type+projector, tests/abilities).
9. Write the Spock tests FIRST (test-first), confirm they compile, then write the minimal sketches
   that make them green, then run the full build.

# Per-kind transcription map
For each spec target, apply the matching row. The `template` field names the file in `templates/`.

### kind: "command"  (template: DoSomethingOnFooCmd.java)
-> `<pkg>/<className>.java`, class = public record <className>(<<components>>) {}
   record components = the entry's `recordComponents` as `Type name` joined by ", ".
### kind: "command-handler"  (template: DoSomethingOnFooHandler.java)
-> `<pkg>/<className>.java`. Substitutions:
   - class name <className>, implements CommandHandler<<commandClassName>>
   - @PostMapping("<postMapping>")
   - If the entry carries an `implementationSketch` describing how the handler emits its produced
     event into the event stream and returns the aggregate id, implement that minimal behavior
     (inject the EventStream as a constructor dependency) so the corresponding test can go green.
### kind: "event"  (template: FooEvent.java)  -> `<pkg>/<className>.java`
   - record <className>(UUID aggregateId, <<otherAttributes>>) implements DomainEvent
   - eventType() returns DomainEventType.<eventTypeEnum>
   - add each otherAttribute as `Type name`, comma-separated.
   - NEVER alias aggregateId to a business attribute.
### kind: "event-type"  (template: DomainEventType enum)
   - add each string in `appendToEnum` as a new enum constant (append to existing constants).
### kind: "state-projector"  (template: StateProjector.java)
   - for each `addEventCases` entry add a `case <eventTypeEnum> -> apply(state, (<eventClassName>) event);`
     mapping and a `default S apply(S state, <eventClassName> event) { return state; }` stub.
   - Update the `apply(S state, DomainEvent event)` switch to include all cases.
   - If the spec supplies `implementationSketch` behavior for an apply stub (how a read model is
     built from an event), implement that minimal projection in the stub instead of returning `state`.
### kind: "event-serde"  (template: FooEventSerdeWrapper.java)
   -> `<pkg>/<className>.java`, package = entry `package` (always `{base}.infrastructure`).
   Substitutions: class <className> = `{Pascal}EventSerdeWrapper`, record component event of type
   <eventClassName>, `@JsonTypeName("<eventTypeEnum>")`, `getEventType()` returns
   `DomainEventType.<eventTypeEnum>`.
### kind: "serde-wiring"  (wires existing `DomainEventSerdeWrapper` + `DomainEventEntity`)
   - `addSerdeWrappers` = [{eventTypeEnum, wrapperClassName, eventClassName}...].
   - In `DomainEventSerdeWrapper`: set `@JsonSubTypes` (one `@JsonSubTypes.Type(value = <wrapperClassName>.class, name = "<eventTypeEnum>")` per element).
   - In `DomainEventEntity.serialize(DomainEvent event)`: replace the stub with a switch over
     `event.eventType()` returning `new <wrapperClassName>( (<eventClassName>) event )` per element.
   - In `DomainEventEntity`: remove the `@Transient` carry-around field and delete the null-fallback in
     `toDomainEvent()` (it becomes `return eventJson.event();`).
### kind: "read-model"  (template: none - a plain record)
   - create record <className>(<<fields>>) in `<pkg>`. Use `fields` `Type name` list.
### kind: "projector"  (template: FooOnDemandProjector.java | FooPersistingProjector.java chosen by planner)
   - FooOnDemandProjector: class <className> implements StateProjector<<readModelClassName>>,
     readModelClassName set, getter method + @GetMapping("foo/{aggregateId}").
   - FooPersistingProjector: class <className> implements StateProjector<<readModelClassName>>,
     depends on <entityClassName>/<repositoryClassName> from the spec; implement apply() stubs from the
     spec's `applyDetails` if present.
   - For EITHER projector: if the spec's `implementationSketch` says the `apply(<Event>)` stub must
     build the read model from the event, implement that minimal projection (don't leave it returning
     null/state), so the behavioral projection test can pass.
### kind: "entity"  (template: FooReadModelEntity.java)
   - JPA entity record with the fields the spec gives (securing the persisting read model's columns).
### kind: "repository"  (template: FooRepository / FooInMemoryRepository / FooJpaRepository)
   - create interface + in-memory + jpa impl exactly per template, class names from the spec entry.
### kind: "ability"  (template: FooAbility.java)
   - create `src/test/java/<pkg>/<className>.java` test DSL interface wiring command/projector abilities,
     following the template comments and the spec entry's `dsl` hints (which getters/DSLs are needed).
### kind: "test"  (template: ReadModelUnitTest.groovy)
   - create `src/test/groovy/<...>/<className>.groovy` (or the path the environment uses for Groovy
     tests). The entry supplies a fully-resolved `body` (a Spock `def "..."() {}` method) and the
     `implements` ability list. Write the class shell and paste the `body` VERBATIM as the method.
     Do NOT re-read any gwt-*.md.
   - TEST-FIRST: this test must COMPILE immediately. It may still fail at runtime until the minimal
     implementation sketch (see command-handler / state-projector / projector rows) is written. That
     red-but-compiling state is expected and acceptable in step 3a; resolve it in step 3b.

## Test-first + minimal sketch flow (3 phases)
1. **3a - Compiling test**: transcribe every `test` entry (and its abilities). Run `mvn
   test-compile`/`mvn clean test-compile` and confirm the tests COMPILE (they may fail). This is the
   first gate - never proceed until every test compiles.
2. **3b - Minimal implementation sketch**: implement the minimal behavior the spec outlines
   (handler event emission + aggregate id return, projector/state `apply` building read models,
   ordinal/serial logic). Re-run the failing tests and make them green.
3. **3c - Full verify**: run `mvn clean verify`; the whole suite must pass. Fix only genuine
   transcribing mistakes; never gold-plate a sketch to pass.

# Mandatory checks before finishing
- [ ] Every top-level spec target produced exactly one file at the package-derived path
- [ ] No file written outside `src/main/java` or `src/test/java` except the spec itself
- [ ] No file edited that was NOT listed as a spec `target` (see "Hard rule" above) except the
      minimal sketch logic the spec's `implementationSketch` describes
- [ ] Only substitutions from the spec entry + `{base}` were applied to templates, plus the minimal
      sketch behavior the spec outlines
- [ ] Every `test` entry COMPILES (the 3a gate) before its sketch is written
- [ ] The minimal sketch is minimal - no validation, error handling, or generality the scenarios do
      not exercise
- [ ] `mvn clean verify` ends GREEN; fix ONLY transcribing mistakes + minimal-sketch blind spots,
      never gold-plate.

# Verification
Run `mvn clean verify` once all main files are written. **Always build clean FIRST.**
Incremental `target/` can hold stale `.class` files from a previous template-driven compile,
which produce phantom failures (e.g. "constructor X requires no arguments" when a
Lombok-generated all-args constructor exists but the stale class predates it). Only a clean
build is authoritative. Treat `mvn` results as authoritative (ignore Lombok LSP noise).

# Report of problems
After the code is done and verified, write `<project root>/REPORT.md` with the biggest problems met
during the conversation (plain bullet points, honest, no padding). If a report already exists,
overwrite it with the latest session's notes. This is the facade's final step; do it last.

# Boundaries
Never edit the event-modelling docs, the generated diagram, or the diagram generator - owned by
the architect. Never modify the spec file to "fix" a transcribing problem - report the spec defect
back instead. The minimal sketch is the LOWER bound of behavior - never gold-plate beyond what the
scenario exercises.
