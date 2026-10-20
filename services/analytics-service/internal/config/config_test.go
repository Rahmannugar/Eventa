package config

import (
	"strings"
	"testing"
)

func valid() map[string]any {
	return map[string]any{
		"OTEL_EXPORTER_OTLP_ENDPOINT": "http://observability-collector:4318",
		"DEPLOYMENT_ENVIRONMENT":      "local",
		"DATABASE_URL":                "postgres://eventa_analytics:eventa_analytics_password@analytics-database:5432/eventa_analytics",
		"HEALTH_PORT":                 "3009",
		"GRPC_PORT":                   "50055",
		"KAFKA_BROKERS":               "event-bus:9092",
		"KAFKA_CONSUMER_GROUP":        "eventa-analytics-service",
		"KAFKA_COMMERCE_ORDER_TOPIC":  "eventa.commerce.order.v1",
		"KAFKA_TICKET_CHECK_IN_TOPIC": "eventa.ticket.check-in.v1",
		"KAFKA_TICKET_REVOKED_TOPIC":  "eventa.ticket.revoked.v1",
		"KAFKA_EVENT_LIFECYCLE_TOPIC": "eventa.event.lifecycle.v1",
	}
}

func TestLoadAcceptsTheCanonicalLocalConfiguration(t *testing.T) {
	cfg, telemetry, err := loadFrom(newTestKoanf(valid()))
	if err != nil {
		t.Fatalf("loadFrom error = %v", err)
	}
	if cfg.HealthPort != 3009 || cfg.GRPCPort != 50055 {
		t.Errorf("ports = %d/%d, want 3009/50055", cfg.HealthPort, cfg.GRPCPort)
	}
	if cfg.KafkaCommerceGroup != "eventa-analytics-service-commerce" {
		t.Errorf("commerce group = %q", cfg.KafkaCommerceGroup)
	}
	if cfg.KafkaCheckInGroup != "eventa-analytics-service-check-in" {
		t.Errorf("check-in group = %q", cfg.KafkaCheckInGroup)
	}
	if cfg.KafkaRevokedGroup != "eventa-analytics-service-revoked" {
		t.Errorf("revoked group = %q", cfg.KafkaRevokedGroup)
	}
	if cfg.KafkaLifecycleGroup != "eventa-analytics-service-lifecycle" {
		t.Errorf("lifecycle group = %q", cfg.KafkaLifecycleGroup)
	}
	if telemetry.DeploymentEnvironment != "local" {
		t.Errorf("deployment environment = %q", telemetry.DeploymentEnvironment)
	}
}

func TestLoadReportsTheFirstFailingRule(t *testing.T) {
	cases := []struct {
		key   string
		value any
		want  string
	}{
		{"OTEL_EXPORTER_OTLP_ENDPOINT", "", "OTEL_EXPORTER_OTLP_ENDPOINT is required"},
		{"OTEL_EXPORTER_OTLP_ENDPOINT", "not-a-url", "OTEL_EXPORTER_OTLP_ENDPOINT must be an http(s) URL with a host"},
		{"DEPLOYMENT_ENVIRONMENT", "", "DEPLOYMENT_ENVIRONMENT is required"},
		{"DATABASE_URL", "", "DATABASE_URL is required"},
		{"HEALTH_PORT", "0", "HEALTH_PORT must be an integer between 1 and 65535"},
		{"GRPC_PORT", "abc", "GRPC_PORT must be an integer between 1 and 65535"},
		{"KAFKA_BROKERS", "event-bus", "KAFKA_BROKERS entries must be host:port, got \"event-bus\""},
		{"KAFKA_CONSUMER_GROUP", "", "KAFKA_CONSUMER_GROUP is required"},
		{"KAFKA_COMMERCE_ORDER_TOPIC", "topic with space", "KAFKA_COMMERCE_ORDER_TOPIC must match"},
		{"KAFKA_TICKET_CHECK_IN_TOPIC", "", "KAFKA_TICKET_CHECK_IN_TOPIC is required"},
		{"KAFKA_TICKET_REVOKED_TOPIC", "", "KAFKA_TICKET_REVOKED_TOPIC is required"},
		{"KAFKA_EVENT_LIFECYCLE_TOPIC", "", "KAFKA_EVENT_LIFECYCLE_TOPIC is required"},
	}

	for _, testCase := range cases {
		t.Run(testCase.key, func(t *testing.T) {
			input := valid()
			input[testCase.key] = testCase.value
			_, _, err := loadFrom(newTestKoanf(input))
			if err == nil {
				t.Fatalf("loadFrom accepted an invalid %s", testCase.key)
			}
			if !strings.Contains(err.Error(), testCase.want) {
				t.Errorf("error = %q, want it to contain %q", err.Error(), testCase.want)
			}
		})
	}
}

type testKoanf struct {
	values map[string]any
}

func newTestKoanf(values map[string]any) *testKoanf {
	return &testKoanf{values: values}
}

func (k *testKoanf) String(key string) string {
	if value, ok := k.values[key]; ok {
		if text, ok := value.(string); ok {
			return text
		}
		return ""
	}
	return ""
}
