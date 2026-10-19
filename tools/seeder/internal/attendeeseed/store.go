package attendeeseed

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

// ActiveStatus is the only account status a seeded attendee carries, and the
// only one that lets Identity issue a session.
const ActiveStatus = "active"

// InsertAccounts writes one batch of accounts to Identity and reports how many
// were new. The conflict clause keys on the account id, so rerunning a range
// commits nothing, while an email or username that already belongs to a
// different account fails loudly instead of silently dropping a row.
func InsertAccounts(ctx context.Context, tx pgx.Tx, batch []Attendee) (int64, error) {
	if len(batch) == 0 {
		return 0, nil
	}

	const columns = 7
	args := make([]any, 0, len(batch)*columns)
	for _, attendee := range batch {
		args = append(args,
			attendee.ID, attendee.Email, attendee.Username, attendee.PasswordHash,
			attendee.EmailVerifiedAt, attendee.EmailVerifiedAt, ActiveStatus,
		)
	}
	tag, err := tx.Exec(ctx,
		`INSERT INTO attendee_accounts (id, email, username, password_hash, email_verified_at, created_at, status)
		 VALUES `+valuesClause(columns, len(batch))+`
		 ON CONFLICT (id) DO NOTHING`,
		args...)
	if err != nil {
		return 0, fmt.Errorf("seed attendee accounts: %w", err)
	}
	return tag.RowsAffected(), nil
}

// UpsertInterests writes Discovery's interest row for every attendee and
// reports how many rows actually changed. Accounts and their interests live in
// different databases, so if an earlier run stored the accounts and failed
// before their interests landed, the rerun repairs them instead of skipping
// them; a row whose interests already match is left untouched, which is what
// keeps a rerun's reported change count at zero.
func UpsertInterests(ctx context.Context, tx pgx.Tx, batch []Attendee) (int64, error) {
	if len(batch) == 0 {
		return 0, nil
	}

	const columns = 3
	args := make([]any, 0, len(batch)*columns)
	for _, attendee := range batch {
		args = append(args, attendee.ID, attendee.Interests, attendee.EmailVerifiedAt)
	}
	tag, err := tx.Exec(ctx,
		`INSERT INTO discovery_attendee_interests (attendee_id, interests, updated_at)
		 VALUES `+valuesClause(columns, len(batch))+`
		 ON CONFLICT (attendee_id) DO UPDATE
		   SET interests = EXCLUDED.interests, updated_at = EXCLUDED.updated_at
		   WHERE discovery_attendee_interests.interests IS DISTINCT FROM EXCLUDED.interests`,
		args...)
	if err != nil {
		return 0, fmt.Errorf("seed attendee interests: %w", err)
	}
	return tag.RowsAffected(), nil
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
