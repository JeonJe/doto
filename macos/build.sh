#!/bin/bash
set -euo pipefail
prototype_root="$(cd "$(dirname "$0")/.." && pwd)"
app_dir="${MOMO_DIST_DIR:-$prototype_root/dist}/Doto.app"
node_version="v22.23.3"
architecture="${MOMO_ARCH:-$(uname -m)}"
case "$architecture" in
  arm64) node_arch=arm64; runtime_sha=23b25245dcfb9af7262f8ff142e9e2e0af025368117329e7a7458a51e5922f53 ;;
  x86_64) node_arch=x64; runtime_sha=8a677b0219178efd6eb0e475457c4afb452b521a92f6e67845a73bd85727f2a8 ;;
  *) echo '지원 아키텍처: arm64, x86_64' >&2; exit 1 ;;
esac
runtime_node="${MOMO_NODE_BINARY:-}"
if [[ -z "$runtime_node" ]]; then
  runtime_cache="${MOMO_RUNTIME_CACHE:-$prototype_root/macos/.cache}"
  mkdir -p "$runtime_cache"
  archive="node-$node_version-darwin-$node_arch.tar.gz"
  if [[ ! -f "$runtime_cache/$archive" ]]; then
    curl --fail --location --proto '=https' --tlsv1.2 "https://nodejs.org/dist/$node_version/$archive" -o "$runtime_cache/$archive.download"
    mv "$runtime_cache/$archive.download" "$runtime_cache/$archive"
  fi
  printf '%s  %s\n' "$runtime_sha" "$runtime_cache/$archive" | shasum -a 256 -c -
  tar -xzf "$runtime_cache/$archive" -C "$runtime_cache"
  runtime_node="$runtime_cache/node-$node_version-darwin-$node_arch/bin/node"
fi
[[ -x "$runtime_node" ]] || { echo 'Node 실행 파일을 찾지 못했어요.' >&2; exit 1; }
lipo "$runtime_node" -verify_arch "$architecture"
mkdir -p "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources/web" "$app_dir/Contents/Resources/runtime"
cp "$prototype_root/macos/Info.plist" "$app_dir/Contents/Info.plist"
for asset in server.mjs inventory.mjs app.js index.html style.css pet.svg; do
  cp "$prototype_root/$asset" "$app_dir/Contents/Resources/web/$asset"
done
cp "$runtime_node" "$app_dir/Contents/Resources/runtime/node"
if [[ -f "$(dirname "$runtime_node")/../LICENSE" ]]; then cp "$(dirname "$runtime_node")/../LICENSE" "$app_dir/Contents/Resources/runtime/LICENSE"; fi
xcrun swiftc -swift-version 5 -O -target "$architecture-apple-macosx13.0" -file-prefix-map "$prototype_root=." -module-cache-path "${TMPDIR:-/tmp}/momo-swift-cache" -framework AppKit -framework WebKit "$prototype_root/macos/Momo.swift" -o "$app_dir/Contents/MacOS/Doto"
codesign --force --sign - "$app_dir/Contents/Resources/runtime/node"
codesign --force --sign - "$app_dir"
codesign --verify --deep --strict "$app_dir"
printf '%s\n' "$app_dir"
