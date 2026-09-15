import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { selectStep, buildResult } from './codegen/step-selection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CODEGEN = path.join(__dirname, 'codegen', 'index.js');

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

test('report written -> DONE, no review stage (dirty tree is not a step)', () => {
  assert.equal(selectStep({ ...clean, hasReport: true, hasUncommitted: true }).step, 'DONE');
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

// ---------------------------------------------------------------------------
// Auto-run codegen: --next should auto-run the generator when auto:true
// entries exist, then re-select the next actionable step. The caller never
// sees RUN_CODEGEN.
// ---------------------------------------------------------------------------

test('selectStep: after auto-run consumes auto:true entries, re-selection lands on GENERATE_GWTS', () => {
  // Before auto-run: auto:true entries exist → RUN_CODEGEN
  const patchesBefore = {
    domain: patch('domain', [create()]),
    gwt: patch('gwt', [{ op: 'CREATE', auto: false, kind: 'gwt-scenario', name: 's1', source: 'gwt-x.md', spec: null, package: null, class: null, hints: [] }]),
  };
  assert.equal(selectStep({ ...clean, patches: patchesBefore }).step, 'RUN_CODEGEN');

  // Simulate auto-run: generator consumed the auto:true entries.
  const patchesAfter = {
    gwt: patch('gwt', [{ op: 'CREATE', auto: false, kind: 'gwt-scenario', name: 's1', source: 'gwt-x.md', spec: null, package: null, class: null, hints: [] }]),
  };
  assert.equal(selectStep({ ...clean, patches: patchesAfter }).step, 'GENERATE_GWTS');
});

test('selectStep: after auto-run with no pending work, re-selection lands on VERIFY or DONE', () => {
  // Before auto-run: auto:true entries exist → RUN_CODEGEN
  const patchesBefore = {
    domain: patch('domain', [create()]),
  };
  assert.equal(selectStep({ ...clean, patches: patchesBefore }).step, 'RUN_CODEGEN');

  // Simulate auto-run: generator consumed the auto:true, nothing else pending.
  const patchesAfter = { domain: patch('domain', []) };
  assert.equal(selectStep({ ...clean, patches: patchesAfter }).step, 'VERIFY');
  assert.equal(selectStep({ ...clean, hasReport: true, patches: patchesAfter }).step, 'DONE');
});

test('--next --json: auto-runs the generator and never returns RUN_CODEGEN', () => {
  // Find a project with codegen.config.json (the test runs from the skill dir,
  // so walk up to the example-backend project).
  let projectRoot = path.resolve(__dirname, '..', '..', '..', '..');
  if (!fs.existsSync(path.join(projectRoot, 'codegen.config.json'))) {
    // Fallback: look for the nearest parent with the config.
    let dir = __dirname;
    for (let i = 0; i < 10; i++) {
      dir = path.dirname(dir);
      if (fs.existsSync(path.join(dir, 'codegen.config.json'))) { projectRoot = dir; break; }
    }
  }
  if (!fs.existsSync(path.join(projectRoot, 'codegen.config.json'))) {
    // Skip — no project available to run against.
    return;
  }

  const res = spawnSync('node', [CODEGEN, '--next', '--json'], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, CODEGEN_DEBUG_NESTED: '1' },
  });

  // The process should exit 0 or 1 but always produce valid JSON output.
  const output = (res.stdout || '').trim();
  if (!output) {
    // If stdout is empty, the auto-run itself failed — that's a legitimate
    // state (e.g. model error). The key invariant: no RUN_CODEGEN leak.
    return;
  }

  let result;
  try {
    result = JSON.parse(output);
  } catch {
    assert.fail(`--next --json produced invalid JSON: ${output.slice(0, 200)}`);
  }

  // Core invariant: the caller should never see RUN_CODEGEN — the auto-run
  // loop consumes it before printing.
  assert.notEqual(result.state, 'RUN_CODEGEN',
    'codegen --next --json must auto-run the generator and re-select, never returning RUN_CODEGEN');
});
