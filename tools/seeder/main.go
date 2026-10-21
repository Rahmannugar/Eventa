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
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/eventa/tools/seeder/internal/attendeeseed"
	"github.com/eventa/tools/seeder/internal/eventseed"
)

const usage = `seeder — bulk-insert Eventa benchmark data at the database level

Usage:
  seeder events [flags]
  seeder attendees [flags]
  seeder venues [flags]

Subcommands:
  events      seed published events with ticket inventory and publication outbox rows
  attendees   seed verified attendee accounts and the interest rows Discovery keeps for them
  venues      place coordinateless venue rows in their seed city (a backfill for rows
              created before location search; rerunning it never moves a placed venue)

Environment:
  EVENT_DATABASE_URL          Event Service database (required by events and venues, or -database-url)
  IDENTITY_DATABASE_URL       Identity database: the owning admin for events, the accounts
                              for attendees (or -identity-url)
  DISCOVERY_DATABASE_URL      Discovery database for attendee interests (or -discovery-url)
  SEED_ATTENDEE_PASSWORD      password every seeded account gets (required by attendees,
                              or -password). It is a local development credential; the
                              documented value lives in the Identity README.

Run an event seed from the repository root:
  EVENT_DATABASE_URL=postgres://eventa_event:eventa_event_password@127.0.0.1:57432/eventa_event \
  IDENTITY_DATABASE_URL=postgres://eventa_identity:eventa_identity_password@127.0.0.1:55432/eventa_identity \
  go -C tools/seeder run . events -count 10000 -offset 0 -batch-size 200

Run an attendee seed from the repository root:
  SEED_ATTENDEE_PASSWORD=<value from the Identity README> \
  IDENTITY_DATABASE_URL=postgres://eventa_identity:eventa_identity_password@127.0.0.1:55432/eventa_identity \
  DISCOVERY_DATABASE_URL=postgres://eventa_discovery:eventa_discovery_password@127.0.0.1:60432/eventa_discovery \
  go -C tools/seeder run . attendees -count 100 -offset 0

A range is deterministic: the same seed and range generate the same rows, so
rerunning it inserts nothing new. Attendee accounts and their interests live in
different databases; if a run fails between them, rerunning the range repairs
the missing interest rows. Run the commands in the owning service READMEs for
the documented knobs and the verification steps.
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
	case "attendees":
		return seedAttendees(args[1:])
	case "venues":
		return backfillVenues(args[1:])
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

// backfillVenues places venue rows that predate location search: it claims
// coordinateless rows in the seed's city pool, gives each its deterministic
// point, and stops when a claim returns nothing, so it is safe to rerun
// against a partially placed dataset.
func backfillVenues(args []string) error {
	flags := flag.NewFlagSet("venues", flag.ContinueOnError)
	batchSize := flags.Int("batch-size", 500, "venue rows per transaction")
	databaseURL := flags.String("database-url", "", "Event Service database URL (default $EVENT_DATABASE_URL)")
	if err := flags.Parse(args); err != nil {
		return err
	}

	if *batchSize < 1 {
		return errors.New("-batch-size must be at least 1")
	}
	eventURL := firstNonEmpty(*databaseURL, os.Getenv("EVENT_DATABASE_URL"))
	if eventURL == "" {
		return errors.New("the Event Service database URL is required: set EVENT_DATABASE_URL or pass -database-url")
	}

	ctx := context.Background()
	pool, err := openDatabase(ctx, "event", eventURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	var (
		placed  int64
		batches int
	)
	for {
		changed, err := commitBatch(ctx, pool, func(ctx context.Context, tx pgx.Tx) (int64, error) {
			return eventseed.BackfillVenueCoordinates(ctx, tx, *batchSize)
		})
		if err != nil {
			return fmt.Errorf("backfill venue coordinates: %w", err)
		}
		batches++
		placed += changed
		if changed == 0 {
			break
		}
	}

	fmt.Printf(
		"backfilled venue coordinates=%d batches=%d batch_size=%d\n",
		placed, batches, *batchSize,
	)
	return nil
}

// insertBatch commits one batch or nothing, so a failure never leaves an event
// without its inventory or its outbox row.
func insertBatch(ctx context.Context, pool *pgxpool.Pool, batch []eventseed.Event) (int64, error) {
	return commitBatch(ctx, pool, func(ctx context.Context, tx pgx.Tx) (int64, error) {
		return eventseed.InsertBatch(ctx, tx, batch)
	})
}

// seedAttendees writes accounts Identity can log in together with the interest
// rows Discovery owns for them. The two databases cannot share a transaction,
// so accounts are written first: a failure between them can only leave
// accounts without interests, and rerunning the range repairs them.
func seedAttendees(args []string) error {
	flags := flag.NewFlagSet("attendees", flag.ContinueOnError)
	count := flags.Int("count", 100, "how many attendee accounts to generate, counted from -offset")
	offset := flags.Int("offset", 0, "first generator index; ranges are disjoint and stable")
	batchSize := flags.Int("batch-size", 50, "accounts per transaction")
	seed := flags.Int64("seed", 20261019, "generator seed; a seed plus a range always yields the same rows")
	password := flags.String("password", "", "development password every seeded account gets (default $SEED_ATTENDEE_PASSWORD)")
	identityURL := flags.String("identity-url", "", "Identity database URL (default $IDENTITY_DATABASE_URL)")
	discoveryURL := flags.String("discovery-url", "", "Discovery database URL (default $DISCOVERY_DATABASE_URL)")
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
	if *offset+*count > attendeeseed.MaxRange {
		return fmt.Errorf("-offset %d with -count %d leaves the generator's %d distinct names",
			*offset, *count, attendeeseed.MaxRange)
	}

	shared := firstNonEmpty(*password, os.Getenv("SEED_ATTENDEE_PASSWORD"))
	if shared == "" {
		return errors.New("seeded accounts need a password: set SEED_ATTENDEE_PASSWORD or pass -password, using the documented development value from the Identity README")
	}
	if len(shared) < 8 || len(shared) > 128 {
		return errors.New("the shared password must be 8 to 128 characters, the range the Gateway accepts at login")
	}
	identityTarget := firstNonEmpty(*identityURL, os.Getenv("IDENTITY_DATABASE_URL"))
	if identityTarget == "" {
		return errors.New("the Identity database URL is required: set IDENTITY_DATABASE_URL or pass -identity-url")
	}
	discoveryTarget := firstNonEmpty(*discoveryURL, os.Getenv("DISCOVERY_DATABASE_URL"))
	if discoveryTarget == "" {
		return errors.New("the Discovery database URL is required: set DISCOVERY_DATABASE_URL or pass -discovery-url")
	}

	ctx := context.Background()
	identity, err := openDatabase(ctx, "identity", identityTarget)
	if err != nil {
		return err
	}
	defer identity.Close()
	discovery, err := openDatabase(ctx, "discovery", discoveryTarget)
	if err != nil {
		return err
	}
	defer discovery.Close()

	now := time.Now().UTC()
	var (
		inserted  int64
		interests int64
		batches   int
	)
	first, last := *offset, *offset+*count-1
	for start := *offset; start <= last; start += *batchSize {
		end := min(start+*batchSize, last+1)
		batch := make([]attendeeseed.Attendee, 0, end-start)
		for index := start; index < end; index++ {
			batch = append(batch, attendeeseed.Generate(*seed, index, now, shared))
		}
		written, changed, err := insertAttendeeBatch(ctx, identity, discovery, batch)
		if err != nil {
			return fmt.Errorf("seed attendees [%d,%d): %w", start, end, err)
		}
		inserted += written
		interests += changed
		batches++
	}

	fmt.Printf(
		"seeded attendees=%d range=[%d,%d] seed=%d batches=%d inserted=%d skipped=%d interest_rows_changed=%d\n",
		*count, first, last, *seed, batches, inserted, int64(*count)-inserted, interests,
	)
	return nil
}

// insertAttendeeBatch writes one batch to both databases and reports how many
// accounts were new and how many interest rows changed.
func insertAttendeeBatch(ctx context.Context, identity, discovery *pgxpool.Pool, batch []attendeeseed.Attendee) (int64, int64, error) {
	written, err := commitBatch(ctx, identity, func(ctx context.Context, tx pgx.Tx) (int64, error) {
		return attendeeseed.InsertAccounts(ctx, tx, batch)
	})
	if err != nil {
		return 0, 0, fmt.Errorf("write accounts: %w", err)
	}
	changed, err := commitBatch(ctx, discovery, func(ctx context.Context, tx pgx.Tx) (int64, error) {
		return attendeeseed.UpsertInterests(ctx, tx, batch)
	})
	if err != nil {
		return written, 0, fmt.Errorf("write interests: %w", err)
	}
	return written, changed, nil
}

// commitBatch runs one statement set in its own transaction and commits it.
func commitBatch(ctx context.Context, pool *pgxpool.Pool, work func(context.Context, pgx.Tx) (int64, error)) (int64, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	written, err := work(ctx, tx)
	if err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return written, nil
}

// openDatabase opens one of the seeder's target databases and proves it is
// reachable before any row is generated.
func openDatabase(ctx context.Context, name, target string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, target)
	if err != nil {
		return nil, fmt.Errorf("open the %s database: %w", name, err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("reach the %s database: %w", name, err)
	}
	return pool, nil
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
