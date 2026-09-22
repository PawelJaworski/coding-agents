// Command Plugin — emits command, handler and ability
// Extracted from emit.js for pluggable architecture proof-of-concept

// No imports from core/plugins.js needed — they're just JSDoc typedefs

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

function commandHandler(c, events, ctx) {
  const eventStream = ctx.collaborator({
    fieldName: 'eventStream',
    className: 'EventStream',
    testInstantiation: 'EventStreamAbility.INSTANCE',
    imports: [`${ctx.basePackage}.eventstream.EventStream`]
  });

  const extraImports = [];
  const decisions = [];
  const instantiations = events.map((e) => {
    const args = [];
    for (const f of e.fields) {
      const r = f.bracketed && !f.convention
        ? { expr: `${f.name}()`, imports: f.imports, delegated: true }
        : ctx.resolveArg(f, {
            sourceFields: c.fields,
            sourceExpr: 'command',
            delegate: { fieldName: 'unused' }
          });
      if (!r) {
        throw new Error(
          `Model gap: event "${e.id}" field "${f.label}" is not supplied by command "${c.id}" ` +
          `and is not [bracketed]. Either add it to the command or bracket it.`
        );
      }
      extraImports.push(...r.imports);
      args.push(r.expr);
      if (r.delegated) decisions.push({ field: f, eventId: e.id });
    }
    const inner = ['aggregateId', ...args].map((a) => `                ${a}`).join(',\n');
    return `new ${e.className}(\n${inner})`;
  });

  const collaborators = [eventStream];
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
    ...events.map((e) => `${e.package}.${e.className}`),
    ...ctx.collaboratorImports(collaborators),
    ...extraImports,
    ...decisions.flatMap(d => d.field.imports)
  ]);

  const eventList = instantiations.join(',\n');
  const decisionMethods = decisions
    .map(({ field: f, eventId }) =>
      `\n\n    private ${f.javaType} ${f.name}() {\n` +
      `        throw new UnsupportedOperationException(\n` +
      `                "[${f.label}] on event '${eventId}' is a decision with no GWT scenario yet");\n` +
      `    }`
    )
    .join('');

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
      `        var aggregateId = UUID.randomUUID();\n` +
      `        eventStream.append(List.of(${eventList}));\n` +
      `        return aggregateId;\n` +
      `    }${decisionMethods}\n` +
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
  provides: ['command', 'handler', 'ability'],
  requires: ['event'],
  emit: (model, ctx) => {
    const eventsById = new Map(model.events.map(e => [e.id, e]));
    const files = [];

    for (const c of model.commands) {
      const events = c.produces.map(id => eventsById.get(id));
      const handler = commandHandler(c, events, ctx);
      files.push(command(c, ctx), handler);
      files.push(commandAbility(c, ctx, handler.collaborators));
    }

    return files;
  },
  step: commandStep
};
