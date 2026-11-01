#!/bin/sh
# Tests scripts/install.sh against a folder of release files: the archive for
# this machine and its SHA256SUMS. A good install must succeed and print the
# PATH hint, and a bad checksum must stop the install.
#
# Usage: scripts/test-install.sh <release folder>
set -eu

release=$(cd "$1" && pwd)
installer=$(cd "$(dirname "$0")" && pwd)/install.sh
work=$(mktemp -d)
server=""

cleanup() {
  [ -z "$server" ] || kill "$server" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT INT TERM

# Serve the release over HTTP, the way the installer downloads from GitHub.
port=$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
python3 -m http.server "$port" --bind 127.0.0.1 --directory "$release" >"$work/server.log" 2>&1 &
server=$!

tries=0
until curl -fs -o /dev/null "http://127.0.0.1:$port/SHA256SUMS" 2>/dev/null; do
  tries=$((tries + 1))
  [ "$tries" -lt 50 ] || { echo "The test server didn't start." >&2; exit 1; }
  sleep 0.2
done

echo "A good install"
AXONOMETRIC_DOWNLOAD_URL="http://127.0.0.1:$port" \
  AXONOMETRIC_INSTALL_DIR="$work/bin" \
  sh "$installer" | tee "$work/good.log"
"$work/bin/axonometric" --version
grep -q "isn't on your PATH" "$work/good.log"

echo "A bad checksum"
mkdir "$work/tampered"
cp "$release"/*.tar.gz "$work/tampered/"
sed 's/^[0-9a-f]\{64\}/0000000000000000000000000000000000000000000000000000000000000000/' \
  "$release/SHA256SUMS" >"$work/tampered/SHA256SUMS"

if AXONOMETRIC_DOWNLOAD_URL="$work/tampered" \
  AXONOMETRIC_INSTALL_DIR="$work/tampered-bin" \
  sh "$installer"; then
  echo "The installer accepted a bad checksum." >&2
  exit 1
fi
[ ! -e "$work/tampered-bin/axonometric" ] || { echo "The installer wrote the binary despite the bad checksum." >&2; exit 1; }

echo "The installer passed."
