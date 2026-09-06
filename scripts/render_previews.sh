#!/usr/bin/env bash
# HOLLOW SUN — render→inspect loop, step 1: preview renders (pipeline v2).
#
# Headless CPU-only rendering needs a GL context, so we run Blender under a
# raw Xvfb display with LIBGL_ALWAYS_SOFTWARE=1 (Mesa llvmpipe).
# NOTE: `xvfb-run` is broken in this sandbox (no xauth) — the PLAYBOOK
# workaround is to start raw `Xvfb :NN` ourselves and kill it afterwards.
#
# Usage: bash scripts/render_previews.sh [out_dir] [mesh_dir] [engine]
#   engine: auto (workbench→cycles fallback, default) | workbench | cycles
set -u

BLENDER="${BLENDER:-/home/z/tools/blender-4.2.0-linux-x64/blender}"
DISP="${XVFB_DISPLAY:-77}"
OUT="${1:-.qa/assets}"
MESHES="${2:-public/assets/meshes}"
ENGINE="${3:-auto}"

if [ ! -x "$BLENDER" ]; then
  echo "render_previews: blender not found at $BLENDER — SKIP"
  exit 0
fi
if [ ! -d "$MESHES" ] || ! ls "$MESHES"/*.glb >/dev/null 2>&1; then
  echo "render_previews: no .glb in $MESHES — SKIP"
  exit 0
fi

mkdir -p "$OUT"

started=0
XVPID=""
if [ -S "/tmp/.X11-unix/X$DISP" ]; then
  echo "render_previews: reusing already-running Xvfb :$DISP (will NOT kill it)"
else
  Xvfb ":$DISP" -screen 0 1024x768x24 -nolisten tcp >"/tmp/xvfb_$DISP.log" 2>&1 &
  XVPID=$!
  started=1
  for _ in $(seq 1 50); do
    [ -S "/tmp/.X11-unix/X$DISP" ] && break
    sleep 0.1
  done
fi

cleanup() {
  if [ "$started" = "1" ] && [ -n "$XVPID" ]; then
    kill "$XVPID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

export DISPLAY=":$DISP"
export LIBGL_ALWAYS_SOFTWARE=1

"$BLENDER" -b -P scripts/blender/render_preview.py -- \
  --out "$OUT" --meshes "$MESHES" --engine "$ENGINE"
rc=$?

# if workbench could not create a context at all (crash/nonzero), retry once
# with forced CYCLES CPU so the loop still produces previews
if [ "$rc" -ne 0 ] && [ "$ENGINE" = "auto" ]; then
  echo "render_previews: workbench pass failed (rc=$rc) — retrying with CYCLES CPU"
  "$BLENDER" -b -P scripts/blender/render_preview.py -- \
    --out "$OUT" --meshes "$MESHES" --engine cycles
  rc=$?
fi

exit $rc
