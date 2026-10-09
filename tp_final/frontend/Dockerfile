# Build context: tp_final/ (needs both frontend/ and infra/caddy/).
FROM node:22-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Baked into the static bundle at build time (base spec §19).
ARG VITE_MAX_PLAINTEXT_BYTES
ARG VITE_OIDC_ISSUER
ARG VITE_OIDC_CLIENT_ID
RUN npm run build

FROM caddy:2-alpine
COPY infra/caddy/Caddyfile.prod /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
