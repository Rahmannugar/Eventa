FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN gofmt -d cmd internal test && test -z "$(gofmt -d cmd internal test)"
RUN go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.6.2
RUN /go/bin/golangci-lint run ./...
RUN go vet ./...
RUN go test -short ./...
RUN CGO_ENABLED=0 go build -ldflags='-s -w' -o /out/ticket-service ./cmd/ticket-service
RUN CGO_ENABLED=0 go build -ldflags='-s -w' -o /out/ticket-migration ./cmd/ticket-migration
RUN CGO_ENABLED=0 go build -ldflags='-s -w' -o /out/ticket-query-plans ./cmd/ticket-query-plans

FROM alpine:3.22
RUN addgroup -S eventa && adduser -S -G eventa eventa && apk add --no-cache wget
COPY --from=build /out/ticket-service /ticket-service
COPY --from=build /out/ticket-migration /ticket-migration
COPY --from=build /src/migrations /migrations
USER eventa:eventa
ENTRYPOINT ["/ticket-service"]
