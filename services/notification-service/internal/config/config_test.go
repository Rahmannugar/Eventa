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
		"IDENTITY_GRPC_URL":           "identity-service:50051",
		"EVENT_GRPC_DEADLINE_MS":      "3000",
		"IDENTITY_GRPC_DEADLINE_MS":   "3000",
		"RESEND_REQUEST_TIMEOUT_MS":   "5000",
		"DATABASE_URL":                "postgres://eventa_notification@notification-database:5432/eventa_notification",
		"HEALTH_PORT":                 "3006",
		"KAFKA_BROKERS":               "event-bus:9092",
		"KAFKA_CONSUMER_GROUP":        "eventa-notification-service",
		"KAFKA_TICKET_REVOKED_TOPIC":  "eventa.ticket.revoked.v1",
		"RABBITMQ_CONNECT_TIMEOUT_MS": "2000",
		"RABBITMQ_PUBLISH_TIMEOUT_MS": "2000",
		"RABBITMQ_URL":                "amqp://eventa:eventa_password@job-queue:5672",
		"RESEND_API_KEY":              "re_secret",
		"RESEND_FROM":                 "Eventa <noreply@livepoly.site>",
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
	if cfg.HealthPort != 3006 {
		t.Errorf("HealthPort = %d, want 3006", cfg.HealthPort)
	}
	if len(cfg.KafkaBrokers) != 1 || cfg.KafkaBrokers[0] != "event-bus:9092" {
		t.Errorf("KafkaBrokers = %v, want [event-bus:9092]", cfg.KafkaBrokers)
	}
	if cfg.EventGRPCDeadlineMS != 3000 || cfg.IdentityGRPCDeadlineMS != 3000 {
		t.Errorf("deadlines = %d/%d, want 3000/3000", cfg.EventGRPCDeadlineMS, cfg.IdentityGRPCDeadlineMS)
	}
	if tel.Endpoint != "http://observability-collector:4318" || tel.DeploymentEnvironment != "local" {
		t.Errorf("telemetry = %+v", tel)
	}
}

func TestLoadReportsTheFirstFailingRuleInOrder(t *testing.T) {
	// Telemetry is validated before every runtime rule.
	withoutTelemetry := valid()
	delete(withoutTelemetry, "OTEL_EXPORTER_OTLP_ENDPOINT")
	if _, _, err := load(withoutTelemetry); err == nil || err.Error() != "OTEL_EXPORTER_OTLP_ENDPOINT is required" {
		t.Errorf("err = %v, want OTEL_EXPORTER_OTLP_ENDPOINT is required", err)
	}

	// EVENT_GRPC_URL is the first runtime rule, so it wins over later failures.
	broken := valid()
	broken["EVENT_GRPC_URL"] = ""
	broken["HEALTH_PORT"] = "not-a-number"
	if _, _, err := load(broken); err == nil || err.Error() != "EVENT_GRPC_URL is required" {
		t.Errorf("err = %v, want EVENT_GRPC_URL is required", err)
	}
}

func TestLoadRejectsInvalidValuesWithExactMessages(t *testing.T) {
	cases := []struct {
		name    string
		mutate  func(map[string]any)
		wantErr string
	}{
		{"missing identity url", func(v map[string]any) { delete(v, "IDENTITY_GRPC_URL") }, "IDENTITY_GRPC_URL is required"},
		{"event url needs host:port", func(v map[string]any) { v["EVENT_GRPC_URL"] = "http://event-service:50052" }, "EVENT_GRPC_URL must use the host:port format"},
		{"event deadline below range", func(v map[string]any) { v["EVENT_GRPC_DEADLINE_MS"] = "99" }, "EVENT_GRPC_DEADLINE_MS must be an integer between 100 and 10000"},
		{"identity deadline above range", func(v map[string]any) { v["IDENTITY_GRPC_DEADLINE_MS"] = "10001" }, "IDENTITY_GRPC_DEADLINE_MS must be an integer between 100 and 10000"},
		{"resend timeout not a number", func(v map[string]any) { v["RESEND_REQUEST_TIMEOUT_MS"] = "fast" }, "RESEND_REQUEST_TIMEOUT_MS must be a positive integer"},
		{"resend timeout over cap", func(v map[string]any) { v["RESEND_REQUEST_TIMEOUT_MS"] = "20001" }, "RESEND_REQUEST_TIMEOUT_MS must not exceed 20000 milliseconds"},
		{"missing database url", func(v map[string]any) { delete(v, "DATABASE_URL") }, "DATABASE_URL is required"},
		{"health port out of range", func(v map[string]any) { v["HEALTH_PORT"] = "0" }, "HEALTH_PORT must be an integer between 1 and 65535"},
		{"missing brokers", func(v map[string]any) { delete(v, "KAFKA_BROKERS") }, "KAFKA_BROKERS is required"},
		{"broker entries malformed", func(v map[string]any) { v["KAFKA_BROKERS"] = "event-bus" }, "KAFKA_BROKERS must use host:port entries"},
		{"consumer group has illegal characters", func(v map[string]any) { v["KAFKA_CONSUMER_GROUP"] = "eventa notification" }, "KAFKA_CONSUMER_GROUP may only contain letters, digits, '.', '_' and '-'"},
		{"topic has illegal characters", func(v map[string]any) { v["KAFKA_TICKET_REVOKED_TOPIC"] = "eventa/ticket" }, "KAFKA_TICKET_REVOKED_TOPIC may only contain letters, digits, '.', '_' and '-'"},
		{"connect timeout not positive", func(v map[string]any) { v["RABBITMQ_CONNECT_TIMEOUT_MS"] = "0" }, "RABBITMQ_CONNECT_TIMEOUT_MS must be a positive integer"},
		{"publish timeout not positive", func(v map[string]any) { v["RABBITMQ_PUBLISH_TIMEOUT_MS"] = "-1" }, "RABBITMQ_PUBLISH_TIMEOUT_MS must be a positive integer"},
		{"rabbit url wrong scheme", func(v map[string]any) { v["RABBITMQ_URL"] = "http://job-queue:5672" }, "RABBITMQ_URL must be a valid amqp:// or amqps:// URL"},
		{"missing resend key", func(v map[string]any) { delete(v, "RESEND_API_KEY") }, "RESEND_API_KEY is required"},
		{"missing resend from", func(v map[string]any) { delete(v, "RESEND_FROM") }, "RESEND_FROM is required"},
		{"deployment environment missing", func(v map[string]any) { delete(v, "DEPLOYMENT_ENVIRONMENT") }, "DEPLOYMENT_ENVIRONMENT is required"},
		{"otel endpoint not a url", func(v map[string]any) { v["OTEL_EXPORTER_OTLP_ENDPOINT"] = "not a url" }, "OTEL_EXPORTER_OTLP_ENDPOINT must be a valid URL"},
		{"otel endpoint wrong scheme", func(v map[string]any) { v["OTEL_EXPORTER_OTLP_ENDPOINT"] = "ftp://collector:4318" }, "OTEL_EXPORTER_OTLP_ENDPOINT must use http:// or https://"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			values := valid()
			tc.mutate(values)
			_, _, err := load(values)
			if err == nil {
				t.Fatal("expected an error")
			}
			if err.Error() != tc.wantErr {
				t.Errorf("err = %q, want %q", err.Error(), tc.wantErr)
			}
		})
	}
}

func TestLoadSplitsAndTrimsBrokerLists(t *testing.T) {
	values := valid()
	values["KAFKA_BROKERS"] = " kafka-a:9092 , kafka-b:9093 , "
	cfg, _, err := load(values)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(cfg.KafkaBrokers) != 2 || cfg.KafkaBrokers[0] != "kafka-a:9092" || cfg.KafkaBrokers[1] != "kafka-b:9093" {
		t.Errorf("KafkaBrokers = %v", cfg.KafkaBrokers)
	}
}
