package {base}.domain.events;

import java.util.UUID;

//Class name ends with Event
//Always contains aggregate id
public record SomethingHappenToFooEvent(UUID aggregateId, /**other attributes**/) {
    @Override
    public DomainEventType eventType() {
        return DomainEventType.SOMETHING_HAPPEN_TO_FOO;
    }
}