// Plugin-aware emit — replaces the monolithic emit() with plugin registry

import fs from 'node:fs';
import path from 'node:path';
import { createBuiltinRegistry } from './plugins/index.js';
import naming from './naming.js';
import { importBlock, components, collaborator, fieldDeclarations, constructorArgs, collaboratorImports, collaboratorScaffolds, resolveArg } from './emit.js';

/**
 * Emit all files using the plugin registry.
 * Returns the same format as the old emit(model) — an array of File objects
 * with .category already set by each plugin.
 */
export function emitWithPlugins(model) {
  const registry = createBuiltinRegistry();
  const sortedEmitters = registry.getSortedEmitters();

  const eventsById = new Map(model.events.map(e => [e.id, e]));
  const commandsById = new Map(model.commands.map(c => [c.id, c]));
  const readModelsById = new Map(model.readModels.map(rm => [rm.id, rm]));

  const ctx = {
    basePackage: model.meta.basePackage,
    naming,
    eventsById,
    commandsById,
    readModelsById,
    importBlock,
    components,
    collaborator,
    fieldDeclarations,
    constructorArgs,
    collaboratorImports,
    collaboratorScaffolds,
    resolveArg
  };

  const all = [];
  for (const emitter of sortedEmitters) {
    const files = emitter.emit(model, ctx);
    all.push(...files);
  }
  return all;
}

/**
 * Run all scanner plugins and return their patch entries.
 * Scanners compute pending work (like GWT scenarios, or missing TestDataAbility
 * data) by cross-referencing the model against the filesystem.
 */
export function scanWithPlugins(model, { projectRoot, modelDir, groovyTestRoot, basePackage, testSourceRoot }) {
  const registry = createBuiltinRegistry();
  const allEntries = [];

  for (const scanner of registry.scanners) {
    const ctx = {
      projectRoot,
      modelDir,
      groovyTestRoot,
      testSourceRoot,
      basePackage,
      commands: model.commands,
      readModels: model.readModels,
    };
    const entries = scanner.scan(model, ctx);
    allEntries.push(...entries);
  }

  return allEntries;
}

/**
 * Get the sorted step IDs from the plugin registry.
 * Used by get-prompt.js and main-flow.js to discover steps dynamically.
 */
export function getPluginSteps() {
  const registry = createBuiltinRegistry();
  return registry.getSortedSteps();
}

/**
 * Get a step plugin by category (used by get-prompt.js).
 */
export function getStepByCategory(category) {
  const registry = createBuiltinRegistry();
  const steps = registry.getSortedSteps();
  return steps.find(s => s.category === category);
}