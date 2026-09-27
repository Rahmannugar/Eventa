// Package resend is the concrete Resend adapter behind email.Provider.
package resend

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/eventa/notification-service/internal/email"
	"github.com/eventa/notification-service/internal/telemetry"
)

const defaultAPIURL = "https://api.resend.com/emails"

// Client sends one transactional message per call over Resend's HTTP API.
type Client struct {
	apiKey  string
	apiURL  string
	timeout time.Duration
	client  *http.Client
}

// New builds the adapter. apiURL exists so tests can point it at a stub; an
// empty value selects the production endpoint.
func New(apiKey string, timeout time.Duration, client *http.Client, apiURL string) *Client {
	if apiURL == "" {
		apiURL = defaultAPIURL
	}
	if client == nil {
		client = http.DefaultClient
	}
	return &Client{apiKey: apiKey, apiURL: apiURL, timeout: timeout, client: client}
}

// Send posts the message and returns the provider message ID.
func (c *Client) Send(ctx context.Context, request email.Request) (email.Result, error) {
	ctx, span := telemetry.StartSpan(ctx, "resend.email.send", trace.SpanKindClient,
		attribute.String("http.request.method", http.MethodPost),
		attribute.String("server.address", c.hostname()),
	)
	result, err := c.send(ctx, request)
	telemetry.EndSpan(span, err)
	return result, err
}

func (c *Client) send(ctx context.Context, request email.Request) (email.Result, error) {
	payload, err := json.Marshal(map[string]any{
		"from":    request.From,
		"html":    request.HTML,
		"subject": request.Subject,
		"text":    request.Text,
		"to":      []string{request.To},
	})
	if err != nil {
		return email.Result{}, email.NewDeliveryError(email.CodeProviderInvalidResponse, true)
	}

	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()

	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, c.apiURL, bytes.NewReader(payload))
	if err != nil {
		return email.Result{}, email.NewDeliveryError(email.CodeProviderRequestRejected, false)
	}
	httpRequest.Header.Set("Authorization", "Bearer "+c.apiKey)
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("Idempotency-Key", request.IdempotencyKey)

	response, err := c.client.Do(httpRequest)
	if err != nil {
		if ctx.Err() != nil {
			return email.Result{}, email.NewDeliveryError(email.CodeProviderTimeout, true)
		}
		return email.Result{}, email.NewDeliveryError(email.CodeProviderUnavailable, true)
	}
	defer func() { _ = response.Body.Close() }()

	body := readJSON(response.Body)

	if response.StatusCode < 200 || response.StatusCode > 299 {
		return email.Result{}, translateError(response.StatusCode, body)
	}

	messageID, ok := readMessageID(body)
	if !ok {
		return email.Result{}, email.NewDeliveryError(email.CodeProviderInvalidResponse, true)
	}
	return email.Result{MessageID: messageID}, nil
}

func readJSON(reader io.Reader) any {
	var payload any
	if err := json.NewDecoder(io.LimitReader(reader, 1<<20)).Decode(&payload); err != nil {
		return nil
	}
	return payload
}

func readMessageID(body any) (string, bool) {
	fields, ok := body.(map[string]any)
	if !ok {
		return "", false
	}
	id, ok := fields["id"].(string)
	if !ok || len(id) == 0 || len(id) > 256 {
		return "", false
	}
	return id, true
}

func providerCode(body any) string {
	fields, ok := body.(map[string]any)
	if !ok {
		return ""
	}
	name, ok := fields["name"].(string)
	if !ok {
		return ""
	}
	return name
}

func translateError(status int, body any) *email.DeliveryError {
	switch {
	case status == http.StatusConflict && providerCode(body) == "concurrent_idempotent_requests":
		return email.NewDeliveryError(email.CodeProviderIdempotencyBusy, true)
	case status == http.StatusConflict && providerCode(body) == "invalid_idempotent_request":
		return email.NewDeliveryError(email.CodeProviderIdempotencySerial, false)
	case status == http.StatusRequestTimeout:
		return email.NewDeliveryError(email.CodeProviderTimeout, true)
	case status == http.StatusTooManyRequests:
		return email.NewDeliveryError(email.CodeProviderRateLimited, true)
	case status >= 500:
		return email.NewDeliveryError(email.CodeProviderUnavailable, true)
	default:
		return email.NewDeliveryError(email.CodeProviderRequestRejected, false)
	}
}

func (c *Client) hostname() string {
	parsed, err := url.Parse(c.apiURL)
	if err != nil {
		return ""
	}
	return parsed.Hostname()
}
