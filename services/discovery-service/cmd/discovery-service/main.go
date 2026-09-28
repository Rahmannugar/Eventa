package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/eventa/discovery-service/internal/config"
	"github.com/eventa/discovery-service/internal/database"
	"github.com/eventa/discovery-service/internal/errtype"
	"github.com/eventa/discovery-service/internal/health"
	"github.com/eventa/discovery-service/internal/index"
	"github.com/eventa/discovery-service/internal/logging"
	"github.com/eventa/discovery-service/internal/lookup"
	"github.com/eventa/discovery-service/internal/messaging/kafka"
	"github.com/eventa/discovery-service/internal/metrics"
	"github.com/eventa/discovery-service/internal/telemetry"
)

func main() {
	logger := logging.New("")

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
	if err := metrics.Init(); err != nil {
		logger.Error("metrics_init_failed", "error_type", errtype.Of(err))
	}

	pool, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Error("database_connection_failed", "error_type", "database_unavailable")
		os.Exit(1)
	}

	events, err := lookup.Dial(cfg.EventGRPCURL, cfg.EventGRPCDeadlineMS)
	if err != nil {
		logger.Error("event_service_dial_failed", "error_type", "event_service_unavailable")
		pool.Close()
		os.Exit(1)
	}

	ingest := index.NewIngest(pool, events)
	consumer := kafka.NewConsumer(
		"EventLifecycleConsumer",
		cfg.KafkaBrokers,
		cfg.KafkaEventLifecycleTopic,
		cfg.KafkaConsumerGroup,
		index.KafkaClientID,
		"event_lifecycle_consumer_failed",
		index.Operation,
		ingest.Handler(),
	)
	consumer.Start()
	logger.InfoContext(ctx, "event_lifecycle_consumer_ready",
		"operation", index.Operation,
		"topic", cfg.KafkaEventLifecycleTopic,
		"group", cfg.KafkaConsumerGroup)

	checks := health.New(database.Readiness{Pool: pool})
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health/live", checks.Live)
	mux.HandleFunc("GET /health/ready", checks.Ready)

	server := &http.Server{
		Addr:              ":" + strconv.Itoa(cfg.HealthPort),
		Handler:           health.Instrument(mux, logger),
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
	logger.InfoContext(ctx, "service_started", "health_port", cfg.HealthPort)

	<-ctx.Done()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("health_server_shutdown_failed", "error_type", "server_failure")
	}
	consumer.Stop()
	if err := events.Close(); err != nil {
		logger.Error("event_service_close_failed", "error_type", errtype.Of(err))
	}
	pool.Close()
	if err := shutdownTelemetry(shutdownCtx); err != nil {
		logger.Error("telemetry_shutdown_failed", "error_type", "telemetry_unavailable")
	}
	logger.Info("service_stopped")
}
