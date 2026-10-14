#!/usr/bin/env bash
# One-off: moves an environment's async recordings from the bucket root
# (files/, chunks/, compose/) into recordings/, the folder the app and the
# bucket's lifecycle rules use from the release that introduced it. Run it
# around that release, in this order:
#
#   1. gcloud auth login            # once, as yourself
#   2. frontend/scripts/recordings-move-prefixes.sh <qa|production> copy
#        copies every object to its new name; nothing is removed, so the
#        release in step 3 finds every recording where it now looks.
#   3. Release: merge to main for QA (deploy_qa applies the infra); for
#      production run deploy_production with run_infra=true, which also
#      applies the lifecycle rules for the new folder.
#   4. frontend/scripts/recordings-move-prefixes.sh <qa|production> verify
#        every old object has a copy of the same size at the new name.
#   5. frontend/scripts/recordings-move-prefixes.sh <qa|production> delete-old
#        removes the old names, only after verify passes.
#
# Between 3 and 5 the old objects sit under no lifecycle rule, which is fine for
# a few days; delete-old ends it. mimir/ is untouched.
set -euo pipefail

env="${1:-}"
step="${2:-}"
case "$env" in
  qa) bucket="harnessevents-qa-recordings" ;;
  production) bucket="administration-459416-recordings" ;;
  *) echo "Usage: $0 <qa|production> <copy|verify|delete-old>" >&2; exit 1 ;;
esac

old_objects() { gcloud storage ls -l "gs://$bucket/files/**" "gs://$bucket/chunks/**" "gs://$bucket/compose/**" 2>/dev/null | awk '$1 ~ /^[0-9]+$/ {print $1, $3}'; }

case "$step" in
  copy)
    for top in files chunks compose; do
      if gcloud storage ls "gs://$bucket/$top/" >/dev/null 2>&1; then
        echo "Copying $top/ to recordings/$top/ in $bucket"
        gcloud storage cp --recursive "gs://$bucket/$top/*" "gs://$bucket/recordings/$top/"
      fi
    done
    ;;
  verify)
    bad=0
    while read -r size name; do
      new="gs://$bucket/recordings/${name#gs://$bucket/}"
      got=$(gcloud storage ls -l "$new" 2>/dev/null | awk '$1 ~ /^[0-9]+$/ {print $1}' | head -1 || true)
      if [ "$got" != "$size" ]; then echo "MISSING or different size: $new (want $size, have ${got:-none})"; bad=1; fi
    done < <(old_objects)
    [ "$bad" = 0 ] && echo "Every old object has a matching copy under recordings/."
    exit "$bad"
    ;;
  delete-old)
    echo "Deleting files/, chunks/ and compose/ from $bucket. Run 'verify' first."
    read -r -p "Type the bucket name to continue: " answer
    [ "$answer" = "$bucket" ] || { echo "Cancelled." >&2; exit 1; }
    for top in files chunks compose; do
      gcloud storage rm --recursive "gs://$bucket/$top/" 2>/dev/null || true
    done
    ;;
  *) echo "Usage: $0 <qa|production> <copy|verify|delete-old>" >&2; exit 1 ;;
esac
