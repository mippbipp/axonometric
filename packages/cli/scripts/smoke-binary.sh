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

# serve and status arrive in #15. Their check goes here: start serve on
# "$work/pipeline/map" in the background, run status, then stop serve.

echo "The binary passed."
