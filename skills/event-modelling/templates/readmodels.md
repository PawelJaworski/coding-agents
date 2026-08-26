# Read Models

Read models are projections derived from events. `Subscribes:` takes a
comma-separated list of event ids from events.md. One heading per read model.

Every read model must declare at least one of `{aggregateName}:Id` or one or
more `{keyName}:Key` lines (see SKILL.md) — a read model with neither is a
hard error.

## underwriting-queue
policy:Id
Name: Underwriting Queue
Subscribes: policy-application-submitted
* policy holder
* policy coverage

## policy-status
policy:Id
customerId:Key
region:Key
Name: Policy Status
Subscribes: policy-issued, policy-cancelled
* policy holder
* coverage period
* status

## policy-document
policy:Id
Name: Policy Document
Subscribes: policy-issued
* policy holder
* coverage period
