---
name: business-and-definitions
description: >
  # Responsibility
  Updates business rules and definitions
  # When to use
  Use it when there is need for add/update business rule or definition
---

# Files
Paths: docs/business-definitions.html, docs/business-rules.html

# Format
1. Business definitions (`docs/business-definitions.html`):
   * Self-contained HTML file (inline `<style>`/`<script>`, no external deps).
   * Content rendered as an html `<table>` with columns: `Name | Description`,
     one row per definition, styled for readability (header row with
     background color, zebra-striped/hover rows, borders, reasonable spacing —
     see existing file for the current visual baseline).
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
   * When adding/updating a definition, add/update one `<tr>` (with its
     `data-name`/`data-description`) — do not regenerate the whole file from
     scratch unless the structure itself is out of date.
   * attributes of the definitions should be clearly visible eg. by bullet points
2. Business rules (`docs/business-rules.html`): format not yet defined —
   ask before assuming it should mirror the definitions table/search layout.
