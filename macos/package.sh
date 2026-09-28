#!/bin/bash
set -euo pipefail
prototype_root="$(cd "$(dirname "$0")/.." && pwd)"
app_dir="${MOMO_DIST_DIR:-$prototype_root/dist}/Doto.app"
out_dir="${MOMO_SUBMISSION_DIR:-$prototype_root/submission/artifacts}"
mkdir -p "$out_dir"
stage=$(mktemp -d "${TMPDIR:-/tmp}/momo-package.XXXXXX")
pending=$(mktemp -d "$out_dir/.package.XXXXXX")
trap 'rm -rf "$stage" "$pending"' EXIT
codesign --verify --deep --strict "$app_dir"
ditto "$app_dir" "$stage/Doto.app"
ln -s /Applications "$stage/Applications"
cp "$prototype_root/submission/README-template.txt" "$stage/먼저 읽어주세요.txt"
cp "$prototype_root/submission/SECOND-MAC-CHECK.md" "$stage/SECOND-MAC-CHECK.md"
cp "$prototype_root/submission/verify-mac.sh" "$stage/verify-mac.sh"
# Explicit staging prevents local state, credentials, logs, and development notes from entering the image.
stage_kb=$(du -sk "$stage" | awk '{print $1}')
image_kb=$((stage_kb + stage_kb / 2 + 65536))
hdiutil create -volname 'Doto 0.1.0 Review' -size "${image_kb}k" -srcfolder "$stage" -format UDZO "$pending/Doto-0.1.0-macOS-arm64-review.dmg"
ditto -c -k --sequesterRsrc --keepParent "$app_dir" "$pending/Doto-0.1.0-macOS-arm64-review.zip"
(cd "$pending" && shasum -a 256 Doto-0.1.0-macOS-arm64-review.dmg Doto-0.1.0-macOS-arm64-review.zip > SHA256SUMS.txt)
for artifact in Doto-0.1.0-macOS-arm64-review.dmg Doto-0.1.0-macOS-arm64-review.zip SHA256SUMS.txt; do
  mv "$pending/$artifact" "$out_dir/$artifact"
done
printf '%s\n' "$out_dir"
