# Translators

Translators are the "bots" that bridge the external world into the system
(Translation Pattern). They live in the `Bots` swimlane at the very top and
render as cards with a ⚙ sprocket badge — one card per produced command.

- `Type:` — **optional, free-form** display hint. The value can be **anything**
  (no enum): `api`, `webhook`, `etl`, `underwriter-sync-bot`, ... It is shown
  as a small uppercase label on the translator card and does not affect
  linkage or codegen. Omit it if the label adds nothing (see
  `translate-external-issue` below).
- `Subscribes:` — comma-separated external event ids from external-events.md.
- `Produces:` — comma-separated command ids from commands.md.
- Each translator must subscribe at least one external event and produce at
  least one command.

## translate-application
Name: Translate Application
Type: underwriter-sync-bot
Subscribes: application-received
Produces: submit-policy-application

## translate-external-issue
Name: Translate External Issue
Subscribes: policy-issued-externally
Produces: issue-policy