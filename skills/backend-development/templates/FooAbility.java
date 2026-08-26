//it lives in test/java parent
package {the same as Foo class}

public interface FooAbility {
    //if Foo has Bar dependency (Bar is itself a Spring component/service) then reuse
    //BarAbility.INSTANCE - NEVER construct a new Bar/BarImpl instance here directly.
    //If BarAbility does not exist yet, create it first (one Ability per class, no duplicates).
    //if Foo is Repository just use new instance of InMemory repository
    //if Foo is mapstruct mapper then use instance of generated mapper impl
    Foo INSTANCE = new Foo(BarAbility.INSTANCE)

    // DSLs for projectors abilities
    // DSL: fooDetails(aggregateId) { it.attr == "value" }
    default boolean fooDetails(UUID aggregateId, Predicate<FooReadModel> testCase) {
        var readModel = getFooProjector().getFoo(aggregateId);
        return testCase.test(readModel);
    }

    // DLSs for for command handlers abilities
    // DSL: foo { it.attr = "value" }
    default UUID foo(Consumer<FooCmd.FooCmdBuilder> testCase) {
        var cmd = FooCmd.builder();
        // set defaults here if needed
        testCase.accept(cmd);
        return getFooHandler().handle(cmd.build());
    }

    default Foo getFoo() {
        return INSTANCE;
    }
}
