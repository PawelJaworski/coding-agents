package {base}.dosomethingonfoo;

import {base}.eventstream.CommandHandler;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import java.util.UUID;

@Component
@Transactional
public class DoSomethingOnFooHandler implements CommandHandler<DoSomethingOnFooCmd> {
    @Override
    public UUID handle(DoSomethingOnFooCmd command) {
        return null;
    }
}
