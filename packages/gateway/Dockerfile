FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy source
COPY src/ ./src/

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD curl -f http://localhost:3100/health || exit 1

EXPOSE 3100

# SQLite data directory
VOLUME ["/app/data"]
ENV DATABASE_PATH=/app/data/gateway.db

CMD ["bun", "run", "src/index.ts"]
