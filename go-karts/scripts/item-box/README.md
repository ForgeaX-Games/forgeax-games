# Item box bake (original wooden ? crate)

Matches Claude-fable `createWoodenItemBox`: dark wood planks + yellow `?` in baseColor.
No emissive map — ForgeaX bloom made glowing crates strobe while spinning.

```bash
cd scripts/item-box
python3 gen_textures.py
# needs: bun add @gltf-transform/core (once) in a temp dir, or run from /tmp/itembox-bake
node bake-gltf.mjs
cp item_box.gltf item_box_*.bin baseColor_1.png emissive_1.png \
  ../../assets/
cd ../../assets
node <studio>/packages/editor/packages/engine/packages/gltf/dist/cli-gltf.mjs import item_box.gltf
cd .. && node scripts/build-scene.mjs
```

GUIDs are pinned in `scripts/build-scene.mjs` (`ITEM_BOX_MESH` / `ITEM_BOX_MAT`).
