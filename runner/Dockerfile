# Terraform binary from the official image.
FROM hashicorp/terraform:1.9 AS tf

FROM node:22-slim
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
