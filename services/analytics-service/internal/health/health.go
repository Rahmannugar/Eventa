package health

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
)

// Checker reports whether one real local dependency is usable. Readiness only
// aggregates checkers that exist; it never reports a state nothing observes.
type Checker interface {
	Ready(ctx context.Context) error
}

type Handler struct {
	checkers []Checker
}

func New(checkers ...Checker) *Handler { return &Handler{checkers: checkers} }

func (h *Handler) Live(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handler) Ready(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	for _, checker := range h.checkers {
		if err := checker.Ready(ctx); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{
				"statusCode": http.StatusServiceUnavailable,
				"message":    "dependency unavailable",
				"error":      http.StatusText(http.StatusServiceUnavailable),
			})
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
