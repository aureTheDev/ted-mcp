FROM node:22-slim AS builder

WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm install
COPY src/ ./src/
RUN npm run build

# ---- runtime image ----
FROM node:22-slim

LABEL org.opencontainers.image.title="ted-mcp"
LABEL org.opencontainers.image.description="MCP server for the TED Europa API (Tenders Electronic Daily)"
LABEL org.opencontainers.image.source="https://docs.ted.europa.eu/api/latest/index.html"

WORKDIR /app
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
RUN npm prune --omit=dev
COPY --from=builder /app/dist ./dist

ENTRYPOINT ["node", "dist/index.js"]
