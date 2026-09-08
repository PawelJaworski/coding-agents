// Pure rendering functions for prompts. Extracted for testability.
// Used by codegen/index.js and tested by get-prompt.test.js.

import { getGenerateSteps, getCategoryOf } from '../steps-bridge.js';

export const GENERATE_STEPS = getGenerateSteps();
const CATEGORY_OF = getCategoryOf();

import fs from 'node:fs';
import path from 'node:path';

const PATCH_DIR = '.codegen/patch';
const SKILL = '.opencode/skills/backend-development';

export const STATIC_PROMPTS = {
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
};

export const VERB_RULES = {
  CREATE: 'CREATE — file absent. Do not hand-write it: run `node ' + SKILL + '/scripts/codegen`.',
  ADD: 'ADD — insert the members listed. Never read, rewrite or delete what is already there.',
  UPDATE:
    'UPDATE — hand-written logic conflicts with the model. Allowed ONLY while the build is red,\n' +
    'and only for the minimal edit that makes it green. Never paste the model over an existing body.\n' +
    'Build green? Then this is not work — report it.',
};

/**
 * Entries an agent is actually needed for. `auto:true` is the generator's job.
 */
export function pendingEntries(patch) {
  return (patch?.entries ?? []).filter((e) => e.auto === false);
}

/**
 * Render ONE patch entry as a standalone prompt. Pure.
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
      prompt: `Unknown step "${step}". Known steps: ${GENERATE_STEPS.join(', ')}`,
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

/**
 * Load a patch from disk. Pure.
 */
export function loadPatch(projectRoot, category) {
  const file = path.join(projectRoot, PATCH_DIR, `${category}-patch.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
