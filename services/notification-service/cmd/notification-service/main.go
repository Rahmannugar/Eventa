package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/eventa/notification-service/internal/config"
	"github.com/eventa/notification-service/internal/database"
	"github.com/eventa/notification-service/internal/health"
	"github.com/eventa/notification-service/internal/telemetry"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil)).With("service", "eventa-notification-service")

	cfg, telemetryCfg, err := config.Load()
	if err != nil {
		logger.Error("configuration_invalid", "error_type", "invalid_configuration")
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	shutdownTelemetry, err := telemetry.Start(ctx, telemetryCfg.Endpoint, telemetryCfg.DeploymentEnvironment)
	if err != nil {
		logger.Error("telemetry_start_failed", "error_type", "telemetry_unavailable")
		os.Exit(1)
	}

	pool, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Error("database_connection_failed", "error_type", "database_unavailable")
		os.Exit(1)
	}

	checks := health.New(database.Readiness{Pool: pool})
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health/live", checks.Live)
	mux.HandleFunc("GET /health/ready", checks.Ready)

	server := &http.Server{
		Addr:              ":" + strconv.Itoa(cfg.HealthPort),
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	go func() {
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("health_server_failed", "error_type", "server_failure")
			stop()
		}
	}()
	logger.Info("service_started", "health_port", cfg.HealthPort)

	<-ctx.Done()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("health_server_shutdown_failed", "error_type", "server_failure")
	}
	pool.Close()
	if err := shutdownTelemetry(shutdownCtx); err != nil {
		logger.Error("telemetry_shutdown_failed", "error_type", "telemetry_unavailable")
	}
	logger.Info("service_stopped")
}
