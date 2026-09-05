package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/eventa/ticket-service/internal/config"
	"github.com/eventa/ticket-service/internal/database"
	"github.com/eventa/ticket-service/internal/health"
	"github.com/eventa/ticket-service/internal/issuance"
	"github.com/eventa/ticket-service/internal/messaging"
	"github.com/eventa/ticket-service/internal/tickets"
	"github.com/gin-gonic/gin"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg, err := config.Load()
	if err != nil {
		logger.Error("configuration_invalid", "error_type", "invalid_configuration")
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pool, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Error("database_connection_failed", "error_type", "database_unavailable")
		os.Exit(1)
	}
	defer pool.Close()

	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(gin.Recovery())
	checks := health.New(pool)
	issuanceService := issuance.NewIssuanceService(pool)
	ticketReader := tickets.NewTicketReader(pool)
	ticketHandler := tickets.NewHandler(ticketReader)
	consumer := messaging.NewOrderPaidConsumer(cfg.KafkaBrokers, cfg.KafkaTopic, cfg.KafkaGroupID, issuanceService)
	go consumer.Run(ctx, func(err error) {
		logger.Error("paid_order_consumption_failed", "error_type", "message_processing_failed")
	})
	defer consumer.Close()
	router.GET("/health/live", func(c *gin.Context) { c.Status(http.StatusNoContent) })
	router.GET("/health/ready", checks.Ready)
	router.GET("/v1/attendees/:attendeeId/tickets", ticketHandler.List)

	server := &http.Server{Addr: cfg.HealthAddress, Handler: router, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second}
	go func() {
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("health_server_failed", "error_type", "server_failure")
			stop()
		}
	}()
	<-ctx.Done()
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = server.Shutdown(shutdown)
}
