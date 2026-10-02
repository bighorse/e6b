#!/usr/bin/env bash
# One-time setup on a Baidu Cloud BCC instance (Ubuntu/Debian or CentOS/Baidu Linux).
# Run as root on the server:  bash setup-server.sh
set -euo pipefail

if command -v apt-get >/dev/null; then
  apt-get update -y && apt-get install -y nginx rsync
elif command -v dnf >/dev/null; then
  dnf install -y nginx rsync
else
  yum install -y epel-release || true
  yum install -y nginx rsync
fi

mkdir -p /var/www/cx3
DEPLOY_USER="${DEPLOY_USER:-${SUDO_USER:-root}}"
chown -R "$DEPLOY_USER":"$DEPLOY_USER" /var/www/cx3

cat > /etc/nginx/conf.d/cx3.conf <<'CONF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    root /var/www/cx3;
    index index.html;
    charset utf-8;
    gzip on;
    gzip_types text/css application/javascript text/plain image/svg+xml;
    location = /index.html { add_header Cache-Control "no-cache"; }
    location ~* \.(css|js)$ { add_header Cache-Control "public, max-age=3600"; }
    location / { try_files $uri $uri/ /index.html; }
}
CONF
# Avoid a clash with the distro's default site on port 80
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
sed -i 's/listen\s\+80 default_server;/listen 80;/; s/listen\s\+\[::\]:80 default_server;/listen [::]:80;/' /etc/nginx/nginx.conf 2>/dev/null || true

nginx -t
systemctl enable --now nginx
systemctl reload nginx
echo "Done. Upload the site into /var/www/cx3 and open http://<server-ip>/"
echo "Remember to allow inbound TCP 80 in the BCC security group."
