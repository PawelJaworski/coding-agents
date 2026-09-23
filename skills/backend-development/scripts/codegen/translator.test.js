// TranslatorPlugin — Translation Pattern ingress adapters (rest | kafka | plain).
//
// A translator turns an external-event payload into a command and hands it to
// CommandHandler. `Type:` selects the ingress adapter; the mapping is
// best-effort (auto-map by name, throwing stub for the rest) because the
// external contract is explicitly not modelled by the team.

import test from 'node:test';
import assert from 'node:assert/strict';
import naming from './naming.js';
import { parseModel } from './parse.js';
import { TranslatorPlugin, translatorKind, resolveMappingField, sameShape } from './plugins/TranslatorPlugin.js';
import {
  importBlock,
  components,
  collaborator,
  fieldDeclarations,
  constructorArgs,
  collaboratorImports,
  collaboratorScaffolds,
  resolveArg,
} from './emit.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = 'com.example';

// --- fixture: a one-command model with a Translation slice -------------------
// Minimal but valid: one command, one event it produces, one external event,
// one translator bridging them.

const COMMANDS = `# Commands

## issue-policy
Name: Issue Policy
Produces: policy-issued
* policy holder
* policy coverage
`;

const EVENTS = `# Events

## policy-issued
Name: Policy Issued
policy:Id
* policy holder
* policy coverage
`;

const READMODELS = `# Read Models

## issued-policies
Name: Issued Policies
Subscribes: policy-issued
policy:Key
* policy holder
`;

const BUSINESS_DEFS = `# name Policy Holder
# description
A person.
* Name
* Surname
------
# name Policy Coverage
# description
Protection.
* coverage period
`;

const EXTERNAL_EVENTS_EMPTY = `# External Events

## application-received
Name: Application Received
System name: Underwriter Portal
`;

const EXTERNAL_EVENTS_WITH_FIELDS = `# External Events

## application-received
Name: Application Received
System name: Underwriter Portal
* policy holder
* unknown extra
`;

const TRANSLATORS_REST = `# Translators

## translate-application
Name: Translate Application
Type: rest
Subscribes: application-received
Produces: issue-policy
`;

const TRANSLATORS_KAFKA = `# Translators

## translate-application
Name: Translate Application
Type: kafka
Subscribes: application-received
Produces: issue-policy
`;

const TRANSLATORS_PLAIN = `# Translators

## translate-application
Name: Translate Application
Type: webhook
Subscribes: application-received
Produces: issue-policy
`;

function withModel(overrides, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'translator-plugin-'));
  const files = {
    'commands.md': COMMANDS,
    'events.md': EVENTS,
    'readmodels.md': READMODELS,
    'business-definitions-raw.md': BUSINESS_DEFS,
    'external-events.md': EXTERNAL_EVENTS_EMPTY,
    'translators.md': TRANSLATORS_REST,
    ...overrides,
  };
  for (const [name, text] of Object.entries(files)) {
    if (text === undefined) continue;
    fs.writeFileSync(path.join(dir, name), text);
  }
  try {
    const model = parseModel({ modelDir: dir, basePackage: BASE });
    const ctx = {
      basePackage: BASE,
      naming,
      eventsById: new Map(model.events.map((e) => [e.id, e])),
      commandsById: new Map(model.commands.map((c) => [c.id, c])),
      readModelsById: new Map(model.readModels.map((r) => [r.id, r])),
      importBlock,
      components,
      collaborator,
      fieldDeclarations,
      constructorArgs,
      collaboratorImports,
      collaboratorScaffolds,
      resolveArg,
    };
    return fn(model, ctx, TranslatorPlugin.emit(model, ctx));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// --- naming ------------------------------------------------------------------

test('translator naming', () => {
  const n = naming.translator(BASE, 'translate-application');
  assert.equal(n.className, 'TranslateApplicationTranslator');
  assert.equal(n.package, `${BASE}.translateapplication`);
});

test('external event naming keeps it out of domain.events', () => {
  const n = naming.externalEvent(BASE, 'application-received', 'Underwriter Portal');
  assert.equal(n.className, 'ApplicationReceivedExternal');
  assert.equal(n.package, `${BASE}.underwriterportal`);
});

test('external event package is named after System name, one slice per system', () => {
  assert.equal(
    naming.externalEvent(BASE, 'a', 'Underwriter Portal').package,
    `${BASE}.underwriterportal`,
  );
  assert.equal(
    naming.externalEvent(BASE, 'b', 'Other System').package,
    `${BASE}.othersystem`,
  );
  // free-form system names still yield a legal Java package segment
  assert.equal(naming.externalEvent(BASE, 'c', 'ACME Corp.').package, `${BASE}.acmecorp`);
  assert.equal(naming.externalEvent(BASE, 'd', 'External').package, `${BASE}.external`);
  assert.equal(naming.externalEvent(BASE, 'e').package, `${BASE}.external`);
});

test('systemPackage strips anything that is not a-z0-9', () => {
  assert.equal(naming.systemPackage('Underwriter Portal'), 'underwriterportal');
  assert.equal(naming.systemPackage('ACME Corp.'), 'acmecorp');
  assert.equal(naming.systemPackage('  Foo/Bar-Baz  '), 'foobarbaz');
  assert.equal(naming.systemPackage('!!!'), '');
});

test('call-site names derive from the model ids', () => {
  assert.equal(naming.handlerField('IssuePolicyHandler'), 'issuePolicyHandler');
  assert.equal(naming.mapMethod('issue-policy'), 'toIssuePolicyCmd');
  assert.equal(naming.entryMethod('application-received'), 'onApplicationReceived');
});

// --- kind selection ----------------------------------------------------------

test('translatorKind: rest/kafka are case-insensitive, everything else is plain', () => {
  assert.equal(translatorKind('rest'), 'rest');
  assert.equal(translatorKind('REST'), 'rest');
  assert.equal(translatorKind('Kafka'), 'kafka');
  assert.equal(translatorKind('webhook'), 'plain');
  assert.equal(translatorKind(null), 'plain');
  assert.equal(translatorKind(''), 'plain');
});

// --- parsing -----------------------------------------------------------------

test('parseModel reads Type: as a free-form typeHint and resolves Subscribes/Produces', () => {
  withModel({ 'translators.md': TRANSLATORS_REST }, (model) => {
    assert.equal(model.translators.length, 1);
    const t = model.translators[0];
    assert.equal(t.id, 'translate-application');
    assert.equal(t.typeHint, 'rest');
    assert.deepEqual(t.subscribes, ['application-received']);
    assert.deepEqual(t.produces, ['issue-policy']);
    assert.equal(model.externalEvents.length, 1);
    assert.equal(model.externalEvents[0].systemName, 'Underwriter Portal');
  });
});

test('parseModel keeps an arbitrary free-form Type: value verbatim', () => {
  withModel({
    'translators.md': `# Translators

## translate-application
Type: underwriter-sync-bot
Subscribes: application-received
Produces: issue-policy
`,
  }, (model) => {
    assert.equal(model.translators[0].typeHint, 'underwriter-sync-bot');
  });
});

test('parseModel: translator with unknown Subscribes: fails loudly', () => {
  assert.throws(
    () => withModel({
      'translators.md': `# Translators

## t
Subscribes: does-not-exist
Produces: issue-policy
`,
    }, () => {}),
    /Translator "t" subscribes unknown external event "does-not-exist"/,
  );
});

test('parseModel: translator with unknown Produces: fails loudly', () => {
  assert.throws(
    () => withModel({
      'translators.md': `# Translators

## t
Subscribes: application-received
Produces: does-not-exist
`,
    }, () => {}),
    /Translator "t" produces unknown command "does-not-exist"/,
  );
});

test('parseModel: translator with no Subscribes: fails loudly', () => {
  assert.throws(
    () => withModel({
      'translators.md': `# Translators

## t
Produces: issue-policy
`,
    }, () => {}),
    /Translator "t" has no "Subscribes:" line/,
  );
});

test('parseModel: translator with no Produces: fails loudly', () => {
  assert.throws(
    () => withModel({
      'translators.md': `# Translators

## t
Subscribes: application-received
`,
    }, () => {}),
    /Translator "t" has no "Produces:" line/,
  );
});

test('parseModel: both Translation files are optional', () => {
  withModel({ 'external-events.md': undefined, 'translators.md': undefined }, (model) => {
    assert.deepEqual(model.translators, []);
    assert.deepEqual(model.externalEvents, []);
  });
});

// --- mapping resolution ------------------------------------------------------

test('resolveMappingField auto-maps a same-name same-shape field', () => {
  const extFields = [{ label: 'policy holder', name: 'policyHolder', javaType: 'PolicyHolder', children: [] }];
  const cmdField = { label: 'policy holder', name: 'policyHolder', javaType: 'PolicyHolder', children: [] };
  const r = resolveMappingField(cmdField, extFields, 'payload');
  assert.equal(r.stub, undefined);
  assert.equal(r.expr, 'payload.policyHolder()');
});

test('resolveMappingField stubs a command field the external contract does not carry', () => {
  const r = resolveMappingField(
    { label: 'policy coverage', name: 'policyCoverage', javaType: 'PolicyCoverage' },
    [],
    'payload',
  );
  assert.equal(r.stub, true);
});

test('resolveMappingField stubs a bracketed (decided) field even when a same-name source exists', () => {
  const r = resolveMappingField(
    { label: 'policy number', name: 'policyNumber', javaType: 'String', bracketed: true },
    [{ label: 'policy number', name: 'policyNumber', javaType: 'String' }],
    'payload',
  );
  assert.equal(r.stub, true);
});

test('sameShape rejects a list/non-list mismatch', () => {
  assert.equal(sameShape({ list: true }, { list: false }), false);
  assert.equal(sameShape({ list: false, children: [] }, { list: false, children: [] }), true);
});

// --- emit: payload record ----------------------------------------------------

test('emit: one payload record per external event, in the System name package', () => {
  withModel({}, (model, ctx, files) => {
    const payload = files.find((f) => f.className === 'ApplicationReceivedExternal');
    assert.ok(payload, 'payload record missing');
    assert.equal(payload.package, `${BASE}.underwriterportal`);
    assert.equal(payload.category, 'translators');
    assert.equal(payload.logic, undefined);
    assert.match(payload.content, /public record ApplicationReceivedExternal\(/);
  });
});

test('emit: two external events from different systems land in different packages', () => {
  withModel({
    'external-events.md': `# External Events

## application-received
Name: Application Received
System name: Underwriter Portal

## risk-score-published
Name: Risk Score Published
System name: Risk Engine
`,
    'translators.md': `# Translators

## translate-application
Type: rest
Subscribes: application-received, risk-score-published
Produces: issue-policy
`,
  }, (model, ctx, files) => {
    const a = files.find((f) => f.className === 'ApplicationReceivedExternal');
    const b = files.find((f) => f.className === 'RiskScorePublishedExternal');
    assert.equal(a.package, `${BASE}.underwriterportal`);
    assert.equal(b.package, `${BASE}.riskengine`);
  });
});

test('emit: payload record carries the external event fields', () => {
  withModel({ 'external-events.md': EXTERNAL_EVENTS_WITH_FIELDS }, (model, ctx, files) => {
    const payload = files.find((f) => f.className === 'ApplicationReceivedExternal');
    assert.match(payload.content, /PolicyHolder policyHolder/);
  });
});

// --- emit: rest --------------------------------------------------------------

test('emit rest: @RestController + @PostMapping per external event + CommandHandler field + handle(mapped)', () => {
  withModel({ 'translators.md': TRANSLATORS_REST }, (model, ctx, files) => {
    const tr = files.find((f) => f.className === 'TranslateApplicationTranslator');
    assert.ok(tr, 'translator missing');
    assert.equal(tr.category, 'translators');
    assert.equal(tr.logic, true, 'translator is hand-owned logic');
    assert.match(tr.content, /@RestController/);
    assert.match(tr.content, /@PostMapping\("application-received"\)/);
    assert.match(tr.content, /private final CommandHandler<IssuePolicyCmd> issuePolicyHandler;/);
    assert.match(tr.content, /issuePolicyHandler\.handle\(mappedCommand\)/);
    assert.match(tr.content, /private IssuePolicyCmd toIssuePolicyCmd\(ApplicationReceivedExternal payload\)/);
  });
});

test('emit rest: entry method is named on<ExternalEvent> and returns the aggregate id', () => {
  withModel({ 'translators.md': TRANSLATORS_REST }, (model, ctx, files) => {
    const tr = files.find((f) => f.className === 'TranslateApplicationTranslator');
    assert.match(tr.content, /public Long onApplicationReceived\(@RequestBody ApplicationReceivedExternal payload\)/);
  });
});

// --- emit: kafka -------------------------------------------------------------

test('emit kafka: @KafkaListener(topics = external event id), void entry, no @PostMapping', () => {
  withModel({ 'translators.md': TRANSLATORS_KAFKA }, (model, ctx, files) => {
    const tr = files.find((f) => f.className === 'TranslateApplicationTranslator');
    assert.match(tr.content, /@KafkaListener\(topics = "application-received"\)/);
    assert.match(tr.content, /public void onApplicationReceived\(ApplicationReceivedExternal payload\)/);
    assert.doesNotMatch(tr.content, /@PostMapping/);
    assert.doesNotMatch(tr.content, /@RestController/);
    assert.match(tr.content, /issuePolicyHandler\.handle\(mappedCommand\)/);
  });
});

// --- emit: plain (unknown / omitted Type) ------------------------------------

test('emit plain: @Component with no transport adapter, mapping and handle still wired', () => {
  withModel({ 'translators.md': TRANSLATORS_PLAIN }, (model, ctx, files) => {
    const tr = files.find((f) => f.className === 'TranslateApplicationTranslator');
    assert.match(tr.content, /@Component/);
    assert.doesNotMatch(tr.content, /@PostMapping/);
    assert.doesNotMatch(tr.content, /@KafkaListener/);
    assert.doesNotMatch(tr.content, /@RestController/);
    assert.match(tr.content, /issuePolicyHandler\.handle\(mappedCommand\)/);
  });
});

test('emit plain: omitted Type: also yields a plain @Component', () => {
  withModel({
    'translators.md': `# Translators

## translate-application
Subscribes: application-received
Produces: issue-policy
`,
  }, (model, ctx, files) => {
    const tr = files.find((f) => f.className === 'TranslateApplicationTranslator');
    assert.match(tr.content, /@Component/);
    assert.doesNotMatch(tr.content, /@PostMapping|@KafkaListener|@RestController/);
  });
});

// --- mapping bodies ----------------------------------------------------------

test('emit: matching external field is auto-mapped, missing one becomes a throwing stub', () => {
  withModel({ 'external-events.md': EXTERNAL_EVENTS_WITH_FIELDS }, (model, ctx, files) => {
    const tr = files.find((f) => f.className === 'TranslateApplicationTranslator');
    // policy holder matches -> passthrough
    assert.match(tr.content, /payload\.policyHolder\(\)/);
    // policy coverage has no matching external field -> stub
    assert.match(tr.content, /private PolicyCoverage policyCoverage\(ApplicationReceivedExternal payload\)/);
    assert.match(tr.content, /"mapping of external event 'application-received' to command field 'policy coverage' is not implemented"/);
  });
});

test('emit: with an empty external contract every command field is a mapping stub', () => {
  withModel({}, (model, ctx, files) => {
    const tr = files.find((f) => f.className === 'TranslateApplicationTranslator');
    assert.doesNotMatch(tr.content, /payload\.policyHolder\(\)/);
    assert.match(tr.content, /private PolicyHolder policyHolder\(ApplicationReceivedExternal payload\)/);
    assert.match(tr.content, /private PolicyCoverage policyCoverage\(ApplicationReceivedExternal payload\)/);
  });
});

// --- multi-command dispatch --------------------------------------------------

test('emit multi-command: one handler field per command and a hand-owned dispatch stub', () => {
  withModel({
    'commands.md': `# Commands

## issue-policy
Name: Issue Policy
Produces: policy-issued
* policy holder

## cancel-policy
Name: Cancel Policy
Produces: policy-issued
* policy holder
`,
    'translators.md': `# Translators

## translate-application
Type: rest
Subscribes: application-received
Produces: issue-policy, cancel-policy
`,
  }, (model, ctx, files) => {
    const tr = files.find((f) => f.className === 'TranslateApplicationTranslator');
    assert.match(tr.content, /private final CommandHandler<IssuePolicyCmd> issuePolicyHandler;/);
    assert.match(tr.content, /private final CommandHandler<CancelPolicyCmd> cancelPolicyHandler;/);
    assert.match(tr.content, /private Long dispatch\(ApplicationReceivedExternal payload\)/);
    assert.match(tr.content, /"dispatch of external event 'application-received' is not implemented/);
    // entry delegates to dispatch
    assert.match(tr.content, /return dispatch\(payload\);/);
  });
});

test('emit multi-subscribe: one entry and one mapping overload per (external event, command)', () => {
  withModel({
    'external-events.md': `# External Events

## application-received
Name: Application Received
System name: Underwriter Portal

## policy-issued-externally
Name: Policy Issued Externally
System name: Underwriter Portal
`,
    'translators.md': `# Translators

## translate-application
Type: rest
Subscribes: application-received, policy-issued-externally
Produces: issue-policy
`,
  }, (model, ctx, files) => {
    const tr = files.find((f) => f.className === 'TranslateApplicationTranslator');
    assert.match(tr.content, /onApplicationReceived/);
    assert.match(tr.content, /onPolicyIssuedExternally/);
    // overloaded map methods on the payload type
    assert.match(tr.content, /toIssuePolicyCmd\(ApplicationReceivedExternal payload\)/);
    assert.match(tr.content, /toIssuePolicyCmd\(PolicyIssuedExternallyExternal payload\)/);
  });
});

// --- REST path collision -----------------------------------------------------

test('emit: two rest translators sharing one external event is a loud error', () => {
  assert.throws(
    () => withModel({
      'translators.md': `# Translators

## translate-application
Type: rest
Subscribes: application-received
Produces: issue-policy

## second-bot
Type: rest
Subscribes: application-received
Produces: issue-policy
`,
    }, () => {}),
    /both map external event "application-received" to a REST POST endpoint/,
  );
});

test('emit: a kafka and a rest translator MAY share one external event (fan-in)', () => {
  withModel({
    'translators.md': `# Translators

## translate-application
Type: rest
Subscribes: application-received
Produces: issue-policy

## second-bot
Type: kafka
Subscribes: application-received
Produces: issue-policy
`,
  }, (model, ctx, files) => {
    const classes = files.filter((f) => f.className === 'TranslateApplicationTranslator' || f.className === 'SecondBotTranslator');
    assert.equal(classes.length, 2);
  });
});

// --- step --------------------------------------------------------------------

test('step: GENERATE_TRANSLATORS is registered with category "translators" and follows GENERATE_COMMANDS', () => {
  assert.equal(TranslatorPlugin.step.id, 'GENERATE_TRANSLATORS');
  assert.equal(TranslatorPlugin.step.category, 'translators');
  assert.deepEqual(TranslatorPlugin.step.after, ['GENERATE_COMMANDS']);
  const prompt = TranslatorPlugin.step.render({ op: 'CREATE', path: 'x/Foo.java' }, 0, 1);
  assert.match(prompt, /GENERATE_TRANSLATORS/);
  assert.match(prompt, /CREATE/);
});
