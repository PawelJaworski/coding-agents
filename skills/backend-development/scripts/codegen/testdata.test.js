import test from 'node:test';
import assert from 'node:assert/strict';
import { testDataAbility, missingTestData, testDataHint, TestDataPlugin } from './plugins/TestDataPlugin.js';
import { commandAbility } from './emit.js';

const BASE = 'com.example';

// fixture field shapes mirror what parseModel's decorate() produces
const scalar = (label, examples = []) => ({
  label,
  name: 'policyNumber',
  javaType: 'String',
  imports: [],
  bracketed: false,
  convention: null,
  ...(examples.length ? { examples } : {}),
});

const vo = (label, attrs, examples = []) => ({
  label,
  name: 'policyHolder',
  javaType: 'PolicyHolder',
  imports: [`${BASE}.domain.PolicyHolder`],
  bracketed: false,
  convention: null,
  valueObject: { className: 'PolicyHolder', package: `${BASE}.domain` },
  embeds: attrs.every((a) => a.javaType === 'String'),
  attrs,
  ...(examples.length ? { examples } : {}),
});

const command = (id, className, fields) => ({
  id,
  className,
  package: `${BASE}.${id.replace(/-/g, '')}`,
  fields,
  abilityClassName: className.replace(/Cmd$/, 'Ability'),
});

// --- TestDataAbility emission ------------------------------------------------

test('a scalar concept example becomes the constant value', () => {
  const f = testDataAbility({ commands: [command('issue-policy', 'IssuePolicyCmd', [scalar('policy number', ['POL-1', 'POL-2'])])] }, BASE);
  assert.match(f.content, /String TEST_POLICY_NUMBER = "POL-1";/);
});

test('a value-object example is comma-split across attributes, in order', () => {
  const f = testDataAbility(
    {
      commands: [
        command('issue-policy', 'IssuePolicyCmd', [
          vo('policy holder', [{ name: 'name', javaType: 'String' }, { name: 'surname', javaType: 'String' }], [
            'John Snow, Aleja Gwiazd 15/5 Wygwizdow',
          ]),
        ]),
      ],
    },
    BASE,
  );
  assert.match(
    f.content,
    /PolicyHolder TEST_POLICY_HOLDER = new PolicyHolder\("John Snow", "Aleja Gwiazd 15\/5 Wygwizdow"\);/,
  );
  assert.equal(f.content.includes('TODO test data'), false);
});

test('a value-object example that does not split evenly stays null with a TODO', () => {
  const f = testDataAbility(
    {
      commands: [
        command('issue-policy', 'IssuePolicyCmd', [
          vo('policy holder', [{ name: 'name', javaType: 'String' }, { name: 'surname', javaType: 'String' }], [
            'John Snow',
          ]),
        ]),
      ],
    },
    BASE,
  );
  assert.match(f.content, /PolicyHolder TEST_POLICY_HOLDER = null; \/\/ TODO test data: /);
  assert.match(f.content, /does not split evenly across attributes \(name, surname\)/);
});

test('no example at all -> null with a TODO naming the missing example', () => {
  const f = testDataAbility({ commands: [command('issue-policy', 'IssuePolicyCmd', [scalar('policy number')])] }, BASE);
  assert.match(f.content, /String TEST_POLICY_NUMBER = null; \/\/ TODO test data: no example in business-definitions-raw\.md/);
});

test('every command gets a default-builder method pre-setting its fields', () => {
  const f = testDataAbility(
    {
      commands: [
        command('issue-policy', 'IssuePolicyCmd', [scalar('policy number', ['POL-1'])]),
      ],
    },
    BASE,
  );
  assert.match(f.content, /default IssuePolicyCmd\.IssuePolicyCmdBuilder defaultIssuePolicyCmd\(\) \{/);
  assert.match(f.content, /return IssuePolicyCmd\.builder\(\)\n\s+\.policyNumber\(TEST_POLICY_NUMBER\);/);
});

test('one shared interface: constants dedupe across commands, methods do not', () => {
  const f = testDataAbility(
    {
      commands: [
        command('issue-policy', 'IssuePolicyCmd', [scalar('policy number', ['POL-1'])]),
        command('renew-policy', 'RenewPolicyCmd', [scalar('policy number', ['POL-9'])]),
      ],
    },
    BASE,
  );
  assert.equal(f.content.match(/TEST_POLICY_NUMBER =/g).length, 1);
  assert.match(f.content, /defaultIssuePolicyCmd\(\)/);
  assert.match(f.content, /defaultRenewPolicyCmd\(\)/);
  assert.equal(f.package, `${BASE}.testdata`);
  assert.equal(f.className, 'TestDataAbility');
  assert.equal(f.once, true);
  assert.equal(f.test, true);
});

test('a derived list attribute brings the List import', () => {
  const f = testDataAbility(
    {
      commands: [
        command('issue-policy', 'IssuePolicyCmd', [
          vo('policy holder', [{ name: 'names', javaType: 'List<String>' }], ['John Snow, Arya Snow']),
        ]),
      ],
    },
    BASE,
  );
  assert.match(f.content, /import java\.util\.List;/);
  assert.match(f.content, /new PolicyHolder\(List\.of\("John Snow", "Arya Snow"\)\)/);
});

test('a model without commands emits nothing', () => {
  assert.equal(testDataAbility({ commands: [] }, BASE), null);
});

test('quotes and backslashes in an example are escaped for Java', () => {
  const f = testDataAbility(
    { commands: [command('issue-policy', 'IssuePolicyCmd', [scalar('policy number', ['said "hi"'])])] },
    BASE,
  );
  assert.match(f.content, /String TEST_POLICY_NUMBER = "said \\"hi\\"";/);
});

// --- scanner (missingTestData) -----------------------------------------------

const FILE_WITH_DATA = `package ${BASE}.testdata;

public interface TestDataAbility {

    String TEST_POLICY_NUMBER = "POL-1";

    default IssuePolicyCmd.IssuePolicyCmdBuilder defaultIssuePolicyCmd() {
        return IssuePolicyCmd.builder()
                .policyNumber(TEST_POLICY_NUMBER);
    }
}
`;

test('absent TestDataAbility content reports nothing (emitter CREATE covers it)', () => {
  const cmds = [command('issue-policy', 'IssuePolicyCmd', [scalar('policy number')])];
  assert.deepEqual(missingTestData({ commands: cmds, content: null }), []);
});

test('a command without a default-builder method is pending work', () => {
  const cmds = [command('issue-policy', 'IssuePolicyCmd', [])];
  const entries = missingTestData({ commands: cmds, content: 'public interface TestDataAbility {\n}\n' });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].members[0], 'defaultIssuePolicyCmd()');
  assert.equal(entries[0].auto, false);
  assert.match(entries[0].hints[0], /the generated IssuePolicyAbility DSL calls/);
});

test('a missing constant, a null constant and a filled constant are told apart', () => {
  const cmds = [command('issue-policy', 'IssuePolicyCmd', [scalar('policy number')])];
  const content = `public interface TestDataAbility {
    String TEST_POLICY_NUMBER = null;
}
`;
  const entries = missingTestData({ commands: cmds, content });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].members[0], 'TEST_POLICY_NUMBER');
  assert.match(entries[0].hints[0], /is still null/);
  assert.deepEqual(missingTestData({ commands: cmds, content: FILE_WITH_DATA }), []);
});

test('an opted-out null constant ("// no test data") is not pending work', () => {
  const cmds = [command('issue-policy', 'IssuePolicyCmd', [scalar('policy number')])];
  const content = `public interface TestDataAbility {
    String TEST_POLICY_NUMBER = null; // no test data
    default IssuePolicyCmd.IssuePolicyCmdBuilder defaultIssuePolicyCmd() { return IssuePolicyCmd.builder().policyNumber(TEST_POLICY_NUMBER); }
}
`;
  assert.deepEqual(missingTestData({ commands: cmds, content }), []);
});

test('a comment mentioning the constant is not mistaken for the constant', () => {
  const cmds = [command('issue-policy', 'IssuePolicyCmd', [scalar('policy number')])];
  const content = `public interface TestDataAbility {
    // TODO: TEST_POLICY_NUMBER = null was here once
}
`;
  const entries = missingTestData({ commands: cmds, content });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].members[0], 'TEST_POLICY_NUMBER');
});

test('two commands sharing a field label report the constant once', () => {
  const cmds = [
    command('issue-policy', 'IssuePolicyCmd', [scalar('policy number')]),
    command('renew-policy', 'RenewPolicyCmd', [scalar('policy number')]),
  ];
  const entries = missingTestData({ commands: cmds, content: 'public interface TestDataAbility {\n}\n' });
  assert.equal(entries.filter((e) => e.members[0] === 'TEST_POLICY_NUMBER').length, 1);
});

test('the hint points at the business-definition example when one exists', () => {
  assert.match(testDataHint(scalar('policy number', ['POL-1'])), /business definition example: "POL-1"/);
  assert.match(testDataHint(scalar('policy number')), /no example in business-definitions-raw\.md/);
});

test('the scanner wires the pure scan to the TestDataAbility file path', () => {
  // no fs access here — absent path must yield no entries, not a throw
  const entries = TestDataPlugin.scanner.scan(
    { commands: [command('issue-policy', 'IssuePolicyCmd', [scalar('policy number')])] },
    { projectRoot: '/nonexistent-root-for-test', testSourceRoot: 'src/test/java', basePackage: BASE },
  );
  assert.deepEqual(entries, []);
});

// --- the generated command DSL ----------------------------------------------

test('the generated command ability extends TestDataAbility and pre-sets the builder from it', () => {
  const c = command('issue-policy', 'IssuePolicyCmd', [scalar('policy number', ['POL-1'])]);
  const a = commandAbility(c, BASE, []);
  assert.match(a.content, /import com\.example\.testdata\.TestDataAbility;/);
  assert.match(a.content, /public interface IssuePolicyAbility extends TestDataAbility, EventStreamAbility \{/);
  assert.match(a.content, /var cmd = defaultIssuePolicyCmd\(\);/);
  assert.doesNotMatch(a.content, /\.builder\(\)/);
});
