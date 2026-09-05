#!/usr/bin/env node
// The driver. Picks WHICH step and WHICH item comes next; renders nothing itself.
//
// Two scripts, two jobs, and the split is the whole design:
//
//   codegen --patch   computes the model->code diff. Deterministic, scripted,
//                     never an agent's judgement call.
//   get-prompt.js     renders ONE entry of that diff as a short, standalone prompt.
//   main-flow (here)  decides which step and which entry is next.
//
// The agent loops: `main-flow --next` -> execute the one prompt -> `main-flow --next`,
// until state is DONE. It never holds the workflow in its head, and every prompt is
// small enough to hand to a subagent with a completely fresh context.
//
// Usage:
//   node scripts/main-flow --next          human-readable prompt
//   node scripts/main-flow --next --json   machine-readable JSON
//   node scripts/main-flow --check         exit 0 if DONE, exit 1 otherwise
//   node scripts/main-flow --test          print the full step machine
//   node scripts/main-flow --help          this help

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { buildStep, pendingEntries, GENERATE_STEPS, STEPS } from './get-prompt.js';

const CONFIG_FILE = 'codegen.config.json';
const PATCH_DIR = '.codegen/patch';
const SKILL = '.opencode/skills/backend-development';

const CATEGORY_OF = {
  GENERATE_DOMAIN: 'domain',
  GENERATE_EVENTS: 'events',
  GENERATE_COMMANDS: 'commands',
  GENERATE_READ_MODELS: 'readmodels',
  GENERATE_GWTS: 'gwt',
};

export function findProjectRoot(start) {
  let dir = start;
  for (;;) {
    if (fs.existsSync(path.join(dir, CONFIG_FILE))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// ---------------------------------------------------------------------------
// Pure step selection — exported for testing
// ---------------------------------------------------------------------------

/**
 * Pick the next step and item. Pure: every input is handed in.
 *
 * The order is fixed and total, so two runs on the same tree always agree:
 *
 *   MODEL_ERROR   the model does not parse -> report it, never "fix" it in code
 *   RUN_CODEGEN   the patch has auto:true entries -> the generator does them
 *   GENERATE_*    the first category with an auto:false entry -> one item
 *   VERIFY        nothing pending, no report yet
 *   REVIEW        report written, changes uncommitted
 *   DONE
 *
 * @param {object} params
 * @param {string|null} params.modelError - message, or null
 * @param {Record<string, object>} params.patches - category -> patch document
 * @param {boolean} params.hasReport
 * @param {boolean} params.hasUncommitted
 * @returns {{step:string, item:number}}
 */
export function selectStep({ modelError, patches, hasReport, hasUncommitted }) {
  if (modelError) return { step: 'MODEL_ERROR', item: 0 };

  const all = Object.values(patches ?? {}).flatMap((p) => p?.entries ?? []);
  // The generator's own work comes first and comes in one batch: doing it changes
  // the diff, so any agent item picked before it could already be obsolete.
  if (all.some((e) => e.auto === true)) return { step: 'RUN_CODEGEN', item: 0 };

  for (const step of GENERATE_STEPS) {
    const patch = patches?.[CATEGORY_OF[step]];
    if (pendingEntries(patch).length > 0) return { step, item: 0 };
  }

  if (!hasReport) return { step: 'VERIFY', item: 0 };
  if (hasUncommitted) return { step: 'REVIEW', item: 0 };
  return { step: 'DONE', item: 0 };
}

/**
 * Assemble the result an agent acts on. Pure.
 *
 * @param {{step:string, item:number}} selection
 * @param {Record<string, object>} patches
 * @param {string|null} modelError
 * @returns {object}
 */
export function buildResult(selection, patches, modelError = null) {
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

// ---------------------------------------------------------------------------
// IO
// ---------------------------------------------------------------------------

// The driver runs the diff itself rather than asking the agent to. It is a pure,
// cheap, deterministic script — making it an agent step would only add a chance
// of it being skipped, or of a stale patch being read after codegen ran.
function refreshPatches(projectRoot) {
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

function loadPatches(projectRoot) {
  const dir = path.join(projectRoot, PATCH_DIR);
  const patches = {};
  for (const step of GENERATE_STEPS) {
    const category = CATEGORY_OF[step];
    const file = path.join(dir, `${category}-patch.json`);
    if (!fs.existsSync(file)) continue;
    try {
      patches[category] = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      /* a corrupt patch is treated as absent; the next --patch rewrites it */
    }
  }
  return patches;
}

function hasUncommittedChanges(projectRoot) {
  try {
    return (
      execSync('git status --porcelain', { cwd: projectRoot, encoding: 'utf8', timeout: 5_000 })
        .trim().length > 0
    );
  } catch {
    return false;
  }
}

function printResult(result, json) {
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

function printTest() {
  console.log('\n  Backend Development — Step Machine\n');
  console.log('  main-flow --next  ->  do the ONE prompt  ->  main-flow --next  ->  ...\n');
  console.log('  The diff is scripted (codegen --patch). The agent only applies one entry.\n');
  const rows = [
    ['MODEL_ERROR', 'codegen --patch fails to parse the model', 'report it; never fix in code, never edit the model'],
    ['RUN_CODEGEN', 'any patch entry has auto:true', 'run codegen; CREATE and ADD are the generator\'s job'],
    ['GENERATE_DOMAIN', 'domain-patch.json has an auto:false entry', 'apply one entry'],
    ['GENERATE_EVENTS', 'events-patch.json has an auto:false entry', 'apply one entry'],
    ['GENERATE_COMMANDS', 'commands-patch.json has an auto:false entry', 'apply one entry'],
    ['GENERATE_READ_MODELS', 'readmodels-patch.json has an auto:false entry', 'apply one entry'],
    ['GENERATE_GWTS', 'gwt-patch.json has a pending scenario/rule', 'implement ONE scenario, test-first'],
    ['VERIFY', 'nothing pending, no development-report.md', 'mvn clean verify + codegen --check + write the report'],
    ['REVIEW', 'report exists, working tree dirty', 'delegate to backend-code-reviewer (reading only)'],
    ['DONE', 'report exists, tree clean', 'all complete'],
  ];
  for (const [name, detect, action] of rows) {
    console.log(`  ${name}\n    detect: ${detect}\n    action: ${action}\n`);
  }
  console.log(`  Steps available to get-prompt.js: ${STEPS.join(', ')}\n`);
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');

  if (args.includes('--help')) {
    console.log(`
  Usage:
    node ${SKILL}/scripts/main-flow --next          human-readable prompt
    node ${SKILL}/scripts/main-flow --next --json   machine-readable JSON
    node ${SKILL}/scripts/main-flow --check         exit 0 if DONE, exit 1 otherwise
    node ${SKILL}/scripts/main-flow --test          print the full step machine
`);
    process.exit(0);
  }

  const projectRoot = findProjectRoot(path.resolve(process.cwd()));
  if (!projectRoot) {
    console.error(`\n  ERROR: No ${CONFIG_FILE} found. Run from a project root.\n`);
    process.exit(1);
  }

  if (args.includes('--test')) {
    printTest();
    process.exit(0);
  }

  const { modelError } = refreshPatches(projectRoot);
  const patches = loadPatches(projectRoot);
  const selection = selectStep({
    modelError,
    patches,
    hasReport: fs.existsSync(path.join(projectRoot, 'development-report.md')),
    hasUncommitted: hasUncommittedChanges(projectRoot),
  });
  const result = buildResult(selection, patches, modelError);

  printResult(result, json);

  if (args.includes('--check')) process.exit(result.state === 'DONE' ? 0 : 1);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main();
