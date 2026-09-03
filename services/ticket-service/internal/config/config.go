package config

import (
	"fmt"
	"github.com/knadh/koanf/providers/env"
	"github.com/knadh/koanf/v2"
	"os"
	"strconv"
)

type Config struct {
	DatabaseURL            string
	HealthAddress          string
	ShutdownTimeoutSeconds int
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
	return Config{DatabaseURL: databaseURL, HealthAddress: address, ShutdownTimeoutSeconds: seconds}, nil
}

var _ = os.Getenv
