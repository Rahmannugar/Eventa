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
	DatabaseURL              string
	ResendAPIKey             string
	ResendFrom               string
	ResendRequestTimeoutMS   int
	RabbitMQURL              string
	RabbitMQConnectTimeoutMS int
	RabbitMQPublishTimeoutMS int
	KafkaBrokers             []string
	KafkaConsumerGroup       string
	KafkaTicketRevokedTopic  string
	EventGRPCURL             string
	EventGRPCDeadlineMS      int
	IdentityGRPCURL          string
	IdentityGRPCDeadlineMS   int
}

type Telemetry struct {
	Endpoint              string
	DeploymentEnvironment string
}

// readObservability validates the telemetry configuration first, matching the
// order in which the TypeScript service loads it before anything else.
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

func positiveInt(k *koanf.Koanf, name string) (int, error) {
	raw, err := required(k, name)
	if err != nil {
		return 0, err
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil || parsed <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer", name)
	}
	return parsed, nil
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

// Load validates the runtime configuration. Rules run in the same fixed order
// as the TypeScript service so the first failing rule is the reported error.
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
	identityURL, err := hostPort(k, "IDENTITY_GRPC_URL")
	if err != nil {
		return Config{}, Telemetry{}, err
	}
	eventDeadline, err := boundedInt(k, "EVENT_GRPC_DEADLINE_MS", 100, 10000)
	if err != nil {
		return Config{}, Telemetry{}, err
	}
	identityDeadline, err := boundedInt(k, "IDENTITY_GRPC_DEADLINE_MS", 100, 10000)
	if err != nil {
		return Config{}, Telemetry{}, err
	}

	resendTimeout, err := positiveInt(k, "RESEND_REQUEST_TIMEOUT_MS")
	if err != nil {
		return Config{}, Telemetry{}, err
	}
	if resendTimeout > 20000 {
		return Config{}, Telemetry{}, fmt.Errorf("RESEND_REQUEST_TIMEOUT_MS must not exceed 20000 milliseconds")
	}

	databaseURL, err := required(k, "DATABASE_URL")
	if err != nil {
		return Config{}, Telemetry{}, err
	}

	healthPort, err := boundedInt(k, "HEALTH_PORT", 1, 65535)
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
	ticketRevokedTopic, err := name(k, "KAFKA_TICKET_REVOKED_TOPIC")
	if err != nil {
		return Config{}, Telemetry{}, err
	}

	connectTimeout, err := positiveInt(k, "RABBITMQ_CONNECT_TIMEOUT_MS")
	if err != nil {
		return Config{}, Telemetry{}, err
	}
	publishTimeout, err := positiveInt(k, "RABBITMQ_PUBLISH_TIMEOUT_MS")
	if err != nil {
		return Config{}, Telemetry{}, err
	}
	rabbitURL, err := required(k, "RABBITMQ_URL")
	if err != nil {
		return Config{}, Telemetry{}, err
	}
	parsedRabbit, err := url.Parse(rabbitURL)
	if err != nil || (parsedRabbit.Scheme != "amqp" && parsedRabbit.Scheme != "amqps") {
		return Config{}, Telemetry{}, fmt.Errorf("RABBITMQ_URL must be a valid amqp:// or amqps:// URL")
	}

	resendAPIKey, err := required(k, "RESEND_API_KEY")
	if err != nil {
		return Config{}, Telemetry{}, err
	}
	resendFrom, err := required(k, "RESEND_FROM")
	if err != nil {
		return Config{}, Telemetry{}, err
	}

	return Config{
		HealthPort:               healthPort,
		DatabaseURL:              databaseURL,
		ResendAPIKey:             resendAPIKey,
		ResendFrom:               resendFrom,
		ResendRequestTimeoutMS:   resendTimeout,
		RabbitMQURL:              rabbitURL,
		RabbitMQConnectTimeoutMS: connectTimeout,
		RabbitMQPublishTimeoutMS: publishTimeout,
		KafkaBrokers:             kafkaBrokers,
		KafkaConsumerGroup:       consumerGroup,
		KafkaTicketRevokedTopic:  ticketRevokedTopic,
		EventGRPCURL:             eventURL,
		EventGRPCDeadlineMS:      eventDeadline,
		IdentityGRPCURL:          identityURL,
		IdentityGRPCDeadlineMS:   identityDeadline,
	}, telemetry, nil
}
