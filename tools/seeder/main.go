// Command seeder bulk-inserts benchmark datasets directly into Eventa's
// service databases. It is a repository tool: never part of a service runtime,
// never imported by one, and always rerunnable over the same range. Seeded
// rows carry their outbox rows, so the stack learns about them through
// Debezium rather than through a shortcut.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/eventa/tools/seeder/internal/eventseed"
)

const usage = `seeder — bulk-insert Eventa benchmark data at the database level

Usage:
  seeder events [flags]

Subcommands:
  events    seed published events with ticket inventory and publication outbox rows

Environment:
  EVENT_DATABASE_URL      Event Service database (required, or -database-url)
  IDENTITY_DATABASE_URL   Identity database, used to resolve the owning admin
                          when -admin-id is not given

Run an event seed from the repository root:
  EVENT_DATABASE_URL=postgres://eventa_event:eventa_event_password@127.0.0.1:57432/eventa_event \
  IDENTITY_DATABASE_URL=postgres://eventa_identity:eventa_identity_password@127.0.0.1:55432/eventa_identity \
  go -C tools/seeder run . events -count 10000 -offset 0 -batch-size 200

A range is deterministic: the same seed and range generate the same rows, so
rerunning it inserts nothing new. Run the commands in the Event Service README
for the documented knobs and the verification steps.
`

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "seeder: %v\n", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		fmt.Print(usage)
		return errors.New("a subcommand is required")
	}
	switch args[0] {
	case "events":
		return seedEvents(args[1:])
	case "help", "-h", "--help":
		fmt.Print(usage)
		return nil
	default:
		return fmt.Errorf("unknown subcommand %q", args[0])
	}
}

func seedEvents(args []string) error {
	flags := flag.NewFlagSet("events", flag.ContinueOnError)
	count := flags.Int("count", 1000, "how many events to generate, counted from -offset")
	offset := flags.Int("offset", 0, "first generator index; ranges are disjoint and stable")
	batchSize := flags.Int("batch-size", 200, "events per transaction")
	seed := flags.Int64("seed", 20261019, "generator seed; a seed plus a range always yields the same rows")
	adminID := flags.String("admin-id", "", "admin UUID owning the seeded events (default: first activated admin from the Identity database)")
	databaseURL := flags.String("database-url", "", "Event Service database URL (default $EVENT_DATABASE_URL)")
	identityURL := flags.String("identity-url", "", "Identity database URL (default $IDENTITY_DATABASE_URL)")
	if err := flags.Parse(args); err != nil {
		return err
	}

	if *count < 1 {
		return errors.New("-count must be at least 1")
	}
	if *offset < 0 {
		return errors.New("-offset cannot be negative")
	}
	if *batchSize < 1 {
		return errors.New("-batch-size must be at least 1")
	}
	eventURL := firstNonEmpty(*databaseURL, os.Getenv("EVENT_DATABASE_URL"))
	if eventURL == "" {
		return errors.New("the Event Service database URL is required: set EVENT_DATABASE_URL or pass -database-url")
	}

	ctx := context.Background()
	owner, err := resolveAdmin(ctx, *adminID, firstNonEmpty(*identityURL, os.Getenv("IDENTITY_DATABASE_URL")))
	if err != nil {
		return err
	}

	pool, err := pgxpool.New(ctx, eventURL)
	if err != nil {
		return fmt.Errorf("open the event database: %w", err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		return fmt.Errorf("reach the event database: %w", err)
	}

	now := time.Now().UTC()
	var (
		inserted int64
		batches  int
	)
	first, last := *offset, *offset+*count-1
	for start := *offset; start <= last; start += *batchSize {
		end := min(start+*batchSize, last+1)
		batch := make([]eventseed.Event, 0, end-start)
		for index := start; index < end; index++ {
			batch = append(batch, eventseed.Generate(*seed, index, now, owner))
		}
		written, err := insertBatch(ctx, pool, batch)
		if err != nil {
			return fmt.Errorf("seed batch [%d,%d): %w", start, end, err)
		}
		inserted += written
		batches++
	}

	fmt.Printf(
		"seeded events=%d range=[%d,%d] seed=%d batches=%d inserted=%d skipped=%d admin=%s\n",
		*count, first, last, *seed, batches, inserted, int64(*count)-inserted, owner,
	)
	return nil
}

// insertBatch commits one batch or nothing, so a failure never leaves an event
// without its inventory or its outbox row.
func insertBatch(ctx context.Context, pool *pgxpool.Pool, batch []eventseed.Event) (int64, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	written, err := eventseed.InsertBatch(ctx, tx, batch)
	if err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return written, nil
}

// resolveAdmin names the admin the seeded events belong to, so the Admin
// Dashboard sees the dataset instead of a phantom owner.
func resolveAdmin(ctx context.Context, flagValue, identityURL string) (uuid.UUID, error) {
	if flagValue != "" {
		parsed, err := uuid.Parse(flagValue)
		if err != nil {
			return uuid.Nil, fmt.Errorf("-admin-id is not a UUID: %w", err)
		}
		return parsed, nil
	}
	if identityURL == "" {
		return uuid.Nil, errors.New("seeded events need an owner: pass -admin-id or set IDENTITY_DATABASE_URL to read the first activated admin")
	}

	pool, err := pgxpool.New(ctx, identityURL)
	if err != nil {
		return uuid.Nil, fmt.Errorf("open the identity database: %w", err)
	}
	defer pool.Close()

	var adminID uuid.UUID
	if err := pool.QueryRow(ctx,
		`SELECT id FROM admin_accounts WHERE activated_at IS NOT NULL ORDER BY created_at, id LIMIT 1`,
	).Scan(&adminID); err != nil {
		return uuid.Nil, fmt.Errorf("read the owning admin: %w", err)
	}
	return adminID, nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
