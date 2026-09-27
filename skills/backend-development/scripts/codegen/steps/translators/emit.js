// --- mapping resolution ------------------------------------------------------
// Same spirit as emit.js resolveArg, but the OTHER direction (external event ->
// command) and the failure mode is a hand-owned stub rather than a hard error:
// the external contract is explicitly not modelled, so "no match" is expected,
// not a model bug.

// GENERATE_TRANSLATORS emitters: Translation Pattern ingress.
//
// A translator turns an external-event payload into a command and hands it to
// CommandHandler. `Type:` selects the ingress adapter (rest | kafka | plain);
// the mapping is best-effort (auto-map by name, throwing stub for the rest)
// because the external contract is explicitly not modelled by the team.

export function sameShape(a, b) {
  if (Boolean(a.list) !== Boolean(b.list)) return false;
  const ac = a.children || [];
  const bc = b.children || [];
  if (ac.length !== bc.length) return false;
  return ac.every((child, i) => child.name === bc[i].name && sameShape(child, bc[i]));
}

/**
 * Resolve ONE command field from the external-event payload.
 * @returns {{expr: string, imports: string[]} | {stub: true, field: object}}
 */
export function resolveMappingField(cmdField, extFields, sourceExpr) {
  if (cmdField.convention) {
    return { expr: cmdField.conventionExpr, imports: cmdField.imports || [] };
  }
  // A [bracketed] field is a DECISION with no upstream source by definition —
  // never auto-map it even when a same-named external field happens to exist
  // (same rule as CommandPlugin's event instantiation).
  if (cmdField.bracketed) {
    return { stub: true, field: cmdField };
  }
  const match = extFields.find((f) => f.name === cmdField.name);
  if (match && sameShape(cmdField, match)) {
    return { expr: `${sourceExpr}.${cmdField.name}()`, imports: [] };
  }
  return { stub: true, field: cmdField };
}

// --- external-event payload record -------------------------------------------

export function externalEventPayload(ext, ctx) {
  const imports = ctx.importBlock(ext.fields.flatMap((f) => f.imports));
  return {
    category: 'translators',
    package: ext.package,
    className: ext.className,
    overwrite: true,
    content: `package ${ext.package};\n\n${imports ? imports + '\n\n' : ''}` +
      `/**\n` +
      ` * Inbound contract of external event '${ext.id}' (from ${ext.systemName}).\n` +
      ` * NOT a DomainEvent — never appended to our stream; a translator maps it\n` +
      ` * onto a command and stops there.\n` +
      ` */\n` +
      `public record ${ext.className}(${ctx.components(ext.fields)}) {\n}\n`,
  };
}

// --- translator --------------------------------------------------------------

export const KIND_REST = 'rest';
export const KIND_KAFKA = 'kafka';

export function translatorKind(typeHint) {
  const t = String(typeHint || '').trim().toLowerCase();
  if (t === KIND_REST) return KIND_REST;
  if (t === KIND_KAFKA) return KIND_KAFKA;
  return 'plain';
}

export function translator(t, model, ctx) {
  const kind = translatorKind(t.typeHint);
  const extById = new Map(model.externalEvents.map((e) => [e.id, e]));
  const cmdById = new Map(model.commands.map((c) => [c.id, c]));

  const subscriptions = t.subscribes.map((id) => extById.get(id));
  const commands = t.produces.map((id) => cmdById.get(id));
  // One handler collaborator per produced command (the user-facing shape:
  // `CommandHandler<IssuePolicyCmd> issuePolicyHandler`).
  const handlers = commands.map((c) => ({
    command: c,
    field: ctx.naming.handlerField(c.handlerClassName),
  }));

  const extraImports = [];
  const stubMethods = [];
  const mapMethods = [];
  const entryMethods = [];

  // One mapping method per (subscribed external event, produced command) pair,
  // overloaded on the payload type when a translator bridges several contracts.
  for (const ext of subscriptions) {
    for (const c of commands) {
      const mapName = ctx.naming.mapMethod(c.id);
      const args = [];
      const stubs = [];
      for (const f of c.fields) {
        const r = resolveMappingField(f, ext.fields, 'payload');
        if (r.stub) {
          stubs.push(f);
          args.push(`                ${f.name}(payload)`);
        } else {
          extraImports.push(...r.imports);
          args.push(`                ${r.expr}`);
        }
      }
      for (const f of stubs) {
        stubMethods.push(
          `\n\n    private ${f.javaType} ${f.name}(${ext.className} payload) {\n` +
            `        throw new UnsupportedOperationException(\n` +
            `                "mapping of external event '${ext.id}' to command field '${f.label}' is not implemented");\n` +
            `    }`,
        );
        extraImports.push(...(f.imports || []));
      }
      mapMethods.push(
        `\n\n    private ${c.className} ${mapName}(${ext.className} payload) {\n` +
          `        return new ${c.className}(\n${args.join(',\n')});\n` +
          `    }`,
      );
    }
  }

  // Routing is hand-owned as soon as more than one command is in play: which
  // command a given external event triggers is a decision, not a derivation.
  const needsDispatch = commands.length > 1;
  for (const ext of subscriptions) {
    const handlerCall = (c) => {
      const h = handlers.find((x) => x.command.id === c.id);
      return { map: ctx.naming.mapMethod(c.id), handle: h.field };
    };
    let body;
    if (needsDispatch) {
      const examples = commands.map((c) => {
        const { map, handle } = handlerCall(c);
        return `    //   var mappedCommand = ${map}(payload);\n    //   return ${handle}.handle(mappedCommand);`;
      }).join('\n');
      stubMethods.push(
        `\n\n    private Long dispatch(${ext.className} payload) {\n` +
          `        throw new UnsupportedOperationException(\n` +
          `                "dispatch of external event '${ext.id}' is not implemented — decide which command(s) it triggers");\n` +
          `        // e.g. one of:\n${examples}\n` +
          `    }`,
      );
      body = `        return dispatch(payload);`;
    } else {
      const { map, handle } = handlerCall(commands[0]);
      body =
        `        var mappedCommand = ${map}(payload);\n` +
        `        return ${handle}.handle(mappedCommand);`;
    }

    const entryName = ctx.naming.entryMethod(ext.id);
    const voidBody = body
      .replace('        return dispatch(payload);', '        dispatch(payload);')
      .replace(
        /        var mappedCommand = (.*);\n        return (.*)\.handle\(mappedCommand\);/,
        '        var mappedCommand = $1;\n        $2.handle(mappedCommand);',
      );

    if (kind === KIND_REST) {
      entryMethods.push(
        `\n\n    @PostMapping("${ext.id}")\n` +
          `    public Long ${entryName}(@RequestBody ${ext.className} payload) {\n${body}\n    }`,
      );
    } else if (kind === KIND_KAFKA) {
      // Two layers on purpose:
      //   String  -> the @KafkaListener entry. The default consumer deserializer
      //              is String/byte[], NOT a custom record, so the wire type is
      //              a String and this layer owns the parse.
      //   typed   -> the ingress logic. Tests call this overload directly with a
      //              payload record — no broker, no container factory, no Kafka
      //              at all. `@KafkaListener` is just the transport bolt-on.
      //
      // The wire format (JSON/Avro/Protobuf/...) is infrastructure, not model —
      // exactly like the external contract itself, the generator does not guess
      // it. The parse is therefore a hand-owned throwing stub, same convention as
      // an unmapped command field. Guessing "JSON via Jackson" would also pin a
      // Jackson major version (Boot 3 auto-configures com.fasterxml...ObjectMapper,
      // Boot 4 auto-configures tools.jackson...), so it is not a safe default.
      const parseName = ctx.naming.parseMethod(ext.id);
      entryMethods.push(
        `\n\n    @KafkaListener(topics = "${ext.id}")\n` +
          `    public void ${entryName}(String raw) {\n` +
          `        ${entryName}(${parseName}(raw));\n` +
          `    }\n` +
          `\n    /**\n` +
          `     * Ingress logic — call this directly in tests (no Kafka needed).\n` +
          `     */\n` +
          `    public void ${entryName}(${ext.className} payload) {\n${voidBody}\n    }`,
      );
      stubMethods.push(
        `\n\n    private ${ext.className} ${parseName}(String raw) {\n` +
          `        throw new UnsupportedOperationException(\n` +
          `                "parsing of external event '${ext.id}' wire format is not implemented — " +\n` +
          `                        "map the raw Kafka payload (JSON/Avro/Protobuf/...) onto ${ext.className}");\n` +
          `    }`,
      );
    } else {
      entryMethods.push(
        `\n\n    public Long ${entryName}(${ext.className} payload) {\n${body}\n    }`,
      );
    }
  }

  const handlerFields = handlers
    .map((h) => `    private final CommandHandler<${h.command.className}> ${h.field};`)
    .join('\n');

  const classAnnotations = [
    kind === KIND_REST ? '@RestController' : null,
    '@Component',
    '@Transactional',
    '@RequiredArgsConstructor',
  ].filter(Boolean).join('\n');

  const imports = ctx.importBlock([
    'lombok.RequiredArgsConstructor',
    'org.springframework.stereotype.Component',
    'org.springframework.transaction.annotation.Transactional',
    ...(kind === KIND_REST
      ? [
          'org.springframework.web.bind.annotation.PostMapping',
          'org.springframework.web.bind.annotation.RequestBody',
          'org.springframework.web.bind.annotation.RestController',
        ]
      : []),
    ...(kind === KIND_KAFKA ? ['org.springframework.kafka.annotation.KafkaListener'] : []),
    `${ctx.basePackage}.eventstream.CommandHandler`,
    ...handlers.map((h) => `${h.command.package}.${h.command.className}`),
    ...subscriptions.map((e) => `${e.package}.${e.className}`),
    ...handlers.flatMap((h) => h.command.fields.flatMap((f) => f.imports || [])),
    ...extraImports,
  ]);

  return {
    category: 'translators',
    package: t.package,
    className: t.className,
    overwrite: true,
    logic: true,
    content: `package ${t.package};\n\n${imports}\n\n` +
      `${classAnnotations}\n` +
      `public class ${t.className} {\n\n` +
      // Every method block below starts with a blank line, so the blocks are
      // concatenated with no separator here — one blank line between members.
      `${handlerFields}${entryMethods.join('')}${mapMethods.join('')}${stubMethods.join('')}\n}\n`,
  };
}
