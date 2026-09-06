// Domain Plugin — emits value objects and domain-independent runtime
// Extracted from emit.js (runtimeFiles) for pluggable architecture proof-of-concept

// Runtime scaffold versions (from runtime.js)
const RUNTIME_VERSIONS = {
  DomainEvent: 1,
  CommandHandler: 1,
  EventHandler: 1,
  EventStream: 1,
  PersistingProjector: 1,
  EventStreamImpl: 2,
  DomainEventRepository: 1,
  DomainEventJpaRepository: 1,
  DomainEventInMemoryRepository: 1,
  DomainEventEntity: 2
};

const HEADER = (version) =>
  `// SCAFFOLDED ONCE by the backend codegen — this file is YOURS.\n` +
  `// scaffold-version: ${version}\n` +
  `// Domain-independent event-sourcing runtime; adapt it freely.\n`;

// --- Value object emitter ---------------------------------------------------

function valueObject(vo, ctx) {
  const needsList = vo.fields.some(f => f.javaType.startsWith('List<'));
  const immutable = !needsList;
  const headers = [];
  if (immutable) headers.push('import jakarta.persistence.Embeddable;');
  const imports = [...headers, ...(needsList ? ['import java.util.List;'] : [])];
  return {
    category: 'domain',
    package: vo.package,
    className: vo.className,
    overwrite: true,
    content: `package ${vo.package};\n\n${imports.length ? imports.join('\n') + '\n\n' : ''}${immutable ? '@Embeddable\n' : ''}public record ${vo.className}(${ctx.components(vo.fields)}) {\n}\n`
  };
}

// --- Runtime files (scaffolded once) ----------------------------------------

function runtimeFiles(ctx) {
  const base = ctx.basePackage;
  return [
    {
      category: 'domain',
      package: `${base}.eventstream`,
      className: 'DomainEvent',
      once: true,
      version: RUNTIME_VERSIONS.DomainEvent,
      content: `${HEADER(RUNTIME_VERSIONS.DomainEvent)}package ${base}.eventstream;\n\nimport java.util.UUID;\nimport ${base}.domain.events.DomainEventType;\n\npublic interface DomainEvent {\n    UUID aggregateId();\n    DomainEventType eventType();\n}\n`
    },
    {
      category: 'domain',
      package: `${base}.eventstream`,
      className: 'CommandHandler',
      once: true,
      version: RUNTIME_VERSIONS.CommandHandler,
      content: `${HEADER(RUNTIME_VERSIONS.CommandHandler)}package ${base}.eventstream;\n\nimport java.util.UUID;\n\npublic interface CommandHandler<T> {\n    UUID handle(T cmd);\n}\n`
    },
    {
      category: 'domain',
      package: `${base}.eventstream`,
      className: 'EventHandler',
      once: true,
      version: RUNTIME_VERSIONS.EventHandler,
      content: `${HEADER(RUNTIME_VERSIONS.EventHandler)}package ${base}.eventstream;\n\npublic interface EventHandler<E> {\n    void handle(E event);\n}\n`
    },
    {
      category: 'domain',
      package: `${base}.eventstream`,
      className: 'EventStream',
      once: true,
      version: RUNTIME_VERSIONS.EventStream,
      content: `${HEADER(RUNTIME_VERSIONS.EventStream)}package ${base}.eventstream;\n\nimport java.util.Collection;\nimport java.util.List;\nimport java.util.UUID;\n\npublic interface EventStream {\n    void append(Collection<DomainEvent> events);\n    List<DomainEvent> findAllById(UUID id);\n}\n`
    },
    {
      category: 'domain',
      package: `${base}.eventstream`,
      className: 'PersistingProjector',
      once: true,
      version: RUNTIME_VERSIONS.PersistingProjector,
      content: `${HEADER(RUNTIME_VERSIONS.PersistingProjector)}package ${base}.eventstream;\n\n/**\n * A projection that keeps its own table instead of being replayed per request.\n * Declared in readmodels.md with {@code <aggregate>:Key}.\n *\n * <p>On-demand projections ({@code <aggregate>:Id}) hydrate from the stream on every\n * read, so they need no notification. A persisting one spans aggregates and therefore\n * cannot be rebuilt from {@code findAllById}, so the event stream pushes each appended\n * event here, synchronously and inside the appending transaction.\n */\npublic interface PersistingProjector {\n    void project(DomainEvent event);\n}\n`
    },
    {
      category: 'domain',
      package: `${base}.infrastructure`,
      className: 'EventStreamImpl',
      once: true,
      version: RUNTIME_VERSIONS.EventStreamImpl,
      content: `${HEADER(RUNTIME_VERSIONS.EventStreamImpl)}package ${base}.infrastructure;\n\nimport java.util.Collection;\nimport java.util.List;\nimport java.util.UUID;\nimport lombok.RequiredArgsConstructor;\nimport org.springframework.stereotype.Component;\nimport ${base}.eventstream.DomainEvent;\nimport ${base}.eventstream.EventStream;\nimport ${base}.eventstream.PersistingProjector;\n\n@Component\n@RequiredArgsConstructor\npublic class EventStreamImpl implements EventStream {\n\n    private final DomainEventRepository repository;\n\n    /**\n     * Held by reference, never copied. Spring injects an immutable list, but a test\n     * ability registers its own projector into a shared mutable collection AFTER this\n     * stream is constructed — a defensive copy would silently drop those.\n     */\n    private final Collection<PersistingProjector> projectors;\n\n    @Override\n    public void append(Collection<DomainEvent> events) {\n        events.forEach(event -> {\n            repository.save(new DomainEventEntity(event));\n            // Persisting projections (<aggregate>:Key) cannot be replayed per request,\n            // so they are advanced here, synchronously, in the same transaction.\n            projectors.forEach(projector -> projector.project(event));\n        });\n    }\n\n    @Override\n    public List<DomainEvent> findAllById(UUID id) {\n        return repository.findAllByAggregateId(id).stream()\n                .map(DomainEventEntity::toDomainEvent)\n                .toList();\n    }\n}\n`
    },
    {
      category: 'domain',
      package: `${base}.infrastructure`,
      className: 'DomainEventRepository',
      once: true,
      version: RUNTIME_VERSIONS.DomainEventRepository,
      content: `${HEADER(RUNTIME_VERSIONS.DomainEventRepository)}package ${base}.infrastructure;\n\nimport java.util.List;\nimport java.util.Optional;\nimport java.util.UUID;\n\npublic interface DomainEventRepository {\n    DomainEventEntity save(DomainEventEntity entity);\n    Optional<DomainEventEntity> findById(Long id);\n    List<DomainEventEntity> findAllByAggregateId(UUID aggregateId);\n    void deleteAll();\n}\n`
    },
    {
      category: 'domain',
      package: `${base}.infrastructure`,
      className: 'DomainEventJpaRepository',
      once: true,
      version: RUNTIME_VERSIONS.DomainEventJpaRepository,
      content: `${HEADER(RUNTIME_VERSIONS.DomainEventJpaRepository)}package ${base}.infrastructure;\n\nimport org.springframework.data.jpa.repository.JpaRepository;\n\npublic interface DomainEventJpaRepository\n        extends DomainEventRepository, JpaRepository<DomainEventEntity, Long> {\n}\n`
    },
    {
      category: 'domain',
      test: true,
      package: `${base}.infrastructure`,
      className: 'DomainEventInMemoryRepository',
      once: true,
      version: RUNTIME_VERSIONS.DomainEventInMemoryRepository,
      content: `${HEADER(RUNTIME_VERSIONS.DomainEventInMemoryRepository)}package ${base}.infrastructure;\n\nimport java.util.Comparator;\nimport java.util.HashSet;\nimport java.util.List;\nimport java.util.Objects;\nimport java.util.Optional;\nimport java.util.Set;\nimport java.util.UUID;\n\npublic class DomainEventInMemoryRepository implements DomainEventRepository {\n\n    private final Set<DomainEventEntity> entities = new HashSet<>();\n\n    @Override\n    public DomainEventEntity save(DomainEventEntity entity) {\n        if (entity.getId() == null) {\n            var newId = entities.stream().map(DomainEventEntity::getId)\n                    .max(Comparator.naturalOrder()).map(it -> it + 1).orElse(1L);\n            entity.setId(newId);\n        }\n        entities.add(entity);\n        return entity;\n    }\n\n    @Override\n    public Optional<DomainEventEntity> findById(Long id) {\n        return entities.stream().filter(e -> Objects.equals(e.getId(), id)).findFirst();\n    }\n\n    @Override\n    public List<DomainEventEntity> findAllByAggregateId(UUID aggregateId) {\n        return entities.stream()\n                .filter(e -> Objects.equals(e.getAggregateId(), aggregateId))\n                .toList();\n    }\n\n    @Override\n    public void deleteAll() {\n        entities.clear();\n    }\n}\n`
    },
    {
      category: 'domain',
      package: `${base}.infrastructure`,
      className: 'DomainEventEntity',
      once: true,
      version: RUNTIME_VERSIONS.DomainEventEntity,
      content: `${HEADER(RUNTIME_VERSIONS.DomainEventEntity)}package ${base}.infrastructure;\n\nimport java.util.UUID;\nimport jakarta.persistence.Entity;\nimport jakarta.persistence.EnumType;\nimport jakarta.persistence.Enumerated;\nimport jakarta.persistence.GeneratedValue;\nimport jakarta.persistence.GenerationType;\nimport jakarta.persistence.Id;\nimport jakarta.persistence.Table;\nimport lombok.AccessLevel;\nimport lombok.Getter;\nimport lombok.NoArgsConstructor;\nimport lombok.NonNull;\nimport lombok.Setter;\nimport org.hibernate.annotations.JdbcTypeCode;\nimport org.hibernate.type.SqlTypes;\nimport ${base}.domain.events.DomainEventType;\nimport ${base}.eventstream.DomainEvent;\n\n@Entity\n@Table(name = "domain_event")\n@Getter\n@NoArgsConstructor(access = AccessLevel.PROTECTED)\npublic class DomainEventEntity {\n\n    @Id\n    @GeneratedValue(strategy = GenerationType.IDENTITY)\n    @Setter\n    private Long id;\n\n    private UUID aggregateId;\n\n    @Enumerated(EnumType.STRING)\n    private DomainEventType type;\n\n    @NonNull\n    @JdbcTypeCode(SqlTypes.JSON)\n    private DomainEventSerdeWrapper eventJson;\n\n    public DomainEventEntity(DomainEvent event) {\n        this.aggregateId = event.aggregateId();\n        this.type = event.eventType();\n        // The event -> wrapper switch is GENERATED (DomainEventSerde), so adding an\n        // event to events.md wires serialization automatically. Do not inline it here.\n        this.eventJson = DomainEventSerde.serialize(event);\n    }\n\n    public DomainEvent toDomainEvent() {\n        return eventJson.event();\n    }\n}\n`
    }
  ];
}

// --- Step plugin for GENERATE_DOMAIN ----------------------------------------

const domainStep = {
  id: 'GENERATE_DOMAIN',
  category: 'domain',
  after: [],
  detect: (patch) => (patch?.entries ?? []).filter(e => e.auto === false),
  render: (item, index, total) => {
    const left = total - index - 1;
    return [
      `GENERATE_DOMAIN — item ${index + 1}/${total}`,
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

export const DomainPlugin = {
  id: 'domain',
  provides: ['value-object', 'domain-runtime'],
  requires: [],
  emit: (model, ctx) => {
    const files = [];
    model.valueObjects.forEach(vo => files.push(valueObject(vo, ctx)));
    files.push(...runtimeFiles(ctx));
    return files;
  },
  step: domainStep
};