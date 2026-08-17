package pl.pjaworski.insurance_company.foo;


import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import pl.pjaworski.insurance_company.domain.events.PolicyIssuedEvent;
import pl.pjaworski.insurance_company.domain.events.PolicyProposalCreatedEvent;
import pl.pjaworski.insurance_company.eventstream.StateProjector;

import java.util.List;

@Component
@RequiredArgsConstructor
public class FooPersistingProjector implements StateProjector<FooReadModel> {
    private final FooRepository fooRepository;

    @GetMapping
    public List<FooReadModel> findByCriteria(@RequestParam String attr /** other criteria **/) {
        return fooRepository.findAllByAttr(attr /**other attributes**/).stream()
                .map(this::map)
                .toList();
    }

    @Override
    public FooReadModel apply(FooReadModel state, FooEvent event) {
        var entity = new FooEntity(/** creation with keys**/, event.attr());
        return fooRepository.save(entity);
    }

    @Override
    public FooReadModel apply(FooReadModel state, BarEvent event) {
        var existing = fooRepository.findById(/** find by key **/);
        //apply projection from BarEvent
        return fooRepository.save(existing);
    }

    private FooReadModel map(FooEntity entity) {
        return new FooReadModel(entity.attr());
    }
}
