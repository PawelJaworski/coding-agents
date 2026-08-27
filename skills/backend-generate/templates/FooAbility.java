//it lives in test/java parent
package {the same as Foo class}

public interface FooAbility {
    //if Foo has Bar dependency (Bar is itself a Spring component/service) then reuse
    //BarAbility.INSTANCE - NEVER construct a new new Bar() instance here directly.
    //If BarAbility does not exist yet, create it first (one Ability per class, no duplicates).
    //if Foo is Repository just use new instance of InMemory repository for INSTANCE
    //if Foo is mapstruct mapper then use instance of generated mapper impl for INSTANCE
    Foo INSTANCE = new Foo(BarAbility.INSTANCE)

    // DSLs for projectors abilities
    // DSL: expect_foo(aggregateId) { it.attr == "value" }
    default boolean expect_foo(UUID aggregateId, Predicate<FooReadModel> testCase) {
        //ALWAYS use INSTANCE getter
        var readModel = getFooProjector().getFoo(aggregateId);
        return testCase.test(readModel);
    }

    // DLSs for for command handlers abilities
    // DSL: foo { it.attr = "value" }
    // method name in snake case
    default UUID foo(Consumer<FooCmd.FooCmdBuilder> testCase) {
        var cmd = FooCmd.builder();
        // set defaults here if needed
        testCase.accept(cmd);
        //ALWAYS use INSTANCE getter
        return getFooHandler().handle(cmd.build());
    }

    //getter is mandatory
    default Foo getFoo() {
        return INSTANCE;
    }
}
