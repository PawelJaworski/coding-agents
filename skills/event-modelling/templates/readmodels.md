# Read Models

Read models are projections derived from events. `Subscribes:` takes a
comma-separated list of event ids from events.md. One heading per read model.

Every read model must declare at least one of `{aggregateName}:Id` or one or
more `{keyName}:Key` lines (see SKILL.md) — a read model with neither is a hard
error.

## order-list
Name: Order List
Subscribes: order-created, order-shipped, order-cancelled
customerId:Key

## stock-levels
inventory:Id
Name: Stock Levels
Subscribes: inventory-reserved
