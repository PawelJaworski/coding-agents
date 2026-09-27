// Run the step packages over a model: emit every file, scan for pending work.
//
// Thin by design — the registry decides order (`requires`), each step package
// decides what it emits. Nothing here knows a construct's shape.

import { createBuiltinRegistry } from '../steps/index.js';
import { createEmitContext } from './context.js';

/**
 * Emit every file the model calls for. Returns one flat array of file objects,
 * each already carrying the model category its step derived it from (so
 * `codegen --patch` can split work per category without re-deriving provenance
 * by pattern-matching class names).
 */
export function emitWithPlugins(model) {
  const registry = createBuiltinRegistry();
  const ctx = createEmitContext(model);

  const all = [];
  for (const emitter of registry.getSortedEmitters()) {
    all.push(...emitter.emit(model, ctx));
  }
  return all;
}

/**
 * Run every scanner: pending work (unimplemented GWT scenarios and rules,
 * missing test data) cross-referenced from the model against the filesystem.
 */
export function scanWithPlugins(model, { projectRoot, modelDir, groovyTestRoot, basePackage, testSourceRoot }) {
  const registry = createBuiltinRegistry();
  const ctx = {
    projectRoot,
    modelDir,
    groovyTestRoot,
    testSourceRoot,
    basePackage,
    commands: model.commands,
    readModels: model.readModels,
    translators: model.translators || [],
    externalEvents: model.externalEvents || [],
  };

  const allEntries = [];
  for (const scanner of registry.scanners) {
    allEntries.push(...scanner.scan(model, ctx));
  }
  return allEntries;
}