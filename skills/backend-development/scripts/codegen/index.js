#!/usr/bin/env node
// Event-model -> Java scaffolding generator. Domain-agnostic: everything
// project-specific comes from <project>/codegen.config.json, so this script is
// reusable across every project that uses the sliced event-sourced architecture.
//
// Usage:
//   node <skill>/scripts/codegen                          regenerate (cwd = project root)
//   node <skill>/scripts/codegen --check                  CI gate: fail if stale
//   node <skill>/scripts/codegen --patch                  model -> code diff as .codegen/patch/*.json
//   node <skill>/scripts/codegen --json                   print the parsed model
//   node <skill>/scripts/codegen --next                   pick next step and render prompt
//   node <skill>/scripts/codegen --next --json            ...as machine-readable JSON
//   node <skill>/scripts/codegen --prompt <STEP> [--item N]  render ONE prompt
//   node <skill>/scripts/codegen --test                   print the step machine
//   node <skill>/scripts/codegen --accept-scaffold        record once-files as reconciled
//   node <skill>/scripts/codegen --project <dir> --model <dir>   explicit paths

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseModel } from './parse.js';
import { emitWithPlugins, scanWithPlugins } from './emit-plugins.js';
import {
  parseScaffoldVersion,
  stampScaffoldVersion,
  misplacedSpecs,
  preservedReason,
  leadingCommentBlock,
} from './scaffold.js';
import { mergeGenerated, semanticDrift } from './merge.js';
import { computeAdvisory, isLogicFile } from './advisory.js';
import { classifyFile, buildPatches, patchFileName, stalePatchFiles } from './patch.js';
import {
  getAllSteps,
  getGenerateSteps,
  getCategoryOf,
} from '../steps-bridge.js';
import {
  buildStep,
  pendingEntries,
  loadPatch,
} from './prompts.js';

const CONFIG_FILE = 'codegen.config.json';
const DEFAULTS = {
  modelDir: '../docs',
  mainSourceRoot: 'src/main/java',
  testSourceRoot: 'src/test/java',
  groovyTestSourceRoot: 'src/test/groovy',
};

const PATCH_DIR = '.codegen/patch';
const SKILL = '.opencode/skills/backend-development';

const STEPS = getAllSteps();
const GENERATE_STEPS = getGenerateSteps();
const CATEGORY_OF = getCategoryOf();

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};
const checkOnly = args.includes('--check');
const nextMode = args.includes('--next');
const patchMode = args.includes('--patch');
const promptMode = args.includes('--prompt');
const testMode = args.includes('--test');
const acceptScaffold = args.includes('--accept-scaffold');
const json = args.includes('--json');
const check = checkOnly || nextMode || patchMode;

// ---------------------------------------------------------------------------
// Project root + config
// ---------------------------------------------------------------------------

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

const projectRoot = findProjectRoot(path.resolve(flag('project') || process.cwd()));
if (!projectRoot) {
  die(
    `CONFIG ERROR  No ${CONFIG_FILE} found in ${path.resolve(
      flag('project') || process.cwd(),
    )} or any parent directory.\n` +
      `  Create one at your project root:\n\n` +
      `    { "basePackage": "com.example.myapp", "modelDir": "../docs" }\n`,
  );
}

const config = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(path.join(projectRoot, CONFIG_FILE), 'utf8')) };
if (!config.basePackage) die(`CONFIG ERROR  ${CONFIG_FILE} must declare "basePackage".`);

const modelDir = path.resolve(projectRoot, flag('model') || config.modelDir);
const mainRoot = path.resolve(projectRoot, config.mainSourceRoot);
const testRoot = path.resolve(projectRoot, config.testSourceRoot);
const groovyTestRoot = path.resolve(projectRoot, config.groovyTestSourceRoot);

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : [full];
  });
}

function hasUncommittedChanges() {
  try {
    return (
      execSync('git status --porcelain', { cwd: projectRoot, encoding: 'utf8', timeout: 5_000 })
        .trim().length > 0
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Preflight: Groovy specs must live in the Groovy source root
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Parse model
// ---------------------------------------------------------------------------

let files;
let model;
try {
  model = parseModel({ modelDir, basePackage: config.basePackage });
  if (json && !nextMode && !patchMode && !promptMode) {
    console.log(JSON.stringify(model, null, 2));
    process.exit(0);
  }
  files = emitWithPlugins(model);
} catch (err) {
  if (nextMode || promptMode) {
    printResult({
      state: 'MODEL_ERROR',
      step: 'MODEL_ERROR',
      next: {
        detail: err.message,
        prompt:
          `Model error: ${err.message}. Do not fix it in code and do not edit the model — ` +
          `skip this fragment, keep going with everything else, and record it in ` +
          `development-report.md.`,
      },
      remaining: 0,
    });
    process.exit(1);
  }
  die(`MODEL ERROR  ${err.message}`);
}

// ---------------------------------------------------------------------------
// --patch: the model->code diff as JSON documents
// ---------------------------------------------------------------------------

if (patchMode) {
  const entries = [];
  for (const file of files) {
    const root = file.test ? testRoot : mainRoot;
    const target = path.join(root, ...file.package.split('.'), `${file.className}.java`);
    const rel = path.relative(projectRoot, target);
    const currentContent = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
    const entry = classifyFile({ file, currentContent, relPath: rel });
    if (entry) entries.push(entry);
  }

  const scanned = scanWithPlugins(model, {
    projectRoot,
    modelDir,
    groovyTestRoot,
    testSourceRoot: testRoot,
    basePackage: config.basePackage,
  });
  // Scanner entries carry their own category (gwt, testdata, ...); group them
  // into one patch document per category, same shape as buildPatches output.
  const scannedPatches = {};
  for (const entry of scanned) {
    const category = entry.category ?? 'gwt';
    (scannedPatches[category] ??= { category, summary: {}, entries: [] }).entries.push(entry);
  }
  for (const doc of Object.values(scannedPatches)) {
    doc.summary = {
      create: doc.entries.filter((e) => e.op === 'CREATE').length,
      add: doc.entries.filter((e) => e.op === 'ADD').length,
      update: doc.entries.filter((e) => e.op === 'UPDATE').length,
      needsAgent: doc.entries.filter((e) => e.auto === false).length,
    };
  }

  const patches = { ...buildPatches(entries), ...scannedPatches };
  const outDir = path.join(projectRoot, PATCH_DIR);
  fs.mkdirSync(outDir, { recursive: true });

  // Prune patch files from a previous run whose category is not produced this
  // run (e.g. `gwt` once its last pending item is resolved) — otherwise --next
  // keeps reading a stale file straight off disk and reports already-fixed
  // work as pending forever. See stalePatchFiles() for the full rationale.
  const existingFiles = fs.readdirSync(outDir);
  for (const stale of stalePatchFiles(existingFiles, Object.keys(patches))) {
    fs.unlinkSync(path.join(outDir, stale));
  }

  const summary = [];
  for (const [category, doc] of Object.entries(patches)) {
    const name = patchFileName(category);
    fs.writeFileSync(path.join(outDir, name), `${JSON.stringify(doc, null, 2)}\n`);
    summary.push({ category, file: `${PATCH_DIR}/${name}`, ...doc.summary });
  }

  if (json) {
    console.log(JSON.stringify({ patchDir: PATCH_DIR, patches: summary }, null, 2));
    process.exit(0);
  }
  console.log(`\n  PATCH written to ${PATCH_DIR}/\n`);
  for (const s of summary) {
    console.log(
      `    ${s.category.padEnd(12)} CREATE ${s.create}  ADD ${s.add}  UPDATE ${s.update}` +
        `   (needs an agent: ${s.needsAgent})`,
    );
  }
  console.log(
    `\n  CREATE and ADD marked auto:true are performed by \`codegen\` itself — run it.\n` +
      `  Only auto:false entries need an agent. Get one prompt at a time:\n\n` +
      `    node ${SKILL}/scripts/codegen --prompt GENERATE_COMMANDS --item 0\n`,
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// --test: print the step machine
// ---------------------------------------------------------------------------

if (testMode) {
  console.log('\n  Backend Development — Step Machine\n');
  console.log('  codegen --next  ->  do the ONE prompt  ->  codegen --next  ->  ...\n');
  console.log('  The diff is scripted (codegen --patch). The agent only applies one entry.\n');
  const rows = [
    ['MODEL_ERROR', 'codegen --patch fails to parse the model', 'report it; never fix in code, never edit the model'],
    ['RUN_CODEGEN', 'any patch entry has auto:true', 'run codegen; CREATE and ADD are the generator\'s job'],
    ['GENERATE_DOMAIN', 'domain-patch.json has an auto:false entry', 'apply one entry'],
    ['GENERATE_EVENTS', 'events-patch.json has an auto:false entry', 'apply one entry'],
    ['GENERATE_COMMANDS', 'commands-patch.json has an auto:false entry', 'apply one entry'],
    ['GENERATE_READ_MODELS', 'readmodels-patch.json has an auto:false entry', 'apply one entry'],
    ['GENERATE_TEST_DATA', 'testdata-patch.json has missing/null TestDataAbility data', 'fill TestDataAbility: derive from business-definition examples or invent'],
    ['GENERATE_GWTS', 'gwt-patch.json has a pending scenario/rule', 'implement ONE scenario, test-first'],
    ['VERIFY', 'nothing pending, no development-report.md', 'mvn clean verify + codegen --check + write the report'],
    ['REVIEW', 'report exists, working tree dirty', 'delegate to backend-code-reviewer (reading only)'],
    ['DONE', 'report exists, tree clean', 'all complete'],
  ];
  for (const [name, detect, action] of rows) {
    console.log(`  ${name}\n    detect: ${detect}\n    action: ${action}\n`);
  }
  console.log(`  Steps available: ${STEPS.join(', ')}\n`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// --prompt <STEP> [--item N]: render ONE prompt
// ---------------------------------------------------------------------------

if (promptMode) {
  const step = args.find((a) => !a.startsWith('--') && a !== 'codegen');
  const itemFlag = args.indexOf('--item');
  const item = itemFlag >= 0 ? Number(args[itemFlag + 1]) || 0 : 0;

  if (!step) {
    console.log(`  Usage: node ${SKILL}/scripts/codegen --prompt <STEP> [--item N] [--json]\n`);
    console.log(`  Steps: ${STEPS.join(', ')}\n`);
    process.exit(0);
  }

  const category = CATEGORY_OF[step];
  const patch = category ? loadPatch(projectRoot, category) : null;
  const result = buildStep(step, patch, item);

  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log(`\n${result.prompt}\n`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// --next: pick next step and render prompt
// ---------------------------------------------------------------------------

function refreshPatches() {
  const script = path.join(projectRoot, SKILL, 'scripts/codegen');
  const res = spawnSync('node', [script, '--patch', '--json'], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (res.status !== 0) {
    return { modelError: (res.stderr || res.stdout || 'unknown model error').trim() };
  }
  return { modelError: null };
}

function selectStep({ modelError, patches, hasReport, hasUncommitted }) {
  if (modelError) return { step: 'MODEL_ERROR', item: 0 };

  const all = Object.values(patches ?? {}).flatMap((p) => p?.entries ?? []);
  if (all.some((e) => e.auto === true)) return { step: 'RUN_CODEGEN', item: 0 };

  for (const step of GENERATE_STEPS) {
    const patch = patches?.[CATEGORY_OF[step]];
    if (pendingEntries(patch).length > 0) return { step, item: 0 };
  }

  if (!hasReport) return { step: 'VERIFY', item: 0 };
  if (hasUncommitted) return { step: 'REVIEW', item: 0 };
  return { step: 'DONE', item: 0 };
}

function buildResult(selection, patches, modelError = null) {
  const { step, item } = selection;

  if (step === 'DONE') {
    return { state: 'DONE', step, next: null, remaining: 0 };
  }

  if (step === 'MODEL_ERROR') {
    return {
      state: 'MODEL_ERROR',
      step,
      next: {
        detail: modelError,
        prompt:
          `The event model does not parse: ${modelError}\n\n` +
          'Do NOT fix this in code and do NOT edit the model — both are out of bounds.\n' +
          'Skip this fragment, continue with everything else, and record it in development-report.md.\n' +
          'A blocked fragment is a normal outcome of a run. An unreported one is not.',
      },
      remaining: 0,
    };
  }

  const patch = patches?.[CATEGORY_OF[step]] ?? null;
  const rendered = buildStep(step, patch, item);
  return {
    state: step.startsWith('GENERATE_') ? 'GENERATE' : step,
    step,
    next: { detail: rendered.entry ?? step, prompt: rendered.prompt },
    remaining: rendered.remaining,
  };
}

function printResult(result) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`\n  STEP: ${result.step}`);
  if (result.next) {
    console.log(`\n${result.next.prompt}\n`);
  } else {
    console.log('  All done — nothing pending.\n');
  }
}

if (nextMode) {
  // Refresh patches automatically
  const { modelError } = refreshPatches();

  // Load patches from disk
  const patches = {};
  for (const step of GENERATE_STEPS) {
    const category = CATEGORY_OF[step];
    const file = path.join(projectRoot, PATCH_DIR, `${category}-patch.json`);
    if (!fs.existsSync(file)) continue;
    try {
      patches[category] = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      /* a corrupt patch is treated as absent; the next --patch rewrites it */
    }
  }

  const selection = selectStep({
    modelError,
    patches,
    hasReport: fs.existsSync(path.join(projectRoot, 'development-report.md')),
    hasUncommitted: hasUncommittedChanges(),
  });
  const result = buildResult(selection, patches, modelError);

  printResult(result);

  if (args.includes('--check')) process.exit(result.state === 'DONE' ? 0 : 1);
  process.exit(result.state === 'DONE' ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Default: regenerate code from model
// ---------------------------------------------------------------------------

const written = [];
const preserved = [];
const stale = [];
const staleScaffold = [];
const staleGenerated = [];
const advisoryDrifts = [];
const preservedByHand = [];
const restamped = [];
const needsManualMerge = [];

for (const file of files) {
  const root = file.test ? testRoot : mainRoot;
  const target = path.join(root, ...file.package.split('.'), `${file.className}.java`);
  const exists = fs.existsSync(target);
  const rel = path.relative(projectRoot, target);

  // `once` files are scaffolded then owned by the project (deciders, runtime).
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

  // Logic-bearing classes (handlers, projectors, repositories, entities) are scaffolded
  // on creation and never overwritten when they exist.
  if (isLogicFile(file) && exists) {
    let current = fs.readFileSync(target, 'utf8');

    const adv = computeAdvisory({ currentContent: current, generatedContent: file.content, relPath: rel });
    if (adv && adv.isPreserved) {
      preservedByHand.push(`${rel}  // PRESERVED-BY-HAND: ${adv.reason}`);
      preserved.push(rel);
      continue;
    }

    const genHeader = leadingCommentBlock(file.content);
    const curHeader = leadingCommentBlock(current);
    if (curHeader !== genHeader) {
      const body = current.slice(curHeader.length).replace(/^\n+/, '');
      if (check) {
        stale.push(`${rel}  (header would be reconciled)`);
      } else {
        fs.writeFileSync(target, `${genHeader}\n${body}`);
        written.push(`header   ${rel}`);
        current = `${genHeader}\n${body}`;
      }
    }
    if (adv) {
      advisoryDrifts.push(adv);
      preserved.push(rel);
    } else {
      preserved.push(rel);
    }
    continue;
  }

  // Pure DATA / CONTRACT files are ADD-ONLY once they exist.
  if (!file.once && exists) {
    const current = fs.readFileSync(target, 'utf8');
    if (current === file.content) {
      preserved.push(rel);
      continue;
    }
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
      if (merged.content !== current) {
        if (!check) {
          fs.writeFileSync(target, merged.content);
          written.push(`replaced ${rel}`);
        } else {
          stale.push(`${rel}  (placeholder annotation would be replaced)`);
        }
      } else {
        preserved.push(rel);
      }
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

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

function reportStaleScaffold() {
  console.error(
    `\n  STALE SCAFFOLD  ${staleScaffold.length} once-owned file(s) predate the current template:`,
  );
  staleScaffold.forEach((f) => console.error(`    ${f}`));
  console.error(
    `\n  These are YOURS — the generator will not touch them, and re-running it\n` +
      `  changes nothing. Diff each against its template in scripts/codegen/runtime.js\n` +
      `  and port the delta by hand, then record it:\n\n` +
      `    node ${SKILL}/scripts/codegen --accept-scaffold\n`,
  );
}

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

function reportAdvisoryDrifts() {
  console.error(
    `\n  ADVISORY: ${advisoryDrifts.length} hand-owned logic file(s) differ from the event model.` +
      `\n  Not a "sync the file" task. Two rules, per section:` +
      `\n    ADDITIVE (in model, missing here) -> may be added when needed to compile` +
      `\n                                         or to satisfy a test.` +
      `\n    EXISTING LOGIC (body differs)     -> do NOT rewrite. Only a minimal` +
      `\n                                         compile fix is ever allowed.`,
  );
  for (const adv of advisoryDrifts) {
    console.error(`\n================================================================================`);
    console.error(`  Target: ${adv.relPath}`);
    console.error(`--------------------------------------------------------------------------------`);
    console.error(adv.prompt);
    console.error(`================================================================================\n`);
  }
}

if (checkOnly) {
  if (stale.length) {
    console.error(`\n  OUT OF DATE  ${stale.length} generated file(s) differ from the model:`);
    stale.forEach((f) => console.error(`    ${f}`));
    console.error(`\n  Run the codegen script to refresh them.\n`);
  }
  if (staleScaffold.length) reportStaleScaffold();
  if (staleGenerated.length) reportStaleGenerated();
  if (advisoryDrifts.length) reportAdvisoryDrifts();
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
if (advisoryDrifts.length) {
  reportAdvisoryDrifts();
}
if (staleScaffold.length) {
  reportStaleScaffold();
  process.exit(1);
}
if (needsManualMerge.length) {
  reportNeedsManualMerge();
  process.exit(1);
}
