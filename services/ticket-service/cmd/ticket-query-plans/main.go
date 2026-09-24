package main

import (
	"context"
	"crypto/md5"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/tern/v2/migrate"
)

type planReport struct {
	Name             string   `json:"name"`
	ExecutionMs      float64  `json:"executionMs"`
	PlanningMs       float64  `json:"planningMs"`
	ReturnedRows     int64    `json:"returnedRows"`
	Indexes          []string `json:"indexes"`
	Nodes            []string `json:"nodes"`
	SharedHitBlocks  int64    `json:"sharedHitBlocks"`
	SharedReadBlocks int64    `json:"sharedReadBlocks"`
}

type explainJSON struct {
	PlanningTime  float64  `json:"Planning Time"`
	ExecutionTime float64  `json:"Execution Time"`
	Plan          planNode `json:"Plan"`
}

type planNode struct {
	NodeType         string     `json:"Node Type"`
	IndexName        string     `json:"Index Name"`
	ActualRows       int64      `json:"Actual Rows"`
	SharedHitBlocks  int64      `json:"Shared Hit Blocks"`
	SharedReadBlocks int64      `json:"Shared Read Blocks"`
	Plans            []planNode `json:"Plans"`
}

var testNamePattern = regexp.MustCompile(`^[a-z][a-z0-9_]*_test$`)

func main() {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if strings.TrimSpace(databaseURL) == "" {
		fail("TEST_DATABASE_URL is required")
	}
	name := databaseName(databaseURL)
	if !testNamePattern.MatchString(name) {
		fail("TEST_DATABASE_URL must target a database ending in _test")
	}

	ctx := context.Background()
	if err := ensureDatabase(ctx, databaseURL); err != nil {
		fail(err.Error())
	}
	if err := applyMigrations(ctx, databaseURL); err != nil {
		fail(err.Error())
	}

	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		fail(err.Error())
	}
	defer pool.Close()

	reports, err := collectPlans(ctx, pool)
	if err != nil {
		fail(err.Error())
	}
	encoded, err := json.MarshalIndent(map[string]any{
		"dataset": map[string]int{
			"issuedTickets": 50000,
			"attendees":     5000,
			"events":        200,
		},
		"plans": reports,
	}, "", "  ")
	if err != nil {
		fail(err.Error())
	}
	fmt.Println(string(encoded))
}

func databaseName(url string) string {
	parts := strings.Split(url, "/")
	if len(parts) == 0 {
		return ""
	}
	name := parts[len(parts)-1]
	if idx := strings.IndexAny(name, "?#"); idx >= 0 {
		name = name[:idx]
	}
	return name
}

func adminURL(url string) string {
	idx := strings.Index(url, "?")
	if idx >= 0 {
		return url[:strings.LastIndex(url[:idx], "/")] + "/postgres" + url[idx:]
	}
	return url[:strings.LastIndex(url, "/")] + "/postgres"
}

func ensureDatabase(ctx context.Context, databaseURL string) error {
	admin, err := pgx.Connect(ctx, adminURL(databaseURL))
	if err != nil {
		return err
	}
	defer func() { _ = admin.Close(ctx) }()
	var exists bool
	if err := admin.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1)`, databaseName(databaseURL)).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return nil
	}
	_, err = admin.Exec(ctx, fmt.Sprintf(`CREATE DATABASE %q`, databaseName(databaseURL)))
	if err != nil && !strings.Contains(err.Error(), "42P04") {
		return err
	}
	return nil
}

func applyMigrations(ctx context.Context, databaseURL string) error {
	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		return err
	}
	defer func() { _ = conn.Close(ctx) }()
	migrator, err := migrate.NewMigrator(ctx, conn, "ticket_schema_version")
	if err != nil {
		return err
	}
	dir := "migrations"
	entries, err := os.ReadDir(dir)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return err
		}
		dir = filepath.Join("..", "..", "migrations")
		entries, err = os.ReadDir(dir)
		if err != nil {
			return err
		}
	}
	files := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".sql") {
			files = append(files, entry.Name())
		}
	}
	sort.Strings(files)
	for _, file := range files {
		contents, err := os.ReadFile(filepath.Join(dir, file))
		if err != nil {
			return err
		}
		parts := strings.SplitN(string(contents), "---- create above / drop below ----", 2)
		down := ""
		if len(parts) == 2 {
			down = parts[1]
		}
		migrator.AppendMigration(file, parts[0], down)
	}
	return migrator.Migrate(ctx)
}

func collectPlans(ctx context.Context, pool *pgxpool.Pool) ([]planReport, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	seed := uuid.New()
	seedPrefix := seed.String()
	if err := seedData(ctx, tx, seedPrefix); err != nil {
		return nil, err
	}

	var reports []planReport
	explain := func(name, query string, args ...any) error {
		var raw []byte
		if err := tx.QueryRow(ctx, `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) `+query, args...).Scan(&raw); err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
		var parsed []explainJSON
		if err := json.Unmarshal(raw, &parsed); err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
		if len(parsed) == 0 {
			return fmt.Errorf("%s: empty plan", name)
		}
		report := parsed[0]
		nodes, indexes := walkPlan(report.Plan)
		reports = append(reports, planReport{
			Name:             name,
			ExecutionMs:      report.ExecutionTime,
			PlanningMs:       report.PlanningTime,
			ReturnedRows:     report.Plan.ActualRows,
			Indexes:          indexes,
			Nodes:            nodes,
			SharedHitBlocks:  report.Plan.SharedHitBlocks,
			SharedReadBlocks: report.Plan.SharedReadBlocks,
		})
		return nil
	}

	attendeeID := md5UUID(seedPrefix + ":attendee:0")
	eventID := md5UUID(seedPrefix + ":event:0")
	if err := explain("attendee ticket page",
		`SELECT id, order_id, attendee_id, event_id, ticket_type_id, unit_index, status, issued_at, qr_token
 FROM issued_tickets
 WHERE attendee_id = $1
   AND ($2::timestamptz IS NULL OR (issued_at, id) < ($2::timestamptz, $3::uuid))
 ORDER BY issued_at DESC, id DESC
 LIMIT $4`,
		attendeeID, nil, uuid.Nil, 50); err != nil {
		return nil, err
	}

	checkInHash := sha256.Sum256([]byte(seedPrefix + ":qr"))
	if err := explain("check-in credential lock",
		`SELECT id FROM issued_tickets WHERE qr_secret_hash = $1 FOR UPDATE`,
		checkInHash[:]); err != nil {
		return nil, err
	}

	if err := explain("revocation list lock",
		`SELECT id FROM issued_tickets WHERE event_id = $1 AND status <> 'revoked' ORDER BY id FOR UPDATE`,
		eventID); err != nil {
		return nil, err
	}

	if err := explain("cancelled event probe",
		`SELECT EXISTS (SELECT 1 FROM ticket_cancelled_events WHERE event_id = $1)`,
		eventID); err != nil {
		return nil, err
	}

	if err := explain("issuance inbox claim",
		`INSERT INTO ticket_issuance_inbox (event_id, event_type)
 VALUES ($1, 'commerce.order-paid.v1')
 ON CONFLICT (event_id) DO NOTHING
 RETURNING event_id`,
		uuid.NewSHA1(uuid.NameSpaceOID, []byte(seedPrefix+":claim")).String()); err != nil {
		return nil, err
	}

	if err := explain("cancellation inbox claim",
		`INSERT INTO ticket_cancellation_inbox (message_id, event_id, event_type)
 VALUES ($1, $2, 'event.cancelled.v1')
 ON CONFLICT (message_id) DO NOTHING
 RETURNING message_id`,
		uuid.NewSHA1(uuid.NameSpaceOID, []byte(seedPrefix+":cancel-msg")).String(),
		eventID); err != nil {
		return nil, err
	}

	if err := explain("revocation outbox append",
		`INSERT INTO ticket_revocation_outbox (event_id, aggregate_type, aggregate_id, event_type, payload, occurred_at)
 SELECT $1::uuid, 'eventa.ticket.revoked.v1', t.id, 'ticket.revoked.v1',
   jsonb_build_object('messageId', $1::uuid, 'eventId', t.event_id, 'ticketId', t.id,
     'attendeeId', t.attendee_id, 'revokedAt', now(), 'type', 'ticket.revoked.v1'), now()
 FROM issued_tickets t WHERE t.id = $2::uuid`,
		uuid.NewSHA1(uuid.NameSpaceOID, []byte(seedPrefix+":outbox-msg")).String(),
		md5UUID(seedPrefix+":ticket:rep")); err != nil {
		return nil, err
	}

	return reports, nil
}

func seedData(ctx context.Context, tx pgx.Tx, seedPrefix string) error {
	baseEvent := md5UUID(seedPrefix + ":event:0")
	baseAttendee := md5UUID(seedPrefix + ":attendee:0")
	baseOrder := md5UUID(seedPrefix + ":order:rep")
	baseType := md5UUID(seedPrefix + ":type:0")
	ticketID := md5UUID(seedPrefix + ":ticket:rep")
	qr := sha256.Sum256([]byte(seedPrefix + ":qr"))

	_, err := tx.Exec(ctx, `
		INSERT INTO issued_tickets (id, order_id, attendee_id, event_id, ticket_type_id, unit_index, qr_token, qr_secret_hash, issued_at)
		SELECT md5($1 || ':ticket:' || n)::uuid,
		       md5($1 || ':order:' || (n % 5000))::uuid,
		       md5($1 || ':attendee:' || (n % 5000))::uuid,
		       md5($1 || ':event:' || (n % 200))::uuid,
		       md5($1 || ':type:' || (n % 200))::uuid,
		       n,
		       md5($1 || ':qr:' || n)::bytea,
		       md5($1 || ':hash:' || n)::bytea,
		       now() - (n || ' seconds')::interval
		FROM generate_series(0, 49999) AS n`,
		seedPrefix)
	if err != nil {
		return fmt.Errorf("seed tickets: %w", err)
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO issued_tickets (id, order_id, attendee_id, event_id, ticket_type_id, unit_index, qr_token, qr_secret_hash)
		VALUES ($1, $2, $3, $4, $5, 0, $6, $7)`,
		ticketID, baseOrder, baseAttendee, baseEvent, baseType, []byte(seedPrefix+":qr-token"), qr[:])
	if err != nil {
		return fmt.Errorf("seed representative ticket: %w", err)
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO ticket_cancelled_events (event_id, cancellation_message_id)
		VALUES ($1, $2)
		ON CONFLICT (event_id) DO NOTHING`,
		baseEvent, uuid.NewSHA1(uuid.NameSpaceOID, []byte(seedPrefix+":cancel")))
	if err != nil {
		return fmt.Errorf("seed cancelled marker: %w", err)
	}
	return nil
}

func walkPlan(node planNode) (nodes, indexes []string) {
	nodeSet := map[string]struct{}{}
	indexSet := map[string]struct{}{}
	var walk func(planNode)
	walk = func(n planNode) {
		if n.NodeType != "" {
			nodeSet[n.NodeType] = struct{}{}
		}
		if n.IndexName != "" {
			indexSet[n.IndexName] = struct{}{}
		}
		for _, child := range n.Plans {
			walk(child)
		}
	}
	walk(node)
	for name := range nodeSet {
		nodes = append(nodes, name)
	}
	for name := range indexSet {
		indexes = append(indexes, name)
	}
	sort.Strings(nodes)
	sort.Strings(indexes)
	return nodes, indexes
}

func fail(message string) {
	fmt.Fprintln(os.Stderr, message)
	os.Exit(1)
}

func md5UUID(value string) string {
	sum := md5.Sum([]byte(value))
	return uuid.UUID(sum).String()
}
