// Package logging emits the Eventa log envelope: a flat JSON object carrying
// the business `event` name plus level, service, timestamp, emitting context,
// and the active trace id. Errors go to stderr; everything else goes to stdout.
package logging

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"time"

	"go.opentelemetry.io/otel/trace"
)

// ServiceName is the constant service field of every record.
const ServiceName = "eventa-discovery-service"

type handler struct {
	contextName string
}

// New returns a logger whose records carry the given emitting context, such as
// the consumer class name. The message of each call becomes the record's
// `event` field.
func New(contextName string) *slog.Logger {
	return slog.New(&handler{contextName: contextName})
}

func (h *handler) Enabled(context.Context, slog.Level) bool { return true }

func (h *handler) Handle(ctx context.Context, r slog.Record) error {
	record := make(map[string]any, r.NumAttrs()+5)
	r.Attrs(func(a slog.Attr) bool {
		flatten(record, a.Key, a.Value)
		return true
	})
	if r.Message != "" {
		record["event"] = r.Message
	}
	record["level"] = levelName(r.Level)
	record["service"] = ServiceName
	record["timestamp"] = time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	if h.contextName != "" {
		record["context"] = h.contextName
	}
	if spanContext := trace.SpanContextFromContext(ctx); spanContext.HasTraceID() {
		record["trace_id"] = spanContext.TraceID().String()
	}

	payload, err := json.Marshal(record)
	if err != nil {
		return err
	}

	var destination io.Writer = os.Stdout
	if r.Level == slog.LevelError {
		destination = os.Stderr
	}
	_, err = destination.Write(append(payload, '\n'))
	return err
}

func (h *handler) WithAttrs(attrs []slog.Attr) slog.Handler {
	if len(attrs) == 0 {
		return h
	}
	next := *h
	next.contextName = h.contextName
	return &withAttrs{handler: &next, attrs: attrs}
}

func (h *handler) WithGroup(string) slog.Handler { return h }

func flatten(record map[string]any, key string, value slog.Value) {
	value = value.Resolve()
	if value.Kind() == slog.KindGroup {
		for _, attr := range value.Group() {
			flatten(record, key+"."+attr.Key, attr.Value)
		}
		return
	}
	record[key] = value.Any()
}

func levelName(level slog.Level) string {
	switch {
	case level >= slog.LevelError:
		return "error"
	case level >= slog.LevelWarn:
		return "warn"
	case level >= slog.LevelInfo:
		return "info"
	default:
		return "debug"
	}
}

type withAttrs struct {
	*handler
	attrs []slog.Attr
}

func (h *withAttrs) Handle(ctx context.Context, r slog.Record) error {
	for _, attr := range h.attrs {
		r.AddAttrs(attr)
	}
	return h.handler.Handle(ctx, r)
}

func (h *withAttrs) WithAttrs(attrs []slog.Attr) slog.Handler {
	if len(attrs) == 0 {
		return h
	}
	return &withAttrs{handler: h.handler, attrs: append(append([]slog.Attr{}, h.attrs...), attrs...)}
}
