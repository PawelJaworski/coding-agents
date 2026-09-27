// Prompt rendering for `codegen --next` / `codegen --prompt`.
//
// A prompt is a step's own knowledge, so a step package may override `render`
// (see ../steps/testdata and ../steps/gwt). Everything else falls back to the
// shared verb rules below, which are all any CREATE/ADD/UPDATE item needs.

import fs from 'node:fs';
import path from 'node:path';
import { getStep, getSteps } from '../steps/index.js';

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

/** The shared prompt for one CREATE/ADD/UPDATE item. */
function renderOpEntry(stepId, entry, index, total) {
  const left = total - index - 1;
  return [
    `${stepId} — item ${index + 1}/${total}`,
    '',
    `  ${entry.op}  ${entry.path}`,
    entry.members?.length ? `  members: ${entry.members.join(', ')}` : '',
    '',
    VERB_RULES[entry.op] ?? '',
    '',
    ...(entry.hints ?? []).map((h) => `  ${h}`),
    '',
    `Touch nothing else. ${left > 0 ? `${left} item(s) left in this step.` : 'Last item.'}`,
  ].join('\n');
}

/**
 * Render ONE patch entry as a standalone prompt. Pure.
 * Delegates to the step's own `render` when it has one.
 */
export function renderEntry(stepId, entry, index, total) {
  const step = getStep(stepId);
  if (step?.render) return step.render(entry, index, total);
  return renderOpEntry(stepId, entry, index, total);
}

/**
 * Build the full result for a step. Pure — the patch document is handed in.
 */
export function buildStep(stepId, patch, item = 0) {
  if (STATIC_PROMPTS[stepId]) {
    return { step: stepId, done: false, item: null, remaining: 0, entry: null, prompt: STATIC_PROMPTS[stepId] };
  }

  const step = getStep(stepId);
  if (!step) {
    return {
      step: stepId,
      done: false,
      item: null,
      remaining: 0,
      entry: null,
      prompt: `Unknown step "${stepId}". Known steps: ${getSteps().map((s) => s.id).join(', ')}`,
    };
  }

  if (!patch) {
    return {
      step: stepId,
      done: false,
      item: null,
      remaining: 0,
      entry: null,
      prompt:
        `No patch for "${step.category}" yet. Run step TRANSLATE first:\n\n` +
        `    node ${SKILL}/scripts/codegen --patch`,
    };
  }

  const auto = (patch.entries ?? []).filter((e) => e.auto === true);
  const pending = pendingEntries(patch);

  if (pending.length === 0) {
    const prompt =
      auto.length > 0
        ? `Nothing for an agent in ${stepId}. ${auto.length} entr(y|ies) are the generator's own work:\n\n` +
          `    node ${SKILL}/scripts/codegen\n\n` +
          'Run it, then go to the next step.'
        : `Nothing to do in ${stepId}. Go to the next step.`;
    return { step: stepId, done: true, item: null, remaining: 0, entry: null, prompt };
  }

  const idx = Math.max(0, Math.min(item, pending.length - 1));
  return {
    step: stepId,
    done: false,
    item: idx,
    remaining: pending.length - idx - 1,
    entry: pending[idx],
    prompt: renderEntry(stepId, pending[idx], idx, pending.length),
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