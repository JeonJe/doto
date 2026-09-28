#!/bin/bash
set -euo pipefail
script_dir="$(cd "$(dirname "$0")" && pwd)"
app="${1:-$script_dir/Doto.app}"
node="$app/Contents/Resources/runtime/node"
server="$app/Contents/Resources/web/server.mjs"
report="${2:-/tmp/Momo-check-$(date +%Y%m%d-%H%M%S).txt}"
work=$(mktemp -d /tmp/momo-receiver-check.XXXXXX)
child_pid=''
cleanup(){ if [[ -n "$child_pid" ]]; then kill "$child_pid" 2>/dev/null || true; wait "$child_pid" 2>/dev/null || true; fi; rm -rf "$work"; }
trap cleanup EXIT
{
  echo 'Doto package smoke check. Finder first-launch approval is a separate manual check.'
  sw_vers
  uname -m
  codesign --verify --deep --strict "$app"
  "$node" --version
  env -i HOME="$work" PATH=/usr/bin:/bin MOMO_DATA_DIR="$work/data" MOMO_PORT=0 "$node" "$server" > "$work/server.log" 2>&1 &
  child_pid=$!
  for attempt in $(seq 1 50); do
    if /usr/bin/grep -q '^MOMO http://127.0.0.1:' "$work/server.log"; then break; fi
    if ! kill -0 "$child_pid" 2>/dev/null; then cat "$work/server.log"; exit 1; fi
    sleep 0.2
  done
  origin=$(/usr/bin/sed -n 's/^MOMO //p' "$work/server.log" | head -1)
  [[ -n "$origin" ]] || { echo 'FAIL: server did not become ready'; exit 1; }
  "$node" --input-type=module - "$origin" <<'JS'
import assert from 'node:assert/strict';
const origin=process.argv[2];
const state=await(await fetch(origin+'/api/state')).json();
assert.equal(state.watches.length,0);
const inventory=await(await fetch(origin+'/api/installed')).json();
assert.equal(inventory.items.length,0);
assert.equal((await fetch(origin)).status,200);
console.log('PASS: bundled runtime, empty user data, no developer tools, dynamic loopback port, UI assets');
console.log('Not checked: Finder/Gatekeeper approval, visual interaction, sleep/wake, real package updates.');
JS
} > "$report" 2>&1
printf '검증 결과: %s\n' "$report"
