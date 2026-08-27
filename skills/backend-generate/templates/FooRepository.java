package {where entity is located}

import java.util.Optional;

public interface FooRepository {
  FooEntity save(FooEntity entity);
  Optional<FooEntity> findById(Long id);
  void deleteAll();
}