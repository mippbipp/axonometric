#!/bin/sh
# Installs the axonometric binary from a GitHub Release.
#
#   curl -fsSL https://github.com/mippbipp/axonometric/releases/latest/download/install.sh | sh
#
# Settings, all optional:
#   AXONOMETRIC_VERSION       a release such as 0.1.0. Defaults to the latest.
#   AXONOMETRIC_INSTALL_DIR   where the binary goes. Defaults to ~/.local/bin.
#   AXONOMETRIC_DOWNLOAD_URL  a URL or folder holding the release files, used
#                             instead of GitHub. CI tests the script this way.
set -eu

repo="mippbipp/axonometric"

fail() {
  echo "axonometric install: $*" >&2
  exit 1
}

detect_os() {
  case $(uname -s) in
    Linux)
      if ls /lib/ld-musl-* >/dev/null 2>&1; then
        fail "this Linux uses musl, and the release binaries need glibc. Install the npm package instead: npm install -g axonometric"
      fi
      echo linux
      ;;
    Darwin) echo darwin ;;
    *) fail "there's no binary for $(uname -s). On Windows, use install.ps1." ;;
  esac
}

detect_arch() {
  arch=$(uname -m)

  # A shell running under Rosetta reports x86_64 on an Apple silicon Mac.
  if [ "$arch" = x86_64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || true)" = 1 ]; then
    arch=arm64
  fi

  case $arch in
    x86_64 | amd64) echo x64 ;;
    aarch64 | arm64) echo arm64 ;;
    *) fail "there's no binary for the $arch architecture." ;;
  esac
}

# Copies $1 (a URL, or a path when AXONOMETRIC_DOWNLOAD_URL is a folder) to $2.
fetch() {
  case $1 in
    http://* | https://* | file://*)
      if command -v curl >/dev/null 2>&1; then
        curl -fsSL -o "$2" "$1" || fail "could not download $1"
      elif command -v wget >/dev/null 2>&1; then
        wget -q -O "$2" "$1" || fail "could not download $1"
      else
        fail "neither curl nor wget is installed."
      fi
      ;;
    *) cp "$1" "$2" 2>/dev/null || fail "could not copy $1" ;;
  esac
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d ' ' -f 1
  else
    fail "neither sha256sum nor shasum is installed, so the download can't be checked."
  fi
}

os=$(detect_os)
arch=$(detect_arch)
asset="axonometric-$os-$arch.tar.gz"

if [ -n "${AXONOMETRIC_DOWNLOAD_URL:-}" ]; then
  base=${AXONOMETRIC_DOWNLOAD_URL%/}
elif [ -n "${AXONOMETRIC_VERSION:-}" ]; then
  base="https://github.com/$repo/releases/download/v${AXONOMETRIC_VERSION#v}"
else
  base="https://github.com/$repo/releases/latest/download"
fi

install_dir=${AXONOMETRIC_INSTALL_DIR:-"$HOME/.local/bin"}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT INT TERM

echo "Downloading $asset from $base"
fetch "$base/$asset" "$work/$asset"
fetch "$base/SHA256SUMS" "$work/SHA256SUMS"

expected=$(awk -v name="$asset" '$2 == name || $2 == "*" name { print $1 }' "$work/SHA256SUMS")
[ -n "$expected" ] || fail "SHA256SUMS has no line for $asset."

actual=$(sha256 "$work/$asset")
if [ "$actual" != "$expected" ]; then
  fail "the checksum of $asset is $actual, but SHA256SUMS says $expected. install.sh installed nothing."
fi

tar -xzf "$work/$asset" -C "$work" axonometric || fail "could not unpack $asset."

mkdir -p "$install_dir"
# Copy beside the target, then rename, so the old binary is replaced in one
# step and a running copy keeps working.
staged="$install_dir/.axonometric.$$"
cp "$work/axonometric" "$staged"
chmod 755 "$staged"
mv -f "$staged" "$install_dir/axonometric"

echo "Installed $("$install_dir/axonometric" --version) to $install_dir/axonometric"

case ":$PATH:" in
  *":$install_dir:"*) ;;
  *)
    echo
    echo "$install_dir isn't on your PATH. Add this line to your shell's startup file (~/.profile, ~/.bashrc or ~/.zshrc), then open a new terminal:"
    echo
    echo "  export PATH=\"$install_dir:\$PATH\""
    ;;
esac
