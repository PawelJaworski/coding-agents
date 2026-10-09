// GENERATE_READ_MODELS — the read model record and its projection.
//
// Three shapes, decided by the model:
//   <aggregate>:Id      on-demand projection — a projector rebuilt per query
//   <aggregate>:Key     persisting projection, single record — entity,
//                       repository and a PersistingProjector that keeps the row
//                       up to date, read back by aggregate id
//   <aggregate>:RowKey  persisting projection, row list — same machinery,
//                       queried as rows (across aggregates, with search)
//
// Public surface of this step package: `ReadModelStep` (what the step machine
// needs) and `ReadModelPlugin` (what the emitter registry needs). Emitters live
// in ./emit.js and are re-exported here so tests reach them through one door.

import {
  readModel,
  projector,
  projectionDecider,
  projectorAbility,
  readModelEntity,
  readModelKey,
  readModelRepository,
  readModelJpaRepository,
  readModelInMemoryRepository,
  persistingProjector,
  persistingProjectorAbility,
  requestRecord,
  queryProjector,
  queryProjectionDecider,
  queryProjectorAbility,
} from './emit.js';

export {
  readModel,
  projector,
  projectionDecider,
  projectorAbility,
  readModelEntity,
  readModelKey,
  readModelRepository,
  readModelJpaRepository,
  readModelInMemoryRepository,
  persistingProjector,
  persistingProjectorAbility,
  requestRecord,
  queryProjector,
  queryProjectionDecider,
  queryProjectorAbility,
};

export const ReadModelStep = {
  id: 'GENERATE_READ_MODELS',
  category: 'readmodels',
  after: ['GENERATE_COMMANDS'],
};

export const ReadModelPlugin = {
  id: 'readmodel',
  requires: ['event'],
  emit: (model, ctx) => {
    const files = [];

    for (const rm of model.readModels) {
      // Query read model (request/response, "---" divider): request record +
      // query projector + decider + ability. No entity, no repository, no
      // PersistingProjector — just the calculation seam.
      if (rm.isQuery) {
        const p = queryProjector(rm, ctx);
        files.push(readModel(rm), requestRecord(rm), p);
        files.push(...ctx.collaboratorScaffolds(p.collaborators));
        files.push(queryProjectorAbility(rm, ctx, p.collaborators));
        continue;
      }

      if (rm.keyed) {
        const p = persistingProjector(rm, ctx.eventsById, ctx);
        files.push(
          readModel(rm),
          readModelEntity(rm),
          readModelRepository(rm),
          readModelJpaRepository(rm),
          readModelInMemoryRepository(rm),
          p,
        );
        if (rm.keyFields.length > 0) files.push(readModelKey(rm));
        files.push(...ctx.collaboratorScaffolds(p.collaborators));
        files.push(persistingProjectorAbility(rm, ctx, p.collaborators));
        continue;
      }
      const p = projector(rm, ctx.eventsById, ctx);
      files.push(readModel(rm), p);
      files.push(...ctx.collaboratorScaffolds(p.collaborators));
      files.push(projectorAbility(rm, ctx, p.collaborators));
    }

    return files;
  },
  step: ReadModelStep,
};