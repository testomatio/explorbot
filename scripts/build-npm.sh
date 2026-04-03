#!/usr/bin/env bash
set -euo pipefail

DIST_DIR="dist"

rm -rf "$DIST_DIR"

npx tsc -p tsconfig.build.json --noCheck

for dir in rules assets/sample-files prompts; do
  if [ -d "$dir" ]; then
    mkdir -p "$DIST_DIR/$dir"
    cp -r "$dir"/. "$DIST_DIR/$dir/"
  fi
done

CLI="$DIST_DIR/bin/explorbot-cli.js"
if [ -f "$CLI" ]; then
  sed -i '1s|^#!.*|#!/usr/bin/env node|' "$CLI"
  chmod +x "$CLI"
fi

echo "Build complete: $DIST_DIR/"
