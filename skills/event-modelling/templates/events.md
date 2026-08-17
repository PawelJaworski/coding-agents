# Events

Events are facts that have happened. File order = chronological order; time
flows left to right in the diagram. Use `Subprocess:` to group related events
into the same horizontal band. Every event must declare `{aggregateName}:Id`.
One heading per event.

## policy-application-submitted
policy:Id
Name: Policy Application Submitted
Subprocess: Application
* policy holder
* policy coverage
* coverage period

## policy-underwritten
policy:Id
Name: Policy Underwritten
Subprocess: Application

## policy-issued
policy:Id
Name: Policy Issued
Subprocess: Policy
* policy holder
* coverage period

## policy-cancelled
policy:Id
Name: Policy Cancelled
Subprocess: Policy
* cancellation reason
