import test from 'node:test';
import assert from 'node:assert/strict';
import naming from './naming.js';
import { parseSections, parseField, parseDefinitions, injectIdentity, resolveKeyAttributePath, requireSearchOnlyFieldsHaveData } from './parse.js';
import {
  parseScaffoldVersion,
  stampScaffoldVersion,
  leadingCommentBlock,
  misplacedSpecs,
  preservedReason,
} from './scaffold.js';
import { runtimeFiles } from './runtime.js';
import {
  collaborator,
  fieldDeclarations,
  constructorArgs,
  collaboratorImports,
  collaboratorScaffolds,
  resolveArg,
  commandHandler,
  command,
  aggregate,
  valueObject,
  projector,
  readModelEntity,
  readModelKey,
  readModelRepository,
  readModelJpaRepository,
  readModelInMemoryRepository,
  persistingProjector,
  persistingProjectorAbility,
} from './emit.js';

const BASE = 'pl.pjaworski.insurance_company';

test('kebab ids collapse to a single lowercase slice package', () => {
  assert.equal(naming.slicePackage('issue-policy'), 'issuepolicy');
  assert.equal(naming.slicePackage('create-proposal'), 'createproposal');
  assert.equal(naming.slicePackage('policy-document'), 'policydocument');
});

test('command naming', () => {
  const c = naming.command(BASE, 'issue-policy');
  assert.equal(c.className, 'IssuePolicyCmd');
  assert.equal(c.handlerClassName, 'IssuePolicyHandler');
  assert.equal(c.package, `${BASE}.issuepolicy`);
  assert.equal(c.postMapping, 'issue-policy');
  assert.equal(c.dslMethod, 'issue_policy');
});

test('aggregate naming', () => {
  const a = naming.aggregate(BASE, 'policy');
  assert.equal(a.className, 'PolicyAggregate');
  assert.equal(a.package, `${BASE}.domain`);
});

test('event naming', () => {
  const e = naming.event(BASE, 'policy-issued');
  assert.equal(e.className, 'PolicyIssuedEvent');
  assert.equal(e.typeEnum, 'POLICY_ISSUED');
  assert.equal(e.serdeClassName, 'PolicyIssuedEventSerdeWrapper');
  assert.equal(e.package, `${BASE}.domain.events`);
});

test('read model naming', () => {
  const rm = naming.readModel(BASE, 'policy-document');
  assert.equal(rm.className, 'PolicyDocument');
  assert.equal(rm.projectorClassName, 'PolicyDocumentProjector');
  assert.equal(rm.getMapping, 'policy-document/{aggregateId}');
  assert.equal(rm.dslMethod, 'expect_policy_document');
});

test('keyed read model drops the {aggregateId} path variable (it spans aggregates)', () => {
  const rm = naming.readModel(BASE, 'policy-list', { keyed: true });
  assert.equal(rm.getMapping, 'policy-list');
  assert.equal(rm.entityClassName, 'PolicyListEntity');
  assert.equal(rm.repositoryClassName, 'PolicyListRepository');
  assert.equal(rm.jpaRepositoryClassName, 'PolicyListJpaRepository');
  assert.equal(rm.inMemoryRepositoryClassName, 'PolicyListInMemoryRepository');
  assert.equal(rm.repositoryConstant, 'POLICY_LIST_REPOSITORY');
  assert.equal(rm.tableName, 'policy_list');
});

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
  assert.equal(fields[0].javaType, 'UUID');
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

// --- scaffold drift (A) ------------------------------------------------------


test('a file with no marker reads as v0 — exactly what a pre-versioning file is', () => {
  assert.equal(parseScaffoldVersion('package com.x;\n\nclass Foo {}\n'), 0);
});

test('scaffold version is parsed from the header', () => {
  const content = '// SCAFFOLDED ONCE by the backend codegen — this file is YOURS.\n'
    + '// scaffold-version: 3\n'
    + '// blurb\n'
    + 'package com.x;\n';
  assert.equal(parseScaffoldVersion(content), 3);
});

test('every runtime template is stamped with its own version', () => {
  for (const f of runtimeFiles('com.example')) {
    assert.equal(
      parseScaffoldVersion(f.content), f.version,
      `${f.className} header disagrees with its declared version`,
    );
  }
});

test('the two templates whose contracts changed are v2', () => {
  const byName = Object.fromEntries(runtimeFiles('com.example').map((f) => [f.className, f]));
  assert.equal(byName.EventStreamImpl.version, 2);
  assert.equal(byName.DomainEventEntity.version, 2);
  assert.equal(byName.DomainEvent.version, 1);
});

test('stamping rewrites an existing marker and leaves the body byte-identical', () => {
  const before = '// SCAFFOLDED ONCE by the backend codegen — this file is YOURS.\n'
    + '// scaffold-version: 1\n'
    + 'package com.x;\n\nclass Foo { int keepMe; }\n';
  const after = stampScaffoldVersion(before, 2);
  assert.equal(parseScaffoldVersion(after), 2);
  assert.match(after, /class Foo \{ int keepMe; \}/);
  assert.equal(after.split('\n').length, before.split('\n').length);
});

test('stamping inserts a marker under an unversioned scaffold header', () => {
  const before = '// SCAFFOLDED ONCE by the backend codegen — this file is YOURS.\n'
    + '// Domain-independent event-sourcing runtime; adapt it freely.\n'
    + 'package com.x;\n';
  const after = stampScaffoldVersion(before, 2);
  assert.equal(parseScaffoldVersion(after), 2);
  assert.match(after, /YOURS\.\n\/\/ scaffold-version: 2\n\/\/ Domain-independent/);
});

test('stamping a header-less hand-written file borrows the template header', () => {
  const template = '// SCAFFOLDED ONCE by the backend codegen — this file is YOURS.\n'
    + '// scaffold-version: 2\n'
    + '// blurb\n'
    + 'package com.x;\n';
  const after = stampScaffoldVersion('package com.x;\n\nclass Mine {}\n', 2, template);
  assert.equal(parseScaffoldVersion(after), 2);
  assert.match(after, /class Mine \{\}/);
  assert.match(after, /^\/\/ SCAFFOLDED ONCE/);
});

test('stamping is idempotent', () => {
  const once = stampScaffoldVersion('package com.x;\n', 2, '// SCAFFOLDED ONCE x\n// blurb\n');
  assert.equal(stampScaffoldVersion(once, 2), once);
});

test('leadingCommentBlock stops at the first non-comment line', () => {
  assert.equal(leadingCommentBlock('// a\n// b\npackage x;\n// not this\n'), '// a\n// b');
});

test('preservedReason returns null when no marker is present', () => {
  assert.equal(preservedReason('// GENERATED by the backend codegen — DO NOT EDIT.\npackage p;\n'), null);
});

test('preservedReason reads the reason from a PRESERVED-BY-HAND marker', () => {
  const content =
    '// GENERATED by the backend codegen — DO NOT EDIT.\n' +
    '// PRESERVED-BY-HAND: risk list is an enum the model cannot express\n' +
    'package p;\n';
  assert.equal(preservedReason(content), 'risk list is an enum the model cannot express');
});

// --- misplaced specs (B) -----------------------------------------------------

test('only Groovy specs are flagged as misplaced', () => {
  assert.deepEqual(
    misplacedSpecs([
      'src/test/java/x/PolicyDetailsSpec.groovy',
      'src/test/java/x/FooSpecification.groovy',
      'src/test/java/x/IssuePolicyAbility.java',   // generated abilities belong here
      'src/test/java/x/helper.groovy',             // not a spec
    ]),
    ['src/test/java/x/PolicyDetailsSpec.groovy', 'src/test/java/x/FooSpecification.groovy'],
  );
});

// --- collaborators -----------------------------------------------------------
// The generic seam that replaced the `needsDecider` boolean. These helpers
// decide every generated constructor signature and every test-ability wiring
// expression, so they are pinned down here: the point of the abstraction is
// that NOTHING below mentions a decider, a repository or any other specific
// kind — a new kind must work by construction, not by adding a branch.

const CLOCK = collaborator({
  fieldName: 'clock',
  className: 'Clock',
  testInstantiation: 'Clock.systemUTC()',
  scaffold: () => ({ className: 'Clock', once: true }),
});
const HANDLER = { fieldName: 'this' };

const EVENT_STREAM = collaborator({
  fieldName: 'eventStream',
  className: 'EventStream',
  testInstantiation: 'EventStreamAbility.INSTANCE',
  imports: [`${BASE}.eventstream.EventStream`],
});

const REPOSITORY = collaborator({
  fieldName: 'repository',
  className: 'PolicyListRepository',
  testInstantiation: 'PolicyListProjectorAbility.POLICY_LIST_REPOSITORY',
});

test('collaborator defaults: no imports, no scaffold', () => {
  const c = collaborator({ fieldName: 'clock', className: 'Clock', testInstantiation: 'Clock.systemUTC()' });
  assert.deepEqual(c.imports, []);
  assert.equal(c.scaffold, null);
});

test('field declarations are emitted in order, one per collaborator', () => {
  // Order matters: Lombok derives the constructor signature from declaration
  // order, and the generated abilities call that exact signature positionally.
  assert.equal(
    fieldDeclarations([EVENT_STREAM, CLOCK]),
    '    private final EventStream eventStream;\n' +
      '    private final Clock clock;',
  );
});

test('a single collaborator emits no stray separator', () => {
  assert.equal(fieldDeclarations([EVENT_STREAM]), '    private final EventStream eventStream;');
});

test('constructor args use each collaborator\'s own instantiation form', () => {
  // The whole reason this is per-collaborator DATA and not a rule: a clock
  // and a repository have different construction expressions. Both are ordinary
  // collaborators; only their strings differ.
  assert.equal(
    constructorArgs([REPOSITORY, CLOCK]),
    'PolicyListProjectorAbility.POLICY_LIST_REPOSITORY, Clock.systemUTC()',
  );
  assert.equal(
    constructorArgs([EVENT_STREAM, CLOCK]),
    'EventStreamAbility.INSTANCE, Clock.systemUTC()',
  );
});

test('constructor args and field declarations agree on arity and order', () => {
  const cs = [EVENT_STREAM, CLOCK, REPOSITORY];
  assert.equal(constructorArgs(cs).split(', ').length, fieldDeclarations(cs).split('\n').length);
  assert.equal(constructorArgs([]), '');
  assert.equal(fieldDeclarations([]), '');
});

test('collaborator imports are collected, including from same-package kinds that have none', () => {
  assert.deepEqual(collaboratorImports([EVENT_STREAM, CLOCK]), [`${BASE}.eventstream.EventStream`]);
  assert.deepEqual(collaboratorImports([CLOCK, REPOSITORY]), []);
});

test('only collaborators carrying a scaffold contribute a file', () => {
  const files = collaboratorScaffolds([EVENT_STREAM, CLOCK, REPOSITORY]);
  assert.equal(files.length, 1);
  assert.equal(files[0].className, 'Clock');
  assert.deepEqual(collaboratorScaffolds([EVENT_STREAM, REPOSITORY]), []);
});

test('an arbitrary NEW collaborator kind needs no generator change', () => {
  // The regression this guards: reintroducing a per-kind branch. A validator is
  // a kind the generator has never heard of, yet it wires correctly.
  const validator = collaborator({
    fieldName: 'validator',
    className: 'IssuePolicyValidator',
    testInstantiation: 'new IssuePolicyValidator()',
    imports: [`${BASE}.validation.IssuePolicyValidator`],
    scaffold: () => ({ className: 'IssuePolicyValidator', once: true }),
  });
  const cs = [EVENT_STREAM, validator, CLOCK];
  assert.equal(
    fieldDeclarations(cs),
    '    private final EventStream eventStream;\n' +
      '    private final IssuePolicyValidator validator;\n' +
      '    private final Clock clock;',
  );
  assert.equal(
    constructorArgs(cs),
    'EventStreamAbility.INSTANCE, new IssuePolicyValidator(), Clock.systemUTC()',
  );
  assert.deepEqual(collaboratorScaffolds(cs).map((f) => f.className), [
    'IssuePolicyValidator',
    'Clock',
  ]);
});

// --- resolveArg --------------------------------------------------------------

const field = (over = {}) => ({ name: 'policyNumber', label: 'policy number', imports: [], ...over });

test('a convention field resolves to its expression, never to a collaborator', () => {
  const r = resolveArg(
    field({ convention: 'uuid', conventionExpr: 'UUID.randomUUID()', imports: ['java.util.UUID'] }),
    { sourceFields: [], sourceExpr: 'command', delegate: HANDLER },
  );
  assert.equal(r.expr, 'UUID.randomUUID()');
  assert.ok(!r.delegated);
});

test('a passthrough field is derived from the source, not delegated', () => {
  const r = resolveArg(field({ name: 'policyHolder' }), {
    sourceFields: [{ name: 'policyHolder' }],
    sourceExpr: 'command',
    delegate: HANDLER,
  });
  assert.equal(r.expr, 'command.policyHolder()');
  assert.ok(!r.delegated);
});

test('a bracketed field delegates to the collaborator by FIELD NAME, not by type', () => {
  // Proves the resolver has no notion of what it delegates to: swap in any
  // collaborator and the call is routed through its field name.
  const r = resolveArg(field({ bracketed: true }), {
    sourceFields: [],
    sourceExpr: 'command',
    delegate: HANDLER,
  });
  assert.equal(r.expr, 'this.policyNumber()');
  assert.ok(r.delegated);

  const viaOther = resolveArg(field({ bracketed: true }), {
    sourceFields: [],
    sourceExpr: 'command',
    delegate: { fieldName: 'validator' },
  });
  assert.equal(viaOther.expr, 'validator.policyNumber()');
});

test('delegate args are passed through when the caller supplies them', () => {
  const r = resolveArg(field({ bracketed: true }), {
    sourceFields: [],
    sourceExpr: 'event',
    delegate: { ...HANDLER, args: 'state, event' },
  });
  assert.equal(r.expr, 'this.policyNumber(state, event)');
});

test('an unresolvable field returns null so the caller can raise a model gap', () => {
  assert.equal(
    resolveArg(field(), { sourceFields: [], sourceExpr: 'command', delegate: HANDLER }),
    null,
  );
});

test('a fallback resolves what the source cannot supply', () => {
  const r = resolveArg(field(), {
    sourceFields: [],
    sourceExpr: 'event',
    delegate: HANDLER,
    fallback: (f) => `state == null ? null : state.${f.name}()`,
  });
  assert.equal(r.expr, 'state == null ? null : state.policyNumber()');
});

// --- command-owned decisions and aggregate state -----------------------------

const cmdField = (label, javaType = 'String') => ({ ...parseField(label), javaType, imports: [] });

test('a command with NO bracketed field injects only the event stream', () => {
  const c = { ...naming.command(BASE, 'issue-policy'), id: 'issue-policy', fields: [cmdField('policy holder')] };
  const e = { ...naming.event(BASE, 'policy-issued'), id: 'policy-issued', fields: [cmdField('policy holder')] };

  const handler = commandHandler(c, [e], BASE);
  assert.match(handler.content, /private final EventStream eventStream;/);
  assert.doesNotMatch(handler.content, /Aggregate|\.check\(command\)/);
});

test('a bracketed non-aggregate decision is a private throwing method in the handler', () => {
  const c = { ...naming.command(BASE, 'issue-policy'), id: 'issue-policy', fields: [cmdField('policy holder')] };
  const e = {
    ...naming.event(BASE, 'policy-issued'),
    id: 'policy-issued',
    fields: [cmdField('policy holder'), cmdField('[policy number]')],
  };

  const handler = commandHandler(c, [e], BASE);
  assert.match(handler.content, /policyNumber\(\)/);
  assert.match(handler.content, /private String policyNumber\(\)[\s\S]*UnsupportedOperationException/);
});

test('a multi-produce command appends every produced event in one List.of, with per-event decisions', () => {
  const c = { ...naming.command(BASE, 'issue-policy'), id: 'issue-policy', fields: [cmdField('policy holder')] };
  const issued = {
    ...naming.event(BASE, 'policy-issued'),
    id: 'policy-issued',
    fields: [cmdField('policy holder'), cmdField('[policy number]')],
  };
  const premium = {
    ...naming.event(BASE, 'premium-calculated'),
    id: 'premium-calculated',
    fields: [cmdField('[premium amount]', 'BigDecimal')],
  };

  const handler = commandHandler(c, [issued, premium], BASE);
  assert.match(
    handler.content,
    /eventStream\.append\(List\.of\(new PolicyIssuedEvent\([\s\S]*new PremiumCalculatedEvent\([\s\S]*\)\)\);/,
  );
  assert.match(handler.content, /import .*\.domain\.events\.PolicyIssuedEvent;/);
  assert.match(handler.content, /import .*\.domain\.events\.PremiumCalculatedEvent;/);
  // each decision names ITS OWN event, not the command's first one
  assert.match(handler.content, /\[policy number\] on event 'policy-issued'/);
  assert.match(handler.content, /\[premium amount\] on event 'premium-calculated'/);
});

test('an aggregate is plain state hydrated only from events in its boundary', () => {
  const e = {
    ...naming.event(BASE, 'policy-issued'),
    id: 'policy-issued',
    aggregate: 'policy',
    fields: [cmdField('policy holder')],
  };
  const scaffold = aggregate('policy', [e], BASE);

  assert.match(scaffold.content, /public record PolicyAggregate\(UUID id\) implements StateProjector<PolicyAggregate>/);
  assert.match(scaffold.content, /apply\(PolicyAggregate state, PolicyIssuedEvent event\)/);
  assert.match(scaffold.content, /new PolicyAggregate\(event\.aggregateId\(\)\)/);
  assert.doesNotMatch(scaffold.content, /@Component|Ability|check\(/);
  assert.equal(scaffold.once, true);
});

// --- read model entity: embeddable value objects become flattened columns ------

const VA_ENT = 'pl.pjaworski.insurance_company.policylist';

const vaRm = () => ({
  id: 'policy-list',
  className: 'PolicyList',
  package: VA_ENT,
  getterMethod: 'getPolicyList',
  getMapping: 'policy-list',
  dslMethod: 'expect_policy_list',
  entityClassName: 'PolicyListEntity',
  idClassName: 'PolicyListKey',
  projectorClassName: 'PolicyListProjector',
  abilityClassName: 'PolicyListProjectorAbility',
  repositoryClassName: 'PolicyListRepository',
  inMemoryRepositoryClassName: 'PolicyListInMemoryRepository',
  repositoryConstant: 'POLICY_LIST_REPOSITORY',
  tableName: 'policy_list',
  subscribes: ['policy-issued'],
  keyFields: [],
  fields: [
    {
      name: 'policyHolder',
      label: 'policy holder',
      javaType: 'PolicyHolder',
      imports: ['pl.pjaworski.insurance_company.domain.PolicyHolder'],
      valueObject: { className: 'PolicyHolder', package: 'pl.pjaworski.insurance_company.domain' },
      embeds: true,
      attrs: [
        { name: 'name', javaType: 'String' },
        { name: 'surname', javaType: 'String' },
      ],
      searchable: true,
    },
    { name: 'policyNumber', label: 'policy number', javaType: 'String', imports: [], searchable: true },
    {
      name: 'coverage',
      label: 'coverage',
      javaType: 'PolicyCoverage',
      imports: ['pl.pjaworski.insurance_company.domain.PolicyCoverage'],
      valueObject: { className: 'PolicyCoverage', package: 'pl.pjaworski.insurance_company.domain' },
      embeds: false,
      attrs: [],
    },
  ],
});

test('readModelEntity embeds scalar value objects via @Embedded + @AttributeOverrides', () => {
  const ent = readModelEntity(vaRm());
  assert.match(ent.content, /@Embedded\s+@AttributeOverrides\(\{[^}]*policy_holder_name/s);
  assert.match(ent.content, /@AttributeOverride\(name = "name", column = @Column\(name = "policy_holder_name"\)\)/);
  assert.match(ent.content, /@AttributeOverride\(name = "surname", column = @Column\(name = "policy_holder_surname"\)\)/);
  assert.match(ent.content, /import jakarta.persistence.AttributeOverride;/);
  assert.match(ent.content, /import jakarta.persistence.Embedded;/);
});

test('readModelEntity keeps a list-bearing value object as JSON, not embedded', () => {
  const ent = readModelEntity(vaRm());
  assert.match(ent.content, /@JdbcTypeCode\(SqlTypes\.JSON\)\s+private PolicyCoverage coverage;/);
  assert.match(ent.content, /import org.hibernate.annotations.JdbcTypeCode;/);
  assert.doesNotMatch(ent.content, /@Embedded\s+private PolicyCoverage coverage;/);
});

test('valueObject marks scalar-only records @Embeddable and leaves list-bearing ones plain', () => {
  const scalar = valueObject({ className: 'PolicyHolder', package: 'x.domain', fields: [
    { name: 'name', javaType: 'String' },
    { name: 'surname', javaType: 'String' },
  ] });
  assert.match(scalar.content, /@Embeddable/);
  assert.match(scalar.content, /import jakarta.persistence.Embeddable;/);

  const listy = valueObject({ className: 'PolicyCoverage', package: 'x.domain', fields: [
    { name: 'coveragePeriod', javaType: 'String' },
    { name: 'riskList', javaType: 'List<String>' },
  ] });
  assert.doesNotMatch(listy.content, /@Embeddable/);
});

// --- persisting projector GET: server-side search on the list endpoint ----------

test('persistingProjector delegates search to the repository, no in-memory filter', () => {
  const eventsById = new Map([
    ['policy-issued', { id: 'policy-issued', name: 'Policy Issued', aggregate: 'policy', fields: [
      { name: 'policyHolder', javaType: 'PolicyHolder' },
      { name: 'policyNumber', javaType: 'String' },
    ] }],
  ]);
  const p = persistingProjector(vaRm(), eventsById, BASE);
  assert.match(p.content, /getPolicyList\(@RequestParam Map<String, String> search\)/);
  // Server-side: the projector asks the repository to run the search, never findAll()+filter.
  assert.match(p.content, /return repository\.findAllBySearch\(search\)\.stream\(\)/);
  assert.doesNotMatch(p.content, /\.filter\(e -> matches/);
  assert.doesNotMatch(p.content, /repository\.findAll\(\)/);
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

test('projectionDecider generates a throwing matches<Field> stub for a search-only field', () => {
  const rm = { ...vaRm(), deciderClassName: 'PolicyListProjectionDecider', searchOnlyFields: [{ label: 'policy coverage risk', name: 'policyCoverageRisk', searchOnly: true }] };
  const eventsById = new Map([
    ['policy-issued', { id: 'policy-issued', name: 'Policy Issued', aggregate: 'policy', fields: [
      { name: 'policyHolder', javaType: 'PolicyHolder' },
      { name: 'policyNumber', javaType: 'String' },
    ] }],
  ]);
  const p = persistingProjector(rm, eventsById, BASE);
  const deciderCollaborator = p.collaborators.find((c) => c.fieldName === 'decider');
  const d = deciderCollaborator.scaffold();
  assert.match(d.content, /public boolean matchesPolicyCoverageRisk\(String value, PolicyList entity\)/);
  assert.match(d.content, /UnsupportedOperationException/);
  assert.match(d.content, /\\"policy coverage risk\?\?\\" on read model 'policy-list' is a search criterion with no implementation yet/);
});

test('persistingProjector applies a post-query Java filter for a "??" field, delegating to the decider', () => {
  const rm = { ...vaRm(), deciderClassName: 'PolicyListProjectionDecider', searchOnlyFields: [{ label: 'policy coverage risk', name: 'policyCoverageRisk', searchOnly: true }] };
  const eventsById = new Map([
    ['policy-issued', { id: 'policy-issued', name: 'Policy Issued', aggregate: 'policy', fields: [
      { name: 'policyHolder', javaType: 'PolicyHolder' },
      { name: 'policyNumber', javaType: 'String' },
    ] }],
  ]);
  const p = persistingProjector(rm, eventsById, BASE);
  // The DB-level search call is unchanged; the "??" field is filtered afterward.
  assert.match(p.content, /repository\.findAllBySearch\(search\)\.stream\(\)/);
  assert.match(p.content, /\.filter\(r -> \{/);
  assert.match(p.content, /String v = search\.get\("policyCoverageRisk"\);/);
  assert.match(p.content, /decider\.matchesPolicyCoverageRisk\(v, r\)/);
  // The decider collaborator must now be wired in, even though no [bracketed]
  // field ever delegates a projected VALUE to it.
  assert.ok(p.collaborators.some((c) => c.fieldName === 'decider'));
});

test('persistingProjectorAbility exposes a search-capable DSL overload', () => {
  const a = persistingProjectorAbility(vaRm(), BASE, []);
  assert.match(a.content, /getPolicyList\(Map\.of\(\)\)/);
  assert.match(a.content, /expect_policy_list\(Map<String, String> search, Predicate<List<PolicyList>> testCase\)/);
  assert.match(a.content, /import java.util.Map;/);
});

// --- server-side repository search ---------------------------------------------

test('repository interface exposes findAllBySearch', () => {
  const r = readModelRepository(vaRm());
  assert.match(r.content, /List<PolicyListEntity> findAllBySearch\(Map<String, String> search\);/);
  assert.match(r.content, /import java.util.Map;/);
});

test('JPA repository searches server-side via Specification per field', () => {
  const j = readModelJpaRepository(vaRm());
  assert.match(j.content, /JpaSpecificationExecutor<PolicyListEntity>/);
  assert.match(j.content, /default List<PolicyListEntity> findAllBySearch\(Map<String, String> search\)/);
  assert.match(j.content, /cb\.like\(cb\.lower\(root\.get\("policyHolder"\)\.get\("name"\)\), "%" \+ search\.get\("policyHolder\.name"\)\.toLowerCase\(\) \+ "%"\)/);
  assert.match(j.content, /cb\.like\(cb\.lower\(root\.get\("policyHolder"\)\.get\("surname"\)\)/);
  assert.match(j.content, /cb\.like\(cb\.lower\(root\.get\("policyNumber"\)\)/);
  assert.match(j.content, /import org.springframework.data.jpa.domain.Specification;/);
  assert.match(j.content, /import org.springframework.data.jpa.repository.JpaSpecificationExecutor;/);
});

test('in-memory repository search mirrors the server-side semantics', () => {
  const i = readModelInMemoryRepository(vaRm());
  assert.match(i.content, /findAllBySearch\(Map<String, String> search\)/);
  assert.match(i.content, /case "policyHolder\.name" ->/);
  assert.match(i.content, /e\.getPolicyHolder\(\)\.name\(\)\.toLowerCase\(\)\.contains\(value\.toLowerCase\(\)\)/);
  assert.match(i.content, /case "policyNumber" ->/);
});

// --- field-level :Key composite key --------------------------------------------

const keyedRm = () => ({
  id: 'policy-list',
  className: 'PolicyList',
  package: VA_ENT,
  getterMethod: 'getPolicyList',
  getMapping: 'policy-list',
  dslMethod: 'expect_policy_list',
  entityClassName: 'PolicyListEntity',
  idClassName: 'PolicyListKey',
  projectorClassName: 'PolicyListProjector',
  abilityClassName: 'PolicyListProjectorAbility',
  repositoryClassName: 'PolicyListRepository',
  jpaRepositoryClassName: 'PolicyListJpaRepository',
  inMemoryRepositoryClassName: 'PolicyListInMemoryRepository',
  repositoryConstant: 'POLICY_LIST_REPOSITORY',
  tableName: 'policy_list',
  subscribes: ['policy-issued'],
  fields: [
    { name: 'policyNumber', label: 'policy number', javaType: 'String', imports: [], key: true },
    {
      name: 'policyHolder',
      label: 'policy holder',
      javaType: 'PolicyHolder',
      imports: ['pl.pjaworski.insurance_company.domain.PolicyHolder'],
      valueObject: { className: 'PolicyHolder', package: 'pl.pjaworski.insurance_company.domain' },
      embeds: true,
      attrs: [
        { name: 'name', javaType: 'String' },
        { name: 'surname', javaType: 'String' },
      ],
    },
  ],
  keyFields: [
    { name: 'policyNumber', label: 'policy number', javaType: 'String', imports: [], key: true },
  ],
});

test('parseField recognizes trailing :Key', () => {
  const f = parseField('policy number:Key');
  assert.equal(f.name, 'policyNumber');
  assert.equal(f.key, true);
  assert.equal(f.bracketed, false);
});

test('readModelKey emits @Embeddable record with key fields', () => {
  const keyClass = readModelKey(keyedRm());
  assert.equal(keyClass.className, 'PolicyListKey');
  assert.match(keyClass.content, /@Embeddable\s+public record PolicyListKey\(\s+String policyNumber\)/);
});

test('readModelEntity uses @EmbeddedId PolicyListKey when keyFields present', () => {
  const ent = readModelEntity(keyedRm());
  assert.match(ent.content, /@EmbeddedId\s+private PolicyListKey id;/);
  assert.doesNotMatch(ent.content, /UUID aggregateId/);
  assert.match(ent.content, /return new PolicyList\(id\.policyNumber\(\), policyHolder\);/);
});

test('persistingProjector saves entity with composite key when keyFields present', () => {
  const eventsById = new Map([
    ['policy-issued', {
      id: 'policy-issued',
      name: 'Policy Issued',
      package: 'pl.pjaworski.insurance_company.domain.events',
      className: 'PolicyIssuedEvent',
      typeEnum: 'POLICY_ISSUED',
      fields: [
        { name: 'policyHolder', javaType: 'PolicyHolder' },
        { name: 'policyNumber', javaType: 'String' },
      ],
    }],
  ]);
  const p = persistingProjector(keyedRm(), eventsById, BASE);
  assert.match(p.content, /repository\.save\(new PolicyListEntity\(new PolicyListKey\(projected\.policyNumber\(\)\), projected\.policyHolder\(\)\)\);/);
  // A non-identity key field has no accessor on the generic DomainEvent project()
  // receives — dispatch pattern-matches the concrete event class directly, so the
  // lookup key is built from the typed event in its own switch case, with no cast
  // and no hydrate().
  assert.match(p.content, /case PolicyIssuedEvent evt ->/);
  assert.match(p.content, /repository\.findById\(new PolicyListKey\(evt\.policyNumber\(\)\)\)/);
  assert.doesNotMatch(p.content, /\(\(PolicyIssuedEvent\) event\)/);
  assert.doesNotMatch(p.content, /hydrate\(/);
  assert.doesNotMatch(p.content, /event\.aggregateId\(\)/);
});

test('a persisting projector is a per-event mapper, never a stream-rebuild state projector', () => {
  const eventsById = new Map([
    ['policy-issued', {
      id: 'policy-issued',
      name: 'Policy Issued',
      package: 'pl.pjaworski.insurance_company.domain.events',
      className: 'PolicyIssuedEvent',
      typeEnum: 'POLICY_ISSUED',
      fields: [
        { name: 'policyHolder', javaType: 'PolicyHolder' },
        { name: 'policyNumber', javaType: 'String' },
      ],
    }],
  ]);
  const p = persistingProjector(keyedRm(), eventsById, BASE);
  // No whole-state machinery: the class does not implement StateProjector, hydrate
  // is never called, and apply() is a plain per-event mapper (not an @Override).
  assert.match(p.content, /public class PolicyListProjector implements PersistingProjector/);
  assert.doesNotMatch(p.content, /StateProjector/);
  assert.doesNotMatch(p.content, /hydrate\(/);
  assert.doesNotMatch(p.content, /@Override\s+public PolicyList apply/);
  assert.match(p.content, /project\(DomainEvent event\)/);
  assert.match(p.content, /case PolicyIssuedEvent evt ->/);
  assert.match(p.content, /default -> \{/);
  // A missing row is a create: apply() must run even when the lookup is empty, so
  // the row is never silently dropped on the first event for its key.
  assert.match(p.content, /\.orElse\(null\);/);
  assert.match(p.content, /apply\(state, evt\);/);
});


test('repositories use PolicyListKey as ID type when keyFields present', () => {
  const repo = readModelRepository(keyedRm());
  assert.match(repo.content, /Optional<PolicyListEntity> findById\(PolicyListKey id\);/);

  const jpa = readModelJpaRepository(keyedRm());
  assert.match(jpa.content, /JpaRepository<PolicyListEntity, PolicyListKey>/);

  const mem = readModelInMemoryRepository(keyedRm());
  assert.match(mem.content, /Map<PolicyListKey, PolicyListEntity> entities/);
  assert.match(mem.content, /entities\.put\(entity\.getId\(\), entity\);/);
});

// `:Key` on a whole value-object field (e.g. `* policy holder:Key`) makes every one
// of its attributes part of the composite key — not just the aggregate id. Distinct
// from the scalar-field case above: the embedded key component holds `f.attrs`, not
// a single scalar, and the record component must carry NO access modifier (a Java
// record component with `private` is a compile error caught by nothing but `javac`,
// which is exactly how this bug first shipped).
const embeddedKeyedRm = () => ({
  id: 'insured-policies',
  className: 'InsuredPolicies',
  package: VA_ENT,
  getterMethod: 'getInsuredPolicies',
  getMapping: 'insured-policies',
  dslMethod: 'expect_insured_policies',
  entityClassName: 'InsuredPoliciesEntity',
  idClassName: 'InsuredPoliciesKey',
  projectorClassName: 'InsuredPoliciesProjector',
  abilityClassName: 'InsuredPoliciesProjectorAbility',
  repositoryClassName: 'InsuredPoliciesRepository',
  jpaRepositoryClassName: 'InsuredPoliciesJpaRepository',
  inMemoryRepositoryClassName: 'InsuredPoliciesInMemoryRepository',
  repositoryConstant: 'INSURED_POLICIES_REPOSITORY',
  tableName: 'insured_policies',
  subscribes: ['policy-issued'],
  fields: [
    {
      name: 'policyKey',
      label: 'policy key',
      identity: true,
      javaType: 'UUID',
      imports: ['java.util.UUID'],
    },
    {
      name: 'policyHolder',
      label: 'policy holder',
      javaType: 'PolicyHolder',
      imports: ['pl.pjaworski.insurance_company.domain.PolicyHolder'],
      valueObject: { className: 'PolicyHolder', package: 'pl.pjaworski.insurance_company.domain' },
      embeds: true,
      key: true,
      attrs: [
        { name: 'name', javaType: 'String' },
        { name: 'surname', javaType: 'String' },
      ],
    },
    { name: 'noOfPolicies', label: 'no of policies', javaType: 'String', imports: [], bracketed: true },
  ],
  keyFields: [
    {
      name: 'policyHolder',
      label: 'policy holder',
      javaType: 'PolicyHolder',
      imports: ['pl.pjaworski.insurance_company.domain.PolicyHolder'],
      valueObject: { className: 'PolicyHolder', package: 'pl.pjaworski.insurance_company.domain' },
      embeds: true,
      key: true,
      attrs: [
        { name: 'name', javaType: 'String' },
        { name: 'surname', javaType: 'String' },
      ],
    },
  ],
});

test('readModelKey embeds a whole value-object key field with no modifier on the record component', () => {
  const keyClass = readModelKey(embeddedKeyedRm());
  assert.equal(keyClass.className, 'InsuredPoliciesKey');
  // A record component must be bare — `private` here is a compile error (javac:
  // "record components cannot have modifiers").
  assert.doesNotMatch(keyClass.content, /private PolicyHolder policyHolder/);
  assert.match(keyClass.content, /@Embeddable\s+public record InsuredPoliciesKey\(\s+@Embedded/);
  assert.match(keyClass.content, /PolicyHolder policyHolder\)/);
  assert.match(keyClass.content, /@AttributeOverride\(name = "name", column = @Column\(name = "policy_holder_name"\)\)/);
  assert.match(keyClass.content, /@AttributeOverride\(name = "surname", column = @Column\(name = "policy_holder_surname"\)\)/);
});

test('readModelEntity keeps a non-key identity field as a plain column alongside an embedded-object @EmbeddedId', () => {
  const ent = readModelEntity(embeddedKeyedRm());
  assert.match(ent.content, /@EmbeddedId\s+private InsuredPoliciesKey id;/);
  assert.match(ent.content, /private UUID policyKey;/);
  assert.doesNotMatch(ent.content, /private PolicyHolder policyHolder;/); // lives in the id, not as its own column
  assert.match(ent.content, /return new InsuredPolicies\(policyKey, id\.policyHolder\(\), noOfPolicies\);/);
});

test('persistingProjector looks state up by the embedded value-object key, not the aggregate id — so two events for the same holder merge into one row', () => {
  const eventsById = new Map([
    ['policy-issued', {
      id: 'policy-issued',
      name: 'Policy Issued',
      package: 'pl.pjaworski.insurance_company.domain.events',
      className: 'PolicyIssuedEvent',
      typeEnum: 'POLICY_ISSUED',
      fields: [{ name: 'policyHolder', javaType: 'PolicyHolder' }],
    }],
  ]);
const p = persistingProjector(embeddedKeyedRm(), eventsById, BASE);
  // project(DomainEvent event) only has DomainEvent's own members (aggregateId())
  // available on `event` — the concrete event is bound by per-event pattern
  // dispatch, so `.policyHolder()` is callable on `evt` without a cast.
  assert.match(p.content, /case PolicyIssuedEvent evt ->/);
  assert.match(p.content, /repository\.findById\(new InsuredPoliciesKey\(evt\.policyHolder\(\)\)\)/);
  assert.doesNotMatch(p.content, /\(\(PolicyIssuedEvent\) event\)/);
  assert.doesNotMatch(p.content, /hydrate\(/);
  assert.match(p.content, /repository\.save\(new InsuredPoliciesEntity\(new InsuredPoliciesKey\(projected\.policyHolder\(\)\), projected\.policyKey\(\), projected\.noOfPolicies\(\)\)\)/);
  assert.doesNotMatch(p.content, /repository\.findById\(event\.aggregateId\(\)\)/);
});

// --- implicit identity attribute: sourced from event.aggregateId() --------------

const IDENTITY_FIELD = {
  name: 'policyKey',
  label: 'policy key',
  identity: true,
  javaType: 'UUID',
  imports: ['java.util.UUID'],
};

const issuedEvent = (fields) => ({
  id: 'policy-issued',
  name: 'Policy Issued',
  package: 'pl.pjaworski.insurance_company.domain.events',
  className: 'PolicyIssuedEvent',
  fields,
});

test('resolveArg sources the identity attribute from the aggregate id, never a name match', () => {
  const r = resolveArg(IDENTITY_FIELD, { sourceFields: [], sourceExpr: 'event' });
  assert.equal(r.expr, 'event.aggregateId()');
  assert.deepEqual(r.imports, ['java.util.UUID']);
});

test('resolveArg refuses a list or nested mapping whose source shape differs', () => {
  assert.throws(
    () => resolveArg(
      { name: 'insuredParties', label: 'insured parties', list: true, children: [{ name: 'name', children: [] }] },
      {
        sourceFields: [
          { name: 'insuredParties', label: 'insured parties', list: true, children: [{ name: 'fullName', children: [] }] },
        ],
        sourceExpr: 'event',
      },
    ),
    /Unsupported structured-field mapping.*more detailed mapping prompt/,
  );
});

test('resolveArg delegates an unmappable structured field to the decider instead of throwing', () => {
  const field = { name: 'productName', label: 'product name', javaType: 'String', imports: [], unmappable: { reason: "field 'product name' cannot be derived automatically from 'product (list)'" } };
  const r = resolveArg(field, {
    sourceFields: [],
    sourceExpr: 'event',
    delegate: { fieldName: 'decider', args: 'state, event' },
  });
  assert.equal(r.delegated, true);
  assert.equal(r.expr, 'decider.productName(state, event)');
});

test('a projector for an unmappable structured read-model field generates but delegates to a throwing decider stub', () => {
  const rm = {
    id: 'stored-product',
    className: 'StoredProduct',
    package: 'pl.pjaworski.insurance_company.storedproduct',
    deciderClassName: 'StoredProductProjectionDecider',
    projectorClassName: 'StoredProductProjector',
    getterMethod: 'getStoredProduct',
    getMapping: 'stored-product/{aggregateId}',
    subscribes: ['products-added'],
    searchOnlyFields: [],
    keyFields: [],
    fields: [
      IDENTITY_FIELD,
      { name: 'productName', label: 'product name', javaType: 'String', imports: [], unmappable: { reason: "field 'product name' cannot be derived automatically from 'product (list)'" } },
    ],
  };
  const event = {
    id: 'products-added',
    name: 'Products Added',
    package: 'pl.pjaworski.insurance_company.domain.events',
    className: 'ProductsAddedEvent',
    fields: [{ name: 'productList', label: 'product', list: true, children: [{ name: 'name' }, { name: 'description' }], javaType: 'List<Product>', imports: [] }],
  };
  const p = projector(rm, new Map([['products-added', event]]), BASE);
  assert.match(p.content, /decider\.productName\(state, event\)/);
  const decider = p.collaborators.find((c) => c.scaffold).scaffold();
  assert.match(decider.content, /public String productName\(StoredProduct state, ProductsAddedEvent event\)/);
  assert.match(decider.content, /throw new UnsupportedOperationException\(/);
  assert.match(decider.content, /cannot be derived automatically from 'product \(list\)'/);
});

test('a persisting projector for an unresolvable named key delegates the key to a throwing decider stub and keeps generating', () => {
  const rm = {
    id: 'stored-product',
    className: 'StoredProduct',
    package: `${BASE}.storedproduct`,
    getterMethod: 'getStoredProduct',
    getMapping: 'stored-product',
    dslMethod: 'expect_stored_product',
    entityClassName: 'StoredProductEntity',
    idClassName: 'StoredProductKey',
    abilityClassName: 'StoredProductProjectorAbility',
    repositoryClassName: 'StoredProductRepository',
    repositoryConstant: 'STORED_PRODUCT_REPOSITORY',
    tableName: 'stored_product',
    subscribes: ['products-added'],
    searchOnlyFields: [],
    keyFields: [
      { name: 'productCode', label: 'productCode', key: true, javaType: 'String', imports: [], unmappableKey: { reason: "key attribute 'productCode:Key' matches no declared field's value-object attribute" } },
    ],
    fields: [
      { name: 'productCode', label: 'product code', javaType: 'String', imports: [], unmappable: { reason: "field 'product code' cannot be derived automatically from 'product (list)'" } },
      { name: 'productName', label: 'product name', javaType: 'String', imports: [], unmappable: { reason: "field 'product name' cannot be derived automatically from 'product (list)'" } },
      { name: 'productDescription', label: 'product description', javaType: 'String', imports: [], unmappable: { reason: "field 'product description' cannot be derived automatically from 'product (list)'" } },
    ],
  };
  const event = {
    id: 'products-added',
    name: 'Products Added',
    package: `${BASE}.domain.events`,
    className: 'ProductsAddedEvent',
    typeEnum: 'PRODUCTS_ADDED',
    fields: [{ name: 'productList', label: 'product', list: true, children: [{ name: 'code' }, { name: 'name' }, { name: 'description' }], javaType: 'List<Product>', imports: [] }],
  };
  const p = persistingProjector(rm, new Map([['products-added', event]]), BASE);
  // apply: the composite key is delegated to the decider over the concrete event.
  assert.match(p.content, /new StoredProductKey\(decider\.productCode\(state, event\)\)/);
  // project(): per-event typed dispatch delegates the lookup key to the decider's
  // DomainEvent overload with the bound concrete event.
  assert.match(p.content, /case ProductsAddedEvent evt ->/);
  assert.match(p.content, /new StoredProductKey\(decider\.productCode\(evt\)\)/);
  // The decider collaborator must be wired even though no regular field delegates.
  assert.ok(p.collaborators.some((c) => c.fieldName === 'decider'));
  const decider = p.collaborators.find((c) => c.scaffold).scaffold();
  assert.match(decider.content, /public String productCode\(StoredProduct state, ProductsAddedEvent event\)/);
  assert.match(decider.content, /public String productCode\(DomainEvent event\)/);
  assert.match(decider.content, /throw new UnsupportedOperationException\(/);
  assert.match(decider.content, /productCode:Key/);
  assert.match(decider.content, /import .*\.eventstream\.DomainEvent;/);
  // The model's SAME-named flat field (* product code) is also unmappable — its
  // stub must NOT be emitted a second time, or the class has a duplicate overload.
  const stateEventOverload = 'public String productCode(StoredProduct state, ProductsAddedEvent event)';
  assert.equal(
    decider.content.split(stateEventOverload).length - 1,
    1,
    'the unmappableKey key stub and a same-named unmappable field must collapse to one overload',
  );
  assert.ok(
    !decider.content.includes("field 'product code' cannot be derived automatically"),
    'the same-named unmappable field stub must not be emitted separately',
  );
  // The composite id keeps a plain String component (fallback type), so the whole
  // slice compiles while the key decision throws at runtime until implemented.
  const key = readModelKey(rm);
  assert.match(key.content, /@Embeddable\s+public record StoredProductKey\(\s+String productCode\)/);
});

test('an on-demand projector folds the identity attribute from event.aggregateId()', () => {
  const rm = {
    id: 'policy-details',
    className: 'PolicyDetails',
    package: 'pl.pjaworski.insurance_company.policydetails',
    deciderClassName: 'PolicyDetailsProjectionDecider',
    projectorClassName: 'PolicyDetailsProjector',
    getterMethod: 'getPolicyDetails',
    getMapping: 'policy-details/{aggregateId}',
    subscribes: ['policy-issued'],
    keyFields: [],
    fields: [IDENTITY_FIELD, { name: 'policyHolder', label: 'policy holder', javaType: 'String', imports: [] }],
  };
  const p = projector(rm, new Map([['policy-issued', issuedEvent([{ name: 'policyHolder', javaType: 'String' }])]]), BASE);
  assert.match(p.content, /return new PolicyDetails\(\s+event\.aggregateId\(\),\s+event\.policyHolder\(\)/s);
});

test('a persisting projector saves the identity attribute from event.aggregateId()', () => {
  const rm = { ...vaRm(), fields: [IDENTITY_FIELD, ...vaRm().fields] };
  const p = persistingProjector(rm, new Map([['policy-issued', issuedEvent([{ name: 'policyHolder', javaType: 'PolicyHolder' }, { name: 'policyNumber', javaType: 'String' }])]]), BASE);
  assert.match(p.content, /var projected = new PolicyList\(\s+event\.aggregateId\(\),/s);
  assert.match(p.content, /repository\.save\(new PolicyListEntity\(event\.aggregateId\(\), projected\.policyKey\(\),/);
});

test('an identity field marked :Key is a composite member looked up by the aggregate id', () => {
  const rm = (() => {
    const base = keyedRm();
    const identity = { ...IDENTITY_FIELD, key: true };
    return {
      ...base,
      fields: [identity, ...base.fields.filter((f) => f.name !== 'policyNumber')],
      keyFields: [identity],
    };
  })();
  const p = persistingProjector(rm, new Map([['policy-issued', issuedEvent([{ name: 'policyHolder', javaType: 'PolicyHolder' }])]]), BASE);
  assert.match(p.content, /repository\.findById\(new PolicyListKey\(evt\.aggregateId\(\)\)\)/);
  assert.match(p.content, /new PolicyListEntity\(new PolicyListKey\(projected\.policyKey\(\)\), projected\.policyHolder\(\)\)/);

  const keyClass = readModelKey(rm);
  assert.match(keyClass.content, /import java\.util\.UUID;/);
  assert.match(keyClass.content, /UUID policyKey/);
});

test('a :Key field is never a search path — it lives in the @EmbeddedId', () => {
  const rm = (() => {
    const base = keyedRm();
    const identity = { ...IDENTITY_FIELD, key: true, searchable: true };
    return { ...base, fields: [identity, ...base.fields], keyFields: [identity] };
  })();
  const j = readModelJpaRepository(rm);
  assert.doesNotMatch(j.content, /policyKey/);
  const mem = readModelInMemoryRepository(rm);
  assert.doesNotMatch(mem.content, /case "policyKey"/);
});

// --- header ownership wording --------------------------------------------------
// `logic` classes are scaffolded then owned: the header must say hand edits are
// kept and drift is reported — never "edits here are overwritten". Data/contract
// files keep the plain add-only wording.

test('a GENERATED file carries no header — the patch answers that, and stays current', () => {
  // A "// GENERATED from X" comment is a cached answer to a question `--patch`
  // computes from the model. It costs a line per file, nothing reads it, and it
  // goes stale the moment an element leaves the model.
  const c = { ...naming.command(BASE, 'issue-policy'), id: 'issue-policy', fields: [cmdField('policy holder')] };
  const e = { ...naming.event(BASE, 'policy-issued'), id: 'policy-issued', fields: [cmdField('policy holder')] };
  const rm = keyedRm();

  const files = [
    command(c),
    commandHandler(c, [e], BASE),
    readModelEntity(rm),
    readModelRepository(rm),
    persistingProjector(rm, new Map([['policy-issued', e]]), BASE),
  ];
  for (const f of files) {
    assert.match(f.content, /^package /, `${f.className} must start at its package declaration`);
    assert.doesNotMatch(f.content, /GENERATED/);
    assert.doesNotMatch(f.content, /DO NOT EDIT/);
  }
});

test('a `once` file keeps its header — scaffold-version is state the patch cannot compute', () => {
  const e = { ...naming.event(BASE, 'policy-issued'), id: 'policy-issued', aggregate: 'policy', fields: [] };
  const aggregateFile = aggregate('policy', [e], BASE);
  assert.match(aggregateFile.content, /^\/\/ SCAFFOLDED ONCE/);
  assert.match(aggregateFile.content, /scaffold-version: \d+/);
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
import { parseModel } from './parse.js';

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
product:Key
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

test('CLI: an unresolvable named key generates a full project, warning prints, and --check exits 0 (warnings are non-blocking)', () => {
  const project = mkdtempSync(path.join(tmpdir(), 'codegen-project-'));
  const docs = path.join(project, 'docs');
  const src = path.join(project, 'src');
  mkdirSync(docs, { recursive: true });
  mkdirSync(src, { recursive: true });
  const cli = path.dirname(fileURLToPath(import.meta.url));
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
