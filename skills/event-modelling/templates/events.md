# Events

Events are facts that have happened. File order = chronological order; time
flows left to right in the diagram. Use `Subprocess:` to group related events
into the same horizontal band. One heading per event.

## order-created
order:Id
Name: Order Created
Subprocess: Order

## inventory-reserved
inventory:Id
Name: Inventory Reserved
Subprocess: Inventory

## order-shipped
order:Id
Name: Order Shipped
Subprocess: Order

## order-cancelled
order:Id
Name: Order Cancelled
Subprocess: Order