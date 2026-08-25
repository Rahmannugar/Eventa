# Commerce Service

Commerce Service owns attendee orders, immutable ticket snapshots, payment attempts, provider interaction, refunds, and payment state. It coordinates ticket purchases with Event Service for temporary capacity reservations and completed sales.

The service owns its PostgreSQL schema and migrations. Run the migration command after building the service.
