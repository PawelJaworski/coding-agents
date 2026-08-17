package {base}.foo;

import jakarta.persistence.*;
import lombok.Setter;

@Entity
@Table(name = "foo")
public record FooEntity(
        @Id
        String key,
        String attr) {
}
