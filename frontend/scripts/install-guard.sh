#!/usr/bin/env bash
# Wraps yarn via /opt/install-guard/bin (prepended to PATH).
# Banned list lives in check-pkg.js.

GUARD=/app/frontend/scripts/check-pkg.js
BIN_NAME=$(basename "$0")

if [ -f "$GUARD" ]; then
  node "$GUARD" --args "$@" || exit 1
fi

# Find the next binary with our name in PATH (skipping our own directory).
SELF_DIR=$(dirname "$(readlink -f "$0")")

REAL_BIN=""
IFS=':' read -ra DIRS <<<"$PATH"
for dir in "${DIRS[@]}"; do
  if [ "$dir" != "$SELF_DIR" ] && [ -x "$dir/$BIN_NAME" ]; then
    REAL_BIN="$dir/$BIN_NAME"
    break
  fi
done

if [ -z "$REAL_BIN" ]; then
  echo "install-guard: real $BIN_NAME not found in PATH" >&2
  exit 1
fi

exec "$REAL_BIN" "$@"
