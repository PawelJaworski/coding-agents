import test from 'node:test';
import assert from 'node:assert/strict';
import naming from './naming.js';
import { parseSections, parseField, parseDefinitions } from './parse.js';
import {
  parseScaffoldVersion,
  stampScaffoldVersion,
  leadingCommentBlock,
  misplacedSpecs,
} from './scaffold.js';
import { runtimeFiles } from './runtime.js';

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
