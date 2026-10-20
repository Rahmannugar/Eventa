package health

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

type fakeChecker struct{ err error }

func (f fakeChecker) Ready(context.Context) error { return f.err }

func TestLiveAlwaysReportsOk(t *testing.T) {
	handler := New(fakeChecker{err: errors.New("database down")})
	recorder := httptest.NewRecorder()
	handler.Live(recorder, httptest.NewRequest(http.MethodGet, "/health/live", nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["status"] != "ok" {
		t.Errorf("body = %v, want status ok", body)
	}
}

func TestReadyReportsReadyWhenEveryDependencyResponds(t *testing.T) {
	handler := New(fakeChecker{}, fakeChecker{})
	recorder := httptest.NewRecorder()
	handler.Ready(recorder, httptest.NewRequest(http.MethodGet, "/health/ready", nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["status"] != "ready" {
		t.Errorf("body = %v, want status ready", body)
	}
}

func TestReadyReportsServiceUnavailableWhenADependencyFails(t *testing.T) {
	handler := New(fakeChecker{}, fakeChecker{err: errors.New("connection refused")})
	recorder := httptest.NewRecorder()
	handler.Ready(recorder, httptest.NewRequest(http.MethodGet, "/health/ready", nil))

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", recorder.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["statusCode"] != float64(http.StatusServiceUnavailable) {
		t.Errorf("statusCode = %v, want 503", body["statusCode"])
	}
	if body["message"] != "dependency unavailable" {
		t.Errorf("message = %v", body["message"])
	}
	if body["error"] != "Service Unavailable" {
		t.Errorf("error = %v", body["error"])
	}
}
