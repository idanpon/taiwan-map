#!/usr/bin/env bash
# Read-only checks. No installs, restarts, firewall changes, environment dumps or private keys.
set -u
section() { printf '\n### %s\n' "$1"; }
section 'OS / time / uptime'
if test -r /etc/os-release; then sed -n -E '/^(PRETTY_NAME|VERSION_ID)=/p' /etc/os-release; fi
date -Is
uptime
uname -m
section 'Memory and disk availability'
free -h 2>/dev/null || true
df -h / /var 2>/dev/null || true
df -i / /var 2>/dev/null || true
section 'Listeners: check 22, 80, 443 and 18080'
ss -ltnp 2>/dev/null || true
section 'Relevant services'
for service in nginx caddy apache2 docker ssh sshd; do
 if command -v systemctl >/dev/null 2>&1; then printf '%s: ' "$service"; systemctl is-active "$service" 2>/dev/null || true; fi
done
section 'Installed runtimes'
node --version 2>/dev/null || true
docker --version 2>/dev/null || true
docker compose version 2>/dev/null || true
section 'Existing containers: names/images/ports only'
if command -v docker >/dev/null 2>&1; then docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}' 2>/dev/null || true; fi
section 'Nginx names and listeners: no headers, environment, keys or credentials'
if command -v nginx >/dev/null 2>&1; then
 nginx -T 2>/dev/null | awk '/^[[:space:]]*(server_name|listen)[[:space:]]/ {print}' || true
fi
section 'Proxy configuration file paths: do not print full files'
for directory in /etc/nginx/sites-enabled /etc/caddy /etc/apache2/sites-enabled; do
 if test -d "$directory"; then ls -1 "$directory"; fi
done
section 'Firewall summary'
if command -v ufw >/dev/null 2>&1; then ufw status 2>/dev/null || true; fi
section 'Candidate dedicated directory'
if test -e /opt/taiwan-map; then ls -ld /opt/taiwan-map; else printf '/opt/taiwan-map does not exist\n'; fi
section 'End'
printf 'No changes were made. This report does not establish external reachability or validate DNS/TLS.\n'
