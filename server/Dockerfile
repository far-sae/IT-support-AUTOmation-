# syntax=docker/dockerfile:1
#
# Relay API image.
#
# Build context expected: repo root (so we can reach server/ paths cleanly).
# Build:   docker build -f server/Dockerfile -t relay-server .
# On start the container runs `prisma migrate deploy` and then `node`s the
# compiled entry point.

# ── Build stage ───────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS build
WORKDIR /app

# Native deps for prisma engine + bcrypt
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY server/package.json ./
RUN npm install --no-audit --no-fund

COPY server/ ./
RUN npx prisma generate
RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────────────
FROM node:20-bookworm-slim
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

# Apply pending migrations, then boot. Both run in the foreground so the
# container exits if either fails.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/index.js"]
