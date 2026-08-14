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
1. When new event appears then StateProjector should be updated.
2. When new command appears then add new Command handler in the same package
3. When new read model appears then:
* if read model has aggregateId then create on demand projector (FooOnDemandProjector template)
* if read model doesn't have aggregate id then create persisting projector (FooPersistingProjector). 
  In the same time create all dependencies if missing: FooEntity (FooReadModelEntity template), FooRepositories.

3. When new repository is added then create:
* interface FooRepository in same package where entity is located
* FooInMemoryRepository
* FooJpaRepository
4. When any spring component, service or repository is added then create adequate test Ability (FooAbility template)