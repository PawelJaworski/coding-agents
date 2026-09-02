---
name: business-rules-and-definitions
description: >
  # Responsibility
  Updates business rules and definitions
  # When to use
  Use it when there is need to add or update a business definition or business rule, especially when `<docs>/business-definitions-raw.md` or `<docs>/business-rules-raw.md` changes and `<docs>/business-definitions.html` / `<docs>/business-rules.html` must be synced.
---

# Files
| source of truth (raw) | rendered output | styling baseline |
|---|---|---|
| `<docs>/business-definitions-raw.md` | `<docs>/business-definitions.html` | `templates/business-definitions.html` |
| `<docs>/business-rules-raw.md` | `<docs>/business-rules.html` | `templates/business-rules.html` |

# Template
The `*-raw.md` file is always the source of truth. When it changes, update the
corresponding `.html` to match its rows exactly. Each rule/definition is divided
by '------' line.

The matching file under `templates/` is the canonical styling/layout baseline —
reuse its CSS, script, and table markup as-is (only regenerate the `<tbody>`
rows from the raw source; don't redesign the look). If the `<docs>/*.html`
already exists in the repo, prefer it as the baseline instead (it may have
received manual tweaks), but keep it visually consistent with the template.
Whenever the styling is deliberately improved, update the `templates/` file too
so future runs keep using the latest look.

`templates/business-definitions-raw.md` and `templates/business-rules-raw.md`
show the expected raw input shape for each.

# Format
1. Business definitions (`<docs>/business-definitions.html`):
   * Self-contained HTML file (inline `<style>`/`<script>`, no external deps).
   * Content rendered as an html `<table>` with columns: `Name | Description`,
     one row per definition, styled for readability (dark header row,
     zebra-striped/hover rows, rounded-corner card look, borders, reasonable
     spacing — see `templates/business-definitions.html` for the current
     visual baseline).
   * Two independent search inputs above the table:
     - "Search by name" — filters rows by matching the Name column
       (case-insensitive substring).
     - "Search by description" — filters rows by matching the Description
       column (case-insensitive substring).
     - Both filters apply together (row shown only if it matches both active
       queries); show a "No matching definitions found." message when no rows
       match.
   * Each `<tr>` carries `data-name` / `data-description` attributes
     (lowercased) that the search script filters against — keep these in sync
     whenever a row's visible text changes.
   * When adding/updating a definition, add/update the corresponding `<tr>`
     (with its `data-name`/`data-description`) and preserve the existing table
     chrome unless the layout is out of date.
   * **Preserve the original text layout and exact wording from `<docs>/business-definitions-raw.md`:**
     - Use normal docs fonts (not monospace or code blocks).
     - Use `<br>` tags to preserve line breaks and structure exactly as written.
     - Do NOT reformat with bullet points, arrows, or other styling changes.
     - Keep original spacing, typos, and wording intact.
     - Use `<strong>` only for section headers that were already emphasized in the source.
2. Business rules (`<docs>/business-rules.html`):
   * Self-contained HTML file (inline `<style>`/`<script>`, no external deps),
     visually identical to the definitions page — see
     `templates/business-rules.html` for the current visual baseline.
   * Content rendered as an html `<table>` with columns: `Aggregate | Rule`,
     one row per rule. In the raw file, blocks are separated by an `------`
     line; the **first** `#` heading of a block is the aggregate name itself
     (e.g. `# Aggregate name`), and every following `# ...` heading in that
     block is one rule row carrying that aggregate in the first column.
   * The Rule cell renders the rule's `#` heading as `<strong>` followed by
     `<br>` and the rule body.
   * Two independent search inputs above the table:
     - "Search by aggregate" — filters rows by matching the Aggregate column
       (case-insensitive substring).
     - "Search by rule" — filters rows by matching the Rule column
       (case-insensitive substring).
     - Both filters apply together (row shown only if it matches both active
       queries); show a "No matching rules found." message when no rows match.
   * Each `<tr>` carries `data-aggregate` / `data-rule` attributes (lowercased)
     that the search script filters against — keep these in sync whenever a
     row's visible text changes.
   * When adding/updating a rule, add/update the corresponding `<tr>` (with its
     `data-aggregate`/`data-rule`) and preserve the existing table chrome unless
     the layout is out of date.
   * **Preserve the original text layout and exact wording from `<docs>/business-rules-raw.md`:**
     - Use normal docs fonts (not monospace or code blocks).
     - Use `<br>` tags to preserve line breaks and structure exactly as written.
     - Do NOT reformat with bullet points, arrows, or other styling changes.
     - Keep original spacing, typos, and wording intact.
     - Use `<strong>` only for the rule heading and for section headers that
       were already emphasized in the source.
