# Base images come from mirror.gcr.io, Google's Docker Hub cache, because CI
# builds from shared IPs that hit Docker Hub's anonymous pull limit.
# --- deps ---
FROM mirror.gcr.io/library/node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts=false

# --- build ---
FROM mirror.gcr.io/library/node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- runtime (standalone) ---
FROM mirror.gcr.io/library/node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8080

# Cloud Run injects $PORT (8080); Next standalone server honors it.
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# The migrations, for QA's production import, which has to bring a restored
# database up to this build's schema before it can clean it
# (src/lib/production-import.ts). A few kilobytes of SQL.
COPY --from=build /app/drizzle ./drizzle

# Which build this image is, surfaced in the app's user menu so the running
# revision can be identified without leaving the UI. Supplied by the Harness
# pipeline, or by cloudbuild.yaml on the break-glass path; the defaults are
# what a bare `docker build` gets. The commit subject arrives base64-encoded —
# frontend/src/lib/build-info.ts says why.
#
# Declared after the COPYs on purpose: these change on every build, and putting
# them earlier would invalidate the layer cache for everything below them.
# `npm run build` has already run in the stage above, so these are read at
# request time by the server — never inlined into the bundle.
ARG BUILD_TAG=dev
ARG BUILD_TIME=""
ARG BUILD_MESSAGE_B64=""
ENV BUILD_TAG=$BUILD_TAG
ENV BUILD_TIME=$BUILD_TIME
ENV BUILD_MESSAGE_B64=$BUILD_MESSAGE_B64

EXPOSE 8080
CMD ["node", "server.js"]
