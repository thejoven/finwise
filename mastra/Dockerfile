# syntax=docker/dockerfile:1.6
#
# Mastra worker. 按 SERVER.md 约定不 build, tsx 直跑.
# 因此 image 里要保留 devDependencies (tsx 在那).
# NPM_REGISTRY ARG 方便切 npmmirror.

FROM node:20-alpine

ARG NPM_REGISTRY=https://registry.npmjs.org/
ENV NODE_ENV=production \
    NPM_CONFIG_REGISTRY=${NPM_REGISTRY} \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

WORKDIR /app

# 装依赖 (含 dev, tsx 在 devDependencies).
COPY package.json package-lock.json ./
RUN npm ci --include=dev && npm cache clean --force

# 拷源码.
COPY tsconfig.json ./
COPY src ./src

# Mastra HTTP server (Editor / Diagnostician 同步路由) 监听 9091.
EXPOSE 9091

# tsx 直接跑 TS, 不需要 build 步骤.
CMD ["npx", "--no-install", "tsx", "src/index.ts"]
