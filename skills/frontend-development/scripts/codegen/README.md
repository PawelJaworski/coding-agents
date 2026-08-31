# fe-codegen — event model -> Angular pages

Deterministic generator owned by the `frontend-development` skill. Turns every
`Type: html` entry in `uis.md` into an Angular page, wired to the commands it
triggers and the read models it renders.

```
node .opencode/skills/frontend-development/scripts/codegen              regenerate
node .opencode/skills/frontend-development/scripts/codegen --check      CI gate
node .opencode/skills/frontend-development/scripts/codegen --json       dump parsed model
node .opencode/skills/frontend-development/scripts/codegen --project <dir> --model <dir> --openapi <file>
```

## Config

`fecodegen.config.json` at the project root marks the root and supplies the paths:

```json
{
  "modelDir": "../docs",
  "pagesRoot": "src/app/pages",
  "apiBase": "/api",
  "openapiPath": "../insurance-company-service/api/openapi.json"
}
```

| key | default | meaning |
|---|---|---|
| `modelDir` | `../docs` | where `uis.md`, `commands.md`, `readmodels.md` live |
| `appRoot` | `src/app` | used only to find `app.routes.ts` for the wiring warning |
| `pagesRoot` | `src/app/pages` | where page folders are written |
| `apiBase` | `/api` | prefix in front of every path taken from the contract |
| `openapiPath` | *(none)* | the backend's published OpenAPI document. Set -> it decides field names, field types and URLs. Unset -> types are inferred from the markdown model, as before. |


## Output per page

| file | mode |
|---|---|
| `<id>.contracts.ts` | generated |
| `<id>.api.ts` | generated |
| `<id>.ts` | generated |
| `<id>.imports.ts` | once |
| `<id>.store.ts` | once |
| `<id>.html`, `<id>.css` | once |
| `<id>.spec.ts` | once |

Plus `pages.routes.ts` (generated) with one route per page.

`once` files are written when absent and never touched again — they are the
project's, and hold everything the model cannot derive. They are scaffolded
*working*, not stubbed: a freshly generated page loads its read models, submits
its commands, and has a passing wiring test.

## The API contract

When `openapiPath` is set, the backend's own published document is the source of
truth for the wire — the client is a mirror of what the service actually serves,
not an interpretation of a markdown field list:

| model | request | response |
|---|---|---|
| command `<id>` | `POST <apiBase>/<id>` body = the request-body schema | new aggregate id |
| read model `<agg>:Key` | `GET <apiBase>/<id>` | `View[]` |
| read model `<agg>:Id` | `GET <apiBase>/<id>/{aggregateId}` | `View` |

Operations are matched to the model **by path, not by `operationId`** — springdoc
names operations after the Java method (`handle`), which carries no model meaning.

The split of authority:

| decided by `openapi.json` | decided by the event model |
|---|---|
| property names | which UIs exist, what each triggers/renders |
| property types, incl. nested objects and arrays | `:Key` vs `:Id` route shape |
| the URL of every operation | human labels for forms and tables |
| | `[bracketed]` = server-side decision, never a form input |

Disagreements are errors, never silently reconciled:

- a command or read model with no matching operation -> the backend does not
  serve it. Rebuild the service, or fix the model.
- a field on one side only -> `CONTRACT DRIFT`, listing both directions.
- `:Key` in `readmodels.md` but aggregate-scoped in the document (or vice versa)
  -> the two sides disagree about the projection strategy.

Since `openapi.json` is a **build artefact of another repo**, a stale one means
stale contracts. Regenerate the backend before regenerating the frontend, and
keep `--check` in CI.

Generated Spring mappings carry no prefix, so `apiBase: "/api"` works via the dev
proxy rewrite (`^/api` -> ``). Change `apiBase`, never the generated calls.

With `openapiPath` unset the generator falls back to typing fields from
`business-definitions-raw.md`, exactly as before.

## Linkage rules

- A UI whose id equals a **command** id triggers it. `Triggers: a, b` adds more.
- A UI whose id equals a **read model** id renders it. `ConsistsOf: a, b` adds more.
- A `:Key` read model is a collection (`View[]`, endpoint `/api/<id>`).
- An `:Id` read model is one aggregate (`View | null`, endpoint
  `/api/<id>/<aggregateId>`), and forces the route to `/<ui-id>/:aggregateId`.
- `[bracketed]` command fields are server-side decisions and never enter a payload
  interface.
- Anything other than `Type: html` is skipped.

Unknown ids, or two UIs collapsing to one folder, are `MODEL ERROR`s — defects in
the event model, not something to work around in code.

## Modules

| file | role |
|---|---|
| `naming.js` | pure id -> identifiers/paths. No filesystem access, so "does page X exist?" is answerable from the model alone. |
| `parse.js` | markdown -> normalised model, plus linkage validation and the OpenAPI overlay. |
| `openapi.js` | OpenAPI document -> wire contracts; path->model-id matching, schema->TypeScript, drift detection. |
| `emit.js` | model -> file contents. One function per artefact. |
| `index.js` | config discovery, ownership rules, write/check/report. |

## Tests

```
node --test .opencode/skills/frontend-development/scripts/codegen/codegen.test.js
```
