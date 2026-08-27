package {base}.dosomethingonfoo;

import {base}.eventstream.CommandHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import java.util.UUID;

@RestController
@Component
@Transactional
public class DoSomethingOnFooHandler implements CommandHandler<DoSomethingOnFooCmd> {

    @PostMapping("do-something-on-foo")
    @Override
    public UUID handle(@RequestBody DoSomethingOnFooCmd command) {
        return null;
    }
}
