---
name: business-rules-and-definitions
description: >
  # Responsibility
  Updates business rules and definitions
  # When to use
  Use it when there is need to add or update a business definition or business rule, especially when `docs/business-definitions-raw.md` changes and `docs/business-definitions.html` must be synced.
---

# Files
Paths: docs/business-definitions.html, docs/business-rules.html

# Template
`docs/business-definitions-raw.md` is the source of truth for business definitions.
When it changes, update `docs/business-definitions.html` to match its rows exactly.
Each rule/definition is divided by '------' line.

`templates/business-definitions.html` is the canonical styling/layout baseline
for `docs/business-definitions.html` — reuse its CSS, script, and table
markup as-is (only regenerate the `<tbody>` rows from the raw source; don't
redesign the look). If `docs/business-definitions.html` already exists in the
repo, prefer it as the baseline instead (it may have received manual tweaks),
but keep it visually consistent with the template. Whenever the styling is
deliberately improved, update `templates/business-definitions.html` too so
future runs keep using the latest look.

# Format
1. Business definitions (`docs/business-definitions.html`):
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
   * **Preserve the original text layout and exact wording from `business-definitions-raw.md`:**
     - Use normal docs fonts (not monospace or code blocks).
     - Use `<br>` tags to preserve line breaks and structure exactly as written.
     - Do NOT reformat with bullet points, arrows, or other styling changes.
     - Keep original spacing, typos, and wording intact.
     - Use `<strong>` only for section headers that were already emphasized in the source.
2. Business rules (`docs/business-rules.html`): format not yet defined —
   ask before assuming it should mirror the definitions table/search layout.
