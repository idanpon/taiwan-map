#!/usr/bin/env bash
# Creates a NEW private environment file. Does not rotate an existing password.
set -euo pipefail
if (( EUID != 0 )); then printf 'Run as root.\n' >&2; exit 1; fi
node_bin="${1:-$(command -v node || true)}"
if [[ ! -x "$node_bin" ]]; then printf 'Pass the absolute path to Node 24+.\n' >&2; exit 1; fi
"$node_bin" -e 'if(Number(process.versions.node.split(".")[0])<24)process.exit(1)'
if [[ -e /etc/taiwan-map.env ]]; then printf '/etc/taiwan-map.env exists; kept unchanged.\n' >&2; exit 1; fi
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
IFS= read -r -s -p 'Trip password (at least 8 characters): ' tw_password </dev/tty
printf '\n' >/dev/tty
IFS= read -r -s -p 'Repeat password: ' tw_repeat </dev/tty
printf '\n' >/dev/tty
if [[ "$tw_password" != "$tw_repeat" || ${#tw_password} -lt 8 ]]; then unset tw_password tw_repeat; printf 'Passwords do not match or are too short.\n' >&2; exit 1; fi
hash_line="$(printf '%s\n' "$tw_password" | "$node_bin" "$repo_dir/server/password.mjs")"
unset tw_password tw_repeat
umask 077
env_temp="$(mktemp /etc/.taiwan-map.env.XXXXXX)"
trap 'rm -f -- "$env_temp"' EXIT
{
 printf '%s\n' "$hash_line"
 printf '%s\n' 'APP_ORIGIN=https://svobodadlaseti.shop' 'FRONTEND_ORIGIN=https://taiwan.svobodadlaseti.shop' 'SESSION_COOKIE_PATH=/taiwan/api' 'TRUST_PROXY=0'
} > "$env_temp"
unset hash_line
chmod 600 "$env_temp"
chown root:root "$env_temp"
mv -- "$env_temp" /etc/taiwan-map.env
trap - EXIT
printf 'Created /etc/taiwan-map.env with mode 0600. Password not printed.\n'
