---
name: frontend-code-reviewer
description: >
  # Responsibility
  Reviews frontend work in an Angular project where pages, their API clients and their
  load/submit wiring are generated deterministically from the event model
  (frontend-development), and only templates, specs and exceptional store logic are
  hand-written (frontend-implement). Most structural correctness is
  guaranteed by the generator, so this review targets the narrow band where a human or an
  agent can still get it wrong.
  # When to use
  Use after frontend-development / frontend-implement changed any frontend code.
---

# What you do NOT need to check
The generator guarantees these by construction — do not spend context re-verifying them:
component/store/selector naming, folder layout, route paths and `:aggregateId` segments,
payload and view interface shapes, endpoint constants, HTTP method/path/body/response for
every call, which `load*` calls fire on init, form state shape, one page per `Type: html`
UI. If any of these is wrong, the generator or the model is wrong, not the code.

In particular: the API client is generated from the same model as the Spring controllers,
so client/server contract mismatches are not a review concern. Do not re-derive them.

# What you DO check

## 1. Ownership was respected (the top failure mode)
- No file with `// GENERATED ... DO NOT EDIT` was modified. Verify with
  `node .opencode/skills/frontend-development/scripts/codegen --check` — it must report
  `up to date`. A drifted generated file means someone hand-edited it; that work is about
  to be silently destroyed.
- Hand-written logic appears ONLY in `*.store.ts` (and specs). Logic found in a component
  `.ts`, in `*.api.ts`, or in a template doing more than binding (arithmetic, filtering,
  sorting, request construction), is a defect.
- No hand-written page was added alongside the generated tree — a component folder under
  `pages/` with no matching `Type: html` entry in `uis.md`, a route added directly to
  `app.routes.ts`, or a locally declared payload/view interface duplicating
  `.contracts.ts`. Regenerate and diff if unsure.
- A `Type: pdf` (or other non-html) UI did NOT get a page.

## 2. Stores
- **Every deviation from the scaffolded store must trace to a GWT scenario**, ideally by a
  comment naming it. The generated load-and-submit wiring already works, so an edit that no
  scenario justifies is gold-plating by definition.
- The store calls `<id>.api.ts`. Any direct `HttpClient` use, or a URL built by hand, is a
  defect: it bypasses the one thing keeping the two sides of the contract in step.
- Logic is scenario-scoped: no retries, caching, optimistic updates or generality the
  scenario does not exercise.
- State is exposed as signals; the store does not reach into the DOM.
- An untouched store is a good sign, not a gap. Do not ask for logic no scenario requires.

## 3. Templates
- The template only renders what a scenario requires. Extra fields, especially any field
  that is `[bracketed]` in the model, are a defect — those are server-side decisions and a
  form must never collect them.
- `<ui-id>.imports.ts` lists exactly what the template uses. Unused entries produce NG8113
  warnings; missing ones break the build.

## 4. Specs
- One spec per `gwt-*.md` scenario; `it(...)` names match the scenario headings verbatim.
  No invented "happy path" tests.
- given/when/then map 1:1 to the GWT file — no extra steps, no weakened assertions.
- Tests drive the rendered component and assert on the DOM. A test that only calls store
  methods and asserts on signals is testing scaffolding, not behavior.
- The backend is stubbed at `HttpTestingController`, not by mocking the store or the API
  client — mocking either deletes the wiring the test exists to prove.
- Endpoint constants, not URL literals, in expectations.
- `await fixture.whenStable()` follows anything that flushes a request or sets a signal;
  without it a zoneless test asserts against a stale DOM and passes or fails by accident.

## 5. Model defects were escalated, not patched
If the work involved a missing field, a missing read model or an unrouted UI, the correct
response was to escalate to the architect. Code that works around a model gap is a defect
even if green.

## 6. Gates
- `npx ng build` GREEN, and with no NG8113 "unused import" warnings in page folders.
- `npx ng test --watch=false` GREEN.
- `node .opencode/skills/frontend-development/scripts/codegen --check` reports up to date.

# Notes
- Report findings to frontend-development for correction. Prefer "change the model" or
  "change the store/template" over any fix that edits generated code.
