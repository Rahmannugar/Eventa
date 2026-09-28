// Package ahnlich adapts Discovery's semantic capability to the Ahnlich AI
// proxy. Discovery sends raw text and event identity; this adapter owns the
// gRPC protocol, the model registry, deadlines, and every vendor type.
package ahnlich

import (
	"context"
	"fmt"
	"time"

	aimodel "github.com/deven96/ahnlich/sdk/ahnlich-client-go/grpc/ai/models"
	"github.com/deven96/ahnlich/sdk/ahnlich-client-go/grpc/ai/preprocess"
	aiquery "github.com/deven96/ahnlich/sdk/ahnlich-client-go/grpc/ai/query"
	"github.com/deven96/ahnlich/sdk/ahnlich-client-go/grpc/algorithm/algorithms"
	"github.com/deven96/ahnlich/sdk/ahnlich-client-go/grpc/keyval"
	aimetadata "github.com/deven96/ahnlich/sdk/ahnlich-client-go/grpc/metadata"
	"github.com/deven96/ahnlich/sdk/ahnlich-client-go/grpc/predicates"
	aisvc "github.com/deven96/ahnlich/sdk/ahnlich-client-go/grpc/services/ai_service"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"

	"github.com/eventa/discovery-service/internal/semantic"
	"github.com/eventa/discovery-service/internal/telemetry"
)

// Client owns one connection to the AI proxy for the process lifetime.
type Client struct {
	connection *grpc.ClientConn
	client     aisvc.AIServiceClient
	store      string
	model      aimodel.AIModel
	deadline   time.Duration
}

var _ semantic.Store = (*Client)(nil)

// Dial opens the proxy connection. gRPC dials lazily, so an unreachable proxy
// is reported per call instead of failing service startup.
func Dial(address, store, model string, deadlineMS int) (*Client, error) {
	parsed, err := modelFor(model)
	if err != nil {
		return nil, err
	}
	connection, err := grpc.NewClient(address, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial ahnlich ai proxy: %w", err)
	}
	return &Client{
		connection: connection,
		client:     aisvc.NewAIServiceClient(connection),
		store:      store,
		model:      parsed,
		deadline:   time.Duration(deadlineMS) * time.Millisecond,
	}, nil
}

// Close releases the connection during graceful shutdown.
func (c *Client) Close() error { return c.connection.Close() }

// EnsureStore creates the store and its event predicate. Both calls are
// idempotent, so startup can repeat them safely after a restart.
func (c *Client) EnsureStore(ctx context.Context) error {
	// Each call derives its own deadline, so the request context is never
	// replaced by an already-finished one.
	storeCtx, finish := c.call(ctx, "AIService/CreateStore")
	_, err := c.client.CreateStore(storeCtx, &aiquery.CreateStore{
		Store:         c.store,
		QueryModel:    c.model,
		IndexModel:    c.model,
		Predicates:    []string{semantic.EventAttributeKey},
		ErrorIfExists: false,
	})
	finish(err)
	if err != nil {
		return fmt.Errorf("create semantic store: %w", err)
	}

	predicateCtx, finish := c.call(ctx, "AIService/CreatePredIndex")
	_, err = c.client.CreatePredIndex(predicateCtx, &aiquery.CreatePredIndex{
		Store:      c.store,
		Predicates: []string{semantic.EventAttributeKey},
	})
	finish(err)
	if err != nil {
		return fmt.Errorf("create semantic predicate: %w", err)
	}
	return nil
}

// IndexEvent replaces whatever the store holds for this event. Entries are
// addressed by event id, so a repeat writes one row rather than a second copy.
func (c *Client) IndexEvent(ctx context.Context, eventID, text string, attributes ...semantic.Attribute) error {
	if err := c.deleteEvent(ctx, eventID); err != nil {
		return err
	}

	values := map[string]*aimetadata.MetadataValue{
		semantic.EventAttributeKey: metadataValue(eventID),
	}
	for _, attribute := range attributes {
		values[attribute.Key] = metadataValue(attribute.Value)
	}

	ctx, finish := c.call(ctx, "AIService/Set")
	_, err := c.client.Set(ctx, &aiquery.Set{
		Store: c.store,
		Inputs: []*keyval.AiStoreEntry{{
			Key:   &keyval.StoreInput{Value: &keyval.StoreInput_RawString{RawString: text}},
			Value: &keyval.StoreValue{Value: values},
		}},
		PreprocessAction: preprocess.PreprocessAction_NoPreprocessing,
	})
	finish(err)
	if err != nil {
		return fmt.Errorf("set semantic entry: %w", err)
	}
	return nil
}

// RemoveEvent drops every entry for the event. Removing an event the store has
// never seen is a success, not an error.
func (c *Client) RemoveEvent(ctx context.Context, eventID string) error {
	return c.deleteEvent(ctx, eventID)
}

// Contains reports whether the store still holds an entry for the event.
func (c *Client) Contains(ctx context.Context, eventID string) (bool, error) {
	ctx, finish := c.call(ctx, "AIService/GetPred")
	response, err := c.client.GetPred(ctx, &aiquery.GetPred{
		Store:     c.store,
		Condition: equalsEvent(eventID),
	})
	finish(err)
	if err != nil {
		return false, fmt.Errorf("get semantic entry: %w", err)
	}
	return len(response.GetEntries()) > 0, nil
}

// Search embeds the query with the store's query model and returns the closest
// events with their similarity.
func (c *Client) Search(ctx context.Context, query string, limit int) ([]semantic.Candidate, error) {
	ctx, finish := c.call(ctx, "AIService/GetSimN")
	response, err := c.client.GetSimN(ctx, &aiquery.GetSimN{
		Store:            c.store,
		SearchInput:      &keyval.StoreInput{Value: &keyval.StoreInput_RawString{RawString: query}},
		ClosestN:         uint64(limit),
		Algorithm:        algorithms.Algorithm_CosineSimilarity,
		PreprocessAction: preprocess.PreprocessAction_NoPreprocessing,
	})
	finish(err)
	if err != nil {
		return nil, fmt.Errorf("search semantic store: %w", err)
	}

	candidates := make([]semantic.Candidate, 0, len(response.GetEntries()))
	for _, entry := range response.GetEntries() {
		value := entry.GetValue()
		if value == nil {
			continue
		}
		raw, ok := value.GetValue()[semantic.EventAttributeKey]
		if !ok {
			continue
		}
		eventID := raw.GetRawString()
		if eventID == "" {
			continue
		}
		var similarity float32
		if score := entry.GetSimilarity(); score != nil {
			similarity = score.GetValue()
		}
		candidates = append(candidates, semantic.Candidate{EventID: eventID, Similarity: similarity})
	}
	return candidates, nil
}

// Ping proves the proxy answers. It is used by probes only; readiness never
// depends on it.
func (c *Client) Ping(ctx context.Context) error {
	ctx, finish := c.call(ctx, "AIService/Ping")
	_, err := c.client.Ping(ctx, &aiquery.Ping{})
	finish(err)
	if err != nil {
		return fmt.Errorf("ping ahnlich ai proxy: %w", err)
	}
	return nil
}

func (c *Client) deleteEvent(ctx context.Context, eventID string) error {
	ctx, finish := c.call(ctx, "AIService/DelPred")
	_, err := c.client.DelPred(ctx, &aiquery.DelPred{
		Store:     c.store,
		Condition: equalsEvent(eventID),
	})
	finish(err)
	if err != nil {
		return fmt.Errorf("delete semantic entry: %w", err)
	}
	return nil
}

// call opens a client span, propagates the active trace context, and bounds
// the call to the proxy deadline. The returned finish function closes the span
// with the outcome of the call and releases the deadline.
func (c *Client) call(ctx context.Context, name string) (context.Context, func(error)) {
	ctx, span := telemetry.StartSpan(ctx, name, trace.SpanKindClient,
		attribute.String("rpc.system", "grpc"),
		attribute.String("rpc.service", "AhnlichAIService"),
		attribute.String("rpc.method", name),
	)
	ctx, cancel := context.WithTimeout(ctx, c.deadline)

	headers := metadata.MD{}
	otel.GetTextMapPropagator().Inject(ctx, metadataCarrier(headers))
	outgoing := metadata.NewOutgoingContext(ctx, headers)
	return outgoing, func(err error) {
		cancel()
		telemetry.EndSpan(span, err)
	}
}

type metadataCarrier metadata.MD

func (m metadataCarrier) Get(key string) string {
	values := metadata.MD(m).Get(key)
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func (m metadataCarrier) Set(key, value string) { metadata.MD(m).Set(key, value) }

func (m metadataCarrier) Keys() []string {
	keys := make([]string, 0, len(metadata.MD(m)))
	for key := range metadata.MD(m) {
		keys = append(keys, key)
	}
	return keys
}

func equalsEvent(eventID string) *predicates.PredicateCondition {
	return &predicates.PredicateCondition{
		Kind: &predicates.PredicateCondition_Value{
			Value: &predicates.Predicate{
				Kind: &predicates.Predicate_Equals{
					Equals: &predicates.Equals{
						Key:   semantic.EventAttributeKey,
						Value: metadataValue(eventID),
					},
				},
			},
		},
	}
}

func metadataValue(value string) *aimetadata.MetadataValue {
	return &aimetadata.MetadataValue{Value: &aimetadata.MetadataValue_RawString{RawString: value}}
}

// modelFor maps the configured model name onto Ahnlich's closed model
// registry. The proxy only executes locally embedded models, so a name outside
// this table can never be served and fails at startup instead.
func modelFor(name string) (aimodel.AIModel, error) {
	switch name {
	case "bge-base-en-v1.5":
		return aimodel.AIModel_BGE_BASE_EN_V15, nil
	case "bge-large-en-v1.5":
		return aimodel.AIModel_BGE_LARGE_EN_V15, nil
	case "all-minilm-l6-v2":
		return aimodel.AIModel_ALL_MINI_LM_L6_V2, nil
	case "all-minilm-l12-v2":
		return aimodel.AIModel_ALL_MINI_LM_L12_V2, nil
	}
	return 0, fmt.Errorf("SEMANTIC_MODEL %q is not a supported text model", name)
}
