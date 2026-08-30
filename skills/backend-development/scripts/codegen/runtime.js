// Domain-independent runtime scaffolding. These files depend only on the base
// package, never on the model, so a brand-new project gets a working
// event-sourced runtime from the first codegen run.
//
// They are all `once: true`: scaffolded when absent, then owned by the project.
// The model-dependent parts of the runtime (DomainEventType, StateProjector,
// DomainEventSerdeWrapper, DomainEventSerde) live in emit.js and ARE regenerated.

const HEADER =
  `// SCAFFOLDED ONCE by the backend codegen — this file is YOURS.\n` +
  `// Domain-independent event-sourcing runtime; adapt it freely.\n`;

const file = (base, pkg, className, body) => ({
  once: true,
  package: `${base}.${pkg}`,
  className,
  content: `${HEADER}package ${base}.${pkg};\n\n${body}`,
});

export function runtimeFiles(base) {
  return [
    file(base, 'eventstream', 'DomainEvent', `import java.util.UUID;

import ${base}.domain.events.DomainEventType;

public interface DomainEvent {
    UUID aggregateId();
    DomainEventType eventType();
}
`),

    file(base, 'eventstream', 'CommandHandler', `import java.util.UUID;

public interface CommandHandler<T> {
    UUID handle(T cmd);
}
`),

    file(base, 'eventstream', 'EventHandler', `public interface EventHandler<E> {
    void handle(E event);
}
`),

    file(base, 'eventstream', 'EventStream', `import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface EventStream {
    void append(Collection<DomainEvent> events);
    List<DomainEvent> findAllById(UUID id);
}
`),

    file(base, 'infrastructure', 'EventStreamImpl', `import java.util.Collection;
import java.util.List;
import java.util.UUID;

import org.springframework.stereotype.Component;

import ${base}.eventstream.DomainEvent;
import ${base}.eventstream.EventStream;

@Component
public class EventStreamImpl implements EventStream {

    private final DomainEventRepository repository;

    public EventStreamImpl(DomainEventRepository repository) {
        this.repository = repository;
    }

    @Override
    public void append(Collection<DomainEvent> events) {
        events.forEach(event -> repository.save(new DomainEventEntity(event)));
    }

    @Override
    public List<DomainEvent> findAllById(UUID id) {
        return repository.findAllByAggregateId(id).stream()
                .map(DomainEventEntity::toDomainEvent)
                .toList();
    }
}
`),

    file(base, 'infrastructure', 'DomainEventRepository', `import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface DomainEventRepository {
    DomainEventEntity save(DomainEventEntity entity);
    Optional<DomainEventEntity> findById(Long id);
    List<DomainEventEntity> findAllByAggregateId(UUID aggregateId);
    void deleteAll();
}
`),

    file(base, 'infrastructure', 'DomainEventJpaRepository', `import org.springframework.data.jpa.repository.JpaRepository;

public interface DomainEventJpaRepository
        extends DomainEventRepository, JpaRepository<DomainEventEntity, Long> {
}
`),

    file(base, 'infrastructure', 'DomainEventInMemoryRepository', `import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

public class DomainEventInMemoryRepository implements DomainEventRepository {

    private final Set<DomainEventEntity> entities = new HashSet<>();

    @Override
    public DomainEventEntity save(DomainEventEntity entity) {
        if (entity.getId() == null) {
            var newId = entities.stream().map(DomainEventEntity::getId)
                    .max(Comparator.naturalOrder()).map(it -> it + 1).orElse(1L);
            entity.setId(newId);
        }
        entities.add(entity);
        return entity;
    }

    @Override
    public Optional<DomainEventEntity> findById(Long id) {
        return entities.stream().filter(e -> Objects.equals(e.getId(), id)).findFirst();
    }

    @Override
    public List<DomainEventEntity> findAllByAggregateId(UUID aggregateId) {
        return entities.stream()
                .filter(e -> Objects.equals(e.getAggregateId(), aggregateId))
                .toList();
    }

    @Override
    public void deleteAll() {
        entities.clear();
    }
}
`),

    file(base, 'infrastructure', 'DomainEventEntity', `import java.util.UUID;

import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.NonNull;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import ${base}.domain.events.DomainEventType;
import ${base}.eventstream.DomainEvent;

@Entity
@Table(name = "domain_event")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class DomainEventEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Setter
    private Long id;

    private UUID aggregateId;

    @Enumerated(EnumType.STRING)
    private DomainEventType type;

    @NonNull
    @JdbcTypeCode(SqlTypes.JSON)
    private DomainEventSerdeWrapper eventJson;

    public DomainEventEntity(DomainEvent event) {
        this.aggregateId = event.aggregateId();
        this.type = event.eventType();
        // The event -> wrapper switch is GENERATED (DomainEventSerde), so adding an
        // event to events.md wires serialization automatically. Do not inline it here.
        this.eventJson = DomainEventSerde.serialize(event);
    }

    public DomainEvent toDomainEvent() {
        return eventJson.event();
    }
}
`),
  ];
}
