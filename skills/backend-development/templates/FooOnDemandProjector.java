package {base}.foo;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import {base}.eventstream.EventStream;
import {base}.eventstream.StateProjector;

import java.util.UUID;

@Component
@RequiredArgsConstructor
public class FooOnDemandProjector implements StateProjector<FooReadModel> {
    private final EventStream eventStream;

    public FooReadModel getFoo(UUID aggregateId) {
        return hydrate(null, eventStream.findAllById(aggregateId));
    }
}
