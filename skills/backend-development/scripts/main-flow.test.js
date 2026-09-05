import test from 'node:test';
import assert from 'node:assert/strict';
import { selectStep, buildResult } from './main-flow.js';

const patch = (category, entries) => ({ category, entries });
const create = (over = {}) => ({ op: 'CREATE', auto: true, category: 'domain', ...over });
const update = (over = {}) => ({
  op: 'UPDATE',
  auto: false,
  category: 'domain',
  package: 'a.b',
  class: 'C',
  path: 'src/main/java/a/b/C.java',
  owner: 'yours',
  members: [],
  hints: ['h'],
  ...over,
});

const clean = { modelError: null, patches: {}, hasReport: false, hasUncommitted: false };

test('a model error outranks everything — code is never the place to fix it', () => {
  assert.equal(
    selectStep({ ...clean, modelError: 'unknown event', patches: { domain: patch('domain', [update()]) } }).step,
    'MODEL_ERROR',
  );
});

test('the generator does its own work first: any auto entry means RUN_CODEGEN', () => {
  const patches = {
    domain: patch('domain', [update()]),
    events: patch('events', [create({ category: 'events' })]),
  };
  assert.equal(selectStep({ ...clean, patches }).step, 'RUN_CODEGEN');
});

test('an auto entry is picked before an agent item even in a later category', () => {
  // Running codegen changes the diff, so an agent item chosen first could already
  // be obsolete by the time it is applied.
  const patches = { readmodels: patch('readmodels', [create({ category: 'readmodels' })]) };
  assert.equal(selectStep({ ...clean, patches }).step, 'RUN_CODEGEN');
});

test('GENERATE_* steps are visited in a fixed order', () => {
  const patches = {
    readmodels: patch('readmodels', [update({ category: 'readmodels' })]),
    events: patch('events', [update({ category: 'events' })]),
  };
  assert.equal(selectStep({ ...clean, patches }).step, 'GENERATE_EVENTS');
});

test('GWT scenarios come after every structural category', () => {
  const patches = {
    gwt: patch('gwt', [{ op: 'CREATE', auto: false, kind: 'business-rule', name: 'r', hints: [] }]),
    commands: patch('commands', [update({ category: 'commands' })]),
  };
  assert.equal(selectStep({ ...clean, patches }).step, 'GENERATE_COMMANDS');
});

test('nothing pending and no report -> VERIFY', () => {
  assert.equal(selectStep({ ...clean, patches: { domain: patch('domain', []) } }).step, 'VERIFY');
});

test('report written, tree dirty -> REVIEW; tree clean -> DONE', () => {
  assert.equal(selectStep({ ...clean, hasReport: true, hasUncommitted: true }).step, 'REVIEW');
  assert.equal(selectStep({ ...clean, hasReport: true, hasUncommitted: false }).step, 'DONE');
});

test('an auto:true-only patch never produces an agent item', () => {
  // Regression guard: `auto` entries must not leak into a GENERATE_* prompt.
  const patches = { domain: patch('domain', [create()]) };
  const result = buildResult({ step: 'GENERATE_DOMAIN', item: 0 }, patches);
  assert.equal(result.next.detail, 'GENERATE_DOMAIN');
  assert.match(result.next.prompt, /generator's own work/);
});

test('DONE carries no prompt', () => {
  const result = buildResult({ step: 'DONE', item: 0 }, {});
  assert.equal(result.next, null);
  assert.equal(result.state, 'DONE');
});

test('MODEL_ERROR forbids both fixing it in code and editing the model', () => {
  const result = buildResult({ step: 'MODEL_ERROR', item: 0 }, {}, 'no such event: foo');
  assert.match(result.next.prompt, /no such event: foo/);
  assert.match(result.next.prompt, /do NOT fix this in code/i);
  assert.match(result.next.prompt, /development-report\.md/);
});

test('a GENERATE_* result reports how many items remain in the step', () => {
  const patches = { domain: patch('domain', [update(), update({ class: 'D' })]) };
  const result = buildResult({ step: 'GENERATE_DOMAIN', item: 0 }, patches);
  assert.equal(result.state, 'GENERATE');
  assert.equal(result.remaining, 1);
  assert.equal(result.next.detail.class, 'C');
});
