#!/usr/bin/env bash
# Smoke-tests a single-executable binary: checks --version, then builds the
# fixture map in a temporary folder. The binary runs with an empty PATH, so it
# can't reach a system Node. The checks don't depend on what the fixture map
# contains, only on build writing its outputs.
#
# Usage: packages/cli/scripts/smoke-binary.sh <binary> [version]
#
# The version defaults to the one in packages/cli/package.json.
set -euo pipefail

binary=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
package_dir=$(cd "$(dirname "$0")/.." && pwd)
# Read with the build's Node before PATH is cleared. Running from the package
# folder keeps the path relative, which also works in Git Bash on Windows.
version=${2:-$(cd "$package_dir" && node -p 'require("./package.json").version')}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir "$work/empty-path" "$work/pipeline"
cp -R "$package_dir/test/fixtures/pipeline/map" "$work/pipeline/map"

# Runs the binary with no PATH entries except an empty folder.
run_binary() {
  env PATH="$work/empty-path" "$binary" "$@"
}

echo "--version"
actual=$(run_binary --version)
echo "$actual"
if [ "$actual" != "axonometric v$version" ]; then
  echo "Expected axonometric v$version." >&2
  exit 1
fi

echo "build"
(cd "$work" && run_binary build pipeline/map)
for output in SYSTEM.md pipeline.html; do
  if [ ! -s "$work/pipeline/$output" ]; then
    echo "build didn't write $output." >&2
    exit 1
  fi
done

echo "export"
map="$work/pipeline/map"
out="$work/pipeline"
run_binary export "$map" --format svg --view plan --output "$out/plan.svg"
run_binary export "$map" --format png --view plan --output "$out/plan.png"

# The SVG says how big it is, and the PNG is drawn at twice that. od reads the
# PNG's IHDR (width at byte 16, height at byte 20) the same on every OS.
svg_size=$(sed -n '1,3s/.*<svg[^>]* width="\([0-9]*\)" height="\([0-9]*\)".*/\1 \2/p' "$out/plan.svg")
png_size=$(od -An -tu1 -j16 -N8 "$out/plan.png" | awk '{ print $1*16777216 + $2*65536 + $3*256 + $4, $5*16777216 + $6*65536 + $7*256 + $8 }')
expected=$(printf '%s\n' "$svg_size" | awk '{ print $1*2, $2*2 }')
if [ -z "$svg_size" ] || [ "$png_size" != "$expected" ]; then
  echo "export wrote a PNG of $png_size, not $expected (twice the SVG's $svg_size)." >&2
  exit 1
fi
echo "plan.png is $png_size"

echo "serve and status"
state_file="$map/.axonometric/server.json"
# Started directly, not through run_binary, so $! is the binary itself and
# kill reaches it.
PATH="$work/empty-path" "$binary" serve "$map" --port 0 &
serve_pid=$!
report=""
for _ in $(seq 1 50); do
  report=$(run_binary status "$map" --json || true)
  case "$report" in
    *'"running":true'*) break ;;
  esac
  report=""
  sleep 0.2
done

stop_serve() {
  kill "$serve_pid" 2>/dev/null || true
  wait "$serve_pid" 2>/dev/null || true
}

if [ -z "$report" ]; then
  stop_serve
  echo "status never reported the server that serve started." >&2
  exit 1
fi

url=$(printf '%s\n' "$report" | sed -n 's/.*"url":"\([^"]*\)".*/\1/p')
echo "serve is at $url"

if ! curl -fsS "$url/" | grep -q 'id="axonometric-map-state"'; then
  stop_serve
  echo "$url/ didn't answer 200 with the map page." >&2
  exit 1
fi

forged=$(curl -sS -o /dev/null -w '%{http_code}' -H 'Host: attacker.example.test' "$url/")
if [ "$forged" != "403" ]; then
  stop_serve
  echo "A request with a forged Host got $forged, not 403." >&2
  exit 1
fi

stop_serve

if run_binary status "$map" --json | grep -q '"running":true'; then
  echo "status still reports a server after serve was stopped." >&2
  exit 1
fi

# kill sends SIGTERM on macOS and Linux, and serve removes its state file.
# Git Bash on Windows ends the process without a signal it can handle, so
# the file stays there, and status ignores it because its process is gone.
case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*) ;;
  *)
    if [ -e "$state_file" ]; then
      echo "serve left $state_file behind after it stopped." >&2
      exit 1
    fi
    ;;
esac

echo "The binary passed."
