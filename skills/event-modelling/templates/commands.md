# Commands

Commands are the actions actors ask the system to perform. Each command is an
`## heading` whose text is its id. One heading per command.

## create-order
Name: Create Order
Produces: order-created

## cancel-order
Name: Cancel Order
Produces: order-cancelled

## mark-order-shipped
Name: Mark Order Shipped
Produces: order-shipped

## reserve-inventory
Name: Reserve Inventory
Observes: order-created
Produces: inventory-reserved
