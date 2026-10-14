#!/usr/bin/env bash
# Uploads the Mimir slide pictures to one environment's recordings bucket,
# under mimir/slides/, where the map's hover preview reads them.
#
#   gcloud auth login            # once, as yourself
#   frontend/scripts/mimir-upload-slides.sh qa ~/path/to/slides-out
#   frontend/scripts/mimir-upload-slides.sh production ~/path/to/slides-out
#
# Make the folder with `npx tsx scripts/mimir-slides-prepare.ts` (see its
# header). Only files named <n>.jpg are uploaded, each as image/jpeg, and an
# object already there is overwritten. Nothing else in the bucket is touched:
# its lifecycle rules delete only the files/, chunks/ and compose/ prefixes.
# The bucket is private, so the pictures reach people only through the app's
# signed links.
set -euo pipefail

env="${1:-}"
dir="${2:-}"
case "$env" in
  qa) bucket="harnessevents-qa-recordings" ;;
  production) bucket="administration-459416-recordings" ;;
  *) echo "Usage: $0 <qa|production> <directory of <n>.jpg files>" >&2; exit 1 ;;
esac
[ -d "$dir" ] || { echo "No such directory: $dir" >&2; exit 1; }

shopt -s nullglob
files=("$dir"/[0-9]*.jpg)
[ "${#files[@]}" -gt 0 ] || { echo "No <n>.jpg files in $dir" >&2; exit 1; }

echo "Uploading ${#files[@]} slide pictures to gs://$bucket/mimir/slides/ ($env)"
gcloud storage cp --content-type=image/jpeg "${files[@]}" "gs://$bucket/mimir/slides/"
echo
gcloud storage ls "gs://$bucket/mimir/slides/" | wc -l
