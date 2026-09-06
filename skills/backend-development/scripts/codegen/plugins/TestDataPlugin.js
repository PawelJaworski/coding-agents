// Test Data Plugin — emits the shared TestDataAbility scaffold (once) and scans
// it for pending test data.
//
// TestDataAbility is a simple interface of test-data constants, one per project,
// in the test source set. Every generated command *Ability extends it and its
// DSL pre-sets the command builder from a per-command default-builder method,
// so a spec overrides only what its scenario cares about.
//
// Where the data comes from:
//   1. business-definitions-raw.md `# examples` bullets, deterministically:
//      a scalar concept's first example becomes the constant's value; a value
//      object's first example is comma-split across its attributes in order and
//      only used when the parts count matches.
//   2. the agent, for everything else: the scaffold emits `= null` and the
//      GENERATE_TEST_DATA step prompts until every constant holds data or is
//      deliberately opted out with a trailing `// no test data` marker.
//
// Ownership mirrors the deciders: scaffolded once, then the project's. Data
// edits are never reconciled away, and a command field without a constant is a
// loud javac error naming the exact symbol (the generated DSL references it).

import fs from 'node:fs';
import path from 'node:path';
import naming from '../naming.js';

const TEST_DATA_SCAFFOLD_VERSION = 1;

const ONCE_HEADER = (what) =>
  `// SCAFFOLDED ONCE by scripts/codegen — this file is YOURS.\n` +
  `// scaffold-version: ${TEST_DATA_SCAFFOLD_VERSION}\n` +
  `// ${what}: every generated *Ability DSL pre-sets its builder from these\n` +
  `// constants, so a spec overrides only what its scenario cares about. A\n` +
  `// "= null" constant flows as no default: fill it from the business\n` +
  `// definition's examples, invent a value, or opt out with a trailing\n` +
  `// "// no test data" marker.\n`;

// --- derivation --------------------------------------------------------------

const javaString = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/**
 * One constant's initial value from a field, or null when not derivable.
 * A scalar concept's first example becomes a String literal. A value object's
 * first example is comma-split across its attributes in order; a parts/attributes
 * count mismatch means the generator would be guessing — leave it to the agent.
 */
function derivedValue(field) {
  const examples = field.examples || [];
  if (examples.length === 0) return null;
  const first = examples[0];
  if (field.valueObject) {
    const attrs = field.attrs || [];
    const parts = first.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length !== attrs.length) return null;
    const args = attrs.map((a, i) =>
      a.javaType.startsWith('List<') ? `List.of(${javaString(parts[i])})` : javaString(parts[i]),
    );
    return { expr: `new ${field.javaType}(${args.join(', ')})` };
  }
  return { expr: javaString(first) };
}

/** Why a constant has no derived value, for the scaffold's TODO comment. */
function todoReason(field) {
  if (field.convention) return `[${field.label}] is system-generated (:${field.convention}) — default only if a scenario needs one`;
  if (field.bracketed) return `[${field.label}] is a decision — a standing default only if scenarios want one`;
  const examples = field.examples || [];
  if (examples.length > 0 && field.valueObject) {
    const attrs = (field.attrs || []).map((a) => a.name).join(', ');
    return `example "${examples[0]}" does not split evenly across attributes (${attrs}) — create your own`;
  }
  return `no example in business-definitions-raw.md — create your own`;
}

const needsListImport = (field, derived) =>
  field.javaType.includes('List<') || Boolean(derived && /List\.of\(/.test(derived.expr));

// --- emitter -----------------------------------------------------------------

/**
 * The TestDataAbility scaffold. Pure: a function of the parsed model only.
 * Returns null when the model has no commands (nothing to pre-set).
 */
export function testDataAbility(model, base) {
  const commands = model.commands || [];
  if (commands.length === 0) return null;
  const td = naming.testDataAbility(base);

  const constants = [];
  const seen = new Set();
  const imports = new Set();
  const builderMethods = [];

  for (const c of commands) {
    const setters = [];
    for (const f of c.fields) {
      const name = naming.testDataConstant(f.label);
      if (!seen.has(name)) {
        seen.add(name);
        const derived = derivedValue(f);
        constants.push({
          name,
          field: f,
          usesList: needsListImport(f, derived),
          line:
            `    ${f.javaType} ${name} = ${derived ? derived.expr : 'null'};` +
            (derived ? '' : ` // TODO test data: ${todoReason(f)}`),
        });
      }
      for (const i of f.imports || []) imports.add(i);
      setters.push(`                .${f.name}(${name})`);
    }
    imports.add(`${c.package}.${c.className}`);
    const chain = setters.length
      ? `${c.className}.builder()\n${setters.join('\n')};`
      : `${c.className}.builder();`;
    builderMethods.push(
      `    default ${c.className}.${c.className}Builder ${naming.defaultBuilderMethod(c.className)}() {\n` +
        `        return ${chain}\n` +
        `    }`,
    );
  }

  if ([...constants].some((k) => k.usesList)) imports.add('java.util.List');

  const content =
    ONCE_HEADER('Test data for specs') +
    `package ${td.package};\n\n` +
    [...imports].sort().map((i) => `import ${i};`).join('\n') +
    `\n\npublic interface ${td.className} {\n\n` +
    constants.map((k) => k.line).join('\n') +
    `\n\n` +
    builderMethods.join('\n\n') +
    `\n}\n`;

  return {
    category: 'testdata',
    test: true,
    once: true,
    version: TEST_DATA_SCAFFOLD_VERSION,
    onceHint: 'scaffolded once, then yours: fill the `= null` constants (GENERATE_TEST_DATA)',
    package: td.package,
    className: td.className,
    content,
  };
}

// --- scanner -----------------------------------------------------------------

const constantLine = (src, name) => {
  const re = new RegExp(`^\\s*[\\w.$<>\\[\\],\\s]+\\s+${name}\\s*=`);
  return src.split('\n').find((l) => re.test(l)) ?? null;
};

const hasMember = (src, name) => new RegExp(`\\b${name}\\s*\\(`).test(src);

/**
 * Hint telling the agent where a field's data comes from. Pure.
 */
export function testDataHint(field) {
  const examples = field.examples || [];
  if (field.convention) return `system-generated by convention — leave null unless a scenario overrides it`;
  if (field.bracketed) return `[${field.label}] is a decision — standing default only if scenarios want one`;
  if (examples.length > 0) {
    if (field.valueObject) {
      const attrs = (field.attrs || []).map((a) => a.name).join(', ');
      return `business definition example: "${examples[0]}" — split it across attributes (${attrs}) or invent your own`;
    }
    return `business definition example: ${javaString(examples[0])}`;
  }
  return `no example in business-definitions-raw.md — invent one, or mark the line // no test data`;
}

/**
 * Pending test-data work, computed from the command list and the on-disk
 * TestDataAbility content. Pure: content null means the file does not exist yet
 * (the emitter's CREATE covers it; nothing to prompt for). Entries are deduped
 * across commands — two commands sharing a field label share one constant.
 */
export function missingTestData({ commands, content }) {
  if (!commands?.length || content == null) return [];
  const entries = [];
  const reported = new Set();
  const push = (entry) => {
    const key = entry.members.join('|');
    if (reported.has(key)) return;
    reported.add(key);
    entries.push(entry);
  };

  for (const c of commands) {
    const builderMethod = naming.defaultBuilderMethod(c.className);
    if (!hasMember(content, builderMethod)) {
      push({
        kind: 'test-data',
        name: builderMethod,
        op: 'ADD',
        auto: false,
        members: [`${builderMethod}()`],
        hints: [
          `command "${c.id}" has no default builder — the generated ${c.abilityClassName} DSL calls ` +
            `${builderMethod}(), so without it the build is red`,
        ],
      });
    }
    for (const f of c.fields) {
      const name = naming.testDataConstant(f.label);
      const line = constantLine(content, name);
      if (line == null) {
        push({
          kind: 'test-data',
          name,
          op: 'ADD',
          auto: false,
          members: [name],
          hints: [`${f.javaType} ${name} — command "${c.id}" field "${f.label}" has no test-data constant`, testDataHint(f)],
        });
      } else if (/=\s*null\s*;/.test(line) && !line.includes('no test data')) {
        push({
          kind: 'test-data',
          name,
          op: 'ADD',
          auto: false,
          members: [name],
          hints: [`${name} is still null — its value IS the default the ${c.abilityClassName} DSL pre-sets`, testDataHint(f)],
        });
      }
    }
  }
  return entries;
}

// --- step plugin for GENERATE_TEST_DATA --------------------------------------

const testDataStep = {
  id: 'GENERATE_TEST_DATA',
  category: 'testdata',
  after: ['GENERATE_COMMANDS'],
  detect: (patch) => (patch?.entries ?? []).filter(e => e.auto === false),
  render: (item, index, total) => {
    const left = total - index - 1;
    return [
      `GENERATE_TEST_DATA — item ${index + 1}/${total}`,
      '',
      `  ${item.op}  ${item.path}`,
      item.members?.length ? `  members: ${item.members.join(', ')}` : '',
      '',
      'TestDataAbility is scaffolded once and YOURS: fill test data there, not in specs.',
      'Derive from the business definition\'s examples; none? invent it. Not needed?',
      'mark the line `// no test data`. A constant\'s value IS the default the *Ability',
      'DSL pre-sets — `= null` flows as no default.',
      '',
      ...(item.hints ?? []).map(h => `  ${h}`),
      '',
      `Touch nothing else. ${left > 0 ? `${left} item(s) left in this step.` : 'Last item.'}`
    ].join('\n');
  }
};

// --- plugin manifest ---------------------------------------------------------

export const TestDataPlugin = {
  id: 'testdata',
  provides: ['test-data-ability'],
  requires: ['command'],
  emit: (model, ctx) => {
    const file = testDataAbility(model, ctx.basePackage);
    return file ? [file] : [];
  },
  scanner: {
    id: 'testdata',
    category: 'testdata',
    requires: ['command'],
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
  step: testDataStep
};
