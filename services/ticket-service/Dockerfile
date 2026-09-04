FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN gofmt -d cmd internal && test -z "$(gofmt -d cmd internal)"
RUN go test ./...
RUN CGO_ENABLED=0 go build -ldflags='-s -w' -o /out/ticket-service ./cmd/ticket-service

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/ticket-service /ticket-service
USER nonroot:nonroot
ENTRYPOINT ["/ticket-service"]
