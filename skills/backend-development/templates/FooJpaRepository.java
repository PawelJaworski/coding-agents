package {base}.infrastructure;

public interface FooJpaRepository extends FooRepository, JpaRepository<FooEntity, Long> {
}