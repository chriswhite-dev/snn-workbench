#!/usr/bin/env bash
# Build RISP WebAssembly shim using Emscripten
# Prerequisites: emcc installed (https://emscripten.org/docs/getting_started/)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRAMEWORK="$SCRIPT_DIR/framework-open"
OUT_DIR="$SCRIPT_DIR/../apps/web/public"

mkdir -p "$OUT_DIR"

emcc \
  "$SCRIPT_DIR/risp_shim.cpp" \
  "$FRAMEWORK/src/framework.cpp" \
  "$FRAMEWORK/src/risp.cpp" \
  "$FRAMEWORK/src/properties.cpp" \
  -I "$FRAMEWORK/include" \
  -std=c++17 \
  -O3 \
  -s WASM=1 \
  -s EXPORTED_FUNCTIONS='["_load_network","_step","_apply_spikes","_reset","_get_state","_get_error"]' \
  -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","UTF8ToString","stringToUTF8","lengthBytesUTF8","_malloc","_free"]' \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME='RispModule' \
  -s NO_EXIT_RUNTIME=1 \
  -fexceptions \
  -o "$OUT_DIR/risp.js"

echo "Build complete: apps/web/public/risp.js + risp.wasm"
