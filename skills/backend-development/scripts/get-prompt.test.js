import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStep, renderEntry, pendingEntries, STEPS, GENERATE_STEPS } from './get-prompt.js';

const entry = (over = {}) => ({
  op: 'UPDATE',
  auto: false,
  category: 'commands',
  package: 'a.b.issuepolicy',
  class: 'IssuePolicyHandler',
  path: 'src/main/java/a/b/issuepolicy/IssuePolicyHandler.java',
  owner: 'yours',
  members: ['void handle(IssuePolicyCmd cmd)'],
  hints: ['some hint'],
  ...over,
});

test('every GENERATE step is a known step', () => {
  for (const s of GENERATE_STEPS) assert.ok(STEPS.includes(s));
});

test('pendingEntries hides the generator\'s own work', () => {
  const patch = { entries: [entry(), entry({ auto: true, op: 'CREATE' })] };
  assert.equal(pendingEntries(patch).length, 1);
});

test('a missing patch sends the agent back to TRANSLATE instead of improvising', () => {
  const r = buildStep('GENERATE_COMMANDS', null);
  assert.match(r.prompt, /Run step TRANSLATE first/);
  assert.equal(r.entry, null);
});

test('an unknown step names the steps that do exist', () => {
  assert.match(buildStep('GENERATE_WIDGETS', null).prompt, /Unknown step/);
});

test('a step with only auto entries tells the agent to run codegen, not to write code', () => {
  const r = buildStep('GENERATE_COMMANDS', { entries: [entry({ auto: true, op: 'CREATE' })] });
  assert.equal(r.done, true);
  assert.equal(r.entry, null);
  assert.match(r.prompt, /scripts\/codegen/);
});

test('an empty patch is done, with nothing to run', () => {
  const r = buildStep('GENERATE_COMMANDS', { entries: [] });
  assert.equal(r.done, true);
  assert.match(r.prompt, /Nothing to do/);
});

test('one call yields exactly one item and says how many are left', () => {
  const patch = { entries: [entry(), entry({ class: 'B' }), entry({ class: 'C' })] };
  const r = buildStep('GENERATE_COMMANDS', patch, 1);
  assert.equal(r.entry.class, 'B');
  assert.equal(r.remaining, 1);
  assert.match(r.prompt, /item 2\/3/);
});

test('an out-of-range item is clamped rather than crashing the driver', () => {
  const patch = { entries: [entry()] };
  assert.equal(buildStep('GENERATE_COMMANDS', patch, 99).item, 0);
  assert.equal(buildStep('GENERATE_COMMANDS', patch, -5).item, 0);
});

test('an UPDATE prompt always carries the red-build precondition', () => {
  const p = renderEntry('GENERATE_COMMANDS', entry(), 0, 1);
  assert.match(p, /ONLY while the build is red/);
  assert.match(p, /Never paste the model over an existing body/);
  assert.match(p, /Touch nothing else/);
});

test('a CREATE prompt forbids hand-writing the file', () => {
  const p = renderEntry('GENERATE_EVENTS', entry({ op: 'CREATE' }), 0, 1);
  assert.match(p, /Do not hand-write it/);
});

test('an ADD prompt is insert-only', () => {
  const p = renderEntry('GENERATE_EVENTS', entry({ op: 'ADD' }), 0, 1);
  assert.match(p, /Never read, rewrite or delete what is already there/);
});

test('a GWT prompt is test-first, verbatim-named, and Ability-only', () => {
  const p = renderEntry(
    'GENERATE_GWTS',
    {
      op: 'CREATE',
      auto: false,
      kind: 'gwt-scenario',
      name: 'when x then y',
      source: 'gwt-policy-details.md',
      spec: 'src/test/groovy/a/b/policydetails/PolicyDetailsSpec.groovy',
      hints: [],
    },
    0,
    1,
  );
  assert.match(p, /"when x then y"/);
  assert.match(p, /PolicyDetailsSpec\.groovy/);
  assert.match(p, /VERBATIM/);
  assert.match(p, /only through \*Ability/);
});

test('static steps need no patch', () => {
  assert.match(buildStep('TRANSLATE', null).prompt, /codegen --patch/);
  assert.match(buildStep('VERIFY', null).prompt, /mvn clean verify/);
  assert.match(buildStep('REVIEW', null).prompt, /Reviewing is READING/);
  assert.match(buildStep('RUN_CODEGEN', null).prompt, /generator's own work/);
});
