// Aggregate Plugin — emits one plain, event-hydrated aggregate per aggregate name

const AGGREGATE_SCAFFOLD_VERSION = 1;

function aggregateFile(aggregateName, events, ctx) {
  const aggregate = ctx.naming.aggregate(ctx.basePackage, aggregateName);
  const imports = ctx.importBlock([
    'java.util.UUID',
    `${ctx.basePackage}.eventstream.StateProjector`,
    ...events.map(e => `${e.package}.${e.className}`)
  ]);
  const applyMethods = events
    .map(e =>
      `    @Override\n` +
      `    public ${aggregate.className} apply(${aggregate.className} state, ${e.className} event) {\n` +
      `        return new ${aggregate.className}(event.aggregateId());\n` +
      `    }`
    )
    .join('\n\n');

  return {
    category: 'domain',
    package: aggregate.package,
    className: aggregate.className,
    once: true,
    version: AGGREGATE_SCAFFOLD_VERSION,
    onceHint: 'scaffolded once, then yours: keep only state and rules derived from this aggregate history',
    content:
      `// SCAFFOLDED ONCE by scripts/codegen — this file is YOURS.\n` +
      `// scaffold-version: ${AGGREGATE_SCAFFOLD_VERSION}\n` +
      `// Plain domain state hydrated only from events carrying this aggregate id.\n` +
      `package ${aggregate.package};\n\n` +
      `${imports}\n\n` +
      `public record ${aggregate.className}(UUID id) implements StateProjector<${aggregate.className}> {\n\n` +
      `${applyMethods}\n` +
      `}\n`
  };
}

export const AggregatePlugin = {
  id: 'aggregate',
  provides: ['aggregate'],
  requires: ['event'],
  emit: (model, ctx) => {
    const grouped = new Map();
    for (const event of model.events) {
      if (!grouped.has(event.aggregate)) grouped.set(event.aggregate, []);
      grouped.get(event.aggregate).push(event);
    }
    return [...grouped].map(([name, events]) => aggregateFile(name, events, ctx));
  }
};
