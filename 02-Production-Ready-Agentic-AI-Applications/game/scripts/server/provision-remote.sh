#!/usr/bin/env bash
# Runs on the event server as root, sent by scripts/provision.sh. Safe to run again.
set -euo pipefail
DOMAIN="$1"
NODE_MAJOR=22
export DEBIAN_FRONTEND=noninteractive

echo "== packages"
apt-get update -q
apt-get upgrade -yq
apt-get install -yq curl ca-certificates gnupg ufw unattended-upgrades rsync sqlite3 xz-utils debian-keyring debian-archive-keyring apt-transport-https

echo "== Node $NODE_MAJOR from the official binaries"
if ! /usr/local/bin/node --version 2>/dev/null | grep -q "^v$NODE_MAJOR\."; then
  base="https://nodejs.org/dist/latest-v$NODE_MAJOR.x"
  file=$(curl -fsSL "$base/SHASUMS256.txt" | awk '/linux-x64.tar.xz$/ {print $2}')
  sum=$(curl -fsSL "$base/SHASUMS256.txt" | awk '/linux-x64.tar.xz$/ {print $1}')
  tmp=$(mktemp -d)
  curl -fsSL "$base/$file" -o "$tmp/$file"
  echo "$sum  $tmp/$file" | sha256sum -c -
  tar -xJf "$tmp/$file" -C /usr/local --strip-components=1 --exclude='*/CHANGELOG.md' --exclude='*/README.md' --exclude='*/LICENSE'
  rm -rf "$tmp"
fi
/usr/local/bin/node --version

echo "== Caddy"
if ! command -v caddy >/dev/null; then
  if ! apt-get install -yq caddy 2>/dev/null; then
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -q
    apt-get install -yq caddy
  fi
fi
caddy version

echo "== user and folders"
id lab02 >/dev/null 2>&1 || useradd --system --home /opt/lab02 --shell /usr/sbin/nologin lab02
mkdir -p /opt/lab02/releases /opt/lab02/content /opt/lab02/private /opt/lab02/data
chown -R lab02:lab02 /opt/lab02/content /opt/lab02/private /opt/lab02/data
chmod 750 /opt/lab02/content /opt/lab02/private /opt/lab02/data
if [ ! -f /opt/lab02/env ]; then
  pass=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)
  cat > /opt/lab02/env <<ENV
NODE_ENV=production
PORT=3000
HOST=127.0.0.1
CONTENT_DIR=/opt/lab02/content
DATA_DIR=/opt/lab02/data
PUBLIC_URL=https://$DOMAIN
ANSWER_KEY_FILE=/opt/lab02/private/answer-key.html
FACILITATOR_GUIDE_FILE=/opt/lab02/private/facilitator-guide.html
LOG_LEVEL=info
HOST_PASSCODE=$pass
ENV
  echo "A host passcode was generated into /opt/lab02/env"
fi
chown root:root /opt/lab02/env
chmod 600 /opt/lab02/env  # systemd reads it as root before it drops to lab02

echo "== service"
install -m 644 /tmp/lab02.service /etc/systemd/system/lab02.service
systemctl daemon-reload
systemctl enable lab02 >/dev/null

echo "== Caddy site"
install -m 644 /tmp/Caddyfile /etc/caddy/Caddyfile
systemctl enable caddy >/dev/null
systemctl reload caddy 2>/dev/null || systemctl restart caddy

echo "== firewall: 22, 80, 443, IPv4 and IPv6"
sed -i 's/^IPV6=.*/IPV6=yes/' /etc/default/ufw
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
ufw status | head -12

echo "== automatic security updates"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'APT'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT
systemctl enable --now unattended-upgrades >/dev/null 2>&1 || true

echo "provisioned"
