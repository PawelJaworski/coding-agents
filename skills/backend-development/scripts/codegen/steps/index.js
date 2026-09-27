// The step packages, assembled into the emitter/scanner registry.
//
// Adding a construct means adding a directory under ./steps/<name>/ and listing
// its manifest here — the emitters, the step's prompt and its scanner all travel
// together in that package. Order comes from each manifest's `requires`
// (emitters) and each step's `after` (the step machine), never from this list.

import { PluginRegistry } from '../core/registry.js';
import { DomainPlugin } from './domain/index.js';
import { EventPlugin } from './events/index.js';
import { CommandPlugin } from './commands/index.js';
import { TranslatorPlugin } from './translators/index.js';
import { ReadModelPlugin } from './readmodels/index.js';
import { TestDataPlugin } from './testdata/index.js';
import { GWTPlugin } from './gwt/index.js';

export const BUILTIN_STEPS = [
  DomainPlugin,
  EventPlugin,
  CommandPlugin,
  TranslatorPlugin,
  ReadModelPlugin,
  TestDataPlugin,
  GWTPlugin,
];

/** Create a registry with all built-in step packages. */
export function createBuiltinRegistry() {
  const registry = new PluginRegistry();
  registry.registerAll(BUILTIN_STEPS);
  return registry;
}

/** Every step definition, in step-machine order. */
export function getSteps() {
  return createBuiltinRegistry().getSortedSteps();
}

/** The step definition for one step id, or null. */
export function getStep(stepId) {
  return getSteps().find((s) => s.id === stepId) ?? null;
}

/** The step definition for one patch category, or null. */
export function getStepByCategory(category) {
  return getSteps().find((s) => s.category === category) ?? null;
}