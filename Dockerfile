# LDL Workspace — bản chạy trên máy chủ riêng của công ty (Node.js + SQLite + thư mục tệp)
# Build:  docker build -t ldl-workspace .
# Chạy:   docker compose up -d        (xem docker-compose.yml và SERVER.md)

# ---------- 1. Build giao diện React
FROM node:22-bookworm-slim AS client
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY client/ ./
RUN npm run build

# ---------- 2. Thư viện server (chỉ phần chạy, không có wrangler)
FROM node:22-bookworm-slim AS server-deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---------- 3. Ảnh chạy
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=4000 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    TZ=Asia/Ho_Chi_Minh
WORKDIR /app/server
COPY --from=server-deps /app/server/node_modules ./node_modules
COPY server/package.json ./
COPY server/src ./src
COPY server/migrations ./migrations
COPY server/scripts/backup.mjs ./scripts/backup.mjs
COPY --from=client /app/client/dist /app/client/dist
COPY deploy/docker-entrypoint.sh /usr/local/bin/ldl-entrypoint
RUN chmod +x /usr/local/bin/ldl-entrypoint && mkdir -p /data
VOLUME ["/data"]
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["ldl-entrypoint"]
CMD ["node", "--no-warnings=ExperimentalWarning", "src/node.js"]
