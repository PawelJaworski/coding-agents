import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBusinessRules, parseGwtScenarios, parseSpecNames, pendingWork, buildQueue } from './next.js';

test('parseBusinessRules: skips the aggregate header, keeps each rule sentence', () => {
  const content = `# Policy
A policy that is issued must have a policy holder name.
A policy that is issued must have a policy holder surname.
`;
  assert.deepEqual(parseBusinessRules(content), [
    'A policy that is issued must have a policy holder name.',
    'A policy that is issued must have a policy holder surname.',
  ]);
});

test('parseBusinessRules: blank lines are dropped', () => {
  const content = '# Policy\n\nA rule.\n\n\nAnother rule.\n';
  assert.deepEqual(parseBusinessRules(content), ['A rule.', 'Another rule.']);
});

test('parseGwtScenarios: reads every "## heading" as a scenario', () => {
  const content = `# Given When Then

## when issue policy then policy number has next ordinal
given:
issue policy

then:
policy number has next ordinal
`;
  assert.deepEqual(parseGwtScenarios(content), [
    'when issue policy then policy number has next ordinal',
  ]);
});

test('parseSpecNames: reads Spock def "..."() method names', () => {
  const groovy = `class FooSpec extends Specification {
    def "A policy that is issued must have a policy holder name."() {
        expect: true
    }
    def "another scenario"() {
        expect: true
    }
}
`;
  assert.deepEqual(parseSpecNames(groovy), [
    'A policy that is issued must have a policy holder name.',
    'another scenario',
  ]);
});

test('pendingWork: a rule/scenario with a matching spec name is NOT pending', () => {
  const result = pendingWork({
    businessRulesRaw: '# Policy\nA policy must have a name.\n',
    gwtFiles: [
      { name: 'gwt-x.md', content: '## when issued then numbered\nthen:\nnumbered\n' },
    ],
    specContents: [
      'def "A policy must have a name."() {}',
      'def "when issued then numbered"() {}',
    ],
  });
  assert.deepEqual(result.pendingRules, []);
  assert.deepEqual(result.pendingScenarios, []);
});

test('pendingWork: a rule/scenario with NO matching spec IS pending', () => {
  const result = pendingWork({
    businessRulesRaw: '# Policy\nA policy must have a name.\n',
    gwtFiles: [{ name: 'gwt-x.md', content: '## when issued then numbered\n' }],
    specContents: ['def "some unrelated spec"() {}'],
  });
  assert.deepEqual(result.pendingRules, ['A policy must have a name.']);
  assert.deepEqual(result.pendingScenarios, [
    { scenario: 'when issued then numbered', file: 'gwt-x.md' },
  ]);
});

test('buildQueue: scenarios are queued before rules, each with a ready prompt', () => {
  const queue = buildQueue({
    pendingScenarios: [{ scenario: 'S1', file: 'gwt-x.md' }],
    pendingRules: ['R1'],
  });
  assert.equal(queue.length, 2);
  assert.equal(queue[0].kind, 'gwt-scenario');
  assert.match(queue[0].prompt, /S1/);
  assert.match(queue[0].prompt, /gwt-x\.md/);
  assert.equal(queue[1].kind, 'business-rule');
  assert.match(queue[1].prompt, /R1/);
});

test('buildQueue: empty inputs produce an empty queue (state DONE)', () => {
  assert.deepEqual(buildQueue({ pendingScenarios: [], pendingRules: [] }), []);
});
