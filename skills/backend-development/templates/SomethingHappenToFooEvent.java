package {base}.domain.events;

import java.util.UUID;

//Class name ends with Event
//Always contains aggregate id. If aggregate is Foo then id attribute is named fooId.
public record SomethingHappenToFooEvent(UUID fooId, /**other attributes**/) {
    @Override
    public DomainEventType eventType() {
        return DomainEventType.SOMETHING_HAPPEN_TO_FOO;
    }
}