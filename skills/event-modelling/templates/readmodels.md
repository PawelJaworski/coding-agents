# Read Models

Read models are projections derived from events. `Subscribes:` takes a
comma-separated list of event ids from events.md. One heading per read model.

## order-list
Name: Order List
Subscribes: order-created, order-shipped, order-cancelled

## stock-levels
id:Inventory
Name: Stock Levels
Subscribes: inventory-reserved