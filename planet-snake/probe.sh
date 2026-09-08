#!/bin/bash
# 受控取样：在固定坐标冻结并截图。用法: probe.sh <name> <x> <y> <z>
cd "$(dirname "$0")/.."
CDP_PORT=9444 bun tools/cdp.mjs eval "__ps.freeze([$2,$3,$4])" >/dev/null
sleep 1
CDP_PORT=9444 bun tools/cdp.mjs shot "shots/$1.png" 300 >/dev/null
echo "shots/$1.png"
