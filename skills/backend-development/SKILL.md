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

# The one rule
**Never hand-write scaffolding.** Commands, events, read models, value objects, handlers,
projectors, serde wrappers, the event-type enum, the state projector and the test abilities
are all derived from the model by a script. If you are tempted to write one by hand, you
are working on the wrong thing: change the MODEL and regenerate.

An agent's only job here is business logic, and it enters through TDD, never through
scaffolding.

# Flow — drive the loop, don't carry the workflow

The entire backend development flow is a **state machine** driven by `main-flow`.
Each call returns ONE small prompt. Execute it, then call again.

```
node .opencode/skills/backend-development/scripts/main-flow --next --json
```

Returns `{ state, next: { kind, detail, prompt }, queue }`. Act on `next.prompt`,
then call `--next` again. Repeat until `state: "DONE"`.

| State | What the prompt says |
|-------|---------------------|
| GENERATE | Run codegen to regenerate scaffolding |
| RECONCILE | Diff stale files against templates, port delta, accept-scaffold |
| IMPLEMENT | Delegate to backend-implement (one prompt per queue item) |
| VERIFY | mvn clean verify + codegen --check + write development-report.md |
| REVIEW | Delegate to backend-code-reviewer |
| DONE | All complete |

**Spec naming is critical.** Name every spec after its rule/scenario **verbatim** —
a near-verbatim name is invisible to `--next` and will be reported as still pending.

# The model is frozen — never escalate, report instead
Every model document — `commands.md`, `events.md`, `readmodels.md`, `uis.md`,
`business-rules-raw.md`, `business-definitions-raw.md`, every `gwt-*.md`, the diagram
— is READ-ONLY during development. Do not edit one, do not create one, do not ask the
architect to either. If you catch yourself writing a scenario down, stop: **a test IS
the scenario written down**, and it belongs in `src/test/groovy`.

When the model cannot express something — a rule with no command, a GWT needing a
field that does not exist, a `MODEL ERROR` — skip that fragment, note it, move on,
and report it in `development-report.md`. A blocked fragment is a normal, successful
outcome of a run — an unreported one is not.

# Reference

## File ownership
| header in the file | who owns it |
|---|---|
| `// GENERATED ... DO NOT EDIT` | the generator. **Add-only** — never rewrite a generated member; to change what is emitted, change the model. Exception: `// PRESERVED-BY-HAND: <reason>` declares a deliberate deviation; `--check` tolerates it. See `reference/edit-classification.md`. |
| `// SCAFFOLDED ONCE ... this file is YOURS` | the project. Written when absent, never touched again. |

## Brackets
A `[bracketed]` field has no upstream source — the generator delegates it to a decider
that throws until a GWT scenario forces it into existence. Brackets mark what must be
DECIDED; they say nothing about what must be ENFORCED. The decider is the command's ONE
seam: `check(cmd)` for preconditions/business rules, plus one throwing method per
bracketed field. A rule never needs a bracket, a model edit, or a new generated class.

## Business rules
Rules constrain **commands**, not fields — they land in `<Command>Decider.check(cmd)`,
which is scaffolded empty and called by the generated handler. The IMPLEMENT prompt
handles the TDD flow. For details, see `reference/ad-hoc-extensions.md`.

## Ad-hoc extensions
Not every request is a model change. "Add a search criterion", "add a repository
query", "filter/sort this endpoint" are improvements over fields a read model ALREADY
has. They land as added members on the slice's projector/repository. See
`reference/ad-hoc-extensions.md` for the full recipe and traps.

# Boundaries
Never edit model documents, the generated diagram, or the diagram generator — they are
owned by the architect. Never rewrite a generated member or edit a generated `*Ability`.
Never write scaffolding by hand. Never commit `api/openapi.json` or
`development-report.md`.
