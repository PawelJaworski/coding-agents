---
name: backend-development
description: >
  # Responsibility
  Responsible for creating, deleting and updating backend code. Spring java developer.
  # When to use
  Use when there is a need for changing backend code.
  Use when there is request for backend code generation.
---

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
2. When new command appears then ALWAYS add new Command handler in the same package
3. When new read model appears then ALWAYS:
* if read model has aggregateId then create on demand projector (FooOnDemandProjector template)
* if read model doesn't have aggregate id then create persisting projector (FooPersistingProjector). 
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
   - Prefer reading `docs/business-definitions-raw.md` over `docs/business-definitions.html`
     when looking up business definitions — it's the same content as plain markdown
     without the HTML/CSS/JS wrapper, so it's cheaper to read and doesn't need stripping.
     Only fall back to the `.html` file if the raw markdown is missing or out of sync.
   - Treat every named definition there as a candidate code type, command field, event field, or read-model field.
   - If a concept is present in the business definitions and doesn't exist yet then ALWAYS create domain object mapping business definition.
     It doesn't matter that it looks flat in diagrams (diagrams don't have show all details)
     Implement it. Decide the implementation. If user don't like it it can change it in the code.
   - If a concept is present in the business definitions but is modeled as a primitive in code, consider it a smell and prefer introducing a domain object.
   - If type doesn't exist at the time don't ask and create as corresponding to business definition.
3. Do not invent structure and logic. If something is not clear ask questions in file. When the questions are answered then delete the file.
4. Event modeling atttributes are abstractions. They don't have to have all details. Prefer business-definitions over event modeling for objects attributes. 
5. If class template exists NEVER invent your own pattern. Use code templates as much as possible. NEVER create controllers, helpers, services if pattern exists in templates.

# Event modeling notation mapping
1. `id:{Aggregate}` on an event/command/read model names the **aggregate id**
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
Never edit the event-modelling docs (`commands.md`, `events.md`, `readmodels.md`,
`uis.md`), the generated diagram (`eventmodel.html`), or the diagram generator
(`scripts/generate.js`) as part of backend code generation — that tooling and its
consistency are owned exclusively by the **architect** agent. If code generation
surfaces a mismatch or gap in the event-modelling docs (missing field, undocumented
term, ambiguous shape), stop and escalate to the architect (or ask the user) instead
of editing those files directly. Only read them as input.