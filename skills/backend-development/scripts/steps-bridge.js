// Bridge: exports plugin steps for get-prompt.js and main-flow.js
// These scripts live in scripts/ (not scripts/codegen/) so they need
// a path back to the plugin registry.

import { createBuiltinRegistry } from './codegen/plugins/index.js';

/**
 * Get the ordered list of GENERATE_* step IDs from plugins.
 * Returns ['GENERATE_DOMAIN', 'GENERATE_EVENTS', 'GENERATE_COMMANDS', ...]
 */
export function getGenerateSteps() {
  const registry = createBuiltinRegistry();
  return registry.getSortedSteps().map(s => s.id);
}

/**
 * Get step ID -> patch category mapping from plugins.
 * All steps (including GWT) come from plugins now.
 * Returns { GENERATE_DOMAIN: 'domain', GENERATE_EVENTS: 'events', ... }
 */
export function getCategoryOf() {
  const registry = createBuiltinRegistry();
  const map = {};
  for (const step of registry.getSortedSteps()) {
    map[step.id] = step.category;
  }
  return map;
}

/**
 * Get all step IDs in order (static + generate + static).
 * All generate steps (including GWT) come from plugins.
 */
export function getAllSteps() {
  const generateSteps = getGenerateSteps();
  return [
    'TRANSLATE',
    'RUN_CODEGEN',
    ...generateSteps,
    'VERIFY'
  ];
}
