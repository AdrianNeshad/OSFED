#!/usr/bin/env bash
#
# Bundle the libimobiledevice command-line tools (and their shared libraries)
# into engine/tools/linux-<arch>/ as a self-contained set, so the shipped OSFED
# AppImage can create device backups without the user installing packages.
#
# Build-time only. Requires on the build machine:
#   sudo apt-get install -y libimobiledevice-utils usbmuxd patchelf
#
# Note: at RUNTIME the end user's Linux still needs a running usbmuxd service to
# reach the device over USB; only the CLI tools + their libs are bundled here.
#
set -euo pipefail

TOOLS=(idevice_id ideviceinfo idevicepair idevicebackup2)
ARCH="$(uname -m)"
case "${ARCH}" in
  x86_64) ARCH=x64 ;;
  aarch64|arm64) ARCH=arm64 ;;
esac
PLAT="linux-${ARCH}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${ROOT}/engine/tools/${PLAT}"

echo "==> Bundling libimobiledevice into ${DEST}"
rm -rf "${DEST}"
mkdir -p "${DEST}/bin" "${DEST}/lib"

# System libraries we must NOT bundle (provided by every target distro).
is_system_lib() {
  case "$1" in
    *linux-vdso*|*ld-linux*|*/libc.so*|*/libpthread.so*|*/libdl.so*|\
    */libm.so*|*/librt.so*|*/libresolv.so*|*/libgcc_s.so*|*/libstdc++.so*) return 0 ;;
    *) return 1 ;;
  esac
}

for t in "${TOOLS[@]}"; do
  src="$(command -v "${t}" || true)"
  if [[ -z "${src}" ]]; then
    echo "ERROR: ${t} not found — run: sudo apt-get install -y libimobiledevice-utils" >&2
    exit 1
  fi
  cp -L "${src}" "${DEST}/bin/${t}"
  chmod +w "${DEST}/bin/${t}"

  # Copy each non-system shared dependency into lib/.
  while read -r lib; do
    [[ -z "${lib}" ]] && continue
    is_system_lib "${lib}" && continue
    [[ -e "${lib}" ]] || continue
    base="$(basename "${lib}")"
    [[ -e "${DEST}/lib/${base}" ]] || cp -L "${lib}" "${DEST}/lib/${base}"
  done < <(ldd "${src}" | awk '{for(i=1;i<=NF;i++) if($i ~ /^\//) print $i}')

  patchelf --set-rpath '$ORIGIN/../lib' "${DEST}/bin/${t}"
done

# Resolve inter-library deps within lib/ itself.
for so in "${DEST}"/lib/*; do
  [[ -f "${so}" ]] || continue
  chmod +w "${so}"
  patchelf --set-rpath '$ORIGIN' "${so}" 2>/dev/null || true
done

echo "==> Bundled binaries:"; ls -1 "${DEST}/bin"
echo "==> Bundled libraries: $(ls -1 "${DEST}/lib" | wc -l | tr -d ' ')"
echo "==> Done."
