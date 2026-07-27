# Terraform binary from the official image.
FROM hashicorp/terraform:1.9 AS tf

FROM node:22-slim

# terraform (a Go binary) needs the system CA bundle to verify TLS to
# storage.googleapis.com / the provider registry; slim images omit it.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=tf /bin/terraform /usr/local/bin/terraform

WORKDIR /app

# Install deps first for layer caching.
COPY package.json ./
RUN npm install --omit=dev

# App code + bundled Terraform tree.
COPY src ./src
COPY terraform ./terraform

# `run` (needs RUN_ID) or `reap`, chosen by the Cloud Run Job's args.
ENTRYPOINT ["npx", "tsx", "src/index.ts"]
CMD ["reap"]
