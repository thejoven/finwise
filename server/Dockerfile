# syntax=docker/dockerfile:1.6
#
# 多阶段 Go 构建. 产物是一个静态可执行文件 (CGO=0), 跑在 alpine 上.
# 走 GOPROXY ARG 方便在墙内构建.

FROM golang:1.24-alpine AS builder

ARG GOPROXY=https://proxy.golang.org,direct
ENV CGO_ENABLED=0 \
    GOFLAGS=-mod=readonly \
    GOPROXY=${GOPROXY}

WORKDIR /src

# 先拉依赖, 用 layer cache 加速后续构建.
COPY go.mod go.sum ./
RUN go mod download

# 拷源码 + 构建.
COPY . .
RUN go build -trimpath -ldflags="-s -w" -o /out/flashfi-api ./cmd/api

# ---

FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata wget && \
    addgroup -S app && adduser -S -G app app

WORKDIR /app
COPY --from=builder /out/flashfi-api /app/flashfi-api

USER app
EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1

ENTRYPOINT ["/app/flashfi-api"]
