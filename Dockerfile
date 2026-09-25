FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/lenguaraz ./cmd/lenguaraz \
 && mkdir -p /out/data

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=build /out/lenguaraz /app/lenguaraz
COPY --from=build --chown=65532:65532 /out/data /data
COPY rooms.yaml /app/rooms.yaml
COPY samples/*.wav /app/samples/
EXPOSE 8080
ENTRYPOINT ["/app/lenguaraz", "-config", "/app/rooms.yaml", "-data", "/data"]
