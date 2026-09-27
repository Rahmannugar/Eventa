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

	"github.com/eventa/notification-service/internal/auth"
	"github.com/eventa/notification-service/internal/cancellation"
	"github.com/eventa/notification-service/internal/config"
	"github.com/eventa/notification-service/internal/database"
	"github.com/eventa/notification-service/internal/email/resend"
	"github.com/eventa/notification-service/internal/errtype"
	"github.com/eventa/notification-service/internal/health"
	"github.com/eventa/notification-service/internal/logging"
	"github.com/eventa/notification-service/internal/lookup"
	"github.com/eventa/notification-service/internal/messaging/kafka"
	"github.com/eventa/notification-service/internal/messaging/rabbitmq"
	"github.com/eventa/notification-service/internal/metrics"
	"github.com/eventa/notification-service/internal/telemetry"
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
		logger.Error("job_metrics_init_failed", "error_type", errtype.Of(err))
	}

	pool, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Error("database_connection_failed", "error_type", "database_unavailable")
		os.Exit(1)
	}

	clients := rabbitmq.New(
		cfg.RabbitMQURL,
		time.Duration(cfg.RabbitMQConnectTimeoutMS)*time.Millisecond,
		logging.New("RabbitMQClient"),
	)
	if err := clients.Connect(); err != nil {
		logger.Error("rabbitmq_connection_failed", "error_type", errtype.Of(err))
		pool.Close()
		os.Exit(1)
	}

	emails := resend.New(
		cfg.ResendAPIKey,
		time.Duration(cfg.ResendRequestTimeoutMS)*time.Millisecond,
		nil,
		"",
	)
	deliveries := auth.NewRepository(pool)

	publishTimeout := time.Duration(cfg.RabbitMQPublishTimeoutMS) * time.Millisecond
	consumers := make([]*auth.Consumer, 0, 4)
	for _, definition := range auth.Definitions() {
		delivery := auth.NewDelivery(definition, deliveries, emails, cfg.ResendFrom)
		consumers = append(consumers, auth.NewConsumer(definition, clients, delivery, publishTimeout))
	}
	for _, consumer := range consumers {
		if err := consumer.Start(); err != nil {
			logger.Error("auth_consumer_start_failed", "error_type", errtype.Of(err))
			stopConsumers(consumers)
			clients.Close()
			pool.Close()
			os.Exit(1)
		}
	}

	if err := cancellation.StartQueueTopology(clients); err != nil {
		logger.Error("cancellation_topology_start_failed", "error_type", errtype.Of(err))
		stopConsumers(consumers)
		clients.Close()
		pool.Close()
		os.Exit(1)
	}

	lookups, err := lookup.Dial(
		cfg.IdentityGRPCURL, cfg.IdentityGRPCDeadlineMS,
		cfg.EventGRPCURL, cfg.EventGRPCDeadlineMS,
	)
	if err != nil {
		logger.Error("grpc_client_start_failed", "error_type", errtype.Of(err))
		stopConsumers(consumers)
		clients.Close()
		pool.Close()
		os.Exit(1)
	}

	cancelRepository := cancellation.NewRepository(pool)
	cancelDelivery := cancellation.NewDelivery(cancelRepository, lookups, lookups, emails, cfg.ResendFrom)
	jobConsumer := cancellation.NewJobConsumer(clients, cancelDelivery, publishTimeout)
	if err := jobConsumer.Start(); err != nil {
		logger.Error("cancellation_consumer_start_failed", "error_type", errtype.Of(err))
		stopConsumers(consumers)
		_ = lookups.Close()
		clients.Close()
		pool.Close()
		os.Exit(1)
	}

	factConsumer := kafka.NewConsumer(
		cancellation.FactConsumerContext,
		cfg.KafkaBrokers,
		cfg.KafkaTicketRevokedTopic,
		cfg.KafkaConsumerGroup,
		cancellation.KafkaClientID,
		"ticket_revocation_consumer_failed",
		cancellation.Operation,
		cancellation.NewFactHandler(cancellation.NewIngest(cancelRepository), cfg.KafkaTicketRevokedTopic).Handle,
	)
	factConsumer.Start()

	checks := health.New(database.Readiness{Pool: pool}, rabbitmq.Readiness{Client: clients})
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
	logger.Info("service_started", "health_port", cfg.HealthPort)

	<-ctx.Done()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("health_server_shutdown_failed", "error_type", "server_failure")
	}
	factConsumer.Stop()
	jobConsumer.Stop()
	stopConsumers(consumers)
	_ = lookups.Close()
	clients.Close()
	pool.Close()
	if err := shutdownTelemetry(shutdownCtx); err != nil {
		logger.Error("telemetry_shutdown_failed", "error_type", "telemetry_unavailable")
	}
	logger.Info("service_stopped")
}

func stopConsumers(consumers []*auth.Consumer) {
	for _, consumer := range consumers {
		consumer.Stop()
	}
}
