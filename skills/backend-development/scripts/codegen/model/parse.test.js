// Model grammar: markdown -> normalised model, incl. field conventions, value
// object resolution and named-key attribute paths. MODEL ERRORs are loud and
// named — the generator never guesses.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSections,
  parseField,
  parseDefinitions,
  injectIdentity,
  resolveKeyAttributePath,
  requireSearchOnlyFieldsHaveData,
  parseModel,
} from './parse.js';

test('fields: plain, bracketed, bracketed with convention', () => {
  assert.deepEqual(parseField('policy holder'), {
    label: 'policy holder', name: 'policyHolder', bracketed: false, convention: null, searchable: false,
  });
  assert.deepEqual(parseField('policy holder?'), {
    label: 'policy holder', name: 'policyHolder', bracketed: false, convention: null, searchable: true,
  });
  assert.deepEqual(parseField('[policy number]'), {
    label: 'policy number', name: 'policyNumber', bracketed: true, convention: null, searchable: false,
  });
  assert.deepEqual(parseField('[created at]:now'), {
    label: 'created at', name: 'createdAt', bracketed: true, convention: 'now', searchable: false,
  });
});

test('unknown convention fails loudly', () => {
  assert.throws(() => parseField('[x]:bogus'), /Unknown convention/);
});

test('convention on a non-bracketed field fails loudly', () => {
  assert.throws(() => parseField('x:now'), /only valid on a \[bracketed\] field/);
});

test('sections parse ids, props, aggregate id and fields', () => {
  const [s] = parseSections(`# Events

## policy-issued
Name: Policy Issued
policy:Id
* [policy number]
* policy holder
`);
  assert.equal(s.id, 'policy-issued');
  assert.equal(s.props.name, 'Policy Issued');
  assert.equal(s.aggregate, 'policy');
  assert.deepEqual(s.fields.map((f) => f.name), ['policyNumber', 'policyHolder']);
});

test('sections parse (list) fields and nested star attributes into a field tree', () => {
  const [s] = parseSections(`## issue-policy
Produces: policy-issued
* insured parties (list)
* * name
* * addresses (list)
* * * street
`);
  assert.equal(s.fields.length, 1);
  assert.equal(s.fields[0].name, 'insuredParties');
  assert.equal(s.fields[0].list, true);
  assert.deepEqual(s.fields[0].children.map((field) => field.name), ['name', 'addresses']);
  assert.equal(s.fields[0].children[1].list, true);
  assert.equal(s.fields[0].children[1].children[0].name, 'street');
});

test('nested fields without an immediate parent fail loudly', () => {
  assert.throws(
    () => parseSections('## issue-policy\n* * name\n'),
    /Nested field .* has no parent at depth 1/,
  );
});

test('nested list fields declare the object structure that parseModel turns into a value object', () => {
  const [s] = parseSections('## issue-policy\n* insured parties (list)\n* * name\n');
  assert.equal(s.fields[0].list, true);
  assert.equal(s.fields[0].children[0].name, 'name');
});

test('aggregate id line is not mistaken for a field', () => {
  const [s] = parseSections('## x\nproposal:Id\n* a\n');
  assert.equal(s.fields.length, 1);
});

test(':Key marks a persisting projection and is not swallowed as a property', () => {
  const [s] = parseSections('## policy-list\nName: Policy List\npolicy:Key\n* policy holder\n');
  assert.equal(s.aggregate, 'policy');
  assert.equal(s.keyed, true);
  assert.equal(s.props.policy, undefined);
  assert.deepEqual(s.fields.map((f) => f.name), ['policyHolder']);
});

test(':Id is the on-demand default', () => {
  const [s] = parseSections('## policy-details\npolicy:Id\n* policy holder\n');
  assert.equal(s.keyed, false);
});

// --- implicit identity attribute -----------------------------------------------

test('a :Id read model carries an implicit <aggregate>Id identity as its first field', () => {
  const [s] = parseSections('## policy-details\npolicy:Id\n* policy holder\n');
  const fields = injectIdentity(s, s.fields);
  assert.deepEqual(fields.map((f) => f.name), ['policyId', 'policyHolder']);
  assert.equal(fields[0].identity, true);
  assert.equal(fields[0].javaType, 'Long');
});

test('a :Key read model derives its identity name from the Key suffix', () => {
  const [s] = parseSections('## policy-list\npolicy:Key\n* policy holder\n');
  const fields = injectIdentity(s, s.fields);
  assert.deepEqual(fields.map((f) => f.name), ['policyKey', 'policyHolder']);
});

test('an explicit identity line is absorbed, its markers merged', () => {
  const [s] = parseSections('## policy-list\npolicy:Key\n* policy key?\n* policy holder\n');
  const fields = injectIdentity(s, s.fields);
  assert.deepEqual(fields.map((f) => f.name), ['policyKey', 'policyHolder']);
  assert.equal(fields[0].searchable, true);
});

test('an explicit :Key marker on the identity line makes it the composite key', () => {
  const [s] = parseSections('## policy-list\npolicy:Key\n* policy key:Key\n');
  const fields = injectIdentity(s, s.fields);
  assert.equal(fields[0].key, true);
});

test('a [bracketed] identity duplicate is a model error', () => {
  const [s] = parseSections('## policy-details\npolicy:Id\n* [policy id]\n');
  assert.throws(() => injectIdentity(s, s.fields), /identity attribute/);
});

// --- named key attributes: a composite key over CHOSEN nested attributes -------
// `policyHolderName:Key` picks only the "name" attribute of a "policy holder"
// value-object field for the key — not the whole object (contrast with
// `* policy holder:Key`, tested elsewhere, which keys on all of its attributes).

const policyHolderField = () => ({
  name: 'policyHolder',
  label: 'policy holder',
  javaType: 'PolicyHolder',
  valueObject: { className: 'PolicyHolder', package: 'a.b.domain' },
  embeds: true,
  attrs: [
    { name: 'name', javaType: 'String' },
    { name: 'surname', javaType: 'String' },
  ],
});

test('resolveKeyAttributePath resolves a camelCase path to one field\'s one attribute', () => {
  const r = resolveKeyAttributePath('policyHolderName', [policyHolderField()]);
  assert.equal(r.field.name, 'policyHolder');
  assert.equal(r.attr.name, 'name');
});

test('resolveKeyAttributePath picks just the named attribute, not its sibling', () => {
  const r = resolveKeyAttributePath('policyHolderSurname', [policyHolderField()]);
  assert.equal(r.attr.name, 'surname');
});

test('resolveKeyAttributePath returns null — never guesses — when nothing matches', () => {
  assert.equal(resolveKeyAttributePath('policyHolderAddress', [policyHolderField()]), null);
});

test('resolveKeyAttributePath returns null for a field with no value object', () => {
  const scalar = { name: 'policyNumber', label: 'policy number', javaType: 'String' };
  assert.equal(resolveKeyAttributePath('policyNumberSomething', [scalar]), null);
});

test('parseSections collects every header line instead of the last one silently winning', () => {
  const [s] = parseSections(
    '## insured-policies\nSubscribes: policy-issued\npolicyHolderName:Key\npolicyHolderSurname:Key\n* policy holder\n* [no of policies]\n',
  );
  assert.deepEqual(s.headerLines, [
    { name: 'policyHolderName', mode: 'Key' },
    { name: 'policyHolderSurname', mode: 'Key' },
  ]);
});

test('definitions with attributes become value objects, without stay scalar', () => {
  const defs = parseDefinitions(`# name Policy Holder
# description
A person.
------
# name Policy Coverage
# description
Protection.
* coverage period
* risk list`);
  assert.deepEqual(defs.map((d) => [d.name, d.attributes.length]), [
    ['Policy Holder', 0],
    ['Policy Coverage', 2],
  ]);
});

test('bullets under "# examples" are sample values, not attributes', () => {
  const defs = parseDefinitions(`# name Policy Holder
# description
A person.
* Name
* Surname

# examples
* John Snow
------
# name Policy Number
# description
A human readable identifier.

# examples
* POL-1
* POL-2`);
  assert.deepEqual(defs.map((d) => [d.name, d.attributes]), [
    ['Policy Holder', ['Name', 'Surname']],
    ['Policy Number', []],
  ]);
  // the sample values are kept, per definition, as test-data sources
  assert.deepEqual(defs.map((d) => [d.name, d.examples]), [
    ['Policy Holder', ['John Snow']],
    ['Policy Number', ['POL-1', 'POL-2']],
  ]);
});
// --- "??" search-only criteria: query params with no stored value --------------

test('parseSections routes a "??" field to searchOnlyFields, not fields', () => {
  const sections = parseSections(`
## policy-list
Subscribes: policy-issued
policy:Key
* policy holder
* policy coverage risk??
`);
  const s = sections[0];
  assert.equal(s.fields.length, 1);
  assert.equal(s.fields[0].name, 'policyHolder');
  assert.equal(s.searchOnlyFields.length, 1);
  assert.deepEqual(s.searchOnlyFields[0], { label: 'policy coverage risk', name: 'policyCoverageRisk', searchOnly: true });
});

test('a "??" field cannot be [bracketed] or carry a :convention/:Key', () => {
  assert.throws(
    () => parseSections(`
## policy-list
* [policy coverage risk]??
`),
    /Search-only criterion .* cannot be \[bracketed\]/,
  );
});

// --- "??" search-only criteria must be answerable from the read model's own data ---
// A decider's `matches<Field>` gets no collaborator beyond a no-arg constructor, so a
// criterion sharing no vocabulary with any stored field/attribute has no data path to
// a real implementation. That must fail loudly at parse time, not surface later as a
// hard-to-implement decider stub.

test('requireSearchOnlyFieldsHaveData: a "??" field with zero overlap is a MODEL ERROR', () => {
  assert.throws(
    () => requireSearchOnlyFieldsHaveData(
      'policy-list',
      [{ label: 'policy key' }, { label: 'policy holder' }, { label: 'policy number' }],
      [{ label: 'policy coverage risk' }],
    ),
    /declares "\?\?" search-only field "policy coverage risk" but none of its stored fields/,
  );
});

test('requireSearchOnlyFieldsHaveData: overlap with a regular field label passes', () => {
  assert.doesNotThrow(() =>
    requireSearchOnlyFieldsHaveData(
      'policy-list',
      [{ label: 'policy key' }, { label: 'policy coverage' }],
      [{ label: 'policy coverage risk' }],
    ),
  );
});

test('requireSearchOnlyFieldsHaveData: overlap with a value-object attribute passes', () => {
  assert.doesNotThrow(() =>
    requireSearchOnlyFieldsHaveData(
      'policy-list',
      [{ label: 'policy coverage', attrs: [{ name: 'coveragePeriod' }, { name: 'riskList' }] }],
      [{ label: 'policy coverage risk' }],
    ),
  );
});

test('requireSearchOnlyFieldsHaveData: the read model\'s own aggregate name is not counted as overlap', () => {
  // Every field here is "policy ..." by convention; without stripping the aggregate
  // name this would trivially "overlap" on the word "policy" alone and never fire.
  assert.throws(
    () => requireSearchOnlyFieldsHaveData(
      'policy-list',
      [{ label: 'policy key' }, { label: 'policy holder' }],
      [{ label: 'policy coverage risk' }],
    ),
    /none of its stored fields/,
  );
});

test('requireSearchOnlyFieldsHaveData: no "??" fields is a no-op', () => {
  assert.doesNotThrow(() => requireSearchOnlyFieldsHaveData('policy-list', [{ label: 'policy key' }], []));
});
test('parseField recognizes trailing :Key', () => {
  const f = parseField('policy number:Key');
  assert.equal(f.name, 'policyNumber');
  assert.equal(f.key, true);
  assert.equal(f.bracketed, false);
});
// --- parseModel end-to-end: named key attributes over a real model directory ---
// Exercises the full pipeline (parseSections -> decorate -> resolveKeyAttributePath)
// against real files, including the defensive guard: an unresolvable named key
// attribute no longer aborts the run — it degrades to a throwing String-key stub,
// records a WARNING, and every other element still generates.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function withModelDir(files, run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'codegen-model-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(path.join(dir, name), content);
    }
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a comma-separated Produces: line parses to one event id per entry, in order', () => {
  const model = withModelDir(
    {
      'business-definitions-raw.md': '',
      'events.md': `## policy-issued
policy:Id
* policy holder
## premium-calculated
policy:Id
* [premium amount]
`,
      'commands.md': `## issue-policy
Produces: policy-issued, premium-calculated
* policy holder
`,
      'readmodels.md': '',
    },
    (modelDir) => parseModel({ modelDir, basePackage: 'a.b' }),
  );
  const cmd = model.commands.find((c) => c.id === 'issue-policy');
  assert.deepEqual(cmd.produces, ['policy-issued', 'premium-calculated']);
  // an unknown production is still a MODEL ERROR
  assert.throws(
    () =>
      withModelDir(
        {
          'business-definitions-raw.md': '',
          'events.md': `## policy-issued
policy:Id
* policy holder
`,
          'commands.md': `## issue-policy
Produces: policy-issued, does-not-exist
* policy holder
`,
          'readmodels.md': '',
        },
        (modelDir) => parseModel({ modelDir, basePackage: 'a.b' }),
      ),
    /produces unknown event "does-not-exist"/,
  );
});

const NAMED_KEY_MODEL_FILES = {
  'business-definitions-raw.md': `# name Policy Holder
* Name
* Surname
`,
  'events.md': `## policy-issued
Name: Policy Issued
policy:Id
* policy holder
`,
  'commands.md': `## issue-policy
Name: Issue Policy
Produces: policy-issued
* policy holder
`,
};

test('parseModel resolves a named key attribute to one field\'s one attribute — composite key over a CHOSEN attribute, not the whole value object', () => {
  const model = withModelDir(
    {
      ...NAMED_KEY_MODEL_FILES,
      'readmodels.md': `## insured-policies
Name: Insured policies
Subscribes: policy-issued
policyHolderName:Key
* policy holder
* [no of policies]
`,
    },
    (modelDir) => parseModel({ modelDir, basePackage: 'a.b' }),
  );
  const rm = model.readModels.find((r) => r.id === 'insured-policies');
  assert.equal(rm.keyed, true);
  assert.equal(rm.aggregate, null);
  assert.equal(rm.keyFields.length, 1);
  assert.equal(rm.keyFields[0].name, 'policyHolderName');
  assert.deepEqual(rm.keyFields[0].derivedFrom, { field: 'policyHolder', attr: 'name' });
  // Only the attribute named in the header is part of the key — "surname" is not,
  // even though it lives on the very same value-object field.
  assert.ok(!rm.keyFields.some((f) => f.derivedFrom?.attr === 'surname'));
  // The record itself is exactly the declared fields — no synthetic identity
  // component is injected in this mode, and the derived attribute is not one of
  // its own components either (it lives only in the persistence key).
  assert.deepEqual(rm.fields.map((f) => f.name), ['policyHolder', 'noOfPolicies']);
});

test('parseModel supports two named key attributes forming one composite key', () => {
  const model = withModelDir(
    {
      ...NAMED_KEY_MODEL_FILES,
      'readmodels.md': `## insured-policies
Name: Insured policies
Subscribes: policy-issued
policyHolderName:Key
policyHolderSurname:Key
* policy holder
* [no of policies]
`,
    },
    (modelDir) => parseModel({ modelDir, basePackage: 'a.b' }),
  );
  const rm = model.readModels.find((r) => r.id === 'insured-policies');
  assert.deepEqual(
    rm.keyFields.map((f) => f.derivedFrom),
    [
      { field: 'policyHolder', attr: 'name' },
      { field: 'policyHolder', attr: 'surname' },
    ],
  );
});

test('parseModel generates a Product value object and List<Product> productList from nested list syntax', () => {
  const model = withModelDir(
    {
      'business-definitions-raw.md': '',
      'commands.md': `## add-products
Produces: products-added
* product (List)
* * name
* * description
`,
      'events.md': `## products-added
product:Id
* product (List)
* * name
* * description
`,
      'readmodels.md': `## products
product:Id
Subscribes: products-added
* product (List)
* * name
* * description
`,
    },
    (modelDir) => parseModel({ modelDir, basePackage: 'a.b' }),
  );
  const product = model.valueObjects.find((valueObject) => valueObject.className === 'Product');
  assert.deepEqual(product.fields.map((field) => [field.javaType, field.name]), [
    ['String', 'name'],
    ['String', 'description'],
  ]);
  for (const element of [...model.commands, ...model.events, ...model.readModels]) {
    const productList = element.fields.find((field) => field.name === 'productList');
    assert.equal(productList.javaType, 'List<Product>');
    assert.deepEqual(productList.imports, ['java.util.List', 'a.b.domain.Product']);
  }
});

test('parseModel marks a flattened read-model mapping from a nested product list unmappable instead of aborting', () => {
  const model = withModelDir(
    {
      'business-definitions-raw.md': '',
      'commands.md': `## add-products
Produces: products-added
* product (List)
* * name
* * description
`,
      'events.md': `## products-added
product:Id
* product (List)
* * name
* * description
`,
      'readmodels.md': `## stored-product
product:Key
Subscribes: products-added
* product name
* product description
`,
    },
    (modelDir) => parseModel({ modelDir, basePackage: 'a.b' }),
  );
  const rm = model.readModels.find((r) => r.id === 'stored-product');
  const productName = rm.fields.find((f) => f.name === 'productName');
  const productDescription = rm.fields.find((f) => f.name === 'productDescription');
  assert.match(productName.unmappable.reason, /cannot be derived automatically from 'product \(list\)'/);
  assert.match(productDescription.unmappable.reason, /cannot be derived automatically from 'product \(list\)'/);
});

test('parseModel degrades an unresolvable named key to a throwing-stub String key with a WARNING, instead of aborting', () => {
  const run = () =>
    withModelDir(
      {
        ...NAMED_KEY_MODEL_FILES,
        'readmodels.md': `## insured-policies
Name: Insured policies
Subscribes: policy-issued
policyHolderAddress:Key
* policy holder
* [no of policies]
`,
      },
      (modelDir) => parseModel({ modelDir, basePackage: 'a.b' }),
    );
  assert.doesNotThrow(run, 'an unresolvable named key must not abort the whole run');
  const model = run();
  const rm = model.readModels.find((r) => r.id === 'insured-policies');
  // The key field becomes a plain String fallback, marked unmappableKey so
  // emit.js can generate a throwing decider stub for it.
  const key = rm.keyFields.find((f) => f.name === 'policyHolderAddress');
  assert.ok(key, 'the degraded key field is present');
  assert.equal(key.label, 'policyHolderAddress');
  assert.equal(key.key, true);
  assert.equal(key.javaType, 'String');
  assert.ok(key.unmappableKey);
  assert.match(key.unmappableKey.reason, /matches no declared field's value-object attribute/);
  // The record itself is still exactly the declared fields — the degraded key
  // lives only in the persistence key, never as a component.
  assert.deepEqual(rm.fields.map((f) => f.name), ['policyHolder', 'noOfPolicies']);
  // The gap is reported, never hidden: one warning naming the read model + path.
  assert.equal(model.warnings.length, 1);
  assert.match(model.warnings[0], /insured-policies.*policyHolderAddress:Key/s);
});

test('parseModel degrades a structured (list) field used as a key to a warning + throwing stub, instead of aborting', () => {
  const model = withModelDir(
    {
      'business-definitions-raw.md': '',
      'commands.md': `## add-products
Produces: products-added
* product (List)
* * name
* * description
`,
      'events.md': `## products-added
product:Id
* product (List)
* * name
* * description
`,
      'readmodels.md': `## products
product:RowKey
Subscribes: products-added
* product (List):Key
* * name
* * description
`,
    },
    (modelDir) => parseModel({ modelDir, basePackage: 'a.b' }),
  );
  const rm = model.readModels.find((r) => r.id === 'products');
  const key = rm.keyFields.find((f) => f.name === 'productList');
  assert.ok(key, 'the structured key field is still part of the key');
  assert.ok(key.unmappableKey);
  assert.match(key.unmappableKey.reason, /structured field 'productList' used as a key/);
  assert.match(model.warnings.join('\n'), /structured field\(s\).*"productList".*as its key/s);
});

test('parseModel raises a MODEL ERROR when a named key attribute uses :Id instead of :Key', () => {
  const run = () =>
    withModelDir(
      {
        ...NAMED_KEY_MODEL_FILES,
        'readmodels.md': `## insured-policies
Name: Insured policies
Subscribes: policy-issued
policyHolderName:Id
* policy holder
* [no of policies]
`,
      },
      (modelDir) => parseModel({ modelDir, basePackage: 'a.b' }),
    );
  assert.throws(run, /insured-policies.*policyHolderName:Id.*must use ":Key"/s);
});

test('parseModel still treats a single header line naming the aggregate as the classic form, unaffected by named-key support', () => {
  const model = withModelDir(
    {
      ...NAMED_KEY_MODEL_FILES,
      'readmodels.md': `## policy-list
Name: Policy List
Subscribes: policy-issued
policy:Key
* policy holder
`,
    },
    (modelDir) => parseModel({ modelDir, basePackage: 'a.b' }),
  );
  const rm = model.readModels.find((r) => r.id === 'policy-list');
  assert.equal(rm.aggregate, 'policy');
  assert.equal(rm.fields[0].identity, true);
  assert.equal(rm.fields[0].name, 'policyKey');
});

// --- projection modes: `:Id` (on-demand) | `:Key` (single record) | `:RowKey` (row list)

test('parseSections keeps :Id / :Key / :RowKey header lines apart and flags both key markers as persisting', () => {
  const [onDemand] = parseSections('## x\npolicy:Id\n');
  const [single] = parseSections('## x\npolicy:Key\n');
  const [rows] = parseSections('## x\npolicy:RowKey\n');
  assert.deepEqual(onDemand.headerLines, [{ name: 'policy', mode: 'Id' }]);
  assert.equal(onDemand.keyed, false);
  assert.deepEqual(single.headerLines, [{ name: 'policy', mode: 'Key' }]);
  assert.equal(single.keyed, true);
  assert.deepEqual(rows.headerLines, [{ name: 'policy', mode: 'RowKey' }]);
  assert.equal(rows.keyed, true);
});

test('a :RowKey read model keeps the "<aggregate>Key" identity name — :RowKey speaks about cardinality, not the name of the key', () => {
  const [s] = parseSections('## issued-policies\npolicy:RowKey\n* policy holder\n');
  const fields = injectIdentity(s, s.fields);
  assert.deepEqual(fields.map((f) => f.name), ['policyKey', 'policyHolder']);
});

test('parseField rejects a field-level :RowKey marker — field/named key markers keep the ":Key" spelling', () => {
  assert.throws(() => parseField('policy number:RowKey'), /":RowKey" is only the classic header line/);
});

test('parseModel maps the three classic markers to on-demand / persisting-single / persisting-list', () => {
  const run = (header) =>
    withModelDir(
      {
        ...NAMED_KEY_MODEL_FILES,
        'readmodels.md': `## policy-view
Name: Policy View
Subscribes: policy-issued
${header}
* policy holder
`,
      },
      (modelDir) => parseModel({ modelDir, basePackage: 'a.b' }),
    ).readModels.find((r) => r.id === 'policy-view');

  const onDemand = run('policy:Id');
  assert.equal(onDemand.projection, 'on-demand');
  assert.equal(onDemand.keyed, false);
  assert.equal(onDemand.collection, false);
  assert.equal(onDemand.getMapping, 'policy-view/{aggregateId}');

  const single = run('policy:Key');
  assert.equal(single.projection, 'persisting-single');
  assert.equal(single.keyed, true);
  assert.equal(single.collection, false);
  assert.equal(single.getMapping, 'policy-view/{aggregateId}');

  const rows = run('policy:RowKey');
  assert.equal(rows.projection, 'persisting-list');
  assert.equal(rows.keyed, true);
  assert.equal(rows.collection, true);
  assert.equal(rows.getMapping, 'policy-view');
});

test('parseModel raises a MODEL ERROR when a named key attribute uses :RowKey instead of :Key', () => {
  const run = () =>
    withModelDir(
      {
        ...NAMED_KEY_MODEL_FILES,
        'readmodels.md': `## insured-policies
Name: Insured policies
Subscribes: policy-issued
policyHolderName:RowKey
* policy holder
* [no of policies]
`,
      },
      (modelDir) => parseModel({ modelDir, basePackage: 'a.b' }),
    );
  assert.throws(run, /insured-policies.*policyHolderName:RowKey.*must use ":Key"/s);
});

test('parseModel raises a MODEL ERROR when a single-record (":Key") read model marks a composite key field', () => {
  const run = () =>
    withModelDir(
      {
        ...NAMED_KEY_MODEL_FILES,
        'readmodels.md': `## policy-view
Name: Policy View
Subscribes: policy-issued
policy:Key
* policy holder:Key
`,
      },
      (modelDir) => parseModel({ modelDir, basePackage: 'a.b' }),
    );
  assert.throws(run, /policy-view.*marks field\(s\) with ":Key" but is not a row-list/s);
});

test('parseModel raises a MODEL ERROR when a "??" search-only criterion lands on a single-record (":Key") read model', () => {
  const run = () =>
    withModelDir(
      {
        ...NAMED_KEY_MODEL_FILES,
        'readmodels.md': `## policy-view
Name: Policy View
Subscribes: policy-issued
policy:Key
* policy holder
* policy coverage risk??
`,
      },
      (modelDir) => parseModel({ modelDir, basePackage: 'a.b' }),
    );
  assert.throws(run, /policy-view.*"\?\?" \(search-only criterion\).*not a row-list/s);
});

test('parseModel raises a MODEL ERROR when an event uses :RowKey', () => {
  const run = () =>
    withModelDir(
      {
        ...NAMED_KEY_MODEL_FILES,
        'events.md': `## policy-issued
Name: Policy Issued
policy:RowKey
* policy holder
`,
      },
      (modelDir) => parseModel({ modelDir, basePackage: 'a.b' }),
    );
  assert.throws(run, /policy-issued.*uses <aggregate>:RowKey.*always use ":Id"/s);
});

test('CLI: an unresolvable named key generates a full project, warning prints, and --check exits 0 (warnings are non-blocking)', () => {
  const project = mkdtempSync(path.join(tmpdir(), 'codegen-project-'));
  const docs = path.join(project, 'docs');
  const src = path.join(project, 'src');
  mkdirSync(docs, { recursive: true });
  mkdirSync(src, { recursive: true });
  const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    writeFileSync(
      path.join(project, 'codegen.config.json'),
      JSON.stringify({ basePackage: 'com.example.myapp', modelDir: 'docs' }),
    );
    for (const [name, content] of Object.entries(NAMED_KEY_MODEL_FILES)) {
      writeFileSync(path.join(docs, name), content);
    }
    writeFileSync(
      path.join(docs, 'readmodels.md'),
      `## insured-policies
Name: Insured policies
Subscribes: policy-issued
policyHolderAddress:Key
* policy holder
* [no of policies]
`,
    );
    const generate = spawnSync(process.execPath, [cli], { cwd: project, encoding: 'utf8' });
    assert.equal(generate.status, 0, `generate must not abort on an unresolvable named key:\n${generate.stderr}`);
    assert.match(generate.stderr, /WARNING.*policyHolderAddress:Key/s);

    const check = spawnSync(process.execPath, [cli, '--check'], { cwd: project, encoding: 'utf8' });
    assert.equal(check.status, 0, 'warnings alone must not fail the CI gate');
    assert.match(check.stderr, /WARNING.*"policyHolderAddress:Key".*no declared value-object field\/attribute matches/s);
    assert.match(check.stdout, /up to date/);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
