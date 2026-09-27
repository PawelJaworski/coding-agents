// GENERATE_COMMANDS emitters: the command record, its hand-owned handler and the
// CommandAbility test DSL.
//
// The handler is hand-owned logic (scaffolded once): its generated private
// decision method is the default home for a [bracketed] value that does not
// belong to aggregate state, and business-rule guards go straight into handle().

export function command(c, ctx) {
  const imports = ctx.importBlock(['lombok.Builder', ...c.fields.flatMap((f) => f.imports)]);
  return {
    category: 'commands',
    package: c.package,
    className: c.className,
    overwrite: true,
    content: `package ${c.package};

${imports}

@Builder
public record ${c.className}(${ctx.components(c.fields)}) {
}
`,
  };
}

export function commandHandler(c, events, ctx) {
  const eventStream = ctx.collaborator({
    fieldName: 'eventStream',
    className: 'EventStream',
    testInstantiation: 'EventStreamAbility.INSTANCE',
    imports: [`${ctx.basePackage}.eventstream.EventStream`],
  });
  const aggregateIdSequence = ctx.collaborator({
    fieldName: 'aggregateIdSequence',
    className: 'AggregateIdSequence',
    testInstantiation: 'AggregateIdSequenceAbility.INSTANCE',
    imports: [`${ctx.basePackage}.infrastructure.AggregateIdSequence`],
  });

  const extraImports = [];
  const decisions = [];
  const instantiations = events.map((e) => {
    const args = [];
    for (const f of e.fields) {
      const r =
        f.bracketed && !f.convention
          ? { expr: `${f.name}()`, imports: f.imports, delegated: true }
          : ctx.resolveArg(f, {
              sourceFields: c.fields,
              sourceExpr: 'command',
              delegate: { fieldName: 'unused' },
            });
      if (!r) {
        throw new Error(
          `Model gap: event "${e.id}" field "${f.label}" is not supplied by command "${c.id}" ` +
            `and is not [bracketed]. Either add it to the command or bracket it.`,
        );
      }
      extraImports.push(...r.imports);
      args.push(r.expr);
      if (r.delegated) decisions.push({ field: f, eventId: e.id });
    }
    const inner = ['aggregateId', ...args].map((a) => `                ${a}`).join(',\n');
    return `new ${e.className}(\n${inner})`;
  });

  const collaborators = [eventStream, aggregateIdSequence];

  const imports = ctx.importBlock([
    'java.util.List',
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
    ...decisions.flatMap((d) => d.field.imports),
  ]);

  const eventList = instantiations.join(',\n');
  const decisionMethods = decisions
    .map(
      ({ field: f, eventId }) => `

    private ${f.javaType} ${f.name}() {
        throw new UnsupportedOperationException(
                "[${f.label}] on event '${eventId}' is a decision with no GWT scenario yet");
    }`,
    )
    .join('');

  return {
    category: 'commands',
    package: c.package,
    className: c.handlerClassName,
    overwrite: true,
    logic: true,
    collaborators,
    content: `package ${c.package};

${imports}

@RestController
@Component
@Transactional
@RequiredArgsConstructor
public class ${c.handlerClassName} implements CommandHandler<${c.className}> {

${ctx.fieldDeclarations(collaborators)}

    @PostMapping("${c.postMapping}")
    @Override
    public Long handle(@RequestBody ${c.className} command) {
        var aggregateId = aggregateIdSequence.nextId();
        eventStream.append(List.of(${eventList}));
        return aggregateId;
    }${decisionMethods}
}
`,
  };
}

export function commandAbility(c, ctx, collaborators) {
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
    content: `package ${c.package};

${ctx.importBlock([
  'java.util.function.Consumer',
  `${ctx.basePackage}.eventstream.EventStreamAbility`,
  `${ctx.basePackage}.infrastructure.AggregateIdSequenceAbility`,
  `${td.package}.${td.className}`,
])}

public interface ${c.abilityClassName} extends ${td.className}, EventStreamAbility {

    ${c.handlerClassName} INSTANCE =
            new ${c.handlerClassName}(${ctx.constructorArgs(collaborators)});

    default ${c.handlerClassName} get${c.handlerClassName}() {
        return ${c.abilityClassName}.INSTANCE;
    }

    default Long ${c.dslMethod}(Consumer<${c.className}.${c.className}Builder> testCase) {
        var cmd = ${ctx.naming.defaultBuilderMethod(c.className)}();
        testCase.accept(cmd);
        return get${c.handlerClassName}().handle(cmd.build());
    }
}
`,
  };
}
