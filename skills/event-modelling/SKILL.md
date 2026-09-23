---
name: event-modelling
description: >
  # Description
  Generate or update an Event Modeling diagram (Dymitruk style) as a single self-contained, clickable HTML document from six markdown inputs (commands.md, events.md, readmodels.md, uis.md, external-events.md, translators.md). Use when the user asks to draw, create, regenerate, or update an event modelling / event model / event storming diagram, or references commands.md/events.md/readmodels.md/uis.md and wants an editable, interactive diagram.
  
  # Flow
  Event modeling diagram is updated with other docs before implementation. Implementation is done based on it.

  # When to use
  Use it when there is a need for update Event Modeling diagram.

  # When NOT to use
  Code generation is not the case for this skill.

  # **Important** This skill is parametrized
  * parameters: <docs> are passed from outside. You have to know them before staring this skill execution. Don't ever execute this skill without exactly knowing those params.

---

# Event Modeling Diagram (HTML, interactive)

Produce a **single self-contained HTML document** rendering an Event Modeling
diagram from markdown files (a swimlane `<table>` with an absolutely
positioned `<svg>` arrow overlay, no external assets).

**This is a generator, not a hand-drawing task.** All layout math (column
placement, read-model insertion, row/column geometry, arrow coordinates) is
implemented once in `scripts/generate.js`, a dependency-free Node script.
**Do not hand-compute coordinates or re-derive the algorithm in prose** —
run the script and let it emit the HTML deterministically. Only fall back to
editing HTML by hand if the user asks for a one-off tweak that isn't worth
teaching to the generator.

## Workflow

1. Locate the input files. Paths are given by the user per use; if not,
   look in the current/target directory for `commands.md`, `events.md`,
   `readmodels.md`, `uis.md`, `external-events.md`, `translators.md`.
   `uis.md` is the only source of `Actor:` — a command never carries
   `Actor:` itself (see Parsing rules). `external-events.md` and
   `translators.md` are optional (Translation Pattern); the other four are
   required. Ready-to-edit
   templates live in `templates/` if the user is starting from scratch —
   they demonstrate every option documented in this file.
2. Run the generator:

   ```bash
   node <skill-dir>/scripts/generate.js <inputDir> <outputFile>
   ```

   `<inputDir>` defaults to `.`, `<outputFile>` defaults to
   `<inputDir>/eventmodel.html`. The script reads the markdown files
   from `<inputDir>`.
3. Read back the script's stdout summary (columns produced, T/R/P counts,
   viewBox dimensions) and sanity-check it against the input files (see
   Verification).
4. If the diagram looks wrong, **fix `scripts/generate.js`** (or the markdown
   inputs) and re-run — don't patch the generated HTML directly, since any
   manual edit is lost on the next run.

## Inputs

### Markdown format

`commands.md` — the things that trigger state changes (actors AND automation):

```markdown
# Commands

## create-order
Name: Create Order
Produces: order-created

## reserve-inventory
Name: Reserve Inventory
Observes: order-created
Produces: inventory-reserved
```

`events.md` — facts that happened, in **file order = chronological order**
(time flows left to right):

```markdown
# Events

## order-created
Name: Order Created
Subprocess: Order

## order-cancelled
Name: Order Cancelled
Subprocess: Order
```

`readmodels.md` — projections derived from events:

```markdown
# Read Models

## order-list
Name: Order List
Subscribes: order-created, order-cancelled
```

`uis.md` — user interface:

```markdown
# UIs

## create-order
Type: html
Name: Create Order
Actor: Customer

## order-document
Type: pdf
Name: Order Document
Actor: System

## order-dashboard
Type: html
Name: Order Dashboard
Actor: Ops Manager
ConsistsOf: order-summary, stock-levels
```

`external-events.md` (optional — **Translation Pattern**): facts that happen
in systems **we don't own**. Unlike `events.md`, this is an external contract
not modelled by the team, so **`{aggregateName}:Id` is NOT mandatory**, a
`System name:` replaces `Subprocess:` to group external events into
external-system swimlanes, and attributes are optional:

```markdown
# External Events

## application-received
Name: Application Received
System name: Underwriter Portal
* application id
* policy holder
* coverage request

## policy-issued-externally
Name: Policy Issued Externally
System name: Underwriter Portal
```

`translators.md` (optional — **Translation Pattern**): the "bots" that bridge
the external world into the system. Each translator `Subscribes:` one or more
external event ids (from `external-events.md`) and `Produces:` one or more
internal command ids (from `commands.md`). An optional free-form `Type:`
labels the kind of translator it is — the value can be **anything** (no
enum); `rest` and `kafka` additionally select a backend ingress adapter, any
other value is a display hint only:

```markdown
# Translators

## translate-application
Name: Translate Application
Type: rest
Subscribes: application-received
Produces: submit-policy-application
```

### Parsing rules (implemented in `scripts/generate.js`)

- An `## heading` starts a new element; the heading is its id.
- `Name:` overrides the display name (fallback: the heading text).
- `Subprocess:` groups events into process/subdomain swimlanes. Missing → the
  event shares the band of the first event with no subprocess.
- `System name:` (external-events.md only) groups external events into
  external-system swimlanes, rendered at the very bottom of the diagram.
  Missing → the external event shares the band of the first external event
  with no system name (default `External`). External events are the only
  elements that carry this key.
- `Subscribes:` (comma-separated ids) links a read model to its source
  events (readmodels.md) **or** a translator to its source external events
  (translators.md). Internal read models/events/UIs may never reference an
  external event id — only translators bridge the external world, so the
  script throws if any internal element does.
- `Produces:` on a **translator** (translators.md) is a comma-separated list
  of **command** ids it triggers (unlike on a command, where it lists event
  ids). Every id must be a real command in commands.md.
- **No orphan external events**: the script throws if an external event has
  no translator subscribing it (same tier as the orphan-event check).
- **Translators must have both** at least one `Subscribes:` external event
  and at least one `Produces:` command — a translator with neither side wired
  would be an empty card.
- **External event ids are globally unique**: an external event id must not
  collide with an internal event id (both render in the shared column
  timeline).
- `Produces:` (one or more comma-separated event ids, e.g.
  `Produces: policy-issued, premium-calculated`) links a command to the
  event(s) it triggers. A command producing several events is drawn as a
  **single** command card, placed at its leftmost produced event's column
  (events.md order = chronological); each later produced event keeps its own
  column and is reached by a routed produces-edge from that same card (see
  Edges). The script throws if any `Produces:` id doesn't match an event in
  events.md (same tier as the orphan-event check).
- `Actor:` (`uis.md` only) links a person/actor/role to a UI — and, through
  it, to whichever command or read model that UI is linked to (see `uis.md`
  linkage below). Commands **never** carry `Actor:` themselves — the script
  throws if `commands.md` has one (see "No inline command Actor" below).
- `Observes:` (one event id) marks a command as **automated**: the sole
  signal that a command is a `System` command is having `Observes:` — there
  is no explicit `Actor: System` anymore. A command is either automated
  (`Observes:`) or human-triggered (a matching `uis.md` entry, by id or
  `Triggers:`); a command with neither just renders with no UI card and no
  swimlane.
- `Triggers:` (`uis.md` only, one or more comma-separated command ids) — lets
  an input UI's heading use its own descriptive id instead of matching the
  command id exactly, and/or fan out a single UI entry into multiple visual
  UI boxes, one per listed command. See `uis.md` linkage below.
- `Subscribes:` (comma-separated ids) links a read model to its source events.
- `Type:` (`uis.md` and `translators.md`) is a **free-form** display hint — the
  value can be **anything** (no enum; `html`, `pdf`, `api`, `rest`, `kafka`,
  `underwriter-sync-bot`, ... are just examples) — shown as a small uppercase
  label on the card; it does not affect linkage. On `uis.md` it labels the UI
  card (and, for frontend codegen, `Type: html` is what selects a page — a
  separate concern of that skill). On `translators.md` it labels the translator
  card and, for **backend** codegen, `rest` and `kafka` additionally select an
  ingress adapter (`@RestController` POST endpoint / `@KafkaListener`); any
  other value still generates a plain `@Component` translator. This diagram
  itself only ever displays the value.
- `ConsistsOf:` (`uis.md` only, comma-separated read model ids) — for a UI
  that's projected from **more than one** read model (e.g. a dashboard
  combining several views). See `uis.md` linkage below.
- Accept `- key: value` bullets as an alternative to `key: value`.
- A bare bullet with **no colon** (`* field name` / `- field name`) is a
  **field/parameter** of that element (command payload, event payload, or
  read-model column) and is rendered as a small list under the card's title,
  e.g. under `## policy-confirmation-document`:

  ```markdown
  ## policy-confirmation-document
  Name: Policy Confirmation Document
  Subscribes: policy-accepted
  * policy number
  * coverage
  * coverage period
  ```

  Works the same way on commands and events, not just read models.
- A field ending in ` (List)` is a list of generated nested objects. Repeating
  the bullet marker nests its attributes: `* product (List)`, `* * name`, and
  `* * description` generate `Product` and a `List<Product> productList`
  payload member. A nested field without `(List)` generates one object member.
  The notation is valid on commands, events, and read models. A
  direct command→event or event→read-model mapping is valid if the
  field name, list marker, child order, and every nested child match exactly.
  **Pure flattening is also a recognised passthrough** — a scalar field whose
  name equals a structured field's name followed by a child path within it is a
  per-element dereference with no renaming/aggregation involved, e.g. event
  `* product (List)` → `* * code, name, description` and read model
  `* product code`, `* product name`, `* product description` passes (the
  generator does not guess *how* to flatten, but a straight child-path flatten
  needs no guess). The path may descend through plain (non-list) objects
  (`* product details size`), but a target that is itself a `(List)`/nested
  object is NOT a pure flattening. If the same root field has a different
  structure, or a related-name field is not a recognized pure flattening,
  **diagram generation** fails with `Unsupported structured-field mapping ...`
  — the diagram generator does not guess renaming, aggregation, filtering or
  reordering, so that stays a modelling decision to resolve here before it's
  considered final. (Backend **codegen** is more lenient for the
  event→read-model case specifically: rather than aborting the whole run, it
  delegates the unmappable field to the read model's `*ProjectionDecider`,
  which throws `UnsupportedOperationException` explaining the mismatch —
  everything else still generates. That keeps implementation unblocked while
  the model itself still needs this fixed or clarified.)
- A trailing `?` on a **read-model** field name marks it as a search criterion
  answerable by a direct DB query, and is a normal passthrough field — it must
  still trace back to an upstream event field (e.g. `* policy holder?`). A
  trailing `??` marks a search-ONLY criterion: a query parameter with **no
  stored value at all** — never a field on the entity, never persisted, never
  part of the response, and NOT derived from any upstream event field (e.g.
  `* policy coverage risk??`) — see "Diagram consistency" below for the
  diagram-consistency exemption this implies. Matching a `??` criterion is a
  hand-written Java predicate applied by the persisting projector to the query
  result AFTER it comes back from the repository — never a DB column or a
  generated `Specification`/`JpaSpecificationExecutor` predicate (see
  `backend-development/scripts/codegen/emit.js`'s `projectionDecider` /
  `persistingProjector` for the generated stub). Both `?` and `??` are stripped
  for display in the diagram — the card shows `policy holder`, not
  `policy holder?` or `policy coverage risk??`.
- Ignore anything else (descriptions, prose, `#` title lines).
- **No orphan events**: the script throws if an event has no `Produces:` link.
- **No inline command Actor**: the script throws if any command in
  `commands.md` has an `Actor:` line — move it to a matching `## <id>` entry
  in `uis.md` instead (see `uis.md` linkage below).

### `uis.md` linkage (id-based, plus `Triggers:`/`ConsistsOf:` overrides)

`uis.md` has no `Produces:`/`Observes:`-style linking field of its own —
**each `## heading` id must equal the id of an existing command or read
model** (its own id is the default link), optionally extended by
`Triggers:` (input UIs) or `ConsistsOf:` (output UIs projected from several
views):

- A UI whose id matches a **command** id is that command's human **trigger**
  (input UI): rendered as a card above the command, in the swimlane row of
  its `Actor:`. Its card title is the UI's `Name:` (falls back to the
  command's own name).
- `Triggers: <command-id>` lets an input UI use its **own** descriptive id
  instead of having to match the command id exactly — e.g. `##
  order-intake-form` with `Triggers: create-order` triggers the
  `create-order` command even though the heading id differs.
- **Multiple UIs may legitimately trigger the same command — fan-in.** This
  is not an error: it represents two (or more) different scenarios/entry
  points that both end up issuing the same command. It can happen via any
  combination of an id-match candidacy (a UI whose own id equals the command
  id) and/or explicit `Triggers:` claims from other UIs. For every command,
  the generator collects **all** UIs with a real claim on it — the markdown
  stays however many `## heading` entries the user wrote — and the generated
  diagram renders **one visual UI box per triggering UI**, side by side in
  that command's role/column cell, each with its own trigger arrow
  converging into the same command card. Example: `## policy-proposal`
  with `Triggers: create-policy-proposal, issue-policy` and a separate `##
  issue-policy` entry (matching `issue-policy` by id) both legitimately
  trigger the `issue-policy` command — the diagram shows two boxes
  (`policy-proposal` and `issue-policy`) feeding into it. The only
  constraint: all UIs fanning into the same command must share the same
  `Actor:` (a command's role-row placement is a single swimlane) — the
  script throws if they don't.
- `Triggers:` accepts a **comma-separated list of command ids**
  (`Triggers: create-policy-proposal, issue-policy`) to link one `uis.md`
  entry to several commands at once. The markdown stays a single `##
  heading`, but the generated diagram renders it as **one visual UI box per
  listed command**, each positioned above its own command column and wired
  with its own trigger arrow — all boxes share the same `Name:`/`Type:`/
  `Actor:`. This is the mirror image of the fan-in case above: one UI fans
  **out** to several different commands, while fan-in is several UIs feeding
  **into** the same command — both are legitimate and can be combined freely.
  Each visual box is a separate interaction node, so clicking one fan-out
  copy focuses only the command connection represented by that copy rather
  than merging all commands triggered by the logical UI.

- A UI whose id matches a **read model** id, and/or lists read model ids in
  `ConsistsOf:`, is that view's (or views') rendered **output** (e.g. a pdf
  document, or a dashboard combining several projections): rendered as a
  card in the swimlane row of its `Actor:` — the person who reads/receives
  it — with one solid arrow per source read model into that card (the
  reverse direction of the UI→command arrow). A UI's own id and its
  `ConsistsOf:` list are merged and de-duplicated into one source set — e.g.
  `## order-dashboard` with `ConsistsOf: order-summary, stock-levels` draws
  two incoming arrows, from `order-summary` and `stock-levels`, even though
  `order-dashboard` itself isn't a read model id.
- The output UI card is placed in the column of its **rightmost** source
  read model (same "never left of an event/view it depends on" convention
  as read-model placement itself). A source in that same column gets a
  straight vertical arrow; any other source is routed sideways into a
  card-free band just below the role row, then up into the card.
- Every id in `ConsistsOf:` must be a real read model id — the script throws
  if not (same tier as the orphan-event check).
- A UI id matching neither a command nor a read model, and with no (or an
  invalid) `ConsistsOf:`, is a **hard error** — fix the id, add the missing
  command/read model, or add `ConsistsOf:`.
- A command or read model with no matching `uis.md` entry has no UI card and
  no swimlane row — an automated (`Observes:`) command needs no `uis.md`
  entry at all; a read model with no UI entry just has no output card.
- **Standalone UIs are supported and always rendered.** A `uis.md` entry can
  legitimately end up with no `Triggers:` wiring and no read-model/`ConsistsOf:`
  wiring — genuinely a UI card documented for context, not yet wired into any
  slice: its id matches neither a command (no id-match candidacy) nor a read
  model, and it declares no `Triggers:` at all. This is the **only** way a UI
  lands in the standalone bucket. A UI whose id-match or `Triggers:` claim on
  a command coexists fine with another UI's claim on that same command (see
  fan-in above) — neither is ever silently demoted to standalone. Genuinely
  standalone entries are never silently dropped either: the generator
  collects them into a dedicated **"Unwired UIs" row**, placed right under
  the time row and spanning the full width of the diagram, with one
  dashed-border UI card per entry (labelled with its `Type:`/`Name:`/`Actor:`
  like any other UI card, but with no arrows in or out since it isn't wired
  to anything). This is a placeholder, not a final answer — flag it for a
  human to either wire it up properly (`Triggers:`/`ConsistsOf:`) or confirm
  it's intentionally standalone.
- `Actor:` in `uis.md` is what actually builds the swimlane list (`roles`) —
  it is collected from **both** command-linked and read-model-linked (single
  or composite) UI entries, in the order first encountered, so a read model
  can introduce a brand-new swimlane (e.g. "Ops Manager") that no command
  uses.

## Patterns (canonical, per eventmodeling.org cheat sheet)

Every diagram is built from slices of the four canonical patterns:

- **Command Pattern** `Trigger → Command → Event(s)` — a human via UI.
- **View Pattern** `Event(s) → View` — read models drawn from events. When the
  view is rendered back to a person (e.g. a pdf document), a `uis.md` entry
  extends this to `Event(s) → View → UI`, landing in that person's swimlane.
- **Automation Pattern** `Event(s) → View → Automated Trigger → Command → Event(s)` —
  a **robot/system** replaces the human trigger. A robot holds no business
  logic; it only watches a view and calls one use case per row.
- **Translation Pattern** `External Event → Translator → Command → Event(s)` —
  an external system (bottom swimlane) emits an event; a **translator** bot
  (top `Bots` swimlane) subscribes to it and issues an internal command. This
  is a first-class pattern in this generator, driven by the optional
  `external-events.md` + `translators.md` files — see below.

## Simplifications (important, enforced by the generator)

- **No separate todo-view / robot-trigger cards.** An automated command is
  just a command card with a `⚙ SYSTEM` badge plus ONE dashed purple arrow
  from its observed event straight to the command.
- **Translators are real cards, not badges** (unlike automation). Because the
  external event comes from outside the model, the translation step is a
  first-class card: each translator renders in the `Bots` swimlane with a
  `⚙` sprocket badge, one card per produced command.
- **No absolute-positioned nodes.** Everything is a table cell or a centered
  card in a cell; the SVG overlay is the only absolutely-positioned layer.
- **No dashed actor → command lines.** The swimlane row already communicates
  ownership.
- **One card stack per event column** (UI above command). Read models never
  share a cell with a command (see Layout — read-model placement). A read
  model *can* share its column with an output UI card, but that card lives
  in a different row (the actor's swimlane), never the mid-row.

## Translation Pattern (external-events.md + translators.md)

When either file is present, the generator draws the full Translation slice
`External System → External Event → Translator → Command → Event(s)`:

- **External events** live in **bottom swimlanes**, one lane per distinct
  `System name:` (external-events.md order). A card is an external contract:
  no mandatory `{aggregate}:Id` line, attributes optional. It gets **one
  column**, inserted immediately LEFT of the command column it feeds
  (dependency-based — the slice never reads right-to-left). External event
  columns are empty in the time row / mid-row / role rows / subprocess rows;
  the card renders only in its external-system lane.
- **Translators** live in a **`Bots` swimlane at the very top** (above all
  human roles). Each `translators.md` entry renders **one card per produced
  command** (fan-out, mirroring the trigger-UI convention), each sitting
  directly above its produced command's column. Several translators producing
  the same command fan in side by side. Translator cards are teal with a `⚙`
  sprocket badge; an optional free-form `Type:` (value can be anything) is
  shown as a small uppercase label on the card (the card grows to fit it);
  fields are optional.
- **Edges**: a dashed teal `External Event → Translator` arrow (kind
  `translates`) rises from the external event's top-right corner, runs
  through a card-free band just below the Bots row, then drops into the
  translator's bottom edge. A solid teal `Translator → Command` arrow (kind
  `translates-cmd`) exits the translator's bottom, runs down the column's
  right gutter to the System-row band (or just above the mid-row), then drops
  into the command's top edge — never slicing through a human trigger UI card.
- **Consistency rules enforced**: every external event must be subscribed by
  at least one translator (orphan check); every translator must subscribe ≥ 1
  external event and produce ≥ 1 command; translator `Subscribes:` ids must
  exist in external-events.md and `Produces:` ids in commands.md; external
  event ids must not collide with internal event ids; only translators may
  reference external events (internal read models/events/UIs can't).
- **No field-consistency check on external events or translators** — the
  external contract is explicitly not modelled by the team, so there is no
  backward flow to trace. The command a translator produces is an internal
  command and still gets its own fields checked against its produced events
  as usual.

## Field lists / card sizing is responsive

A card with a `fields` bullet list grows taller to fit it (base card height
+ `10 + min(N,6)*14` px), and the whole row (mid-row, or that event's
subprocess row) grows to the tallest card in it — every other card in that
row stays its normal size and is just vertically centered in the taller row.
Past 6 fields the list gets a fixed max-height and scrolls internally
(`overflow-y:auto`) instead of growing forever. All arrow endpoints (event
top edge, command top/bottom edge, read-model entry point) are computed from
each element's own actual height (`element._h` in `scripts/generate.js`), not
a shared constant, so arrows always land correctly regardless of how many
fields a card has.

## Layout (what the generator does — read this if you need to extend it)

### Structure

Rows top→bottom: time badges → **Bots swimlane (only if translators exist)** →
one swimlane per human actor (from `uis.md`
`Actor:` on command- or read-model-linked entries) → System swimlane (only
if any command has `Observes:`) → a single free-space **mid-row** holding
every command *and* every read-model card → one swimlane per `Subprocess` →
**one swimlane per external `System name:` (only if external events exist)**.

Columns left→right: one per event in `events.md` order, plus one **inserted**
column per read model that couldn't get its natural column (see below), plus
one **inserted** column per external event, placed immediately left of the
command column it feeds.

### Read-model placement algorithm

Run once per read model, in `readmodels.md` order, against the **current**
(possibly already-grown) column list:

1. Natural column = immediately right of the read model's **last
   (rightmost) subscribed event's column** — never left of any event it
   subscribes to.
2. If one or more read models were already placed at that natural column
   (by an **earlier** entry in `readmodels.md` sharing the same rightmost
   subscribed event), skip past all of them — this keeps read models
   sharing a natural column in `readmodels.md` **file-declaration order,
   left to right**, rather than reversing it.
3. If the resulting column doesn't exist yet or its mid-row cell is free,
   place the read model there (appending a column if needed).
4. If that column's mid-row cell is already occupied by something else (a
   command), **insert a new column right there**, pushing the old occupant
   (and everything after it) one slot right, then place the read model in
   the freed-up slot. Never append past the occupant — that would strand
   the read model past an unrelated later slice.

This keeps every command→event→view slice visually grouped, and guarantees
no two read models ever share a column.

### Geometry constants

All layout constants (gutter/column width, row heights, card sizes,
`AGG_ID_H` per identifying line) live as named `const`s near the top of the
"2. Layout" section in `scripts/generate.js` — read them there, don't
duplicate the numbers here (they're allowed to change; this doc shouldn't
need an edit every time they do). `width`/`height` are derived from them plus
the column/row counts (`T`, `R`, `P`) printed in the generator's stdout
summary.

The System row is fully omitted (not just hidden) when no command has
`Observes:` — don't reserve its band.

Card corners are rounded (`border-radius: 8px`); any arrow endpoint that
would otherwise land on a corner (e.g. an event's top-right/top-left corner)
is inset by that radius along the straight edge it touches, so the line
meets a flat edge, not the rounded notch.

### Edges

- **UI → command**, **command → event**: vertical arrows, bottom edge to
  top edge, black, `marker-end`. When one command produces several events
  (`Produces: a, b`), only the first (leftmost) produced event gets this
  straight vertical command → event arrow; each later produced event is
  reached by a routed edge that leaves the same command card's bottom edge,
  runs sideways through the card-free band below the mid-row, then enters
  the event's top edge — the same routing pattern used for read-model
  subscription arrows. Trigger UI cards and trigger arrows always anchor at
  the command's primary column, never duplicated per produced event.
- **Read model(s) → output UI**: black, `marker-end`. The source read model
  in the UI's own placement column gets a straight vertical arrow, same
  shape as UI → command but reversed (its top edge up into the UI card's
  bottom edge). Any other source (via `ConsistsOf:`) exits that read model's
  inset top corner nearest the UI's column, runs sideways through a
  card-free band just below the role row, then up into the same card edge.
  Only drawn for read models with a matching `uis.md` entry (by id or
  `ConsistsOf:`).
- **Automation**: purple dashed arrow from the observed event's inset
  top-right corner, up the column's right edge to the System row, across,
  then down into the automated command's top edge. Never routed up the
  source column's own center (would overlap its UI→Command→Event stack).
- **Translation**: teal arrows. **External event → translator** (dashed,
  kind `translates`): rises from the external event's inset top-right corner
  to a card-free band just below the Bots row, runs across, then up into the
  translator card's bottom edge. **Translator → command** (solid, kind
  `translates-cmd`): exits the translator card's bottom edge, runs sideways
  into the column's right gutter (card-free), down to the System-row band
  (or just above the mid-row), across, then drops into the command's top
  edge. The gutter routing keeps the arrow clear of any human trigger UI card
  at the command's column.
- **Event → read model**: purple, no arrowhead. Leaves the event's inset
  top corner nearest the read model's column, rises to a card-free band
  above the event row and below the mid-row, runs across, then enters the
  read model's bottom/left/right edge. Multiple sources into the same edge
  are spread out so endpoints never coincide.

### Interactivity

`reference/interactivity.js` is copied byte-identical into the page's
`<script>` by the generator — **never hand-edit or rephrase it; edit the
source file and the doc comments there instead.** It's normally an upstream
click-to-focus filter (walks `data-from`/`data-to` edges backwards from the
clicked card, dimming everything that isn't an ancestor). A clicked trigger
UI copy is the exception: because it starts a slice and has no upstream
ancestors, the traversal follows that copy's outgoing trigger and the
resulting command/event/view chain forward. A UI reached as an ancestor is
still terminal (its `displays` edge into a read model is not walked further),
while a clicked output UI follows its own `displays` edge backwards. The full
rationale is in the comments at the top of that file — read them there if you
need to change the behavior, don't re-derive it here.
Each arrow's `data-kind` (`triggers`/`produces`/`observes`/`observes-cmd`/
`displays`/`translates`/`translates-cmd`) is what lets the traversal
distinguish edge semantics.
When one logical UI is rendered more than once, each visual trigger copy and
its output/view copy use distinct `data-element` graph ids; the original
markdown UI id remains available as `data-ui-id`.

The diagram background also supports pointer drag-to-pan: press on empty
space and drag to scroll the viewport horizontally or vertically. Cards and
interactive controls keep their normal click behavior. A short background
click still clears the focus filter, while a completed drag suppresses that
click so panning does not unexpectedly reset the current focus.

## Colors

CSS custom properties (`--command`, `--event`, `--view`, `--ink`, `--arrow`,
`--read-line`, `--ext-event`, `--translator`) are defined once in the
`:root` block emitted by
`scripts/generate.js` — read them there rather than duplicating hex values
here. Swimlanes cycle through a pastel palette per role/subprocess; external
system lanes cycle through their own pastel palette; the
mid-row is `#f7f8f9`. External events render as **light steel-blue cards with
a dashed border** (signalling "not ours"); translator cards are **teal with a
`⚙` sprocket badge**; translation arrows are teal (`#00796B`). Fonts:
`'OpenSans','Noto Sans',Arial,sans-serif`; card titles 13px, captions 10px.

## Verification

After running the generator:

- Re-read `scripts/generate.js`'s stdout: column order should read
  chronologically, with `[view:...]` entries landing right after the event
  they subscribe to (never before it, never past a later slice).
- Every element id from the markdown files appears as a
  `data-element` in the output HTML; every `data-from`/`data-to` resolves to
  one of them (`grep -o 'data-element="[^"]*"'` / `data-from=...` on the
  output file).
- **Card title text matches source**: each card's `.title` text equals that
  element's `Name:` (or heading id if absent) — this is generated directly
  from the parsed markdown, so a mismatch means a parsing bug, not a
  transcription error.
- No event is an orphan (the generator already throws on this — if it ran
  without error, this is satisfied).
- No `uis.md` entry with an id that doesn't match a command or read model
  (unless it has a valid `ConsistsOf:`), and no `ConsistsOf:` referencing an
  unknown read model id (the generator throws on both — if it ran without
  error, this is satisfied).
- No external-event / translator violation (orphan external event, unknown
  `Subscribes:`/`Produces:` id, id collision, internal element subscribing an
  external event — the generator throws on all — if it ran without error,
  this is satisfied).
- No field-consistency violation (the generator already throws on this too —
  see "Diagram consistency" below; if it ran without error, this is
  satisfied). If it does throw, the fix is either to add the missing field to
  the upstream element (command for an event, event for a read model), or to
  wrap the field in `[...]` if it's genuinely calculated/system-generated.
- If a headless browser is available, render the file and confirm cards are
  visually centered in their cells and arrows land on card edges — this is
  the standard regression to watch for if the CSS/geometry constants in
  `scripts/generate.js` are ever changed.

If the user specified an output path, write there; otherwise the default is
`eventmodel.html` beside the input files. Report the written path and a
short summary of the elements drawn.

## Testing the generator itself

`scripts/generate.js` has unit tests (Node's built-in test runner, no extra
dependencies) covering markdown parsing, orphan-event detection, missing
`{aggregateName}:Id`, unknown ids in `uis.md`, field-consistency checks, and
edge-`kind` tagging. Run them with:

```
node --test .opencode/skills/event-modelling/scripts/generate.test.js
```

Run this after modifying `generate.js` or `reference/interactivity.js`.

# Diagram consistency
Dataflow should be consistent. Attributes of read model should be derivated from related events.
The same for events. They should be derived from commands. If some attributes are missing in the backward flow (read models -> events -> commands) please add them.
If attribute is not mapped directly (eg. calculated from two sources) then sorround this element with '[...]', eg. [balance calculation]

## Field annotations: `?` vs `??`
Two distinct, non-overlapping annotations exist for **read-model fields**:
- A trailing `?` (e.g. `policy holder?`) marks a field answerable by a **direct DB
  query** (a simple column/parameter match). It is a normal passthrough field: it
  is **not** exempt from the passthrough-match check below — it must still trace
  back to a real upstream event field.
- A trailing `??` (e.g. `policy coverage risk??`) marks a **search-only** query
  parameter with **no stored value at all** — it is never a projected/persisted
  field (no entity column, no record component, no place in the response), and
  has no upstream event field either. It **is exempt** from the passthrough-match
  check below, the same way `[...]` is — there is nothing to trace, by design.
  Unlike `?` (a plain DB predicate) or `[...]` (a computed VALUE), matching a `??`
  criterion is business logic applied by the persisting projector to the query
  result after it comes back from the repository — see the backend generator's
  `projectionDecider`/`persistingProjector`, which scaffold an
  `UnsupportedOperationException` stub (`matches<Field>(value, entity)`) for a
  human to implement, exactly like a `[bracketed]` field's decider stub.

Both are stripped for display (the diagram card shows `policy holder`, not
`policy holder?`/`policy coverage risk??`) — purely search-capability markers,
not the calculated/system-generated meaning of `[...]` (which, unlike `??`,
still renders literally with its brackets).


For events the aggregate-id attribute is mandatory:
{aggregateName}:Id, eg. 'shipment:Id'. It means that it belongs to 'shipment' aggregate.
**This is enforced as a hard blocker**: the generator throws (like the
orphan-event check) if any event is missing `:Id`.
**External events (external-events.md) are exempt** — they're an external
contract not modelled by the team, so `:Id` is optional there; if present it
renders the same way (a bold `{aggregateName}:Id` line).

`{aggregateName}:Id` is **optional on commands and read models**, but if present
it's rendered the same way as on events: a bold `{aggregateName}:Id` line
(`.agg-id` CSS class) directly under the card's title, above its field list.
Any card (command, event, or read model) that declares an `:Id` line grows 14px
taller (`AGG_ID_H` in `scripts/generate.js`) to make room for this line
without shrinking the title or field list; cards without one stay at
their normal base height.

## Read-model `{keyName}:Key` attribute

Read models may additionally declare one or more repeatable `{keyName}:Key` lines
(bullet `- customerId:Key` or plain `customerId:Key` form, same parsing convention as
every other `key: value` line), e.g.:

```markdown
## order-list
Name: Order List
Subscribes: order-created, order-cancelled
customerId:Key
region:Key
```

`:Key` is meaningful **only on read models** — if it's declared on a command
or an event it's silently ignored (parsed but unused), the same tier as any
other attribute that isn't meaningful for that file's shape.

Rendering: `:Key` lines share the same slot as `{aggregateName}:Id` — stacked
bold lines directly under the card's title, above the field list, reusing
the `.agg-id` CSS class (one `<div class="agg-id">` per line, not
comma-joined). If a read model has an `:Id` line, it renders first, then each
`:Key` line below it in the order written in the markdown.

**Hard blocker**: a read model must declare **at least one** of `:Id` or
`:Key` — one with neither is a hard error (the generator throws, same tier
as the orphan-event / missing-event-id checks). A read model with `:Id`
only, `:Key` only (one or more), or both is fine.

Geometry: `AGG_ID_H` (14px) is now added **once per identifying line**
(the `:Id` line, if present, plus each `:Key` line) rather than a flat
one-time bump — a read model with `:Id` + 2 `:Key` lines grows 3 × 14px
taller than its base height.

### Special vs. normal attributes

`policy:Id` / `customerId:Key` (no bullet) are the **special** identifier
lines described above — bold, under the title, never in the field list. A
*normal* bullet field with a related name (`* policy id`, `* customer id`) is
just a regular field, rendered in the field list like any other — the
generator's field-consistency check (`isTransformationOfSpecialAttribute`)
recognizes this camelCase→spaced+" id"/" key" naming as a legitimate
passthrough of the special attribute rather than an orphan field. Don't
conflate the two forms; only the colon form gets the bold card treatment.

## Read-model GWT (Given-When-Then) files

Read models can have associated GWT (Given-When-Then) files that document
business scenarios and acceptance criteria. The generator automatically
discovers GWT files by convention: for a read model with id `policy-status`,
look for `gwt-policy-status.md` in the same directory as `readmodels.md`.

### GWT file format

GWT files use a detailed format with multiple scenarios. Two formats are supported:

**Format 1: Bold headers (Given/When/Then inline)**
```markdown
# GWT: Policy Status

## Scenario 1: Active Policy
**Given** a policy exists with status "active"
**When** the policy holder requests a status update
**Then** the system returns "active" status

## Scenario 2: Cancelled Policy
**Given** a policy exists with status "cancelled"
**When** the policy holder requests a status update
**Then** the system returns "cancelled" status
```

**Format 2: Colon headers (given:/when:/then: with bullet points or plain text)**
```markdown
# Given When Then

## when issue policy then policy number has next ordinal
given:
- policy holder
- policy coverage

when:
- issue policy command is executed

then:
- policy number has next ordinal
```

**Note:** The `given:` and `when:` sections are optional. If not present, they will be empty arrays and not rendered in the modal. The `then:` section is required.

### Rendering

When a GWT file exists for a read model:
1. A blue "GWT" badge appears at the bottom of the read model card
2. Clicking the badge opens a modal dialog showing all GWT scenarios
3. Each scenario displays its Given, When, and Then sections
4. The modal can be closed by clicking the X button, clicking outside, or pressing Escape

### Discovery

GWT files are automatically discovered by the generator:
- For read model id `foo`, look for `gwt-foo.md` in the input directory
- No explicit linking is required — convention over configuration
- If no GWT file exists, no badge appears on the read model card

## Ubiquitous language check (non-blocking)
The generator also cross-checks every command's effective actor (from its
`uis.md` entry) against the term names in `<docs>/business-definitions.html`
(matched via that page's `data-name="..."` attributes, walking up from the
input directory to find `<docs>/`). An actor not found there prints a
**warning**, not a hard failure — introducing a new actor may be intentional
(and simply undocumented), so this requires human confirmation rather than
blocking generation outright. If `<docs>/business-definitions.html` can't be
found, the check is skipped silently.


**This is enforced by the generator, not just a manual convention** — see
"Diagram consistency" / "Field annotations: `?` vs `??`" above for the exact
rules (`[...]` and `??` exempt from the passthrough check; `?` not exempt;
pure flattenings of a nested `(List)`/`* *` field — a scalar column named as a
direct child path of that field, e.g. `product code` from `product (List)` →
`code` — are recognized passthroughs and render without `[...]` or any extra
syntax). On
a mismatch the script throws and exits non-zero, in the same style as the
existing "no orphan events" check, e.g.:

```
Consistency error: event 'policy-accepted' field "policy number" has no
matching field in producing command 'accept-policy'. If this field is
system-generated or calculated (not a direct passthrough), wrap it in [...],
e.g. "[policy number]". Otherwise add the field to the command's payload.
```

Read models get the equivalent message, substituting "read model" /
"any subscribed event".