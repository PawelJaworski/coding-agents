---
name: backend-development
description: >
  # Responsibility
  Responsible for creating, deleting and updating backend code. Spring java developer.
  # When to use
  Use when there is a need for changing backend code.
---

# Code templates
templates/DoSomethingOnFooCmd.java
templates/DoSomethingOnFooHandler.java
templates/SomethingHappenToFooEvent.java
templates/StateProjector.java

# Code update hooks
1. When new event appears then StateProjector should be updated.
2. When new command appears then add new Command handler in the same package