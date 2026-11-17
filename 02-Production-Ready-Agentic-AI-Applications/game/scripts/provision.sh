#!/usr/bin/env bash
# Sets up the event server once, from the Mac (engineering spec, section 13.1).
# Usage: scripts/provision.sh <domain>
# The server is reached through the SSH host alias lab02-event. No address or secret is in this repository.
set -euo pipefail
cd "$(dirname "$0")"
DOMAIN="${1:?usage: scripts/provision.sh <domain>}"
sed "s/{DOMAIN}/$DOMAIN/g" server/Caddyfile.template > /tmp/lab02-Caddyfile
scp -q server/lab02.service lab02-event:/tmp/lab02.service
scp -q /tmp/lab02-Caddyfile lab02-event:/tmp/Caddyfile
rm /tmp/lab02-Caddyfile
ssh lab02-event 'bash -s' -- "$DOMAIN" < server/provision-remote.sh
