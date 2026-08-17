'use strict';
/*
 * Unit tests for generate.js — parsing + validation rules.
 *
 * Run with: node --test .opencode/skills/event-modelling/scripts/
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
  computeGeometry,
  isBracketedField,
  normalizeField,
  hasMatchingField,
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
id:PolicyHolder
* name
* address
`;
  const readmodels = overrides.readmodels !== undefined ? overrides.readmodels : `
## policy-holder-view
Name: Policy Holder View
Subscribes: policy-holder-added
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
  assert.equal(items[0].produces, 'policy-holder-added');
  assert.deepEqual(items[0].fields, ['name', 'address']);
});

test('parseMdText parses an events.md-shaped entry with id:{Aggregate}', () => {
  const items = parseMdText(`
## policy-holder-added
Name: Policy Holder Added
id:PolicyHolder
* name
* address
`);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'policy-holder-added');
  assert.equal(items[0].aggregateId, 'PolicyHolder');
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
  assert.equal(items[0].uiType, 'html');
  assert.deepEqual(items[0].triggers, ['cmd-a', 'cmd-b']);
  assert.deepEqual(items[0].consistsOf, ['view-a', 'view-b']);
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

test('hasMatchingField finds a case-insensitive match across upstream field lists', () => {
  assert.equal(hasMatchingField('Name', [['name', 'address']]), true);
  assert.equal(hasMatchingField('missing', [['name', 'address']]), false);
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
id:Foo

## policy-holder-added
Name: Policy Holder Added
id:PolicyHolder
`,
    readmodels: `
## rm
Name: RM
Subscribes: some-other-event, policy-holder-added
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

// ---------------------------------------------------------------------------
// buildModel — missing id:{Aggregate} on an event
// ---------------------------------------------------------------------------

test('buildModel throws when an event is missing mandatory id:{Aggregate}', () => {
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
    /Event\(s\) missing mandatory "id:\{Aggregate\}" — policy-holder-added/
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
id:PolicyHolder
* name
* address
`,
    readmodels: `
## policy-holder-view
Name: Policy Holder View
Subscribes: policy-holder-added
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
id:PolicyHolder
* name
* [holder-id]
`,
    readmodels: `
## policy-holder-view
Name: Policy Holder View
Subscribes: policy-holder-added
* name
`,
  });
  assert.doesNotThrow(() => buildModel(dir));
});

// ---------------------------------------------------------------------------
// Edge-kind tagging (renderArrows) — triggers / produces / observes /
// observes-cmd / displays
// ---------------------------------------------------------------------------

test('renderArrows tags a human-triggered command edge as "triggers" and its produced-event edge as "produces"', () => {
  const dir = baseFixture();
  const model = buildModel(dir);
  const geo = computeGeometry(model);
  const svg = renderArrows(model, geo);
  assert.match(svg, /data-kind="triggers"/);
  assert.match(svg, /data-kind="produces"/);
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
id:PolicyHolder
* name

## policy-issued
Name: Policy Issued
id:Policy
`,
    readmodels: `
## policy-holder-view
Name: Policy Holder View
Subscribes: policy-holder-added
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
