// GENERATE_EVENTS — the event contract and everything that hangs off it: the
// DomainEventType enum, the Serde wrappers and the EventStreamAbility DSL.
//
// Public surface of this step package: `EventStep` (what the step machine needs)
// and `EventPlugin` (what the emitter registry needs). Emitters live in
// ./emit.js and are re-exported here so tests reach them through one door.

import {
  event,
  eventType,
  stateProjector,
  serdeWrapper,
  serdeRegistry,
  serde,
  eventStreamAbility,
} from './emit.js';

export { event, eventType, stateProjector, serdeWrapper, serdeRegistry, serde, eventStreamAbility };

export const EventStep = {
  id: 'GENERATE_EVENTS',
  category: 'events',
  after: ['GENERATE_DOMAIN'],
};

export const EventPlugin = {
  id: 'event',
  requires: [],
  emit: (model, ctx) => {
    const files = [];
    const ev = model.events;

    ev.forEach((e) => files.push(event(e, ctx), serdeWrapper(e, ctx)));
    files.push(eventType(ev, ctx));
    files.push(stateProjector(ev, ctx));
    files.push(serdeRegistry(ev, ctx));
    files.push(serde(ev, ctx));
    files.push(eventStreamAbility(ctx));

    return files;
  },
  step: EventStep,
};