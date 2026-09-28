// GENERATE_TEST_DATA emitter: the shared TestDataAbility scaffold (once).
//
// A simple interface of test-data constants, one per project, in the test source
// set. Every generated command *Ability extends it and its DSL pre-sets the
// command builder from a per-command default-builder method, so a spec overrides
// only what its scenario cares about. Scaffolded once, then the project's: data
// edits are never reconciled away.

import naming from '../../model/naming.js';

const TEST_DATA_SCAFFOLD_VERSION = 1;

// --- derivation --------------------------------------------------------------

export const javaString = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/**
 * One constant's initial value from a field, or null when not derivable.
 * A scalar concept's first example becomes a String literal. A value object's
 * first example is comma-split across its attributes in order: each scalar
 * attribute takes one part, and a `List<...>` attribute takes every part left,
 * so one list attribute soaks up the rest of the line. An attribute that runs
 * out of parts means the generator would be guessing — leave it to the agent.
 */
function derivedValue(field) {
  const examples = field.examples || [];
  if (examples.length === 0) return null;
  const first = examples[0];
  if (field.valueObject) {
    const attrs = field.attrs || [];
    const parts = first.split(',').map((p) => p.trim()).filter(Boolean);
    const args = [];
    let i = 0;
    for (const a of attrs) {
      if (a.javaType.startsWith('List<')) {
        args.push(`List.of(${parts.slice(i).map(javaString).join(', ')})`);
        i = parts.length;
      } else {
        if (i >= parts.length) return null;
        args.push(javaString(parts[i++]));
      }
    }
    if (i < parts.length) return null;
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
