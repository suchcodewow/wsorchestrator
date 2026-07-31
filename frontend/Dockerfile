# --- deps ---
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts=false

# --- build ---
FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- runtime (standalone) ---
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8080

# Cloud Run injects $PORT (8080); Next standalone server honors it.
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

# Which build this image is, surfaced in the app's user menu so the running
# revision can be identified without leaving the UI. Supplied by
# cloudbuild.yaml; the defaults are what a bare `docker build` gets.
#
# Declared after the COPYs on purpose: these change on every build, and putting
# them earlier would invalidate the layer cache for everything below them.
# `npm run build` has already run in the stage above, so these are read at
# request time by the server — never inlined into the bundle.
ARG BUILD_TAG=dev
ARG BUILD_TIME=""
ENV BUILD_TAG=$BUILD_TAG
ENV BUILD_TIME=$BUILD_TIME

EXPOSE 8080
CMD ["node", "server.js"]
