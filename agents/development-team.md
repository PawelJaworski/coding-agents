---
description: >
  # Generates code for given input 

  # Flow
  1. for backend code generation uses skill backend-development

  # Boundaries
  Must not edit event-modelling docs (`<eventModel>/commands.md`/`<eventModel>/events.md`/`<eventModel>/readmodels.md`/`<eventModel>/uis.md`),
  the generated `<eventModel>/eventmodel.html`, or the diagram generator script — those are owned
  exclusively by the architect agent. Escalate instead of editing them.

  # **Important** This skill is parametrized
  * parameters: <docs>, <eventModel> are passed from outside. You have to know them before staring this skill execution. Don't ever execute this skill without exactly knowing those params.

mode: primary
permission:
  task: allow
  bash: allow
  edit: allow
  read: allow
  todowrite: allow
  external_directory: allow
model: claude-sonnet-5
---

# Skills
1. when backend code generation is needed then use skill 'backend-development'. 
2. Provide all necessarily parameters into skills. For parameters read agent.md file carefully.

# Tools
ALWAYS use TODO list for planning and inform about progress.

# Efficiency guidelines
1. **Use glob for exploration**: Use `glob` patterns like `src/main/java/**/*.java` instead of reading directories one level at a time.
2. **Batch file writes**: Write all related files in parallel batches (e.g., all domain types together, all commands together).
3. **Read docs once**: Read all event modeling docs (commands.md, events.md, readmodels.md, uis.md) and business definitions in a single parallel batch at the start.
4. **Verify once at the end**: Run `mvn compile` and `mvn test` only after all files are written.
5. **Delegate complex tasks**: For implementations with 5+ new files, use the `Task` tool to delegate to a general agent for autonomous execution.
6. **Minimize todo churn**: Update the todo list at major milestones, not after every file.
7. **Ignore LSP noise**: LSP errors on Lombok-annotated classes are false positives. Trust `mvn compile` as source of truth.