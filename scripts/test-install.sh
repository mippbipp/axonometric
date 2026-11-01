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

# Serve a good copy of the release and one with a bad checksum over HTTP, the
# way the installer downloads from GitHub.
mkdir -p "$work/served/good" "$work/served/tampered"
cp "$release"/*.tar.gz "$release/SHA256SUMS" "$work/served/good/"
cp "$release"/*.tar.gz "$work/served/tampered/"
sed 's/^[0-9a-f]\{64\}/0000000000000000000000000000000000000000000000000000000000000000/' \
  "$release/SHA256SUMS" >"$work/served/tampered/SHA256SUMS"

port=$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
python3 -m http.server "$port" --bind 127.0.0.1 --directory "$work/served" >"$work/server.log" 2>&1 &
server=$!

tries=0
until curl -fs -o /dev/null "http://127.0.0.1:$port/good/SHA256SUMS" 2>/dev/null; do
  tries=$((tries + 1))
  [ "$tries" -lt 50 ] || { echo "test-install.sh: the test server didn't start." >&2; exit 1; }
  sleep 0.2
done

fail() {
  echo "test-install.sh: $*" >&2
  exit 1
}

echo "A good install"
# Output goes to a file, not through tee, so the installer's exit status
# isn't replaced by tee's.
AXONOMETRIC_DOWNLOAD_URL="http://127.0.0.1:$port/good" \
  AXONOMETRIC_INSTALL_DIR="$work/bin" \
  sh "$installer" >"$work/good.log" 2>&1 || { cat "$work/good.log"; fail "the good install failed."; }
cat "$work/good.log"
"$work/bin/axonometric" --version || fail "the installed binary didn't run."
grep -q "isn't on your PATH" "$work/good.log" || fail "the installer printed no PATH hint."

echo "A bad checksum"
if AXONOMETRIC_DOWNLOAD_URL="http://127.0.0.1:$port/tampered" \
  AXONOMETRIC_INSTALL_DIR="$work/tampered-bin" \
  sh "$installer"; then
  fail "the installer accepted a bad checksum."
fi
[ ! -e "$work/tampered-bin/axonometric" ] || fail "the installer wrote the binary despite the bad checksum."

echo "The installer passed."
exit 0
