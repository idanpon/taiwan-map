#!/usr/bin/env bash
# Official Node 24 runtime, installed separately; never changes /usr/bin/node.
set -euo pipefail
if (( EUID != 0 )); then printf 'Run as root.\n' >&2; exit 1; fi
if [[ "$(uname -m)" != x86_64 ]]; then printf 'This helper supports x86_64 only.\n' >&2; exit 1; fi
for tool in curl tar sha256sum awk; do command -v "$tool" >/dev/null || { printf 'Missing %s\n' "$tool" >&2; exit 1; }; done
if [[ -e /opt/taiwan-node || -L /opt/taiwan-node ]]; then printf "/opt/taiwan-node already exists; inspect it manually.\n" >&2; exit 1; fi
runtime_tmp="$(mktemp -d)"
trap 'rm -rf -- "$runtime_tmp"' EXIT
cd -- "$runtime_tmp"
base='https://nodejs.org/dist/latest-v24.x'
curl --fail --location --proto '=https' --tlsv1.2 --max-time 60 "$base/SHASUMS256.txt" -o SHASUMS256.txt
node_archive="$(awk '$2 ~ /^node-v24\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz$/ {print $2}' SHASUMS256.txt)"
if [[ ! "$node_archive" =~ ^node-v24\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz$ ]]; then printf 'Unexpected official manifest.\n' >&2; exit 1; fi
curl --fail --location --proto '=https' --tlsv1.2 --max-time 180 "$base/$node_archive" -o "$node_archive"
awk -v file="$node_archive" '$2==file {print}' SHASUMS256.txt | sha256sum --check --status
version_dir="${node_archive%.tar.xz}"
if [[ -e "/opt/$version_dir" ]]; then printf 'Existing /opt/%s kept; inspect it manually.\n' "$version_dir" >&2; exit 1; fi
tar -xJf "$node_archive" -C /opt
ln -s -- "/opt/$version_dir" /opt/taiwan-node
printf '\nInstalled separate runtime; use this exact path in the service:\n/opt/%s/bin/node\n' "$version_dir"
"/opt/$version_dir/bin/node" --version
printf "Stable path: /opt/taiwan-node/bin/node\n"
