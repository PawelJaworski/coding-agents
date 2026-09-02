#!/usr/bin/env node
// Event-model -> Java scaffolding generator. Domain-agnostic: everything
// project-specific comes from <project>/codegen.config.json, so this script is
// reusable across every project that uses the sliced event-sourced architecture.
//
//   node <skill>/scripts/codegen                 regenerate (cwd = project root)
//   node <skill>/scripts/codegen --check         CI gate: fail if stale
//   node <skill>/scripts/codegen --next          "what should the agent do next?"
//   node <skill>/scripts/codegen --next --json   ...as machine-readable JSON
//   node <skill>/scripts/codegen --json          print the parsed model
//   node <skill>/scripts/codegen --accept-scaffold  record once-files as reconciled
//   node <skill>/scripts/codegen --project <dir> --model <dir>   explicit paths

import fs from 'node:fs';
import path from 'node:path';
import { parseModel } from './parse.js';
import { emit } from './emit.js';
import {
  parseScaffoldVersion,
  stampScaffoldVersion,
  misplacedSpecs,
  preservedReason,
} from './scaffold.js';
import { mergeGenerated, semanticDrift } from './merge.js';
import { pendingWork, buildQueue } from './next.js';

const CONFIG_FILE = 'codegen.config.json';
const DEFAULTS = {
  modelDir: '../docs',
  mainSourceRoot: 'src/main/java',
  testSourceRoot: 'src/test/java',
  // Only this root is a Groovy source root; a spec anywhere else is silently
  // never compiled, so the generator refuses to proceed if it finds one.
  groovyTestSourceRoot: 'src/test/groovy',
};

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};
const checkOnly = args.includes('--check');
const nextMode = args.includes('--next');
// Both modes are dry runs: neither ever writes to disk.
const check = checkOnly || nextMode;
const acceptScaffold = args.includes('--accept-scaffold');

/**
 * Print a `--next` result. As JSON with `--json` (machine-readable, for a
 * calling agent or a loop), otherwise as short human-readable text.
 */
function printNext(result) {
  if (args.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`\n  STATE: ${result.state}`);
  if (result.next) {
    console.log(`  NEXT (${result.next.kind}): ${JSON.stringify(result.next.detail)}`);
    console.log(`\n  ${result.next.prompt}\n`);
  } else {
    console.log('  Nothing pending — model, code and specs all agree.\n');
  }
  if (result.queue && result.queue.length > 1) {
    console.log(`  (${result.queue.length - 1} more item(s) queued after this one)\n`);
  }
}

const projectRoot = findProjectRoot(path.resolve(flag('project') || process.cwd()));
const configPath = projectRoot && path.join(projectRoot, CONFIG_FILE);

// The project root is wherever codegen.config.json lives, searched upwards from
// cwd. That makes the generator runnable from any directory in the project with
// no wrapper script and no path juggling.
function findProjectRoot(start) {
  let dir = start;
  for (;;) {
    if (fs.existsSync(path.join(dir, CONFIG_FILE))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const die = (msg) => {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
};

if (!projectRoot) {
  die(
    `CONFIG ERROR  No ${CONFIG_FILE} found in ${path.resolve(
      flag('project') || process.cwd(),
    )} or any parent directory.\n` +
      `  Create one at your project root:\n\n` +
      `    { "basePackage": "com.example.myapp", "modelDir": "../docs" }\n`,
  );
}

const config = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
if (!config.basePackage) die(`CONFIG ERROR  ${CONFIG_FILE} must declare "basePackage".`);

const modelDir = path.resolve(projectRoot, flag('model') || config.modelDir);
const mainRoot = path.resolve(projectRoot, config.mainSourceRoot);
const testRoot = path.resolve(projectRoot, config.testSourceRoot);
const groovyTestRoot = path.resolve(projectRoot, config.groovyTestSourceRoot);

// --- preflight: Groovy specs must live in the Groovy source root -------------
// Not a style rule. javac ignores .groovy and the Groovy compiler only reads its
// own root, so a spec under src/test/java produces NO class and NO error —
// surefire then reports the test does not exist, which reads like a surefire
// misconfiguration. Fail here instead, where the cause is obvious.
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : [full];
  });
}

if (path.resolve(testRoot) !== path.resolve(groovyTestRoot)) {
  const strays = misplacedSpecs(walk(testRoot));
  if (strays.length) {
    die(
      `MISPLACED SPEC  ${strays.length} Groovy spec(s) outside the Groovy source root:\n` +
        strays.map((f) => `    ${path.relative(projectRoot, f)}`).join('\n') +
        `\n\n  Move them under ${config.groovyTestSourceRoot}/ — only that path is a Groovy\n` +
        `  source root. A spec elsewhere is silently ignored: no class is emitted,\n` +
        `  and surefire reports the test does not exist.`,
    );
  }
}

let files;
try {
  const model = parseModel({ modelDir, basePackage: config.basePackage });
  // `--json` alone dumps the parsed model. Combined with `--next` it instead
  // means "the --next result as JSON" — handled further down.
  if (args.includes('--json') && !nextMode) {
    console.log(JSON.stringify(model, null, 2));
    process.exit(0);
  }
  files = emit(model);
} catch (err) {
  if (nextMode) {
    printNext({
      state: 'MODEL_ERROR',
      next: {
        kind: 'model-error',
        detail: err.message,
        prompt:
          `Model error: ${err.message}. Do not fix it in code and do not edit the model — ` +
          `skip this fragment, keep going with everything else, and record it in ` +
          `development-report.md.`,
      },
      queue: [],
    });
    process.exit(1);
  }
  die(`MODEL ERROR  ${err.message}`);
}

const written = [];
const preserved = [];
const stale = [];
const staleScaffold = [];
const staleGenerated = [];
const preservedByHand = [];
const restamped = [];
const needsManualMerge = [];

for (const file of files) {
  const root = file.test ? testRoot : mainRoot;
  const target = path.join(root, ...file.package.split('.'), `${file.className}.java`);
  const exists = fs.existsSync(target);
  const rel = path.relative(projectRoot, target);

  // `once` files are scaffolded then owned by the project (deciders, runtime).
  // Never rewritten — they hold hand-written logic — but their scaffold version
  // is compared so template drift is reported rather than silently tolerated.
  if (file.once && exists) {
    const current = fs.readFileSync(target, 'utf8');
    const onDisk = parseScaffoldVersion(current);
    const template = file.version ?? 1;

    if (acceptScaffold) {
      const stamped = stampScaffoldVersion(current, template, file.content);
      if (stamped !== current) {
        fs.writeFileSync(target, stamped);
        restamped.push(`${rel}  (v${onDisk} -> v${template})`);
      }
    } else if (onDisk < template) {
      staleScaffold.push(`${rel}  (on disk: v${onDisk}, template: v${template})`);
    }

    preserved.push(rel);
    continue;
  }

  // GENERATED files are ADD-ONLY once they exist: a fresh member (a new record
  // component, enum constant, or class member — the model grew) is inserted; an
  // existing member is NEVER rewritten or removed, even if the model's version
  // of it now differs — that's exactly the room a hand-added extension (e.g. a
  // search endpoint on a persisting projector) needs to survive regeneration.
  if (!file.once && exists) {
    const current = fs.readFileSync(target, 'utf8');
    if (current === file.content) {
      preserved.push(rel);
      continue;
    }
    // A member whose BODY differs from what fresh generation would emit is a
    // deliberate deviation OR stale state — the generator cannot tell which.
    // `// PRESERVED-BY-HAND: <reason>` declares intent and is tolerated; an
    // unmarked one is flagged so the agent/human classifies it (the StateProjector
    // `apply` body was exactly this, and old `--check` never caught it).
    const drift = semanticDrift(current, file.content);
    const preserveReason = preservedReason(current);
    if (drift.length > 0) {
      const list = `${rel}  (${drift.join(', ')})`;
      if (preserveReason) {
        preservedByHand.push(`${list}  // PRESERVED-BY-HAND: ${preserveReason}`);
        preserved.push(rel);
      } else {
        staleGenerated.push(list);
      }
      continue;
    }
    const merged = mergeGenerated(current, file.content);
    if (merged === null) {
      needsManualMerge.push(rel);
      preserved.push(rel);
      continue;
    }
    if (merged.added.length === 0) {
      preserved.push(rel);
      continue;
    }
    if (check) {
      stale.push(`${rel}  (would add: ${merged.added.join(', ')})`);
      continue;
    }
    fs.writeFileSync(target, merged.content);
    written.push(`merged   ${rel}  (added: ${merged.added.join(', ')})`);
    continue;
  }

  if (check) {
    stale.push(rel);
    continue;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, file.content);
  written.push(`created  ${rel}`);
}

// Reported separately from `stale`: these are YOURS, so the fix is a hand-ported
// delta, not a regeneration. Conflating them would suggest re-running the
// generator, which does nothing at all for a `once` file.
function reportStaleScaffold() {
  console.error(
    `\n  STALE SCAFFOLD  ${staleScaffold.length} once-owned file(s) predate the current template:`,
  );
  staleScaffold.forEach((f) => console.error(`    ${f}`));
  console.error(
    `\n  These are YOURS — the generator will not touch them, and re-running it\n` +
      `  changes nothing. Diff each against its template in scripts/codegen/runtime.js\n` +
      `  and port the delta by hand, then record it:\n\n` +
      `    node <skill>/scripts/codegen --accept-scaffold\n`,
  );
}

// A GENERATED file the merge step doesn't recognise the shape of (not a single
// top-level record/class/interface/enum). Overwriting could destroy a hand
// extension, so the generator refuses and asks a human to reconcile it.
function reportNeedsManualMerge() {
  console.error(
    `\n  NEEDS MANUAL MERGE  ${needsManualMerge.length} generated file(s) differ from the model\n` +
      `  in a shape the generator doesn't know how to merge safely:`,
  );
  needsManualMerge.forEach((f) => console.error(`    ${f}`));
  console.error(
    `\n  The generator only adds missing record components / enum constants / class\n` +
      `  members — it never rewrites what's there. This file's structure doesn't match\n` +
      `  that (e.g. more than one top-level type). Reconcile it by hand.\n`,
  );
}

// A member of a GENERATED file whose body no longer matches what fresh generation
// would emit, WITHOUT a `// PRESERVED-BY-HAND` marker. This is stale state (the
// model grew or changed and the on-disk member wasn't re-emitted) or a hand edit
// that forgot to declare itself. Either way the agent/human must classify it:
// mark it preserved, or delete-and-regenerate the file.
function reportStaleGenerated() {
  console.error(
    `\n  STALE GENERATED  ${staleGenerated.length} generated file(s) have member bodies that no longer\n` +
      `  match the model, with no // PRESERVED-BY-HAND marker:`,
  );
  staleGenerated.forEach((f) => console.error(`    ${f}`));
  console.error(
    `\n  The add-only merge cannot repair a stale member body. Classify each one:\n` +
      `    - intentional hand edit -> add "// PRESERVED-BY-HAND: <reason>" to the file's\n` +
      `      leading comment block and re-run --check;\n` +
      `    - genuine staleness     -> delete the generated file and regenerate it.\n`,
  );
}

function reportPreservedByHand() {
  console.log(`\n  preserved by hand (intentional deviations from the model):`);
  preservedByHand.forEach((f) => console.log(`    ${f}`));
}

if (checkOnly) {
  if (stale.length) {
    console.error(`\n  OUT OF DATE  ${stale.length} generated file(s) differ from the model:`);
    stale.forEach((f) => console.error(`    ${f}`));
    console.error(`\n  Run the codegen script to refresh them.\n`);
  }
  if (staleScaffold.length) reportStaleScaffold();
  if (staleGenerated.length) reportStaleGenerated();
  if (needsManualMerge.length) reportNeedsManualMerge();
  if (preservedByHand.length) {
    console.log(`\n  preserved by hand (intentional deviations from the model):`);
    preservedByHand.forEach((f) => console.log(`    ${f}`));
  }
  if (stale.length || staleScaffold.length || staleGenerated.length || needsManualMerge.length) {
    process.exit(1);
  }
  console.log('codegen: up to date');
  process.exit(0);
}

// `--next` turns everything above into ONE decision instead of a human reading
// free-text output and deciding what it implies. Codegen-level problems (a
// stale file, an unresolved scaffold) ARE the next step when they exist. Once
// codegen is clean, the queue is built by cross-referencing the model's rules
// and GWT scenarios against existing Spock spec names (backend-implement names
// a spec after the rule/scenario verbatim, so a name with no matching spec is
// unimplemented work) — see reference/edit-classification.md and next.js.
if (nextMode) {
  if (stale.length) {
    printNext({
      state: 'OUT_OF_DATE',
      next: {
        kind: 'regenerate',
        detail: `${stale.length} generated file(s) differ from the model`,
        prompt: 'Run `node <skill>/scripts/codegen` (no flags) to regenerate, then re-run --next.',
      },
      queue: [],
    });
    process.exit(1);
  }
  if (staleScaffold.length) {
    printNext({
      state: 'STALE_SCAFFOLD',
      next: {
        kind: 'reconcile-scaffold',
        detail: staleScaffold,
        prompt:
          'These once-owned files predate their template. Diff each against ' +
          'scripts/codegen/runtime.js, port the delta by hand, then run --accept-scaffold.',
      },
      queue: [],
    });
    process.exit(1);
  }
  if (staleGenerated.length) {
    printNext({
      state: 'STALE_GENERATED',
      next: {
        kind: 'reconcile-drift',
        detail: staleGenerated,
        prompt:
          'These generated member bodies no longer match the model, with no ' +
          '// PRESERVED-BY-HAND marker. Classify each: mark it preserved if the ' +
          'deviation is intentional, otherwise delete the file and regenerate it.',
      },
      queue: [],
    });
    process.exit(1);
  }
  if (needsManualMerge.length) {
    printNext({
      state: 'NEEDS_MANUAL_MERGE',
      next: {
        kind: 'manual-merge',
        detail: needsManualMerge,
        prompt: 'The merge could not recognise this file\'s shape. Reconcile it by hand.',
      },
      queue: [],
    });
    process.exit(1);
  }

  const gwtFiles = walk(modelDir)
    .filter((f) => /^gwt-.*\.md$/.test(path.basename(f)))
    .map((f) => ({ name: path.basename(f), content: fs.readFileSync(f, 'utf8') }));
  const businessRulesPath = path.join(modelDir, 'business-rules-raw.md');
  const businessRulesRaw = fs.existsSync(businessRulesPath)
    ? fs.readFileSync(businessRulesPath, 'utf8')
    : '';
  const specContents = walk(groovyTestRoot)
    .filter((f) => f.endsWith('.groovy'))
    .map((f) => fs.readFileSync(f, 'utf8'));

  const queue = buildQueue(pendingWork({ businessRulesRaw, gwtFiles, specContents }));

  if (queue.length === 0) {
    printNext({ state: 'DONE', next: null, queue: [] });
    process.exit(0);
  }
  printNext({ state: 'PENDING', next: queue[0], queue });
  process.exit(0);
}

written.forEach((w) => console.log(`  ${w}`));
if (restamped.length) {
  console.log(`\n  scaffold version recorded:`);
  restamped.forEach((s) => console.log(`    ${s}`));
}
if (preserved.length) {
  console.log(`\n  kept (yours, scaffolded once / hand-extended):`);
  preserved.forEach((s) => console.log(`    ${s}`));
}
if (preservedByHand.length) reportPreservedByHand();
console.log(
  `\n  ${written.length} written, ${preserved.length} preserved, ` +
    `${files.length - written.length - preserved.length} unchanged`,
);
if (staleGenerated.length) {
  reportStaleGenerated();
  process.exit(1);
}
if (staleScaffold.length) {
  reportStaleScaffold();
  process.exit(1);
}
if (needsManualMerge.length) {
  reportNeedsManualMerge();
  process.exit(1);
}
