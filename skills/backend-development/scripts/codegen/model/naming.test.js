// Naming rules: class names and packages are COMPUTED from the model, never
// looked up. A "code index" would go stale the moment the model moves.

import test from 'node:test';
import assert from 'node:assert/strict';
import naming from './naming.js';

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

test('row-list read model drops the {aggregateId} path variable (it spans aggregates)', () => {
  const rm = naming.readModel(BASE, 'policy-list', { collection: true });
  assert.equal(rm.getMapping, 'policy-list');
  assert.equal(rm.entityClassName, 'PolicyListEntity');
  assert.equal(rm.repositoryClassName, 'PolicyListRepository');
  assert.equal(rm.jpaRepositoryClassName, 'PolicyListJpaRepository');
  assert.equal(rm.inMemoryRepositoryClassName, 'PolicyListInMemoryRepository');
  assert.equal(rm.repositoryConstant, 'POLICY_LIST_REPOSITORY');
  assert.equal(rm.tableName, 'policy_list');
});
