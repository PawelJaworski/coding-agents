// GENERATE_TRANSLATORS — Translation Pattern ingress: one payload record per
// external event, plus a translator per `translators.md` entry.
//
// Public surface of this step package: `TranslatorStep` (what the step machine
// needs) and `TranslatorPlugin` (what the emitter registry needs). Emitters live
// in ./emit.js and are re-exported here so tests reach them through one door.

import {
  translator,
  translatorKind,
  externalEventPayload,
  resolveMappingField,
  sameShape,
  KIND_REST,
} from './emit.js';

export { translator, translatorKind, externalEventPayload, resolveMappingField, sameShape };

export const TranslatorStep = {
  id: 'GENERATE_TRANSLATORS',
  category: 'translators',
  after: ['GENERATE_COMMANDS'],
};

export const TranslatorPlugin = {
  id: 'translator',
  requires: ['command'],
  emit: (model, ctx) => {
    const files = [];
    const translators = model.translators || [];
    const externalEvents = model.externalEvents || [];
    if (translators.length === 0 && externalEvents.length === 0) return files;

    // REST endpoints are paths: two `rest` translators subscribing the same
    // external event would claim the same @PostMapping and fail at startup.
    // Loud and early beats a Spring ambiguous-mapping stack trace. (Kafka
    // listeners on one topic are legitimate fan-in — no such constraint.)
    const restPaths = new Map();
    for (const t of translators) {
      if (translatorKind(t.typeHint) !== KIND_REST) continue;
      for (const id of t.subscribes) {
        const prev = restPaths.get(id);
        if (prev && prev !== t.id) {
          throw new Error(
            `Translators "${prev}" and "${t.id}" both map external event "${id}" to a REST POST endpoint. ` +
              `Two "Type: rest" translators cannot share one external event — give one of them a different ` +
              `Type:, or split the external events they subscribe.`,
          );
        }
        restPaths.set(id, t.id);
      }
    }

    // One payload record per distinct external event (shared by every translator
    // that subscribes it).
    for (const ext of externalEvents) files.push(externalEventPayload(ext, ctx));
    for (const t of translators) files.push(translator(t, model, ctx));

    return files;
  },
  step: TranslatorStep,
};