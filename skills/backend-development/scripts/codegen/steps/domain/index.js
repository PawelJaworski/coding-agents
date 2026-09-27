// GENERATE_DOMAIN — value objects, the domain-independent runtime and one plain
// aggregate per aggregate name declared by an event.
//
// Public surface of this step package: `DomainStep` (what the step machine
// needs) and `DomainPlugin` (what the emitter registry needs). Emitters live in
// ./emit.js and are re-exported here so tests reach them through one door.

import {
  valueObject,
  runtimeFiles,
  aggregateIdSequenceAbility,
  aggregateFile,
} from './emit.js';

export { valueObject, runtimeFiles, aggregateIdSequenceAbility, aggregateFile };

export const DomainStep = {
  id: 'GENERATE_DOMAIN',
  category: 'domain',
  after: [],
};

export const DomainPlugin = {
  id: 'domain',
  requires: [],
  emit: (model, ctx) => {
    const files = [];
    model.valueObjects.forEach((vo) => files.push(valueObject(vo, ctx)));
    files.push(...runtimeFiles(ctx));
    files.push(aggregateIdSequenceAbility(ctx));

    // One plain aggregate per aggregate name the events declare.
    const grouped = new Map();
    for (const event of model.events) {
      if (!grouped.has(event.aggregate)) grouped.set(event.aggregate, []);
      grouped.get(event.aggregate).push(event);
    }
    for (const [name, events] of grouped) files.push(aggregateFile(name, events, ctx));

    return files;
  },
  step: DomainStep,
};
