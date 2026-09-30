#!/usr/bin/env node
// Event-model -> Java scaffolding generator. Domain-agnostic: everything
// project-specific comes from <project>/codegen.config.json, so this script is
// reusable across every project that uses the sliced event-sourced architecture.
//
// Usage:
//   node <skill>/scripts/codegen                          regenerate (cwd = project root)
//   node <skill>/scripts/codegen --check                  CI gate: fail if stale
//   node <skill>/scripts/codegen --init                   first contact: generate, adopt
//                                                         existing scaffolding by content,
//                                                         itemize the remaining work
//   node <skill>/scripts/codegen --patch                  model -> code diff as .codegen/patch/*.json
//   node <skill>/scripts/codegen --json                   print the parsed model
//   node <skill>/scripts/codegen --next                   pick next step and render prompt
//   node <skill>/scripts/codegen --next --json            ...as machine-readable JSON
//   node <skill>/scripts/codegen --prompt <STEP> [--item N]  render ONE prompt
//   node <skill>/scripts/codegen --test                   print the step machine
//   node <skill>/scripts/codegen --accept-scaffold        record once-files as reconciled
//   node <skill>/scripts/codegen --project <dir> --model <dir>   explicit paths

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseModel } from './model/parse.js';
import { emitWithPlugins, scanWithPlugins } from './core/emit.js';
import { misplacedSpecs } from './ownership/scaffold.js';
import {
  STATE_FILE,
  readGeneratorState,
  writeGeneratorState,
  scaffoldVersion,
  recordScaffoldVersion,
  isPreserved,
  pruneStaleState,
} from './ownership/state.js';
import { mergeGenerated, semanticDrift } from './ownership/merge.js';
import { computeAdvisory, isLogicFile } from './ownership/advisory.js';
import { classifyFile, buildPatches, patchFileName, stalePatchFiles } from './ownership/patch.js';
import { checkSpecHygiene } from './ownership/spec-hygiene.js';
import { getSteps, getStep } from './steps/index.js';
import { selectStep, buildResult } from './core/steps.js';
import { buildStep, pendingEntries, loadPatch } from './cli/prompts.js';
import { createDebugLogger, DEBUG_LOG_PATH } from './cli/debug-log.js';
import { runVerification, verificationFailurePrompt } from './cli/verification.js';

const CONFIG_FILE = 'codegen.config.json';
const DEFAULTS = {
  mainSourceRoot: 'src/main/java',
  testSourceRoot: 'src/test/java',
  groovyTestSourceRoot: 'src/test/groovy',
};

const PATCH_DIR = '.codegen/patch';
const SKILL = '.opencode/skills/backend-development';

const GENERATE_STEPS = getSteps();
const STEPS = ['TRANSLATE', 'RUN_CODEGEN', ...GENERATE_STEPS.map((s) => s.id), 'VERIFY'];

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
const initMode = args.includes('--init');
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
      `    { "basePackage": "com.example.myapp", "modelDir": "docs" }\n`,
  );
}

const config = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(path.join(projectRoot, CONFIG_FILE), 'utf8')) };
if (!config.basePackage) die(`CONFIG ERROR  ${CONFIG_FILE} must declare "basePackage".`);
if (!config.modelDir && !flag('model')) die(`CONFIG ERROR  ${CONFIG_FILE} must declare "modelDir".`);

const modelDir = path.resolve(projectRoot, flag('model') || config.modelDir);
const mainRoot = path.resolve(projectRoot, config.mainSourceRoot);
const testRoot = path.resolve(projectRoot, config.testSourceRoot);
const groovyTestRoot = path.resolve(projectRoot, config.groovyTestSourceRoot);
const debug = createDebugLogger({
  enabled: config.debugCodeGen === true,
  projectRoot,
  nested: process.env.CODEGEN_DEBUG_NESTED === '1',
  argv: args,
});
debug.log('CONFIG', {
  projectRoot,
  modelDir,
  mainSourceRoot: config.mainSourceRoot,
  testSourceRoot: config.testSourceRoot,
  groovyTestSourceRoot: config.groovyTestSourceRoot,
});

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

// ---------------------------------------------------------------------------
// generator-state.json — the generator's own bookkeeping
//
// Which template a `once` file was born from, and why a file deviates on
// purpose: neither is recoverable from source content, so neither lives there.
// One small JSON answers both questions in a single read and is committed with
// the change. See ownership/state.js for the two-way integrity contract.
// ---------------------------------------------------------------------------

const { state: generatorState, error: stateError } = readGeneratorState(projectRoot);
const stateFileMissing = !fs.existsSync(path.join(projectRoot, STATE_FILE));
if (stateError && !testMode) {
  die(
    `STATE ERROR  ${stateError}\n` +
      `  ${STATE_FILE} records which template each \`once\` file was born from and which\n` +
      `  deviations were deliberate — facts no amount of re-reading the code can recover.\n` +
      `  It must parse. Fix the JSON (or delete it to start the bookkeeping fresh), then re-run.\n`,
  );
}

/**
 * Facts about every emitted file that the bookkeeping is kept honest against:
 * does it exist, and does it still differ from what the model would emit?
 */
function collectStateFacts(files) {
  const facts = new Map();
  for (const file of files) {
    const root = file.test ? testRoot : mainRoot;
    const target = path.join(root, ...file.package.split('.'), `${file.className}.java`);
    const rel = path.relative(projectRoot, target);
    const exists = fs.existsSync(target);
    const currentContent = exists ? fs.readFileSync(target, 'utf8') : null;
    facts.set(rel, {
      exists,
      deviates: exists && currentContent !== file.content,
    });
  }
  return facts;
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
  debug.log('PARSE_MODEL');
  model = parseModel({ modelDir, basePackage: config.basePackage });
  if (json && !nextMode && !patchMode && !promptMode) {
    debug.log('MODEL_JSON', { domains: model.domains?.length ?? 0 });
    console.log(JSON.stringify(model, null, 2));
    process.exit(0);
  }
  files = emitWithPlugins(model);
  debug.log('EMIT_MODEL', { files: files.length });
} catch (err) {
  debug.log('MODEL_ERROR', err.message);
  if (nextMode || promptMode) {
    const result = {
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
    };
    debug.log('SELECT_STEP', result);
    debug.prompt('MODEL_ERROR', result.next.prompt);
    printResult(result);
    process.exit(1);
  }
  die(`MODEL ERROR  ${err.message}`);
}

// ---------------------------------------------------------------------------
// --patch: the model->code diff as JSON documents
// ---------------------------------------------------------------------------

function writePatchDocs() {
  debug.log('PATCH_START');
  const entries = [];
  for (const file of files) {
    const root = file.test ? testRoot : mainRoot;
    const target = path.join(root, ...file.package.split('.'), `${file.className}.java`);
    const rel = path.relative(projectRoot, target);
    const currentContent = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
    const entry = classifyFile({ file, currentContent, relPath: rel, state: generatorState });
    if (entry) entries.push(entry);
  }

  // Read-only mode: nothing is pruned or written here. `--next` shells out to
  // `--patch`, so this must never fail the run over bookkeeping.
  const pruned = pruneStaleState(generatorState, collectStateFacts(files));

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
  debug.log('PATCH_RESULT', summary);
  return { summary, pruned };
}

if (patchMode) {
  const { summary, pruned } = writePatchDocs();

  if (json) {
    console.log(
      JSON.stringify(
        { patchDir: PATCH_DIR, patches: summary, warnings: model.warnings, prunedStateEntries: pruned },
        null,
        2,
      ),
    );
    process.exit(0);
  }
  printWarnings(model.warnings);
  if (pruned.length) reportPrunedState(pruned);
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
  debug.log('STEP_MACHINE', { steps: STEPS });
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
    ['DONE', 'report exists, nothing pending', 'all complete'],
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

  const category = getStep(step)?.category ?? null;
  const patch = category ? loadPatch(projectRoot, category) : null;
  const result = buildStep(step, patch, item);
  debug.log('PROMPT', { step, item: result.item, prompt: result.prompt });
  debug.prompt(step, result.prompt);

  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log(`\n${result.prompt}\n`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// --next: pick next step and render prompt
// ---------------------------------------------------------------------------

function refreshPatches() {
  const script = path.join(projectRoot, SKILL, 'scripts/codegen');
  debug.log('REFRESH_PATCHES', { command: `node ${SKILL}/scripts/codegen --patch --json` });
  const res = spawnSync('node', [script, '--patch', '--json'], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, CODEGEN_DEBUG_NESTED: '1' },
  });
  if (res.status !== 0) {
    return { modelError: (res.stderr || res.stdout || 'unknown model error').trim() };
  }
  return { modelError: null };
}

function verifyProject() {
  debug.log('RUN_VERIFY');
  return runVerification(projectRoot);
}

function printWarnings(warnings = []) {
  if (!warnings.length) return;
  console.error(`\n  WARNING${warnings.length > 1 ? 'S' : ''} (model generated with fallbacks):`);
  warnings.forEach((w) => console.error(`    ${w}`));
  console.error(
    `  Each warning became a generated-but-throwing stub. Implement the stub (or fix ` +
      `the model) before relying on the affected element at runtime.\n`,
  );
}

function printResult(result, warnings = []) {
  printWarnings(warnings);
  if (json) {
    console.log(JSON.stringify({ ...result, warnings }, null, 2));
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
  let { modelError } = refreshPatches();

  // Load patches from disk
  function loadPatches() {
    const p = {};
    for (const step of GENERATE_STEPS) {
      const category = step.category;
      const file = path.join(projectRoot, PATCH_DIR, `${category}-patch.json`);
      if (!fs.existsSync(file)) continue;
      try {
        p[category] = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        /* a corrupt patch is treated as absent; the next --patch rewrites it */
      }
    }
    return p;
  }

  let patches = loadPatches();

  let selection = selectStep({
    modelError,
    patches,
    hasReport: fs.existsSync(path.join(projectRoot, 'development-report.md')),
  });

  // When auto:true entries exist, the generator's own work must run first.
  // Auto-run it here so the agent never has to remember to loop.
  if (selection.step === 'RUN_CODEGEN' && !modelError) {
    debug.log('AUTO_RUN_CODEGEN');
    const script = path.join(projectRoot, SKILL, 'scripts/codegen');
    const res = spawnSync('node', [script], {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: 120_000,
      env: { ...process.env, CODEGEN_DEBUG_NESTED: '1' },
    });
    if (res.status !== 0) {
      const errResult = {
        state: 'MODEL_ERROR',
        step: 'MODEL_ERROR',
        next: {
          detail: (res.stderr || res.stdout || 'unknown generator error').trim(),
          prompt: `The generator failed:\n${res.stderr || res.stdout || 'unknown generator error'}`,
        },
        remaining: 0,
      };
      debug.log('SELECT_STEP', errResult);
      debug.prompt('RUN_CODEGEN_FAILED', errResult.next.prompt);
      printResult(errResult);
      process.exit(1);
    }
    // Re-refresh patches after running the generator, then re-select.
    ({ modelError } = refreshPatches());
    patches = loadPatches();
    selection = selectStep({
      modelError,
      patches,
      hasReport: fs.existsSync(path.join(projectRoot, 'development-report.md')),
    });
  }

  if ((selection.step === 'VERIFY' || selection.step === 'DONE') && !modelError) {
    const verification = verifyProject();
    if (!verification.ok) {
      const errResult = {
        state: 'VERIFY',
        step: 'VERIFY',
        next: {
          detail: 'verification failed',
          prompt: verificationFailurePrompt(verification.output),
        },
        remaining: 0,
      };
      debug.log('SELECT_STEP', errResult);
      debug.prompt('VERIFY_FAILED', errResult.next.prompt);
      printResult(errResult);
      process.exit(1);
    }
  }

  const result = buildResult(selection, patches, modelError);
  debug.log('SELECT_STEP', {
    state: result.state,
    step: result.step,
    remaining: result.remaining,
    warnings: model.warnings,
    prompt: result.next?.prompt ?? null,
  });
  debug.prompt(result.step, result.next?.prompt ?? null);

  printResult(result, model.warnings);

  if (args.includes('--check')) process.exit(result.state === 'DONE' ? 0 : 1);
  process.exit(result.state === 'DONE' ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Default: regenerate code from model
// ---------------------------------------------------------------------------

// Bookkeeping that no longer points at anything is dropped first, so a
// `preserved` entry for a file that is gone (or that has drifted back to exactly
// what the model would emit) never rides along. Nothing to refuse over: a
// declaration is a fact about who owns the file, not a claim about its body.
const prunedState = pruneStaleState(generatorState, collectStateFacts(files));

debug.log('GENERATE_START', { files: files.length });
const written = [];
const preserved = [];
const stale = [];
const staleScaffold = [];
const staleGenerated = [];
const advisoryDrifts = [];
const preservedByHand = [];
const restamped = [];
const adopted = [];
const needsManualMerge = [];

for (const file of files) {
  const root = file.test ? testRoot : mainRoot;
  const target = path.join(root, ...file.package.split('.'), `${file.className}.java`);
  const exists = fs.existsSync(target);
  const rel = path.relative(projectRoot, target);

  // `once` files are scaffolded then owned by the project (aggregates, deciders, runtime).
  if (file.once) {
    const template = file.version ?? 1;

    if (!exists) {
      if (check) {
        stale.push(rel);
        continue;
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, file.content);
      recordScaffoldVersion(generatorState, rel, template);
      written.push(`created  ${rel}`);
      continue;
    }

    // Never rewritten — the body may hold local edits an auto-merge would destroy.
    // The only thing that can be stale is the template it was born from. Content
    // is the truth: a body that already matches the current template has nothing
    // to port, so it is adopted at the template version instead of being reported
    // as stale work — first contact with a project whose bookkeeping is missing
    // (no generator-state.json yet) or lags must not cry wolf over every file.
    const current = fs.readFileSync(target, 'utf8');
    const onDisk = scaffoldVersion(generatorState, rel);
    if (current === file.content) {
      if (!check && onDisk !== template) {
        recordScaffoldVersion(generatorState, rel, template);
        adopted.push(`${rel}  (v${onDisk} -> v${template})`);
      }
      preserved.push(rel);
      continue;
    }

    if (acceptScaffold) {
      recordScaffoldVersion(generatorState, rel, template);
      if (onDisk !== template) restamped.push(`${rel}  (v${onDisk} -> v${template})`);
    } else if (onDisk < template) {
      staleScaffold.push(`${rel}  (on disk: v${onDisk}, template: v${template})`);
    }

    preserved.push(rel);
    continue;
  }

  // Logic-bearing classes (handlers, projectors, repositories, entities) are scaffolded
  // on creation and never overwritten when they exist.
  if (isLogicFile(file) && exists) {
    const current = fs.readFileSync(target, 'utf8');

    const adv = computeAdvisory({
      currentContent: current,
      generatedContent: file.content,
      relPath: rel,
      state: generatorState,
    });
    if (adv && adv.isPreserved) {
      preservedByHand.push(rel);
      preserved.push(rel);
      continue;
    }
    // Deliberately NO header reconciliation: the templates carry no banner, so
    // "make the leading comment block match" would delete a comment a developer
    // wrote at the top of their own class.
    if (adv) advisoryDrifts.push(adv);
    preserved.push(rel);
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
    const declared = isPreserved(generatorState, rel);
    if (drift.length > 0) {
      const list = `${rel}  (${drift.join(', ')})`;
      if (declared) {
        preservedByHand.push(rel);
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
// Spec hygiene: specs must reach production through *Ability DSLs only
// ---------------------------------------------------------------------------

const specHygieneViolations = checkSpecHygiene({ groovyTestRoot, projectRoot });

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
      `  changes nothing. Diff each against its CURRENT emitted template — run\n` +
      `\`codegen --init\` (or \`--patch\`): every UPDATE entry carries the template\n` +
      `  body in \`expected\`. Port the delta into the file body (the version recorded\n` +
      `  in ${STATE_FILE} alone proves nothing), then record it:\n\n` +
      `    node ${SKILL}/scripts/codegen --accept-scaffold\n`,
  );
}

function reportAdopted() {
  console.log(`\n  adopted (body already matches the current template — bookkeeping stamped):`);
  adopted.forEach((s) => console.log(`    ${s}`));
}

function reportSpecHygiene() {
  console.error(
    `\n  SPEC HYGIENE  ${specHygieneViolations.length} production collaborator(s) constructed in specs:`,
  );
  specHygieneViolations.forEach((v) =>
    console.error(`    ${v.file}:${v.line}: ${v.snippet}\n      -> reach it through ${v.suggestion}`),
  );
  console.error(
    `\n  A spec reaches production only through *Ability DSLs — never \`new\` a handler,\n` +
      `  projector, repository, entity or event in a spec. Mix in the generated *Ability\n` +
      `  interfaces and call their DSL methods instead.\n`,
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
      `  match the model, and ${STATE_FILE} declares no preserved deviation for them:`,
  );
  staleGenerated.forEach((f) => console.error(`    ${f}`));
  console.error(
    `\n  The add-only merge cannot repair a stale member body. Classify each one:\n` +
      `    - intentional hand edit -> the class is yours: add its path to "preserved" in\n` +
      `      ${STATE_FILE} and explain the decision in a comment beside the code,\n` +
      `      then re-run --check;\n` +
      `    - genuine staleness     -> delete the generated file and regenerate it.\n`,
  );
}

/** Bookkeeping dropped because it no longer describes anything. Informational. */
function reportPrunedState(dropped) {
  console.log(`\n  NOTE  ${STATE_FILE} dropped ${dropped.length} stale entr(y/ies):`);
  dropped.forEach((d) => console.log(`    ${d}`));
}

function reportPreservedByHand() {
  console.log(`\n  preserved by hand (classes the team owns, per ${STATE_FILE}):`);
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
  debug.log('CHECK_RESULT', {
    stale,
    staleScaffold,
    staleGenerated,
    needsManualMerge,
    warnings: model.warnings,
    advisoryDrifts: advisoryDrifts.map((item) => item.relPath),
    specHygiene: specHygieneViolations.map((v) => `${v.file}:${v.line}`),
  });
  // Warnings are non-blocking: the generator deliberately generated a throwing
  // stub instead of aborting. They do not, on their own, make --check fail — but
  // they always print, so the model issue is never hidden.
  printWarnings(model.warnings);
  if (stale.length) {
    console.error(`\n  OUT OF DATE  ${stale.length} generated file(s) differ from the model:`);
    stale.forEach((f) => console.error(`    ${f}`));
    console.error(`\n  Run the codegen script to refresh them.\n`);
  }
  if (staleScaffold.length) reportStaleScaffold();
  if (staleGenerated.length) reportStaleGenerated();
  if (advisoryDrifts.length) reportAdvisoryDrifts();
  if (needsManualMerge.length) reportNeedsManualMerge();
  if (specHygieneViolations.length) reportSpecHygiene();
  if (preservedByHand.length) reportPreservedByHand();
  if (prunedState.length) reportPrunedState(prunedState);
  if (
    stale.length ||
    staleScaffold.length ||
    staleGenerated.length ||
    needsManualMerge.length ||
    specHygieneViolations.length
  ) {
    process.exit(1);
  }
  console.log('codegen: up to date');
  process.exit(0);
}

if (!check) writeGeneratorState(projectRoot, generatorState);

written.forEach((w) => console.log(`  ${w}`));
if (stateFileMissing) {
  console.log(`\n  INIT  no ${STATE_FILE} — once-owned scaffolding adopted by content match`);
}
if (adopted.length) reportAdopted();
if (restamped.length) {
  console.log(`\n  scaffold version recorded in ${STATE_FILE}:`);
  restamped.forEach((s) => console.log(`    ${s}`));
}
if (prunedState.length) reportPrunedState(prunedState);
if (preserved.length) {
  console.log(`\n  kept (yours, scaffolded once / hand-extended):`);
  preserved.forEach((s) => console.log(`    ${s}`));
}
if (preservedByHand.length) reportPreservedByHand();
console.log(
  `\n  ${written.length} written, ${preserved.length} preserved, ` +
    `${files.length - written.length - preserved.length} unchanged`,
);
printWarnings(model.warnings);
debug.log('GENERATE_RESULT', {
  written,
  preserved,
  staleScaffold,
  staleGenerated,
  needsManualMerge,
  warnings: model.warnings,
  debugLog: DEBUG_LOG_PATH,
});
if (initMode) {
  const { summary } = writePatchDocs();
  console.log(`\n  INIT  remaining work itemized in ${PATCH_DIR}/ — UPDATE entries carry the`);
  console.log(`  template body in \`expected\`. Get one prompt at a time:\n`);
  for (const s of summary) {
    if (!s.create && !s.add && !s.update) continue;
    console.log(
      `    ${s.category.padEnd(12)} CREATE ${s.create}  ADD ${s.add}  UPDATE ${s.update}` +
        `   (needs an agent: ${s.needsAgent})`,
    );
  }
  console.log(`\n    node ${SKILL}/scripts/codegen --prompt GENERATE_COMMANDS --item 0\n`);
}
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
if (specHygieneViolations.length) {
  reportSpecHygiene();
  process.exit(1);
}
