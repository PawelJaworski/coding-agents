---
name: backend-development
description: >
  # Responsibility
  Facade for all backend code work in a sliced, event-sourced project. Scaffolding is
  NOT written by an agent — it is generated deterministically from the event model by
  `scripts/codegen` (this skill owns the generator). The only code an agent writes is
  business logic, and only when a GWT scenario demands it (delegated to backend-implement).
  # When to use
  Use when backend code must be created or changed: a command/event/read model was added
  or updated in the event model, a GWT scenario must be implemented, or a business rule in
  `<docs>/business-rules-raw.md` was added or changed (rules are an implicit source of GWT
  scenarios and must end up covered by a unit test).
  # **Important** This skill is parametrized
  * parameters: <docs>, <eventModel> are passed from outside. You have to know them
    before starting this skill execution. Don't ever execute this skill without exactly
    knowing those params.
---

# Drive the loop

```
node .opencode/skills/backend-development/scripts/codegen --next --json
```

One small prompt per call. Execute it, call again, until `state: "DONE"`.
The prompt is complete on its own — hand it to a subagent with a fresh context.
**Do not read ahead in this file to "understand the flow". The prompt is the flow.**

The plugin system (`scripts/codegen/plugins/`) defines all constructs:
DomainPlugin, EventPlugin, CommandPlugin, GWTPlugin. Steps are data, not code.
Adding a new construct = adding a new plugin file.

`codegen --test` prints the step machine.

# What is NOT in the prompts

Only these, because a script cannot derive them.

## Brackets
A `[bracketed]` model field has no upstream source. The generator delegates it to a
decider that throws until a GWT scenario forces it into existence. Brackets mark what
must be DECIDED; they say nothing about what must be ENFORCED. The decider is a
command's ONE seam: `check(cmd)` for preconditions and business rules, plus one throwing
method per bracketed field. A rule never needs a bracket, a model edit, or a new class.

## The model is frozen
Every model document — `commands.md`, `events.md`, `readmodels.md`, `uis.md`,
`business-rules-raw.md`, `business-definitions-raw.md`, every `gwt-*.md`, the diagram —
is READ-ONLY. Do not edit one, do not create one, do not ask the architect to either.
If you catch yourself writing a scenario down: **a test IS the scenario written down**,
and it belongs in `src/test/groovy`.

When the model cannot express something — a rule with no command, a GWT needing a field
that does not exist, a `MODEL ERROR` — skip that fragment and record it in
`development-report.md`. A blocked fragment is a normal outcome of a run. An unreported
one is not.

## Ad-hoc extensions
A search criterion, a repository query, an endpoint filter or sort over fields a read
model ALREADY has is an implementation improvement, not a model change: no doc edit, no
regeneration, still TDD. A new *field* or a new *event* is not ad-hoc — escalate it.
Full recipe and traps: `reference/ad-hoc-extensions.md`.

## Hand edits to a generated file
Rewriting a method body is allowed and needs no marker — bodies are yours, the contract
is the generator's. A *structural* deviation (a new type, a renamed field) needs
`// PRESERVED-BY-HAND: <reason>`, which is also the only way to close an `UPDATE`.
Which is which: `reference/edit-classification.md`.
