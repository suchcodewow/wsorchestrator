# OpenTofu rather than Terraform, so the image matches the committed
# .terraform.lock.hcl files: those pin providers from registry.opentofu.org,
# and Terraform resolves the same providers from registry.terraform.io, which
# would leave the pins inert and re-resolve on every init.
#
# The binary is downloaded rather than copied from ghcr.io/opentofu/opentofu —
# that image carries an `ONBUILD RUN exit 1` which deliberately fails any build
# using it as a base (unsupported since OpenTofu 1.10, see opentofu#1931).
FROM node:22-slim AS tf

# Pinned, and the download is checksum-verified against the release manifest so
# a tampered or truncated artifact fails the build rather than shipping.
ARG TOFU_VERSION=1.12.4
# Supplied by BuildKit as amd64/arm64, matching OpenTofu's asset naming.
ARG TARGETARCH

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl unzip \
  && rm -rf /var/lib/apt/lists/* \
  && cd /tmp \
  && curl -fsSL -O "https://github.com/opentofu/opentofu/releases/download/v${TOFU_VERSION}/tofu_${TOFU_VERSION}_linux_${TARGETARCH}.zip" \
  && curl -fsSL -O "https://github.com/opentofu/opentofu/releases/download/v${TOFU_VERSION}/tofu_${TOFU_VERSION}_SHA256SUMS" \
  && grep " tofu_${TOFU_VERSION}_linux_${TARGETARCH}.zip\$" "tofu_${TOFU_VERSION}_SHA256SUMS" | sha256sum -c - \
  && unzip -j "tofu_${TOFU_VERSION}_linux_${TARGETARCH}.zip" tofu -d /usr/local/bin \
  && chmod +x /usr/local/bin/tofu \
  && tofu version

FROM node:22-slim

# tofu (a Go binary) needs the system CA bundle to verify TLS to
# storage.googleapis.com / the provider registry; slim images omit it.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=tf /usr/local/bin/tofu /usr/local/bin/tofu

WORKDIR /app

# Install deps first for layer caching. The lockfile is copied and `npm ci`
# used so the image gets exactly the versions committed — `npm install` from
# package.json alone re-resolves the caret ranges on every build, so a rebuild
# of an old commit would not reproduce it.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# App code + bundled Terraform tree.
COPY src ./src
COPY terraform ./terraform

# `run` (needs RUN_ID) or `reap`, chosen by the Cloud Run Job's args.
ENTRYPOINT ["npx", "tsx", "src/index.ts"]
CMD ["reap"]
