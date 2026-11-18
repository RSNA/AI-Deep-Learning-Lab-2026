#!/usr/bin/env bash
# The gate that commits, pushes and deploys pass through: check:no-private against the private
# pack (engineering spec, section 12.5). It fails when the check fails, and also when no private
# pack is named, because the check proves nothing without one.
#   PRIVATE_CONTENT_DIR (or CONTENT_DIR) is the folder of the private pack.
set -euo pipefail
cd "$(dirname "$0")/.."
PRIVATE="${PRIVATE_CONTENT_DIR:-${CONTENT_DIR:-}}"
if [ -z "$PRIVATE" ] || [ ! -d "$PRIVATE" ]; then
  echo "check:no-private needs the private pack. Set PRIVATE_CONTENT_DIR to its folder." >&2
  exit 1
fi
if ! CONTENT_DIR="$PRIVATE" npm run -s check:no-private; then
  echo "check:no-private failed: nothing is committed, pushed or deployed." >&2
  exit 1
fi
