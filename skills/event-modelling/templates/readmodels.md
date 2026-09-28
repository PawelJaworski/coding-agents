# Read Models

Read models are projections derived from events. `Subscribes:` takes a
comma-separated list of event ids from events.md. One heading per read model.

Every read model must declare at least one of `{aggregateName}:Id`,
`{aggregateName}:Key`, `{aggregateName}:RowKey` or one or more `{keyName}:Key`
lines (see SKILL.md) — a read model with neither is a hard error.

`:Id` is the on-demand projection (rebuilt per request), `:Key` the persisting
single-record one (kept up to date on append, queried as one record),
`:RowKey` the persisting row-keyed list one (kept up to date on append, queried
as a list of rows).

Lists use `* field (list)` and child attributes use repeated bullets (`* * child`).

`* product (List)` plus nested `* *` attributes maps directly only from an
identically structured event.

Note: `attribute:Id`, `attribute:Key` and `attribute:RowKey` have special
meanings (identifiers/keys) and are rendered as bold lines under the card title.
You can also add these attributes as normal field attributes with different
naming (e.g., `attributeId` or `attribute key`) — these will be rendered as
regular bullet points. Both `:Key` and `:RowKey` inject an identity named
`attribute key` (never `attribute row key`) — the `Row` marker speaks about
cardinality, not the name of the key.

## underwriting-queue
policy:Id
Name: Underwriting Queue
Subscribes: policy-application-submitted
* policy id                  # Normal field (bullet) — transformation of policy:Id
* policy holder
* policy coverage

## policy-status
policy:Id
customerId:Key
region:Key
Name: Policy Status
Subscribes: policy-issued, policy-cancelled
* policy id                  # Normal field (bullet) — transformation of policy:Id
* customer id key            # Normal field (bullet) — transformation of customerId:Key
* policy holder
* coverage period
* status

## issued-policies
policy:RowKey
Name: Issued Policies
Subscribes: policy-issued
* policy key                 # Normal field (bullet) — transformation of policy:RowKey
* policy holder
* policy coverage

## policy-document
policy:Id
Name: Policy Document
Subscribes: policy-issued
* policy id                  # Normal field (bullet) — transformation of policy:Id
* policy holder
* coverage period
