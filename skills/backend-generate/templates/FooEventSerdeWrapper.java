package {base}.infrastructure;

import com.fasterxml.jackson.annotation.JsonTypeName;
import {base}.domain.events.DomainEventType;
import {base}.domain.events.SomethingHappenToFooEvent;
import {base}.eventstream.DomainEvent;

//Class name ends with SerdeWrapper
//One wrapper per domain event; it carries the eventType discriminator so the
//event store can serialize/deserialize the polymorphic DomainEvent. The record
//component MUST be typed DomainEvent so the generated accessor satisfies the
//DomainEventSerdeWrapper.event() contract.
@JsonTypeName("SOMETHING_HAPPEN_TO_FOO")
public record SomethingHappenToFooEventSerdeWrapper(DomainEvent event) implements DomainEventSerdeWrapper {
    @Override
    public DomainEventType getEventType() {
        return DomainEventType.SOMETHING_HAPPEN_TO_FOO;
    }

    @Override
    public DomainEvent event() {
        return event;
    }
}
