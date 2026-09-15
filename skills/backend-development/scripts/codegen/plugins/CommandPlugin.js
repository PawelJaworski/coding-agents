// Command Plugin — emits command, handler, aggregate, ability
// Extracted from emit.js for pluggable architecture proof-of-concept

// No imports from core/plugins.js needed — they're just JSDoc typedefs

// Scaffold version for aggregates
const AGGREGATE_SCAFFOLD_VERSION = 1;

const ONCE_HEADER = (what) =>
  `// SCAFFOLDED ONCE by scripts/codegen — this file is YOURS.\n` +
  `// scaffold-version: ${AGGREGATE_SCAFFOLD_VERSION}\n` +
  `// Hand-written logic for ${what}: business rules in check(), one decision per\n` +
  `// [bracketed] field. Drive both in with a test.\n`;

// --- Command emitter --------------------------------------------------------

function command(c, ctx) {
  const imports = ctx.importBlock(['lombok.Builder', ...c.fields.flatMap(f => f.imports)]);
  return {
    category: 'commands',
    package: c.package,
    className: c.className,
    overwrite: true,
    content: `package ${c.package};\n\n${imports}\n\n@Builder\npublic record ${c.className}(${ctx.components(c.fields)}) {\n}\n`
  };
}

// --- Command handler emitter ------------------------------------------------

function commandHandler(c, e, ctx, aggregate) {
  const eventStream = ctx.collaborator({
    fieldName: 'eventStream',
    className: 'EventStream',
    testInstantiation: 'EventStreamAbility.INSTANCE',
    imports: [`${ctx.basePackage}.eventstream.EventStream`]
  });

  // Every command targeting the same <aggregate>:Id/Key name shares ONE
  // aggregate collaborator/class — this is the seam a [bracket] delegates to.
  const aggregateCollaborator = ctx.collaborator({
    fieldName: aggregate.fieldName,
    className: aggregate.className,
    testInstantiation: `${aggregate.abilityClassName}.INSTANCE`,
    imports: [`${aggregate.package}.${aggregate.className}`]
  });

  const extraImports = [];
  const args = [];

  for (const f of e.fields) {
    const r = ctx.resolveArg(f, {
      sourceFields: c.fields,
      sourceExpr: 'command',
      delegate: aggregateCollaborator
    });
    if (!r) {
      throw new Error(
        `Model gap: event "${e.id}" field "${f.label}" is not supplied by command "${c.id}" ` +
        `and is not [bracketed]. Either add it to the command or bracket it.`
      );
    }
    extraImports.push(...r.imports);
    args.push(r.expr);
  }

  const collaborators = [eventStream, aggregateCollaborator];
  const imports = ctx.importBlock([
    'java.util.List',
    'java.util.UUID',
    'lombok.RequiredArgsConstructor',
    'org.springframework.stereotype.Component',
    'org.springframework.transaction.annotation.Transactional',
    'org.springframework.web.bind.annotation.PostMapping',
    'org.springframework.web.bind.annotation.RequestBody',
    'org.springframework.web.bind.annotation.RestController',
    `${ctx.basePackage}.eventstream.CommandHandler`,
    `${e.package}.${e.className}`,
    ...ctx.collaboratorImports(collaborators),
    ...extraImports
  ]);

  const argList = args.map(a => `                ${a}`).join(',\n');

  return {
    category: 'commands',
    package: c.package,
    className: c.handlerClassName,
    overwrite: true,
    logic: true,
    collaborators,
    content: `package ${c.package};\n\n${imports}\n\n` +
      `@RestController\n` +
      `@Component\n` +
      `@Transactional\n` +
      `@RequiredArgsConstructor\n` +
      `public class ${c.handlerClassName} implements CommandHandler<${c.className}> {\n\n` +
      ctx.fieldDeclarations(collaborators) + `\n\n` +
      `    @PostMapping("${c.postMapping}")\n` +
      `    @Override\n` +
      `    public UUID handle(@RequestBody ${c.className} command) {\n` +
      `        ${aggregate.fieldName}.check(command);\n` +
      `        var aggregateId = UUID.randomUUID();\n` +
      `        eventStream.append(List.of(new ${e.className}(\n` +
      `                aggregateId,\n${argList})));\n` +
      `        return aggregateId;\n` +
      `    }\n` +
      `}\n`
  };
}

// --- Aggregate emitter (scaffolded once) ------------------------------------
//
// One aggregate class per <aggregate>:Id/Key name (see events.md), shared by
// every command whose produced event carries that name. `check(cmd)` is
// overloaded per command type — Java resolves the right one from the
// argument's static type, so a second command targeting the same aggregate
// is a new overload, not a new class. One accessor per [bracketed] field,
// same seam a per-command decider used to provide.

function commandAggregate(aggregate, entries, ctx) {
  const seenFields = new Map(); // field.name -> { commandId, javaType }
  const methods = [];
  const commandImports = [];

  for (const { c, e } of entries) {
    commandImports.push(`${c.package}.${c.className}`);
    methods.push(`    public void check(${c.className} command) {\n    }`);

    const decided = e.fields.filter(f => f.bracketed && !f.convention);
    for (const f of decided) {
      const seen = seenFields.get(f.name);
      if (seen && seen.javaType !== f.javaType) {
        throw new Error(
          `Model gap: aggregate "${aggregate.className}" gets "[${f.label}]" from both ` +
          `"${seen.commandId}" (${seen.javaType}) and "${c.id}" (${f.javaType}) with ` +
          `incompatible types. Give the fields distinct labels.`
        );
      }
      if (seen) continue; // same field, same command-independent decision — one accessor
      seenFields.set(f.name, { commandId: c.id, javaType: f.javaType });
      methods.push(
        `    public ${f.javaType} ${f.name}() {\n` +
        `        throw new UnsupportedOperationException(\n` +
        `                "[${f.label}] on event '${e.id}' is a business decision with no GWT scenario yet");\n` +
        `    }`
      );
    }
  }

  const imports = ctx.importBlock([
    'org.springframework.stereotype.Component',
    ...commandImports,
    ...entries.flatMap(({ e }) => e.fields.filter(f => f.bracketed && !f.convention).flatMap(f => f.imports))
  ]);

  return {
    category: 'commands',
    package: aggregate.package,
    className: aggregate.className,
    once: true,
    version: AGGREGATE_SCAFFOLD_VERSION,
    content: `${ONCE_HEADER(`aggregate "${aggregate.className}"`)}package ${aggregate.package};\n\n${imports}\n\n` +
      `@Component\n` +
      `public class ${aggregate.className} {\n\n${methods.join('\n\n')}\n}\n`
  };
}

// --- Aggregate ability emitter (scaffolded once) ----------------------------
//
// Self-contained wiring for the aggregate. Every constructor collaborator is a
// second ability's INSTANCE, so the generated *Ability references this one by a
// stable name and an aggregate gaining a dependency is a one-line edit HERE —
// never a fight with a byte-fixed generated caller.
//   v1 - initial: INSTANCE = new <Aggregate>();

const AGGREGATE_ABILITY_SCAFFOLD_VERSION = 1;

function commandAggregateAbility(aggregate, ctx) {
  const className = aggregate.abilityClassName;
  return {
    category: 'commands',
    test: true,
    once: true,
    version: AGGREGATE_ABILITY_SCAFFOLD_VERSION,
    onceHint: `scaffolded once, then yours: wire the aggregate's collaborators as *Ability.INSTANCE references`,
    package: aggregate.package,
    className,
    content:
      `// SCAFFOLDED ONCE by scripts/codegen — this file is YOURS.\n` +
      `// scaffold-version: ${AGGREGATE_ABILITY_SCAFFOLD_VERSION}\n` +
      `// Self-contained test wiring for the ${aggregate.className} aggregate. Every\n` +
      `// constructor collaborator is another ability's INSTANCE, e.g.\n` +
      `//   ${className}.INSTANCE = new ${aggregate.className}(SomeAbility.INSTANCE);\n` +
      `package ${aggregate.package};\n\n` +
      `public interface ${className} {\n\n` +
      `    ${aggregate.className} INSTANCE = new ${aggregate.className}();\n` +
      `}\n`
  };
}

// --- Command ability emitter ------------------------------------------------

function commandAbility(c, ctx, collaborators) {
  // The DSL pre-sets the builder from TestDataAbility's default-builder method,
  // so a spec overrides only what its scenario cares about. The body never
  // names individual fields — a model that grows stays byte-identical here,
  // and the missing default surfaces as a javac error naming the exact method.
  const td = ctx.naming.testDataAbility(ctx.basePackage);
  return {
    category: 'commands',
    test: true,
    package: c.package,
    className: c.abilityClassName,
    overwrite: true,
    content: `package ${c.package};\n\n` +
      ctx.importBlock([
        'java.util.UUID',
        'java.util.function.Consumer',
        `${ctx.basePackage}.eventstream.EventStreamAbility`,
        `${td.package}.${td.className}`
      ]) + `\n\n` +
      `public interface ${c.abilityClassName} extends ${td.className}, EventStreamAbility {\n\n` +
      `    ${c.handlerClassName} INSTANCE =\n` +
      `            new ${c.handlerClassName}(${ctx.constructorArgs(collaborators)});\n\n` +
      `    default ${c.handlerClassName} get${c.handlerClassName}() {\n` +
      `        return ${c.abilityClassName}.INSTANCE;\n` +
      `    }\n\n` +
      `    default UUID ${c.dslMethod}(Consumer<${c.className}.${c.className}Builder> testCase) {\n` +
      `        var cmd = ${ctx.naming.defaultBuilderMethod(c.className)}();\n` +
      `        testCase.accept(cmd);\n` +
      `        return get${c.handlerClassName}().handle(cmd.build());\n` +
      `    }\n}\n`
  };
}

// --- Step plugin for GENERATE_COMMANDS --------------------------------------

const commandStep = {
  id: 'GENERATE_COMMANDS',
  category: 'commands',
  after: ['GENERATE_EVENTS'],
  detect: (patch) => (patch?.entries ?? []).filter(e => e.auto === false),
  render: (item, index, total) => {
    const left = total - index - 1;
    return [
      `GENERATE_COMMANDS — item ${index + 1}/${total}`,
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

export const CommandPlugin = {
  id: 'command',
  provides: ['command', 'handler', 'aggregate', 'ability'],
  requires: ['event'],
  emit: (model, ctx) => {
    const eventsById = new Map(model.events.map(e => [e.id, e]));
    const files = [];

    // Group commands by the aggregate their produced event carries — one
    // Aggregate class/Ability pair is shared by every command in the group.
    const groups = new Map(); // aggregateName -> [{ c, e }]
    for (const c of model.commands) {
      const e = eventsById.get(c.producesId);
      if (!e) continue;
      const key = e.aggregate;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ c, e });
    }

    for (const [aggregateName, entries] of groups) {
      const aggregate = ctx.naming.aggregate(ctx.basePackage, aggregateName);

      files.push(commandAggregate(aggregate, entries, ctx));
      files.push(commandAggregateAbility(aggregate, ctx));

      for (const { c, e } of entries) {
        const handler = commandHandler(c, e, ctx, aggregate);
        files.push(command(c, ctx), handler);
        files.push(commandAbility(c, ctx, handler.collaborators));
      }
    }

    return files;
  },
  step: commandStep
};
