# syntax=docker/dockerfile:1.6
#
# Web admin: Vite 编译出静态 SPA, 用 nginx 提供 + 反代 /v1/* 到 api 容器.
# 两阶段: node 编译 → nginx serve.

FROM node:20-alpine AS builder

ARG NPM_REGISTRY=https://registry.npmjs.org/
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY} \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

WORKDIR /src

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---

FROM nginx:1.27-alpine

# 替换默认 vhost. Docker 版 nginx 把 /v1/* 反代到容器 `api:8080`,
# 而不是宿主 nginx 用的 127.0.0.1:8080.
RUN rm /etc/nginx/conf.d/default.conf
COPY deploy/nginx-docker.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /src/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
