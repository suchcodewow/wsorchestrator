# The mimir-studio Cloud Run job (studio/index.ts). Built from the repository
# root, because the studio shares the concept map's and the jobs' shapes with
# the frontend (frontend/src/lib/mimir/map/schema.ts and studio/shapes.ts)
# rather than keeping a copy that could drift; the root .dockerignore lets in
# only those two files and this directory, and keeps out every gitignored
# folder here, which hold the course's content.
#
#   docker build -f scripts/explainer-video/Dockerfile .
#
# node comes from mirror.gcr.io, Google's Docker Hub cache, because CI builds
# from shared IPs that hit Docker Hub's anonymous pull limit.
FROM mirror.gcr.io/library/node:22-slim

# What the studio shells out to:
#   ffmpeg/ffprobe  narration, sound effects, the final mix and its checks
#   chromium        Remotion renders the scenes in it (CHROME_PATH)
#   libreoffice-impress, poppler-utils, unzip  a deck becomes a PDF, the PDF
#                   pictures, and the .pptx's XML its notes and titles
# The fonts stand in for the ones the videos name, which are Apple's: Liberation
# Sans is metric-compatible with Arial, the first of them Linux has, and Noto
# Color Emoji draws the emoji.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ca-certificates ffmpeg chromium libreoffice-impress poppler-utils unzip \
       fonts-liberation fonts-noto-color-emoji fontconfig \
  && rm -rf /var/lib/apt/lists/*

ENV CHROME_PATH=/usr/bin/chromium \
    SOFFICE_PATH=/usr/bin/soffice \
    NODE_ENV=production

WORKDIR /repo/scripts/explainer-video

# Every dependency, dev ones included: the job runs under tsx. The lockfile and
# `npm ci` give the image exactly the versions committed.
COPY scripts/explainer-video/package.json scripts/explainer-video/package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund

COPY scripts/explainer-video/ ./
COPY frontend/src/lib/mimir/map/schema.ts /repo/frontend/src/lib/mimir/map/schema.ts
COPY frontend/src/lib/mimir/studio/shapes.ts /repo/frontend/src/lib/mimir/studio/shapes.ts
# Node resolves zod for those two files from beside them, so give them this
# directory's packages.
RUN ln -s /repo/scripts/explainer-video/node_modules /repo/frontend/node_modules

# One execution does the job row named by JOB_ID, which the app sets.
ENTRYPOINT ["npx", "tsx", "studio/index.ts"]
