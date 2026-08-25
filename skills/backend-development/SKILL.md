---
name: backend-development
description: >
  # Responsibility
  Responsible for creating, deleting and updating backend code. Spring java developer.
  # When to use
  Use when there is a need for changing backend code.
  Use when there is request for backend code generation.
  # **Important** This skill is parametrized
  * parameters: <docs>, <eventModel> are passed from outside. You have to know them before staring this skill execution. Don't ever execute this skill without exactly knowing those params.
---

# How to proceed this instructions

## Efficient execution flow
To minimize token usage and execution time, follow this pattern:

1. **Explore with glob, not manual traversal**: Use `glob` patterns like `src/main/java/**/*.java` or `src/main/java/pl/pjaworski/insurance_company/*/` instead of reading directories one level at a time.
2. **Read docs once, upfront**: Read `<docs>/commands.md`, `<docs>/events.md`, `<docs>/readmodels.md`, and `<docs>/business-definitions-raw.md` in a single parallel batch. These are the source of truth.
3. **Check existing code minimally**: Only read files that directly relate to what you're changing. Don't explore empty directories or read every existing class.
4. **Batch file writes**: Write all new files in 2-3 parallel batches instead of one at a time. Group related files together (e.g., all domain types in one batch, all commands in another).
5. **Delegate complex implementations**: For implementations involving 5+ new files, consider using the `Task` tool with a `general` agent to handle the entire implementation autonomously. Provide the agent with:
   - The event modeling docs content (commands.md, events.md, readmodels.md)
   - The business definitions content
   - The target package structure
   - The code templates to follow
6. **Verify once at the end**: Run `mvn compile` and `mvn test` only after all files are written, not after each file.
7. **Minimize todo updates**: Update the todo list at major milestones (exploration done, implementation done, verification done), not after every file.

## Template usage
* Do not read all code templates at start. Read them on demand when you need to create a specific type of class. Filename shows its context.
* When creating a class, read the corresponding template first, then write the file.

# Code templates
templates/DoSomethingOnFooCmd.java
templates/DoSomethingOnFooHandler.java
templates/FooEvent.java
templates/StateProjector.java

templates/FooRepository.java
templates/FooInMemoryRepository.java
templates/FooJpaRepository.java

templates/FooOnDemandProjector.java
templates/FooPersistingProjector.java
templates/FooReadModelEntity.java

templates/FooAbility.java

# Code update hooks
1. When new event appears then ALWAYS StateProjector should be updated.
2. When new command appears then:
* it's located in the package named the same as command (lowercase)
* ALWAYS add new Command handler in the same package as the command
3. When new read model appears then ALWAYS:
* if read model has aggregateId then create on demand projector (FooOnDemandProjector template). 
  We can fetch all related events by aggregate id so persisting projector is not needed - don't create it.
* if read model doesn't have aggregate id then create persisting projector (FooPersistingProjector). 
  We can have events for multiple aggregates and cannot fetch all related events at once so in this case persisting projector instead of on demand projector is the best choice.
  In the same time create all dependencies if missing: FooEntity (FooReadModelEntity template), FooRepositories.
3. When new repository is added then create:
* interface FooRepository in same package where entity is located
* FooInMemoryRepository
* FooJpaRepository
4. When any spring component, service or repository is added then ALWAYS create adequate test Ability (FooAbility template). Class and Ability is one to one relation - only one Ability per class.
   * NEVER instantiate a dependency's Spring component/service inline inside another class's Ability, even if that would be simple/inline-able.
     Reference the dependency's own Ability constant instead, e.g. `new Foo(BarAbility.INSTANCE)`, so every Spring component/service has exactly one Ability that owns its construction.
     If the dependency's Ability does not exist yet, create it first (it is itself a Spring component and falls under this same rule).
   * Exception: plain repositories do not need a wrapping Ability of their own - just use `new FooInMemoryRepository()` directly where the repository is required, since the InMemory repository already is the test double.

# Sources of true
1. Mirror business concepts in code as closely as possible.
   - Prefer dedicated domain types/value objects over raw primitives when a business definition exists.
   - Use the exact business term in class and field names where practical.
   - Only fall back to `String`, `UUID`, `Long`, etc. when the business model truly has no named concept yet.
2. Objects should correspond to business-definitions.html as far as possible.
   - Prefer reading `<docs>/business-definitions-raw.md` over `<docs>/business-definitions.html`
     when looking up business definitions — it's the same content as plain markdown
     without the HTML/CSS/JS wrapper, so it's cheaper to read and doesn't need stripping.
     Only fall back to the `.html` file if the raw markdown is missing or out of sync.
   - Treat every named definition there as a candidate code type, command field, event field, or read-model field.
   - If a concept is present in the business definitions and doesn't exist yet then ALWAYS create domain object mapping business definition.
     It doesn't matter that it looks flat in diagrams (diagrams don't have show all details)
     Implement it. Decide the implementation. If user don't like it it can change it in the code.
   - If a concept is present in the business definitions but is modeled as a primitive in code, consider it a smell and prefer introducing a domain object.
   - If type doesn't exist at the time don't ask and create as corresponding to business definition.
3. Do not invent structure and logic. 
   Prefer business-definitions for objects attributes. 
   If something is not clear ask questions in file. When the questions are answered then delete the file.
4. Event modeling attributes are abstractions. They don't have to have all details. Prefer business-definitions over event modeling for objects attributes. 
5. If class template exists NEVER invent your own pattern. Use code templates as much as possible. NEVER create controllers, helpers, services if pattern exists in templates.
6. Do not invent attributes or concepts. Add only attributes existing in documentation (business definitions/rules, event modeling etc.). 
7. For code patterns prefer code templates and use them literally as much as possible.

# Event modeling notation mapping
1. `{aggregateName}:Id` on an event/command/read model names the **aggregate id**
   concept only. It does NOT point at any specific bulleted field — it is a
   separate declaration, not a reference to one of the `*` attributes.
2. Every bulleted field (`* field name`), including ones wrapped in
   `[brackets]`, is a plain payload/data attribute of that element — nothing
   about being bulleted or bracketed makes a field "the id".
   `[brackets]` mean *system-generated or calculated, no direct upstream
   passthrough* (per the `event-modelling` skill's consistency check) — that
   is the ONLY thing brackets signal. Do not read `[policy number]` as "this
   is the aggregate id"; it just means the command doesn't supply this field
   verbatim (it's computed/assigned downstream).
3. Therefore: never implement an event's/command's/read-model's `aggregateId()`
   by delegating to or aliasing one of its named attributes (e.g. don't
   override `aggregateId()` to return `policyNumber()`). Model the aggregate
   id as its own field/value, even if, for a given domain, its generated value
   happens to equal a business attribute's value at construction time — keep
   them as two independent record components so the code doesn't silently
   assume they're always the same concept.

# Boundaries
Never edit the event-modelling docs (`<eventModel>/commands.md`, `<eventModel>/events.md`, `<eventModel>/readmodels.md`,
`<eventModel>/uis.md`), the generated diagram (`<eventModel>/eventmodel.html`), or the diagram generator
(`scripts/generate.js`) as part of backend code generation — that tooling and its
consistency are owned exclusively by the **architect** agent. If code generation
surfaces a mismatch or gap in the event-modelling docs (missing field, undocumented
term, ambiguous shape), stop and escalate to the architect (or ask the user) instead
of editing those files directly. Only read them as input.