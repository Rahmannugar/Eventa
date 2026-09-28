package main

import (
	"context"
	"os"

	"github.com/eventa/discovery-service/internal/config"
	"github.com/eventa/discovery-service/internal/database"
)

func main() {
	cfg, _, err := config.Load()
	if err != nil {
		panic(err)
	}

	directory := os.Getenv("MIGRATIONS_DIR")
	if directory == "" {
		directory = "migrations"
	}

	if err := database.Migrate(context.Background(), cfg.DatabaseURL, directory); err != nil {
		_, _ = os.Stderr.WriteString(err.Error() + "\n")
		os.Exit(1)
	}
}
