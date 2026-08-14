package {base}.domain.events;

import java.util.UUID;
import {base}.eventstream.DomainEvent;

//Class name ends with Event
//Always contains aggregate id
public record SomethingHappenToFooEvent(UUID aggregateId, /**other attributes**/) implements DomainEvent {
    @Override
    public DomainEventType eventType() {
        return DomainEventType.SOMETHING_HAPPEN_TO_FOO;
    }
}