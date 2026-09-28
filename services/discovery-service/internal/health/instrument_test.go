package health

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"

	"github.com/eventa/discovery-service/internal/logging"
	"github.com/eventa/discovery-service/internal/metrics"
)

func TestSuccessfulProbeIsNotRecorded(t *testing.T) {
	reader, restore := useRecordingMeter(t)
	defer restore()

	serve(t, "/health/ready", http.StatusOK)

	if points := countPoints(t, reader, "eventa.request.count"); len(points) != 0 {
		t.Errorf("successful readiness probe recorded %d request points, want 0", len(points))
	}
}

func TestFailedReadinessProbeIsRecordedAsServerError(t *testing.T) {
	reader, restore := useRecordingMeter(t)
	defer restore()

	serve(t, "/health/ready", http.StatusServiceUnavailable)

	points := countPoints(t, reader, "eventa.request.count")
	if len(points) != 1 {
		t.Fatalf("failed readiness probe recorded %d request points, want 1", len(points))
	}
	assertAttribute(t, points[0].attributes, "operation", "GET /health/ready")
	assertAttribute(t, points[0].attributes, "outcome", "server_error")
	assertAttribute(t, points[0].attributes, "statusCode", "503")
	assertAttribute(t, points[0].attributes, "transport", "http")
}

func TestUnknownPathReportsUnmatched(t *testing.T) {
	plan := planRequest(http.MethodGet, "/not-a-route", http.StatusNotFound, "id")
	if plan.operation != "GET unmatched" {
		t.Errorf("operation = %q, want %q", plan.operation, "GET unmatched")
	}
	if plan.outcome != "client_error" {
		t.Errorf("outcome = %q, want %q", plan.outcome, "client_error")
	}
	if !plan.record {
		t.Error("an unknown path must be recorded")
	}
}

func TestInboundRequestIDIsKeptOnlyWhenWellFormed(t *testing.T) {
	if got := resolveRequestID("abc-123"); got != "abc-123" {
		t.Errorf("resolveRequestID = %q, want the inbound value", got)
	}
	if got := resolveRequestID("bad value\n"); got == "bad value\n" {
		t.Error("a malformed inbound header must be replaced")
	}
	if got := resolveRequestID(""); got == "" {
		t.Error("a missing inbound header must be replaced with a generated id")
	}
}

type countedPoint struct {
	attributes attribute.Set
	value      int64
}

func serve(t *testing.T, path string, status int) {
	t.Helper()
	handler := Instrument(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(status)
	}), logging.New(""))
	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, path, nil))
}

func countPoints(t *testing.T, reader sdkmetric.Reader, name string) []countedPoint {
	t.Helper()
	var record metricdata.ResourceMetrics
	if err := reader.Collect(context.Background(), &record); err != nil {
		t.Fatalf("collect metrics: %v", err)
	}
	var points []countedPoint
	for _, scope := range record.ScopeMetrics {
		for _, measured := range scope.Metrics {
			if measured.Name != name {
				continue
			}
			sum, ok := measured.Data.(metricdata.Sum[int64])
			if !ok {
				t.Fatalf("%s is %T, want an int64 sum", name, measured.Data)
			}
			for _, dp := range sum.DataPoints {
				points = append(points, countedPoint{attributes: dp.Attributes, value: dp.Value})
			}
		}
	}
	return points
}

func assertAttribute(t *testing.T, set attribute.Set, key, want string) {
	t.Helper()
	if got, ok := set.Value(attribute.Key(key)); !ok || got.AsString() != want {
		t.Errorf("%s = %q, want %q", key, got.AsString(), want)
	}
}

// useRecordingMeter binds the package instruments to a reader this test can
// observe. The package globals are recreated on cleanup so later tests do not
// keep reporting into a discarded reader.
func useRecordingMeter(t *testing.T) (sdkmetric.Reader, func()) {
	t.Helper()
	reader := sdkmetric.NewManualReader()
	previous := otel.GetMeterProvider()
	otel.SetMeterProvider(sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader)))
	if err := metrics.Init(); err != nil {
		otel.SetMeterProvider(previous)
		t.Fatalf("metrics.Init() = %v", err)
	}
	return reader, func() {
		otel.SetMeterProvider(previous)
		_ = metrics.Init()
	}
}
