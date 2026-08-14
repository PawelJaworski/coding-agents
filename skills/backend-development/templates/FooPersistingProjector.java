package {base}.foo;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import ${base}.eventstream.StateProjector;

import java.util.List;

@Component
@RequiredArgsConstructor
public class FooPersistingProjector implements StateProjector<FooReadModel> {
    private final FooRepository fooRepository;

    @GetMapping
    public List<FooReadModel> findByCriteria(@RequestParam String attr) {
        return fooRepository.findAllByAttr(attr);
    }

    private FooReadModel map(FooEntity entity) {
        return new FooReadModel(entity.attr);
    }
}
