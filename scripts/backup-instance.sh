#!/usr/bin/env bash
set -euo pipefail
umask 077

if [ "$#" -ne 2 ]; then
  echo 'Usage: backup-instance.sh INSTANCE_DIRECTORY NEW_BACKUP_DIRECTORY' >&2
  exit 2
fi

instance_dir=$(cd "$1" && pwd -P)
backup_input=$2
case "$backup_input" in /*) ;; *) backup_input="$PWD/$backup_input" ;; esac
backup_parent=$(cd "$(dirname "$backup_input")" && pwd -P)
backup_dir="$backup_parent/$(basename "$backup_input")"

[ -f "$instance_dir/docker-compose.yml" ] || { echo 'Missing docker-compose.yml' >&2; exit 2; }
[ -f "$instance_dir/.env" ] || { echo 'Missing .env' >&2; exit 2; }
[ ! -e "$backup_dir" ] && [ ! -L "$backup_dir" ] || { echo 'Backup destination already exists' >&2; exit 2; }
case "$backup_dir/" in "$instance_dir/data/"*) echo 'Backup destination cannot be inside data' >&2; exit 2 ;; esac

cd "$instance_dir"
if [ -n "${MARKPOCKET_SOURCE_VERSION:-}" ]; then
  version=$MARKPOCKET_SOURCE_VERSION
elif [ -f package.json ]; then
  version=$(node -e 'const fs=require("fs"); const version=JSON.parse(fs.readFileSync("package.json","utf8")).version; if (typeof version !== "string" || !version.trim()) process.exit(1); console.log(version)') || {
    echo 'Cannot read a valid version from instance package.json' >&2
    exit 2
  }
else
  echo 'Missing version: supply instance package.json or MARKPOCKET_SOURCE_VERSION' >&2
  exit 2
fi

if [ -n "${MARKPOCKET_SOURCE_COMMIT:-}" ]; then
  commit=$MARKPOCKET_SOURCE_COMMIT
else
  commit=$(git rev-parse HEAD 2>/dev/null) || {
    echo 'Missing source commit: set MARKPOCKET_SOURCE_COMMIT' >&2
    exit 2
  }
fi

compose=(docker compose --project-directory "$instance_dir" -f "$instance_dir/docker-compose.yml")
"${compose[@]}" exec -T postgres pg_isready -U markpocket -d markpocket >/dev/null

if ! running_services=$("${compose[@]}" ps --status running --services); then
  echo 'Could not determine running services; backup aborted' >&2
  exit 1
fi
was_running=0
if grep -qx web <<< "$running_services"; then was_running=1; fi

web_image=$("${compose[@]}" images -q web)
if [ -z "$web_image" ]; then
  echo 'Could not identify the web image; backup aborted' >&2
  exit 1
fi

mkdir "$backup_dir"
cleanup() {
  result=$?
  trap - EXIT INT TERM HUP
  if [ "$was_running" = 1 ]; then
    if ! "${compose[@]}" start web; then
      echo 'Backup finished but web restart failed; start web manually.' >&2
      result=1
    fi
  fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

if [ "$was_running" = 1 ]; then "${compose[@]}" stop web; fi
"${compose[@]}" exec -T postgres pg_dump -U markpocket -d markpocket \
  --format=custom --no-owner --no-acl > "$backup_dir/database.dump"
if [ -d data ]; then
  tar -czf "$backup_dir/data.tar.gz" -C data .
else
  tar -czf "$backup_dir/data.tar.gz" -T /dev/null
fi

{
  echo 'format=markpocket-instance-backup-v1'
  echo 'postgres_major=16'
  echo 'storage=local'
  echo "created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "commit=$commit"
  echo "version=$version"
  echo "web_image=$web_image"
} > "$backup_dir/manifest.txt"
(
  cd "$backup_dir"
  shasum -a 256 database.dump data.tar.gz manifest.txt > SHA256SUMS
  shasum -a 256 -c SHA256SUMS
  : > COMPLETE
)
echo "Backup ready: $backup_dir"
