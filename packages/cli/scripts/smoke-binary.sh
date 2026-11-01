#!/usr/bin/env bash
# Smoke-tests a single-executable binary: checks --version, then builds the
# fixture map in a temporary folder. The binary runs with an empty PATH, so it
# can't reach a system Node.
#
# Usage: packages/cli/scripts/smoke-binary.sh <binary>
set -euo pipefail

binary=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
package_dir=$(cd "$(dirname "$0")/.." && pwd)
version=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$package_dir/package.json")

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
# shellcheck disable=SC2016 # the backticks are Markdown
grep -q '| `gate` | Build gate |' "$work/pipeline/SYSTEM.md"
grep -q 'id="axonometric-map-state"' "$work/pipeline/pipeline.html"
grep -q '<div id="root"></div>' "$work/pipeline/pipeline.html"

# serve and status arrive in #15. Their check goes here: start serve on
# "$work/pipeline/map" in the background, run status, then stop serve.

echo "The binary passed."
