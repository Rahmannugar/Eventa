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
		"OTEL_EXPORTER_OTLP_ENDPOINT":    "http://observability-collector:4318",
		"DEPLOYMENT_ENVIRONMENT":         "local",
		"EVENT_GRPC_URL":                 "event-service:50052",
		"EVENT_GRPC_DEADLINE_MS":         "3000",
		"DATABASE_URL":                   "postgres://eventa_discovery@discovery-database:5432/eventa_discovery",
		"HEALTH_PORT":                    "3011",
		"GRPC_PORT":                      "50054",
		"KAFKA_BROKERS":                  "event-bus:9092",
		"KAFKA_CONSUMER_GROUP":           "eventa-discovery-service",
		"KAFKA_EVENT_LIFECYCLE_TOPIC":    "eventa.event.lifecycle.v1",
		"KAFKA_COMMERCE_ORDER_TOPIC":     "eventa.commerce.order.v1",
		"KAFKA_TICKET_CHECK_IN_TOPIC":    "eventa.ticket.check-in.v1",
		"AHNLICH_AI_URL":                 "ahnlich-ai:1370",
		"AHNLICH_DEADLINE_MS":            "2000",
		"SEMANTIC_STORE":                 "eventa_events",
		"SEMANTIC_MODEL":                 "all-minilm-l6-v2",
		"SEMANTIC_RECONCILE_INTERVAL_MS": "30000",
		"SEMANTIC_RECONCILE_BATCH":       "100",
		"SEMANTIC_CANARY_MIN_SIMILARITY": "0.1",
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
	if cfg.GRPCPort != 50054 {
		t.Errorf("GRPCPort = %d, want 50054", cfg.GRPCPort)
	}
	if cfg.KafkaEventLifecycleTopic != "eventa.event.lifecycle.v1" {
		t.Errorf("topic = %q, want eventa.event.lifecycle.v1", cfg.KafkaEventLifecycleTopic)
	}
	if cfg.KafkaCommerceOrderTopic != "eventa.commerce.order.v1" {
		t.Errorf("commerce topic = %q, want eventa.commerce.order.v1", cfg.KafkaCommerceOrderTopic)
	}
	if cfg.KafkaTicketCheckInTopic != "eventa.ticket.check-in.v1" {
		t.Errorf("check-in topic = %q, want eventa.ticket.check-in.v1", cfg.KafkaTicketCheckInTopic)
	}
	if cfg.KafkaCommerceGroup != "eventa-discovery-service-commerce" {
		t.Errorf("commerce group = %q, want the derived sibling group", cfg.KafkaCommerceGroup)
	}
	if cfg.KafkaCheckInGroup != "eventa-discovery-service-check-in" {
		t.Errorf("check-in group = %q, want the derived sibling group", cfg.KafkaCheckInGroup)
	}
	if cfg.EventGRPCDeadlineMS != 3000 {
		t.Errorf("EventGRPCDeadlineMS = %d, want 3000", cfg.EventGRPCDeadlineMS)
	}
	if cfg.AhnlichAIURL != "ahnlich-ai:1370" || cfg.SemanticStore != "eventa_events" {
		t.Errorf("semantic config = %q/%q, want the canonical local values", cfg.AhnlichAIURL, cfg.SemanticStore)
	}
	if cfg.SemanticCanaryFloor != 0.1 {
		t.Errorf("SemanticCanaryFloor = %v, want 0.1", cfg.SemanticCanaryFloor)
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
		{"missing grpc port", func(v map[string]any) { delete(v, "GRPC_PORT") }, "GRPC_PORT is required"},
		{"out of range grpc port", func(v map[string]any) { v["GRPC_PORT"] = "0" }, "GRPC_PORT must be an integer between 1 and 65535"},
		{"malformed broker", func(v map[string]any) { v["KAFKA_BROKERS"] = "event-bus" }, "KAFKA_BROKERS must use host:port entries"},
		{"missing consumer group", func(v map[string]any) { delete(v, "KAFKA_CONSUMER_GROUP") }, "KAFKA_CONSUMER_GROUP is required"},
		{"missing lifecycle topic", func(v map[string]any) { delete(v, "KAFKA_EVENT_LIFECYCLE_TOPIC") }, "KAFKA_EVENT_LIFECYCLE_TOPIC is required"},
		{"missing commerce topic", func(v map[string]any) { delete(v, "KAFKA_COMMERCE_ORDER_TOPIC") }, "KAFKA_COMMERCE_ORDER_TOPIC is required"},
		{"missing check-in topic", func(v map[string]any) { delete(v, "KAFKA_TICKET_CHECK_IN_TOPIC") }, "KAFKA_TICKET_CHECK_IN_TOPIC is required"},
		{"malformed check-in topic", func(v map[string]any) { v["KAFKA_TICKET_CHECK_IN_TOPIC"] = "eventa ticket check in" }, "KAFKA_TICKET_CHECK_IN_TOPIC may only contain letters, digits, '.', '_' and '-'"},
		{"missing ahnlich address", func(v map[string]any) { delete(v, "AHNLICH_AI_URL") }, "AHNLICH_AI_URL is required"},
		{"malformed ahnlich address", func(v map[string]any) { v["AHNLICH_AI_URL"] = "ahnlich-ai" }, "AHNLICH_AI_URL must use the host:port format"},
		{"out of range ahnlich deadline", func(v map[string]any) { v["AHNLICH_DEADLINE_MS"] = "99" }, "AHNLICH_DEADLINE_MS must be an integer between 100 and 10000"},
		{"missing semantic store", func(v map[string]any) { delete(v, "SEMANTIC_STORE") }, "SEMANTIC_STORE is required"},
		{"missing semantic model", func(v map[string]any) { delete(v, "SEMANTIC_MODEL") }, "SEMANTIC_MODEL is required"},
		{"reconcile batch too large", func(v map[string]any) { v["SEMANTIC_RECONCILE_BATCH"] = "501" }, "SEMANTIC_RECONCILE_BATCH must be an integer between 1 and 500"},
		{"canary floor out of range", func(v map[string]any) { v["SEMANTIC_CANARY_MIN_SIMILARITY"] = "2" }, "SEMANTIC_CANARY_MIN_SIMILARITY must be a number between -1 and 1"},
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
