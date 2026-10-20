// Package config loads and validates the Analytics runtime configuration
// from the process environment. Rules run in a fixed order and Load reports
// the first failure, matching the other Go services.
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

// stringSource is the minimal view of a configuration store Load needs. It
// keeps the rule helpers testable without constructing a koanf instance.
type stringSource interface {
	String(key string) string
}

// Config is the validated runtime configuration of one Analytics process.
type Config struct {
	DatabaseURL              string
	HealthPort               int
	GRPCPort                 int
	KafkaBrokers             []string
	KafkaConsumerGroup       string
	KafkaCommerceTopic       string
	KafkaCheckInTopic        string
	KafkaRevokedTopic        string
	KafkaEventLifecycleTopic string

	KafkaCommerceGroup  string
	KafkaCheckInGroup   string
	KafkaRevokedGroup   string
	KafkaLifecycleGroup string
}

// Telemetry is the validated observability configuration.
type Telemetry struct {
	Endpoint              string
	DeploymentEnvironment string
}

var (
	brokerPattern = regexp.MustCompile(`^[^\s:]+:\d{1,5}$`)
	namePattern   = regexp.MustCompile(`^[a-zA-Z0-9._-]{1,249}$`)
)

// Load reads the process environment, validates it, and returns the two
// configuration structs. It fails on the first invalid or missing key.
func Load() (Config, Telemetry, error) {
	k := koanf.New("_")
	if err := k.Load(env.Provider("", "_", func(s string) string { return s }), nil); err != nil {
		return Config{}, Telemetry{}, err
	}
	return loadFrom(k)
}

func loadFrom(k stringSource) (Config, Telemetry, error) {
	telemetry, err := readObservability(k)
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

	brokers, err := readBrokers(k)
	if err != nil {
		return Config{}, Telemetry{}, err
	}

	consumerGroup, err := name(k, "KAFKA_CONSUMER_GROUP")
	if err != nil {
		return Config{}, Telemetry{}, err
	}

	commerceTopic, err := name(k, "KAFKA_COMMERCE_ORDER_TOPIC")
	if err != nil {
		return Config{}, Telemetry{}, err
	}

	checkInTopic, err := name(k, "KAFKA_TICKET_CHECK_IN_TOPIC")
	if err != nil {
		return Config{}, Telemetry{}, err
	}

	revokedTopic, err := name(k, "KAFKA_TICKET_REVOKED_TOPIC")
	if err != nil {
		return Config{}, Telemetry{}, err
	}

	lifecycleTopic, err := name(k, "KAFKA_EVENT_LIFECYCLE_TOPIC")
	if err != nil {
		return Config{}, Telemetry{}, err
	}

	return Config{
		DatabaseURL:              databaseURL,
		HealthPort:               healthPort,
		GRPCPort:                 grpcPort,
		KafkaBrokers:             brokers,
		KafkaConsumerGroup:       consumerGroup,
		KafkaCommerceTopic:       commerceTopic,
		KafkaCheckInTopic:        checkInTopic,
		KafkaRevokedTopic:        revokedTopic,
		KafkaEventLifecycleTopic: lifecycleTopic,
		KafkaCommerceGroup:       consumerGroup + "-commerce",
		KafkaCheckInGroup:        consumerGroup + "-check-in",
		KafkaRevokedGroup:        consumerGroup + "-revoked",
		KafkaLifecycleGroup:      consumerGroup + "-lifecycle",
	}, telemetry, nil
}

func required(k stringSource, key string) (string, error) {
	value := strings.TrimSpace(k.String(key))
	if value == "" {
		return "", fmt.Errorf("%s is required", key)
	}
	return value, nil
}

func name(k stringSource, key string) (string, error) {
	value, err := required(k, key)
	if err != nil {
		return "", err
	}
	if !namePattern.MatchString(value) {
		return "", fmt.Errorf("%s must match %s", key, namePattern.String())
	}
	return value, nil
}

func boundedInt(k stringSource, key string, min, max int) (int, error) {
	value := strings.TrimSpace(k.String(key))
	if value == "" {
		return 0, fmt.Errorf("%s is required", key)
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < min || parsed > max {
		return 0, fmt.Errorf("%s must be an integer between %d and %d", key, min, max)
	}
	return parsed, nil
}

func readBrokers(k stringSource) ([]string, error) {
	raw, err := required(k, "KAFKA_BROKERS")
	if err != nil {
		return nil, err
	}
	parts := strings.Split(raw, ",")
	brokers := make([]string, 0, len(parts))
	for _, part := range parts {
		broker := strings.TrimSpace(part)
		if !brokerPattern.MatchString(broker) {
			return nil, fmt.Errorf("KAFKA_BROKERS entries must be host:port, got %q", broker)
		}
		brokers = append(brokers, broker)
	}
	return brokers, nil
}

func readObservability(k stringSource) (Telemetry, error) {
	endpoint, err := required(k, "OTEL_EXPORTER_OTLP_ENDPOINT")
	if err != nil {
		return Telemetry{}, err
	}
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return Telemetry{}, fmt.Errorf("OTEL_EXPORTER_OTLP_ENDPOINT must be an http(s) URL with a host")
	}
	endpoint = strings.TrimSuffix(endpoint, "/")

	environment, err := required(k, "DEPLOYMENT_ENVIRONMENT")
	if err != nil {
		return Telemetry{}, err
	}

	return Telemetry{Endpoint: endpoint, DeploymentEnvironment: environment}, nil
}
