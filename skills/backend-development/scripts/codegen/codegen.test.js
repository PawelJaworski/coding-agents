import test from 'node:test';
import assert from 'node:assert/strict';
import naming from './naming.js';
import { parseSections, parseField, parseDefinitions } from './parse.js';

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
