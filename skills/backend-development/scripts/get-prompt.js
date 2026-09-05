#!/usr/bin/env node
// One step, one prompt, one item — the whole point of this script.
//
// The backend flow is a fixed sequence of steps. Each step's prompt is SHORT and
// self-contained, so it can be handed to a subagent with a fresh context that
// knows nothing about the rest of the run. Nothing here decides anything: the
// model->code diff was already computed deterministically by `codegen --patch`
// and written to .codegen/patch/*.json. This script only renders ONE entry of it.
//
//   node <skill>/scripts/get-prompt.js --list
//   node <skill>/scripts/get-prompt.js TRANSLATE
//   node <skill>/scripts/get-prompt.js GENERATE_COMMANDS
//   node <skill>/scripts/get-prompt.js GENERATE_COMMANDS --item 2 --json
//
// `--item` indexes the step's PENDING entries (the `auto:false` ones — the entries
// an agent is actually needed for). Omit it to get the first.

import fs from 'node:fs';
import path from 'node:path';

const CONFIG_FILE = 'codegen.config.json';
const PATCH_DIR = '.codegen/patch';
const SKILL = '.opencode/skills/backend-development';

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
// The step table
// ---------------------------------------------------------------------------

// Steps run in this order. TRANSLATE is a single scripted step: computing the
// model->code diff is a pure function, so an agent never does it — a
// non-deterministic diff would defeat the point of owning a generator.
export const STEPS = [
  'TRANSLATE',
  'RUN_CODEGEN',
  'GENERATE_DOMAIN',
  'GENERATE_EVENTS',
  'GENERATE_COMMANDS',
  'GENERATE_READ_MODELS',
  'GENERATE_GWTS',
  'VERIFY',
  'REVIEW',
];

/** The GENERATE_* steps, in the order they must run. */
export const GENERATE_STEPS = [
  'GENERATE_DOMAIN',
  'GENERATE_EVENTS',
  'GENERATE_COMMANDS',
  'GENERATE_READ_MODELS',
  'GENERATE_GWTS',
];

const CATEGORY_OF = {
  GENERATE_DOMAIN: 'domain',
  GENERATE_EVENTS: 'events',
  GENERATE_COMMANDS: 'commands',
  GENERATE_READ_MODELS: 'readmodels',
  GENERATE_GWTS: 'gwt',
};

const STATIC_PROMPTS = {
  TRANSLATE: `Run: node ${SKILL}/scripts/codegen --patch\nIt writes ${PATCH_DIR}/*.json. Do not diff the model by hand.`,

  RUN_CODEGEN:
    `The patch has auto:true entries — the generator's own work.\n` +
    `Run: node ${SKILL}/scripts/codegen\nThen ask for the next step. Write no scaffolding yourself.`,

  VERIFY:
    `Run: mvn clean verify\nRun: node ${SKILL}/scripts/codegen --check\n\n` +
    'Then write development-report.md at the repo root: 1. Problems met  2. Left as is\n' +
    '3. Additional — not implemented.\n\n' +
    'An ADVISORY is not a failure; --check printing "up to date" IS the pass.\n' +
    'Never commit development-report.md or api/openapi.json.',

  REVIEW:
    'Delegate to backend-code-reviewer.\n' +
    'Reviewing is READING — edit nothing. Report drift, do not resolve it.',
};

// The three verbs. One line each — the file path already says everything about
// WHERE the code goes, because in a sliced architecture the name of a command,
// event or read model determines the name of its handler, projector and
// repository. Explaining that in prose would be restating naming.js.
const VERB_RULES = {
  CREATE: 'CREATE — file absent. Do not hand-write it: run `node ' + SKILL + '/scripts/codegen`.',
  ADD: 'ADD — insert the members listed. Never read, rewrite or delete what is already there.',
  UPDATE:
    'UPDATE — hand-written logic conflicts with the model. Allowed ONLY while the build is red,\n' +
    'and only for the minimal edit that makes it green. Never paste the model over an existing body.\n' +
    'Build green? Then this is not work — report it.',
};

// ---------------------------------------------------------------------------
// Pure rendering — exported for testing
// ---------------------------------------------------------------------------

/** Entries an agent is actually needed for. `auto:true` is the generator's job. */
export function pendingEntries(patch) {
  return (patch?.entries ?? []).filter((e) => e.auto === false);
}

/**
 * Render ONE patch entry as a standalone prompt. Pure.
 *
 * @param {string} step
 * @param {object} entry
 * @param {number} index - position within the pending list
 * @param {number} total - size of the pending list
 * @returns {string}
 */
export function renderEntry(step, entry, index, total) {
  const isGwt = step === 'GENERATE_GWTS';
  const left = total - index - 1;
  const out = [`${step} — item ${index + 1}/${total}`, ''];

  if (isGwt) {
    out.push(`  ${entry.kind === 'business-rule' ? 'rule' : 'scenario'}: "${entry.name}"`);
    out.push(`  source:   <docs>/${entry.source}`);
    out.push(`  spec:     ${entry.spec}`);
    out.push('');
    out.push('Test first: transcribe the name VERBATIM, run it, get a loud failure, then write');
    out.push('the minimal logic in the decider the failure names. Drive it only through *Ability.');
  } else {
    out.push(`  ${entry.op}  ${entry.path}`);
    if (entry.members?.length) out.push(`  members: ${entry.members.join(', ')}`);
    out.push('');
    out.push(VERB_RULES[entry.op] ?? '');
  }

  for (const h of entry.hints ?? []) out.push(`  ${h}`);
  out.push('', `Touch nothing else. ${left > 0 ? `${left} item(s) left in this step.` : 'Last item.'}`);
  return out.join('\n');
}

/**
 * Build the full result for a step. Pure — the patch document is handed in.
 *
 * @param {string} step
 * @param {object|null} patch - the loaded *-patch.json, or null if absent
 * @param {number} item - index into the pending list
 * @returns {{step:string, done:boolean, item:number|null, remaining:number, entry:object|null, prompt:string}}
 */
export function buildStep(step, patch, item = 0) {
  if (STATIC_PROMPTS[step]) {
    return { step, done: false, item: null, remaining: 0, entry: null, prompt: STATIC_PROMPTS[step] };
  }

  const category = CATEGORY_OF[step];
  if (!category) {
    return {
      step,
      done: false,
      item: null,
      remaining: 0,
      entry: null,
      prompt: `Unknown step "${step}". Known steps: ${STEPS.join(', ')}`,
    };
  }

  if (!patch) {
    return {
      step,
      done: false,
      item: null,
      remaining: 0,
      entry: null,
      prompt:
        `No patch for "${category}" yet. Run step TRANSLATE first:\n\n` +
        `    node ${SKILL}/scripts/codegen --patch`,
    };
  }

  const auto = (patch.entries ?? []).filter((e) => e.auto === true);
  const pending = pendingEntries(patch);

  if (pending.length === 0) {
    const prompt =
      auto.length > 0
        ? `Nothing for an agent in ${step}. ${auto.length} entr(y|ies) are the generator's own work:\n\n` +
          `    node ${SKILL}/scripts/codegen\n\n` +
          'Run it, then go to the next step.'
        : `Nothing to do in ${step}. Go to the next step.`;
    return { step, done: true, item: null, remaining: 0, entry: null, prompt };
  }

  const idx = Math.max(0, Math.min(item, pending.length - 1));
  return {
    step,
    done: false,
    item: idx,
    remaining: pending.length - idx - 1,
    entry: pending[idx],
    prompt: renderEntry(step, pending[idx], idx, pending.length),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function loadPatch(projectRoot, category) {
  const file = path.join(projectRoot, PATCH_DIR, `${category}-patch.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');

  if (args.includes('--help') || args.length === 0) {
    console.log(`
  Usage:
    node ${SKILL}/scripts/get-prompt.js --list
    node ${SKILL}/scripts/get-prompt.js <STEP> [--item N] [--json]

  Steps (in order):
${STEPS.map((s) => `    ${s}`).join('\n')}
`);
    process.exit(0);
  }

  if (args.includes('--list')) {
    if (json) console.log(JSON.stringify({ steps: STEPS }, null, 2));
    else STEPS.forEach((s) => console.log(s));
    process.exit(0);
  }

  const step = args.find((a) => !a.startsWith('--'));
  const itemFlag = args.indexOf('--item');
  const item = itemFlag >= 0 ? Number(args[itemFlag + 1]) || 0 : 0;

  const projectRoot = findProjectRoot(path.resolve(process.cwd()));
  if (!projectRoot) {
    console.error(`\n  ERROR: No ${CONFIG_FILE} found. Run from a project root.\n`);
    process.exit(1);
  }

  const category = CATEGORY_OF[step];
  const patch = category ? loadPatch(projectRoot, category) : null;
  const result = buildStep(step, patch, item);

  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log(`\n${result.prompt}\n`);
}

// Run as a CLI, importable as a module (the pure builders above are unit-tested).
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main();
