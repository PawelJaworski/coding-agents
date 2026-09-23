# Translators

Translators are the "bots" that bridge the external world into the system
(Translation Pattern). They live in the `Bots` swimlane at the very top and
render as cards with a ⚙ sprocket badge — one card per produced command.

- `Subscribes:` — comma-separated external event ids from external-events.md.
- `Produces:` — comma-separated command ids from commands.md.
- Each translator must subscribe at least one external event and produce at
  least one command.

## translate-application
Name: Translate Application
Subscribes: application-received
Produces: submit-policy-application

## translate-external-issue
Name: Translate External Issue
Subscribes: policy-issued-externally
Produces: issue-policy