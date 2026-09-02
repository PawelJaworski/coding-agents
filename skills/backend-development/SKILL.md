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

**The one exception, and it is narrow:** when reality needs a type, structure or logic the
model's abstraction cannot express (an enum on a value object, a custom type), the edit is
legitimate but must be *classified*, not done silently. Such a hand edit is allowed on a
generated file only when you stamp it `// PRESERVED-BY-HAND: <reason>` so `--check`
acknowledges it as intent rather than stale state. See `reference/edit-classification.md`.

# Flow

0. **Or just loop on `--next`.** Steps 1-8 below are the manual walkthrough; if you'd
   rather not interpret free-text output at each stage, drive the whole thing as a loop:
   ```
   node .opencode/skills/backend-development/scripts/codegen --next --json
   ```
   Returns `{ state, next: { kind, detail, prompt }, queue }`. Act on `next.prompt`
   (it already tells you the exact command to run or what to delegate to
   `backend-implement`), then call `--next` again. States: `MODEL_ERROR`,
   `OUT_OF_DATE`, `STALE_SCAFFOLD`, `STALE_GENERATED`, `NEEDS_MANUAL_MERGE` (codegen-level,
   fix and re-run), `PENDING` (a business rule or GWT scenario has no matching spec
   yet — `queue` lists everything still outstanding), `DONE` (nothing left; still run
   `mvn verify` once and write the report). `PENDING` is computed by cross-referencing
   `business-rules-raw.md` and every `gwt-*.md` scenario against existing Spock spec
   names, so name every spec after its rule/scenario **verbatim** (step 6) — a
   near-verbatim name is invisible to `--next` and will be reported as still pending.

1. **Generate.** From anywhere in the project:
   ```
   node .opencode/skills/backend-development/scripts/codegen
   ```
   Reads `<docs>/{commands,events,readmodels}.md` + `business-definitions-raw.md`.
   Reports what it created / updated / preserved. That is the complete inventory of
   scaffolding — do not add to it.

2. **Read the output, not the codebase.** The generator tells you every file it touched.
   You do NOT need to explore `src/` to learn what exists, what a package is called, or
   whether a class is already there — all of it is derived from the model by
   `scripts/codegen/naming.js`. Do not build or consult a code index.

3. **Stop if the model is wrong.** The generator fails loudly with a `MODEL ERROR`
   (unknown event, field an event needs but no command supplies, unknown convention).
   That is a defect in the event model. **Do not fix it and do not ask the architect to
   fix it** — the model is frozen during development. Skip the affected fragment, keep
   going with everything else, and record it for the report (step 9). Never work around
   it in code.

4. **Publish the API contract.** Once the generated sources compile, export the
   OpenAPI contract the frontend consumes:
   ```
   mvn verify
   ```
   This boots the app on a dedicated port, scrapes `/v3/api-docs` and writes
   `api/openapi.json`. Run it after EVERY codegen run that added or changed a command
   or read model — the contract is derived from the running controllers, so it is stale
   the moment the model changes.

   The generator does not do this itself, and must not: `scripts/codegen` is a pure
   model -> source transform, shared by every project, and knows nothing about Maven or
   Spring. Compiling and booting an app is the build tool's job.

   **Never commit `api/openapi.json`.** Regenerate it, report that it changed, and leave
   it in the working tree. Committing is a human decision.

5. **Cover the business rules.** `<docs>/business-rules-raw.md` constrains commands that
   already exist, so it needs no model change and no `gwt-*.md` — each rule becomes a
   spec plus a guard in that command's decider. See "Business rules" below.

6. **Implement GWT scenarios** — delegate to `backend-implement`, once per
   `<docs>/gwt-*.md` scenario. An ad-hoc improvement with no GWT file (a search
   criterion, a repository query) also goes to `backend-implement`. Nothing else in this
   pipeline writes logic.

7. **Verify.** `mvn clean verify` must be green, and `node .opencode/skills/backend-development/scripts/codegen --check` must report
   `up to date`.

8. **Review** — delegate to `backend-code-reviewer`.

9. **Report.** Write `development-report.md` (see "The development report" below).

# The model is frozen during development — never escalate, report instead
Every document that describes the model — `<eventModel>/commands.md`, `events.md`,
`readmodels.md`, `uis.md`, `<docs>/business-rules-raw.md`, `business-definitions-raw.md`,
**every `gwt-*.md`**, the diagram — is READ-ONLY during development. Do not edit one, do
not create one, and do not ask the architect to either; there is no escalation path from
here. If you catch yourself writing a scenario down, stop: **a test IS the scenario
written down**, and it belongs in `src/test/groovy`, not in the model.

So when you hit something the model cannot express — a rule with no command, a GWT needing
a field or event that does not exist, a `MODEL ERROR`, an ambiguous business intent:

1. **Do not generate or implement that fragment.** Leave the code exactly as it is; do not
   invent a command, a field, a bracket or a workaround to make it fit.
2. **Note it** and move on to the next fragment. One blocked fragment never blocks the
   rest of the run.
3. **Report it at the end.** Everything skipped must appear in `development-report.md`.

A blocked fragment is a normal, successful outcome of a run — an unreported one is not.

# The development report
At the end of every run, write `development-report.md` at the repo root with exactly
these three sections:

```markdown
# Development report

## 1. Problems met
<every problem hit during the run: MODEL ERRORs, rules with no matching command,
ambiguous intent, failing verification. One bullet each: what it was, where
(file / rule / scenario), and what it blocked. "None." if there were none.>

## 2. Left as is
<everything deliberately NOT touched, and why: fragments skipped because the model
would have had to change, generated members that look wrong but are add-only and
cannot be retracted, pre-existing failures unrelated to this run.>

## 3. Additional — not implemented
<each scenario / rule / command that was not implemented, with the reason. This is
the handover list for the next modelling phase.>
```

Keep it factual and specific — name the rule, the scenario, the file. Do not propose
model changes in it; describe the gap and let the modelling phase decide.

**Never commit `development-report.md`.** Write it, say it changed, leave it in the
working tree.

# Business rules
`<docs>/business-rules-raw.md` lists, per aggregate, rules the system must enforce. The
generator never reads them, and they need NO model change and NO `gwt-*.md`: a rule
constrains a **command**, not a field, so it does not depend on the `[bracket]`
convention. Every command already has the seam a rule lands in — `<Command>Decider.check(cmd)`,
scaffolded empty and called by the generated handler before the event is appended.

For every rule in the file:
1. **Find its command** in `<eventModel>/commands.md` — the rule's aggregate names the
   slice, the rule text names the behavior. If no command matches, skip it and record it
   in the report; never invent one.
2. **Delegate to `backend-implement`**, one invocation per rule, quoting the rule
   verbatim. It writes the spec first (named after the rule), watches it fail, then adds
   the guard to `check`. Nothing is written to any `.md`.

A rule that needs a field or an event the model does not have is a model change: skip it
and report it.

# File ownership — memorize this
| header in the file | who owns it |
|---|---|
| `// GENERATED by ... DO NOT EDIT` | the generator. **Add-only**: a regen inserts members the model grew and keeps everything already there — including hand edits — verbatim. Never *rewrite* a generated member; to change what is emitted, change the model. **Exception:** stamping `// PRESERVED-BY-HAND: <reason>` in the leading comment declares a deliberate deviation; `--check` tolerates it. |
| `// SCAFFOLDED ONCE ... this file is YOURS` | the project. Written when absent, never touched again. |

A generated file whose member body no longer matches the model, without a
`PRESERVED-BY-HAND` marker, is reported as `STALE GENERATED` and fails `--check`.
Classify each edit before touching a generated file — see
`reference/edit-classification.md` (model change → regenerate; intentional local
change → mark preserved; stale body → delete-and-regenerate).

`*Decider` classes are the ONLY place business logic for a `[bracketed]` field lives. They
are scaffolded once, with one `UnsupportedOperationException` stub per bracketed field.

## Sanity-check the generated domain types — add-only cannot self-heal
Add-only is the right default for *your* edits, but it means a **wrong member the
generator itself emitted is permanent**: fix the generator, re-run, and the file still
reports `preserved` with the bad member intact. Regeneration will never remove it.

So after the FIRST generation of a slice, read the emitted value objects in
`domain/` and confirm each one against `business-definitions-raw.md`:

- fields come only from the bullets describing the concept — a bullet under
  `# examples` is a sample VALUE (`* John Snow`, `* POL-1`), never a field;
- a concept with no structural bullets is a scalar `String`, and no record is emitted
  for it at all;
- a `... list` bullet is a `List<String>`.

A record like `PolicyHolder(name, surname, johnSnow)` or `PolicyNumber(pol1, pol2)` is
the signature of this bug. If you find one:
1. fix `scripts/codegen/parse.js` and add a regression test to `codegen.test.js`;
2. **delete the poisoned generated file(s)** — regenerating on top of them is a no-op;
3. re-run the generator so they are recreated from scratch.

Deleting a `// GENERATED` file is safe and is the only supported way to retract a
member. Never delete a `once`-owned file that way — it may hold your logic.

## Ad-hoc extensions — not every request is a model change
"Add a search criterion", "add a repository query", "filter/sort this endpoint" are
implementation improvements over fields a read model ALREADY has. Nothing in the event
model changes, so do NOT edit `<eventModel>/*.md`, the diagram, or `scripts/codegen/*`.
They are still TDD, and the code lands as **added** members on the slice's generated
projector/repository, which the add-only merge preserves.

A new *field* or a new *event* is NOT ad-hoc — skip it and record it in the report.

Full recipe and the traps (signature changes breaking generated abilities, stateful
deciders leaking across specs): `reference/ad-hoc-extensions.md`.

## STALE SCAFFOLD — a `once` file that predates its template
`once` files are never rewritten, so when a runtime template gains a new contract, a
project scaffolded earlier keeps the old code and the build breaks in a GENERATED caller,
far from the cause. Every `once` file therefore carries `// scaffold-version: N`, and the
generator compares it to the template:

```
STALE SCAFFOLD  1 once-owned file(s) predate the current template:
  src/.../DomainEventEntity.java  (on disk: v0, template: v2)
```

This FAILS `--check`. Re-running the generator does nothing — the file is yours. Diff it
against its template in `scripts/codegen/runtime.js`, port the delta by hand, then record
the reconciliation:

```
node .opencode/skills/backend-development/scripts/codegen --accept-scaffold
```

`--accept-scaffold` only rewrites the version marker; it never touches the body, so
hand-written logic is safe. Bump a template's version in `runtime.js` whenever you change
a contract that generated code depends on.

# Why brackets matter
Everything derivable is derived. A field that flows command -> event -> read model is wired
automatically by name. A `[bracketed]` field has no upstream source, so it must be *decided* —
the generator delegates it to a decider that throws until a GWT scenario forces it into
existence. **Brackets in the model mark exactly, and only, what a human or a GWT scenario
must decide.** `[field]:now` and `[field]:uuid` are conventional and implemented for you.

Brackets say what must be DECIDED; they say nothing about what must be ENFORCED. So the
decider is the command's ONE seam and exists for EVERY command, bracketed or not:
`check(cmd)` — empty, for preconditions/business rules — plus one throwing method per
`[bracketed]` field. That is why a rule never needs a bracket, a model edit, or a new
generated class.

# Setup in a new project
The generator is domain-agnostic. A project needs two things at its root:
1. `codegen.config.json`:
   ```json
   { "basePackage": "com.example.myapp", "modelDir": "../docs" }
   ```
2. an executable `node .opencode/skills/backend-development/scripts/codegen` wrapper (a one-line `exec node <skill>/scripts/codegen "$@"`).
   Do NOT add a `package.json` to a Maven project just to alias the generator.
The first run also scaffolds the domain-independent event-sourcing runtime
(`DomainEvent`, `EventStream`, `DomainEventEntity`, repositories, ...) as once-owned files.

# Boundaries
Never edit ANY model document — `<eventModel>/commands.md`, `events.md`, `readmodels.md`,
`uis.md`, `<docs>/gwt-*.md`, `business-rules-raw.md`, `business-definitions-raw.md`, the
generated diagram or the diagram generator. They are frozen and owned elsewhere; skip and
report instead. Never rewrite an existing member of a `// GENERATED` file, and never edit
a generated `*Ability` — both fail `--check` or break a generated caller. The **only**
legitimate rewrite of an existing generated member is a classified kind-2 edit stamped
`// PRESERVED-BY-HAND: <reason>` (see `reference/edit-classification.md`). Never write
scaffolding by hand. *Adding* a member for an ad-hoc extension is allowed; see
`reference/ad-hoc-extensions.md`. Appending a scenario to `<docs>/gwt-*.md` derived from
an existing business rule IS allowed — but never edit `<docs>/business-rules-raw.md`
itself; it is the source of truth, owned by the business.
