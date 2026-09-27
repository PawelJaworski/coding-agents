// GENERATE_EVENTS emitters: the event contract, its type/serde wiring, the
// StateProjector seam and the EventStreamAbility test DSL.
//
// The model-dependent parts of the event-sourcing runtime live here and ARE
// regenerated; the domain-independent half lives in ../domain/emit.js.

export function event(e, ctx) {
  const imports = ctx.importBlock([
    'lombok.Builder',
    `${ctx.basePackage}.eventstream.DomainEvent`,
    ...e.fields.flatMap(f => f.imports)
  ]);
  return {
    category: 'events',
    package: e.package,
    className: e.className,
    overwrite: true,
    content: `package ${e.package};\n\n${imports}\n\n@Builder\npublic record ${e.className}(Long aggregateId, ${ctx.components(e.fields)}) implements DomainEvent {\n    @Override\n    public DomainEventType eventType() {\n        return DomainEventType.${e.typeEnum};\n    }\n}\n`
  };
}

// --- Event type enum emitter ------------------------------------------------

export function eventType(events, ctx) {
  const constants = events.map(e => `    ${e.typeEnum},`).join('\n');
  return {
    category: 'events',
    package: `${ctx.basePackage}.domain.events`,
    className: 'DomainEventType',
    overwrite: true,
    content: `package ${ctx.basePackage}.domain.events;\n\npublic enum DomainEventType {\n${constants}\n}\n`
  };
}

// --- State projector interface emitter --------------------------------------

export function stateProjector(events, ctx) {
  const cases = events
    .map(e => `            case ${e.typeEnum} -> apply(state, (${e.className}) event);`)
    .join('\n');
  const defaults = events
    .map(e => `    default S apply(S state, ${e.className} event) {\n        return state;\n    }`)
    .join('\n\n');
  const imports = ctx.importBlock([
    'java.util.Collection',
    ...events.map(e => `${e.package}.${e.className}`)
  ]);
  return {
    category: 'events',
    package: `${ctx.basePackage}.eventstream`,
    className: 'StateProjector',
    overwrite: true,
    content: `package ${ctx.basePackage}.eventstream;\n\n${imports}\n\npublic interface StateProjector<S> {\n\n    default S hydrate(S state, Collection<DomainEvent> events) {\n        return events.stream().reduce(state, this::apply, (_, s2) -> s2);\n    }\n\n    private S apply(S state, DomainEvent event) {\n        return switch (event.eventType()) {\n${cases}\n            default -> state;\n        };\n    }\n\n${defaults}\n}\n`
  };
}

// --- Serde wrapper emitter --------------------------------------------------

export function serdeWrapper(e, ctx) {
  return {
    category: 'events',
    package: e.serdePackage,
    className: e.serdeClassName,
    overwrite: true,
    content: `package ${e.serdePackage};\n\n` +
      ctx.importBlock([
        'com.fasterxml.jackson.annotation.JsonTypeName',
        `${ctx.basePackage}.domain.events.DomainEventType`,
        `${e.package}.${e.className}`
      ]) + `\n\n` +
      `@JsonTypeName("${e.typeEnum}")\n` +
      `public record ${e.serdeClassName}(${e.className} event) implements DomainEventSerdeWrapper {\n` +
      `    @Override\n` +
      `    public DomainEventType getEventType() {\n` +
      `        return DomainEventType.${e.typeEnum};\n` +
      `    }\n}\n`
  };
}

// --- Serde registry emitter -------------------------------------------------

export function serdeRegistry(events, ctx) {
  const subTypes = events
    .map(e => `        @JsonSubTypes.Type(value = ${e.serdeClassName}.class, name = "${e.typeEnum}"),`)
    .join('\n');
  return {
    category: 'events',
    package: `${ctx.basePackage}.infrastructure`,
    className: 'DomainEventSerdeWrapper',
    overwrite: true,
    content: `package ${ctx.basePackage}.infrastructure;\n\n` +
      ctx.importBlock([
        'com.fasterxml.jackson.annotation.JsonIgnoreProperties',
        'com.fasterxml.jackson.annotation.JsonInclude',
        'com.fasterxml.jackson.annotation.JsonSubTypes',
        'com.fasterxml.jackson.annotation.JsonTypeInfo',
        `${ctx.basePackage}.domain.events.DomainEventType`,
        `${ctx.basePackage}.eventstream.DomainEvent`
      ]) + `\n\n` +
      `@JsonTypeInfo(\n` +
      `        use = JsonTypeInfo.Id.NAME,\n` +
      `        include = JsonTypeInfo.As.EXISTING_PROPERTY,\n` +
      `        property = "eventType")\n` +
      `@JsonSubTypes({\n${subTypes}\n})` +
      `@JsonIgnoreProperties(ignoreUnknown = true)\n` +
      `@JsonInclude(JsonInclude.Include.NON_NULL)\n` +
      `public interface DomainEventSerdeWrapper {\n` +
      `    DomainEventType getEventType();\n` +
      `    DomainEvent event();\n}\n`
  };
}

// --- Serde serializer emitter -----------------------------------------------

export function serde(events, ctx) {
  const cases = events
    .map(e => `            case ${e.typeEnum} -> new ${e.serdeClassName}((${e.className}) event);`)
    .join('\n');
  return {
    category: 'events',
    package: `${ctx.basePackage}.infrastructure`,
    className: 'DomainEventSerde',
    overwrite: true,
    content: `package ${ctx.basePackage}.infrastructure;\n\n` +
      ctx.importBlock([`${ctx.basePackage}.eventstream.DomainEvent`, ...events.map(e => `${e.package}.${e.className}`)]) + `\n\n` +
      `public final class DomainEventSerde {\n\n` +
      `    private DomainEventSerde() {\n    }\n\n` +
      `    public static DomainEventSerdeWrapper serialize(DomainEvent event) {\n` +
      `        return switch (event.eventType()) {\n${cases}\n            default -> throw new IllegalArgumentException("No serde wrapper for " + event.eventType());\n        };\n    }\n}\n`
  };
}

// --- Event stream ability emitter -------------------------------------------

export function eventStreamAbility(ctx) {
  return {
    category: 'events',
    test: true,
    package: `${ctx.basePackage}.eventstream`,
    className: 'EventStreamAbility',
    overwrite: true,
    content: `package ${ctx.basePackage}.eventstream;\n\n` +
      ctx.importBlock([
        'java.util.List',
        'java.util.concurrent.CopyOnWriteArrayList',
        `${ctx.basePackage}.infrastructure.DomainEventInMemoryRepository`,
        `${ctx.basePackage}.infrastructure.EventStreamImpl`
      ]) + `\n\n` +
      `public interface EventStreamAbility {\n\n` +
      `    List<PersistingProjector> PROJECTORS = new CopyOnWriteArrayList<>();\n` +
      `    List<Runnable> PROJECTION_RESETS = new CopyOnWriteArrayList<>();\n\n` +
      `    DomainEventInMemoryRepository REPOSITORY = new DomainEventInMemoryRepository();\n` +
      `    EventStream INSTANCE = new EventStreamImpl(REPOSITORY, PROJECTORS);\n\n` +
      `    static <P extends PersistingProjector> P register(P projector, Runnable reset) {\n` +
      `        EventStreamAbility.PROJECTORS.add(projector);\n` +
      `        EventStreamAbility.PROJECTION_RESETS.add(reset);\n` +
      `        return projector;\n    }\n\n` +
      `    default EventStream getEventStream() {\n` +
      `        return EventStreamAbility.INSTANCE;\n    }\n\n` +
      `    default void reset_event_stream() {\n` +
      `        EventStreamAbility.REPOSITORY.deleteAll();\n` +
      `        EventStreamAbility.PROJECTION_RESETS.forEach(Runnable::run);\n    }\n}\n`
  };
}
