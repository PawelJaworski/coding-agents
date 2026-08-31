// node --test .opencode/skills/frontend-development/scripts/codegen/codegen.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseModel, parseSections, parseField } from './parse.js';
import { emit, component, store, contracts, api } from './emit.js';
import naming from './naming.js';

function withModel({ uis, commands = '', readmodels = '' }, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fecodegen-'));
  fs.writeFileSync(path.join(dir, 'uis.md'), uis);
  fs.writeFileSync(path.join(dir, 'commands.md'), commands);
  fs.writeFileSync(path.join(dir, 'readmodels.md'), readmodels);
  try {
    return fn(parseModel({ modelDir: dir }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const COMMANDS = `# Commands
## issue-policy
Name: Issue Policy
Produces: policy-issued
* policy holder
* [policy number]:uuid
`;

const READMODELS = `# Read Models
## policy-status
Name: Policy Status
Policy:Key
Subscribes: policy-issued
* policy number
* status

## underwriting-queue
Name: Underwriting Queue
Policy:Id
Subscribes: policy-issued
* applicant
`;

test('only Type: html UIs become pages', () => {
  withModel(
    {
      uis: `# UIs
## agent-portal
Type: html
Name: Agent Portal
Triggers: issue-policy

## policy-document
Type: pdf
Name: Policy Document
`,
      commands: COMMANDS,
      readmodels: READMODELS,
    },
    (m) => {
      assert.deepEqual(m.pages.map((p) => p.id), ['agent-portal']);
      assert.deepEqual(m.skipped.map((u) => u.id), ['policy-document']);
    },
  );
});

test('a UI whose id matches a command triggers it without Triggers:', () => {
  withModel({ uis: `# UIs\n## issue-policy\nType: html\n`, commands: COMMANDS }, (m) => {
    assert.deepEqual(m.pages[0].triggerIds, ['issue-policy']);
  });
});

test('ConsistsOf pulls in several read models; :Key is a collection, :Id is not', () => {
  withModel(
    {
      uis: `# UIs\n## agent-dashboard\nType: html\nConsistsOf: policy-status, underwriting-queue\n`,
      readmodels: READMODELS,
    },
    (m) => {
      const [page] = m.pages;
      assert.deepEqual(page.viewIds, ['policy-status', 'underwriting-queue']);
      assert.equal(page.views[0].collection, true);
      assert.equal(page.views[1].collection, false);
      // an :Id view needs an aggregate id, which can only come from the route
      assert.equal(page.aggregateParam, true);
      assert.equal(page.routePath, 'agent-dashboard/:aggregateId');
    },
  );
});

test('a page of only :Key read models keeps a plain route path', () => {
  withModel(
    { uis: `# UIs\n## policy-status\nType: html\n`, readmodels: READMODELS },
    (m) => {
      assert.equal(page0(m).aggregateParam, false);
      assert.equal(page0(m).routePath, 'policy-status');
    },
  );
});
const page0 = (m) => m.pages[0];

test('unknown ids are model errors, not silent no-ops', () => {
  assert.throws(
    () => withModel({ uis: `# UIs\n## x\nType: html\nTriggers: nope\n` }, () => {}),
    /triggers unknown command "nope"/,
  );
  assert.throws(
    () => withModel({ uis: `# UIs\n## x\nType: html\nConsistsOf: nope\n` }, () => {}),
    /consists of unknown read model "nope"/,
  );
});

test('the payload mirrors the Cmd record; bracketed fields stay optional', () => {
  withModel({ uis: `# UIs\n## issue-policy\nType: html\n`, commands: COMMANDS }, (m) => {
    const ts = contracts(m.pages[0], '/api');
    assert.match(ts, /policyHolder: string;/);
    // present (the Java record has it) but optional and flagged as server-decided
    assert.match(ts, /policyNumber\?: string;/);
    assert.match(ts, /do not collect in a form/);
    assert.match(ts, /ISSUE_POLICY_ENDPOINT = '\/api\/issue-policy'/);
  });
});

test('the api client mirrors the generated Spring controllers', () => {
  withModel(
    {
      uis: `# UIs\n## agent-portal\nType: html\nTriggers: issue-policy\nConsistsOf: policy-status, underwriting-queue\n`,
      commands: COMMANDS,
      readmodels: READMODELS,
    },
    (m) => {
      const ts = api(m.pages[0]);
      // POST <base>/<command-id> returning the new aggregate id
      assert.match(ts, /issuePolicy\(payload: IssuePolicyPayload\): Promise<string>/);
      assert.match(ts, /this\.http\.post<string>\(ISSUE_POLICY_ENDPOINT, payload\)/);
      // :Key -> collection endpoint, no path variable
      assert.match(ts, /getPolicyStatus\(\): Promise<PolicyStatusView\[\]>/);
      assert.match(ts, /this\.http\.get<PolicyStatusView\[\]>\(POLICY_STATUS_ENDPOINT\)/);
      // :Id -> single object keyed by aggregate id
      assert.match(ts, /getUnderwritingQueue\(aggregateId: string\): Promise<UnderwritingQueueView>/);
      assert.match(ts, /underwritingQueueEndpoint\(aggregateId\)/);
      assert.doesNotMatch(ts, /throw new Error/);
    },
  );
});

test('the store is pre-wired to the api and never throws a stub', () => {
  withModel(
    {
      uis: `# UIs\n## agent-portal\nType: html\nTriggers: issue-policy\nConsistsOf: policy-status\n`,
      commands: COMMANDS,
      readmodels: READMODELS,
    },
    (m) => {
      const ts = store(m.pages[0]);
      assert.match(ts, /await this\.api\.issuePolicy\(payload\)/);
      assert.match(ts, /await this\.api\.getPolicyStatus\(\)/);
      assert.doesNotMatch(ts, /not implemented/);
      assert.doesNotMatch(ts, /throw new Error/);
    },
  );
});

test('the component never declares template imports itself', () => {
  withModel({ uis: `# UIs\n## issue-policy\nType: html\n`, commands: COMMANDS }, (m) => {
    const ts = component(m.pages[0]);
    // NG8113 fires on declared-but-unused imports, so the owned template and the
    // owned import list must stay together.
    assert.match(ts, /imports: \[ISSUE_POLICY_IMPORTS\]/);
    assert.doesNotMatch(ts, /FormsModule/);
  });
});

test('emit produces exactly the documented inventory plus one routes file', () => {
  withModel({ uis: `# UIs\n## issue-policy\nType: html\n`, commands: COMMANDS }, (m) => {
    const files = emit(m, { pagesRoot: 'src/app/pages', apiBase: '/api' });
    assert.deepEqual(
      files.map((f) => f.path.replace('src/app/pages/', '')),
      [
        'issue-policy/issue-policy.contracts.ts',
        'issue-policy/issue-policy.api.ts',
        'issue-policy/issue-policy.ts',
        'issue-policy/issue-policy.imports.ts',
        'issue-policy/issue-policy.store.ts',
        'issue-policy/issue-policy.html',
        'issue-policy/issue-policy.css',
        'issue-policy/issue-policy.spec.ts',
        'pages.routes.ts',
      ],
    );
    const owned = files.filter((f) => f.once).map((f) => path.basename(f.path));
    assert.deepEqual(owned, [
      'issue-policy.imports.ts',
      'issue-policy.store.ts',
      'issue-policy.html',
      'issue-policy.css',
      'issue-policy.spec.ts',
    ]);
  });
});

test('naming is a pure function of the id', () => {
  const p = naming.page('agent-dashboard');
  assert.equal(p.className, 'AgentDashboard');
  assert.equal(p.storeClassName, 'AgentDashboardStore');
  assert.equal(p.selector, 'app-agent-dashboard');
  assert.equal(p.importsConst, 'AGENT_DASHBOARD_IMPORTS');
});

test('parseField understands conventions and list types', () => {
  assert.deepEqual(parseField('[policy number]:uuid'), {
    label: 'policy number',
    name: 'policyNumber',
    bracketed: true,
    convention: 'uuid',
    tsType: 'string',
  });
  assert.equal(parseField('coverage list').tsType, 'string[]');
});

test('parseSections keeps props lowercase-keyed and collects fields', () => {
  const [s] = parseSections('## x\nType: html\nConsistsOf: a, b\n* one\n');
  assert.equal(s.props.type, 'html');
  assert.equal(s.props.consistsof, 'a, b');
  assert.deepEqual(s.fields.map((f) => f.name), ['one']);
});
