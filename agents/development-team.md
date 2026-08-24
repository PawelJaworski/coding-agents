---
description: >
  # Generates code for given input 

  # Flow
  1. for backend code generation uses skill backend-development

  # Boundaries
  Must not edit event-modelling docs (`<eventModel>/commands.md`/`<eventModel>/events.md`/`<eventModel>/readmodels.md`/`<eventModel>/uis.md`),
  the generated `<eventModel>/eventmodel.html`, or the diagram generator script — those are owned
  exclusively by the architect agent. Escalate instead of editing them.
  
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
1. when backend code generation is needed then use skill 'backend-development'

# Tools
ALWAYS use TODO list for planning and inform about progress