import java.util.UUID;
import java.util.function.Consumer;
import java.util.function.Predicate;

// ============================================================================
// Command Handler Ability
// ============================================================================
// Provides DSL method to issue commands in tests.
// One ability per handler class. Uses InMemoryRepository directly (no Ability needed for repos).
//
// Usage in test:  foo { it.attr = "value" }
// ============================================================================
public interface FooHandlerAbility {
    // Shared EventStream - all abilities in a test must use the SAME instance
    // so events written by handlers are visible to projectors
    pl.pjaworski.insurance_company.infrastructure.EventStreamImpl EVENT_STREAM =
        new pl.pjaworski.insurance_company.infrastructure.EventStreamImpl(
            new pl.pjaworski.insurance_company.infrastructure.DomainEventInMemoryRepository()
        );

    FooHandler INSTANCE = new FooHandler(EVENT_STREAM);

    default FooHandler getFooHandler() {
        return INSTANCE;
    }

    // DSL: foo { it.attr = "value" }
    default UUID foo(Consumer<FooCmd.FooCmdBuilder> testCase) {
        var cmd = FooCmd.builder();
        // set defaults here if needed
        testCase.accept(cmd);
        return getFooHandler().handle(cmd.build());
    }
}

// ============================================================================
// Projector Ability (On-Demand)
// ============================================================================
// Provides DSL method to verify read model projection.
// One ability per projector class. References the SAME EVENT_STREAM from the handler ability.
//
// Usage in test:  fooDetails(aggregateId) { it.attr == "value" }
// ============================================================================
public interface FooProjectorAbility {
    // Reference the handler ability's EVENT_STREAM (do NOT create a new one!)
    FooOnDemandProjector INSTANCE = new FooOnDemandProjector(FooHandlerAbility.EVENT_STREAM);

    default FooOnDemandProjector getFooProjector() {
        return INSTANCE;
    }

    // DSL: fooDetails(aggregateId) { it.attr == "value" }
    default boolean fooDetails(UUID aggregateId, Predicate<FooReadModel> testCase) {
        var readModel = getFooProjector().getFoo(aggregateId);
        return testCase.test(readModel);
    }
}
