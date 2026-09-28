// Command discovery-reindex rebuilds the derived semantic store from the
// Discovery-owned projection. It is the recovery path for a store that lost
// data without reporting an error, and it is safe to run repeatedly: every
// event converges to one entry and already-converged events are rewritten
// rather than duplicated.
package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/eventa/discovery-service/internal/config"
	"github.com/eventa/discovery-service/internal/database"
	"github.com/eventa/discovery-service/internal/errtype"
	"github.com/eventa/discovery-service/internal/logging"
	"github.com/eventa/discovery-service/internal/metrics"
	"github.com/eventa/discovery-service/internal/semantic"
	"github.com/eventa/discovery-service/internal/semantic/ahnlich"
	"github.com/eventa/discovery-service/internal/telemetry"
)

const batch = 100

const maxPasses = 50

func main() {
	logger := logging.New("SemanticReindex")

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
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := shutdownTelemetry(shutdownCtx); err != nil {
			logger.Error("telemetry_shutdown_failed", "error_type", "telemetry_unavailable")
		}
	}()
	if err := metrics.Init(); err != nil {
		logger.Error("metrics_init_failed", "error_type", errtype.Of(err))
	}

	pool, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Error("database_connection_failed", "error_type", "database_unavailable")
		os.Exit(1)
	}
	defer pool.Close()

	store, err := ahnlich.Dial(cfg.AhnlichAIURL, cfg.SemanticStore, cfg.SemanticModel, cfg.AhnlichDeadlineMS)
	if err != nil {
		logger.Error("semantic_configuration_invalid", "error_type", "invalid_configuration")
		os.Exit(1)
	}
	defer func() { _ = store.Close() }()

	if err := store.EnsureStore(ctx); err != nil {
		logger.Error("semantic_store_unavailable", "error_type", semantic.ErrorClass(err))
		os.Exit(1)
	}

	repository := semantic.NewRepository(pool)
	indexer := semantic.NewIndexer(repository, store)

	counts := struct{ indexed, removed, failed int }{}

	// Every searchable event is rewritten, so a store holding stale text is
	// corrected as well as one holding nothing.
	for offset := 0; ; offset += batch {
		ids, err := repository.ListPublishedIDs(ctx, offset, batch)
		if err != nil {
			logger.Error("reindex_listing_failed", "error_type", semantic.ErrorClass(err))
			os.Exit(1)
		}
		if len(ids) == 0 {
			break
		}
		for _, eventID := range ids {
			if err := indexer.Resync(ctx, eventID); err != nil {
				counts.failed++
				logger.Warn("reindex_event_failed",
					"operation", semantic.Operation, "event_id", eventID,
					"error_type", semantic.ErrorClass(err))
				continue
			}
			counts.indexed++
		}
	}

	// Converge everything else the projection disagrees about: cancellations
	// and tombstones whose entry must be gone from the store.
	for pass := 0; pass < maxPasses; pass++ {
		work, err := repository.ListWork(ctx, batch)
		if err != nil {
			logger.Error("reindex_work_failed", "error_type", semantic.ErrorClass(err))
			os.Exit(1)
		}
		if len(work) == 0 {
			break
		}
		progressed := false
		for _, item := range work {
			if err := indexer.Sync(ctx, item.EventID); err != nil {
				counts.failed++
				logger.Warn("reindex_event_failed",
					"operation", semantic.Operation, "event_id", item.EventID,
					"error_type", semantic.ErrorClass(err))
				continue
			}
			progressed = true
			if item.Desired == "remove" {
				counts.removed++
			} else {
				counts.indexed++
			}
		}
		if !progressed {
			break
		}
	}

	pending, err := repository.PendingCount(ctx)
	if err != nil {
		logger.Error("pending_count_failed", "error_type", semantic.ErrorClass(err))
		os.Exit(1)
	}
	metrics.SetSemanticPending(pending)

	logger.Info("reindex_completed",
		"operation", semantic.Operation,
		"indexed", counts.indexed, "removed", counts.removed,
		"failed", counts.failed, "pending", pending)

	if counts.failed > 0 || pending > 0 {
		os.Exit(1)
	}
}
