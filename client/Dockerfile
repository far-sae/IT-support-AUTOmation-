# syntax=docker/dockerfile:1
#
# Relay client image.
#
# Build:  docker build -f client/Dockerfile -t relay-client .
# Multi-stage: bundle with Vite, serve with nginx (which also proxies
# /api and /socket.io to the server container).

# ── Build stage ───────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY client/package.json ./
RUN npm install --no-audit --no-fund

COPY client/ ./
RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────────────
FROM nginx:alpine
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
