#!/usr/bin/env bash
#
# Bundle the libimobiledevice command-line tools (and their Homebrew dylibs)
# into engine/tools/mac-<arch>/ as a SELF-CONTAINED set, so the shipped OSFED
# app can create device backups with nothing installed on the end user's Mac.
#
# Build-time only: it reads the tools from Homebrew on THIS machine, copies them
# plus every non-system dylib they need, and rewrites the load paths with
# dylibbundler to @loader_path/../lib. The result does not depend on Homebrew.
#
# Requires (build machine only):  brew install libimobiledevice dylibbundler
#
set -euo pipefail

TOOLS=(idevice_id ideviceinfo idevicepair idevicebackup2)
# Optional tools: bundled when present on the build machine, skipped otherwise.
# afcclient (ships with libimobiledevice) enables advanced-logical acquisition
# over AFC, e.g. pulling the full camera roll (/DCIM) from the media partition.
OPTIONAL_TOOLS=(afcclient)
ARCH="$(uname -m)"            # arm64 or x86_64
PLAT="mac-${ARCH}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${ROOT}/engine/tools/${PLAT}"
BREW_PREFIX="$(brew --prefix)"

echo "==> Bundling libimobiledevice into ${DEST}"
rm -rf "${DEST}"
mkdir -p "${DEST}/bin" "${DEST}/lib"

# Copy the tool binaries (cp follows the Homebrew symlinks to the real files).
XARGS=()
for t in "${TOOLS[@]}"; do
  src="${BREW_PREFIX}/bin/${t}"
  if [[ ! -e "${src}" ]]; then
    echo "ERROR: ${src} not found — run: brew install libimobiledevice" >&2
    exit 1
  fi
  cp -L "${src}" "${DEST}/bin/${t}"
  chmod +w "${DEST}/bin/${t}"
  XARGS+=(-x "${DEST}/bin/${t}")
done

# Optional tools: include when available, warn (don't fail) when missing.
for t in "${OPTIONAL_TOOLS[@]}"; do
  src="${BREW_PREFIX}/bin/${t}"
  if [[ ! -e "${src}" ]]; then
    echo "WARN: optional tool ${t} not found — skipping (ships with libimobiledevice)" >&2
    continue
  fi
  cp -L "${src}" "${DEST}/bin/${t}"
  chmod +w "${DEST}/bin/${t}"
  XARGS+=(-x "${DEST}/bin/${t}")
done

# dylibbundler copies every non-system dependency into lib/ and rewrites all
# load commands (in the binaries and among the libs) to @loader_path/../lib.
dylibbundler -of -cd -b "${XARGS[@]}" -d "${DEST}/lib" -p '@loader_path/../lib'

echo "==> Bundled binaries:"
ls -1 "${DEST}/bin"
echo "==> Bundled libraries: $(ls -1 "${DEST}/lib" | wc -l | tr -d ' ')"
echo "==> Done."
