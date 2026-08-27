package {where entity is located};

import java.util.Set;

public class FooInMemoryRepository implements FooRepository {
    private final Set<FooEntity> entities = new HashSet<>();

    @Override
    public FooEntity save(FooEntity entity) {
        if (entity.getId() == null) {
            var newId = entities.stream().map(FooEntity::getId)
                    .max(Comparator.naturalOrder()).map(it -> it + 1).orElse(1L);
            entity.setId(newId);
        }
        entities.add(entity);
        return entity;
    }

    @Override
    public <S extends FooEntity> List<S> saveAll(Iterable<S> entities) {
        List<S> saved = new ArrayList<>();
        entities.forEach(entity -> {
            save(entity);
            saved.add(entity);
        });
        return saved;
    }

    @Override
    public void deleteAll() {
        entities.clear();

    }
}