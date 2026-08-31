// Event-model markdown -> normalised frontend model. Pure parsing; no LLM, no
// filesystem discovery beyond reading the declared model files.
//
// Grammar is the same line-oriented grammar the event-modelling skill defines:
//   ## <kebab-id>              starts an element
//   Name: <human name>
//   Type: html|pdf|...         (uis.md)     only `html` produces a page
//   Actor: <role>              (uis.md)
//   Triggers: <c1>, <c2>       (uis.md)     commands this page issues
//   ConsistsOf: <r1>, <r2>     (uis.md)     read models this page renders
//   Produces: <event-id>       (commands.md)
//   Subscribes: <e1>, <e2>     (readmodels.md)
//   <aggregate>:Id | :Key      (readmodels.md) projection strategy
//   * field name               payload attribute / read-model column
//   * [field name]:uuid|now    system-decided attribute (never a form input)
//
// Field TYPES come from `business-definitions-raw.md`, exactly as the backend
// generator resolves them (backend-development/scripts/codegen/parse.js). A field
// whose label names a business definition that lists attributes is a structured
// object, not a string — the backend emits a Java record for it, so the frontend
// must emit a matching nested interface or the JSON will not deserialise.

import fs from 'node:fs';
import path from 'node:path';
import naming from './naming.js';
import { loadOpenApi, indexOpenApi, mergeFields } from './openapi.js';

export function parseSections(text) {
  const sections = [];
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('## ')) {
      current = { id: line.slice(3).trim(), props: {}, fields: [], aggregate: null, keyed: false };
      sections.push(current);
      continue;
    }
    if (!current || !line || line.startsWith('#')) continue;

    const field = line.match(/^[*-]\s+([^:]*\[?[^\]]*\]?(?::\w+)?)$/);
    if (field && !/^[A-Za-z][\w -]*:\s/.test(field[1])) {
      current.fields.push(parseField(field[1].trim()));
      continue;
    }
    const aggregate = line.match(/^-?\s*([A-Za-z][\w -]*):(Id|Key)$/);
    if (aggregate) {
      current.aggregate = aggregate[1].trim();
      current.keyed = aggregate[2] === 'Key';
      continue;
    }
    const prop = line.match(/^-?\s*([A-Za-z]+):\s*(.+)$/);
    if (prop) current.props[prop[1].toLowerCase()] = prop[2].trim();
  }
  return sections;
}

export function parseField(raw) {
  const m = raw.match(/^(\[)?([^\]]+?)(\])?(?::(\w+))?$/);
  if (!m) throw new Error(`Cannot parse field: "${raw}"`);
  const bracketed = Boolean(m[1] && m[3]);
  const label = m[2].trim();
  const convention = m[4] || null;
  // `now` renders as an ISO-8601 string over the wire; `uuid` as a string id.
  // Both are decided server-side, so the page never asks the user for them.
  const tsType = /\blist$/i.test(label) ? 'string[]' : 'string';
  return { label, name: naming.field(label), bracketed, convention, tsType };
}

const list = (v) => (v || '').split(',').map((x) => x.trim()).filter(Boolean);

// ---- business definitions -------------------------------------------------
// Mirrors backend-development/scripts/codegen/parse.js. Both generators read the
// same file and apply the same rules, so a field cannot be a record on one side
// and a string on the other.

export function parseDefinitions(text) {
  const defs = [];
  for (const block of text.split(/^-{3,}\s*$/m)) {
    const nameLine = block.match(/^#\s*name\s+(.+)$/m);
    if (!nameLine) continue;
    const attrs = [...block.matchAll(/^\*\s+(.+)$/gm)].map((m) => m[1].trim());
    defs.push({ name: nameLine[1].trim(), attributes: attrs });
  }
  return defs;
}

// A concept WITH listed attributes becomes an object type (the backend's value
// object / Java record); without attributes it is just a string.
export function resolveTypes(defs) {
  const byKey = new Map();
  const objectTypes = [];
  for (const def of defs) {
    const key = naming.words(def.name).join(' ');
    if (def.attributes.length === 0) {
      byKey.set(key, { tsType: 'string', object: null });
      continue;
    }
    const objectType = {
      name: naming.pascal(def.name),
      label: def.name,
      fields: def.attributes.map((a) => ({
        label: a,
        name: naming.field(a),
        // a "... list" attribute is a list of names; everything else is a string.
        // Same rule as the backend's `List<String>` vs `String`.
        tsType: /\blist$/i.test(a.trim()) ? 'string[]' : 'string',
      })),
    };
    byKey.set(key, { tsType: objectType.name, object: objectType });
    objectTypes.push(objectType);
  }
  return { byKey, objectTypes };
}

// A convention (`:uuid`, `:now`) is decided server-side and goes over the wire as
// a string, so it wins over any definition of the same name. Otherwise a matching
// business definition decides the type; failing that the parsed default stands.
function typeOf(field, byKey) {
  if (field.convention) return { tsType: 'string', object: null };
  return byKey.get(naming.words(field.label).join(' ')) || { tsType: field.tsType, object: null };
}

export function parseModel({ modelDir, openapiPath = null }) {
  const read = (f) => {
    const p = path.join(modelDir, f);
    if (!fs.existsSync(p)) throw new Error(`Missing model file: ${p}`);
    return fs.readFileSync(p, 'utf8');
  };
  // Optional: a model may define no business concepts at all, in which case every
  // field is a plain string and nothing nested is generated.
  const readOptional = (f) => {
    const p = path.join(modelDir, f);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  };

  const { byKey, objectTypes } = resolveTypes(
    parseDefinitions(readOptional('business-definitions-raw.md')),
  );
  const decorate = (fields) => fields.map((f) => ({ ...f, ...typeOf(f, byKey) }));

  // When the backend publishes an OpenAPI document it — not the markdown field
  // lists — is the truth about the wire. The model still owns page structure,
  // route shape, labels and [bracketed] hints; see openapi.js for the split.
  const contract = openapiPath ? indexOpenApi(loadOpenApi(openapiPath)) : null;

  const commands = parseSections(read('commands.md')).map((s) => {
    let fields = decorate(s.fields);
    let endpoint = `/${s.id}`;
    if (contract) {
      const op = contract.commands.get(s.id);
      if (!op) {
        throw new Error(
          `Command "${s.id}" has no POST /${s.id} in openapi.json. ` +
            `The backend does not serve it — rebuild the service, or remove it from commands.md.`,
        );
      }
      fields = mergeFields(op.fields, fields, `command ${s.id}`);
      endpoint = op.endpoint;
    }
    return {
      id: s.id,
      name: s.props.name || s.id,
      producesId: s.props.produces || null,
      endpoint,
      // Bracketed fields are decided downstream (server side). A form only ever
      // collects the plain ones, so the split is part of the model, not a view concern.
      fields,
      inputFields: fields.filter((f) => !f.bracketed),
    };
  });
  const commandById = new Map(commands.map((c) => [c.id, c]));

  const readModels = parseSections(read('readmodels.md')).map((s) => {
    let fields = decorate(s.fields);
    // A `:Key` read model is listable across aggregates -> the page renders a
    // collection. An `:Id` one is replayed for a single aggregate -> one object.
    const collection = Boolean(s.keyed);
    let endpoint = collection ? `/${s.id}` : `/${s.id}/{aggregateId}`;
    if (contract) {
      const op = contract.views.get(s.id);
      if (!op) {
        throw new Error(
          `Read model "${s.id}" has no GET /${s.id} in openapi.json. ` +
            `The backend does not serve it — rebuild the service, or remove it from readmodels.md.`,
        );
      }
      if (op.collection !== collection) {
        throw new Error(
          `Read model "${s.id}" is declared \`${s.aggregate}:${s.keyed ? 'Key' : 'Id'}\` in readmodels.md ` +
            `but openapi.json serves it as ${op.collection ? 'a collection' : 'a single aggregate'} ` +
            `(GET ${op.endpoint}). The two sides disagree about the projection strategy.`,
        );
      }
      fields = mergeFields(op.fields, fields, `read model ${s.id}`);
      endpoint = op.endpoint;
    }
    return {
      id: s.id,
      name: s.props.name || s.id,
      aggregate: s.aggregate,
      keyed: s.keyed,
      collection,
      endpoint,
      subscribes: list(s.props.subscribes),
      fields,
    };
  });
  const readModelById = new Map(readModels.map((r) => [r.id, r]));

  const uis = parseSections(read('uis.md')).map((s) => ({
    id: s.id,
    name: s.props.name || s.id,
    type: (s.props.type || 'html').toLowerCase(),
    actor: s.props.actor || null,
    triggers: list(s.props.triggers),
    consistsOf: list(s.props.consistsof),
  }));

  const pages = uis
    .filter((u) => u.type === 'html')
    .map((u) => {
      // Id-match is the default claim (a UI named after a command triggers it,
      // a UI named after a read model renders it); Triggers/ConsistsOf extend it.
      const triggerIds = [...new Set([...(commandById.has(u.id) ? [u.id] : []), ...u.triggers])];
      const viewIds = [...new Set([...(readModelById.has(u.id) ? [u.id] : []), ...u.consistsOf])];

      for (const id of triggerIds) {
        if (!commandById.has(id)) {
          throw new Error(`UI "${u.id}" triggers unknown command "${id}" (check commands.md)`);
        }
      }
      for (const id of viewIds) {
        if (!readModelById.has(id)) {
          throw new Error(`UI "${u.id}" consists of unknown read model "${id}" (check readmodels.md)`);
        }
      }

      const views = viewIds.map((id) => readModelById.get(id));
      // An `:Id` read model is replayed for ONE aggregate, so the page needs the
      // aggregate id — it comes from the route, which is why the route path grows
      // a `:aggregateId` segment. `:Key` read models are listable and need none.
      const aggregateParam = views.some((v) => !v.collection);
      const pageCommands = triggerIds.map((id) => commandById.get(id));
      // The nested interfaces this page's contracts file must declare — exactly
      // those its own payloads and views reference, so nothing unused is emitted.
      const pageObjectTypes = [];
      for (const f of [...pageCommands, ...views].flatMap((x) => x.fields)) {
        if (f.object && !pageObjectTypes.includes(f.object)) pageObjectTypes.push(f.object);
      }
      const page = {
        ...u,
        triggerIds,
        viewIds,
        commands: pageCommands,
        views,
        objectTypes: pageObjectTypes,
        aggregateParam,
        standalone: triggerIds.length === 0 && viewIds.length === 0,
        ...naming.page(u.id),
      };
      if (aggregateParam) page.routePath = `${page.routePath}/:aggregateId`;
      return page;
    });

  const dupes = pages.map((p) => p.dir).filter((d, i, a) => a.indexOf(d) !== i);
  if (dupes.length) {
    throw new Error(`Two html UIs collapse to the same page folder: ${[...new Set(dupes)].join(', ')}`);
  }

  return {
    uis,
    pages,
    commands,
    readModels,
    objectTypes: contract ? contract.objectTypes : objectTypes,
    contractSource: openapiPath,
    skipped: uis.filter((u) => u.type !== 'html'),
  };
}
