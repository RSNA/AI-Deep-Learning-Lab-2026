#!/usr/bin/env bash
# Ships a finished build to the event server (engineering spec, section 13.2).
#
#   scripts/deploy.sh                       build, check and deploy; keep the pack on the server
#   scripts/deploy.sh --content <folder>    also copy that pack (and its answer key, when present)
#   scripts/deploy.sh --demo                also copy the demo pack
#   scripts/deploy.sh --force               deploy even while a session is in a play stage
#   scripts/deploy.sh --rollback            switch back to the release before
#   scripts/deploy.sh --pull-data           copy the database to the Mac
#
# Environment: PRIVATE_CONTENT_DIR is the private pack for check:no-private (defaults to --content).
set -euo pipefail
cd "$(dirname "$0")/.."
REMOTE=lab02-event
CONTENT=""; DEMO=0; FORCE=0; ROLLBACK=0; PULL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --content) CONTENT="$(cd "$2" && pwd)"; shift 2 ;;
    --demo) DEMO=1; shift ;;
    --force) FORCE=1; shift ;;
    --rollback) ROLLBACK=1; shift ;;
    --pull-data) PULL=1; shift ;;
    *) echo "unknown option $1"; exit 2 ;;
  esac
done

wait_for_build() {
  local want="$1"
  for _ in $(seq 1 40); do
    got=$(ssh "$REMOTE" "curl -fsS http://127.0.0.1:3000/healthz 2>/dev/null" | sed -n 's/.*"build":"\([^"]*\)".*/\1/p' || true)
    if [ "$got" = "$want" ]; then echo "healthz reports $got"; return 0; fi
    sleep 0.5
  done
  echo "the server did not report build $want"; ssh "$REMOTE" "journalctl -u lab02 -n 30 --no-pager"; return 1
}

if [ "$PULL" = 1 ]; then
  dest="data-pulled-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$dest"
  ssh "$REMOTE" "sqlite3 /opt/lab02/data/lab02.sqlite '.backup /tmp/lab02-pull.sqlite'"
  scp -q "$REMOTE:/tmp/lab02-pull.sqlite" "$dest/lab02.sqlite"
  ssh "$REMOTE" "rm -f /tmp/lab02-pull.sqlite"
  echo "database copied to $dest/"
  exit 0
fi

if [ "$ROLLBACK" = 1 ]; then
  prev=$(ssh "$REMOTE" 'cd /opt/lab02/releases && cur=$(basename "$(readlink -f /opt/lab02/current)") && ls -1 | sort | grep -B1 -x "$cur" | head -1')
  cur=$(ssh "$REMOTE" 'basename "$(readlink -f /opt/lab02/current)"')
  if [ -z "$prev" ] || [ "$prev" = "$cur" ]; then echo "no earlier release"; exit 1; fi
  ssh "$REMOTE" "ln -sfn /opt/lab02/releases/$prev /opt/lab02/current && systemctl restart lab02"
  wait_for_build "$prev"
  echo "rolled back to $prev"
  exit 0
fi

# Refuse while a session is in a play stage.
if [ "$FORCE" = 0 ]; then
  live=$(ssh "$REMOTE" "curl -fsS http://127.0.0.1:3000/healthz 2>/dev/null || true" | grep -oE '"stage":"(planning\.play|development\.play|maintaining\.setup|maintaining\.year)"' || true)
  if [ -n "$live" ]; then echo "A session is in a play stage ($live). Use --force to deploy anyway."; exit 1; fi
fi

echo "== checks on the Mac"
npm ci --no-audit --no-fund
env -u SYSTEMS npm run check
PRIVATE="${PRIVATE_CONTENT_DIR:-$CONTENT}"
if [ -n "$PRIVATE" ]; then CONTENT_DIR="$PRIVATE" npm run check:no-private; else npm run check:no-private; fi
if [ -n "$CONTENT" ]; then CONTENT_DIR="$CONTENT" npm run test:leak; fi
if [ -n "$CONTENT" ]; then CONTENT_DIR="$CONTENT" npm run check:content; fi

echo "== build"
ID="$(date -u +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)"
BUILD_ID="$ID" npm run build

echo "== copy release $ID"
ssh "$REMOTE" "mkdir -p /opt/lab02/releases/$ID"
rsync -az --delete dist/ "$REMOTE:/opt/lab02/releases/$ID/"
if [ -n "$CONTENT" ] || [ "$DEMO" = 1 ]; then
  src="${CONTENT:-$PWD/content-demo}"
  echo "== copy the pack from $src"
  rsync -az --delete --exclude '.DS_Store' --exclude 'SCHEMA.md' "$src/" "$REMOTE:/opt/lab02/content/"
  key="$(dirname "$src")/review/answer-key.html"
  if [ -n "$CONTENT" ] && [ -f "$key" ]; then rsync -az "$key" "$REMOTE:/opt/lab02/private/answer-key.html"; else ssh "$REMOTE" "rm -f /opt/lab02/private/answer-key.html"; fi
  ssh "$REMOTE" "chown -R lab02:lab02 /opt/lab02/content /opt/lab02/private && chmod -R go-rwx /opt/lab02/content /opt/lab02/private"
fi
if [ -n "${SYSTEMS:-}" ]; then
  ssh "$REMOTE" "sed -i '/^SYSTEMS=/d' /opt/lab02/env && echo SYSTEMS=$SYSTEMS >> /opt/lab02/env"
else
  ssh "$REMOTE" "sed -i '/^SYSTEMS=/d' /opt/lab02/env"
fi

echo "== switch and restart"
ssh "$REMOTE" "chown -R root:root /opt/lab02/releases/$ID && ln -sfn /opt/lab02/releases/$ID /opt/lab02/current && systemctl restart lab02"
wait_for_build "$ID"
ssh "$REMOTE" 'cd /opt/lab02/releases && ls -1 | sort | head -n -3 | xargs -r rm -rf'
echo "deployed $ID"
