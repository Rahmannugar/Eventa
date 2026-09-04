FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN gofmt -d cmd internal && test -z "$(gofmt -d cmd internal)"
RUN go test ./...
RUN CGO_ENABLED=0 go build -ldflags='-s -w' -o /out/ticket-service ./cmd/ticket-service
RUN CGO_ENABLED=0 go build -ldflags='-s -w' -o /out/ticket-migrate ./cmd/ticket-migrate

FROM alpine:3.22
RUN addgroup -S eventa && adduser -S -G eventa eventa && apk add --no-cache wget
COPY --from=build /out/ticket-service /ticket-service
COPY --from=build /out/ticket-migrate /ticket-migrate
COPY --from=build /src/migrations /migrations
USER eventa:eventa
ENTRYPOINT ["/ticket-service"]
