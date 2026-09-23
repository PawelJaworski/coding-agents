# Translators

Translators are the "bots" that bridge the external world into the system
(Translation Pattern). They live in the `Bots` swimlane at the very top and
render as cards with a ⚙ sprocket badge — one card per produced command.

- `Type:` — **optional, free-form** display/transport hint. The value can be
  **anything** (no enum). Two values are special for **backend codegen**:
  `rest` generates a `@RestController` POST endpoint per subscribed external
  event, `kafka` generates a `@KafkaListener` per subscription. Any other value
  (or none) still generates the translator as a plain `@Component`. The diagram
  just shows it as a small uppercase label. Omit it if the label adds nothing.
- `Subscribes:` — comma-separated external event ids from external-events.md.
- `Produces:` — comma-separated command ids from commands.md.
- Each translator must subscribe at least one external event and produce at
  least one command.

## translate-application
Name: Translate Application
Type: rest
Subscribes: application-received
Produces: submit-policy-application

## translate-external-issue
Name: Translate External Issue
Subscribes: policy-issued-externally
Produces: issue-policy