// Cross-package contract, asserted against files from several steps.
//
// Header ownership wording: `logic` classes are scaffolded then owned, so the
// header must say hand edits are kept and drift is reported — never "edits here
// are overwritten". Data/contract files keep the plain add-only wording.

import test from 'node:test';
import assert from 'node:assert/strict';
import naming from './model/naming.js';
import { parseField } from './model/parse.js';
import { createEmitContext } from './core/context.js';
import { aggregateFile } from './steps/domain/index.js';
import { command, commandHandler } from './steps/commands/index.js';
import { readModelEntity, readModelRepository, persistingProjector } from './steps/readmodels/index.js';

const BASE = 'pl.pjaworski.insurance_company';
const CTX = createEmitContext({ basePackage: BASE });
const cmdField = (label, javaType = 'String') => ({ ...parseField(label), javaType, imports: [] });

const keyedRm = () => ({
  id: 'policy-list',
  className: 'PolicyList',
  package: `${BASE}.policylist`,
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
  ],
  keyFields: [
    { name: 'policyNumber', label: 'policy number', javaType: 'String', imports: [], key: true },
  ],
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
    command(c, CTX),
    commandHandler(c, [e], CTX),
    readModelEntity(rm),
    readModelRepository(rm),
    persistingProjector(rm, new Map([['policy-issued', e]]), CTX),
  ];
  for (const f of files) {
    assert.match(f.content, /^package /, `${f.className} must start at its package declaration`);
    assert.doesNotMatch(f.content, /GENERATED/);
    assert.doesNotMatch(f.content, /DO NOT EDIT/);
  }
});

test('a `once` file carries no banner — its template version is bookkeeping, not content', () => {
  const e = { ...naming.event(BASE, 'policy-issued'), id: 'policy-issued', aggregate: 'policy', fields: [] };
  const agg = aggregateFile('policy', [e], CTX);
  assert.match(agg.content, /^package /, 'a once file starts at its package declaration like any other');
  assert.doesNotMatch(agg.content, /SCAFFOLDED|scaffold-version|PRESERVED-BY-HAND|DO NOT EDIT/);
  // Which template a `once` file was born from cannot be recomputed from its
  // (diverged) body, so the emitter carries the number and the generator records
  // it in generator-state.json. Stamping it into the source would be a cached
  // answer that costs a line per file and can go stale.
  assert.ok(Number.isInteger(agg.version) && agg.version >= 1);
});

