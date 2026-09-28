package search

import (
	"context"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	discoveryv1 "github.com/eventa/discovery-service/internal/gen/eventa/discovery/v1"
	"github.com/eventa/discovery-service/internal/logging"
)

func TestSearchEventsRejectsAMalformedQueryWithoutQuerying(t *testing.T) {
	// A nil repository proves the rejection happens before any database work:
	// reaching the repository would panic rather than return a status.
	handler := NewHandler(nil, logging.New("SearchHandler"))

	_, err := handler.SearchEvents(context.Background(), &discoveryv1.SearchEventsRequest{
		Query:      "festival",
		StartsFrom: stringPointer("whenever"),
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("got code %s for a malformed request, want %s", status.Code(err), codes.InvalidArgument)
	}
}

func stringPointer(value string) *string { return &value }
