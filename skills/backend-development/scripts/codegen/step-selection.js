// Pure step selection and result building functions.
// Used by codegen/index.js and tested by main-flow.test.js.

import { getGenerateSteps, getCategoryOf } from '../steps-bridge.js';
import { pendingEntries, buildStep } from './prompts.js';

export const GENERATE_STEPS = getGenerateSteps();
const CATEGORY_OF = getCategoryOf();

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
