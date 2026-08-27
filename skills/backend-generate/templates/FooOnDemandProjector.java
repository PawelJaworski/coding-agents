package {base}.foo;

import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.stereotype.Component;
import {base}.eventstream.EventStream;
import {base}.eventstream.StateProjector;

import java.util.UUID;

@RestController
@Component
@RequiredArgsConstructor
public class FooOnDemandProjector implements StateProjector<FooReadModel> {
    private final EventStream eventStream;

    @GetMapping("foo/{aggregateId}")
    public FooReadModel getFoo(@PathVariable UUID aggregateId) {
        return hydrate(null, eventStream.findAllById(aggregateId));
    }
}
