// GENERATE_COMMANDS — one command record, its hand-owned handler and the
// CommandAbility DSL, per `commands.md` entry.
//
// Public surface of this step package: `CommandStep` (what the step machine
// needs) and `CommandPlugin` (what the emitter registry needs). Emitters live
// in ./emit.js and are re-exported here so tests reach them through one door.

import { command, commandHandler, commandAbility } from './emit.js';

export { command, commandHandler, commandAbility };

export const CommandStep = {
  id: 'GENERATE_COMMANDS',
  category: 'commands',
  after: ['GENERATE_EVENTS'],
};

export const CommandPlugin = {
  id: 'command',
  requires: ['event'],
  emit: (model, ctx) => {
    const eventsById = new Map(model.events.map((e) => [e.id, e]));
    const files = [];

    for (const c of model.commands) {
      const events = c.produces.map((id) => eventsById.get(id));
      const handler = commandHandler(c, events, ctx);
      files.push(command(c, ctx), handler);
      files.push(commandAbility(c, ctx, handler.collaborators));
    }

    return files;
  },
  step: CommandStep,
};
