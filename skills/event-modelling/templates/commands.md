# Commands

Commands are the actions actors ask the system to perform. Each command is an
`## heading` whose text is its id. One heading per command.

## submit-policy-application
Name: Submit Policy Application
Produces: policy-application-submitted
* policy holder
* policy coverage
* coverage period

Automated commands (marked with `Observes:`) represent a robot/system step
reacting to an event rather than a human action — they need no matching
`uis.md` entry at all, since no human triggers them.

## auto-underwrite
Name: Auto Underwrite
Observes: policy-application-submitted
Produces: policy-underwritten

## issue-policy
policy:Id
Name: Issue Policy
Produces: policy-issued
* policy holder
* coverage period

## cancel-policy
Name: Cancel Policy
Produces: policy-cancelled
* cancellation reason
