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

	"google.golang.org/grpc"

	"github.com/eventa/analytics-service/internal/config"
	"github.com/eventa/analytics-service/internal/database"
	"github.com/eventa/analytics-service/internal/errtype"
	"github.com/eventa/analytics-service/internal/health"
	"github.com/eventa/analytics-service/internal/logging"
	"github.com/eventa/analytics-service/internal/messaging/kafka"
	"github.com/eventa/analytics-service/internal/metrics"
	"github.com/eventa/analytics-service/internal/performance"
	"github.com/eventa/analytics-service/internal/reporting"
	"github.com/eventa/analytics-service/internal/server"
	"github.com/eventa/analytics-service/internal/telemetry"
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

	ingest := performance.NewIngest(pool)

	commerceConsumer := kafka.NewConsumer(
		"AnalyticsCommerceConsumer",
		cfg.KafkaBrokers,
		cfg.KafkaCommerceTopic,
		cfg.KafkaCommerceGroup,
		performance.KafkaCommerceClientID,
		"analytics_consumer_failed",
		performance.Operation,
		ingest.Handler(),
	)
	commerceConsumer.Start()
	logger.InfoContext(ctx, "analytics_consumer_ready",
		"operation", performance.Operation,
		"topic", cfg.KafkaCommerceTopic,
		"group", cfg.KafkaCommerceGroup)

	checkInConsumer := kafka.NewConsumer(
		"AnalyticsCheckInConsumer",
		cfg.KafkaBrokers,
		cfg.KafkaCheckInTopic,
		cfg.KafkaCheckInGroup,
		performance.KafkaCheckInClientID,
		"analytics_consumer_failed",
		performance.Operation,
		ingest.Handler(),
	)
	checkInConsumer.Start()
	logger.InfoContext(ctx, "analytics_consumer_ready",
		"operation", performance.Operation,
		"topic", cfg.KafkaCheckInTopic,
		"group", cfg.KafkaCheckInGroup)

	revokedConsumer := kafka.NewConsumer(
		"AnalyticsRevokedConsumer",
		cfg.KafkaBrokers,
		cfg.KafkaRevokedTopic,
		cfg.KafkaRevokedGroup,
		performance.KafkaRevokedClientID,
		"analytics_consumer_failed",
		performance.Operation,
		ingest.Handler(),
	)
	revokedConsumer.Start()
	logger.InfoContext(ctx, "analytics_consumer_ready",
		"operation", performance.Operation,
		"topic", cfg.KafkaRevokedTopic,
		"group", cfg.KafkaRevokedGroup)

	lifecycleConsumer := kafka.NewConsumer(
		"AnalyticsLifecycleConsumer",
		cfg.KafkaBrokers,
		cfg.KafkaEventLifecycleTopic,
		cfg.KafkaLifecycleGroup,
		performance.KafkaLifecycleClientID,
		"analytics_consumer_failed",
		performance.Operation,
		ingest.Handler(),
	)
	lifecycleConsumer.Start()
	logger.InfoContext(ctx, "analytics_consumer_ready",
		"operation", performance.Operation,
		"topic", cfg.KafkaEventLifecycleTopic,
		"group", cfg.KafkaLifecycleGroup)

	checks := health.New(database.Readiness{Pool: pool})
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health/live", checks.Live)
	mux.HandleFunc("GET /health/ready", checks.Ready)

	healthServer := &http.Server{
		Addr:              ":" + strconv.Itoa(cfg.HealthPort),
		Handler:           health.Instrument(mux, logger),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	go func() {
		if serveErr := healthServer.ListenAndServe(); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			logger.Error("health_server_failed", "error_type", "server_failure")
			stop()
		}
	}()
	logger.InfoContext(ctx, "service_started", "health_port", cfg.HealthPort)

	queryAPI, grpcListener, err := server.New(
		reporting.NewHandler(reporting.NewRepository(pool), logger),
		logger, cfg.GRPCPort,
	)
	if err != nil {
		logger.Error("grpc_server_start_failed", "error_type", errtype.Of(err))
		pool.Close()
		os.Exit(1)
	}
	go func() {
		if serveErr := queryAPI.Serve(grpcListener); serveErr != nil && !errors.Is(serveErr, grpc.ErrServerStopped) {
			logger.Error("grpc_server_failed", "error_type", "server_failure")
			stop()
		}
	}()
	logger.InfoContext(ctx, "grpc_server_started", "grpc_port", cfg.GRPCPort)

	<-ctx.Done()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := healthServer.Shutdown(shutdownCtx); err != nil {
		logger.Error("health_server_shutdown_failed", "error_type", "server_failure")
	}
	grpcStopped := make(chan struct{})
	go func() {
		queryAPI.GracefulStop()
		close(grpcStopped)
	}()
	select {
	case <-grpcStopped:
	case <-shutdownCtx.Done():
		queryAPI.Stop()
	}
	commerceConsumer.Stop()
	checkInConsumer.Stop()
	revokedConsumer.Stop()
	lifecycleConsumer.Stop()
	pool.Close()
	if err := shutdownTelemetry(shutdownCtx); err != nil {
		logger.Error("telemetry_shutdown_failed", "error_type", "telemetry_unavailable")
	}
	logger.Info("service_stopped")
}
