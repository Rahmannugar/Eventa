FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
RUN go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.6.2
COPY . .
RUN gofmt -d cmd internal test && test -z "$(gofmt -d cmd internal test)"
RUN /go/bin/golangci-lint run --timeout=20m ./...
RUN go vet ./...
RUN go test -short ./...
RUN CGO_ENABLED=0 go build -ldflags='-s -w' -o /out/analytics-service ./cmd/analytics-service
RUN CGO_ENABLED=0 go build -ldflags='-s -w' -o /out/analytics-migration ./cmd/analytics-migration

FROM alpine:3.22
RUN addgroup -S eventa && adduser -S -G eventa eventa && apk add --no-cache wget
COPY --from=build /out/analytics-service /analytics-service
COPY --from=build /out/analytics-migration /analytics-migration
COPY --from=build /src/migrations /migrations
USER eventa:eventa
ENTRYPOINT ["/analytics-service"]
