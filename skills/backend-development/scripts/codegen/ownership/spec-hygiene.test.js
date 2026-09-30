import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  scanSpecContent,
  isForbiddenConstruction,
  forbiddenSuggestion,
  checkSpecHygiene,
} from './spec-hygiene.js';

test('scanSpecContent: flags production collaborators constructed in a spec', () => {
  const violations = scanSpecContent(
    'class XSpec {\n' +
      '  def r = new IssuedPoliciesInMemoryRepository()\n' +
      '  def h = new IssuePolicyHandler(a, b)\n' +
      '}\n',
  );
  assert.deepEqual(
    violations.map((v) => v.type),
    ['IssuedPoliciesInMemoryRepository', 'IssuePolicyHandler'],
  );
  assert.equal(violations[0].line, 2);
  assert.equal(violations[0].suggestion, 'IssuedPoliciesProjectorAbility');
  assert.equal(violations[1].suggestion, 'IssuePolicyAbility');
});

test('scanSpecContent: allows value objects, commands and external DTOs', () => {
  const violations = scanSpecContent(
    'class XSpec {\n' +
      '  def h = new PolicyHolder("a", "b")\n' +
      '  def c = new IssuePolicyCmd(p, q)\n' +
      '  def e = new ApplicationReceivedExternal(m)\n' +
      '}\n',
  );
  assert.deepEqual(violations, []);
});

test('scanSpecContent: ignores comments and string literals', () => {
  const violations = scanSpecContent(
    '// new IssuePolicyHandler(a)\n' +
      '/* new IssuePolicyHandler(a) */\n' +
      'def s = "new IssuePolicyHandler(a)"\n' +
      'def t = \'new IssuePolicyHandler(a)\'\n',
  );
  assert.deepEqual(violations, []);
});

test('isForbiddenConstruction: exact runtime wiring and collaborator suffixes', () => {
  assert.equal(isForbiddenConstruction('EventStreamImpl'), true);
  assert.equal(isForbiddenConstruction('AggregateIdSequence'), true);
  assert.equal(isForbiddenConstruction('PolicyIssuedEvent'), true);
  assert.equal(isForbiddenConstruction('IssuedPoliciesEntity'), true);
  assert.equal(isForbiddenConstruction('PolicyHolder'), false);
  assert.equal(isForbiddenConstruction('IssuePolicyCmd'), false);
});

test('forbiddenSuggestion: names the ability that owns the collaborator', () => {
  assert.equal(forbiddenSuggestion('EventStreamImpl'), 'EventStreamAbility');
  assert.equal(forbiddenSuggestion('AggregateIdSequence'), 'AggregateIdSequenceAbility');
  assert.equal(forbiddenSuggestion('IssuePolicyHandler'), 'IssuePolicyAbility');
  assert.equal(forbiddenSuggestion('IssuedPoliciesProjector'), 'IssuedPoliciesProjectorAbility');
  assert.equal(forbiddenSuggestion('PolicyDetailsInMemoryRepository'), 'PolicyDetailsProjectorAbility');
});

test('checkSpecHygiene: scans only *Spec.groovy and reports file-relative paths', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-hygiene-'));
  try {
    const specDir = path.join(dir, 'pl', 'demo');
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(
      path.join(specDir, 'DemoSpec.groovy'),
      'class DemoSpec {\n  def r = new DemoRepository()\n}\n',
    );
    fs.writeFileSync(path.join(specDir, 'Helper.groovy'), 'class Helper {\n  def r = new DemoRepository()\n}\n');
    const violations = checkSpecHygiene({ groovyTestRoot: dir, projectRoot: dir });
    assert.equal(violations.length, 1);
    assert.equal(violations[0].file, path.join('pl', 'demo', 'DemoSpec.groovy'));
    assert.equal(violations[0].type, 'DemoRepository');
    assert.equal(violations[0].line, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
