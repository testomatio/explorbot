#!/usr/bin/env bash
set -euo pipefail

DIST_DIR="dist"

rm -rf "$DIST_DIR"

npx tsc -p tsconfig.build.json --noCheck

bun run scripts/build-types.ts

for dir in rules assets/sample-files; do
  if [ -d "$dir" ]; then
    mkdir -p "$DIST_DIR/$dir"
    cp -r "$dir"/. "$DIST_DIR/$dir/"
  fi
done

cp package.json "$DIST_DIR/package.json"
cp models.json "$DIST_DIR/models.json"

for CLI in "$DIST_DIR/bin/explorbot-cli.js" "$DIST_DIR/boat/prima/bin/prima-cli.js"; do
  if [ -f "$CLI" ]; then
    if [[ "$(uname)" == "Darwin" ]]; then
      sed -i '' '1s|^#!.*|#!/usr/bin/env node|' "$CLI"
    else
      sed -i '1s|^#!.*|#!/usr/bin/env node|' "$CLI"
    fi
    chmod +x "$CLI"
  fi
done

echo "Build complete: $DIST_DIR/"
