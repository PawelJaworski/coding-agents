// Command Plugin — emits command, handler, decider, ability
// Extracted from emit.js for pluggable architecture proof-of-concept

// No imports from core/plugins.js needed — they're just JSDoc typedefs

// Scaffold version for deciders (must match DECIDER_SCAFFOLD_VERSION in emit.js)
const DECIDER_SCAFFOLD_VERSION = 2;

const ONCE_HEADER = (what) =>
  `// SCAFFOLDED ONCE by scripts/codegen — this file is YOURS.\n` +
  `// scaffold-version: ${DECIDER_SCAFFOLD_VERSION}\n` +
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

function commandHandler(c, e, ctx) {
  const eventStream = ctx.collaborator({
    fieldName: 'eventStream',
    className: 'EventStream',
    testInstantiation: 'EventStreamAbility.INSTANCE',
    imports: [`${ctx.basePackage}.eventstream.EventStream`]
  });

  const decider = ctx.collaborator({
    fieldName: 'decider',
    className: c.deciderClassName,
    testInstantiation: `${c.deciderClassName}Ability.INSTANCE`,
    scaffold: () => commandDecider(c, e, ctx)
  });

  const extraImports = [];
  const args = [];

  for (const f of e.fields) {
    const r = ctx.resolveArg(f, {
      sourceFields: c.fields,
      sourceExpr: 'command',
      delegate: decider
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

  const collaborators = [eventStream, decider];
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
      `        decider.check(command);\n` +
      `        var aggregateId = UUID.randomUUID();\n` +
      `        eventStream.append(List.of(new ${e.className}(\n` +
      `                aggregateId,\n${argList})));\n` +
      `        return aggregateId;\n` +
      `    }\n` +
      `}\n`
  };
}

// --- Command decider emitter (scaffolded once) ------------------------------

function commandDecider(c, e, ctx) {
  const decided = e.fields.filter(f => f.bracketed && !f.convention);
  const methods = decided
    .map(f => `    public ${f.javaType} ${f.name}() {\n` +
      `        throw new UnsupportedOperationException(\n` +
      `                "[${f.label}] on event '${e.id}' is a business decision with no GWT scenario yet");\n` +
      `    }`)
    .join('\n\n');

  const guard = `    public void check(${c.className} command) {\n    }`;
  const body = [guard, methods].filter(Boolean).join('\n\n');
  const imports = ctx.importBlock([
    'org.springframework.stereotype.Component',
    ...decided.flatMap(f => f.imports)
  ]);

  return {
    category: 'commands',
    package: c.package,
    className: c.deciderClassName,
    once: true,
    version: DECIDER_SCAFFOLD_VERSION,
    content: `${ONCE_HEADER(`command "${c.id}"`)}package ${c.package};\n\n${imports}\n\n` +
      `@Component\n` +
      `public class ${c.deciderClassName} {\n\n${body}\n}\n`
  };
}

// --- Decider ability emitter (scaffolded once) -------------------------------
//
// Self-contained wiring for the decider. Every constructor collaborator is a
// second ability's INSTANCE, so the generated *Ability references this one by a
// stable name and a decider gaining a dependency is a one-line edit HERE — never
// a fight with a byte-fixed generated caller.
//   v1 - initial: INSTANCE = new <Decider>();

const DECIDER_ABILITY_SCAFFOLD_VERSION = 1;

function commandDeciderAbility(c, ctx) {
  const className = `${c.deciderClassName}Ability`;
  return {
    category: 'commands',
    test: true,
    once: true,
    version: DECIDER_ABILITY_SCAFFOLD_VERSION,
    onceHint: `scaffolded once, then yours: wire the decider's collaborators as *Ability.INSTANCE references`,
    package: c.package,
    className,
    content:
      `// SCAFFOLDED ONCE by scripts/codegen — this file is YOURS.\n` +
      `// scaffold-version: ${DECIDER_ABILITY_SCAFFOLD_VERSION}\n` +
      `// Self-contained test wiring for the ${c.deciderClassName} decider. Every\n` +
      `// constructor collaborator is another ability's INSTANCE, e.g.\n` +
      `//   ${className}.INSTANCE = new ${c.deciderClassName}(SomeAbility.INSTANCE);\n` +
      `package ${c.package};\n\n` +
      `public interface ${className} {\n\n` +
      `    ${c.deciderClassName} INSTANCE = new ${c.deciderClassName}();\n` +
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
  provides: ['command', 'handler', 'decider', 'ability'],
  requires: ['event'],
  emit: (model, ctx) => {
    const eventsById = new Map(model.events.map(e => [e.id, e]));
    const files = [];

    for (const c of model.commands) {
      const e = eventsById.get(c.producesId);
      if (!e) continue;

      const handler = commandHandler(c, e, ctx);
      files.push(command(c, ctx), handler);
      files.push(...ctx.collaboratorScaffolds(handler.collaborators));
      files.push(commandDeciderAbility(c, ctx));
      files.push(commandAbility(c, ctx, handler.collaborators));
    }

    return files;
  },
  step: commandStep
};