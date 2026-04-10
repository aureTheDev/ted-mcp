FROM node:22-slim AS builder

WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm install
COPY src/ ./src/
RUN npm run build

# ---- runtime image ----
FROM node:22-slim AS runtime

LABEL org.opencontainers.image.title="ted-mcp"
LABEL org.opencontainers.image.description="MCP server for the TED Europa API (Tenders Electronic Daily)"
LABEL org.opencontainers.image.source="https://docs.ted.europa.eu/api/latest/index.html"

WORKDIR /app
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
RUN npm prune --omit=dev
COPY --from=builder /app/dist ./dist

ENTRYPOINT ["node", "dist/index.js"]

# ── Bundle stage — produces ted-mcp.mcpb ─────────────────────────────────────
# Usage: docker build --output . .
FROM runtime AS bundle

RUN apt-get update && apt-get install -y zip && rm -rf /var/lib/apt/lists/*

WORKDIR /bundle

# Copy compiled code and production deps from runtime
RUN cp -r /app/dist . && cp -r /app/node_modules .

# Copy static assets
COPY manifest.json ./
COPY Dockerfile ./
COPY icon.png ./

RUN zip -r /ted-mcp.mcpb . \
      --exclude "*.map" \
      --exclude "node_modules/.cache/*"

# Export only the archive so `--output .` drops it at the project root
FROM scratch AS export
COPY --from=bundle /ted-mcp.mcpb /ted-mcp.mcpb
