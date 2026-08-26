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
  renderTable,
  renderPage,
  computeGeometry,
  isBracketedField,
  normalizeField,
  hasMatchingField,
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
  assert.equal(items[0].produces, 'policy-holder-added');
  assert.deepEqual(items[0].fields, ['name', 'address']);
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
  assert.deepEqual(items[0].keys, ['customerId', 'region']);
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
// buildModel / renderTable — read-model `{keyName}:Key` attribute
// ---------------------------------------------------------------------------

test('buildModel throws when a read model has neither {aggregateName}:Id nor {keyName}:Key', () => {
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
    /Read model\(s\) missing mandatory "\{aggregateName\}:Id" and\/or "\{keyName\}:Key" — policy-holder-view/
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
  assert.deepEqual(rm.keys, ['policyHolderId', 'region']);
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
