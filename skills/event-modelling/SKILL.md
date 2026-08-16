---
name: event-modelling
description: >
  # Description
  Generate or update an Event Modeling diagram (Dymitruk style) as a single self-contained, clickable HTML document from four markdown inputs (commands.md, events.md, readmodels.md, uis.md). Use when the user asks to draw, create, regenerate, or update an event modelling / event model / event storming diagram, or references commands.md/events.md/readmodels.md/uis.md and wants an editable, interactive diagram.
  
  # Flow
  Event modeling diagram is updated with other docs before implementation. Implementation is done based on it.

  # When to use
  Use it when there is a need for update Event Modeling diagram.

  # When NOT to use
  Code generation is not the case for this skill.
---

# Event Modeling Diagram (HTML, interactive)

Produce a **single self-contained HTML document** rendering an Event Modeling
diagram from four markdown files (a swimlane `<table>` with an absolutely
positioned `<svg>` arrow overlay, no external assets).

**This is a generator, not a hand-drawing task.** All layout math (column
placement, read-model insertion, row/column geometry, arrow coordinates) is
implemented once in `scripts/generate.js`, a dependency-free Node script.
**Do not hand-compute coordinates or re-derive the algorithm in prose** —
run the script and let it emit the HTML deterministically. Only fall back to
editing HTML by hand if the user asks for a one-off tweak that isn't worth
teaching to the generator.

## Workflow

1. Locate the four input files. Paths are given by the user per use; if not,
   look in the current/target directory for `commands.md`, `events.md`,
   `readmodels.md`, `uis.md`. `uis.md` is the only source of `Actor:` — a
   command never carries `Actor:` itself (see Parsing rules). Ready-to-edit
   templates live in `templates/` if the user is starting from scratch.
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

### Parsing rules (implemented in `scripts/generate.js`)

- An `## heading` starts a new element; the heading is its id.
- `Name:` overrides the display name (fallback: the heading text).
- `Subprocess:` groups events into process/subdomain swimlanes. Missing → the
  event shares the band of the first event with no subprocess.
- `Produces:` (one id) links a command to the event it triggers.
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
- `Triggers:` (`uis.md` only, one command id) — lets an input UI's heading
  use its own descriptive id instead of matching the command id exactly.
  See `uis.md` linkage below.
- `Subscribes:` (comma-separated ids) links a read model to its source events.
- `Type:` (`uis.md` only) is a display hint (`html`, `pdf`, ...) shown as a
  small uppercase label on the UI card; it does not affect linkage.
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
  `create-order` command even though the heading id differs. Only one UI may
  declare `Triggers:` for a given command — the script throws if two UIs
  target the same command (whether via `Triggers:` or same-id matching).
  Without `Triggers:`, same-id matching is still the default and keeps
  working unchanged.
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
- **Translation Pattern** — same shape as Automation, used to tell *another
  system* something happened.

## Simplifications (important, enforced by the generator)

- **No separate todo-view / robot-trigger cards.** An automated command is
  just a command card with a `⚙ SYSTEM` badge plus ONE dashed purple arrow
  from its observed event straight to the command.
- **No absolute-positioned nodes.** Everything is a table cell or a centered
  card in a cell; the SVG overlay is the only absolutely-positioned layer.
- **No dashed actor → command lines.** The swimlane row already communicates
  ownership.
- **One card stack per event column** (UI above command). Read models never
  share a cell with a command (see Layout — read-model placement). A read
  model *can* share its column with an output UI card, but that card lives
  in a different row (the actor's swimlane), never the mid-row.

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

Rows top→bottom: time badges → one swimlane per human actor (from `uis.md`
`Actor:` on command- or read-model-linked entries) → System swimlane (only
if any command has `Observes:`) → a single free-space **mid-row** holding
every command *and* every read-model card → one swimlane per `Subprocess`.

Columns left→right: one per event in `events.md` order, plus one **inserted**
column per read model that couldn't get its natural column (see below).

### Read-model placement algorithm

Run once per read model, in `readmodels.md` order, against the **current**
(possibly already-grown) column list:

1. Natural column = immediately right of the read model's **last
   (rightmost) subscribed event's column** — never left of any event it
   subscribes to.
2. If that column doesn't exist yet or its mid-row cell is free, place the
   read model there (appending a column if needed).
3. If that column's mid-row cell is already occupied, **insert a new column
   right there**, pushing the old occupant (and everything after it) one
   slot right, then place the read model in the freed-up slot. Never append
   past the occupant — that would strand the read model past an unrelated
   later slice.

This keeps every command→event→view slice visually grouped, and guarantees
no two read models ever share a column.

### Geometry constants (`scripts/generate.js`)

```
GUT = 180, COL = 360           // gutter + per-column width
TIME_H=40, ROLE_H=130, SYS_H=130, MID_H=120, PROC_H=150
UI 210x76, Command 200x56, Event 220x74 (+14 for the bold `id:{Aggregate}` line), Read model 220x60, Time badge 26x26
```

`width = GUT + T*COL` where `T` = events + inserted read-model columns.
`height = TIME_H + R*ROLE_H + (hasSystem ? SYS_H : 0) + MID_H + P*PROC_H`.
The System row is fully omitted (not just hidden) when no command has
`Observes:` — don't reserve its band.

Card corners are rounded (`border-radius: 8px`); any arrow endpoint that
would otherwise land on a corner (e.g. an event's top-right/top-left corner)
is inset by that radius along the straight edge it touches, so the line
meets a flat edge, not the rounded notch.

### Edges

- **UI → command**, **command → event**: vertical arrows, bottom edge to
  top edge, black, `marker-end`.
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
- **Event → read model**: purple, no arrowhead. Leaves the event's inset
  top corner nearest the read model's column, rises to a card-free band
  above the event row and below the mid-row, runs across, then enters the
  read model's bottom/left/right edge. Multiple sources into the same edge
  are spread out so endpoints never coincide.

### Interactivity

`reference/interactivity.js` is copied byte-identical into the page's
`<script>` by the generator — **never hand-edit or rephrase it**. It's a
click-to-focus filter: clicking a card dims (opacity, `.dim` class — never
`display:none`) every card/arrow not transitively connected to it via
`data-from`/`data-to` edges; clicking the focused card again, or the
background, clears focus. The layout never reflows on click.

## Colors (reference palette)

CSS custom properties in `:root`:

| Element          | Variable      | Value       |
| ---------------- | ------------- | ----------- |
| Commands         | `--command`   | `#12cdd4`   |
| Events           | `--event`     | `#fac710`   |
| Read models      | `--view`      | `#8fd14f`   |
| Ink / titles     | `--ink`       | `#0a0a0a`   |
| Command caption  | —             | `#eafffb`   |
| Event caption    | —             | `#8a6408`   |
| View caption     | —             | `#35681f`   |
| UI hint text     | —             | `#888888`   |
| Arrows           | `--arrow`     | `#333333`   |
| Event→read/auto  | `--read-line` | `#5E35B1`   |
| Swimlane tint    | per row       | cycles through a pastel palette per role/subprocess; mid-row `#f7f8f9` |

Fonts: `'OpenSans','Noto Sans',Arial,sans-serif`. Card titles 13, captions 10.

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

# Diagram consistency
Dataflow should be consistent. Attributes of read model should be derivated from related events.
The same for events. They should be derived from commands. If some attributes are missing in the backward flow (read models -> events -> commands) please add them.
If attribute is not mapped directly (eg. calculated from two sources) then sorround this element with '[...]', eg. [balance calculation]

For events the id attribute is mandatory:
id:{Type}, eg. 'id:Shipmnent'. It means that it belongs to 'shipment' aggregate.
**This is enforced as a hard blocker**: the generator throws (like the
orphan-event check) if any event is missing `id:`.

`id:{Aggregate}` is **optional on commands and read models**, but if present
it's rendered the same way as on events: a bold `id:{Aggregate}` line
(`.agg-id` CSS class) directly under the card's title, above its field list.
Any card (command, event, or read model) that declares `id:` grows 14px
taller (`AGG_ID_H` in `scripts/generate.js`) to make room for this line
without shrinking the title or field list; cards without an `id:` stay at
their normal base height.

## Ubiquitous language check (non-blocking)
The generator also cross-checks every command's effective actor (from its
`uis.md` entry) against the term names in `docs/business-definitions.html`
(matched via that page's `data-name="..."` attributes, walking up from the
input directory to find `docs/`). An actor not found there prints a
**warning**, not a hard failure — introducing a new actor may be intentional
(and simply undocumented), so this requires human confirmation rather than
blocking generation outright. If `docs/business-definitions.html` can't be
found, the check is skipped silently.


**This is enforced by the generator, not just a manual convention.** During
`buildModel()` (`scripts/generate.js`), for every event with a producing
command, each non-bracketed event field must have a case-insensitive exact
match (after trimming, and after stripping any `[...]` wrapper) among the
producing command's fields; for every read model, each non-bracketed field
must match a field on at least one subscribed event. A field wrapped in
`[...]` (e.g. `[policy number]`) is exempt from this check — it's the
documented way to mark a calculated or system-generated field with no direct
upstream passthrough — and still renders normally (brackets included) in the
HTML output. On a mismatch the script throws and exits non-zero, in the same
style as the existing "no orphan events" check, e.g.:

```
Consistency error: event 'policy-accepted' field "policy number" has no
matching field in producing command 'accept-policy'. If this field is
system-generated or calculated (not a direct passthrough), wrap it in [...],
e.g. "[policy number]". Otherwise add the field to the command's payload.
```

Read models get the equivalent message, substituting "read model" /
"any subscribed event".