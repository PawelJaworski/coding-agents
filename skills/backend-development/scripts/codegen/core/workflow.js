// Workflow engine — runs the step machine using registered plugins

import { PluginRegistry } from './registry.js';

/**
 * @typedef {Object} WorkflowContext
 * @property {string} projectRoot
 * @property {string} modelDir
 * @property {string} basePackage
 * @property {string} mainSourceRoot
 * @property {string} testSourceRoot
 * @property {string} groovyTestSourceRoot
 * @property {import('./types.js').NamingConventions} naming
 */

/**
 * @typedef {Object} StepResult
 * @property {'MODEL_ERROR'|'RUN_CODEGEN'|'GENERATE'|'VERIFY'|'DONE'} state
 * @property {string} step
 * @property {StepPrompt|null} next
 * @property {number} remaining
 * @property {StepQueueItem[]} queue
 */

/**
 * @typedef {Object} StepPrompt
 * @property {string} kind
 * @property {any} detail
 * @property {string} prompt
 */

/**
 * @typedef {Object} StepQueueItem
 * @property {string} step
 * @property {string} category
 * @property {import('./plugins.js').PatchEntry[]} items
 */

export class WorkflowEngine {
  /**
   * @param {PluginRegistry} registry
   * @param {WorkflowContext} context
   */
  constructor(registry, context) {
    this.registry = registry;
    this.context = context;
  }

  /**
   * Compute the next step and item to execute
   * @returns {Promise<StepResult>}
   */
  async selectNext(model, modelError, patches, hasReport) {
    // 1. Model error takes precedence
    if (modelError) {
      return this.buildResult('MODEL_ERROR', { detail: modelError, prompt: this.renderModelError(modelError) }, 0);
    }

    // 2. Check for auto:true entries (generator's own work)
    const allEntries = Object.values(patches).flatMap(p => p.entries ?? []);
    if (allEntries.some(e => e.auto === true)) {
      return this.buildResult('RUN_CODEGEN', { detail: 'auto entries', prompt: this.renderRunCodegen() }, 0);
    }

    // 3. Check generate steps in order
    const steps = this.registry.getSortedSteps();
    for (const step of steps) {
      const patch = patches[step.category];
      const pending = this.filterPending(patch);
      if (pending.length > 0) {
        const item = pending[0];
        return this.buildResult('GENERATE', { detail: item, prompt: step.render(item, 0, pending.length) }, pending.length - 1, step.id);
      }
    }

    // 4. Verify step
    if (!hasReport) {
      return this.buildResult('VERIFY', { detail: 'verify', prompt: this.renderVerify() }, 0);
    }

    // 5. Done
    return this.buildResult('DONE', null, 0);
  }

  /**
   * Build queue for --next --json output
   * @returns {StepQueueItem[]}
   */
  buildQueue(model, patches) {
    const steps = this.registry.getSortedSteps();
    const queue = [];
    for (const step of steps) {
      const patch = patches[step.category];
      const pending = this.filterPending(patch);
      if (pending.length > 0) {
        queue.push({ step: step.id, category: step.category, items: pending });
      }
    }
    return queue;
  }

  filterPending(patch) {
    return (patch?.entries ?? []).filter(e => e.auto === false);
  }

  buildResult(state, next, remaining, step) {
    return {
      state,
      step: step ?? state,
      next,
      remaining,
      queue: []
    };
  }

  renderModelError(error) {
    return `The event model does not parse: ${error}\n\n` +
      'Do NOT fix this in code and do NOT edit the model — both are out of bounds.\n' +
      'Skip this fragment, continue with everything else, and record it in development-report.md.\n' +
      'A blocked fragment is a normal outcome of a run. An unreported one is not.';
  }

  renderRunCodegen() {
    return `The patch has auto:true entries — the generator's own work.\n` +
      `Run: node .opencode/skills/backend-development/scripts/codegen\n` +
      `Then ask for the next step. Write no scaffolding yourself.`;
  }

  renderVerify() {
    return `Run: mvn clean verify\n` +
      `Run: node .opencode/skills/backend-development/scripts/codegen --check\n\n` +
      'Then write development-report.md at the repo root: 1. Problems met  2. Left as is\n' +
      '3. Additional — not implemented.\n\n' +
      'An ADVISORY is not a failure; --check printing "up to date" IS the pass.\n' +
      'Never commit development-report.md or api/openapi.json.';
  }
}

/** Pure function: select next step (exported for testing) */
export function selectStep(steps, patches, modelError, hasReport) {
  if (modelError) return { step: 'MODEL_ERROR', item: 0 };

  const allEntries = Object.values(patches).flatMap(p => p.entries ?? []);
  if (allEntries.some(e => e.auto === true)) return { step: 'RUN_CODEGEN', item: 0 };

  for (const step of steps) {
    const patch = patches[step.category];
    const pending = (patch?.entries ?? []).filter(e => e.auto === false);
    if (pending.length > 0) return { step: step.id, item: 0 };
  }

  if (!hasReport) return { step: 'VERIFY', item: 0 };
  return { step: 'DONE', item: 0 };
}