package config

import (
	"testing"

	"github.com/knadh/koanf/v2"
)

// mapProvider lets tests build the same koanf tree the process builds from the
// environment without adding a provider dependency.
type mapProvider struct{ values map[string]any }

func (p mapProvider) Read() (map[string]any, error) { return p.values, nil }
func (p mapProvider) ReadBytes() ([]byte, error)    { return nil, nil }
func (p mapProvider) Keys() []string                { return nil }

func valid() map[string]any {
	return map[string]any{
		"OTEL_EXPORTER_OTLP_ENDPOINT": "http://observability-collector:4318",
		"DEPLOYMENT_ENVIRONMENT":      "local",
		"EVENT_GRPC_URL":              "event-service:50052",
		"EVENT_GRPC_DEADLINE_MS":      "3000",
		"DATABASE_URL":                "postgres://eventa_discovery@discovery-database:5432/eventa_discovery",
		"HEALTH_PORT":                 "3011",
		"KAFKA_BROKERS":               "event-bus:9092",
		"KAFKA_CONSUMER_GROUP":        "eventa-discovery-service",
		"KAFKA_EVENT_LIFECYCLE_TOPIC": "eventa.event.lifecycle.v1",
	}
}

func load(values map[string]any) (Config, Telemetry, error) {
	k := koanf.New("_")
	if err := k.Load(mapProvider{values: values}, nil); err != nil {
		panic(err)
	}
	return loadFrom(k)
}

func TestLoadAcceptsTheCanonicalLocalConfiguration(t *testing.T) {
	cfg, tel, err := load(valid())
	if err != nil {
		t.Fatalf("expected valid configuration, got %v", err)
	}
	if cfg.HealthPort != 3011 {
		t.Errorf("HealthPort = %d, want 3011", cfg.HealthPort)
	}
	if cfg.KafkaEventLifecycleTopic != "eventa.event.lifecycle.v1" {
		t.Errorf("topic = %q, want eventa.event.lifecycle.v1", cfg.KafkaEventLifecycleTopic)
	}
	if cfg.EventGRPCDeadlineMS != 3000 {
		t.Errorf("EventGRPCDeadlineMS = %d, want 3000", cfg.EventGRPCDeadlineMS)
	}
	if tel.Endpoint != "http://observability-collector:4318" || tel.DeploymentEnvironment != "local" {
		t.Errorf("telemetry = %+v, want the canonical local values", tel)
	}
}

func TestLoadReportsTheFirstFailingRule(t *testing.T) {
	cases := []struct {
		name    string
		mutate  func(map[string]any)
		wantErr string
	}{
		{"missing endpoint", func(v map[string]any) { delete(v, "OTEL_EXPORTER_OTLP_ENDPOINT") }, "OTEL_EXPORTER_OTLP_ENDPOINT is required"},
		{"missing environment", func(v map[string]any) { delete(v, "DEPLOYMENT_ENVIRONMENT") }, "DEPLOYMENT_ENVIRONMENT is required"},
		{"malformed event address", func(v map[string]any) { v["EVENT_GRPC_URL"] = "event-service" }, "EVENT_GRPC_URL must use the host:port format"},
		{"out of range deadline", func(v map[string]any) { v["EVENT_GRPC_DEADLINE_MS"] = "99" }, "EVENT_GRPC_DEADLINE_MS must be an integer between 100 and 10000"},
		{"missing database", func(v map[string]any) { delete(v, "DATABASE_URL") }, "DATABASE_URL is required"},
		{"missing health port", func(v map[string]any) { delete(v, "HEALTH_PORT") }, "HEALTH_PORT is required"},
		{"malformed broker", func(v map[string]any) { v["KAFKA_BROKERS"] = "event-bus" }, "KAFKA_BROKERS must use host:port entries"},
		{"missing consumer group", func(v map[string]any) { delete(v, "KAFKA_CONSUMER_GROUP") }, "KAFKA_CONSUMER_GROUP is required"},
		{"missing lifecycle topic", func(v map[string]any) { delete(v, "KAFKA_EVENT_LIFECYCLE_TOPIC") }, "KAFKA_EVENT_LIFECYCLE_TOPIC is required"},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			values := valid()
			testCase.mutate(values)
			_, _, err := load(values)
			if err == nil || err.Error() != testCase.wantErr {
				t.Errorf("error = %v, want %q", err, testCase.wantErr)
			}
		})
	}
}
