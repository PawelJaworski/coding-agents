package {base}.foo;

import jakarta.persistence.*;
import lombok.Setter;

@Entity
@Table(name = "foo")
public record FooEntity(
        @Id
        @GeneratedValue(strategy = GenerationType.IDENTITY)
        @Setter
        Long id,
        String attr) {
}
