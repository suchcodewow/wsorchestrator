#!/usr/bin/env bash
# Uploads the Mimir concept videos to one environment's recordings bucket,
# under mimir/videos/, where the app plays them from.
#
#   gcloud auth login            # once, as yourself
#   frontend/scripts/mimir-upload-videos.sh qa ~/path/to/explainer-video/out
#   frontend/scripts/mimir-upload-videos.sh production ~/path/to/explainer-video/out
#
# Only files named NN-slug.mp4 are uploaded, each as video/mp4, and an object
# already there is overwritten. Nothing else in the bucket is touched: its
# lifecycle rules delete only the files/, chunks/ and compose/ prefixes. The
# bucket is private, so the videos reach people only through the app's signed
# links. Check the result in Mimir Settings → Map, which lists each video and
# whether this environment has it.
set -euo pipefail

env="${1:-}"
dir="${2:-}"
case "$env" in
  qa) bucket="harnessevents-qa-recordings" ;;
  production) bucket="administration-459416-recordings" ;;
  *) echo "Usage: $0 <qa|production> <directory of NN-slug.mp4 files>" >&2; exit 1 ;;
esac
[ -d "$dir" ] || { echo "No such directory: $dir" >&2; exit 1; }

shopt -s nullglob
files=("$dir"/[0-9][0-9]-*.mp4)
[ "${#files[@]}" -gt 0 ] || { echo "No NN-slug.mp4 files in $dir" >&2; exit 1; }

echo "Uploading ${#files[@]} videos to gs://$bucket/mimir/videos/ ($env)"
gcloud storage cp --content-type=video/mp4 "${files[@]}" "gs://$bucket/mimir/videos/"
echo
gcloud storage ls -l "gs://$bucket/mimir/videos/"
