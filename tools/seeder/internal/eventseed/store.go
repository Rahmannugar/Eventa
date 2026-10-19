package eventseed

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

// InsertBatch writes one batch of events and everything beneath them in the
// caller's transaction: the event rows, their categories and venues, one
// currency each, the ticket types beneath that currency, and the publication
// outbox row that makes Debezium relay the fact. Every statement is
// conflict-free, so rerunning a range commits nothing new and returns how many
// events were actually new. It never advances past a failure: the transaction
// either holds the whole batch or none of it.
func InsertBatch(ctx context.Context, tx pgx.Tx, batch []Event) (int64, error) {
	if len(batch) == 0 {
		return 0, nil
	}

	inserted, err := insertEvents(ctx, tx, batch)
	if err != nil {
		return 0, fmt.Errorf("seed events: %w", err)
	}
	if err := insertCategories(ctx, tx, batch); err != nil {
		return 0, fmt.Errorf("seed event categories: %w", err)
	}
	if err := insertVenues(ctx, tx, batch); err != nil {
		return 0, fmt.Errorf("seed event venues: %w", err)
	}
	if err := insertCurrencies(ctx, tx, batch); err != nil {
		return 0, fmt.Errorf("seed ticket currencies: %w", err)
	}
	if err := insertTicketTypes(ctx, tx, batch); err != nil {
		return 0, fmt.Errorf("seed ticket types: %w", err)
	}
	if err := insertPublications(ctx, tx, batch); err != nil {
		return 0, fmt.Errorf("seed publication outbox: %w", err)
	}
	return inserted, nil
}

func insertEvents(ctx context.Context, tx pgx.Tx, batch []Event) (int64, error) {
	const columns = 12
	args := make([]any, 0, len(batch)*columns)
	for _, event := range batch {
		args = append(args,
			event.ID, event.Title, PublishedStatus, event.AdminID,
			event.PublishedAt, event.PublishedAt,
			event.Description, event.StartsAt, event.EndsAt, event.TimeZone,
			int32(PublishedVersion), event.PublishedAt,
		)
	}
	tag, err := tx.Exec(ctx,
		`INSERT INTO events (id, title, status, created_by_admin_id, created_at, updated_at,
		                     description, starts_at, ends_at, time_zone, version, published_at)
		 VALUES `+valuesClause(columns, len(batch))+`
		 ON CONFLICT (id) DO NOTHING`,
		args...)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

func insertCategories(ctx context.Context, tx pgx.Tx, batch []Event) error {
	const columns = 2
	var (
		args   []any
		values int
	)
	for _, event := range batch {
		for _, category := range event.Categories {
			args = append(args, event.ID, category)
			values++
		}
	}
	_, err := tx.Exec(ctx,
		`INSERT INTO event_categories (event_id, category)
		 VALUES `+valuesClause(columns, values)+`
		 ON CONFLICT (event_id, category) DO NOTHING`,
		args...)
	return err
}

func insertVenues(ctx context.Context, tx pgx.Tx, batch []Event) error {
	const columns = 5
	args := make([]any, 0, len(batch)*columns)
	for _, event := range batch {
		args = append(args,
			event.ID, event.Venue.Name, event.Venue.AddressLine1,
			event.Venue.City, event.Venue.CountryCode,
		)
	}
	_, err := tx.Exec(ctx,
		`INSERT INTO event_venues (event_id, name, address_line_1, city, country_code)
		 VALUES `+valuesClause(columns, len(batch))+`
		 ON CONFLICT (event_id) DO NOTHING`,
		args...)
	return err
}

func insertCurrencies(ctx context.Context, tx pgx.Tx, batch []Event) error {
	const columns = 5
	args := make([]any, 0, len(batch)*columns)
	for _, event := range batch {
		args = append(args,
			event.ID, Currency, event.PublishedAt, event.PublishedAt, event.CurrencyID,
		)
	}
	_, err := tx.Exec(ctx,
		`INSERT INTO event_ticket_currencies (event_id, currency, created_at, updated_at, id)
		 VALUES `+valuesClause(columns, len(batch))+`
		 ON CONFLICT DO NOTHING`,
		args...)
	return err
}

func insertTicketTypes(ctx context.Context, tx pgx.Tx, batch []Event) error {
	const columns = 12
	var (
		args   []any
		values int
	)
	for _, event := range batch {
		for _, ticketType := range event.TicketTypes {
			args = append(args,
				ticketType.ID, ticketType.Name, ticketType.Description,
				int32(ticketType.PriceMinor), int32(ticketType.Capacity),
				ticketType.SalesStart, ticketType.SalesEnd,
				event.PublishedAt, event.PublishedAt, event.CurrencyID,
				int32(0), int32(0),
			)
			values++
		}
	}
	_, err := tx.Exec(ctx,
		`INSERT INTO event_ticket_types (id, name, description, price_minor, capacity,
		                                 sales_start_at, sales_end_at, created_at, updated_at,
		                                 ticket_currency_id, reserved_quantity, sold_quantity)
		 VALUES `+valuesClause(columns, values)+`
		 ON CONFLICT DO NOTHING`,
		args...)
	return err
}

func insertPublications(ctx context.Context, tx pgx.Tx, batch []Event) error {
	const columns = 6
	args := make([]any, 0, len(batch)*columns)
	for _, event := range batch {
		args = append(args,
			event.ID, PublishedEventType, event.PayloadJSON(),
			event.PublishedAt, event.PublishedAt, LifecycleAggregateType,
		)
	}
	_, err := tx.Exec(ctx,
		`INSERT INTO event_publication_outbox (event_id, event_type, payload, occurred_at, created_at, aggregate_type)
		 VALUES `+valuesClause(columns, len(batch))+`
		 ON CONFLICT (event_id, event_type) DO NOTHING`,
		args...)
	return err
}

// valuesClause renders the parameter placeholders of a multi-row insert:
// valuesClause(2, 3) is `($1,$2),($3,$4),($5,$6)`.
func valuesClause(columns, rows int) string {
	var builder strings.Builder
	builder.Grow(rows * columns * 6)
	for row := 0; row < rows; row++ {
		if row > 0 {
			builder.WriteByte(',')
		}
		builder.WriteByte('(')
		for column := 0; column < columns; column++ {
			if column > 0 {
				builder.WriteByte(',')
			}
			fmt.Fprintf(&builder, "$%d", row*columns+column+1)
		}
		builder.WriteByte(')')
	}
	return builder.String()
}
