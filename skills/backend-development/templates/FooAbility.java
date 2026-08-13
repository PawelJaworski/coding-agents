//it lives in test/java parent
package {the same as Foo class}

public interface FooAbility {
    //if Foo has Bar dependency then construct Foo with BarAbility.INSTANCE
    //if Foo is Repository just use new instance of InMemory repository
    //if Foo is mapstruct mapper then use instance of generated mapper impl
    Foo INSTANCE = new Foo(BarAbility.INSTANCE)

    default Foo getFoo() {
        return INSTANCE;
    }
}