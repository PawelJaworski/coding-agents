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
node .opencode/skills/backend-development/scripts/main-flow --next --json
```

One small prompt per call. Execute it, call again, until `state: "DONE"`.
The prompt is complete on its own — hand it to a subagent with a fresh context.
**Do not read ahead in this file to "understand the flow". The prompt is the flow.**

Three scripts, three jobs:

| script | job | who runs it |
|---|---|---|
| `codegen --patch` | compute the model -> code diff (`.codegen/patch/*.json`) | a script. **Never an agent** |
| `get-prompt.js <STEP> --item N` | render ONE entry as a prompt | the driver, or you, out of band |
| `main-flow --next` | pick the next step and entry | the loop |

Everything mechanical is already decided by the time you see a prompt: the diff, the
verb (`CREATE` / `ADD` / `UPDATE`), the file path, the spec path. In a sliced
architecture the name of a command, event or read model determines the name of its
handler, projector, repository and ability — so a path never needs explaining, and this
file does not explain it. `main-flow --test` prints the step machine.

# What is NOT in the prompts

Only three things, because a script cannot derive them.

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

# File ownership
| header | who owns what |
|---|---|
| `// GENERATED ... DO NOT EDIT` | contract (signature, public methods, package) is the generator's; method bodies and private members are yours. `// PRESERVED-BY-HAND: <reason>` declares a deliberate deviation. See `reference/edit-classification.md`. |
| `// SCAFFOLDED ONCE ... this file is YOURS` | yours. Written when absent, never touched again. |
