// The emit context handed to every step package's emitters.
//
// Emitters are pure functions of (model fragment, ctx). They never import the
// naming rules or the emit kit directly — everything arrives through ctx, so a
// test can build a context in one line and an emitter stays free of module state.

import naming from '../model/naming.js';
import {
  importBlock,
  components,
  collaborator,
  fieldDeclarations,
  constructorArgs,
  collaboratorImports,
  collaboratorScaffolds,
  resolveArg,
} from '../emit-kit/index.js';

const indexBy = (items) => new Map((items ?? []).map((x) => [x.id, x]));

/**
 * Build the emit context from a parsed model (or a bare `{ basePackage }` for
 * unit tests that exercise one emitter in isolation).
 *
 * @param {{meta?: {basePackage: string}, basePackage?: string, events?: object[],
 *          commands?: object[], readModels?: object[], externalEvents?: object[],
 *          translators?: object[]}} input
 */
export function createEmitContext(input = {}) {
  return {
    basePackage: input?.meta?.basePackage ?? input?.basePackage,
    naming,
    eventsById: indexBy(input.events),
    commandsById: indexBy(input.commands),
    readModelsById: indexBy(input.readModels),
    externalEventsById: indexBy(input.externalEvents),
    translatorsById: indexBy(input.translators),
    importBlock,
    components,
    collaborator,
    fieldDeclarations,
    constructorArgs,
    collaboratorImports,
    collaboratorScaffolds,
    resolveArg,
  };
}