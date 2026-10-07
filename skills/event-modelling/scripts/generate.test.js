'use strict';
/*
 * Unit tests for generate.js — parsing + validation rules.
 *
 * Run with: node --test .opencode/skills/event-modelling/scripts/generate.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parseMdText,
  buildModel,
  renderArrows,
  renderTable,
  renderPage,
  computeGeometry,
  isBracketedField,
  isDoubleQuestionField,
  normalizeField,
  hasMatchingField,
  isTransformationOfSpecialAttribute,
  parseGwtContent,
  discoverGwtFiles,
} = require('./generate.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFixtureDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'event-modelling-test-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

// A minimal, internally-consistent 4-file fixture: one UI triggers one
// command, which produces one event, which is subscribed to by one read
// model. Used as a base for most tests; individual tests override the
// pieces they care about.
function baseFixture(overrides = {}) {
  const commands = overrides.commands !== undefined ? overrides.commands : `
## add-policy-holder
Name: Add Policy Holder
Produces: policy-holder-added
* name
* address
`;
  const events = overrides.events !== undefined ? overrides.events : `
## policy-holder-added
Name: Policy Holder Added
policyHolder:Id
* name
* address
`;
  const readmodels = overrides.readmodels !== undefined ? overrides.readmodels : `
## policy-holder-view
Name: Policy Holder View
Subscribes: policy-holder-added
policyHolderId:Key
* name
* address
`;
  const uis = overrides.uis !== undefined ? overrides.uis : `
## add-policy-holder
Name: Add Policy Holder Form
Actor: Clerk
Type: html
`;
  return makeFixtureDir({
    'commands.md': commands,
    'events.md': events,
    'readmodels.md': readmodels,
    'uis.md': uis,
  });
}

// ---------------------------------------------------------------------------
// parseMdText — happy path for each of the 4 markdown file "shapes"
// ---------------------------------------------------------------------------

test('parseMdText parses a commands.md-shaped entry', () => {
  const items = parseMdText(`
## add-policy-holder
Name: Add Policy Holder
Produces: policy-holder-added
* name
* address
`);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'add-policy-holder');
  assert.equal(items[0].name, 'Add Policy Holder');
  assert.deepEqual(items[0].produces, ['policy-holder-added']);
  assert.deepEqual(items[0].fields, ['name', 'address']);
});

test('parseMdText splits a comma-separated Produces: line into an array of event ids', () => {
  const items = parseMdText(`
## issue-policy
Name: Issue Policy
Produces: policy-issued, premium-calculated
* name
`);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].produces, ['policy-issued', 'premium-calculated']);
});

test('parseMdText retains (list) and nested-star structure while rendering indented fields', () => {
  const [item] = parseMdText(`
## issue-policy
Produces: policy-issued
* insured parties (list)
* * name
* * addresses (list)
* * * street
`);
  assert.deepEqual(item.fields, ['insured parties (list)', '  name', '  addresses (list)', '    street']);
  assert.equal(item.fieldTrees[0].name, 'insured parties');
  assert.equal(item.fieldTrees[0].list, true);
  assert.equal(item.fieldTrees[0].children[1].list, true);
  assert.equal(item.fieldTrees[0].children[1].children[0].name, 'street');
});

test('parseMdText parses an events.md-shaped entry with {aggregateName}:Id', () => {
  const items = parseMdText(`
## policy-holder-added
Name: Policy Holder Added
policyHolder:Id
* name
* address
`);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'policy-holder-added');
  assert.equal(items[0].aggregateId, 'policyHolder');
  assert.deepEqual(items[0].fields, ['name', 'address']);
});

test('parseMdText parses a readmodels.md-shaped entry with Subscribes:', () => {
  const items = parseMdText(`
## policy-holder-view
Name: Policy Holder View
Subscribes: event-a, event-b
* name
* [computed-field]
`);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].subscribes, ['event-a', 'event-b']);
  assert.deepEqual(items[0].fields, ['name', '[computed-field]']);
});

test('parseMdText parses one or more repeatable {keyName}:Key lines on a read model', () => {
  const items = parseMdText(`
## order-list
Name: Order List
Subscribes: order-created, order-cancelled
customerId:Key
region:Key
`);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].keys, [
    { name: 'customerId', mode: 'Key' },
    { name: 'region', mode: 'Key' },
  ]);
});

test('parseMdText parses {keyName}:RowKey lines and keeps the suffix for rendering', () => {
  const items = parseMdText(`
## issued-policies
Name: Issued Policies
Subscribes: policy-issued
policy:RowKey
`);
  assert.deepEqual(items[0].keys, [{ name: 'policy', mode: 'RowKey' }]);
});

test('parseMdText keeps :Key and :RowKey lines apart in written order', () => {
  const items = parseMdText(`
## order-list
Name: Order List
Subscribes: order-created
region:RowKey
customerId:Key
`);
  assert.deepEqual(items[0].keys, [
    { name: 'region', mode: 'RowKey' },
    { name: 'customerId', mode: 'Key' },
  ]);
});

test('parseMdText parses a uis.md-shaped entry with Triggers: and ConsistsOf:', () => {
  const items = parseMdText(`
## some-ui
Name: Some UI
Actor: Clerk
Type: html
Triggers: cmd-a, cmd-b
ConsistsOf: view-a, view-b
`);
  assert.equal(items.length, 1);
  assert.equal(items[0].actor, 'Clerk');
  assert.deepEqual(items[0].actors, ['Clerk']); // single actor is a one-element list
  assert.equal(items[0].typeHint, 'html');
  assert.deepEqual(items[0].triggers, ['cmd-a', 'cmd-b']);
  assert.deepEqual(items[0].consistsOf, ['view-a', 'view-b']);
});

test('parseMdText splits a comma-separated Actor: line into one actor per name', () => {
  const items = parseMdText(`
## some-ui
Name: Some UI
Actor: Insurance Agent, Policy Holder
Type: html
`);
  assert.equal(items.length, 1);
  // The raw line is kept as written (error messages), while `actors` is the
  // parsed list every placement/rendering rule uses.
  assert.equal(items[0].actor, 'Insurance Agent, Policy Holder');
  assert.deepEqual(items[0].actors, ['Insurance Agent', 'Policy Holder']);
});

test('parseMdText parses multiple headings into separate items', () => {
  const items = parseMdText(`
## first
Name: First

## second
Name: Second
`);
  assert.equal(items.length, 2);
  assert.equal(items[0].id, 'first');
  assert.equal(items[1].id, 'second');
});

// ---------------------------------------------------------------------------
// isBracketedField / normalizeField / hasMatchingField
// ---------------------------------------------------------------------------

test('isBracketedField detects [...]-wrapped fields', () => {
  assert.equal(isBracketedField('[computed]'), true);
  assert.equal(isBracketedField('plain'), false);
});

test('normalizeField strips brackets and lowercases', () => {
  assert.equal(normalizeField('[Policy Number]'), 'policy number');
  assert.equal(normalizeField('Policy Number'), 'policy number');
});

test('parseMdText strips a trailing "?" but keeps "??" intact (exemption marker, stripped only at render time)', () => {
  const items = parseMdText(`
## policy-holder-view
Name: Policy Holder View
Subscribes: event-a
* name?
* address??
`);
  assert.deepEqual(items[0].fields, ['name', 'address??']);
});

test('isDoubleQuestionField detects a trailing "??"', () => {
  assert.equal(isDoubleQuestionField('address??'), true);
  assert.equal(isDoubleQuestionField('address?'), false);
  assert.equal(isDoubleQuestionField('address'), false);
});

test('hasMatchingField finds a case-insensitive match across upstream field lists', () => {
  assert.equal(hasMatchingField('Name', [['name', 'address']]), true);
  assert.equal(hasMatchingField('missing', [['name', 'address']]), false);
});

test('isTransformationOfSpecialAttribute detects camelCase to space-separated transformations', () => {
  // Test :Id transformations
  assert.equal(isTransformationOfSpecialAttribute('policy id', 'policy', null), true);
  assert.equal(isTransformationOfSpecialAttribute('policy holder id', 'policyHolder', null), true);
  assert.equal(isTransformationOfSpecialAttribute('POLICY HOLDER ID', 'policyHolder', null), true);
  
  // Test :Key transformations
  assert.equal(isTransformationOfSpecialAttribute('customer key', null, [{ name: 'customer', mode: 'Key' }]), true);
  assert.equal(isTransformationOfSpecialAttribute('customer id key', null, [{ name: 'customerId', mode: 'Key' }]), true);
  assert.equal(isTransformationOfSpecialAttribute('CUSTOMER ID KEY', null, [{ name: 'customerId', mode: 'Key' }]), true);
  
  // Test multiple keys
  assert.equal(isTransformationOfSpecialAttribute('region key', null, [
    { name: 'customerId', mode: 'Key' },
    { name: 'region', mode: 'Key' },
  ]), true);
  
  // Test :RowKey transformations — ":RowKey" speaks about cardinality, the
  // injected identity is still "<name> key", never "<name> row key"
  assert.equal(isTransformationOfSpecialAttribute('customer key', null, [{ name: 'customer', mode: 'RowKey' }]), true);
  assert.equal(isTransformationOfSpecialAttribute('customer row key', null, [{ name: 'customer', mode: 'RowKey' }]), false);
  
  // Test non-transformations
  assert.equal(isTransformationOfSpecialAttribute('policy name', 'policy', null), false);
  assert.equal(isTransformationOfSpecialAttribute('customer id', null, [{ name: 'customer', mode: 'Key' }]), false);
  assert.equal(isTransformationOfSpecialAttribute('policy', 'policy', null), false);
});

// ---------------------------------------------------------------------------
// buildModel — orphan-event detection (reproduces the policy-holder-added bug)
// ---------------------------------------------------------------------------

test('buildModel throws on an orphan event (no Produces: link from any command)', () => {
  const dir = baseFixture({
    commands: `
## some-other-command
Name: Some Other Command
Produces: some-other-event
`,
    events: `
## some-other-event
Name: Some Other Event
foo:Id

## policy-holder-added
Name: Policy Holder Added
policyHolder:Id
`,
    readmodels: `
## rm
Name: RM
Subscribes: some-other-event, policy-holder-added
policyHolderId:Key
`,
    uis: `
## some-other-command
Actor: Clerk
`,
  });
  assert.throws(
    () => buildModel(dir),
    /Orphan event\(s\) with no Produces: link — policy-holder-added/
  );
});

test('buildModel throws when a command Produces: an unknown event id', () => {
  const dir = baseFixture({
    commands: `
## add-policy-holder
Name: Add Policy Holder
Produces: policy-holder-added, no-such-event
* name
`,
  });
  assert.throws(
    () => buildModel(dir),
    /Command "add-policy-holder" produces unknown event "no-such-event"/
  );
});

// ---------------------------------------------------------------------------
// buildModel / render — one command producing several events (comma-separated
// Produces:). Exactly one command card is drawn, at the leftmost produced
// event's column; later produced events keep their own columns and get routed
// produces-edges, and trigger/UI stacks are never duplicated.
// ---------------------------------------------------------------------------

test('a command producing several events keeps every event column and renders a single card', () => {
  const dir = baseFixture({
    commands: `
## issue-policy
Name: Issue Policy
Produces: policy-issued, premium-calculated
* name
`,
    events: `
## policy-issued
Name: Policy Issued
policy:Id
* name

## premium-calculated
Name: Premium Calculated
policy:Id
* [premium amount]
`,
    readmodels: `
## policy-view
Name: Policy View
Subscribes: policy-issued
policyId:Key
* name
`,
    uis: `
## issue-policy
Name: Issue Policy Form
Actor: Clerk
Type: html
`,
  });
  const model = buildModel(dir);
  // The read model (subscribed to the first event only) must splice a view
  // column between the two events instead of overwriting the second one —
  // both events survive placement.
  const eventCols = model.columns.filter((c) => c.type === 'event').map((c) => c.eventId);
  assert.deepEqual(eventCols, ['policy-issued', 'premium-calculated']);

  const geo = computeGeometry(model);
  const html = renderTable(model, geo);
  // Exactly one command card, and exactly one trigger UI card (both at the
  // primary produced event's column — no duplication for the second event).
  assert.equal((html.match(/data-element="issue-policy"/g) || []).length, 1);
  assert.equal((html.match(/data-element="ui-issue-policy--triggers-issue-policy"/g) || []).length, 1);
  // Both event cards render.
  assert.equal((html.match(/data-element="premium-calculated"/g) || []).length, 1);
});

test('a command producing several events draws one routed produces-edge per event', () => {
  const dir = baseFixture({
    commands: `
## issue-policy
Name: Issue Policy
Produces: policy-issued, premium-calculated
* name
`,
    events: `
## policy-issued
Name: Policy Issued
policy:Id
* name

## premium-calculated
Name: Premium Calculated
policy:Id
* [premium amount]
`,
    readmodels: `
## policy-view
Name: Policy View
Subscribes: policy-issued
policyId:Key
* name
`,
    uis: `
## issue-policy
Name: Issue Policy Form
Actor: Clerk
Type: html
`,
  });
  const model = buildModel(dir);
  const geo = computeGeometry(model);
  const svg = renderArrows(model, geo);
  // One vertical produces-edge for the primary event + one routed polyline
  // edge for the second event — still exactly one trigger arrow.
  assert.equal((svg.match(/data-kind="produces"/g) || []).length, 2);
  assert.match(svg, /<polyline[^>]*data-kind="produces"/);
  assert.equal((svg.match(/data-kind="triggers"/g) || []).length, 1);
});

// ---------------------------------------------------------------------------
// buildModel — missing {aggregateName}:Id on an event
// ---------------------------------------------------------------------------

test('buildModel throws when an event is missing mandatory {aggregateName}:Id', () => {
  const dir = baseFixture({
    events: `
## policy-holder-added
Name: Policy Holder Added
* name
* address
`,
  });
  assert.throws(
    () => buildModel(dir),
    /Event\(s\) missing mandatory "\{aggregateName\}:Id" — policy-holder-added/
  );
});

// ---------------------------------------------------------------------------
// buildModel — unknown ids referenced in uis.md
// ---------------------------------------------------------------------------

test('buildModel throws when a UI Triggers: an unknown command id', () => {
  const dir = baseFixture({
    uis: `
## add-policy-holder
Name: Add Policy Holder Form
Actor: Clerk
Triggers: not-a-real-command
`,
  });
  assert.throws(
    () => buildModel(dir),
    /UI "add-policy-holder" Triggers: references unknown command id "not-a-real-command"/
  );
});

test('buildModel throws when a UI ConsistsOf: an unknown read model id', () => {
  const dir = baseFixture({
    uis: `
## add-policy-holder
Name: Add Policy Holder Form
Actor: Clerk

## output-ui
Name: Output UI
Actor: Clerk
ConsistsOf: not-a-real-view
`,
  });
  assert.throws(
    () => buildModel(dir),
    /UI "output-ui" ConsistsOf: references unknown read model id\(s\) — not-a-real-view/
  );
});

// ---------------------------------------------------------------------------
// buildModel — field-consistency checks (event/read-model fields must trace
// back upstream unless bracketed)
// ---------------------------------------------------------------------------

test('buildModel throws when an event field has no matching command field', () => {
  const dir = baseFixture({
    commands: `
## add-policy-holder
Name: Add Policy Holder
Produces: policy-holder-added
* name
`,
    events: `
## policy-holder-added
Name: Policy Holder Added
policyHolder:Id
* name
* address
`,
    readmodels: `
## policy-holder-view
Name: Policy Holder View
Subscribes: policy-holder-added
policyHolderId:Key
* name
`,
  });
  assert.throws(
    () => buildModel(dir),
    /event 'policy-holder-added' field "address" has no matching field in producing command 'add-policy-holder'/
  );
});

test('buildModel allows a bracketed event field with no matching command field', () => {
  const dir = baseFixture({
    commands: `
## add-policy-holder
Name: Add Policy Holder
Produces: policy-holder-added
* name
`,
    events: `
## policy-holder-added
Name: Policy Holder Added
policyHolder:Id
* name
* [holder-id]
`,
    readmodels: `
## policy-holder-view
Name: Policy Holder View
Subscribes: policy-holder-added
policyHolderId:Key
* name
`,
  });
  assert.doesNotThrow(() => buildModel(dir));
});

test('buildModel accepts a structurally identical nested list passthrough', () => {
    const dir = baseFixture({
      commands: `## add-policy-holder
Produces: policy-holder-added
* addresses (list)
* * street
`,
      events: `## policy-holder-added
policyHolder:Id
* addresses (list)
* * street
`,
      readmodels: `## policy-holder-view
Subscribes: policy-holder-added
policyHolderId:Key
* addresses (list)
* * street
`,
    });
    assert.doesNotThrow(() => buildModel(dir));
});

test('buildModel refuses a nested read-model mapping whose source shape differs', () => {
    const dir = baseFixture({
      commands: `## add-policy-holder
Produces: policy-holder-added
* addresses (list)
* * street
`,
      events: `## policy-holder-added
policyHolder:Id
* addresses (list)
* * street
`,
      readmodels: `## policy-holder-view
Subscribes: policy-holder-added
policyHolderId:Key
* addresses (list)
* * postal code
`,
    });
    assert.throws(() => buildModel(dir), /Unsupported structured-field mapping/);
});

test('buildModel allows flattening a nested list into read-model fields (pure flattening is a recognized passthrough)', () => {
  const dir = baseFixture({
    commands: `## add-policy-holder
Name: Add Policy Holder
Produces: policy-holder-added
* product (List)
* * code
* * name
* * description
`,
    events: `## policy-holder-added
policyHolder:Id
* product (List)
* * code
* * name
* * description
`,
    readmodels: `## policy-holder-view
Name: Policy Holder View
Subscribes: policy-holder-added
productCode:Key
* product code
* product name
* product description
`,
  });
  assert.doesNotThrow(() => buildModel(dir));
});

test('buildModel allows flattening through a deeper plain (non-list) child path of an upstream field', () => {
  const dir = baseFixture({
    commands: `## add-policy-holder
Name: Add Policy Holder
Produces: policy-holder-added
* product (List)
* * code
* * details
* * * size
`,
    events: `## policy-holder-added
policyHolder:Id
* product (List)
* * code
* * details
* * * size
`,
    readmodels: `## policy-holder-view
Name: Policy Holder View
Subscribes: policy-holder-added
productCode:Key
* product code
* product details size
`,
  });
  assert.doesNotThrow(() => buildModel(dir));
});

test('buildModel still refuses a read-model field that only shares a prefix with a nested field but renames/aggregates its child (not a pure flattening)', () => {
  const dir = baseFixture({
    commands: `## add-policy-holder
Name: Add Policy Holder
Produces: policy-holder-added
* product (List)
* * code
* * name
`,
    events: `## policy-holder-added
policyHolder:Id
* product (List)
* * code
* * name
`,
    readmodels: `## policy-holder-view
Name: Policy Holder View
Subscribes: policy-holder-added
productCode:Key
* product title
`,
  });
  assert.throws(() => buildModel(dir), /Unsupported structured-field mapping.*pure flattening/);
});

test('buildModel allows a "??"-suffixed read-model field that matches an upstream event field', () => {
  const dir = baseFixture({
    readmodels: `
## policy-holder-view
Name: Policy Holder View
Subscribes: policy-holder-added
policyHolderId:Key
* name
* address??
`,
  });
  assert.doesNotThrow(() => buildModel(dir));
});

test('buildModel allows a "??"-suffixed read-model field with NO matching upstream event field ("??" is exempt, read-model-only search criterion)', () => {
  const dir = baseFixture({
    readmodels: `
## policy-holder-view
Name: Policy Holder View
Subscribes: policy-holder-added
policyHolderId:Key
* name
* phone number??
`,
  });
  assert.doesNotThrow(() => buildModel(dir));
});

test('renderTable renders a "??"-suffixed read-model field stripped, same as a trailing "?"', () => {
  const dir = baseFixture({
    readmodels: `
## policy-holder-view
Name: Policy Holder View
Subscribes: policy-holder-added
policyHolderId:Key
* name?
* address??
`,
  });
  const model = buildModel(dir);
  const geo = computeGeometry(model);
  const html = renderTable(model, geo);
  assert.match(html, /<li>address<\/li>/); // trailing "??" stripped for display
  assert.match(html, /<li>name<\/li>/); // trailing "?" stripped for display
});



test('renderArrows tags a human-triggered command edge as "triggers" and its produced-event edge as "produces"', () => {
  const dir = baseFixture();
  const model = buildModel(dir);
  const geo = computeGeometry(model);
  const svg = renderArrows(model, geo);
  assert.match(svg, /data-kind="triggers"/);
  assert.match(svg, /data-kind="produces"/);
});

test('renderArrows draws no "triggers" edge for a command with no matching uis.md entry (no actor, no UI card, no trigger arrow)', () => {
  const dir = baseFixture({
    uis: `
## policy-holder-view
Name: Policy Holder View
Actor: Clerk
Type: html
`,
  });
  const model = buildModel(dir);
  const geo = computeGeometry(model);
  const svg = renderArrows(model, geo);
  assert.doesNotMatch(svg, /data-kind="triggers"/);
  assert.match(svg, /data-kind="produces"/); // the command→event edge is unaffected
});

test('renderArrows tags a read-model subscription edge as "observes"', () => {
  const dir = baseFixture();
  const model = buildModel(dir);
  const geo = computeGeometry(model);
  const svg = renderArrows(model, geo);
  assert.match(svg, /data-kind="observes"/);
});

test('renderArrows tags an automated (Observes:) command edge as "observes-cmd"', () => {
  const dir = baseFixture({
    commands: `
## add-policy-holder
Name: Add Policy Holder
Produces: policy-holder-added
* name

## issue-policy
Name: Issue Policy
Observes: policy-holder-added
Produces: policy-issued
`,
    events: `
## policy-holder-added
Name: Policy Holder Added
policyHolder:Id
* name

## policy-issued
Name: Policy Issued
policy:Id
`,
    readmodels: `
## policy-holder-view
Name: Policy Holder View
Subscribes: policy-holder-added
policyHolderId:Key
* name
`,
    uis: `
## add-policy-holder
Name: Add Policy Holder Form
Actor: Clerk
`,
  });
  const model = buildModel(dir);
  const geo = computeGeometry(model);
  const svg = renderArrows(model, geo);
  assert.match(svg, /data-kind="observes-cmd"/);
});

test('renderArrows tags a read-model -> output-UI edge as "displays"', () => {
  const dir = baseFixture({
    uis: `
## add-policy-holder
Name: Add Policy Holder Form
Actor: Clerk

## policy-holder-view
Name: Policy Holder View Screen
Actor: Clerk
Type: html
`,
  });
  const model = buildModel(dir);
  const geo = computeGeometry(model);
  const svg = renderArrows(model, geo);
  assert.match(svg, /data-kind="displays"/);
});

// ---------------------------------------------------------------------------
// Multi-actor `Actor:` lines (`Actor: Insurance Agent, Policy Holder`) — the
// named actors form ONE actor group: a single swimlane whose gutter label
// lists each actor on its own line (a command's role-row placement stays a
// single swimlane even when several actors share the UI).
// ---------------------------------------------------------------------------

test('a multi-actor Actor: line is ONE swimlane whose gutter lists each actor on its own line', () => {
  const dir = baseFixture({
    uis: `
## add-policy-holder
Name: Add Policy Holder Form
Actor: Insurance Agent, Policy Holder
Type: html
`,
  });
  const model = buildModel(dir);
  assert.equal(model.roles.length, 1);
  assert.deepEqual(model.roles[0].actors, ['Insurance Agent', 'Policy Holder']);
  const html = renderTable(model, computeGeometry(model));
  assert.match(html, /class="gutter role-gutter"[^>]*><div class="actor-lines"><div>Insurance Agent<\/div><div>Policy Holder<\/div><\/div></);
  // The UI is still one card in that single swimlane, with one trigger arrow.
  assert.equal((html.match(/data-element="ui-add-policy-holder--triggers-add-policy-holder"/g) || []).length, 1);
  const svg = renderArrows(model, computeGeometry(model));
  assert.equal((svg.match(/data-kind="triggers"/g) || []).length, 1);
  // The stacked names carry a small gap (`.actor-lines` CSS).
  assert.match(renderPage(model, computeGeometry(model), html, svg), /\.actor-lines\{[^}]*gap:2px\}/);
});

test('buildModel matches actor groups regardless of written order (fan-in UIs share one swimlane)', () => {
  const dir = baseFixture({
    uis: `
## add-policy-holder
Name: Add Policy Holder Form
Actor: Insurance Agent, Policy Holder

## second-entry
Name: Second Entry Point
Actor: Policy Holder, Insurance Agent
Triggers: add-policy-holder
`,
  });
  const model = buildModel(dir);
  // `A, B` and `B, A` name the same actor set — one swimlane, one gutter label.
  assert.equal(model.roles.length, 1);
  const html = renderTable(model, computeGeometry(model));
  assert.equal((html.match(/role-gutter/g) || []).length, 1);
});

test('buildModel throws when UIs fanning into one command name different actor groups', () => {
  const dir = baseFixture({
    uis: `
## add-policy-holder
Name: Add Policy Holder Form
Actor: Insurance Agent, Policy Holder

## second-entry
Name: Second Entry Point
Actor: Insurance Agent
Triggers: add-policy-holder
`,
  });
  assert.throws(
    () => buildModel(dir),
    /different actors/
  );
});

test('an output UI naming the same actors as the trigger UI shares the swimlane and keeps its "displays" edge', () => {
  const dir = baseFixture({
    uis: `
## add-policy-holder
Name: Add Policy Holder Form
Actor: Insurance Agent, Policy Holder

## policy-holder-view
Name: Policy Holder View Screen
Actor: Policy Holder, Insurance Agent
Type: html
`,
  });
  const model = buildModel(dir);
  assert.equal(model.roles.length, 1);
  const svg = renderArrows(model, computeGeometry(model));
  assert.equal((svg.match(/data-kind="displays"/g) || []).length, 1);
  assert.equal((svg.match(/data-kind="triggers"/g) || []).length, 1);
});

test('renderTable lists each actor of a standalone UI on its own line in the caption', () => {
  const dir = baseFixture({
    uis: `
## add-policy-holder
Name: Add Policy Holder Form
Actor: Clerk

## policy-holder-portal
Name: Policy Holder Portal
Type: html
Actor: Insurance Agent, Policy Holder
`,
  });
  const model = buildModel(dir);
  const html = renderTable(model, computeGeometry(model));
  assert.match(html, /class="caption"><div class="actor-lines"><div>Insurance Agent<\/div><div>Policy Holder<\/div><\/div><\/div>/);
  assert.match(html, /Unwired UIs/);
});

test('the definitions warning reports each undefined actor of a multi-actor line separately', () => {
  const dir = baseFixture({
    uis: `
## add-policy-holder
Name: Add Policy Holder Form
Actor: Insurance Agent, Policy Holder
Type: html
`,
  });
  fs.mkdirSync(path.join(dir, 'docs'));
  fs.writeFileSync(
    path.join(dir, 'docs', 'business-definitions.html'),
    '<span data-name="Insurance Agent"></span>'
  );
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (msg) => { warnings.push(String(msg)); };
  try {
    buildModel(dir);
  } finally {
    console.warn = origWarn;
  }
  // "Insurance Agent" is documented; only the undocumented "Policy Holder"
  // is reported — the line is never treated as one composite term.
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Policy Holder/);
  assert.doesNotMatch(warnings[0], /Insurance Agent/);
});

test('fan-out and output copies of one UI use distinct interaction node ids', () => {
  const dir = baseFixture({
    commands: `
## add-policy-holder
Name: Add Policy Holder
Produces: policy-holder-added
* name

## update-policy-holder
Name: Update Policy Holder
Produces: policy-holder-updated
* name
`,
    events: `
## policy-holder-added
Name: Policy Holder Added
policyHolder:Id
* name

## policy-holder-updated
Name: Policy Holder Updated
policyHolder:Id
* name
`,
    readmodels: `
## policy-holder-view
Name: Policy Holder View
Subscribes: policy-holder-added, policy-holder-updated
policyHolderId:Key
* name
`,
    uis: `
## policy-holder-screen
Name: Policy Holder Screen
Actor: Clerk
Type: html
Triggers: add-policy-holder, update-policy-holder
ConsistsOf: policy-holder-view
`,
  });
  const model = buildModel(dir);
  const geo = computeGeometry(model);
  const table = renderTable(model, geo);
  const svg = renderArrows(model, geo);

  assert.match(table, /data-element="ui-policy-holder-screen--triggers-add-policy-holder"/);
  assert.match(table, /data-element="ui-policy-holder-screen--triggers-update-policy-holder"/);
  assert.match(table, /data-element="ui-policy-holder-screen--displays"/);
  assert.match(svg, /data-from="ui-policy-holder-screen--triggers-add-policy-holder" data-to="add-policy-holder"/);
  assert.match(svg, /data-from="ui-policy-holder-screen--triggers-update-policy-holder" data-to="update-policy-holder"/);
  assert.match(svg, /data-from="policy-holder-view" data-to="ui-policy-holder-screen--displays"/);
});

// ---------------------------------------------------------------------------
// buildModel / renderTable — read-model `{keyName}:Key` attribute
// ---------------------------------------------------------------------------

test('buildModel throws when a read model has neither {aggregateName}:Id nor {keyName}:Key|RowKey', () => {
  const dir = baseFixture({
    readmodels: `
## policy-holder-view
Name: Policy Holder View
Subscribes: policy-holder-added
* name
`,
  });
  assert.throws(
    () => buildModel(dir),
    /Read model\(s\) missing mandatory "\{aggregateName\}:Id" and\/or "\{keyName\}:Key\|RowKey" — policy-holder-view/
  );
});

test('buildModel allows a read model with only {keyName}:Key (no {aggregateName}:Id)', () => {
  const dir = baseFixture({
    readmodels: `
## policy-holder-view
Name: Policy Holder View
Subscribes: policy-holder-added
policyHolderId:Key
* name
* address
`,
  });
  assert.doesNotThrow(() => buildModel(dir));
});

test('buildModel allows a read model with only {keyName}:RowKey (no {aggregateName}:Id)', () => {
  const dir = baseFixture({
    readmodels: `
## issued-policies
Name: Issued Policies
Subscribes: policy-holder-added
policy:RowKey
* name
* address
`,
  });
  const model = buildModel(dir);
  const rm = model.readmodels.find((r) => r.id === 'issued-policies');
  assert.deepEqual(rm.keys, [{ name: 'policy', mode: 'RowKey' }]);
});

test('buildModel allows a read model with multiple {keyName}:Key lines', () => {
  const dir = baseFixture({
    readmodels: `
## policy-holder-view
Name: Policy Holder View
Subscribes: policy-holder-added
policyHolderId:Key
region:Key
* name
* address
`,
  });
  const model = buildModel(dir);
  const rm = model.readmodels.find((r) => r.id === 'policy-holder-view');
  assert.deepEqual(rm.keys, [
    { name: 'policyHolderId', mode: 'Key' },
    { name: 'region', mode: 'Key' },
  ]);
});

test('buildModel allows a read model with both {aggregateName}:Id and {keyName}:Key', () => {
  const dir = baseFixture({
    readmodels: `
## policy-holder-view
Name: Policy Holder View
Subscribes: policy-holder-added
policyHolder:Id
region:Key
* name
* address
`,
  });
  assert.doesNotThrow(() => buildModel(dir));
});

test('buildModel allows a read model with special :Id/:Key and normal field attributes with similar names', () => {
  // This tests the distinction between special :Id/:Key syntax and normal field attributes.
  // - policyHolder:Id renders as a bold identifier line under the title
  // - * policy holder id renders as a normal bullet point in the field list
  // Both can coexist in the same read model.
  // The normal field is a transformation of the special attribute name.
  const dir = baseFixture({
    readmodels: `
## policy-holder-view
Name: Policy Holder View
Subscribes: policy-holder-added
policyHolder:Id
region:Key
* policy holder id
* name
* address
`,
  });
  const model = buildModel(dir);
  const rm = model.readmodels.find((r) => r.id === 'policy-holder-view');
  // Special attributes are parsed separately
  assert.equal(rm.aggregateId, 'policyHolder');
  assert.deepEqual(rm.keys, [{ name: 'region', mode: 'Key' }]);
  // Normal field attributes are parsed as fields
  assert.deepEqual(rm.fields, ['policy holder id', 'name', 'address']);
});

test('renderTable renders special :Id/:Key as bold lines and normal field attributes as bullet points', () => {
  const dir = baseFixture({
    readmodels: `
## policy-holder-view
Name: Policy Holder View
Subscribes: policy-holder-added
policyHolder:Id
region:Key
* policy holder id
* name
`,
  });
  const model = buildModel(dir);
  const geo = computeGeometry(model);
  const html = renderTable(model, geo);
  
  // Special :Id/:Key lines are rendered as bold .agg-id divs
  assert.match(html, /<div class="agg-id">policyHolder:Id<\/div>/);
  assert.match(html, /<div class="agg-id">region:Key<\/div>/);
  
  // Normal field attributes are rendered as bullet points
  assert.match(html, /<li>policy holder id<\/li>/);
  assert.match(html, /<li>name<\/li>/);
});

test('renderTable renders a {keyName}:RowKey line with its own suffix (never normalised to :Key)', () => {
  const dir = baseFixture({
    readmodels: `
## issued-policies
Name: Issued Policies
Subscribes: policy-holder-added
policy:RowKey
* name
`,
  });
  const model = buildModel(dir);
  const geo = computeGeometry(model);
  const html = renderTable(model, geo);
  assert.match(html, /<div class="agg-id">policy:RowKey<\/div>/);
  assert.doesNotMatch(html, /policy:Key/);
});

test('renderTable stacks {aggregateName}:Id then {keyName}:Key lines (in written order) as separate .agg-id divs, and grows card height 14px per line', () => {
  const dirIdOnly = baseFixture(); // base fixture's readmodel has only {keyName}:Key
  const modelIdOnly = buildModel(dirIdOnly);
  const rmIdOnly = modelIdOnly.readmodels.find((r) => r.id === 'policy-holder-view');
  // base fixture: policyHolderId:Key + 2 fields -> VIEW_H(60) + 14*1 + fields(10+2*14)=38 => 60+14+38=112
  assert.equal(rmIdOnly._h, 60 + 14 + (10 + 2 * 14));

  const dir = baseFixture({
    readmodels: `
## policy-holder-view
Name: Policy Holder View
Subscribes: policy-holder-added
policyHolder:Id
region:Key
customerId:Key
* name
* address
`,
  });
  const model = buildModel(dir);
  const geo = computeGeometry(model);
  const rm = model.readmodels.find((r) => r.id === 'policy-holder-view');
  // 3 identifying lines (id + 2 keys) -> +14*3 vs base VIEW_H, plus fields block
  assert.equal(rm._h, 60 + 14 * 3 + (10 + 2 * 14));

  const html = renderTable(model, geo);
  const cardMatch = html.match(/<div class="card view-card"[^>]*>([\s\S]*?)<\/div>\s*<\/td>/);
  assert.ok(cardMatch, 'expected to find the read-model card html');
  const cardHtml = cardMatch[1];
  const aggIdDivs = [...cardHtml.matchAll(/<div class="agg-id">(.*?)<\/div>/g)].map((m) => m[1]);
  assert.deepEqual(aggIdDivs, ['policyHolder:Id', 'region:Key', 'customerId:Key']);
});

// ---------------------------------------------------------------------------
// GWT (Given-When-Then) functionality
// ---------------------------------------------------------------------------

test('parseGwtContent parses a GWT file with multiple scenarios', () => {
  const content = `
# GWT: Policy Status

## Scenario 1: Active Policy
**Given** a policy exists with status "active"
**When** the policy holder requests a status update
**Then** the system returns "active" status

## Scenario 2: Cancelled Policy
**Given** a policy exists with status "cancelled"
**When** the policy holder requests a status update
**Then** the system returns "cancelled" status
`;
  const gwt = parseGwtContent(content, 'policy-status');
  assert.equal(gwt.title, 'GWT: Policy Status');
  assert.equal(gwt.scenarios.length, 2);
  assert.equal(gwt.scenarios[0].name, 'Scenario 1: Active Policy');
  assert.deepEqual(gwt.scenarios[0].given, ['a policy exists with status "active"']);
  assert.deepEqual(gwt.scenarios[0].when, ['the policy holder requests a status update']);
  assert.deepEqual(gwt.scenarios[0].then, ['the system returns "active" status']);
  assert.equal(gwt.scenarios[1].name, 'Scenario 2: Cancelled Policy');
  assert.deepEqual(gwt.scenarios[1].given, ['a policy exists with status "cancelled"']);
});

test('parseGwtContent handles empty GWT file', () => {
  const content = '# Empty GWT\n';
  const gwt = parseGwtContent(content, 'test-model');
  assert.equal(gwt.title, 'Empty GWT');
  assert.equal(gwt.scenarios.length, 0);
});

test('parseGwtContent handles GWT file with no title', () => {
  const content = `
## Scenario 1: Test
**Given** something
**When** action
**Then** result
`;
  const gwt = parseGwtContent(content, 'test-model');
  assert.equal(gwt.title, 'GWT: test-model');
  assert.equal(gwt.scenarios.length, 1);
});

test('parseGwtContent parses GWT file with colon format (given:/when:/then:)', () => {
  const content = `
# Given When Then

## when issue policy then policy number has next ordinal
given:
- policy holder
- policy coverage

when:
- issue policy command is executed

then:
- policy number has next ordinal
`;
  const gwt = parseGwtContent(content, 'policy-document');
  assert.equal(gwt.title, 'Given When Then');
  assert.equal(gwt.scenarios.length, 1);
  assert.equal(gwt.scenarios[0].name, 'when issue policy then policy number has next ordinal');
  assert.deepEqual(gwt.scenarios[0].given, ['policy holder', 'policy coverage']);
  assert.deepEqual(gwt.scenarios[0].when, ['issue policy command is executed']);
  assert.deepEqual(gwt.scenarios[0].then, ['policy number has next ordinal']);
});

test('parseGwtContent parses GWT file with optional given section', () => {
  const content = `
# Given When Then

## when issue policy then policy number has next ordinal
given:
issue policy
issue policy

then:
policy number has next ordinal
`;
  const gwt = parseGwtContent(content, 'policy-document');
  assert.equal(gwt.title, 'Given When Then');
  assert.equal(gwt.scenarios.length, 1);
  assert.equal(gwt.scenarios[0].name, 'when issue policy then policy number has next ordinal');
  assert.deepEqual(gwt.scenarios[0].given, ['issue policy', 'issue policy']);
  assert.deepEqual(gwt.scenarios[0].when, []);
  assert.deepEqual(gwt.scenarios[0].then, ['policy number has next ordinal']);
});

test('discoverGwtFiles finds GWT files for read models', () => {
  const gwtContent = `
# GWT: Policy Status

## Scenario 1: Active Policy
**Given** a policy exists with status "active"
**When** the policy holder requests a status update
**Then** the system returns "active" status
`;
  const dir = baseFixture({
    readmodels: `
## policy-holder-view
Name: Policy Holder View
Subscribes: policy-holder-added
policyHolderId:Key
* name
* address

## policy-status
Name: Policy Status
Subscribes: policy-holder-added
policyId:Key
* status
`,
  });
  // Create GWT file for policy-status only
  fs.writeFileSync(path.join(dir, 'gwt-policy-status.md'), gwtContent);

  const readmodelIds = ['policy-holder-view', 'policy-status'];
  const gwtData = discoverGwtFiles(dir, readmodelIds);

  assert.equal(Object.keys(gwtData).length, 1);
  assert.ok(gwtData['policy-status']);
  assert.equal(gwtData['policy-status'].title, 'GWT: Policy Status');
  assert.equal(gwtData['policy-status'].scenarios.length, 1);
  assert.equal(gwtData['policy-holder-view'], undefined);
});

test('discoverGwtFiles returns empty object when no GWT files exist', () => {
  const dir = baseFixture();
  const readmodelIds = ['policy-holder-view'];
  const gwtData = discoverGwtFiles(dir, readmodelIds);
  assert.deepEqual(gwtData, {});
});

test('buildModel attaches GWT data to read models', () => {
  const gwtContent = `
# GWT: Policy Holder View

## Scenario 1: View Policy Holder
**Given** a policy holder exists
**When** the clerk views the policy holder
**Then** the system displays the policy holder details
`;
  const dir = baseFixture();
  fs.writeFileSync(path.join(dir, 'gwt-policy-holder-view.md'), gwtContent);

  const model = buildModel(dir);
  const rm = model.readmodels.find((r) => r.id === 'policy-holder-view');

  assert.ok(rm.gwt);
  assert.equal(rm.gwt.title, 'GWT: Policy Holder View');
  assert.equal(rm.gwt.scenarios.length, 1);
  assert.equal(rm.gwt.scenarios[0].name, 'Scenario 1: View Policy Holder');
});

test('buildModel sets gwt to null when no GWT file exists', () => {
  const dir = baseFixture();
  const model = buildModel(dir);
  const rm = model.readmodels.find((r) => r.id === 'policy-holder-view');
  assert.equal(rm.gwt, null);
});

test('renderTable adds GWT badge for read models with GWT files', () => {
  const gwtContent = `
# GWT: Policy Holder View

## Scenario 1: Test
**Given** something
**When** action
**Then** result
`;
  const dir = baseFixture();
  fs.writeFileSync(path.join(dir, 'gwt-policy-holder-view.md'), gwtContent);

  const model = buildModel(dir);
  const geo = computeGeometry(model);
  const html = renderTable(model, geo);

  // Check that GWT badge is present for the read model
  assert.match(html, /<div class="gwt-badge" data-gwt="policy-holder-view" title="Click to view GWT scenarios">GWT<\/div>/);
});

test('renderTable does not add GWT badge for read models without GWT files', () => {
  const dir = baseFixture();
  const model = buildModel(dir);
  const geo = computeGeometry(model);
  const html = renderTable(model, geo);

  // Check that no GWT badge is present
  assert.doesNotMatch(html, /gwt-badge/);
});

test('renderPage includes GWT modal HTML and GWT data script', () => {
  const gwtContent = `
# GWT: Policy Holder View

## Scenario 1: Test
**Given** something
**When** action
**Then** result
`;
  const dir = baseFixture();
  fs.writeFileSync(path.join(dir, 'gwt-policy-holder-view.md'), gwtContent);

  const model = buildModel(dir);
  const geo = computeGeometry(model);
  const tableHtml = renderTable(model, geo);
  const arrowsHtml = renderArrows(model, geo);
  const pageHtml = renderPage(model, geo, tableHtml, arrowsHtml);

  // Check that GWT modal HTML is present
  assert.match(pageHtml, /<div class="gwt-modal" id="gwt-modal">/);
  assert.match(pageHtml, /<div class="gwt-modal-content">/);
  assert.match(pageHtml, /<button class="gwt-modal-close" id="gwt-modal-close">/);

  // Check that GWT data is included in the script
  assert.match(pageHtml, /var GWT_DATA = \{/);
  assert.match(pageHtml, /"policy-holder-view":\{/);
  assert.match(pageHtml, /"title":"GWT: Policy Holder View"/);
});

test('renderPage includes GWT modal CSS styles', () => {
  const dir = baseFixture();
  const model = buildModel(dir);
  const geo = computeGeometry(model);
  const tableHtml = renderTable(model, geo);
  const arrowsHtml = renderArrows(model, geo);
  const pageHtml = renderPage(model, geo, tableHtml, arrowsHtml);

  // Check that GWT-related CSS styles are present
  assert.match(pageHtml, /\.gwt-badge\{/);
  assert.match(pageHtml, /\.gwt-modal\{/);
  assert.match(pageHtml, /\.gwt-modal-content\{/);
  assert.match(pageHtml, /\.gwt-scenario\{/);
});

// ---------------------------------------------------------------------------
// Interactivity (reference/interactivity.js) — upstream focus filter
// ---------------------------------------------------------------------------

/*
 * Loads reference/interactivity.js in a vm sandbox against a minimal fake DOM
 * built from a list of cards and arrows, then returns a helper to click a card
 * and read back which cards survived the filter (the visible set passed to
 * the EM_RENDER stub). Filtering HIDES non-connected cards entirely.
 */
function loadInteractivity({ cards, arrows }) {
  const vm = require('node:vm');
  const scrollCalls = [];
  let lastVisible = [...cards]; // EM_RENDER(null) = everything visible

  const mkNode = (attrs) => {
    const classes = new Set();
    const handlers = {};
    const capturedPointers = new Set();
    return {
      _attrs: attrs,
      classList: {
        toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c),
      },
      has: (c) => classes.has(c),
      getAttribute: (k) => (k in attrs ? attrs[k] : null),
      addEventListener: function (ev, fn) {
        (handlers[ev] ||= []).push(fn);
      },
      dispatch: function (ev, event = {}) {
        const fullEvent = {
          stopPropagation() {},
          preventDefault() {},
          target: this,
          ...event,
        };
        (handlers[ev] || []).forEach((fn) => fn.call(this, fullEvent));
      },
      click: function () { this.dispatch('click'); },
      closest: () => null,
      setPointerCapture: (id) => capturedPointers.add(id),
      hasPointerCapture: (id) => capturedPointers.has(id),
      releasePointerCapture: (id) => capturedPointers.delete(id),
    };
  };

  const cardNodes = cards.map((id) => {
    const n = mkNode({ 'data-element': id });
    // Delegated clicks resolve the card via e.target.closest('.card').
    n.closest = (sel) => (sel === '.card' ? n : null);
    return n;
  });
  const arrowNodes = arrows.map(([from, to, kind]) =>
    mkNode({ 'data-from': from, 'data-to': to, 'data-kind': kind }));

  // interactivity.js binds its delegated listeners on document.querySelector
  // ('.wrap') — the stub returns `noop`, so that IS the wrap node here.
  const noop = mkNode({});
  const wrap = noop;
  const document = {
    querySelectorAll(sel) {
      if (sel === '.card') return cardNodes;
      if (sel === '[data-from]') return arrowNodes;
      return [];
    },
    querySelector() { return noop; },
    getElementById() { return noop; },
    addEventListener() {},
  };

  // The browser glue calls EM_RENDER(visibleIdsOrNull) on every filter
  // change; the stub records the surviving card ids instead of re-rendering.
  function EM_RENDER(visibleIds) {
    lastVisible = visibleIds ? cards.filter((c) => visibleIds[c]) : [...cards];
  }

  const src = fs.readFileSync(
    path.join(__dirname, '..', 'reference', 'interactivity.js'), 'utf8');
  vm.runInNewContext(src, {
    document,
    EM_RENDER,
    window: {
      scrollBy(x, y) { scrollCalls.push([x, y]); },
    },
  });

  const visibleNow = () => [...lastVisible].sort();
  return {
    clickCard(id) {
      wrap.dispatch('click', { target: cardNodes[cards.indexOf(id)] });
      return { visible: visibleNow(), hidden: cards.filter((c) => !lastVisible.includes(c)).sort() };
    },
    clickBackground() {
      wrap.dispatch('click', { target: noop });
      return visibleNow();
    },
    dragBackground(from, to) {
      const pointerId = 1;
      wrap.dispatch('pointerdown', {
        button: 0,
        pointerId,
        clientX: from.x,
        clientY: from.y,
        target: { closest: () => null },
      });
      wrap.dispatch('pointermove', {
        pointerId,
        clientX: to.x,
        clientY: to.y,
      });
      wrap.dispatch('pointerup', { pointerId });
      wrap.dispatch('click', { target: noop });
      return {
        scrollCalls: [...scrollCalls],
        isPanning: wrap.has('is-panning'),
        visible: visibleNow(),
      };
    },
  };
}

/*
 * Fixture shaped like a real diagram containing BOTH kinds of UI card:
 *
 *   issue-policy(UI) --triggers--> issue-policy(cmd) --produces--> policy-issued(evt)
 *   policy-issued(evt) --observes--> policy-details(rm) --displays--> policy-details(UI)
 *   unrelated-view(rm) --displays--> issue-policy(UI)
 */
const INTERACTIVITY_FIXTURE = {
  cards: ['ui-issue-policy', 'cmd-issue-policy', 'evt-policy-issued',
          'rm-policy-details', 'ui-policy-details', 'rm-unrelated'],
  arrows: [
    ['ui-issue-policy', 'cmd-issue-policy', 'triggers'],
    ['cmd-issue-policy', 'evt-policy-issued', 'produces'],
    ['evt-policy-issued', 'rm-policy-details', 'observes'],
    ['rm-policy-details', 'ui-policy-details', 'displays'],
    ['rm-unrelated', 'ui-issue-policy', 'displays'],
  ],
};

test('clicking an output UI keeps its upstream chain visible (unrelated cards hidden)', () => {
  const dom = loadInteractivity(INTERACTIVITY_FIXTURE);
  const { visible, hidden } = dom.clickCard('ui-policy-details');

  // One-hop downstream from output UI: the read model it displays.
  assert.deepEqual(visible, [
    'rm-policy-details',
    'ui-policy-details',
  ].sort());

  // ...and only the genuinely unrelated cards are hidden.
  assert.deepEqual(hidden, [
    'cmd-issue-policy',
    'evt-policy-issued',
    'ui-issue-policy',
    'rm-unrelated',
  ].sort());
});

test('a read model shows its one-hop upstream event and downstream output UI', () => {
  const dom = loadInteractivity(INTERACTIVITY_FIXTURE);
  const { visible } = dom.clickCard('rm-policy-details');

  // One-hop upstream: the event it subscribes to.
  // One-hop downstream: the output UI it feeds.
  assert.deepEqual(visible, [
    'evt-policy-issued',
    'rm-policy-details',
    'ui-policy-details',
  ].sort());
});

test('clicking an input UI shows its one-hop downstream command', () => {
  const dom = loadInteractivity(INTERACTIVITY_FIXTURE);
  const { visible } = dom.clickCard('ui-issue-policy');

  // One-hop downstream: the command it triggers.
  // One-hop upstream: rm-unrelated (via "displays" edge into this UI).
  assert.deepEqual(visible, [
    'cmd-issue-policy',
    'rm-unrelated',
    'ui-issue-policy',
  ].sort());
});

test('dragging the diagram background pans without clearing the current focus', () => {
  const dom = loadInteractivity(INTERACTIVITY_FIXTURE);
  const focused = dom.clickCard('rm-policy-details').visible;
  const result = dom.dragBackground({ x: 120, y: 80 }, { x: 75, y: 65 });

  assert.deepEqual(result.scrollCalls, [[45, 15]]);
  assert.equal(result.isPanning, false);
  assert.deepEqual(result.visible, focused);
});

test('clicking the diagram background without dragging still clears focus', () => {
  const dom = loadInteractivity(INTERACTIVITY_FIXTURE);
  dom.clickCard('rm-policy-details');

  assert.deepEqual(dom.clickBackground().sort(), INTERACTIVITY_FIXTURE.cards.sort());
});

test('clicking a command fed by a fan-out UI shows only its visual UI copy', () => {
  const fixture = {
    cards: [
      'ui-shared--triggers-cmd-a',
      'ui-shared--triggers-cmd-b',
      'ui-shared--displays',
      'cmd-a',
      'cmd-b',
      'evt-a',
      'evt-b',
      'rm-shared',
    ],
    arrows: [
      ['ui-shared--triggers-cmd-a', 'cmd-a', 'triggers'],
      ['ui-shared--triggers-cmd-b', 'cmd-b', 'triggers'],
      ['cmd-a', 'evt-a', 'produces'],
      ['cmd-b', 'evt-b', 'produces'],
      ['evt-a', 'rm-shared', 'observes'],
      ['evt-b', 'rm-shared', 'observes'],
      ['rm-shared', 'ui-shared--displays', 'displays'],
    ],
  };
  const dom = loadInteractivity(fixture);

  assert.deepEqual(dom.clickCard('cmd-a').visible, [
    'cmd-a',
    'evt-a',
    'ui-shared--triggers-cmd-a',
  ].sort());
});

test('clicking one fan-out UI copy follows only that copy command slice', () => {
  const fixture = {
    cards: [
      'ui-shared--triggers-cmd-a',
      'ui-shared--triggers-cmd-b',
      'cmd-a',
      'cmd-b',
      'evt-a',
      'evt-b',
      'rm-a',
      'rm-b',
    ],
    arrows: [
      ['ui-shared--triggers-cmd-a', 'cmd-a', 'triggers'],
      ['ui-shared--triggers-cmd-b', 'cmd-b', 'triggers'],
      ['cmd-a', 'evt-a', 'produces'],
      ['cmd-b', 'evt-b', 'produces'],
      ['evt-a', 'rm-a', 'observes'],
      ['evt-b', 'rm-b', 'observes'],
    ],
  };
  const dom = loadInteractivity(fixture);

  assert.deepEqual(dom.clickCard('ui-shared--triggers-cmd-a').visible, [
    'cmd-a',
    'ui-shared--triggers-cmd-a',
  ].sort());
});

// ---------------------------------------------------------------------------
// Translation Pattern (external-events.md + translators.md)
// ---------------------------------------------------------------------------

// A consistent fixture with one external event, one translator feeding the
// existing add-policy-holder command, and the usual UI/read model.
function translationFixture(overrides = {}) {
  const commands = overrides.commands !== undefined ? overrides.commands : `
## add-policy-holder
Name: Add Policy Holder
Produces: policy-holder-added
* name
* address
`;
  const events = overrides.events !== undefined ? overrides.events : `
## policy-holder-added
Name: Policy Holder Added
policyHolder:Id
* name
* address
`;
  const readmodels = overrides.readmodels !== undefined ? overrides.readmodels : `
## policy-holder-view
Name: Policy Holder View
Subscribes: policy-holder-added
policyHolderId:Key
* name
* address
`;
  const uis = overrides.uis !== undefined ? overrides.uis : `
## add-policy-holder
Name: Add Policy Holder Form
Actor: Clerk
Type: html
`;
  const externalEvents = overrides.externalEvents !== undefined ? overrides.externalEvents : `
## application-received
Name: Application Received
System name: Underwriter Portal
* application id
`;
  const translators = overrides.translators !== undefined ? overrides.translators : `
## translate-application
Name: Translate Application
Subscribes: application-received
Produces: add-policy-holder
`;
  return makeFixtureDir({
    'commands.md': commands,
    'events.md': events,
    'readmodels.md': readmodels,
    'uis.md': uis,
    'external-events.md': externalEvents,
    'translators.md': translators,
  });
}

test('parseMdText parses an external-events.md-shaped entry with "System name:" and optional :Id/fields', () => {
  const items = parseMdText(`
## application-received
Name: Application Received
System name: Underwriter Portal
applicationId:Id
* application id
`);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'application-received');
  assert.equal(items[0].name, 'Application Received');
  assert.equal(items[0].systemName, 'Underwriter Portal');
  assert.equal(items[0].aggregateId, 'applicationId');
  assert.deepEqual(items[0].fields, ['application id']);
});

test('parseMdText parses an external event with NO :Id (external contract — not mandatory)', () => {
  const items = parseMdText(`
## application-received
Name: Application Received
System name: Underwriter Portal
`);
  assert.equal(items.length, 1);
  assert.equal(items[0].aggregateId, undefined);
});

test('parseMdText parses a translators.md-shaped entry (Subscribes external events, Produces commands)', () => {
  const items = parseMdText(`
## translate-application
Name: Translate Application
Subscribes: application-received
Produces: add-policy-holder
`);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'translate-application');
  assert.deepEqual(items[0].subscribes, ['application-received']);
  assert.deepEqual(items[0].produces, ['add-policy-holder']);
  assert.equal(items[0].typeHint, undefined);
});

test('parseMdText parses an optional free-form Type: on a translator (value can be anything)', () => {
  const items = parseMdText(`
## translate-application
Name: Translate Application
Type: underwriter-sync-bot
Subscribes: application-received
Produces: add-policy-holder
`);
  assert.equal(items.length, 1);
  assert.equal(items[0].typeHint, 'underwriter-sync-bot');

  // Value is unconstrained — no enum, any non-empty string is accepted as-is.
  const arbitrary = parseMdText(`
## t
Type: anything at all / 42 — bespoke
Subscribes: application-received
Produces: add-policy-holder
`);
  assert.equal(arbitrary[0].typeHint, 'anything at all / 42 — bespoke');
});

test('buildModel accepts external events and translators and inserts ext columns left of the fed command', () => {
  const dir = translationFixture();
  const model = buildModel(dir);
  assert.equal(model.externalEvents.length, 1);
  assert.equal(model.translators.length, 1);
  assert.equal(model.hasBots, true);
  assert.deepEqual(model.externalSystems, ['Underwriter Portal']);
  // The external event column is strictly left of the command it feeds
  // (add-policy-holder lives at its primary produced event policy-holder-added).
  const extIdx = model.columns.findIndex((c) => c.type === 'ext' && c.extId === 'application-received');
  assert.notEqual(extIdx, -1);
  const cmdIdx = model.columns.findIndex((c) => c.type === 'event' && c.eventId === 'policy-holder-added');
  assert.ok(extIdx < cmdIdx, `ext column ${extIdx} should be left of command column ${cmdIdx}`);
  assert.equal(model.translatorBoxes.length, 1);
  assert.equal(model.translatorBoxes[0].cmdId, 'add-policy-holder');
  assert.equal(model.translatorBoxes[0].colIdx, cmdIdx);
});

test('buildModel defaults the external system name to "External" when System name: is missing', () => {
  const dir = translationFixture({
    externalEvents: `
## application-received
Name: Application Received
* application id
`,
  });
  const model = buildModel(dir);
  assert.deepEqual(model.externalSystems, ['External']);
});

test('buildModel throws when a translator subscribes an unknown external event', () => {
  const dir = translationFixture({
    translators: `
## translate-application
Name: Translate Application
Subscribes: does-not-exist
Produces: add-policy-holder
`,
  });
  assert.throws(
    () => buildModel(dir),
    /Translator "translate-application" subscribes to unknown external event "does-not-exist"/,
  );
});

test('buildModel throws when a translator produces an unknown command', () => {
  const dir = translationFixture({
    translators: `
## translate-application
Name: Translate Application
Subscribes: application-received
Produces: does-not-exist
`,
  });
  assert.throws(
    () => buildModel(dir),
    /Translator "translate-application" produces unknown command "does-not-exist"/,
  );
});

test('buildModel throws when a translator subscribes to nothing (no Subscribes:)', () => {
  const dir = translationFixture({
    translators: `
## translate-application
Name: Translate Application
Produces: add-policy-holder
`,
  });
  assert.throws(
    () => buildModel(dir),
    /Translator "translate-application" subscribes to no external event/,
  );
});

test('buildModel throws when a translator produces nothing (no Produces:)', () => {
  const dir = translationFixture({
    translators: `
## translate-application
Name: Translate Application
Subscribes: application-received
`,
  });
  assert.throws(
    () => buildModel(dir),
    /Translator "translate-application" produces no command/,
  );
});

test('buildModel throws when an external event has no translator subscribing it (orphan external event)', () => {
  const dir = translationFixture({
    externalEvents: `
## application-received
Name: Application Received
System name: Underwriter Portal

## another-external-event
Name: Another External Event
System name: Other System
`,
  });
  assert.throws(
    () => buildModel(dir),
    /External event\(s\) with no translator subscribing them — another-external-event/,
  );
});

test('buildModel throws when an external event id collides with an internal event id', () => {
  const dir = translationFixture({
    externalEvents: `
## policy-holder-added
Name: Colliding
System name: Underwriter Portal
`,
    translators: `
## translate-application
Name: Translate Application
Subscribes: policy-holder-added
Produces: add-policy-holder
`,
  });
  assert.throws(
    () => buildModel(dir),
    /External event id\(s\) collide with internal events — policy-holder-added/,
  );
});

test('buildModel allows an external event with no :Id (mandatory-aggregate-id check does not apply to external events)', () => {
  const dir = translationFixture(); // external fixture has no application-received :Id
  const model = buildModel(dir);
  assert.equal(model.externalEvents[0].aggregateId, undefined);
});

test('buildModel fan-out: one translator producing several commands gets one box per produced command', () => {
  const dir = translationFixture({
    commands: `
## add-policy-holder
Name: Add Policy Holder
Produces: policy-holder-added
* name

## add-address
Name: Add Address
Produces: address-added
* address
`,
    events: `
## policy-holder-added
Name: Policy Holder Added
policyHolder:Id
* name

## address-added
Name: Address Added
policyHolder:Id
* address
`,
    readmodels: `
## policy-holder-view
Name: Policy Holder View
Subscribes: policy-holder-added
policyHolderId:Key
* name
`,
    translators: `
## sync-address
Name: Sync Address
Subscribes: application-received
Produces: add-policy-holder, add-address
`,
  });
  const model = buildModel(dir);
  assert.equal(model.translatorBoxes.length, 2);
  assert.deepEqual(model.translatorBoxes.map((b) => b.cmdId).sort(), ['add-address', 'add-policy-holder']);
});

test('buildModel fan-in: several translators subscribing the same external event both get a box', () => {
  const dir = translationFixture({
    translators: `
## translate-application
Name: Translate Application
Subscribes: application-received
Produces: add-policy-holder

## second-translator
Name: Second Translator
Subscribes: application-received
Produces: add-policy-holder
`,
  });
  const model = buildModel(dir);
  assert.equal(model.translatorBoxes.length, 2);
});

test('renderTable renders the Bots row, translator cards with sprocket badge, and external-system lanes', () => {
  const dir = translationFixture();
  const model = buildModel(dir);
  const geo = computeGeometry(model);
  const html = renderTable(model, geo);
  assert.match(html, /class="gutter bots-gutter">Bots</);
  assert.match(html, /class="card tr-card"/);
  assert.match(html, /class="tr-badge">⚙</);
  assert.match(html, /data-element="tr-translate-application--cmd-add-policy-holder"/);
  assert.match(html, /Underwriter Portal/);
  assert.match(html, /class="card ext-card"/);
  assert.match(html, /data-element="ext-application-received"/);
  // External event card must NOT show a mandatory :Id line (none declared)
  assert.match(html, /data-element="ext-application-received"/);
  // No Type: declared on the fixture translator -> no type label rendered
  assert.doesNotMatch(html, /class="card tr-card"[^>]*>\s*<div class="tr-badge">⚙<\/div>\s*<div class="ui-label">/);
});

test('renderTable shows the translator free-form Type: as an uppercase label (and grows the card to fit)', () => {
  const dir = translationFixture({
    translators: `
## translate-application
Name: Translate Application
Type: underwriter-sync-bot
Subscribes: application-received
Produces: add-policy-holder
`,
  });
  const model = buildModel(dir);
  const geo = computeGeometry(model);
  const html = renderTable(model, geo);
  // Rendered as the same small uppercase label UI cards use
  assert.match(html, /class="ui-label">UNDERWRITER-SYNC-BOT</);
  // Card height grows by TR_TYPE_H (12) to fit the label line
  const withoutType = buildModel(translationFixture()).translators[0];
  const withType = model.translators[0];
  assert.equal(withType._h, withoutType._h + 12);
});

test('renderTable keeps the translator sprocket badge when a Type: label is also shown', () => {
  const dir = translationFixture({
    translators: `
## translate-application
Name: Translate Application
Type: api
Subscribes: application-received
Produces: add-policy-holder
`,
  });
  const model = buildModel(dir);
  const html = renderTable(model, computeGeometry(model));
  assert.match(html, /class="tr-badge">⚙</);
  assert.match(html, /class="ui-label">API</);
});

test('renderArrows tags external-event → translator edges as "translates" and translator → command as "translates-cmd"', () => {
  const dir = translationFixture();
  const model = buildModel(dir);
  const geo = computeGeometry(model);
  const svg = renderArrows(model, geo);
  assert.match(svg, /data-kind="translates"/);
  assert.match(svg, /data-kind="translates-cmd"/);
  assert.match(svg, /data-from="ext-application-received"/);
  assert.match(svg, /data-to="tr-translate-application--cmd-add-policy-holder"/);
});

test('computeGeometry reserves a Bots row and external-system lanes (height grows with both)', () => {
  const dir = translationFixture();
  const model = buildModel(dir);
  const geo = computeGeometry(model);
  assert.ok(geo.botsH > 0);
  assert.equal(geo.extSysHeights.length, 1);
  assert.ok(geo.height > geo.extTop); // external lanes add height at the bottom
});

test('interactivity: clicking an external event shows its one-hop downstream (the translator)', () => {
  const fixture = {
    cards: [
      'ext-application-received',
      'tr-translate-application--cmd-add-policy-holder',
      'add-policy-holder',
      'policy-holder-added',
      'policy-holder-view',
    ],
    arrows: [
      ['ext-application-received', 'tr-translate-application--cmd-add-policy-holder', 'translates'],
      ['tr-translate-application--cmd-add-policy-holder', 'add-policy-holder', 'translates-cmd'],
      ['add-policy-holder', 'policy-holder-added', 'produces'],
      ['policy-holder-added', 'policy-holder-view', 'observes'],
    ],
  };
  const dom = loadInteractivity(fixture);
  assert.deepEqual(dom.clickCard('ext-application-received').visible, [
    'ext-application-received',
    'tr-translate-application--cmd-add-policy-holder',
  ].sort());
});

test('interactivity: clicking a translator shows its one-hop upstream (ext event) and downstream (command)', () => {
  const fixture = {
    cards: [
      'ext-application-received',
      'tr-translate-application--cmd-add-policy-holder',
      'add-policy-holder',
      'policy-holder-added',
      'policy-holder-view',
    ],
    arrows: [
      ['ext-application-received', 'tr-translate-application--cmd-add-policy-holder', 'translates'],
      ['tr-translate-application--cmd-add-policy-holder', 'add-policy-holder', 'translates-cmd'],
      ['add-policy-holder', 'policy-holder-added', 'produces'],
      ['policy-holder-added', 'policy-holder-view', 'observes'],
    ],
  };
  const dom = loadInteractivity(fixture);
  assert.deepEqual(dom.clickCard('tr-translate-application--cmd-add-policy-holder').visible, [
    'add-policy-holder',
    'ext-application-received',
    'tr-translate-application--cmd-add-policy-holder',
  ].sort());
});

// ---------------------------------------------------------------------------
// Responsive filtering (visibility-aware layout — placeCards registry)
// ---------------------------------------------------------------------------

const LAYOUT = require('./layout.js');

function idsIn(html) {
  return [...html.matchAll(/data-element="([^"]*)"/g)].map((m) => m[1]).sort();
}

test('placeCards registry matches renderTable 1:1 (every card drawn is registered, with its height)', () => {
  const dir = translationFixture();
  const model = buildModel(dir);
  const geo = computeGeometry(model);
  const html = renderTable(model, geo);
  const registry = LAYOUT.placeCards(model);
  assert.deepEqual(registry.map((c) => c.id).sort(), idsIn(html));
  registry.forEach((c) => {
    const card = new RegExp(`data-element="${c.id}"[^>]*style="height:${c.h}px"|style="height:${c.h}px"[^>]*data-element="${c.id}"`);
    // every registered size must be the size actually rendered
    assert.ok(c.w > 0 && c.h > 0, `${c.id} has a real box size`);
    if (c.kind !== 'ui' && c.kind !== 'standalone-ui') {
      assert.ok(card.test(html), `${c.id} renders at height ${c.h}px`);
    }
  });
});

test('a hidden card leaves the table entirely — and so do arrows with a hidden endpoint', () => {
  const dir = translationFixture();
  const model = buildModel(dir);
  const visible = new Set(['add-policy-holder', 'policy-holder-added']);
  const { html } = LAYOUT.wrapInnerHtml(model, visible);
  assert.ok(!html.includes('data-element="policy-holder-view"'), 'hidden read model is gone');
  assert.ok(!html.includes('data-element="tr-translate-application--cmd-add-policy-holder"'), 'hidden translator is gone');
  assert.ok(html.includes('data-element="add-policy-holder"'), 'visible command stays');
  assert.ok(html.includes('data-element="policy-holder-added"'), 'visible event stays');
  // arrows: cmd -> evt survives; evt -> view and ext -> tr are gone
  assert.ok(html.includes('data-from="add-policy-holder" data-to="policy-holder-added"'));
  assert.ok(!html.includes('data-to="policy-holder-view"'), 'arrow into hidden read model is gone');
  assert.ok(!html.includes('data-to="tr-translate-application--cmd-add-policy-holder"'), 'arrow into hidden translator is gone');
});

test('columns without visible cards collapse to zero width and later columns shift left', () => {
  const dir = translationFixture();
  const model = buildModel(dir);
  const full = LAYOUT.wrapInnerHtml(model, null);
  const visible = new Set(['add-policy-holder', 'policy-holder-added']);
  const filtered = LAYOUT.wrapInnerHtml(model, visible);
  // 3 columns unfiltered (ext + event + view); only the event column survives
  assert.equal(full.geo.width - filtered.geo.width, 2 * LAYOUT.COL);
  assert.equal(filtered.geo.colActive.filter(Boolean).length, 1);
  // the surviving column is centered where column 0 lives, not column 1
  const evtCol = LAYOUT.colIndexForEvent(model, 'policy-holder-added');
  assert.equal(filtered.geo.colCenterX(evtCol), LAYOUT.GUT + LAYOUT.COL / 2);
  // table colgroup must zero out the collapsed columns (no gaps)
  const zeroCols = (filtered.html.match(/<col style="width:0px">/g) || []).length;
  assert.equal(zeroCols, 2);
});

test('rows without visible cards drop out of the table and row heights re-fit to the tallest visible card', () => {
  const dir = translationFixture();
  const model = buildModel(dir);
  // Give the read model many fields so the mid row is tall; hiding it must
  // shrink the mid row to the command's height.
  const rm = model.readmodels.find((r) => r.id === 'policy-holder-view');
  const cmd = model.commands.find((c) => c.id === 'add-policy-holder');
  const full = LAYOUT.wrapInnerHtml(model, null);
  assert.ok(full.geo.midRowH > LAYOUT.rowHeightFor(cmd._h, LAYOUT.MID_H), 'read model makes the row tall');
  // Hide everything but the command (mid row keeps one short card) + its UI.
  const visible = new Set(['add-policy-holder', 'ui-add-policy-holder--triggers-add-policy-holder']);
  const filtered = LAYOUT.wrapInnerHtml(model, visible);
  assert.equal(filtered.geo.midRowH, LAYOUT.rowHeightFor(cmd._h, LAYOUT.MID_H), 'mid row re-fits to the visible card');
  assert.ok(!filtered.html.includes('policy-holder-view process'), 'no dead rows');
  assert.ok(!filtered.html.includes('Underwriter Portal'), 'external lane gone with its only card');
  assert.ok(!filtered.html.includes('Bots</td>'), 'bots lane gone with its only card');
  // unfiltered: rows present
  assert.ok(full.html.includes('Underwriter Portal'));
  assert.ok(full.html.includes('Bots</td>'));
  void rm;
});

test('the System routing band exists only while a visible automation/translation edge routes through it', () => {
  const dir = makeFixtureDir({
    'commands.md': `
## issue-policy
Name: Issue Policy
Produces: policy-issued
* x
## auto-cmd
Name: Auto Cmd
Observes: policy-issued
Produces: policy-posted
* y
`,
    'events.md': `
## policy-issued
policy:Id
Name: Policy Issued
Subprocess: Policy
* x
## policy-posted
policy:Id
Name: Policy Posted
Subprocess: Policy
* y
`,
    'readmodels.md': `
## policy-view
Name: Policy View
Subscribes: policy-issued
policy:Key
* x
`,
    'uis.md': `
## issue-policy
Type: html
Name: Issue Policy
Actor: Clerk
`,
  });
  const model = buildModel(dir);
  assert.equal(model.hasSystem, true);
  assert.ok(LAYOUT.wrapInnerHtml(model, null).html.includes('sys-gutter'), 'unfiltered: System band present');
  // Human slice only — no visible automation edge routes through the band.
  const visible = new Set(['issue-policy', 'ui-issue-policy--triggers-issue-policy', 'policy-issued']);
  const filtered = LAYOUT.wrapInnerHtml(model, visible);
  assert.equal(filtered.geo.sysH, 0, 'band collapses when unused');
  assert.ok(!filtered.html.includes('sys-gutter'), 'no gap where the band was');
  // Automated command + its observed event both visible -> band is back.
  const withAuto = new Set(['auto-cmd', 'policy-issued', 'policy-posted']);
  const filtered2 = LAYOUT.wrapInnerHtml(model, withAuto);
  assert.equal(filtered2.geo.sysH, LAYOUT.SYS_H);
  assert.ok(filtered2.html.includes('sys-gutter'));
});

test('wrapInnerHtml(model, null) equals the static page wrap content — no-JS page and JS re-render agree', () => {
  const dir = translationFixture();
  const model = buildModel(dir);
  const geo = computeGeometry(model);
  const tableHtml = renderTable(model, geo);
  const arrowsHtml = renderArrows(model, geo);
  const page = renderPage(model, geo, tableHtml, arrowsHtml);
  const i = page.indexOf('<div class="wrap">') + '<div class="wrap">'.length;
  const j = page.indexOf('</svg>\n</div>') + '</svg>'.length;
  assert.equal(page.slice(i, j), '\n' + LAYOUT.wrapInnerHtml(model, null).html);
});

test('time badges keep their original story numbers when earlier events are filtered out (Q1)', () => {
  const dir = makeFixtureDir({
    'commands.md': `
## cmd-a
Name: Cmd A
Produces: evt-a
* x
## cmd-b
Name: Cmd B
Produces: evt-b
* y
`,
    'events.md': `
## evt-a
policy:Id
Name: Evt A
Subprocess: S
* x
## evt-b
policy:Id
Name: Evt B
Subprocess: S
* y
`,
    'readmodels.md': `
## view-b
Name: View B
Subscribes: evt-b
policy:Key
* y
`,
    'uis.md': `
## cmd-b
Type: html
Name: Cmd B
Actor: Clerk
`,
  });
  const model = buildModel(dir);
  // Filter to the second slice only: its badge must still read "2", not "1".
  const visible = new Set(['cmd-b', 'evt-b', 'ui-cmd-b--triggers-cmd-b']);
  const { html } = LAYOUT.wrapInnerHtml(model, visible);
  assert.ok(html.includes('time-badge">2<'), 'original story number kept');
  assert.ok(!html.includes('time-badge">1<'), 'first badge hidden with its event');
  // unfiltered: 1 and 2 both present
  const full = LAYOUT.wrapInnerHtml(model, null).html;
  assert.ok(full.includes('time-badge">1<') && full.includes('time-badge">2<'));
});

test('computeGeometry accepts the plain {id:true} map that connectedSet() builds (not just a Set)', () => {
  const dir = translationFixture();
  const model = buildModel(dir);
  const mapShape = { 'add-policy-holder': true, 'policy-holder-added': true };
  const setShape = new Set(['add-policy-holder', 'policy-holder-added']);
  const a = computeGeometry(model, mapShape);
  const b = computeGeometry(model, setShape);
  assert.equal(a.width, b.width);
  assert.equal(a.height, b.height);
  assert.deepEqual(a.colActive, b.colActive);
  // and a false-y entry in the map must NOT count as visible
  const withFalse = { 'add-policy-holder': true, 'policy-holder-added': true, 'policy-holder-view': false };
  const c = computeGeometry(model, withFalse);
  assert.equal(c.width, a.width, 'false value = hidden');
});

test('the table fragment is self-describing: inline width, no baked CSS width (regression: stretched columns)', () => {
  // The CSS used to bake `width:${geo.width}px` on the table. A browser
  // re-render of a FILTERED layout left that stale full width in place, so
  // table-layout:fixed stretched the surviving columns and pulled the cards
  // out from under the correctly-computed arrow coordinates. The width must
  // travel with the fragment instead.
  const dir = translationFixture();
  const model = buildModel(dir);
  const geo = computeGeometry(model);
  const html = renderTable(model, geo);
  assert.ok(html.startsWith(`<table style="width:${geo.width}px">`), 'table carries its own width');
  // and the stylesheet must not re-introduce a competing pixel width
  const page = renderPage(model, geo, html, renderArrows(model, geo));
  const css = page.slice(page.indexOf('<style>'), page.indexOf('</style>'));
  const tableRule = css.match(/table\{[^}]*\}/)[0];
  assert.ok(!/width:/.test(tableRule), 'no width in the table CSS rule');
  // filtered render: the inline width must follow the collapsed geometry
  const visible = new Set(['add-policy-holder', 'policy-holder-added']);
  const fgeo = computeGeometry(model, visible);
  const fhtml = renderTable(model, fgeo, visible);
  assert.ok(fhtml.startsWith(`<table style="width:${fgeo.width}px">`));
  assert.ok(fgeo.width < geo.width, 'filtered table is narrower');
});

// ---------------------------------------------------------------------------
// Url: attribute on UIs
// ---------------------------------------------------------------------------

test('parseMdText parses an optional Url: on a UI entry', () => {
  const items = parseMdText(`
## policy-dashboard
Name: Policy Dashboard
Actor: Insurance Agent
Type: html
Url: https://example.com/dashboard
`);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'policy-dashboard');
  assert.equal(items[0].url, 'https://example.com/dashboard');
});

test('parseMdText leaves url undefined when Url: is absent', () => {
  const items = parseMdText(`
## some-ui
Name: Some UI
Actor: Clerk
Type: html
`);
  assert.equal(items[0].url, undefined);
});

test('renderTable renders a trigger UI card as a link when Url: is set', () => {
  const dir = baseFixture({
    uis: `
## add-policy-holder
Name: Add Policy Holder Form
Actor: Clerk
Type: html
Url: https://example.com/form
`,
  });
  const model = buildModel(dir);
  const geo = computeGeometry(model);
  const html = renderTable(model, geo);
  // The UI card should be wrapped in an <a> with href
  assert.match(html, /<a href="https:\/\/example.com\/form"/);
  // data-element and data-ui-id stay on the <a> (not nested inside a <div>)
  assert.match(html, /data-element="ui-add-policy-holder--triggers-add-policy-holder"/);
  assert.match(html, /data-ui-id="add-policy-holder"/);
  // Still has the card class and title
  assert.match(html, /class="card ui-card"/);
  assert.ok(html.includes('Add Policy Holder Form'));
});

test('renderTable renders an output UI card as a link when Url: is set', () => {
  const dir = baseFixture({
    uis: `
## add-policy-holder
Name: Add Policy Holder Form
Actor: Clerk

## policy-holder-view
Name: Policy Holder View Screen
Actor: Clerk
Type: html
Url: https://example.com/view
`,
  });
  const model = buildModel(dir);
  const geo = computeGeometry(model);
  const html = renderTable(model, geo);
  // The output UI card should be wrapped in an <a> with href
  assert.match(html, /<a href="https:\/\/example.com\/view"/);
  assert.match(html, /data-element="ui-policy-holder-view--displays"/);
  assert.ok(html.includes('Policy Holder View Screen'));
});

test('renderTable renders a UI card as a plain div when Url: is absent', () => {
  const dir = baseFixture({
    uis: `
## add-policy-holder
Name: Add Policy Holder Form
Actor: Clerk
Type: html
`,
  });
  const model = buildModel(dir);
  const geo = computeGeometry(model);
  const html = renderTable(model, geo);
  // Should NOT contain an <a> wrapping the card
  assert.doesNotMatch(html, /<a href="/);
  // Should have the card as a plain <div>
  assert.match(html, /<div class="card ui-card"/);
});

test('renderTable escapes HTML entities in Url: to prevent injection', () => {
  const dir = baseFixture({
    uis: `
## add-policy-holder
Name: Add Policy Holder Form
Actor: Clerk
Type: html
Url: https://example.com?q=<script>alert(1)</script>
`,
  });
  const model = buildModel(dir);
  const geo = computeGeometry(model);
  const html = renderTable(model, geo);
  // The URL should be HTML-escaped in the href attribute
  assert.match(html, /<a href="https:\/\/example.com\?q=&lt;script&gt;alert\(1\)&lt;\/script&gt;"/);
});
