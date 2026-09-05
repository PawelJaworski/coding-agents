import test from 'node:test';
import assert from 'node:assert/strict';
import naming from './naming.js';
import { parseSections, parseField, parseDefinitions } from './parse.js';
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
  commandDecider,
  valueObject,
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
  assert.equal(c.deciderClassName, 'IssuePolicyDecider');
  assert.equal(c.package, `${BASE}.issuepolicy`);
  assert.equal(c.postMapping, 'issue-policy');
  assert.equal(c.dslMethod, 'issue_policy');
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
    label: 'policy holder', name: 'policyHolder', bracketed: false, convention: null,
  });
  assert.deepEqual(parseField('[policy number]'), {
    label: 'policy number', name: 'policyNumber', bracketed: true, convention: null,
  });
  assert.deepEqual(parseField('[created at]:now'), {
    label: 'created at', name: 'createdAt', bracketed: true, convention: 'now',
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

const DECIDER = collaborator({
  fieldName: 'decider',
  className: 'IssuePolicyDecider',
  testInstantiation: 'new IssuePolicyDecider()',
  scaffold: () => ({ className: 'IssuePolicyDecider', once: true }),
});

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
    fieldDeclarations([EVENT_STREAM, DECIDER]),
    '    private final EventStream eventStream;\n' +
      '    private final IssuePolicyDecider decider;',
  );
});

test('a single collaborator emits no stray separator', () => {
  assert.equal(fieldDeclarations([EVENT_STREAM]), '    private final EventStream eventStream;');
});

test('constructor args use each collaborator\'s own instantiation form', () => {
  // The whole reason this is per-collaborator DATA and not a rule: a decider is
  // built fresh, a repository is a shared registered static. Both are ordinary
  // collaborators; only this string differs.
  assert.equal(
    constructorArgs([REPOSITORY, DECIDER]),
    'PolicyListProjectorAbility.POLICY_LIST_REPOSITORY, new IssuePolicyDecider()',
  );
  assert.equal(
    constructorArgs([EVENT_STREAM, DECIDER]),
    'EventStreamAbility.INSTANCE, new IssuePolicyDecider()',
  );
});

test('constructor args and field declarations agree on arity and order', () => {
  const cs = [EVENT_STREAM, DECIDER, REPOSITORY];
  assert.equal(constructorArgs(cs).split(', ').length, fieldDeclarations(cs).split('\n').length);
  assert.equal(constructorArgs([]), '');
  assert.equal(fieldDeclarations([]), '');
});

test('collaborator imports are collected, including from same-package kinds that have none', () => {
  assert.deepEqual(collaboratorImports([EVENT_STREAM, DECIDER]), [`${BASE}.eventstream.EventStream`]);
  assert.deepEqual(collaboratorImports([DECIDER, REPOSITORY]), []);
});

test('only collaborators carrying a scaffold contribute a file', () => {
  const files = collaboratorScaffolds([EVENT_STREAM, DECIDER, REPOSITORY]);
  assert.equal(files.length, 1);
  assert.equal(files[0].className, 'IssuePolicyDecider');
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
  const cs = [EVENT_STREAM, validator, DECIDER];
  assert.equal(
    fieldDeclarations(cs),
    '    private final EventStream eventStream;\n' +
      '    private final IssuePolicyValidator validator;\n' +
      '    private final IssuePolicyDecider decider;',
  );
  assert.equal(
    constructorArgs(cs),
    'EventStreamAbility.INSTANCE, new IssuePolicyValidator(), new IssuePolicyDecider()',
  );
  assert.deepEqual(collaboratorScaffolds(cs).map((f) => f.className), [
    'IssuePolicyValidator',
    'IssuePolicyDecider',
  ]);
});

// --- resolveArg --------------------------------------------------------------

const field = (over = {}) => ({ name: 'policyNumber', label: 'policy number', imports: [], ...over });

test('a convention field resolves to its expression, never to a collaborator', () => {
  const r = resolveArg(
    field({ convention: 'uuid', conventionExpr: 'UUID.randomUUID()', imports: ['java.util.UUID'] }),
    { sourceFields: [], sourceExpr: 'command', delegate: DECIDER },
  );
  assert.equal(r.expr, 'UUID.randomUUID()');
  assert.ok(!r.delegated);
});

test('a passthrough field is derived from the source, not delegated', () => {
  const r = resolveArg(field({ name: 'policyHolder' }), {
    sourceFields: [{ name: 'policyHolder' }],
    sourceExpr: 'command',
    delegate: DECIDER,
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
    delegate: DECIDER,
  });
  assert.equal(r.expr, 'decider.policyNumber()');
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
    delegate: { ...DECIDER, args: 'state, event' },
  });
  assert.equal(r.expr, 'decider.policyNumber(state, event)');
});

test('an unresolvable field returns null so the caller can raise a model gap', () => {
  assert.equal(
    resolveArg(field(), { sourceFields: [], sourceExpr: 'command', delegate: DECIDER }),
    null,
  );
});

test('a fallback resolves what the source cannot supply', () => {
  const r = resolveArg(field(), {
    sourceFields: [],
    sourceExpr: 'event',
    delegate: DECIDER,
    fallback: (f) => `state == null ? null : state.${f.name}()`,
  });
  assert.equal(r.expr, 'state == null ? null : state.policyNumber()');
});

// --- the command's logic seam ------------------------------------------------
// A business rule constrains a command, not a field, so it cannot depend on the
// [bracket] convention. These pin the seam down: it must exist for EVERY command,
// or a rule on an unbracketed command has nowhere to live but a generated file or
// the model — and both are forbidden during development.

const cmdField = (label, javaType = 'String') => ({ ...parseField(label), javaType, imports: [] });

test('a command with NO bracketed field still gets its decider seam', () => {
  const c = { ...naming.command(BASE, 'issue-policy'), id: 'issue-policy', fields: [cmdField('policy holder')] };
  const e = { ...naming.event(BASE, 'policy-issued'), id: 'policy-issued', fields: [cmdField('policy holder')] };

  const handler = commandHandler(c, e, BASE);
  assert.match(handler.content, /private final IssuePolicyDecider decider;/);
  assert.match(handler.content, /decider\.check\(command\);/);
});

test('check() is emitted empty — "no rule yet" is a legitimate state, unlike an undecided [bracket]', () => {
  const c = { ...naming.command(BASE, 'issue-policy'), id: 'issue-policy', fields: [cmdField('policy holder')] };
  const e = { ...naming.event(BASE, 'policy-issued'), id: 'policy-issued', fields: [cmdField('policy holder')] };

  const scaffold = commandDecider(c, e);
  assert.match(scaffold.content, /public void check\(IssuePolicyCmd command\) \{\n    \}/);
  assert.doesNotMatch(scaffold.content, /check[\s\S]*UnsupportedOperationException/);
  assert.equal(scaffold.once, true);
});

test('the seam carries no field, rule or validator name from the generator', () => {
  const c = { ...naming.command(BASE, 'issue-policy'), id: 'issue-policy', fields: [cmdField('policy holder')] };
  const e = {
    ...naming.event(BASE, 'policy-issued'),
    id: 'policy-issued',
    fields: [cmdField('policy holder'), cmdField('[policy number]')],
  };

  const scaffold = commandDecider(c, e);
  // The [bracketed] decision is still stubbed loudly...
  assert.match(scaffold.content, /public String policyNumber\(\)[\s\S]*UnsupportedOperationException/);
  // ...but nothing about the RULES is baked in: no per-attribute guard, no validator.
  assert.doesNotMatch(scaffold.content, /surname|notBlank|Validator|required/i);
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
    },
    { name: 'policyNumber', label: 'policy number', javaType: 'String', imports: [] },
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
      fields: [
        { name: 'policyHolder', javaType: 'PolicyHolder' },
        { name: 'policyNumber', javaType: 'String' },
      ],
    }],
  ]);
  const p = persistingProjector(keyedRm(), eventsById, BASE);
  assert.match(p.content, /repository\.save\(new PolicyListEntity\(new PolicyListKey\(projected\.policyNumber\(\)\), projected\.policyHolder\(\)\)\);/);
  assert.match(p.content, /repository\.findById\(new PolicyListKey\(event\.policyNumber\(\)\)\)/);
  assert.doesNotMatch(p.content, /event\.aggregateId\(\)/);
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
    commandHandler(c, e, BASE),
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
  const c = { ...naming.command(BASE, 'issue-policy'), id: 'issue-policy', fields: [cmdField('policy holder')] };
  const e = { ...naming.event(BASE, 'policy-issued'), id: 'policy-issued', fields: [cmdField('policy holder')] };
  const decider = commandDecider(c, e);
  assert.match(decider.content, /^\/\/ SCAFFOLDED ONCE/);
  assert.match(decider.content, /scaffold-version: \d+/);
});
