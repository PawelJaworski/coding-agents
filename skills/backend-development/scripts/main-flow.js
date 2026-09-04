#!/usr/bin/env node
// Main workflow orchestrator for the backend development pipeline.
//
// A stateless workflow REPL: each call derives the current state from the
// filesystem and returns a small, focused prompt for the next action. The
// agent loops `main-flow --next` → execute prompt → `main-flow --next` → ...
// until state is DONE.
//
// Usage:
//   node scripts/main-flow --next          human-readable prompt
//   node scripts/main-flow --next --json   machine-readable JSON
//   node scripts/main-flow --check         exit 0 if DONE, exit 1 otherwise
//   node scripts/main-flow --test          print the full state machine
//   node scripts/main-flow --help          this help

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CONFIG_FILE = 'codegen.config.json';

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
// IO helpers (not exported — tested via integration or mocked)
// ---------------------------------------------------------------------------

function callCodegen(projectRoot) {
  const script = path.join(
    projectRoot,
    '.opencode/skills/backend-development/scripts/codegen',
  );
  try {
    const stdout = execSync(`node "${script}" --next --json`, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30_000,
    });
    return JSON.parse(stdout.trim());
  } catch (err) {
    if (err.stdout) {
      try {
        return JSON.parse(err.stdout.trim());
      } catch { /* fall through */ }
    }
    return null;
  }
}

function hasUncommittedChanges(projectRoot) {
  try {
    const status = execSync('git status --porcelain', {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: 5_000,
    });
    return status.trim().length > 0;
  } catch {
    return false;
  }
}

function fileExists(projectRoot, ...segments) {
  return fs.existsSync(path.join(projectRoot, ...segments));
}

// ---------------------------------------------------------------------------
// Pure state detection — exported for testing
// ---------------------------------------------------------------------------

/**
 * Determine the current workflow state from a codegen result and filesystem
 * signals. Pure function: no side effects, no IO.
 *
 * @param {object|null} cg - result of `codegen --next --json`, or null
 * @param {object} fsState - { hasReport: boolean, hasUncommitted: boolean }
 * @returns {string} state name
 */
export function detectState(cg, fsState) {
  const { hasReport = false, hasUncommitted = false } = fsState;

  // Codegen states
  if (cg && cg.state === 'OUT_OF_DATE') return 'GENERATE';
  if (
    cg &&
    (cg.state === 'STALE_SCAFFOLD' ||
      cg.state === 'STALE_GENERATED' ||
      cg.state === 'NEEDS_MANUAL_MERGE')
  ) {
    return 'RECONCILE';
  }
  if (cg && cg.state === 'PENDING' && cg.queue && cg.queue.length > 0) {
    return 'IMPLEMENT';
  }

  // Post-codegen states (codegen DONE, queue empty)
  if (cg && cg.state === 'DONE' && (!cg.queue || cg.queue.length === 0)) {
    if (!hasReport) return 'VERIFY';
    if (hasUncommitted) return 'REVIEW';
    return 'DONE';
  }

  // Fallback
  return 'GENERATE';
}

// ---------------------------------------------------------------------------
// Pure prompt builder — exported for testing
// ---------------------------------------------------------------------------

const PROMPTS = {
  GENERATE:
    'Run codegen to regenerate scaffolding from the model:\n\n' +
    '    node .opencode/skills/backend-development/scripts/codegen\n\n' +
    'Then re-run main-flow.',
  RECONCILE:
    'Reconcile the stale files reported by codegen:\n\n' +
    '  • STALE_SCAFFOLD: diff each once-owned file against its template in\n' +
    '    scripts/codegen/runtime.js, port the delta by hand, then run\n' +
    '    `codegen --accept-scaffold`.\n' +
    '  • STALE_GENERATED: delete the file and regenerate.\n\n' +
    '  ADVISORY drift is NOT part of this step. Do not "sync" those files.\n' +
    '  You MAY add a member the model has and the file lacks, and you MAY make\n' +
    '  the minimal edit that restores compilation after a model change. You MUST\n' +
    '  NOT rewrite an existing member body to match the model — that is the\n' +
    '  developer\'s logic. Report it instead.\n\n' +
    'Then re-run main-flow.',
  VERIFY:
    'Run verification and write the development report:\n\n' +
    '  1. mvn clean verify\n' +
    '  2. node .opencode/skills/backend-development/scripts/codegen --check\n' +
    '  3. Write development-report.md at the repo root with three sections:\n' +
    '       1. Problems met\n' +
    '       2. Left as is\n' +
    '       3. Additional — not implemented\n\n' +
    'If codegen --check reports STALE_SCAFFOLD or STALE_GENERATED,\n' +
    'go back to RECONCILE.',
  REVIEW:
    'Delegate to backend-code-reviewer to review all code changes made in this\n' +
    'session.\n\n' +
    'Reviewing is READING. Do not edit code in this state.\n' +
    'In particular, an ADVISORY from `codegen --check` is not a finding to fix:\n' +
    '`--check` exiting `up to date` IS the pass. Never rewrite an existing\n' +
    'member body to match the model — report the drift and finish.',
};

/**
 * Build the prompt for a given state. Pure function.
 *
 * @param {string} state
 * @param {object|null} queueItem - the current queue item (for IMPLEMENT)
 * @param {number} remaining - items remaining after this one
 * @returns {string|null}
 */
export function buildPrompt(state, queueItem = null, remaining = 0) {
  if (state === 'IMPLEMENT' && queueItem) {
    const suffix =
      remaining > 0 ? `\n\n(${remaining} more item(s) queued after this one)` : '';
    return queueItem.prompt + suffix;
  }
  return PROMPTS[state] ?? null;
}

/**
 * Build the full result object. Pure function.
 *
 * @param {string} state
 * @param {object|null} cg - codegen result
 * @returns {object}
 */
export function buildResult(state, cg) {
  const queue = cg?.queue ?? [];
  const queueItem = state === 'IMPLEMENT' && queue.length > 0 ? queue[0] : null;
  const remaining = state === 'IMPLEMENT' ? Math.max(0, queue.length - 1) : 0;
  const prompt = buildPrompt(state, queueItem, remaining);

  return {
    state,
    next: prompt
      ? {
          kind: state.toLowerCase(),
          detail: state === 'IMPLEMENT' ? queueItem?.detail : state,
          prompt,
        }
      : null,
    queue: state === 'IMPLEMENT' ? queue : [],
  };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function printResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`\n  STATE: ${result.state}`);
  if (result.next) {
    console.log(`  NEXT (${result.next.kind}): ${JSON.stringify(result.next.detail)}`);
    console.log(`\n  ${result.next.prompt}\n`);
  } else {
    console.log('  All done — nothing pending.\n');
  }
  if (result.queue && result.queue.length > 1) {
    console.log(`  (${result.queue.length - 1} more item(s) queued after this one)\n`);
  }
}

// ---------------------------------------------------------------------------
// --test: print the full state machine
// ---------------------------------------------------------------------------

function printTest() {
  console.log('\n  Backend Development — Main Flow State Machine\n');
  console.log('  The agent loops: main-flow --next → do the prompt → main-flow --next → ...\n');
  console.log('  Each state derives from the filesystem. No state files needed.\n');

  const states = [
    {
      name: 'GENERATE',
      detect: 'codegen --next → OUT_OF_DATE',
      prompt: 'Run codegen to regenerate scaffolding from the model',
    },
    {
      name: 'RECONCILE',
      detect: 'codegen --next → STALE_SCAFFOLD | STALE_GENERATED | NEEDS_MANUAL_MERGE',
      prompt: 'Diff stale files against templates, port delta, accept-scaffold',
    },
    {
      name: 'IMPLEMENT',
      detect: 'codegen --next → PENDING with queue.length > 0',
      prompt: 'Delegate to backend-implement: one prompt per queue item',
    },
    {
      name: 'VERIFY',
      detect: 'codegen DONE, queue empty, no development-report.md',
      prompt: 'mvn clean verify + codegen --check + write development-report.md',
    },
    {
      name: 'REVIEW',
      detect: 'development-report.md exists, git has uncommitted changes',
      prompt: 'Delegate to backend-code-reviewer',
    },
    {
      name: 'DONE',
      detect: 'development-report.md exists, no uncommitted changes',
      prompt: 'All complete',
    },
  ];

  for (const s of states) {
    console.log(`  ${s.name}`);
    console.log(`    detect: ${s.detect}`);
    console.log(`    action: ${s.prompt}`);
    console.log();
  }

  console.log('  Transitions (linear, stateless):');
  console.log('    GENERATE → RECONCILE → IMPLEMENT → VERIFY → REVIEW → DONE\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const hasFlag = (name) => args.includes(`--${name}`);
  const json = hasFlag('json');
  const check = hasFlag('check');
  const test = hasFlag('test');
  const help = hasFlag('help');

  if (help) {
    console.log(`
  Usage:
    node scripts/main-flow --next          human-readable prompt
    node scripts/main-flow --next --json   machine-readable JSON
    node scripts/main-flow --check         exit 0 if DONE, exit 1 otherwise
    node scripts/main-flow --test          print the full state machine
    node scripts/main-flow --help          this help
`);
    process.exit(0);
  }

  const projectRoot = findProjectRoot(path.resolve(process.cwd()));
  if (!projectRoot) {
    console.error(`\n  ERROR: No ${CONFIG_FILE} found. Run from a project root.\n`);
    process.exit(1);
  }

  if (test) {
    printTest();
    process.exit(0);
  }

  const cg = callCodegen(projectRoot);
  const fsState = {
    hasReport: fileExists(projectRoot, 'development-report.md'),
    hasUncommitted: hasUncommittedChanges(projectRoot),
  };
  const state = detectState(cg, fsState);
  const result = buildResult(state, cg);

  printResult(result, json);

  if (check) {
    process.exit(state === 'DONE' ? 0 : 1);
  }
}

main();
