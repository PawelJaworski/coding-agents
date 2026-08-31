---
name: frontend-implement
description: >
  # Responsibility
  Implements ONE GWT scenario in the UI, test-first, in an Angular project where pages,
  their API clients and their load/submit wiring are already generated and working. Writes
  a spec transcribed from the GWT file, the template markup its assertions require, and —
  only when the scenario needs behavior beyond load-and-submit — logic in the page's
  *Store. Touches nothing else.
  # When to use
  Use after page scaffolding has been generated (see frontend-development), when a
  `<docs>/gwt-*.md` scenario must be turned into working screen behavior. One invocation
  per scenario.
  # **Important** This skill is parametrized
  * parameters: <docs> is passed from outside. You have to know it before starting.
---

# Context you need — and nothing more
1. The single `<docs>/gwt-*.md` scenario you were asked to implement.
2. The page folder it concerns: `src/app/pages/<ui-id>/` — its `.contracts.ts` (types and
   endpoints), `.api.ts` (what it already calls), `.store.ts`, `.html`, `.spec.ts`.

Do NOT read `commands.md`, `events.md`, `readmodels.md`, `uis.md`, other page folders, or
the whole `src/` tree. The scaffolding is already correct by construction; re-deriving it
wastes context and risks contradicting the generator.

# Flow — red, then green, nothing else

## 1. Write the spec (it must compile; it may fail)
`src/app/pages/<ui-id>/<ui-id>.spec.ts` — the scaffolded-once file already there.

- The `it(...)` name is the GWT scenario heading, verbatim.
- given/when/then map 1:1 onto the GWT lines. No extra steps, no invented happy paths.
- Drive the page the way a user does: render the component, query the DOM, click, type.
  Assert on rendered output, not on store internals. A test that only calls a store method
  is testing your own scaffolding.
- Stub the backend at the HTTP boundary with `HttpTestingController` (already wired in the
  scaffolded providers, with `afterEach(() => http.verify())`). Use the endpoint constants
  from `<ui-id>.contracts.ts` — never a string literal URL, which would silently drift from
  the model.
- Remember the page requests its read models on init: flush those before asserting, or
  `http.verify()` will fail the test for you.
- `await fixture.whenStable()` after anything that flushes a request or changes a signal;
  zoneless change detection will otherwise leave the DOM stale.

Run `npx ng test --watch=false`. It MUST compile. A red-but-compiling test is the expected
state here.

## 2. Read the failure — it tells you which seam to touch
The page already loads its read models and posts its commands, so most scenarios go red on
**markup**, not on missing logic: an assertion cannot find the element it queries. That is
the common case and it means step 3 is a template change only.

You need store logic ONLY when the red is behavioral — the scenario expects a redirect after
submit, a validation message before any request, a filtered or derived view. If the scenario
is satisfied by load-and-submit, the store is already correct; leave it alone.

## 3. Add only the markup the test demands
`<ui-id>.html` is yours and already renders a seed table or form. Add or adjust the controls,
rows and text the assertions query, and nothing more — no layout polish, no fields the
scenario does not mention, and never an input for a `[bracketed]` (server-decided) field. If
the template needs a new Angular import (`RouterLink`, a pipe, a child component), add it to
`<ui-id>.imports.ts`, which is also yours. Never touch the component's `.ts`.

## 4. Only if needed: extend the store, minimally
Add the smallest behavior that satisfies the scenario, with a comment naming it. Call the
generated `<ui-id>.api.ts` methods — never `HttpClient` directly, and never a URL literal.

- The store is scaffolded once — it is yours, and regeneration preserves it.
- Keep it scenario-scoped: no retries, caching, optimistic updates or generality the
  scenario does not exercise. That is scope creep, not implementation.
- If a field you need is missing from a payload or view interface, the MODEL is missing it.
  Escalate — do not widen the type.

## 5. Verify
`npx ng build` and `npx ng test --watch=false` green, then
`node .opencode/skills/frontend-development/scripts/codegen --check` must still report
`up to date`.

# Hard boundaries
- **Never edit a `// GENERATED ... DO NOT EDIT` file** — the component `.ts`, the
  `.contracts.ts`, the `.api.ts`, `pages.routes.ts`. If one looks wrong, the MODEL is wrong — escalate to
  the architect. Editing it is pointless; the next run overwrites it.
- **Never write page scaffolding.** No new components, routes, payload/view interfaces or
  page folders. If something is missing, the model is missing it.
- **Never edit the event-modelling docs or the GWT files.**
- **Never hand-roll an HTTP call.** The API client is generated from the same model as the
  backend controller; bypassing it is how the two sides drift.
- If the scenario cannot be satisfied inside a store and its template — because it needs a
  field the model does not have, a read model that does not exist, or the business intent
  is ambiguous — STOP and escalate. Do not invent behavior, and do not weaken the test to
  make it pass.
