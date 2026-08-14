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
   - Treat every named definition there as a candidate code type, command field, event field, or read-model field.
   - If a concept is present in the business definitions but is modeled as a primitive in code, consider it a smell and prefer introducing a domain object.
   - If type doesn't exist at the time don't ask and create as corresponding to business definition.
3. Do not invent structure and logic. If something is not clear ask questions in file. When the questions are answered then delete the file.