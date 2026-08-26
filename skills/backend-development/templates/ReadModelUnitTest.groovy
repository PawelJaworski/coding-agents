import spock.lang.Specification

// Each test class tests ONE read model's behavior end-to-end.
// It implements BOTH:
//   1. The command handler ability (to issue commands that produce events)
//   2. The projector ability (to verify the read model projection)
//
// Test flow: Command → Event → Read Model projection
// Test class should be focused on app behaviour. All helpers, test dsls etc. should be implemented in test abilities
class FooReadModelUnitTest extends Specification implements FooHandlerAbility, FooProjectorAbility {

    // Test name describes the business behavior, not technical details
    def "when foo created then foo details can be retrieved with correct attributes"() {
        when: "a foo is created"
        def aggregateId = foo {
            it.attr = "value"
        }

        then: "foo details projection contains the correct data"
        fooDetails(aggregateId) {
            it.attr == "value"
        }
    }
}
