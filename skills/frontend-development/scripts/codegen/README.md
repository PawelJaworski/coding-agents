# fe-codegen — event model -> Angular pages

Deterministic generator owned by the `frontend-development` skill. Turns every
`Type: html` entry in `uis.md` into an Angular page, wired to the commands it
triggers and the read models it renders.

```
node .opencode/skills/frontend-development/scripts/codegen              regenerate
node .opencode/skills/frontend-development/scripts/codegen --check      CI gate
node .opencode/skills/frontend-development/scripts/codegen --json       dump parsed model
node .opencode/skills/frontend-development/scripts/codegen --project <dir> --model <dir>
```

## Config

`fecodegen.config.json` at the project root marks the root and supplies the paths:

```json
{ "modelDir": "../docs", "pagesRoot": "src/app/pages", "apiBase": "/api" }
```

| key | default | meaning |
|---|---|---|
| `modelDir` | `../docs` | where `uis.md`, `commands.md`, `readmodels.md` live |
| `appRoot` | `src/app` | used only to find `app.routes.ts` for the wiring warning |
| `pagesRoot` | `src/app/pages` | where page folders are written |
| `apiBase` | `/api` | prefix for generated endpoint constants |

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

The backend controllers are generated from the same event model, so the client is
a mirror, not an interpretation:

| model | request | response |
|---|---|---|
| command `<id>` | `POST <apiBase>/<id>` body = `Cmd` record | new aggregate id |
| read model `<agg>:Key` | `GET <apiBase>/<id>` | `View[]` |
| read model `<agg>:Id` | `GET <apiBase>/<id>/{aggregateId}` | `View` |

Generated Spring mappings carry no prefix, so `apiBase: "/api"` works via the dev
proxy rewrite (`^/api` -> ``). Change `apiBase`, never the generated calls.

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
| `parse.js` | markdown -> normalised model, plus linkage validation. |
| `emit.js` | model -> file contents. One function per artefact. |
| `index.js` | config discovery, ownership rules, write/check/report. |

## Tests

```
node --test .opencode/skills/frontend-development/scripts/codegen/codegen.test.js
```
