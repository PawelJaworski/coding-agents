#!/usr/bin/env node
// Event-model -> Java scaffolding generator. Domain-agnostic: everything
// project-specific comes from <project>/codegen.config.json, so this script is
// reusable across every project that uses the sliced event-sourced architecture.
//
//   node <skill>/scripts/codegen                 regenerate (cwd = project root)
//   node <skill>/scripts/codegen --check         CI gate: fail if stale
//   node <skill>/scripts/codegen --json          print the parsed model
//   node <skill>/scripts/codegen --accept-scaffold  record once-files as reconciled
//   node <skill>/scripts/codegen --project <dir> --model <dir>   explicit paths

import fs from 'node:fs';
import path from 'node:path';
import { parseModel } from './parse.js';
import { emit } from './emit.js';
import { parseScaffoldVersion, stampScaffoldVersion, misplacedSpecs } from './scaffold.js';
import { mergeGenerated } from './merge.js';

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
const check = args.includes('--check');
const acceptScaffold = args.includes('--accept-scaffold');

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
  if (args.includes('--json')) {
    console.log(JSON.stringify(model, null, 2));
    process.exit(0);
  }
  files = emit(model);
} catch (err) {
  die(`MODEL ERROR  ${err.message}`);
}

const written = [];
const preserved = [];
const stale = [];
const staleScaffold = [];
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

if (check) {
  if (stale.length) {
    console.error(`\n  OUT OF DATE  ${stale.length} generated file(s) differ from the model:`);
    stale.forEach((f) => console.error(`    ${f}`));
    console.error(`\n  Run the codegen script to refresh them.\n`);
  }
  if (staleScaffold.length) reportStaleScaffold();
  if (needsManualMerge.length) reportNeedsManualMerge();
  if (stale.length || staleScaffold.length || needsManualMerge.length) process.exit(1);
  console.log('codegen: up to date');
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
console.log(
  `\n  ${written.length} written, ${preserved.length} preserved, ` +
    `${files.length - written.length - preserved.length} unchanged`,
);
if (staleScaffold.length) {
  reportStaleScaffold();
  process.exit(1);
}
if (needsManualMerge.length) {
  reportNeedsManualMerge();
  process.exit(1);
}
