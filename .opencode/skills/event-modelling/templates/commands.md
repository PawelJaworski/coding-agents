# Commands

Commands are the actions actors ask the system to perform. Each command is an
`## heading` whose text is its id. One heading per command.

## create-order
Name: Create Order
Actor: Customer
Produces: order-created

## cancel-order
Name: Cancel Order
Actor: Customer
Produces: order-cancelled

## mark-order-shipped
Name: Mark Order Shipped
Actor: Warehouse
Produces: order-shipped

## reserve-inventory
Name: Reserve Inventory
Actor: System
Observes: order-created
Produces: inventory-reserved
