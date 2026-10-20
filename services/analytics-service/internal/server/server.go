// Package server exposes Analytics's reporting API over gRPC and owns the
// interceptors that trace, measure, and log every RPC it serves.
package server

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	analyticsv1 "github.com/eventa/analytics-service/internal/gen/eventa/analytics/v1"
	"github.com/eventa/analytics-service/internal/metrics"
	"github.com/eventa/analytics-service/internal/reporting"
	"github.com/eventa/analytics-service/internal/telemetry"
)

// requestIDPattern is the header value @eventa/observability accepts before it
// falls back to a generated identifier.
var requestIDPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,128}$`)

// New binds the reporting handler to a listener on the configured port. The
// caller serves and stops the server, so shutdown stays with the process.
func New(reportingHandler *reporting.Handler, logger *slog.Logger, port int) (*grpc.Server, net.Listener, error) {
	listener, err := net.Listen("tcp", ":"+strconv.Itoa(port))
	if err != nil {
		return nil, nil, fmt.Errorf("listen on gRPC port: %w", err)
	}

	instance := grpc.NewServer(grpc.ChainUnaryInterceptor(
		unaryTrace(),
		unaryObserve(logger),
		unaryRecover(logger),
	))
	analyticsv1.RegisterAnalyticsServiceServer(instance, &service{
		reporting: reportingHandler,
	})
	return instance, listener, nil
}

// service routes each RPC to the handler that owns that capability, so the
// reporting queries keep their own package and tests behind one deployed API.
type service struct {
	analyticsv1.UnimplementedAnalyticsServiceServer
	reporting *reporting.Handler
}

func (s *service) ListEventPerformance(ctx context.Context, request *analyticsv1.ListEventPerformanceRequest) (*analyticsv1.ListEventPerformanceResponse, error) {
	return s.reporting.ListEventPerformance(ctx, request)
}

func (s *service) GetEventPerformance(ctx context.Context, request *analyticsv1.GetEventPerformanceRequest) (*analyticsv1.GetEventPerformanceResponse, error) {
	return s.reporting.GetEventPerformance(ctx, request)
}

func (s *service) GetPortfolioSummary(ctx context.Context, request *analyticsv1.GetPortfolioSummaryRequest) (*analyticsv1.GetPortfolioSummaryResponse, error) {
	return s.reporting.GetPortfolioSummary(ctx, request)
}

// unaryTrace continues the caller's trace, starts the server span, and
// records the RPC outcome, so an RPC issued by the Gateway lands in the same
// trace as Analytics's work.
func unaryTrace() grpc.UnaryServerInterceptor {
	return func(ctx context.Context, request any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		ctx = otel.GetTextMapPropagator().Extract(ctx, incomingCarrier(ctx))
		ctx, span := telemetry.StartSpan(ctx, info.FullMethod, trace.SpanKindServer,
			attribute.String("rpc.system", "grpc"),
			attribute.String("rpc.service", rpcService(info.FullMethod)),
			attribute.String("rpc.method", rpcMethod(info.FullMethod)),
		)
		response, err := handler(ctx, request)
		telemetry.EndSpan(span, err)
		return response, err
	}
}

// unaryObserve records one completed RPC as request metrics and one log line.
// The HTTP status class is derived from the gRPC code so the outcome rules
// stay identical to the ones the TypeScript middleware applies.
func unaryObserve(logger *slog.Logger) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, request any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		started := time.Now()
		response, err := handler(ctx, request)
		elapsed := time.Since(started)

		grpcCode := status.Code(err)
		statusCode := httpStatusFor(grpcCode)
		outcome := metrics.RequestOutcome(statusCode)
		metrics.RecordRequest(elapsed, operationFor(info.FullMethod), outcome, statusCode, "grpc")
		logger.InfoContext(ctx, "grpc_request_completed",
			"duration_ms", milliseconds(elapsed),
			"grpc_code", grpcCode.String(),
			"operation", operationFor(info.FullMethod),
			"outcome", outcome,
			"request_id", requestID(ctx),
			"status_code", statusCode,
			"transport", "grpc",
		)
		return response, err
	}
}

// unaryRecover keeps a panic inside one handler from taking the process down
// and reports it as an internal failure of that single RPC.
func unaryRecover(logger *slog.Logger) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, request any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (response any, err error) {
		defer func() {
			if recovered := recover(); recovered != nil {
				logger.ErrorContext(ctx, "grpc_panic_recovered",
					"error_type", fmt.Sprintf("%T", recovered),
					"operation", operationFor(info.FullMethod),
					"outcome", "server_error",
				)
				response, err = nil, status.Error(codes.Internal, "internal error")
			}
		}()
		return handler(ctx, request)
	}
}

func operationFor(fullMethod string) string {
	service, method := rpcService(fullMethod), rpcMethod(fullMethod)
	if service == "" {
		return fullMethod
	}
	return service + "/" + method
}

func incomingCarrier(ctx context.Context) metadataCarrier {
	if incoming, ok := metadata.FromIncomingContext(ctx); ok {
		return metadataCarrier(incoming)
	}
	return metadataCarrier(metadata.MD{})
}

func rpcService(fullMethod string) string {
	trimmed := strings.TrimPrefix(fullMethod, "/")
	if separator := strings.Index(trimmed, "/"); separator >= 0 {
		return trimmed[:separator]
	}
	return ""
}

func rpcMethod(fullMethod string) string {
	if separator := strings.LastIndex(fullMethod, "/"); separator >= 0 {
		return fullMethod[separator+1:]
	}
	return fullMethod
}

// httpStatusFor maps a gRPC code onto the HTTP class the outcome rules and
// the dashboards are built on.
func httpStatusFor(code codes.Code) int {
	switch code {
	case codes.OK:
		return 200
	case codes.InvalidArgument, codes.AlreadyExists, codes.Aborted, codes.OutOfRange:
		return 400
	case codes.NotFound:
		return 404
	case codes.Unauthenticated:
		return 401
	case codes.PermissionDenied:
		return 403
	case codes.ResourceExhausted:
		return 429
	case codes.Unimplemented:
		return 501
	case codes.Unavailable:
		return 503
	case codes.DeadlineExceeded:
		return 504
	default:
		return 500
	}
}

func requestID(ctx context.Context) string {
	if incoming, ok := metadata.FromIncomingContext(ctx); ok {
		if values := incoming.Get("x-request-id"); len(values) > 0 && requestIDPattern.MatchString(values[0]) {
			return values[0]
		}
	}
	return uuid.NewString()
}

func milliseconds(elapsed time.Duration) float64 {
	return float64(elapsed.Microseconds()) / 1000
}

// metadataCarrier reads propagated trace context out of gRPC metadata.
type metadataCarrier metadata.MD

func (c metadataCarrier) Get(key string) string {
	if values := metadata.MD(c).Get(key); len(values) > 0 {
		return values[0]
	}
	return ""
}

func (c metadataCarrier) Set(key, value string) { metadata.MD(c).Set(key, value) }

func (c metadataCarrier) Keys() []string {
	keys := make([]string, 0, len(metadata.MD(c)))
	for key := range metadata.MD(c) {
		keys = append(keys, key)
	}
	return keys
}
