// Read Model Plugin — emits read models, projectors, entities, repositories,
// projection deciders and abilities for <aggregate>:Id (on-demand) and
// <aggregate>:Key (persisting) projections.
// Extracted from emit.js for pluggable architecture; reuses the shared emitters.

import {
  readModel,
  projector,
  readModelEntity,
  readModelKey,
  readModelRepository,
  readModelJpaRepository,
  readModelInMemoryRepository,
  persistingProjector,
  projectorAbility,
  persistingProjectorAbility,
} from '../emit.js';

// --- Step plugin for GENERATE_READ_MODELS -----------------------------------

const readModelStep = {
  id: 'GENERATE_READ_MODELS',
  category: 'readmodels',
  after: ['GENERATE_COMMANDS'],
  detect: (patch) => (patch?.entries ?? []).filter(e => e.auto === false),
  render: (item, index, total) => {
    const left = total - index - 1;
    return [
      `GENERATE_READ_MODELS — item ${index + 1}/${total}`,
      '',
      `  ${item.op}  ${item.path}`,
      item.members?.length ? `  members: ${item.members.join(', ')}` : '',
      '',
      item.op === 'CREATE' ? 'CREATE — file absent. Do not hand-write it: run `node .opencode/skills/backend-development/scripts/codegen`.' :
      item.op === 'ADD' ? 'ADD — insert the members listed. Never read, rewrite or delete what is already there.' :
      'UPDATE — hand-written logic conflicts with the model. Allowed ONLY while the build is red,\n' +
      'and only for the minimal edit that makes it green. Never paste the model over an existing body.\n' +
      'Build green? Then this is not work — report it.',
      '',
      ...(item.hints ?? []).map(h => `  ${h}`),
      '',
      `Touch nothing else. ${left > 0 ? `${left} item(s) left in this step.` : 'Last item.'}`
    ].join('\n');
  }
};

// --- Plugin manifest --------------------------------------------------------

export const ReadModelPlugin = {
  id: 'readmodel',
  provides: ['read-model', 'projector', 'projection-decider', 'read-model-ability'],
  requires: ['event'],
  emit: (model, ctx) => {
    const files = [];
    const categorized = (f) => (f ? { ...f, category: 'readmodels' } : null);

    for (const rm of model.readModels) {
      if (rm.keyed) {
        const p = persistingProjector(rm, ctx.eventsById, ctx.basePackage);
        files.push(
          categorized(readModel(rm)),
          categorized(readModelEntity(rm)),
          categorized(readModelRepository(rm)),
          categorized(readModelJpaRepository(rm)),
          categorized(readModelInMemoryRepository(rm)),
          categorized(p),
        );
        if (rm.keyFields.length > 0) {
          files.push(categorized(readModelKey(rm)));
        }
        files.push(...ctx.collaboratorScaffolds(p.collaborators).map(categorized));
        files.push(categorized(persistingProjectorAbility(rm, ctx.basePackage, p.collaborators)));
        continue;
      }
      const p = projector(rm, ctx.eventsById, ctx.basePackage);
      files.push(categorized(readModel(rm)), categorized(p));
      files.push(...ctx.collaboratorScaffolds(p.collaborators).map(categorized));
      files.push(categorized(projectorAbility(rm, ctx.basePackage, p.collaborators)));
    }

    return files;
  },
  step: readModelStep
};