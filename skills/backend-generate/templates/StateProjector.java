package pl.pjaworski.insurance_company.eventstream;

import java.util.Collection;
import {base}.domain.events.FooEvent;
improt {base}.domain.events.BarEvent;

public interface StateProjector<S> {
    default S hydrate(S state, Collection<DomainEvent> events) {
        return events.stream().reduce(state, this::apply, (_, s2) -> s2);
    }

    private S apply(S state, DomainEvent event) {
        return switch (event.eventType()) {
            case FOO -> apply(state, (FooEvent) event);
            case BAR -> apply(state, (BarEvent) event);
        };
    }

    default S apply(S state, FooEvent event) {
        return state;
    }

    default S apply(S state, BarEvent event) {
        return state;
    }
}
