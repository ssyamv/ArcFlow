FROM oven/bun:1 AS base
WORKDIR /app

# Git + SSH for git service (clone/push via SSH)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git openssh-client ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package.json bun.lock* ./
RUN bun install --production --frozen-lockfile || bun install --production

# Copy source
COPY src/ ./src/

# Health check (bun image has no curl)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD bun -e "fetch('http://localhost:3100/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

EXPOSE 3100

# SQLite data directory + Git work directory
VOLUME ["/app/data", "/app/git-repos"]
ENV DATABASE_PATH=/app/data/gateway.db
ENV GIT_WORK_DIR=/app/git-repos

# SSH key mount point (mount at runtime: -v ~/.ssh:/root/.ssh:ro)
RUN mkdir -p /root/.ssh && chmod 700 /root/.ssh

CMD ["bun", "run", "src/index.ts"]
