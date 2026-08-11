---
name: event-modelling
description: Generate or update an Event Modeling diagram (Dymitruk style) as a single self-contained, clickable HTML document from three markdown inputs (commands.md, events.md, readmodels.md). Use when the user asks to draw, create, regenerate, or update an event modelling / event model / event storming diagram, or references commands.md/events.md/readmodels.md and wants an editable, interactive diagram.
---

# Event Modeling Diagram (HTML, interactive)

Produce a **single self-contained HTML document** rendering an Event Modeling
diagram from three markdown files (a swimlane `<table>` with an absolutely
positioned `<svg>` arrow overlay, no external assets).

**This is a generator, not a hand-drawing task.** All layout math (column
placement, read-model insertion, row/column geometry, arrow coordinates) is
implemented once in `scripts/generate.js`, a dependency-free Node script.
**Do not hand-compute coordinates or re-derive the algorithm in prose** —
run the script and let it emit the HTML deterministically. Only fall back to
editing HTML by hand if the user asks for a one-off tweak that isn't worth
teaching to the generator.

## Workflow

1. Locate the three input files. Paths are given by the user per use; if not,
   look in the current/target directory for `commands.md`, `events.md`,
   `readmodels.md`. Ready-to-edit templates live in `templates/` if the user
   is starting from scratch.
2. Run the generator:

   ```bash
   node <skill-dir>/scripts/generate.js <inputDir> <outputFile>
   ```

   `<inputDir>` defaults to `.`, `<outputFile>` defaults to
   `<inputDir>/eventmodel.html`. The script reads the three markdown files
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
Actor: Customer
Produces: order-created

## reserve-inventory
Name: Reserve Inventory
Actor: System
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

### Parsing rules (implemented in `scripts/generate.js`)

- An `## heading` starts a new element; the heading is its id.
- `Name:` overrides the display name (fallback: the heading text).
- `Subprocess:` groups events into process/subdomain swimlanes. Missing → the
  event shares the band of the first event with no subprocess.
- `Produces:` (one id) links a command to the event it triggers.
- `Actor:` links a person/actor/role to a command. The special actor `System`
  marks an **automated command**.
- `Observes:` (one event id, only on `System` commands) marks that the
  automated command is triggered by watching that event.
- `Subscribes:` (comma-separated ids) links a read model to its source events.
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

## Patterns (canonical, per eventmodeling.org cheat sheet)

Every diagram is built from slices of the four canonical patterns:

- **Command Pattern** `Trigger → Command → Event(s)` — a human via UI.
- **View Pattern** `Event(s) → View` — read models drawn from events.
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
  share a cell with a command (see Layout — read-model placement).

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

Rows top→bottom: time badges → one swimlane per non-System actor → System
swimlane (only if any `Actor: System` command exists) → a single free-space
**mid-row** holding every command *and* every read-model card → one swimlane
per `Subprocess`.

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
UI 210x76, Command 200x56, Event 220x60, Read model 220x60, Time badge 26x26
```

`width = GUT + T*COL` where `T` = events + inserted read-model columns.
`height = TIME_H + R*ROLE_H + (hasSystem ? SYS_H : 0) + MID_H + P*PROC_H`.
The System row is fully omitted (not just hidden) when no `Actor: System`
command exists — don't reserve its band.

Card corners are rounded (`border-radius: 8px`); any arrow endpoint that
would otherwise land on a corner (e.g. an event's top-right/top-left corner)
is inset by that radius along the straight edge it touches, so the line
meets a flat edge, not the rounded notch.

### Edges

- **UI → command**, **command → event**: vertical arrows, bottom edge to
  top edge, black, `marker-end`.
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
- Every element id from the three markdown files appears as a
  `data-element` in the output HTML; every `data-from`/`data-to` resolves to
  one of them (`grep -o 'data-element="[^"]*"'` / `data-from=...` on the
  output file).
- **Card title text matches source**: each card's `.title` text equals that
  element's `Name:` (or heading id if absent) — this is generated directly
  from the parsed markdown, so a mismatch means a parsing bug, not a
  transcription error.
- No event is an orphan (the generator already throws on this — if it ran
  without error, this is satisfied).
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