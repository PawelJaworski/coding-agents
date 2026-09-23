// Domain Plugin — emits value objects and domain-independent runtime
// Extracted from emit.js (runtimeFiles) for pluggable architecture proof-of-concept

// Runtime scaffold versions (from runtime.js)
const RUNTIME_VERSIONS = {
  DomainEvent: 2,
  CommandHandler: 2,
  EventHandler: 1,
  EventStream: 2,
  PersistingProjector: 1,
  EventStreamImpl: 3,
  DomainEventRepository: 2,
  DomainEventJpaRepository: 1,
  DomainEventInMemoryRepository: 2,
  DomainEventEntity: 3,
  AggregateIdSequence: 1
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
      content: `${HEADER(RUNTIME_VERSIONS.DomainEvent)}package ${base}.eventstream;\n\nimport ${base}.domain.events.DomainEventType;\n\npublic interface DomainEvent {\n    Long aggregateId();\n    DomainEventType eventType();\n}\n`
    },
    {
      category: 'domain',
      package: `${base}.eventstream`,
      className: 'CommandHandler',
      once: true,
      version: RUNTIME_VERSIONS.CommandHandler,
      content: `${HEADER(RUNTIME_VERSIONS.CommandHandler)}package ${base}.eventstream;\n\npublic interface CommandHandler<T> {\n    Long handle(T cmd);\n}\n`
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
      content: `${HEADER(RUNTIME_VERSIONS.EventStream)}package ${base}.eventstream;\n\nimport java.util.Collection;\nimport java.util.List;\n\npublic interface EventStream {\n    void append(Collection<DomainEvent> events);\n    List<DomainEvent> findAllById(Long id);\n}\n`
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
      content: `${HEADER(RUNTIME_VERSIONS.EventStreamImpl)}package ${base}.infrastructure;\n\nimport java.util.Collection;\nimport java.util.List;\nimport lombok.RequiredArgsConstructor;\nimport org.springframework.stereotype.Component;\nimport ${base}.eventstream.DomainEvent;\nimport ${base}.eventstream.EventStream;\nimport ${base}.eventstream.PersistingProjector;\n\n@Component\n@RequiredArgsConstructor\npublic class EventStreamImpl implements EventStream {\n\n    private final DomainEventRepository repository;\n\n    /**\n     * Held by reference, never copied. Spring injects an immutable list, but a test\n     * ability registers its own projector into a shared mutable collection AFTER this\n     * stream is constructed — a defensive copy would silently drop those.\n     */\n    private final Collection<PersistingProjector> projectors;\n\n    @Override\n    public void append(Collection<DomainEvent> events) {\n        events.forEach(event -> {\n            repository.save(new DomainEventEntity(event));\n            // Persisting projections (<aggregate>:Key) cannot be replayed per request,\n            // so they are advanced here, synchronously, in the same transaction.\n            projectors.forEach(projector -> projector.project(event));\n        });\n    }\n\n    @Override\n    public List<DomainEvent> findAllById(Long id) {\n        return repository.findAllByAggregateId(id).stream()\n                .map(DomainEventEntity::toDomainEvent)\n                .toList();\n    }\n}\n`
    },
    {
      category: 'domain',
      package: `${base}.infrastructure`,
      className: 'DomainEventRepository',
      once: true,
      version: RUNTIME_VERSIONS.DomainEventRepository,
      content: `${HEADER(RUNTIME_VERSIONS.DomainEventRepository)}package ${base}.infrastructure;\n\nimport java.util.List;\nimport java.util.Optional;\n\npublic interface DomainEventRepository {\n    DomainEventEntity save(DomainEventEntity entity);\n    Optional<DomainEventEntity> findById(Long id);\n    List<DomainEventEntity> findAllByAggregateId(Long aggregateId);\n    void deleteAll();\n}\n`
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
      content: `${HEADER(RUNTIME_VERSIONS.DomainEventInMemoryRepository)}package ${base}.infrastructure;\n\nimport java.util.Comparator;\nimport java.util.HashSet;\nimport java.util.List;\nimport java.util.Objects;\nimport java.util.Optional;\nimport java.util.Set;\n\npublic class DomainEventInMemoryRepository implements DomainEventRepository {\n\n    private final Set<DomainEventEntity> entities = new HashSet<>();\n\n    @Override\n    public DomainEventEntity save(DomainEventEntity entity) {\n        if (entity.getId() == null) {\n            var newId = entities.stream().map(DomainEventEntity::getId)\n                    .max(Comparator.naturalOrder()).map(it -> it + 1).orElse(1L);\n            entity.setId(newId);\n        }\n        entities.add(entity);\n        return entity;\n    }\n\n    @Override\n    public Optional<DomainEventEntity> findById(Long id) {\n        return entities.stream().filter(e -> Objects.equals(e.getId(), id)).findFirst();\n    }\n\n    @Override\n    public List<DomainEventEntity> findAllByAggregateId(Long aggregateId) {\n        return entities.stream()\n                .filter(e -> Objects.equals(e.getAggregateId(), aggregateId))\n                .toList();\n    }\n\n    @Override\n    public void deleteAll() {\n        entities.clear();\n    }\n}\n`
    },
    {
      category: 'domain',
      package: `${base}.infrastructure`,
      className: 'DomainEventEntity',
      once: true,
      version: RUNTIME_VERSIONS.DomainEventEntity,
      content: `${HEADER(RUNTIME_VERSIONS.DomainEventEntity)}package ${base}.infrastructure;\n\nimport jakarta.persistence.Entity;\nimport jakarta.persistence.EnumType;\nimport jakarta.persistence.Enumerated;\nimport jakarta.persistence.GeneratedValue;\nimport jakarta.persistence.GenerationType;\nimport jakarta.persistence.Id;\nimport jakarta.persistence.Table;\nimport lombok.AccessLevel;\nimport lombok.Getter;\nimport lombok.NoArgsConstructor;\nimport lombok.NonNull;\nimport lombok.Setter;\nimport org.hibernate.annotations.JdbcTypeCode;\nimport org.hibernate.type.SqlTypes;\nimport ${base}.domain.events.DomainEventType;\nimport ${base}.eventstream.DomainEvent;\n\n@Entity\n@Table(name = "domain_event")\n@Getter\n@NoArgsConstructor(access = AccessLevel.PROTECTED)\npublic class DomainEventEntity {\n\n    @Id\n    @GeneratedValue(strategy = GenerationType.IDENTITY)\n    @Setter\n    private Long id;\n\n    private Long aggregateId;\n\n    @Enumerated(EnumType.STRING)\n    private DomainEventType type;\n\n    @NonNull\n    @JdbcTypeCode(SqlTypes.JSON)\n    private DomainEventSerdeWrapper eventJson;\n\n    public DomainEventEntity(DomainEvent event) {\n        this.aggregateId = event.aggregateId();\n        this.type = event.eventType();\n        // The event -> wrapper switch is GENERATED (DomainEventSerde), so adding an\n        // event to events.md wires serialization automatically. Do not inline it here.\n        this.eventJson = DomainEventSerde.serialize(event);\n    }\n\n    public DomainEvent toDomainEvent() {\n        return eventJson.event();\n    }\n}\n`
    },
    {
      category: 'domain',
      package: `${base}.infrastructure`,
      className: 'AggregateIdSequence',
      once: true,
      version: RUNTIME_VERSIONS.AggregateIdSequence,
      content: `${HEADER(RUNTIME_VERSIONS.AggregateIdSequence)}package ${base}.infrastructure;\n\nimport java.util.concurrent.atomic.AtomicLong;\nimport org.springframework.jdbc.core.JdbcTemplate;\nimport org.springframework.stereotype.Component;\n\n/**\n * Allocates aggregate ids from the {@code aggregate_id_seq} database sequence.\n *\n * <p>A plain infrastructure collaborator of every command handler: the handler\n * calls {@link #nextId()} before appending the first event, so the id is known\n * before persistence and is stable across the aggregate's event stream.</p>\n *\n * <p>Unit specs construct the handler without Spring, so the handler defaults its\n * collaborator to the shared {@link #inMemory()} double. It has exactly the same\n * contract and {@link #reset()} semantics as a repository/sequence collaborator.\n */\n@Component\npublic class AggregateIdSequence {\n\n    private static final AggregateIdSequence IN_MEMORY = new InMemorySequence();\n\n    private final JdbcTemplate jdbc;\n\n    public AggregateIdSequence(JdbcTemplate jdbc) {\n        this.jdbc = jdbc;\n    }\n\n    /** Shared in-memory double used by unit specs (no Spring context there). */\n    public static AggregateIdSequence inMemory() {\n        return IN_MEMORY;\n    }\n\n    /** Allocates the next aggregate id from the database sequence. */\n    public Long nextId() {\n        return jdbc.queryForObject("SELECT NEXT VALUE FOR aggregate_id_seq", Long.class);\n    }\n\n    /** Test hook: resets mutable collaborator state. No-op on the DB-backed instance. */\n    public void reset() {\n    }\n\n    private static final class InMemorySequence extends AggregateIdSequence {\n        private final AtomicLong counter = new AtomicLong();\n\n        private InMemorySequence() {\n            super(null);\n        }\n\n        @Override\n        public Long nextId() {\n            return counter.incrementAndGet();\n        }\n\n        @Override\n        public void reset() {\n            counter.set(0);\n        }\n    }\n}\n`
    }
  ];
}

// --- AggregateIdSequenceAbility emitter ---------------------------------------

function aggregateIdSequenceAbility(ctx) {
  const base = ctx.basePackage;
  return {
    category: 'domain',
    test: true,
    package: `${base}.infrastructure`,
    className: 'AggregateIdSequenceAbility',
    overwrite: true,
    content: `package ${base}.infrastructure;\n\n` +
      `public interface AggregateIdSequenceAbility {\n\n` +
      `    AggregateIdSequence INSTANCE = AggregateIdSequence.inMemory();\n\n` +
      `    default AggregateIdSequence getAggregateIdSequence() {\n` +
      `        return AggregateIdSequenceAbility.INSTANCE;\n` +
      `    }\n\n` +
      `    default void reset_aggregate_id_sequence() {\n` +
      `        AggregateIdSequenceAbility.INSTANCE.reset();\n` +
      `    }\n}\n`
  };
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
    files.push(aggregateIdSequenceAbility(ctx));
    return files;
  },
  step: domainStep
};