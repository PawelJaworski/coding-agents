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

import fs from 'node:fs';
import path from 'node:path';
import naming from './naming.js';

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

export function parseModel({ modelDir }) {
  const read = (f) => {
    const p = path.join(modelDir, f);
    if (!fs.existsSync(p)) throw new Error(`Missing model file: ${p}`);
    return fs.readFileSync(p, 'utf8');
  };

  const commands = parseSections(read('commands.md')).map((s) => ({
    id: s.id,
    name: s.props.name || s.id,
    producesId: s.props.produces || null,
    // Bracketed fields are decided downstream (server side). A form only ever
    // collects the plain ones, so the split is part of the model, not a view concern.
    fields: s.fields,
    inputFields: s.fields.filter((f) => !f.bracketed),
  }));
  const commandById = new Map(commands.map((c) => [c.id, c]));

  const readModels = parseSections(read('readmodels.md')).map((s) => ({
    id: s.id,
    name: s.props.name || s.id,
    aggregate: s.aggregate,
    keyed: s.keyed,
    // A `:Key` read model is listable across aggregates -> the page renders a
    // collection. An `:Id` one is replayed for a single aggregate -> one object.
    collection: Boolean(s.keyed),
    subscribes: list(s.props.subscribes),
    fields: s.fields,
  }));
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
      const page = {
        ...u,
        triggerIds,
        viewIds,
        commands: triggerIds.map((id) => commandById.get(id)),
        views,
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
    skipped: uis.filter((u) => u.type !== 'html'),
  };
}
