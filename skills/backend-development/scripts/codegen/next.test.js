import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBusinessRules,
  parseGwtScenarios,
  parseSpecNames,
  specPath,
  ruleCommand,
  pendingWork,
  buildQueue,
} from './next.js';

// Shared minimal model, mirroring the parsed output of codegen --json.
const COMMANDS = [
  {
    id: 'issue-policy',
    name: 'Issue Policy',
    package: 'pl.pjaworski.examplebackend.issuepolicy',
    className: 'IssuePolicyCmd',
    fields: [
      {
        label: 'policy holder',
        name: 'policyHolder',
        attrs: [
          { name: 'name', javaType: 'String' },
          { name: 'surname', javaType: 'String' },
          { name: 'address', javaType: 'String' },
        ],
      },
      {
        label: 'policy coverage',
        name: 'policyCoverage',
        attrs: [
          { name: 'coveragePeriod', javaType: 'String' },
          { name: 'riskList', javaType: 'List<String>' },
        ],
      },
    ],
  },
];

const READ_MODELS = [
  {
    id: 'policy-details',
    name: 'Policy Details',
    package: 'pl.pjaworski.examplebackend.policydetails',
    className: 'PolicyDetails',
  },
  {
    id: 'policy-list',
    name: 'Policy List',
    package: 'pl.pjaworski.examplebackend.policylist',
    className: 'PolicyList',
  },
];

const GWT_POLICY_DETAILS = {
  name: 'gwt-policy-details.md',
  content: '## when issue policy then policy number has next ordinal\nthen:\nnext ordinal\n',
};

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

test('parseSpecNames: associates each method name with its file path', () => {
  const groovy = `class FooSpec extends Specification {
    def "A policy must have a name."() { expect: true }
    def "another scenario"() { expect: true }
  }
`;
  assert.deepEqual(parseSpecNames(groovy, 'src/test/groovy/x/FooSpec.groovy'), [
    { name: 'A policy must have a name.', path: 'src/test/groovy/x/FooSpec.groovy' },
    { name: 'another scenario', path: 'src/test/groovy/x/FooSpec.groovy' },
  ]);
});

test('specPath: builds the canonical spec path under the read model/command slice', () => {
  assert.equal(
    specPath('src/test/groovy', 'pl.pjaworski.examplebackend', 'policydetails', 'PolicyDetails'),
    'src/test/groovy/pl/pjaworski/examplebackend/policydetails/PolicyDetailsSpec.groovy',
  );
});

test('ruleCommand: matches a rule to the command whose field it names', () => {
  const c = ruleCommand('A policy that is issued must have a policy holder name.', COMMANDS);
  assert.equal(c.id, 'issue-policy');
});

test('ruleCommand: matches by behavior word when no field is named', () => {
  const c = ruleCommand('A policy that is issued must have a valid coverage period.', COMMANDS);
  assert.equal(c.id, 'issue-policy');
});

test('ruleCommand: returns null when the match is ambiguous or absent (no guessing)', () => {
  const twoCommands = [
    ...COMMANDS,
    {
      id: 'cancel-policy',
      name: 'Cancel Policy',
      package: 'p.cancelpolicy',
      className: 'CancelPolicyCmd',
      fields: [
        {
          label: 'policy holder',
          name: 'policyHolder',
          attrs: [{ name: 'name', javaType: 'String' }],
        },
      ],
    },
  ];
  // "policy holder name" is a field of BOTH commands -> ambiguous -> null.
  assert.equal(ruleCommand('the policy holder name must be set', twoCommands), null);
  // No command is mentioned at all -> null.
  assert.equal(ruleCommand('the sky must be blue', COMMANDS), null);
});

test('pendingWork: a scenario/rule matching a spec in the WRONG slice is still pending', () => {
  const result = pendingWork({
    businessRulesRaw:
      '# Policy\nA policy that is issued must have a policy holder name.\n',
    gwtFiles: [GWT_POLICY_DETAILS],
    parsedSpecs: [
      {
        // Scenario name present but in the ISSUE-POLICY slice, not policydetails.
        name: 'when issue policy then policy number has next ordinal',
        path: 'src/test/groovy/pl/pjaworski/examplebackend/issuepolicy/IssuePolicySpec.groovy',
      },
      {
        // Rule name present but in the policydetails slice, not issuepolicy.
        name: 'A policy that is issued must have a policy holder name.',
        path: 'src/test/groovy/pl/pjaworski/examplebackend/policydetails/PolicyDetailsSpec.groovy',
      },
    ],
    commands: COMMANDS,
    readModels: READ_MODELS,
  });
  assert.deepEqual(result.pendingScenarios, [
    { scenario: 'when issue policy then policy number has next ordinal', file: 'gwt-policy-details.md', readModel: READ_MODELS[0] },
  ]);
  assert.equal(result.pendingRules.length, 1);
  assert.equal(result.pendingRules[0].rule, 'A policy that is issued must have a policy holder name.');
  assert.equal(result.pendingRules[0].command.id, 'issue-policy');
});

test('pendingWork: a scenario/rule matching a spec in the CORRECT slice is NOT pending', () => {
  const result = pendingWork({
    businessRulesRaw:
      '# Policy\nA policy that is issued must have a policy holder name.\n',
    gwtFiles: [GWT_POLICY_DETAILS],
    parsedSpecs: [
      {
        name: 'when issue policy then policy number has next ordinal',
        path: 'src/test/groovy/pl/pjaworski/examplebackend/policydetails/PolicyDetailsSpec.groovy',
      },
      {
        name: 'A policy that is issued must have a policy holder name.',
        path: 'src/test/groovy/pl/pjaworski/examplebackend/issuepolicy/IssuePolicySpec.groovy',
      },
    ],
    commands: COMMANDS,
    readModels: READ_MODELS,
  });
  assert.deepEqual(result.pendingScenarios, []);
  assert.deepEqual(result.pendingRules, []);
});

test('pendingWork: a scenario/rule with NO matching spec IS pending', () => {
  const result = pendingWork({
    businessRulesRaw:
      '# Policy\nA policy that is issued must have a policy holder name.\n',
    gwtFiles: [GWT_POLICY_DETAILS],
    parsedSpecs: [{ name: 'some unrelated spec', path: 'x/FooSpec.groovy' }],
    commands: COMMANDS,
    readModels: READ_MODELS,
  });
  assert.equal(result.pendingScenarios.length, 1);
  assert.equal(result.pendingRules.length, 1);
});

test('buildQueue: scenario prompt carries the exact read-model spec path', () => {
  const queue = buildQueue(
    { pendingScenarios: [{ scenario: 'S1', file: 'gwt-policy-details.md', readModel: READ_MODELS[0] }], pendingRules: [] },
    { groovyRoot: 'src/test/groovy', base: 'pl.pjaworski.examplebackend' },
  );
  assert.equal(queue[0].kind, 'gwt-scenario');
  assert.match(
    queue[0].prompt,
    /src\/test\/groovy\/pl\/pjaworski\/examplebackend\/policydetails\/PolicyDetailsSpec\.groovy/,
  );
});

test('buildQueue: rule prompt carries the exact command spec path', () => {
  const queue = buildQueue(
    {
      pendingScenarios: [],
      pendingRules: [
        { rule: 'A policy that is issued must have a policy holder name.', command: COMMANDS[0] },
      ],
    },
    { groovyRoot: 'src/test/groovy', base: 'pl.pjaworski.examplebackend' },
  );
  assert.equal(queue[0].kind, 'business-rule');
  assert.match(
    queue[0].prompt,
    /src\/test\/groovy\/pl\/pjaworski\/examplebackend\/issuepolicy\/IssuePolicySpec\.groovy/,
  );
});

test('buildQueue: empty inputs produce an empty queue (state DONE)', () => {
  assert.deepEqual(buildQueue({ pendingScenarios: [], pendingRules: [] }), []);
});
