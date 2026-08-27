package {where entity is located};

public interface FooJpaRepository extends FooRepository, JpaRepository<FooEntity, Long> {
}