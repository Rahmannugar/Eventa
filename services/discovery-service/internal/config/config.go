// Package config validates the runtime configuration this service needs: one
// health port, its own database, the lifecycle topic it consumes, and the Event
// Service address it resolves authoritative content from.
package config

import (
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"github.com/knadh/koanf/providers/env"
	"github.com/knadh/koanf/v2"
)

var (
	hostPortPattern = regexp.MustCompile(`^[^\s:/]+:\d+$`)
	brokerPattern   = regexp.MustCompile(`^[^\s:]+:\d{1,5}$`)
	namePattern     = regexp.MustCompile(`^[a-zA-Z0-9._-]{1,249}$`)
)

type Config struct {
	HealthPort               int
	GRPCPort                 int
	DatabaseURL              string
	KafkaBrokers             []string
	KafkaConsumerGroup       string
	KafkaEventLifecycleTopic string
	EventGRPCURL             string
	EventGRPCDeadlineMS      int
	AhnlichAIURL             string
	AhnlichDeadlineMS        int
	SemanticStore            string
	SemanticModel            string
	SemanticReconcileMS      int
	SemanticReconcileBatch   int
	SemanticCanaryFloor      float64
}

type Telemetry struct {
	Endpoint              string
	DeploymentEnvironment string
}

func readObservability(k *koanf.Koanf) (Telemetry, error) {
	raw := strings.TrimSpace(k.String("OTEL_EXPORTER_OTLP_ENDPOINT"))
	if raw == "" {
		return Telemetry{}, fmt.Errorf("OTEL_EXPORTER_OTLP_ENDPOINT is required")
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" {
		return Telemetry{}, fmt.Errorf("OTEL_EXPORTER_OTLP_ENDPOINT must be a valid URL")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return Telemetry{}, fmt.Errorf("OTEL_EXPORTER_OTLP_ENDPOINT must use http:// or https://")
	}
	environment := strings.TrimSpace(k.String("DEPLOYMENT_ENVIRONMENT"))
	if environment == "" {
		return Telemetry{}, fmt.Errorf("DEPLOYMENT_ENVIRONMENT is required")
	}
	return Telemetry{Endpoint: strings.TrimSuffix(parsed.String(), "/"), DeploymentEnvironment: environment}, nil
}

func required(k *koanf.Koanf, name string) (string, error) {
	value := strings.TrimSpace(k.String(name))
	if value == "" {
		return "", fmt.Errorf("%s is required", name)
	}
	return value, nil
}

func hostPort(k *koanf.Koanf, name string) (string, error) {
	value, err := required(k, name)
	if err != nil {
		return "", err
	}
	if !hostPortPattern.MatchString(value) {
		return "", fmt.Errorf("%s must use the host:port format", name)
	}
	return value, nil
}

func boundedInt(k *koanf.Koanf, name string, min, max int) (int, error) {
	raw, err := required(k, name)
	if err != nil {
		return 0, err
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("%s must be an integer between %d and %d", name, min, max)
	}
	if parsed < min || parsed > max {
		return 0, fmt.Errorf("%s must be an integer between %d and %d", name, min, max)
	}
	return parsed, nil
}

func boundedFloat(k *koanf.Koanf, name string, min, max float64) (float64, error) {
	raw, err := required(k, name)
	if err != nil {
		return 0, err
	}
	parsed, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return 0, fmt.Errorf("%s must be a number between %v and %v", name, min, max)
	}
	if parsed < min || parsed > max {
		return 0, fmt.Errorf("%s must be a number between %v and %v", name, min, max)
	}
	return parsed, nil
}

func brokers(k *koanf.Koanf) ([]string, error) {
	raw, err := required(k, "KAFKA_BROKERS")
	if err != nil {
		return nil, err
	}
	var out []string
	for _, entry := range strings.Split(raw, ",") {
		entry = strings.TrimSpace(entry)
		if entry != "" {
			out = append(out, entry)
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("KAFKA_BROKERS must list a broker")
	}
	for _, entry := range out {
		if !brokerPattern.MatchString(entry) {
			return nil, fmt.Errorf("KAFKA_BROKERS must use host:port entries")
		}
	}
	return out, nil
}

func name(k *koanf.Koanf, field string) (string, error) {
	raw, err := required(k, field)
	if err != nil {
		return "", err
	}
	if !namePattern.MatchString(raw) {
		return "", fmt.Errorf("%s may only contain letters, digits, '.', '_' and '-'", field)
	}
	return raw, nil
}

// Load validates the runtime configuration. Rules run in a fixed order so the
// first failing rule is the reported error.
func Load() (Config, Telemetry, error) {
	k := koanf.New("_")
	if err := k.Load(env.Provider("", "_", func(s string) string { return s }), nil); err != nil {
		return Config{}, Telemetry{}, err
	}
	return loadFrom(k)
}

func loadFrom(k *koanf.Koanf) (Config, Telemetry, error) {
	telemetry, err := readObservability(k)
	if err != nil {
		return Config{}, Telemetry{}, err
	}

	eventURL, err := hostPort(k, "EVENT_GRPC_URL")
	if err != nil {
		return Config{}, Telemetry{}, err
	}
	eventDeadline, err := boundedInt(k, "EVENT_GRPC_DEADLINE_MS", 100, 10000)
	if err != nil {
		return Config{}, Telemetry{}, err
	}

	databaseURL, err := required(k, "DATABASE_URL")
	if err != nil {
		return Config{}, Telemetry{}, err
	}

	healthPort, err := boundedInt(k, "HEALTH_PORT", 1, 65535)
	if err != nil {
		return Config{}, Telemetry{}, err
	}

	grpcPort, err := boundedInt(k, "GRPC_PORT", 1, 65535)
	if err != nil {
		return Config{}, Telemetry{}, err
	}

	kafkaBrokers, err := brokers(k)
	if err != nil {
		return Config{}, Telemetry{}, err
	}
	consumerGroup, err := name(k, "KAFKA_CONSUMER_GROUP")
	if err != nil {
		return Config{}, Telemetry{}, err
	}
	lifecycleTopic, err := name(k, "KAFKA_EVENT_LIFECYCLE_TOPIC")
	if err != nil {
		return Config{}, Telemetry{}, err
	}

	ahnlichURL, err := hostPort(k, "AHNLICH_AI_URL")
	if err != nil {
		return Config{}, Telemetry{}, err
	}
	ahnlichDeadline, err := boundedInt(k, "AHNLICH_DEADLINE_MS", 100, 10000)
	if err != nil {
		return Config{}, Telemetry{}, err
	}
	semanticStore, err := name(k, "SEMANTIC_STORE")
	if err != nil {
		return Config{}, Telemetry{}, err
	}
	semanticModel, err := name(k, "SEMANTIC_MODEL")
	if err != nil {
		return Config{}, Telemetry{}, err
	}
	reconcileMS, err := boundedInt(k, "SEMANTIC_RECONCILE_INTERVAL_MS", 1000, 3600000)
	if err != nil {
		return Config{}, Telemetry{}, err
	}
	reconcileBatch, err := boundedInt(k, "SEMANTIC_RECONCILE_BATCH", 1, 500)
	if err != nil {
		return Config{}, Telemetry{}, err
	}
	canaryFloor, err := boundedFloat(k, "SEMANTIC_CANARY_MIN_SIMILARITY", -1, 1)
	if err != nil {
		return Config{}, Telemetry{}, err
	}

	return Config{
		HealthPort:               healthPort,
		GRPCPort:                 grpcPort,
		DatabaseURL:              databaseURL,
		KafkaBrokers:             kafkaBrokers,
		KafkaConsumerGroup:       consumerGroup,
		KafkaEventLifecycleTopic: lifecycleTopic,
		EventGRPCURL:             eventURL,
		EventGRPCDeadlineMS:      eventDeadline,
		AhnlichAIURL:             ahnlichURL,
		AhnlichDeadlineMS:        ahnlichDeadline,
		SemanticStore:            semanticStore,
		SemanticModel:            semanticModel,
		SemanticReconcileMS:      reconcileMS,
		SemanticReconcileBatch:   reconcileBatch,
		SemanticCanaryFloor:      canaryFloor,
	}, telemetry, nil
}
