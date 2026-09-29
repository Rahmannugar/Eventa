package integration

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	discoveryv1 "github.com/eventa/discovery-service/internal/gen/eventa/discovery/v1"
	"github.com/eventa/discovery-service/internal/interests"
	"github.com/eventa/discovery-service/internal/logging"
)

func TestAnAttendeeReadsBackExactlyWhatTheySaved(t *testing.T) {
	pool := startMigratedDatabase(t)
	handler := interests.NewHandler(interests.NewRepository(pool), logging.New("InterestsHandler"))
	ctx := context.Background()
	attendeeID := uuid.New().String()

	saved, err := handler.SetAttendeeInterests(ctx, &discoveryv1.SetAttendeeInterestsRequest{
		AttendeeId: attendeeID,
		Interests:  []string{"Music", "Jazz"},
	})
	if err != nil {
		t.Fatalf("set interests: %v", err)
	}
	if saved.GetUpdatedAt() == "" {
		t.Fatal("saved response carries no update time")
	}

	read, err := handler.GetAttendeeInterests(ctx, &discoveryv1.GetAttendeeInterestsRequest{AttendeeId: attendeeID})
	if err != nil {
		t.Fatalf("get interests: %v", err)
	}
	if got, want := read.GetInterests(), []string{"Music", "Jazz"}; !equalStrings(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	if read.GetUpdatedAt() != saved.GetUpdatedAt() {
		t.Fatalf("read update time %q, want the saved %q", read.GetUpdatedAt(), saved.GetUpdatedAt())
	}
}

func TestASavingReplacesRatherThanAppendsThePreviousInterests(t *testing.T) {
	pool := startMigratedDatabase(t)
	handler := interests.NewHandler(interests.NewRepository(pool), logging.New("InterestsHandler"))
	ctx := context.Background()
	attendeeID := uuid.New().String()

	if _, err := handler.SetAttendeeInterests(ctx, &discoveryv1.SetAttendeeInterestsRequest{
		AttendeeId: attendeeID,
		Interests:  []string{"Music", "Jazz"},
	}); err != nil {
		t.Fatalf("first set: %v", err)
	}

	second, err := handler.SetAttendeeInterests(ctx, &discoveryv1.SetAttendeeInterestsRequest{
		AttendeeId: attendeeID,
		Interests:  []string{"  music ", "Photography"},
	})
	if err != nil {
		t.Fatalf("second set: %v", err)
	}
	if got, want := second.GetInterests(), []string{"music", "Photography"}; !equalStrings(got, want) {
		t.Fatalf("second save returned %v, want %v", got, want)
	}
	read, err := handler.GetAttendeeInterests(ctx, &discoveryv1.GetAttendeeInterestsRequest{AttendeeId: attendeeID})
	if err != nil {
		t.Fatalf("get interests: %v", err)
	}
	if got, want := read.GetInterests(), []string{"music", "Photography"}; !equalStrings(got, want) {
		t.Fatalf("stored %v, want the replacement %v", got, want)
	}
}

func TestAnAttendeeWhoNeverSavedInterestsReadsAnEmptyList(t *testing.T) {
	pool := startMigratedDatabase(t)
	handler := interests.NewHandler(interests.NewRepository(pool), logging.New("InterestsHandler"))

	read, err := handler.GetAttendeeInterests(context.Background(), &discoveryv1.GetAttendeeInterestsRequest{
		AttendeeId: uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("get interests: %v", err)
	}
	if len(read.GetInterests()) != 0 {
		t.Fatalf("got %v, want an empty list", read.GetInterests())
	}
	if read.GetUpdatedAt() != "" {
		t.Fatalf("update time %q, want none for a record that does not exist", read.GetUpdatedAt())
	}
}

func TestAnInvalidInterestRequestIsRejectedBeforeItIsStored(t *testing.T) {
	pool := startMigratedDatabase(t)
	handler := interests.NewHandler(interests.NewRepository(pool), logging.New("InterestsHandler"))
	ctx := context.Background()

	t.Run("attendee id is not a uuid", func(t *testing.T) {
		_, err := handler.SetAttendeeInterests(ctx, &discoveryv1.SetAttendeeInterestsRequest{
			AttendeeId: "not-a-uuid",
			Interests:  []string{"Music"},
		})
		if status.Code(err) != codes.InvalidArgument {
			t.Fatalf("got %s, want %s", status.Code(err), codes.InvalidArgument)
		}
	})

	t.Run("more interests than the bound allows", func(t *testing.T) {
		attendeeID := uuid.New().String()
		tooMany := make([]string, interests.MaxInterests+1)
		for i := range tooMany {
			tooMany[i] = "interest" + string(rune('a'+i%26))
		}
		_, err := handler.SetAttendeeInterests(ctx, &discoveryv1.SetAttendeeInterestsRequest{
			AttendeeId: attendeeID,
			Interests:  tooMany,
		})
		if status.Code(err) != codes.InvalidArgument {
			t.Fatalf("got %s, want %s", status.Code(err), codes.InvalidArgument)
		}

		read, err := handler.GetAttendeeInterests(ctx, &discoveryv1.GetAttendeeInterestsRequest{AttendeeId: attendeeID})
		if err != nil {
			t.Fatalf("get interests: %v", err)
		}
		if len(read.GetInterests()) != 0 {
			t.Fatalf("stored %v from a rejected request", read.GetInterests())
		}
	})
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
