
//Class name ends with Event
//Always contains aggregate id. If aggregate is Foo then id attribute is named fooId.
public record SomethingHappenToFooEvent(Long fooId, /**other attributes**/) {
}