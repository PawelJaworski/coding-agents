// node --test .opencode/skills/frontend-development/scripts/codegen/codegen.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseModel, parseSections, parseField } from './parse.js';
import { emit, component, store, contracts, api, template, pageImports } from './emit.js';
import naming from './naming.js';

function withModel({ uis, commands = '', readmodels = '', definitions = null, openapi = null }, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fecodegen-'));
  fs.writeFileSync(path.join(dir, 'uis.md'), uis);
  fs.writeFileSync(path.join(dir, 'commands.md'), commands);
  fs.writeFileSync(path.join(dir, 'readmodels.md'), readmodels);
  if (definitions !== null) {
    fs.writeFileSync(path.join(dir, 'business-definitions-raw.md'), definitions);
  }
  let openapiPath = null;
  if (openapi !== null) {
    openapiPath = path.join(dir, 'openapi.json');
    fs.writeFileSync(openapiPath, JSON.stringify(openapi));
  }
  try {
    return fn(parseModel({ modelDir: dir, openapiPath }));
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

// ---- business definitions -------------------------------------------------
// The backend generates a Java record for any definition that lists attributes, so
// a field naming one is an object on the wire. Typing it `string` here is what made
// Jackson reject `"FIRE, STEALING"` for PolicyCoverage.

const DEFINITIONS = `# name Policy Holder
# description
The person who buys the policy.
------
# name Policy Coverage
# description
What the insurer will pay for.
* coverage period
* risk list
`;

const COVERAGE_UIS = `# UIs\n## issue-policy\nType: html\nName: Issue Policy\n`;
const COVERAGE_COMMANDS = `# Commands
## issue-policy
Name: Issue Policy
* policy holder
* policy coverage
`;

const withCoverage = (fn) =>
  withModel(
    { uis: COVERAGE_UIS, commands: COVERAGE_COMMANDS, definitions: DEFINITIONS },
    fn,
  );

test('a definition with attributes types the field as an object, without stays a string', () => {
  withCoverage((m) => {
    const [holder, coverage] = m.commands[0].fields;
    // "Policy Holder" is defined but lists no attributes -> a plain string
    assert.equal(holder.tsType, 'string');
    assert.equal(holder.object, null);
    // "Policy Coverage" lists attributes -> the record the backend generates
    assert.equal(coverage.tsType, 'PolicyCoverage');
    assert.deepEqual(coverage.object.fields.map((f) => [f.name, f.tsType]), [
      ['coveragePeriod', 'string'],
      ['riskList', 'string[]'],
    ]);
  });
});

test('a page declares only the object types its own contracts reference', () => {
  withCoverage((m) => {
    assert.deepEqual(m.pages[0].objectTypes.map((o) => o.name), ['PolicyCoverage']);
  });
});

test('contracts emit the nested interface used by the payload', () => {
  withCoverage((m) => {
    const out = contracts(m.pages[0], '/api');
    assert.match(out, /export interface PolicyCoverage \{/);
    assert.match(out, /coveragePeriod: string;/);
    assert.match(out, /riskList: string\[\];/);
    assert.match(out, /policyCoverage: PolicyCoverage;/);
  });
});

test('form state initialises a nested object, not an empty string', () => {
  withCoverage((m) => {
    const out = component(m.pages[0]);
    assert.match(out, /policyCoverage: \{/);
    assert.match(out, /coveragePeriod: '',/);
    // one empty entry so the seeded form renders one input for the list
    assert.match(out, /riskList: \[''\],/);
    assert.doesNotMatch(out, /policyCoverage: '',/);
  });
});

test('the form binds nested controls instead of one input for the whole object', () => {
  withCoverage((m) => {
    const html = template(m.pages[0]);
    // never bind a plain input straight to the object
    assert.doesNotMatch(html, /\[\(ngModel\)\]="issuePolicyForm\.policyCoverage"/);
    assert.match(html, /\[\(ngModel\)\]="issuePolicyForm\.policyCoverage\.coveragePeriod"/);
    assert.match(html, /@for \(entry of issuePolicyForm\.policyCoverage\.riskList; track \$index\)/);
    assert.match(html, /\[\(ngModel\)\]="issuePolicyForm\.policyCoverage\.riskList\[\$index\]"/);
  });
});

test('the model still parses when no business definitions file exists', () => {
  withModel({ uis: COVERAGE_UIS, commands: COVERAGE_COMMANDS }, (m) => {
    assert.deepEqual(m.objectTypes, []);
    assert.deepEqual(m.commands[0].fields.map((f) => f.tsType), ['string', 'string']);
  });
});

// ---- openapi.json as the contract source ----------------------------------
// The backend publishes what it actually serves. When present it decides field
// names, field types and URLs; the event model keeps page structure, route
// shape, labels and [bracketed] hints.

const OPENAPI_UIS = `# UIs
## issue-policy
Type: html
Name: Issue Policy

## policy-status
Type: html
Name: Policy Status

## underwriting-queue
Type: html
Name: Underwriting Queue
`;

const schemaRef = (name) => ({ $ref: `#/components/schemas/${name}` });

const OPENAPI = {
  openapi: '3.1.0',
  paths: {
    '/issue-policy': {
      post: {
        requestBody: { content: { 'application/json': { schema: schemaRef('IssuePolicyCmd') } } },
        responses: { 200: { content: { '*/*': { schema: { type: 'string' } } } } },
      },
    },
    '/policy-status': {
      get: {
        responses: {
          200: { content: { '*/*': { schema: { type: 'array', items: schemaRef('PolicyStatus') } } } },
        },
      },
    },
    '/underwriting-queue/{aggregateId}': {
      get: { responses: { 200: { content: { '*/*': { schema: schemaRef('UnderwritingQueue') } } } } },
    },
  },
  components: {
    schemas: {
      IssuePolicyCmd: {
        type: 'object',
        properties: {
          policyHolder: { type: 'string' },
          policyNumber: { type: 'string', format: 'uuid' },
          premium: { type: 'integer' },
          coverage: schemaRef('Coverage'),
        },
      },
      Coverage: {
        type: 'object',
        properties: { coveragePeriod: { type: 'string' }, riskList: { type: 'array', items: { type: 'string' } } },
      },
      PolicyStatus: { type: 'object', properties: { policyNumber: { type: 'string' }, status: { type: 'string' } } },
      UnderwritingQueue: { type: 'object', properties: { applicant: { type: 'string' } } },
    },
  },
};

const OPENAPI_COMMANDS = `# Commands
## issue-policy
Name: Issue Policy
Produces: policy-issued
* policy holder
* [policy number]:uuid
* premium
* coverage
`;

test('openapi.json decides field types, including numbers and nested objects', () => {
  withModel(
    { uis: OPENAPI_UIS, commands: OPENAPI_COMMANDS, readmodels: READMODELS, openapi: OPENAPI },
    (m) => {
      const cmd = m.commands[0];
      assert.deepEqual(
        cmd.fields.map((f) => [f.name, f.tsType]),
        [
          ['policyHolder', 'string'],
          ['policyNumber', 'string'],
          ['premium', 'number'],
          ['coverage', 'Coverage'],
        ],
      );
      // A markdown-only run would have typed `premium` as a string.
      assert.equal(cmd.fields[3].object.fields.map((f) => f.tsType).join(','), 'string,string[]');
    },
  );
});

test('the event model still owns [bracketed], so a form never collects it', () => {
  withModel(
    { uis: OPENAPI_UIS, commands: OPENAPI_COMMANDS, readmodels: READMODELS, openapi: OPENAPI },
    (m) => {
      const cmd = m.commands[0];
      assert.equal(cmd.fields.find((f) => f.name === 'policyNumber').bracketed, true);
      assert.deepEqual(cmd.inputFields.map((f) => f.name), ['policyHolder', 'premium', 'coverage']);
      assert.match(contracts(m.pages[0], '/api'), /do not collect in a form \*\/\n  policyNumber\?: string;/);
    },
  );
});

test('endpoint constants come from the published paths', () => {
  withModel(
    { uis: OPENAPI_UIS, commands: OPENAPI_COMMANDS, readmodels: READMODELS, openapi: OPENAPI },
    (m) => {
      const byId = Object.fromEntries(m.pages.map((p) => [p.id, contracts(p, '/api')]));
      assert.match(byId['issue-policy'], /ISSUE_POLICY_ENDPOINT = '\/api\/issue-policy';/);
      assert.match(byId['policy-status'], /POLICY_STATUS_ENDPOINT = '\/api\/policy-status';/);
      assert.match(byId['underwriting-queue'], /`\/api\/underwriting-queue\/\$\{aggregateId\}`/);
    },
  );
});

test('a command the backend does not serve is a loud error, not a guess', () => {
  const missing = { ...OPENAPI, paths: { ...OPENAPI.paths } };
  delete missing.paths['/issue-policy'];
  assert.throws(
    () =>
      withModel(
        { uis: OPENAPI_UIS, commands: OPENAPI_COMMANDS, readmodels: READMODELS, openapi: missing },
        () => {},
      ),
    /no POST \/issue-policy in openapi\.json/,
  );
});

test('a field in the model but not in the contract is reported as drift', () => {
  assert.throws(
    () =>
      withModel(
        {
          uis: OPENAPI_UIS,
          commands: `${OPENAPI_COMMANDS}* broker fee\n`,
          readmodels: READMODELS,
          openapi: OPENAPI,
        },
        () => {},
      ),
    /CONTRACT DRIFT[\s\S]*not in openapi\.json: brokerFee/,
  );
});

test('a :Key read model served as a single aggregate is a contract disagreement', () => {
  const swapped = JSON.parse(JSON.stringify(OPENAPI));
  swapped.paths['/policy-status/{aggregateId}'] = {
    get: { responses: { 200: { content: { '*/*': { schema: schemaRef('PolicyStatus') } } } } },
  };
  delete swapped.paths['/policy-status'];
  assert.throws(
    () =>
      withModel(
        { uis: OPENAPI_UIS, commands: OPENAPI_COMMANDS, readmodels: READMODELS, openapi: swapped },
        () => {},
      ),
    /disagree about the projection strategy/,
  );
});

test('without openapiPath the generator behaves exactly as before', () => {
  withModel({ uis: OPENAPI_UIS, commands: OPENAPI_COMMANDS, readmodels: READMODELS }, (m) => {
    assert.deepEqual(m.commands[0].fields.map((f) => f.tsType), ['string', 'string', 'string', 'string']);
    assert.equal(m.contractSource, null);
  });
});

// ---- search criteria from readmodels.md ? prefix ---------------------------
// The `?` prefix in readmodels.md marks a field as searchable. The backend uses
// @RequestParam Map<String, String> which collects ALL query params into a map.
// The openapi.json represents this as a single param with type:object, and the
// frontend codegen expands it into individual criteria based on the ? fields.

const SEARCH_UIS = `# UIs
## policy-list
Type: html
Name: Policy List
`;

const SEARCH_READMODELS = `# Read Models
## policy-list
Name: Policy List
Subscribes: policy-issued
policy:Key
* policy holder
* policy number
? policy holder
`;

const SEARCH_DEFINITIONS = `# name Policy Holder
# description
The person who buys the policy.
* name
* surname
* address
`;

const SEARCH_OPENAPI = {
  openapi: '3.1.0',
  paths: {
    '/policy-list': {
      get: {
        parameters: [
          {
            name: 'search',
            in: 'query',
            required: true,
            schema: { type: 'object', additionalProperties: { type: 'string' } },
          },
        ],
        responses: {
          200: { content: { '*/*': { schema: { type: 'array', items: schemaRef('PolicyList') } } } },
        },
      },
    },
  },
  components: {
    schemas: {
      PolicyList: {
        type: 'object',
        properties: {
          policyHolder: schemaRef('PolicyHolder'),
          policyNumber: { type: 'string' },
        },
      },
      PolicyHolder: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          surname: { type: 'string' },
          address: { type: 'string' },
        },
      },
    },
  },
};

test('parseSections collects ? lines as searchFields', () => {
  const [s] = parseSections('## x\n* field one\n? search one\n');
  assert.deepEqual(s.fields.map((f) => f.name), ['fieldOne']);
  assert.deepEqual(s.searchFields.map((f) => f.name), ['searchOne']);
});

test('a Map<String,String> openapi param is expanded into individual criteria from ? fields', () => {
  withModel(
    {
      uis: SEARCH_UIS,
      readmodels: SEARCH_READMODELS,
      definitions: SEARCH_DEFINITIONS,
      openapi: SEARCH_OPENAPI,
    },
    (m) => {
      const view = m.readModels[0];
      assert.ok(view.search, 'search should be set');
      const names = view.search.criteria.map((c) => c.name);
      assert.deepEqual(names, ['policyHolder.name', 'policyHolder.surname', 'policyHolder.address']);
      // All optional (the Map param itself is required, but individual keys are not)
      assert.ok(view.search.criteria.every((c) => !c.required));
    },
  );
});

test('search contracts use quoted property names for dotted keys', () => {
  withModel(
    {
      uis: SEARCH_UIS,
      readmodels: SEARCH_READMODELS,
      definitions: SEARCH_DEFINITIONS,
      openapi: SEARCH_OPENAPI,
    },
    (m) => {
      const ts = contracts(m.pages[0], '/api');
      assert.match(ts, /'policyHolder\.name'\?: string;/);
      assert.match(ts, /'policyHolder\.surname'\?: string;/);
      assert.match(ts, /'policyHolder\.address'\?: string;/);
    },
  );
});

test('search API client uses bracket notation for dotted keys', () => {
  withModel(
    {
      uis: SEARCH_UIS,
      readmodels: SEARCH_READMODELS,
      definitions: SEARCH_DEFINITIONS,
      openapi: SEARCH_OPENAPI,
    },
    (m) => {
      const ts = api(m.pages[0]);
      assert.match(ts, /params\.set\('policyHolder\.name', criteria\['policyHolder\.name'\]\)/);
      assert.match(ts, /params\.set\('policyHolder\.surname', criteria\['policyHolder\.surname'\]\)/);
      assert.match(ts, /params\.set\('policyHolder\.address', criteria\['policyHolder\.address'\]\)/);
    },
  );
});

test('search template uses bracket notation for ngModel bindings', () => {
  withModel(
    {
      uis: SEARCH_UIS,
      readmodels: SEARCH_READMODELS,
      definitions: SEARCH_DEFINITIONS,
      openapi: SEARCH_OPENAPI,
    },
    (m) => {
      const html = template(m.pages[0]);
      assert.match(html, /\[\(ngModel\)\]="policyListSearchCriteria\['policyHolder\.name'\]"/);
      assert.match(html, /\[\(ngModel\)\]="policyListSearchCriteria\['policyHolder\.surname'\]"/);
      assert.match(html, /\[\(ngModel\)\]="policyListSearchCriteria\['policyHolder\.address'\]"/);
    },
  );
});

test('search component initialises criteria with quoted keys', () => {
  withModel(
    {
      uis: SEARCH_UIS,
      readmodels: SEARCH_READMODELS,
      definitions: SEARCH_DEFINITIONS,
      openapi: SEARCH_OPENAPI,
    },
    (m) => {
      const ts = component(m.pages[0]);
      assert.match(ts, /'policyHolder\.name': undefined,/);
      assert.match(ts, /'policyHolder\.surname': undefined,/);
      assert.match(ts, /'policyHolder\.address': undefined,/);
    },
  );
});

test('search store has a search method', () => {
  withModel(
    {
      uis: SEARCH_UIS,
      readmodels: SEARCH_READMODELS,
      definitions: SEARCH_DEFINITIONS,
      openapi: SEARCH_OPENAPI,
    },
    (m) => {
      const ts = store(m.pages[0]);
      assert.match(ts, /async searchPolicyList\(criteria: PolicyListSearchCriteria\)/);
      assert.match(ts, /await this\.api\.searchPolicyList\(criteria\)/);
    },
  );
});

test('imports include FormsModule when page has search', () => {
  withModel(
    {
      uis: SEARCH_UIS,
      readmodels: SEARCH_READMODELS,
      definitions: SEARCH_DEFINITIONS,
      openapi: SEARCH_OPENAPI,
    },
    (m) => {
      const imports = pageImports(m.pages[0]);
      assert.match(imports, /import.*FormsModule/);
    },
  );
});
