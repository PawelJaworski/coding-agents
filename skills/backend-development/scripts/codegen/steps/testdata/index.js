// GENERATE_TEST_DATA — fill the TestDataAbility constants until every one holds
// data or is deliberately opted out.
//
// Public surface of this step package: `TestDataStep` (what the step machine
// needs — note it owns its own prompt, since "fill data, not specs" is step
// knowledge) and `TestDataPlugin` (what the emitter/scanner registries need).

import fs from 'node:fs';
import path from 'node:path';
import naming from '../../model/naming.js';
import { testDataAbility } from './emit.js';
import { missingTestData, testDataHint } from './scan.js';

export { testDataAbility, missingTestData, testDataHint };

export const TestDataStep = {
  id: 'GENERATE_TEST_DATA',
  category: 'testdata',
  after: ['GENERATE_COMMANDS'],

  render: (item, index, total) => {
    const left = total - index - 1;
    return [
      `GENERATE_TEST_DATA — item ${index + 1}/${total}`,
      '',
      `  ${item.op}  ${item.path}`,
      item.members?.length ? `  members: ${item.members.join(', ')}` : '',
      '',
      'TestDataAbility is scaffolded once and YOURS: fill test data there, not in specs.',
      "Derive from the business definition's examples; none? invent it. Not needed?",
      'mark the line `// no test data`. A constant\'s value IS the default the *Ability',
      'DSL pre-sets — `= null` flows as no default.',
      '',
      ...(item.hints ?? []).map((h) => `  ${h}`),
      '',
      `Touch nothing else. ${left > 0 ? `${left} item(s) left in this step.` : 'Last item.'}`,
    ].join('\n');
  },
};

export const TestDataPlugin = {
  id: 'testdata',
  requires: ['command'],
  emit: (model, ctx) => {
    const file = testDataAbility(model, ctx.basePackage);
    return file ? [file] : [];
  },
  scanner: {
    id: 'testdata',
    scan: (model, ctx) => {
      const { projectRoot, testSourceRoot, basePackage } = ctx;
      const commands = model.commands || [];
      if (commands.length === 0) return [];
      const td = naming.testDataAbility(basePackage);
      const file = path.join(projectRoot, testSourceRoot, ...td.package.split('.'), `${td.className}.java`);
      // Absent file: the emitter's CREATE (auto:true) scaffolds it first —
      // prompting before that would ask the agent to hand-write scaffolding.
      if (!fs.existsSync(file)) return [];
      const content = fs.readFileSync(file, 'utf8');
      return missingTestData({ commands, content }).map((e) => ({
        ...e,
        category: 'testdata',
        path: path.relative(projectRoot, file),
      }));
    },
  },
  step: TestDataStep,
};