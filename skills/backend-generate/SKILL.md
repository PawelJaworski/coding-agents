---
name: backend-generate
description: >
  # Responsibility
  The EXECUTOR stage of backend code generation. It reads a single precise diff-spec
  (target/backend-spec.json written by backend-plan), and for every entry transcribes the
  file from the corresponding code template. It follows the spec LITERALLY and never
  invents patterns, never re-reads the event modeling docs, never reads GWT files, and
  never consults business definitions.
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
6. Never add attributes/beans/logic not present in the spec entry or template.
7. Write every file to the package path derived from its `package` field: `src/main/java/<pkg>
   (dots->/)/<ClassName>.java`, except abilities/tests which go under `src/test/java/`.
8. Batch writes in 2-3 parallel groups (commands+handlers, events+type+projector, tests/abilities).

# Per-kind transcription map
For each spec target, apply the matching row. The `template` field names the file in `templates/`.

### kind: "command"  (template: DoSomethingOnFooCmd.java)
-> `<pkg>/<className>.java`, class = public record <className>(<<components>>) {}
   record components = the entry's `recordComponents` as `Type name` joined by ", ".
### kind: "command-handler"  (template: DoSomethingOnFooHandler.java)
-> `<pkg>/<className>.java`. Substitutions:
   - class name <className>, implements CommandHandler<<commandClassName>>
   - @PostMapping("<postMapping>")
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
### kind: "read-model"  (template: none - a plain record)
   - create record <className>(<<fields>>) in `<pkg>`. Use `fields` `Type name` list.
### kind: "projector"  (template: FooOnDemandProjector.java | FooPersistingProjector.java chosen by planner)
   - FooOnDemandProjector: class <className> implements StateProjector<<readModelClassName>>,
     readModelClassName set, getter method + @GetMapping("foo/{aggregateId}").
   - FooPersistingProjector: class <className> implements StateProjector<<readModelClassName>>,
     depends on <entityClassName>/<repositoryClassName> from the spec; implement apply() stubs from the
     spec's `applyDetails` if present.
### kind: "entity"  (template: FooReadModelEntity.java)
   - JPA entity record with the fields the spec gives (securing the persisting read model's columns).
### kind: "repository"  (template: FooRepository / FooInMemoryRepository / FooJpaRepository)
   - create interface + in-memory + jpa impl exactly per template, class names from the spec entry.
### kind: "ability"  (template: FooAbility.java)
   - create `src/test/java/<pkg>/<className>.java` test DSL interface wiring command/projector abilities,
     following the template comments and the spec entry's `dsl` hints (which getters/DSLs are needed).
### kind: "test"  (template: ReadModelUnitTest.groovy)
   - create `src/test/java/<...>/<className>.groovy`. The entry supplies a fully-resolved `body`
     (a Spock `def "..."() {}` method). Write the class shell (implements the abilities the spec names)
     and paste the `body` VERBATIM as the method. Do NOT re-read any gwt-*.md.

# Mandatory checks before finishing
- [ ] Every top-level spec target produced exactly one file at the package-derived path
- [ ] No file written outside `src/main/java` or `src/test/java` except the spec itself
- [ ] Only substitutions from the spec entry + `{base}` were applied to templates
- [ ] `mvn compile` (and `mvn test` if any test entries exist) pass; if not, fix ONLY
      transcribing mistakes (imports/placeholders), never add logic.

# Verification
Run `mvn compile` once all main files are written; run `mvn test` if there are test entries.
Treat `mvn` results as authoritative (ignore Lombok LSP noise).

# Boundaries
Never edit the event-modelling docs, the generated diagram, or the diagram generator - owned by
the architect. Never modify the spec file to "fix" a transcribing problem - report the spec defect
back instead. Never write business logic beyond what a template/template-slot requires.
