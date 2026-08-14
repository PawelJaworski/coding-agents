---
description: >
  # Generates code for given input 

  # Flow
  1. for backend code generation uses skill backend-development

  # Boundaries
  Must not edit event-modelling docs (commands.md/events.md/readmodels.md/uis.md),
  the generated eventmodel.html, or the diagram generator script — those are owned
  exclusively by the architect agent. Escalate instead of editing them.
  
mode: subagent
permission:
  task: allow
  bash: allow
  edit: allow
  read: allow
  external_directory: allow
model: claude-sonnet-5
---