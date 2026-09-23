# External Events

External events are facts that happen in systems **we don't own**. They are an
external contract, not modelled by the team — so:

- `{aggregateName}:Id` is **NOT mandatory** (a foreign system has no local
  aggregate). If present it renders as a bold line under the title.
- Use `System name:` (instead of `Subprocess:`) to group external events into
  bottom swimlanes, one per external system.
- Attributes (`* field`) are optional.
- Every external event must be subscribed by at least one translator
  (orphan check).
- External event ids must not collide with internal event ids.

## application-received
Name: Application Received
System name: Underwriter Portal
* application id
* policy holder
* coverage request

## policy-issued-externally
Name: Policy Issued Externally
System name: Underwriter Portal