package health

import (
	"log/slog"
	"math"
	"net/http"
	"regexp"
	"time"

	"github.com/google/uuid"

	"github.com/eventa/discovery-service/internal/metrics"
)

// probePaths are the only routes this service publishes. Docker polls them
// every 30 seconds, so a successful probe stays out of the metrics and the
// logs; a failed probe is the signal an operator acts on.
var probePaths = map[string]bool{"/health/live": true, "/health/ready": true}

// requestIDPattern is the header value @eventa/observability accepts before it
// falls back to a generated identifier.
var requestIDPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,128}$`)

type requestPlan struct {
	operation string
	outcome   string
	status    int
	requestID string
	record    bool
}

// planRequest decides what one completed request emits. A path that is not a
// published route reports as `unmatched`, because the TypeScript middleware
// reads `route.path ?? 'unmatched'` and this service has no other routes.
func planRequest(method, path string, status int, requestID string) requestPlan {
	operation := method + " unmatched"
	if probePaths[path] {
		operation = method + " " + path
	}
	outcome := metrics.RequestOutcome(status)
	suppressed := outcome == "success" && probePaths[path]
	return requestPlan{
		operation: operation,
		outcome:   outcome,
		status:    status,
		requestID: requestID,
		record:    !suppressed,
	}
}

func resolveRequestID(header string) string {
	if requestIDPattern.MatchString(header) {
		return header
	}
	return uuid.NewString()
}

func milliseconds(elapsed time.Duration) float64 {
	return math.Round(float64(elapsed)/float64(time.Millisecond)*1000) / 1000
}

// Instrument wraps the service's only HTTP server. A completed request emits
// request metrics and an `http_request_completed` line unless it was a
// successful health probe. It deliberately creates no server span: the
// TypeScript service disabled HTTP auto-instrumentation for both probe routes,
// so no incoming HTTP trace exists for either of them.
func Instrument(next http.Handler, logger *slog.Logger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		requestID := resolveRequestID(r.Header.Get("x-request-id"))
		w.Header().Set("x-request-id", requestID)

		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(recorder, r)
		elapsed := time.Since(started)

		plan := planRequest(r.Method, r.URL.Path, recorder.status, requestID)
		if !plan.record {
			return
		}
		metrics.RecordRequest(elapsed, plan.operation, plan.outcome, plan.status)
		logger.InfoContext(r.Context(), "http_request_completed",
			"duration_ms", milliseconds(elapsed),
			"method", r.Method,
			"operation", plan.operation,
			"outcome", plan.outcome,
			"request_id", plan.requestID,
			"status_code", plan.status,
		)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}
