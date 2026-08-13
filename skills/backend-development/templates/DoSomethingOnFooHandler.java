package {base}.dosomethingonfoo;

import {base}.eventstream.CommandHandler;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
@Transactional
public class DoSomethingOnFooHandler implements CommandHandler<DoSomethingOnFooCmd> {
    @Override
    public Long handle(DoSomethingOnFooCmd command) {
        return null;
    }
}
