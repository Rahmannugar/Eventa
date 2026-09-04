package config

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/knadh/koanf/providers/env"
	"github.com/knadh/koanf/v2"
)

type Config struct {
	DatabaseURL            string
	HealthAddress          string
	ShutdownTimeoutSeconds int
	KafkaBrokers           []string
	KafkaTopic             string
	KafkaGroupID           string
}

func Load() (Config, error) {
	k := koanf.New("_")
	if err := k.Load(env.Provider("", "_", func(s string) string { return s }), nil); err != nil {
		return Config{}, err
	}
	databaseURL := k.String("DATABASE_URL")
	if databaseURL == "" {
		return Config{}, fmt.Errorf("DATABASE_URL is required")
	}
	address := k.String("HEALTH_ADDRESS")
	if address == "" {
		address = ":3010"
	}
	seconds := 10
	if raw := k.String("SHUTDOWN_TIMEOUT_SECONDS"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 120 {
			return Config{}, fmt.Errorf("SHUTDOWN_TIMEOUT_SECONDS must be 1..120")
		}
		seconds = parsed
	}
	brokers := splitRequired(k.String("KAFKA_BROKERS"))
	if len(brokers) == 0 {
		return Config{}, fmt.Errorf("KAFKA_BROKERS is required")
	}
	topic := k.String("KAFKA_TOPIC")
	if topic == "" {
		topic = "eventa.commerce.order.v1"
	}
	group := k.String("KAFKA_GROUP_ID")
	if group == "" {
		group = "eventa-ticket-service"
	}
	return Config{DatabaseURL: databaseURL, HealthAddress: address, ShutdownTimeoutSeconds: seconds, KafkaBrokers: brokers, KafkaTopic: topic, KafkaGroupID: group}, nil
}

func splitRequired(value string) []string {
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}
